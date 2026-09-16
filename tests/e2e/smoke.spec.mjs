import { test, expect } from './fixtures.mjs';
import { signInAndWaitForPlan } from './helpers.mjs';

// A basic sign-in/route smoke check with no viewport-dependent assertion.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent');
});

test('signs in and shows the seeded plan', async ({ page }) => {
  await signInAndWaitForPlan(page);

  await expect(page.locator('.planner-heading h1')).toHaveText('Wedding Day');
  await expect(page.locator('.card')).toHaveCount(11);
  await expect(page.locator('.card').first()).toContainText('Getting Ready');
});

test('a wrong password keeps the sign-in screen', async ({ page }) => {
  await page.goto('/');
  await page.locator('#login-form input[name="password"]').fill('not-the-password');
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('#login-error')).toBeVisible();
  await expect(page.locator('.timeline-grid')).toHaveCount(0);
});

test.describe('only public files are served', () => {
  const privatePaths = [
    '/lib/server/seed-template.js',
    '/lib/server/storage.js',
    '/lib/server/auth.js',
    '/tests/e2e/smoke.spec.mjs',
    '/package.json',
    '/vercel.json',
    '/scripts/dev-server.mjs'
  ];

  for (const pathname of privatePaths) {
    test(`${pathname} is not downloadable`, async ({ request }) => {
      const response = await request.get(pathname);
      expect(response.status()).toBe(404);
    });
  }

  test('public assets keep their URLs', async ({ request }) => {
    for (const pathname of ['/', '/styles/tokens.css', '/styles/base.css', '/src/app.js', '/src/render/card.js', '/robots.txt']) {
      const response = await request.get(pathname);
      expect(response.status(), pathname).toBe(200);
    }
  });
});
