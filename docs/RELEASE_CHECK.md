# Release check

Stage 10 of `IMPLEMENTATION_PLAN.md`: every acceptance criterion, decision and
finding checked against the code, and every gap named.

Run at the end of the redesign, against branch `claude/tender-ptolemy-auoyoi`.

## Regression

| Suite | Result |
|---|---|
| `npm run check` | clean |
| `npm test` (unit) | 179 passed |
| `npm run test:e2e` (desktop-chrome, iphone-13, pixel-7, ipad) | 786 passed, 0 failed |
| `VISUAL=1 npx playwright test visual` | 64 passed, stable over three runs |
| CI (Chromium **and** WebKit), commit `f915b56` | green |

WebKit could not be downloaded in the development environment, so the
`iphone-13` and `ipad` projects ran on Chromium with the iOS device
descriptors. CI installs WebKit and runs them on the real engine.

**That difference is not cosmetic.** Three defects passed every local run and
failed on CI, and all three were real rather than engine quirks:

- The People field in the editor had no stylesheet at all — raw form controls,
  whose colours are whatever the browser chooses. Chromium's dark defaults
  happened to clear the contrast floor and Safari's did not, at 1.82:1.
- Export navigated to `/api/export` rather than downloading it. Safari does not
  treat that as a download; and had it not been one, the app would have been
  unloaded.
- The conflict test held a save open for a fixed time and typed again after a
  shorter one. How long a rename takes is a property of the engine.

A green run on the fallback engine is not WebKit coverage, and the config says
so on every run. Read CI before calling a change done.

## Decisions

Every decision is named in the test that holds it, so this table can be
rebuilt by grep rather than by reading.

| # | Where it is held |
|---|---|
| D1 | `unit/dayof.test.mjs`, `e2e/dayof.spec.mjs` |
| D2 | `e2e/gestures.spec.mjs` (with F6) |
| D3 | `e2e/editing.spec.mjs` |
| D4 | `e2e/features.spec.mjs`, `unit/config.test.mjs` |
| D5 | `unit/operations.test.mjs`, `e2e/gestures.spec.mjs` |
| D6 | `unit/operations.test.mjs` |
| D7 | `e2e/editing.spec.mjs` |
| D8 | `e2e/timeline.spec.mjs`, `unit/layout.test.mjs` |
| D9 | `e2e/timeline.spec.mjs` |
| D10 | `e2e/timeline.spec.mjs` |
| D11 | `e2e/timeline.spec.mjs` |
| D12 | `e2e/features.spec.mjs` |
| D13 | `e2e/dayof.spec.mjs` |
| D14 | `e2e/a11y.spec.mjs` (with F24) |
| D15 | `unit/operations.test.mjs` |
| D16 | `e2e/features.spec.mjs` |
| D17 | `e2e/timeline.spec.mjs` |
| D18 | `e2e/features.spec.mjs` |
| D19 | `unit/storage.test.mjs`, `e2e/sync.spec.mjs` |
| D20 | `e2e/sync.spec.mjs` |
| D21 | `e2e/features.spec.mjs` |
| D22 | `unit/auth.test.mjs`, `e2e/security.spec.mjs` (with F28) |
| D23 | `e2e/gestures.spec.mjs` |
| D24 | `e2e/features.spec.mjs` |
| D25 | `e2e/timeline.spec.mjs` |

## Findings

F1–F28 and F30 each have a test named for them. The one that does not is F29,
and it cannot have one:

> **F29** — "Regex 'UX contract' tests assert rejected designs."
>
> The finding is about the old test suite, not about the app: tests that read
> the source as text and asserted the presence of designs the redesign
> rejected. The answer was to delete them, and what replaces them is a suite
> that drives the app. Two tests read a file rather than the page —
> `unit/config.test.mjs` checks that a phase colour a stage names is actually
> declared in `tokens.css`, and `e2e/security.spec.mjs` checks that
> `vercel.json` still names `public` as the output directory — and both assert
> that a declaration exists, not that a design does.

## Gaps

Two things in the specification are not in the build. Both are deliberate and
both are the owner's to decide.

### 1. On a phone there is no way to add an activity after the selected one

§4.1 of the design guide says selecting a card replaces the `+` with the
toolbar. §5.1 of the functional spec says a new activity is inserted after the
selected card. Together they cancel out: while a card is selected there is no
add control on a phone, so the case §5.1 describes cannot be reached there. The
`+` appends to the end of the day, and Duplicate is the way to put something
next to a particular activity.

Both documents are implemented as written. Resolving it means changing one of
them — a sixth toolbar button, or an "Add after this" row in the card menu.

### 2. There is no service worker

The device copy (D20) is read when the server cannot be reached, which covers
a venue with no signal *while the page is already open*. It does not cover a
cold start: with no network at all, the browser cannot fetch `index.html`, so
there is nothing to run. `e2e/sync.spec.mjs` says this in the test rather than
pretending otherwise.

A service worker would close it. It was not in the plan, and it brings a cache
invalidation problem of its own, so it is named here rather than added.

### 3. A sheet animates in but not out

The design guide's motion table asks for 240 ms in and 200 ms out. Only the way
in is animated: a `<dialog>` leaves the top layer the moment it closes, so
animating the way out means keeping a closed sheet on the page, over the thing
the person has just gone back to, for a fifth of a second. The trade is
recorded in `public/styles/sheets.css`.

## Not done here

- **Merging to `main`** and the production smoke check are the owner's, and the
  plan says the stage is done when the owner signs off.
- **VoiceOver and a real-device walk-through** are owner checks: the automated
  scan covers names, roles, live regions, contrast and sizes, but not how it
  sounds.
