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

  async compareAndSet(expectedRevision, envelope) {
    const result = await this.client.write([
      'EVAL',
      COMPARE_AND_SET,
      '1',
      DATA_KEY,
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

  compareAndSet(expectedRevision, envelope) {
    return this.serialize(async () => {
      const current = await this.readFile(DATA_KEY);
      if (!current) return { ok: false, missing: true };
      if (Number(current.revision) !== Number(expectedRevision)) return { ok: false, current };
      await this.writeFile(DATA_KEY, envelope);
      return { ok: true };
    });
  }
}

let driverOverride = null;

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
  return new FileDriver(process.env.LOCAL_DATA_FILE || path.resolve('.data/store.json'));
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
      await driver.put(VERSIONS_KEY, { versions: stored.versions.map(normalizeVersion) });
    }

    const { versions, ...rest } = stored;
    // The envelope keeps its revision: dropping a field no client ever saw is
    // not a change to the plan, and leaving the revision alone means nobody's
    // pending save is turned into a conflict by the migration.
    //
    // It still goes through compare-and-set, so if another instance is
    // migrating at the same time — or someone saves mid-migration — exactly
    // one write lands and this one simply loses.
    await driver.compareAndSet(stored.revision, rest);
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
  const result = await driver.compareAndSet(expectedRevision, envelope);
  if (result.ok) return envelope;
  if (result.missing) throw conflict('The plan store was empty. Reload before saving.', await driver.read(DATA_KEY));
  throw conflict('This plan was updated somewhere else. Reload before saving.', result.current);
}

// ------------------------------------------------------------------ versions

async function loadVersions(driver) {
  const stored = await driver.read(VERSIONS_KEY);
  return Array.isArray(stored?.versions) ? stored.versions : [];
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

  const versions = prune([version, ...(await loadVersions(driver))]);
  await driver.put(VERSIONS_KEY, { versions });
  return { version, versions };
}

export async function deleteVersion(id) {
  const driver = getDriver();
  const versions = await loadVersions(driver);
  const removed = versions.find(version => version.id === id);
  if (!removed) throw Object.assign(new Error('Version not found.'), { statusCode: 404, code: 'not_found' });

  await driver.put(VERSIONS_KEY, { versions: versions.filter(version => version.id !== id) });
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

  const snapshotName = `Before restore – ${new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`;
  await createVersion(snapshotName, { auto: true, plan: current.plan });

  const envelope = nextEnvelope(current, { plan: clone(version.plan) });
  const result = await driver.compareAndSet(expectedRevision, envelope);
  if (!result.ok) throw conflict('Plan changed before the version could be restored.', result.current);
  return envelope;
}
