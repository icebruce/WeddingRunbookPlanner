import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { createSeedEnvelope } from '../../lib/server/seed-template.js';
import { UpstashClient } from '../../lib/server/upstash.js';
import {
  COMPARE_AND_SET,
  DATA_KEY,
  MAX_VERSIONS,
  VERSIONS_KEY,
  createVersion,
  deleteVersion,
  getDriver,
  readData,
  readVersions,
  restoreVersion,
  savePlan,
  setDriver,
  UpstashDriver
} from '../../lib/server/storage.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wedding-planner-'));
process.env.LOCAL_DATA_FILE = path.join(dir, 'store.json');
delete process.env.VERCEL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

test.afterEach(() => setDriver(null));

/**
 * Stands in for Redis. `compareAndSet` is the whole point: it is a single
 * indivisible step here, exactly as the Lua script is on the server.
 */
function fakeDriver({ envelope, onWrite = () => {} } = {}) {
  const seed = envelope === undefined ? (() => { const { versions, ...rest } = createSeedEnvelope(); return rest; })() : envelope;
  const keys = new Map();
  if (seed) keys.set(DATA_KEY, structuredClone(seed));
  if (seed) keys.set(VERSIONS_KEY, { versions: [] });

  const calls = { read: 0, seed: 0, compareAndSet: 0, put: 0 };
  return {
    calls,
    keys,
    get stored() { return keys.get(DATA_KEY) ?? null; },
    get versions() { return keys.get(VERSIONS_KEY)?.versions ?? []; },
    async read(key = DATA_KEY) {
      calls.read += 1;
      const value = keys.get(key);
      return value ? structuredClone(value) : null;
    },
    async put(key, value) {
      calls.put += 1;
      keys.set(key, structuredClone(value));
    },
    async seed(next, key = DATA_KEY) {
      calls.seed += 1;
      if (keys.has(key)) return false;
      keys.set(key, structuredClone(next));
      return true;
    },
    async compareAndSet(expectedRevision, next) {
      calls.compareAndSet += 1;
      await onWrite();
      const current = keys.get(DATA_KEY);
      if (!current) return { ok: false, missing: true };
      if (Number(current.revision) !== Number(expectedRevision)) return { ok: false, current: structuredClone(current) };
      keys.set(DATA_KEY, structuredClone(next));
      return { ok: true };
    }
  };
}

test('seeds, saves, versions and restores plan data', async () => {
  const seeded = await readData();
  assert.equal(seeded.plan.date, '2026-11-21');

  const changed = { ...structuredClone(seeded.plan), title: 'Changed title' };
  const saved = await savePlan(changed, seeded.revision);
  assert.equal(saved.plan.title, 'Changed title');
  assert.equal(saved.revision, seeded.revision + 1);

  const versioned = await createVersion('Changed');
  assert.equal(versioned.versions[0].name, 'Changed');
  assert.equal(versioned.versions[0].auto, false);
  assert.equal(versioned.versions[0].summary.count, saved.plan.activities.length);

  const savedAgain = await savePlan({ ...structuredClone(saved.plan), title: 'Another title' }, saved.revision);
  const restored = await restoreVersion(versioned.versions[0].id, savedAgain.revision);
  assert.equal(restored.plan.title, 'Changed title');
});

test('rejects stale revisions', async () => {
  const data = await readData();
  await assert.rejects(() => savePlan(data.plan, data.revision - 1), error => error.statusCode === 409);
});

test('F3: two concurrent saves cannot both win', async () => {
  // Both callers read revision 1 before either writes, which is exactly the
  // interleaving the old read-then-write code let through.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstWrite = true;
  const driver = fakeDriver({
    onWrite: async () => {
      if (!firstWrite) return;
      firstWrite = false;
      await gate;
    }
  });
  setDriver(driver);

  const base = driver.stored.plan;
  const first = savePlan({ ...structuredClone(base), title: 'From device A' }, 1);
  const second = savePlan({ ...structuredClone(base), title: 'From device B' }, 1);

  release();
  const results = await Promise.allSettled([first, second]);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'exactly one save may succeed');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.statusCode, 409);
  assert.equal(rejected[0].reason.code, 'revision_conflict');
  assert.equal(driver.stored.revision, 2, 'only one revision was consumed');
});

test('a conflict hands back the stored envelope so the client can offer a choice', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  driver.stored.revision = 7;
  driver.stored.plan.title = 'Newer from the other device';

  await assert.rejects(
    () => savePlan(driver.stored.plan, 3),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.current.revision, 7);
      assert.equal(error.current.plan.title, 'Newer from the other device');
      return true;
    }
  );
});

test('seeding uses SET NX so a racing instance cannot overwrite the store', async () => {
  const driver = fakeDriver({ envelope: null });
  setDriver(driver);

  // Two cold instances both find an empty store.
  const [a, b] = await Promise.all([readData(), readData()]);
  assert.equal(a.revision, 1);
  assert.equal(b.revision, 1);
  assert.ok(driver.calls.seed >= 1);
  assert.equal(driver.stored.plan.activities.length, a.plan.activities.length);
});

test('a save is validated before it is stored', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  await assert.rejects(
    () => savePlan({ ...driver.stored.plan, title: '   ' }, 1),
    error => error.statusCode === 400 && error.field === 'title'
  );
  assert.equal(driver.calls.compareAndSet, 0, 'invalid input never reaches the store');
});

test('a save drops unknown fields rather than persisting them', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  const saved = await savePlan({ ...driver.stored.plan, injected: 'nope' }, 1);
  assert.equal('injected' in saved.plan, false);
  assert.equal('injected' in driver.stored.plan, false);
});

test('updatedBy records which device wrote, for the "another device" message', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  const saved = await savePlan(driver.stored.plan, 1, { updatedBy: 'device-abc' });
  assert.equal(saved.updatedBy, 'device-abc');
});

test('F18: saving the plan does not rewrite the versions', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  await createVersion('A named version');

  const before = driver.calls.put;
  await savePlan(driver.stored.plan, 1);
  assert.equal(driver.calls.put, before, 'a plan save touches the plan key only');
  assert.equal('versions' in driver.stored, false, 'and the envelope carries no plan copies');
});

test('versions are capped, newest first, and named ones outlive automatic ones', async () => {
  const driver = fakeDriver();
  setDriver(driver);

  await createVersion('Keep me');
  for (let i = 0; i < MAX_VERSIONS + 3; i += 1) {
    await createVersion(`Automatic ${i}`, { auto: true });
  }

  const versions = await readVersions();
  assert.equal(versions.length, MAX_VERSIONS);
  assert.equal(versions[0].name, `Automatic ${MAX_VERSIONS + 2}`, 'newest first');
  assert.ok(versions.some(version => version.name === 'Keep me'),
    'a version someone named is one they meant to keep');
});

test('D19: restoring keeps a copy of what it replaces', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  const original = driver.stored.plan.title;

  const { versions } = await createVersion('A point to come back to');
  await savePlan({ ...driver.stored.plan, title: 'Since then' }, 1);
  await restoreVersion(versions[0].id, 2);

  assert.equal(driver.stored.plan.title, original);
  const after = await readVersions();
  assert.ok(after.some(version => version.auto && /^Before restore/.test(version.name)));
});

test('a version can be deleted, and an unknown one is a 404', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  const { versions } = await createVersion('Temporary');

  await deleteVersion(versions[0].id);
  assert.deepEqual(await readVersions(), []);
  await assert.rejects(() => deleteVersion(versions[0].id), error => error.statusCode === 404);
});

test('restoring an unknown version is a 404, not a silent no-op', async () => {
  const driver = fakeDriver();
  setDriver(driver);
  await assert.rejects(() => restoreVersion('does-not-exist', 1), error => error.statusCode === 404);
});

test('F18: versions stored in the old envelope are moved out on first read', async () => {
  const legacy = createSeedEnvelope();
  legacy.revision = 7;
  legacy.versions = [
    { id: 'v1', name: 'Before the venue call', createdAt: '2026-09-01T10:00:00.000Z', plan: structuredClone(legacy.plan) }
  ];
  const driver = fakeDriver({ envelope: legacy });
  driver.keys.delete(VERSIONS_KEY);
  setDriver(driver);

  const data = await readData();
  assert.equal('versions' in data, false, 'the envelope no longer carries them');
  assert.equal(data.revision, 7, 'and the revision is untouched, so nobody gets a conflict');

  const versions = await readVersions();
  assert.equal(versions.length, 1);
  assert.equal(versions[0].name, 'Before the venue call');
  assert.equal(versions[0].auto, false, 'an old version had no flag; it was not automatic');
  assert.equal(versions[0].summary.count, legacy.plan.activities.length, 'and its summary is derived');
});

test('the migration runs once and is harmless the second time', async () => {
  const legacy = createSeedEnvelope();
  legacy.versions = [{ id: 'v1', name: 'Old', createdAt: '2026-09-01T10:00:00.000Z', plan: structuredClone(legacy.plan) }];
  const driver = fakeDriver({ envelope: legacy });
  driver.keys.delete(VERSIONS_KEY);
  setDriver(driver);

  await readData();
  await readData();
  assert.equal((await readVersions()).length, 1);
});

test('production without Upstash credentials fails closed', async () => {
  setDriver(null);
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    assert.throws(() => getDriver(), error => error.statusCode === 503 && error.code === 'storage_unconfigured');
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});

test('F11: an Upstash call that never settles is aborted, not left hanging', async () => {
  const client = new UpstashClient({ url: 'https://example.invalid', token: 't' }, {
    timeoutMs: 20,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    })
  });
  await assert.rejects(() => client.send(['GET', DATA_KEY]), error => error.statusCode === 504);
});

test('reads retry once; writes do not', async () => {
  let attempts = 0;
  const client = new UpstashClient({ url: 'https://example.invalid', token: 't' }, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return { ok: true, json: async () => ({ result: 'value' }) };
    }
  });
  assert.equal(await client.read(['GET', DATA_KEY]), 'value');
  assert.equal(attempts, 2);

  attempts = 0;
  const writer = new UpstashClient({ url: 'https://example.invalid', token: 't' }, {
    fetchImpl: async () => { attempts += 1; throw new Error('transient'); }
  });
  await assert.rejects(() => writer.write(['SET', DATA_KEY, '{}']));
  assert.equal(attempts, 1, 'a write that may have landed is never repeated');
});

test('an Upstash error body surfaces as a failure rather than a null result', async () => {
  const client = new UpstashClient({ url: 'https://example.invalid', token: 't' }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'ERR unknown command' }) })
  });
  await assert.rejects(() => client.send(['NOPE']), /ERR unknown command/);
});

test('the Upstash driver issues one compare-and-set round trip', async () => {
  const sent = [];
  const driver = new UpstashDriver({
    read: async command => { sent.push(command); return null; },
    write: async command => { sent.push(command); return ['ok']; }
  });

  const envelope = createSeedEnvelope();
  const result = await driver.compareAndSet(4, envelope);
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.length, 1, 'compare and write are a single call, not a read then a write');

  const [command, script, numKeys, key, expected, payload] = sent[0];
  assert.equal(command, 'EVAL');
  assert.equal(script, COMPARE_AND_SET);
  assert.equal(numKeys, '1');
  assert.equal(key, DATA_KEY);
  assert.equal(expected, '4');
  assert.deepEqual(JSON.parse(payload), envelope);
});

test('the Upstash driver reports the stored envelope when the script says conflict', async () => {
  const stored = { ...createSeedEnvelope(), revision: 9 };
  const driver = new UpstashDriver({
    read: async () => null,
    write: async () => ['conflict', JSON.stringify(stored)]
  });
  const result = await driver.compareAndSet(4, createSeedEnvelope());
  assert.equal(result.ok, false);
  assert.equal(result.current.revision, 9);
});

test('the Upstash driver seeds with SET NX and reports whether it won', async () => {
  const sent = [];
  const winner = new UpstashDriver({ read: async () => null, write: async c => { sent.push(c); return 'OK'; } });
  assert.equal(await winner.seed(createSeedEnvelope()), true);
  assert.equal(sent[0][0], 'SET');
  assert.equal(sent[0][1], DATA_KEY);
  assert.equal(sent[0][3], 'NX');

  const loser = new UpstashDriver({ read: async () => null, write: async () => null });
  assert.equal(await loser.seed(createSeedEnvelope()), false, 'null means another instance seeded first');
});

test('the compare-and-set script never re-encodes the stored document', () => {
  // cjson.encode would rewrite an empty activities list as {}. The script must
  // only decode far enough to read the revision and write Node's JSON verbatim.
  assert.doesNotMatch(COMPARE_AND_SET, /cjson\.encode/);
  assert.match(COMPARE_AND_SET, /redis\.call\('SET', KEYS\[1\], ARGV\[2\]\)/);
});
