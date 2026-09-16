/**
 * Persistence for the single stored plan.
 *
 * The central guarantee is that a save never loses another device's work
 * (F3). The previous implementation read the envelope, compared the revision
 * in Node, and then wrote: two saves arriving together could both read the
 * same revision, both pass the check, and the second would silently discard
 * the first. Here the compare and the write happen inside one Redis script, so
 * exactly one of two concurrent saves succeeds and the other is told it lost.
 *
 * Seeding uses SET NX for the same reason: two cold instances racing to create
 * the store cannot overwrite each other.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createSeedEnvelope } from './seed-template.js';
import { getUpstash } from './upstash.js';
import { validatePlan, validateVersionName } from './validate.js';

export const DATA_KEY = 'wedding-planner:data:v1';
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

  async read() {
    const value = await this.client.read(['GET', DATA_KEY]);
    return value ? JSON.parse(value) : null;
  }

  /** Returns true when this caller created the store. */
  async seed(envelope) {
    const result = await this.client.write(['SET', DATA_KEY, JSON.stringify(envelope), 'NX']);
    return result === 'OK';
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
 * Local development driver. A single process owns the file, so writes are
 * serialised through one promise chain and the compare-and-set is atomic with
 * respect to everything else this process does.
 */
class FileDriver {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async readFile() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeFile(envelope) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(envelope, null, 2), 'utf8');
    await fs.rename(temp, this.filePath);
  }

  read() {
    return this.serialize(() => this.readFile());
  }

  seed(envelope) {
    return this.serialize(async () => {
      if (await this.readFile()) return false;
      await this.writeFile(envelope);
      return true;
    });
  }

  compareAndSet(expectedRevision, envelope) {
    return this.serialize(async () => {
      const current = await this.readFile();
      if (!current) return { ok: false, missing: true };
      if (Number(current.revision) !== Number(expectedRevision)) return { ok: false, current };
      await this.writeFile(envelope);
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

async function loadEnvelope(driver) {
  const stored = await driver.read();
  if (stored) return stored;
  await driver.seed(createSeedEnvelope());
  // Read back rather than returning what we tried to write: if another instance
  // seeded first, its envelope is the real one.
  return (await driver.read()) || createSeedEnvelope();
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

/**
 * Attempts one compare-and-set. A `missing` store is seeded and the caller is
 * told to retry against the fresh revision rather than being handed a success
 * it did not earn.
 */
async function commit(driver, expectedRevision, current, changes) {
  const envelope = nextEnvelope(current, changes);
  const result = await driver.compareAndSet(expectedRevision, envelope);
  if (result.ok) return envelope;
  if (result.missing) {
    await driver.seed(createSeedEnvelope());
    throw conflict('The plan store was empty. Reload before saving.', await driver.read());
  }
  throw conflict('This plan was updated somewhere else. Reload before saving.', result.current);
}

export async function savePlan(plan, expectedRevision, { updatedBy = null } = {}) {
  const validated = validatePlan(plan);
  const driver = getDriver();
  const current = await loadEnvelope(driver);
  if (Number(expectedRevision) !== Number(current.revision)) {
    throw conflict('This plan was updated somewhere else. Reload before saving.', current);
  }
  return commit(driver, expectedRevision, current, { plan: validated, updatedBy });
}

function versionSummary(plan) {
  return {
    count: plan.activities.length,
    start: plan.activities[0]?.lockedStart || plan.dayStart,
    end: null
  };
}

export async function createVersion(name, expectedRevision, { auto = false, plan = null } = {}) {
  const cleanName = validateVersionName(name);
  const driver = getDriver();
  const current = await loadEnvelope(driver);
  if (Number(expectedRevision) !== Number(current.revision)) {
    throw conflict('Plan changed before the version could be saved.', current);
  }
  const body = plan ? validatePlan(plan) : clone(current.plan);
  const versions = [
    {
      id: crypto.randomUUID(),
      name: cleanName,
      createdAt: new Date().toISOString(),
      auto: Boolean(auto),
      summary: versionSummary(body),
      plan: body
    },
    ...(current.versions || [])
  ].slice(0, MAX_VERSIONS);

  return commit(driver, expectedRevision, current, { versions });
}

export async function restoreVersion(id, expectedRevision) {
  const driver = getDriver();
  const current = await loadEnvelope(driver);
  if (Number(expectedRevision) !== Number(current.revision)) {
    throw conflict('Plan changed before the version could be restored.', current);
  }
  const version = (current.versions || []).find(item => item.id === id);
  if (!version) throw Object.assign(new Error('Version not found.'), { statusCode: 404, code: 'not_found' });

  return commit(driver, expectedRevision, current, { plan: clone(version.plan) });
}
