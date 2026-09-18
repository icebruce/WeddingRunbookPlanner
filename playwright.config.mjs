import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// WebKit and Firefox builds are not downloadable in every environment (the
// sandbox used for development only ships Chromium). Rather than failing the
// whole run, projects fall back to Chromium with the same device descriptor and
// the run prints which engine it actually used, so a green run is never
// mistaken for WebKit coverage.
function engineAvailable(name) {
  if (process.env.PW_FORCE_CHROMIUM === '1') return name === 'chromium';
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  return roots.some(root => {
    try {
      return fs.readdirSync(root).some(entry => entry.startsWith(name));
    } catch {
      return false;
    }
  });
}

const webkitAvailable = engineAvailable('webkit');
export const WEBKIT_AVAILABLE = webkitAvailable;

// Chromium can emulate the viewport, touch and mobile flags of a WebKit device
// descriptor; it cannot emulate the engine. `engineNote` records the difference.
function asWebkitDevice(device) {
  if (webkitAvailable) return device;
  return { ...device, browserName: 'chromium', defaultBrowserType: 'chromium' };
}

if (!webkitAvailable && !process.env.PW_QUIET) {
  console.warn('[playwright] WebKit is not installed — the iphone-13 and ipad projects run on Chromium with iOS device emulation.');
}

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  // One per cent of a full-page screenshot is twenty-six thousand pixels — a
  // whole card can move and still be inside it, which is not a comparison at
  // all. This is tight enough to catch a layout change and loose enough to
  // ignore the handful of pixels antialiasing moves between runs.
  expect: { timeout: 7_000, toHaveScreenshot: { maxDiffPixelRatio: 0.0005 } },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The couple's own devices sit in the same zone as the venue, which is the
    // case every test but the shared-link ones is about. Pinning it means a
    // run on a machine set to UTC asserts the same thing as a run in Montreal.
    timezoneId: 'America/Toronto'
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }
    },
    {
      name: 'iphone-13',
      use: asWebkitDevice(devices['iPhone 13'])
    },
    {
      name: 'pixel-7',
      use: { ...devices['Pixel 7'] }
    },
    {
      name: 'ipad',
      use: asWebkitDevice(devices['iPad (gen 7)'])
    }
  ]
});
