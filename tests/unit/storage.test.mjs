import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createVersion, readData, restoreVersion, savePlan } from '../../lib/server/storage.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wedding-planner-'));
process.env.LOCAL_DATA_FILE = path.join(dir, 'store.json');
delete process.env.VERCEL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

test('seeds, saves, versions and restores plan data', async () => {
  const seeded = await readData();
  assert.equal(seeded.plan.date, '2026-11-21');
  const changed = structuredClone(seeded.plan);
  changed.title = 'Changed title';
  const saved = await savePlan(changed, seeded.revision);
  assert.equal(saved.plan.title, 'Changed title');

  const versioned = await createVersion('Changed', saved.revision);
  assert.equal(versioned.versions[0].name, 'Changed');

  const changedAgain = structuredClone(versioned.plan);
  changedAgain.title = 'Another title';
  const savedAgain = await savePlan(changedAgain, versioned.revision);
  const restored = await restoreVersion(versioned.versions[0].id, savedAgain.revision);
  assert.equal(restored.plan.title, 'Changed title');
});

test('rejects stale revisions', async () => {
  const data = await readData();
  await assert.rejects(() => savePlan(data.plan, data.revision - 1), error => error.statusCode === 409);
});
