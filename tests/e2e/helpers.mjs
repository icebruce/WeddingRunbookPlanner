import { expect } from '@playwright/test';
import { TEST_PASSWORD } from './fixtures.mjs';

/** Sign in and wait until the planner is on screen. */
export async function signIn(page, password = TEST_PASSWORD) {
  await page.goto('/');
  const field = page.locator('#login-form input[name="password"]');
  await expect(field).toBeVisible();
  await field.fill(password);
  await page.locator('#login-form button[type="submit"]').click();
}

export async function signInAndWaitForPlan(page, password = TEST_PASSWORD) {
  await signIn(page, password);
  await expect(page.locator('#activity-list')).toBeVisible();
}

/**
 * Touch drags. Playwright's public touchscreen API only taps, so a real swipe
 * needs CDP. That restricts swipe-based specs to Chromium-backed projects;
 * `supportsTouchDrag` lets a spec skip rather than silently pass on WebKit.
 */
export function supportsTouchDrag(browserName) {
  return browserName === 'chromium';
}

async function touchSession(page) {
  const client = await page.context().newCDPSession(page);
  return {
    async send(type, x, y) {
      await client.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }]
      });
    },
    detach: () => client.detach().catch(() => {})
  };
}

/**
 * Press at `from`, optionally hold, move to `to` over `steps`, then release.
 * `holdMs` makes it a long-press or a reorder hold; `release: false` leaves the
 * finger down so a test can assert mid-gesture state.
 */
export async function touchDrag(page, from, to, { steps = 12, holdMs = 0, settleMs = 16, release = true } = {}) {
  const touch = await touchSession(page);
  await touch.send('touchStart', from.x, from.y);
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    await touch.send('touchMove', from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
    if (settleMs) await page.waitForTimeout(settleMs);
  }
  if (release) {
    await touch.send('touchEnd', to.x, to.y);
    await touch.detach();
    return null;
  }
  return {
    move: (x, y) => touch.send('touchMove', x, y),
    end: async (x = to.x, y = to.y) => {
      await touch.send('touchEnd', x, y);
      await touch.detach();
    }
  };
}

export async function touchTap(page, point, { holdMs = 0 } = {}) {
  const touch = await touchSession(page);
  await touch.send('touchStart', point.x, point.y);
  if (holdMs) await page.waitForTimeout(holdMs);
  await touch.send('touchEnd', point.x, point.y);
  await touch.detach();
}

export function centreOf(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Fault injection for API routes.
 *   fail(page, { url: '**\/api/plan', method: 'PUT', status: 500 })
 * `times` limits how many requests are affected; later ones pass through, which
 * is how "fails twice then succeeds" backoff cases are written.
 */
export async function failRequests(page, { url = '**/api/**', method, status = 500, body = { error: 'Injected failure' }, times = Infinity, delayMs = 0 } = {}) {
  const seen = { count: 0 };
  await page.route(url, async (route, request) => {
    if (method && request.method() !== method) return route.fallback();
    if (seen.count >= times) return route.fallback();
    seen.count += 1;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body)
    });
  });
  return seen;
}

/** Count requests without changing their outcome. */
export async function countRequests(page, { url = '**/api/**', method } = {}) {
  const seen = { count: 0, urls: [] };
  await page.route(url, async (route, request) => {
    if (!method || request.method() === method) {
      seen.count += 1;
      seen.urls.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
    await route.fallback();
  });
  return seen;
}

/** Freeze the page clock at a wall time on the plan's date. */
export async function setClock(page, isoTime) {
  await page.clock.install({ time: new Date(isoTime) });
}
