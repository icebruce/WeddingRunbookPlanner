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
  // The planner shell, not the timeline: an empty plan has no timeline to
  // wait for, and waiting for one would make every empty-state test hang.
  await expect(page.locator('#main-plan')).toBeVisible();
}

/**
 * Opens the planner in a page that may already carry the session cookie — a
 * second tab in the same browser context does, so it never sees the sign-in
 * form.
 */
export async function openPlanner(page, password = TEST_PASSWORD) {
  await page.goto('/');
  const field = page.locator('#login-form input[name="password"]');
  if (await field.count()) {
    await field.fill(password);
    await page.locator('#login-form button[type="submit"]').click();
  }
  await expect(page.locator('#main-plan')).toBeVisible();
}

/**
 * Open an activity's editor.
 *
 * Double-click is a desktop gesture and does not fire on a touch device, so a
 * spec that needs the editor on every project goes through the card's ⋯ menu.
 * The phone's own gesture for this is a long press, which arrives with the
 * direct manipulation stage.
 */
export async function openActivityEditor(page, card) {
  await card.locator('.card-menu-toggle').click();
  // The menu is drawn above the timeline, not inside the card, because a card
  // is clipped to its own height.
  await page.locator('.card-menu [data-action="edit"]').click();
  await expect(page.locator('#activity-dialog')).toBeVisible();
}

/**
 * Counts toasts as they are created. Toasts hide themselves after a few
 * seconds, so counting the elements still on screen at the end of a long wait
 * would report zero whether one was shown or a hundred were.
 */
export async function trackToasts(page) {
  await page.evaluate(() => {
    if (window.__toastLog) return;
    window.__toastLog = [];
    const region = document.querySelector('#toast-region');
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          window.__toastLog.push({
            text: node.textContent || '',
            error: node.classList.contains('toast--error')
          });
        }
      }
    }).observe(region, { childList: true });
  });

  const read = () => page.evaluate(() => window.__toastLog.slice());
  return {
    all: async () => (await read()).map(entry => entry.text),
    count: async () => (await read()).length,
    /** Only the failures. Ordinary changes also raise a toast, to offer Undo. */
    errors: async () => (await read()).filter(entry => entry.error).map(entry => entry.text),
    errorCount: async () => (await read()).filter(entry => entry.error).length
  };
}

/**
 * Touch drags. Playwright's public touchscreen API only taps, so a real swipe
 * needs CDP. That restricts swipe-based specs to Chromium-backed projects;
 * `supportsTouchDrag` lets a spec skip rather than silently pass on WebKit.
 */
export function supportsTouchDrag(browserName) {
  return browserName === 'chromium';
}

/**
 * Which layout is on screen.
 *
 * Layout follows width — sheets and the selection toolbar below 720 px,
 * dialogs and a header add button above it. Interaction follows input
 * capability instead, which is why an iPad gets the wide layout but still
 * selects a card to reveal its handles rather than hovering for them.
 */
export function isPhoneLayout(page) {
  return page.viewportSize().width <= 720;
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
 * Brings a target to the middle of the viewport and returns its box there.
 *
 * A touch point outside the visual viewport lands on the document, not on the
 * element — on a phone-sized screen most of the timeline is off-screen, so a
 * box read without scrolling first is not where a finger can reach.
 */
export async function boxInView(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

  const box = await locator.boundingBox();
  const height = page.viewportSize().height;
  const centre = box.y + box.height / 2;
  const drift = centre - height / 2;

  if (Math.abs(drift) > height / 4) {
    await page.evaluate(by => window.scrollBy(0, by), drift);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    return locator.boundingBox();
  }
  return box;
}

/**
 * Fault injection for API routes.
 *   fail(page, { url: '**\/api/plan', method: 'PUT', status: 500 })
 * `times` limits how many requests are affected; later ones pass through, which
 * is how "fails twice then succeeds" backoff cases are written.
 */
export async function failRequests(page, { url = '**/api/**', method, status = 500, body = { error: { code: 'server_error', message: 'Injected failure' } }, times = Infinity, delayMs = 0 } = {}) {
  // `count` is every matching request, injected or not. Playwright runs the
  // most recently registered route first, so a separate counting route added
  // earlier would never see a request this one fulfils.
  const seen = { count: 0, injected: 0 };
  await page.route(url, async (route, request) => {
    if (method && request.method() !== method) return route.fallback();
    seen.count += 1;
    if (seen.injected >= times) return route.fallback();
    seen.injected += 1;
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
