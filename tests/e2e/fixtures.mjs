import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

import { SEED_PLAN } from '../../lib/server/seed-template.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TEST_PASSWORD = 'e2e-password-987';
export const TEST_SESSION_SECRET = 'e2e-session-secret-0123456789abcdef';

export function seedPlan(overrides = {}) {
  return { ...structuredClone(SEED_PLAN), ...overrides };
}

export function activity(id, start, duration, extra = {}) {
  return {
    id,
    title: id,
    start,
    duration,
    stage: 'preparation',
    location: '',
    people: [],
    notes: '',
    locked: false,
    ...extra
  };
}

/**
 * Each worker gets its own dev server, on its own port, backed by its own data
 * file. Tests therefore never share state, and a test can rewrite the whole
 * store between runs without touching another worker.
 */
async function startServer(dataFile) {
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'dev-server.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: '0',
      APP_PASSWORD: TEST_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
      LOCAL_DATA_FILE: dataFile,
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(String(chunk)));

  const baseURL = await new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error(`dev server did not start\n${stderr.join('')}`)), 15_000);
    child.stdout.on('data', chunk => {
      buffered += String(chunk);
      const match = buffered.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[0]);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`dev server exited with code ${code}\n${stderr.join('')}`));
    });
  });

  return { child, baseURL };
}

export const test = base.extend({
  /** One dev server per worker. */
  server: [async ({}, use, workerInfo) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wrp-e2e-${workerInfo.workerIndex}-`));
    const dataFile = path.join(dir, 'store.json');
    const { child, baseURL } = await startServer(dataFile);

    // Versions live in their own store, so resetting the plan alone would let
    // one test's versions turn up in the next one.
    const versionsFile = `${dataFile}.versions.json`;
    // The share link has its own store too, and a token minted by one test is
    // still live for the next one in the same worker unless it is cleared.
    const shareFile = `${dataFile}.share.json`;

    const readFile = async file => {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    };

    await use({
      baseURL,
      dataFile,
      versionsFile,
      shareFile,

      /** Replace the whole stored state. Call before navigating. */
      async seed({ plan = seedPlan(), revision = 1, versions = [], updatedAt = new Date().toISOString(), updatedBy = null, legacyEnvelope = false } = {}) {
        const envelope = { revision, updatedAt, updatedBy, plan };
        // `legacyEnvelope` writes the pre-split shape, for migration tests.
        if (legacyEnvelope) envelope.versions = versions;
        await fs.writeFile(dataFile, JSON.stringify(envelope, null, 2), 'utf8');
        await fs.writeFile(versionsFile, JSON.stringify({ versions: legacyEnvelope ? [] : versions }, null, 2), 'utf8');
        await fs.rm(shareFile, { force: true });
      },

      /** Read the stored envelope back, to assert what the server actually kept. */
      read: () => readFile(dataFile),
      readVersions: async () => (await readFile(versionsFile))?.versions ?? [],
      readShare: () => readFile(shareFile),

      async clear() {
        await fs.rm(dataFile, { force: true });
        await fs.rm(versionsFile, { force: true });
        await fs.rm(shareFile, { force: true });
      }
    });

    child.kill('SIGTERM');
    await fs.rm(dir, { recursive: true, force: true });
  }, { scope: 'worker' }],

  baseURL: async ({ server }, use) => {
    await use(server.baseURL);
  },

  /** Every test starts from the seed timeline at revision 1 unless it re-seeds. */
  seeded: [async ({ server }, use) => {
    await server.seed();
    await use(server);
  }, { auto: true }]
});

export { expect };
