# Test Strategy

This document codifies how tests are laid out in this repo and how to decide
where a new test case belongs. It exists because the suite grew organically
to ~450 unit+e2e test cases and, at that size, an unwritten convention stops
being enough — two contributors will make different calls about where a test
goes unless the calls are written down.

The one rule everything else here serves: **maximum regression confidence per
test, minimum test code and maintenance overhead.** More tests is not the
goal. A smaller suite of well-placed tests beats a larger suite of overlapping
ones — overlap doesn't add confidence, it adds maintenance cost and flake
surface for the same bug.

## The layers

### 1. Unit (`tests/unit/*.test.mjs`, `node --test`)

For **pure logic**: anything that takes data in and returns data out with no
DOM, no network, no browser. This is `public/src/schedule.js`,
`layout.js`, `operations.js`, `state.js`, `validate.js`, `save.js`,
`dayof.js`, and `lib/server/*.js`.

- Fast (the whole suite runs in well under a second), deterministic, no
  flakiness surface.
- Use a fake clock (see `dayof.test.mjs`'s `createClock`, `save.test.mjs`'s
  timer control) instead of real waits for anything time-dependent. **Never**
  assert a policy by waiting out real wall-clock seconds in a slower layer
  when a fake-clock unit test can prove the same thing in milliseconds — see
  "Anti-patterns" below.
- This is where exact math belongs: pixel positions, duration arithmetic,
  overlap detection, validation boundaries, backoff sequences. If the answer
  can be computed without touching a page, it's a unit test's job to prove it
  right, not an e2e test's.

**When to add one here:** you added or changed a pure function, a reducer
action, a validation rule, or a state-machine transition (day-of on/off,
save state, undo). If you can call the function directly and assert on its
return value, it belongs here — don't reach for a browser.

### 2. Integration (`tests/unit/api-handlers.test.mjs`, same `node --test` runner)

For **server route handlers** (`api/*.js`): calls the handler function
directly with a constructed `req`/`res` and a fake storage driver
(`setDriver` from `lib/server/storage.js`) — no real HTTP server, no browser.

This layer exists because handler logic (method routing, auth ordering,
error-shape wiring, storage calls) was previously provable only by paying for
a full Playwright browser cycle. It's still fast (runs in the same `npm test`
pass as the unit suite) but proves a different thing: that the handler wires
`http.js`/`respond.js`/`storage.js`/`validate.js` together correctly, not
just that each piece works in isolation.

**When to add one here:** you added or changed an `api/*.js` handler's
routing, auth check, or error handling. If the e2e suite would need a full
sign-in + browser round trip to exercise a code path that a constructed
`req`/`res` object could exercise in a millisecond, it belongs here instead.

### 3. E2E (`tests/e2e/*.spec.mjs`, Playwright)

For **real user journeys and cross-module wiring** that only exist once a
browser, real DOM events, and the actual save/sync round trip are involved:
sign-in, drag/resize/touch gestures, keyboard navigation, conflict
resolution, offline/reconnect, accessibility scans, responsive layout.

E2E is the most expensive layer per test (real browser, real timers unless
you control them, real CI minutes) and the most prone to flakiness. Spend it
on things the other two layers structurally cannot prove: that a mouse drag
actually dispatches the right DOM events, that a real Tab key reaches the
right element, that CSS actually renders without clipping at a given
viewport.

**When to add one here:** ask first whether a unit or integration test could
prove the same regression. If yes, it doesn't need an e2e test too — see
"No new e2e test for a case already provable elsewhere" below.

### 4. Visual regression (`tests/e2e/visual.spec.mjs`, opt-in via `VISUAL=1`)

For a **curated set of screens that matter to look right**, compared against
recorded screenshots. Not run in default CI (screenshots are only comparable
against a baseline recorded on the same browser build/OS/fonts, and this
project doesn't pin a stable image for that). Run and reviewed by hand before
a release or a significant visual change.

**When to add a scene here:** a new screen that has a corresponding mockup in
`docs/mockups`, or a screen where visual drift (not logic drift — the layout
tests already cover logic) would be easy to miss in code review. Don't add a
scene just because a screen exists — every scene is a baseline image someone
has to re-record whenever a font or browser version moves.

## Decision guide for a new test

```
Does it require a browser (real DOM events, real rendering, real timers you
don't control)?
  NO  → does it hit an api/*.js handler's routing/auth/error wiring?
          YES → tests/unit/api-handlers.test.mjs (constructed req/res)
          NO  → tests/unit/<module>.test.mjs (call the function directly)
  YES → is the thing you're proving already covered by a unit/integration
        test one layer down (the same math, the same policy, just observed
        through a browser instead of a direct call)?
          YES → don't add it; if the wiring itself is unproven, add ONE
                e2e test proving the wiring, not the math
          NO  → tests/e2e/<area>.spec.mjs
```

## Anti-patterns (found and fixed in this suite — don't reintroduce them)

**Don't re-derive math in e2e that a unit test already proves.** Card
positioning, drag/resize deltas, tick spacing are exact pixel math owned by
`layout.test.mjs`/`operations.test.mjs`. E2E tests for these should confirm
*wiring* (the card moved in the right direction, by roughly the right
amount, and nothing else shifted) with a loose tolerance, not re-assert
sub-pixel exactness — that duplicates confidence and makes the suite brittle
to unrelated CSS changes. See `timeline.spec.mjs`'s `GEOMETRY_TOLERANCE` and
`gestures.spec.mjs`'s range-based drag assertions for the pattern to follow.

**Don't prove a timing/backoff policy with real wall-clock waits when a
fake-clock unit test already proves it.** `save.test.mjs` proves the offline
backoff sequence deterministically in milliseconds with a fake clock. An e2e
test for the same policy using `waitForTimeout(6000-10000)` is both slower
and *less* reliable (real time under CI load races) than the unit test it
duplicates. E2E should assert the user-visible *state* (shows "Offline",
recovers on reconnect) without re-timing the policy.

**Don't run a spec across every viewport/browser project by default.**
Playwright's `projects` array applies unless a spec opts out. A spec testing
HTTP-level behavior (auth, rate limiting, CSRF, save/versions logic) has no
viewport dependency — running it 4x adds CI time with zero added confidence.
Guard with:

```js
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent');
});
```

Only let a spec run across projects when it's actually testing something
viewport/input-method-dependent (layout, touch gestures, phone-only UI).
When only *some* tests in a file are viewport-dependent, scope at the
`test.skip(...)` call inside those specific tests/describe blocks instead of
the whole file — see `features.spec.mjs` for the mixed pattern.

**Don't add an e2e test for something a unit test already fully covers just
because "it also happens in the browser."** The `config.test.mjs` stage/
phase color mapping test is the canonical unit-level proof; an e2e test
re-checking the same data via computed DOM styles added no new regression
protection. If you're tempted to add this kind of test, first check whether
it's proving new wiring or just re-observing already-proven data through a
more expensive lens.

**Don't let stale docs become the implicit spec a future test-writer trusts.**
`docs/TECHNICAL_SPEC.md` described a `gapBefore`/`lockedStart` scheduling
design that was never implemented — a future contributor reading the spec
first and the code second could easily have written tests against fields
that don't exist. **The code is the source of truth for behavior; when a
spec doc and the implementation disagree, fix the doc, not the tests.**

## Device & browser matrix

- **`desktop-chrome`** is the default project. Any spec without an explicit
  reason to run elsewhere runs here only.
- **`iphone-13` / `pixel-7`** run specs that are genuinely
  viewport/touch-dependent: responsive layout, day-of mode, touch gestures,
  phone-only UI variants.
- **Both phone projects are tall** (915 px and 844 px). A defect that only
  shows when the sheet is shorter than the form it holds is invisible at those
  heights and plain on a real phone with browser chrome showing — that is how
  the stage-chip sheet scroll shipped four times. A test for one shrinks the
  viewport height itself (`interactions.spec.mjs`'s `shortPhone`) rather than
  trusting the project's default.
- **WebKit** is installed for real in CI (`playwright install --with-deps
  chromium webkit`) — the config's fallback to Chromium-with-device-emulation
  only applies to local sandboxes that can't download WebKit. Don't assume
  local dev runs are exercising real WebKit; CI is where that coverage is
  real.
- **Firefox** is not configured. Add it only if there's an actual reported
  Firefox-specific issue or known user base — don't add browser coverage
  preemptively.
- For a *responsive breakpoint* check (not a full functional re-run), prefer
  one test that loops a list of viewport widths in-process (see
  `a11y.spec.mjs`'s `[320,390,430,740,1024,1440]` loop) over re-running whole
  specs per Playwright project.

## Checklist for a PR adding or changing behavior

- [ ] Is there a unit test for the new/changed pure logic? If the change is
      in `operations.js`, `schedule.js`, `layout.js`, `state.js`,
      `validate.js`, or an `actions.js` wrapper, there should be.
- [ ] If the change is in an `api/*.js` handler, does `api-handlers.test.mjs`
      cover the new routing/auth/error path?
- [ ] Does the e2e addition (if any) prove something a unit/integration test
      *cannot* — real DOM events, real rendering, a real cross-module round
      trip? If not, cut it or move it down a layer.
- [ ] If it's viewport-dependent, does it need to run on more than
      `desktop-chrome`? If not, don't add the project fan-out.
- [ ] Does it use a fake clock/fake driver instead of a real wait wherever
      timing matters?
- [ ] Does `npm run lint && npm run check && npm test` pass locally?
- [ ] If you touched `docs/TECHNICAL_SPEC.md`, does it still match the code
      you just changed? (Verify by reading the implementation, not by
      assuming the doc was right before your change.)

## Known backlog (not yet implemented — tracked here, not silently dropped)

These were identified during the test architecture review that produced this
document but weren't added because each needs new test infrastructure, not a
quick bolt-on — adding them hastily would itself be the kind of low-value
padding this strategy argues against:

- **Concurrent version-restore vs. concurrent save race** — does a version
  restore mid-autosave-debounce produce a coherent result? Needs a way to
  interleave two async operations deterministically against the fake driver;
  worth adding to `storage.test.mjs` alongside its existing "two concurrent
  saves cannot both win" test once that harness exists.
- **Export while offline / with unsynced local changes** — does export
  reflect last-synced server state or pending local edits? Needs the
  offline-device-copy fixture from `sync.spec.mjs` combined with the export
  flow; currently untested in either state.
- **UI behavior near the 200-activity cap** — the cap's *rejection* is unit
  tested (`validate.test.mjs`); rendering/drag performance near the cap is
  not. Would need a seeded near-cap plan fixture in the e2e layer.
- **Rapid repeated undo beyond buffer depth** — confirm single-level undo
  (per `state.test.mjs`'s "the undo buffer holds one step") is intentional
  product behavior, not an oversight, before deciding whether to test rapid
  clicking past it.
