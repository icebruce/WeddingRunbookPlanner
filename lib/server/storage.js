/**
 * Persistence.
 *
 * Two keys, not one. Versions used to live inside the plan envelope, so every
 * autosave rewrote up to forty copies of the plan alongside the one that had
 * actually changed (F18). They now have their own key, and saving the plan
 * touches only the plan.
 *
 * The central guarantee is that a save never loses another device's work (F3).
 * The compare and the write happen inside one Redis script, so exactly one of
 * two concurrent saves succeeds and the other is told it lost. Seeding uses
 * SET NX for the same reason: two cold instances racing to create the store
 * cannot overwrite each other.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createSeedEnvelope } from './seed-template.js';
import { getUpstash } from './upstash.js';
import { buildSummary } from './summary.js';
import { validatePlan, validateVersionName } from './validate.js';

export const DATA_KEY = 'wedding-planner:data:v1';
export const VERSIONS_KEY = 'wedding-planner:versions:v1';
export const MAX_VERSIONS = 40;

function clone(value) {
  return structuredClone(value);
}

function conflict(message, current) {
  return Object.assign(new Error(message), { statusCode: 409, code: 'revision_conflict', current });
}

/**
 * Compare-and-set in one round trip. The script only decodes the stored value
 * far enough to read `revision`; the replacement is encoded by Node and written
 * verbatim, so nothing is re-serialised by cjson (which would, for instance,
 * turn an empty activity list into an empty object).
 */
export const COMPARE_AND_SET = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'missing'}
end
local current = cjson.decode(raw)
if tostring(current.revision) ~= ARGV[1] then
  return {'conflict', raw}
end
redis.call('SET', KEYS[1], ARGV[2])
return {'ok'}
`;

export class UpstashDriver {
  constructor(client) {
    this.client = client;
  }

  async read(key = DATA_KEY) {
    const value = await this.client.read(['GET', key]);
    return value ? JSON.parse(value) : null;
  }

  /** Returns true when this caller created the store. */
  async seed(envelope, key = DATA_KEY) {
    const result = await this.client.write(['SET', key, JSON.stringify(envelope), 'NX']);
    return result === 'OK';
  }

  async put(key, value) {
    await this.client.write(['SET', key, JSON.stringify(value)]);
  }

  async compareAndSet(key, expectedRevision, envelope) {
    const result = await this.client.write([
      'EVAL',
      COMPARE_AND_SET,
      '1',
      key,
      String(expectedRevision),
      JSON.stringify(envelope)
    ]);
    const [outcome, raw] = Array.isArray(result) ? result : [result];
    if (outcome === 'ok') return { ok: true };
    if (outcome === 'conflict') return { ok: false, current: JSON.parse(raw) };
    return { ok: false, missing: true };
  }
}

/**
 * Local development driver. A single process owns the files, so writes are
 * serialised through one promise chain and the compare-and-set is atomic with
 * respect to everything else this process does.
 */
class FileDriver {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  pathFor(key) {
    return key === DATA_KEY ? this.filePath : `${this.filePath}.${key.split(':')[1]}.json`;
  }

  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async readFile(key) {
    try {
      return JSON.parse(await fs.readFile(this.pathFor(key), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeFile(key, envelope) {
    const target = this.pathFor(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(envelope, null, 2), 'utf8');
    await fs.rename(temp, target);
  }

  read(key = DATA_KEY) {
    return this.serialize(() => this.readFile(key));
  }

  put(key, value) {
    return this.serialize(() => this.writeFile(key, value));
  }

  seed(envelope, key = DATA_KEY) {
    return this.serialize(async () => {
      if (await this.readFile(key)) return false;
      await this.writeFile(key, envelope);
      return true;
    });
  }

  compareAndSet(key, expectedRevision, envelope) {
    return this.serialize(async () => {
      const current = await this.readFile(key);
      if (!current) return { ok: false, missing: true };
      if (Number(current.revision) !== Number(expectedRevision)) return { ok: false, current };
      await this.writeFile(key, envelope);
      return { ok: true };
    });
  }
}

let driverOverride = null;
const fileDrivers = new Map();

/** Tests inject a driver rather than reaching for a real database. */
export function setDriver(driver) {
  driverOverride = driver;
}

export function getDriver() {
  if (driverOverride) return driverOverride;
  const client = getUpstash();
  if (client) return new UpstashDriver(client);
  // Deployed environments must never quietly fall back to a file that the next
  // invocation will not see.
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw Object.assign(
      new Error('Cloud storage is not configured. Connect an Upstash Redis store to this project.'),
      { statusCode: 503, code: 'storage_unconfigured' }
    );
  }
  // One instance per file: the write queue that makes compareAndSet atomic is
  // the instance's own, so a fresh driver per request is no mutex at all.
  const file = process.env.LOCAL_DATA_FILE || path.resolve('.data/store.json');
  if (!fileDrivers.has(file)) fileDrivers.set(file, new FileDriver(file));
  return fileDrivers.get(file);
}

/**
 * Reads the plan, moving any versions still stored inside the envelope out to
 * their own key on the way. The move is done before the envelope is returned,
 * so a caller never sees the old shape, and it is idempotent: a second
 * instance doing it at the same time writes the same thing.
 */
async function loadEnvelope(driver) {
  let stored = await driver.read(DATA_KEY);

  if (!stored) {
    const seed = createSeedEnvelope();
    const { versions, ...envelope } = seed;
    await driver.seed(envelope, DATA_KEY);
    await driver.seed({ versions: [] }, VERSIONS_KEY);
    // Read back rather than returning what we tried to write: if another
    // instance seeded first, its envelope is the real one.
    stored = (await driver.read(DATA_KEY)) || envelope;
  }

  if (Array.isArray(stored.versions)) {
    const existing = (await driver.read(VERSIONS_KEY))?.versions;
    if (!existing?.length && stored.versions.length) {
      await driver.put(VERSIONS_KEY, { versions: stored.versions.map(normalizeVersion), revision: 0 });
    }

    const { versions, ...rest } = stored;
    // The envelope keeps its revision: dropping a field no client ever saw is
    // not a change to the plan, and leaving the revision alone means nobody's
    // pending save is turned into a conflict by the migration.
    //
    // It still goes through compare-and-set, so if another instance is
    // migrating at the same time — or someone saves mid-migration — exactly
    // one write lands and this one simply loses.
    await driver.compareAndSet(DATA_KEY, stored.revision, rest);
    stored = (await driver.read(DATA_KEY)) || rest;
  }

  return stored;
}

/** Older versions have no `auto` flag and no summary; both are derivable. */
function normalizeVersion(version) {
  return {
    id: version.id,
    name: version.name,
    createdAt: version.createdAt,
    auto: Boolean(version.auto),
    summary: version.summary || buildSummary(version.plan),
    plan: version.plan
  };
}

export async function readData() {
  return loadEnvelope(getDriver());
}

function nextEnvelope(current, changes) {
  return {
    ...current,
    ...changes,
    revision: Number(current.revision) + 1,
    updatedAt: new Date().toISOString()
  };
}

export async function savePlan(plan, expectedRevision, { updatedBy = null } = {}) {
  const validated = validatePlan(plan);
  const driver = getDriver();
  const current = await loadEnvelope(driver);
  if (Number(expectedRevision) !== Number(current.revision)) {
    throw conflict('This plan was updated somewhere else. Reload before saving.', current);
  }

  const envelope = nextEnvelope(current, { plan: validated, updatedBy });
  const result = await driver.compareAndSet(DATA_KEY, expectedRevision, envelope);
  if (result.ok) return envelope;
  if (result.missing) throw conflict('The plan store was empty. Reload before saving.', await driver.read(DATA_KEY));
  throw conflict('This plan was updated somewhere else. Reload before saving.', result.current);
}

// ------------------------------------------------------------------ versions

async function loadVersions(driver) {
  return (await loadVersionDoc(driver)).versions;
}

/**
 * The versions list and the revision it was read at.
 *
 * It carries a revision for the same reason the plan does: two devices
 * resolving a conflict both archive the copy they are not keeping, at the same
 * moment, and a plain read-modify-write loses one of them — which is exactly
 * the copy the conflict dialog promised to keep (D19). A document written
 * before this existed has no revision, and counts as 0.
 */
async function loadVersionDoc(driver) {
  const stored = await driver.read(VERSIONS_KEY);
  return {
    versions: Array.isArray(stored?.versions) ? stored.versions : [],
    revision: Number(stored?.revision) || 0,
    exists: Boolean(stored),
    // A document written before versions had a revision. Compare-and-set
    // cannot match a field that is not there — the script compares
    // `tostring(current.revision)`, and for a missing field that is the string
    // "nil", which never equals "0" — so the first write stamps one on.
    legacy: Boolean(stored) && !Number.isFinite(Number(stored?.revision))
  };
}

const VERSION_WRITE_ATTEMPTS = 5;

/**
 * Read the list, change it, write it back — and if someone else wrote in
 * between, do it again on top of what they wrote rather than over it.
 */
async function updateVersions(driver, change) {
  for (let attempt = 0; attempt < VERSION_WRITE_ATTEMPTS; attempt += 1) {
    const doc = await loadVersionDoc(driver);
    const result = change(doc.versions);
    if (!result) return { doc, result: null };

    const next = { versions: result.versions, revision: doc.revision + 1 };
    if (!doc.exists) {
      if (await driver.seed(next, VERSIONS_KEY)) return { doc, result };
      continue;
    }
    if (doc.legacy) {
      await driver.put(VERSIONS_KEY, next);
      return { doc, result };
    }
    const written = await driver.compareAndSet(VERSIONS_KEY, doc.revision, next);
    if (written.ok) return { doc, result };
  }
  throw Object.assign(
    new Error('Version history is busy. Try again.'),
    { statusCode: 409, code: 'revision_conflict' }
  );
}

export async function readVersions() {
  return loadVersions(getDriver());
}

/**
 * Keeps the newest forty. Automatic copies are dropped first, because a
 * version someone named is one they meant to keep.
 */
function prune(versions) {
  if (versions.length <= MAX_VERSIONS) return versions;
  const kept = [...versions];
  while (kept.length > MAX_VERSIONS) {
    const oldestAuto = [...kept].reverse().find(version => version.auto);
    const victim = oldestAuto || kept[kept.length - 1];
    kept.splice(kept.indexOf(victim), 1);
  }
  return kept;
}

export async function createVersion(name, { auto = false, plan = null } = {}) {
  const cleanName = validateVersionName(name);
  const driver = getDriver();
  const body = plan ? validatePlan(plan) : clone((await loadEnvelope(driver)).plan);

  const version = {
    id: crypto.randomUUID(),
    name: cleanName,
    createdAt: new Date().toISOString(),
    auto: Boolean(auto),
    summary: buildSummary(body),
    plan: body
  };

  const { result } = await updateVersions(driver, existing => ({
    versions: prune([version, ...existing])
  }));
  return { version, versions: result.versions };
}

export async function deleteVersion(id) {
  const driver = getDriver();
  let removed = null;
  await updateVersions(driver, versions => {
    removed = versions.find(version => version.id === id) || null;
    if (!removed) return null;
    return { versions: versions.filter(version => version.id !== id) };
  });
  if (!removed) throw Object.assign(new Error('Version not found.'), { statusCode: 404, code: 'not_found' });
  return { removed };
}

/**
 * Restoring keeps a copy of what is being replaced (D19). Nobody should have
 * to be sure before they look.
 */
export async function restoreVersion(id, expectedRevision) {
  const driver = getDriver();
  const current = await loadEnvelope(driver);
  if (Number(expectedRevision) !== Number(current.revision)) {
    throw conflict('Plan changed before the version could be restored.', current);
  }

  const versions = await loadVersions(driver);
  const version = versions.find(item => item.id === id);
  if (!version) throw Object.assign(new Error('Version not found.'), { statusCode: 404, code: 'not_found' });

  // The copy is taken before the restore (D19): nobody should have to be sure
  // before they look, and that means the safety net is in place before the
  // jump, not after it.
  const snapshotName = `Before restore – ${new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`;
  const snapshot = await createVersion(snapshotName, { auto: true, plan: current.plan });

  // Unlike updateVersions above, this does not retry on conflict: the plan
  // changing under a restore is a real conflict the caller already checked
  // for once (the revision compare at the top of this function) and should
  // see reported, not one to silently replay on top of — restoring is a
  // deliberate overwrite of the whole plan, not a list edit that can just be
  // reapplied to whatever the list has become.
  const envelope = nextEnvelope(current, { plan: clone(version.plan) });
  const result = await driver.compareAndSet(DATA_KEY, expectedRevision, envelope);
  if (!result.ok) {
    // The restore did not happen, so neither did the thing the copy was for.
    // Leaving it behind meant every failed attempt added one, and the pruning
    // that keeps forty eventually pays for them with a version someone named.
    await deleteVersion(snapshot.version.id).catch(() => {});
    throw conflict('Plan changed before the version could be restored.', result.current);
  }
  return envelope;
}

// --------------------------------------------------------------------- share

export const SHARE_KEY = 'wedding-planner:share:v1';

/**
 * The read-only link.
 *
 * One token, stored on its own, granting exactly one thing: reading the plan.
 * It is deliberately not a session — nothing it can be presented to writes,
 * so the read-only guarantee is a property of which endpoints exist rather
 * than of a role check remembered in every one of them.
 *
 * Replacing it is how it is revoked. There is no list to curate and no
 * expiry: the plan stops mattering the day after the wedding, and a link
 * nobody can turn off would be worse than one anybody can replace.
 */
function newShare() {
  return {
    token: crypto.randomBytes(24).toString('base64url'),
    createdAt: new Date().toISOString()
  };
}

/** The current link, minting one on first ask. */
export async function ensureShare() {
  const driver = getDriver();
  const existing = await driver.read(SHARE_KEY);
  if (existing?.token) return existing;

  const fresh = newShare();
  // SET NX, so two cold instances asked at once cannot hand out two links and
  // have one of them silently stop working.
  if (await driver.seed(fresh, SHARE_KEY)) return fresh;
  return (await driver.read(SHARE_KEY)) || fresh;
}

/** A new link. The old one stops working immediately. */
export async function rotateShare() {
  const fresh = newShare();
  await getDriver().put(SHARE_KEY, fresh);
  return fresh;
}

/**
 * The plan, if the token is the current one.
 *
 * Compared in constant time and only after the lengths match, so the
 * comparison itself says nothing about how much of a guess was right.
 */
export async function readSharedPlan(token) {
  if (typeof token !== 'string' || !token) return null;

  const driver = getDriver();
  const share = await driver.read(SHARE_KEY);
  if (!share?.token) return null;

  const offered = Buffer.from(token);
  const real = Buffer.from(share.token);
  if (offered.length !== real.length || !crypto.timingSafeEqual(offered, real)) return null;

  const envelope = await loadEnvelope(driver);
  return { plan: envelope.plan, updatedAt: envelope.updatedAt };
}
