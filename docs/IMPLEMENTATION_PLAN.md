# Wedding Runbook Planner — Implementation Plan

**Status:** Historical record — stages 0–10 below shipped as written and are closed. **Version:** 1.0 · **Date:** 2026-09-16
**Executor:** Claude Code, committing to branch `redesign` in `icebruce/WeddingRunbookPlanner`
**Inputs:** `FUNCTIONAL_SPEC.md` (behaviour), `TECHNICAL_SPEC.md` (how; finding IDs F1–F30), `DESIGN_GUIDE.md` (look), `docs/mockups/` (visual reference)

> **Superseded by a later rewrite.** After Stage 10 closed (see `RELEASE_CHECK.md`), commit `2939550` replaced the Flexible/Fixed scheduling model this plan was built around with independent, absolute activity starts and deliberate group moves, and later commits added mobile/back-button fixes on top of it. This document is not wrong about what it describes — it correctly records what stages 0–10 built — but it no longer describes the current app. `FUNCTIONAL_SPEC.md` and `TECHNICAL_SPEC.md` carry the current behaviour and architecture; read those first.

---

## 1. Working rules

1. **Branch:** all work on `redesign`. Each stage ends with a merge to `main` only after the owner approves the stage on the preview.
2. **Gate:** a stage is finished only when every item in its *Done when* list is true and `npm test` + `npm run test:e2e` pass. Do not start the next stage before that.
3. **Commits:** small, one logical change each, message `stage N: <what>`. Tests for a change go in the same commit or the one before it.
4. **Tests first for fixes:** for every finding (F#), write a failing test that reproduces it, then fix.
5. **No scope drift:** anything not in the specs is raised to the owner before building. Obvious small defects found along the way are fixed and listed in the stage report.
6. **Stage report:** at the end of each stage, post a short note (readable on a phone): what changed, test results, preview link, a 3–6 item phone checklist for the owner, known issues.
7. **Stop and ask** when: a spec is ambiguous, a change needs a new dependency, data format would change incompatibly, or a test cannot be made reliable.
8. **Preview data** is a separate database (confirmed). Never point tests or previews at production.
9. Keep the app working at the end of every commit (no long-lived broken states).

---

## 2. Stages overview

| # | Stage | Goal | Main findings / decisions |
|---|---|---|---|
| 0 | Setup | Docs, tooling, test harness | F29 |
| 1 | Safety | No data loss, no exposure, no floods | F1–F3, F8–F13, F15–F17, F28, F27 |
| 2 | Foundations | State/actions, region rendering, tokens, focus | F14, F19–F21, F26 |
| 3 | Time-true timeline | Ruler, exact geometry, card layout and fitting, conflict columns | F4, D8–D10, D25 |
| 4 | Direct manipulation | Selection model, toolbar, long-press, resize (top/bottom), reorder | F5–F7, D2, D5, D23 |
| 5 | Editing flows | Edit sheet/dialog, stage, fix/unfix, open time, add/duplicate/delete, undo | D3, D6, D7, D15 |
| 6 | Sync and resilience | Device copy, offline, conflict dialog, refresh, versions | F18, D19, D20 |
| 7 | Day-of | Mode, live strip, time line, view-only editing | D1, D13 |
| 8 | Remaining features | Summary, filter, sunset, print, export, suggestions, notes glyph, empty/template, settings, menu, PWA | D11, D12, D16–D18, D24 |
| 9 | Visual polish | Mobile type and targets, dark switch, accessibility, breakpoints | F22–F25, F30, D14, D21 |
| 10 | Release | Full regression, production verification, cleanup | — |

Dependencies: 1 → 2 → 3 → 4 → 5; 6 needs 2 (and 5 for undo interplay); 7 needs 3–5; 8 needs 3 and 5; 9 runs last over everything; 10 closes.

---

## 3. Stages

### Stage 0 — Setup
**Scope**
- Add `docs/` (four documents + `docs/mockups/mobile.html`, `docs/mockups/desktop.html`); remove the two old spec files.
- Add `@playwright/test` (dev only), `npm run test:e2e`, Playwright config with projects: Desktop Chrome 1280, iPhone 13 (WebKit), Pixel 7, iPad (touch).
- E2E harness: start dev server with file storage, test password, fresh data file per test; helpers for sign-in, seeding a plan, touch swipes, fault injection, clock control.
- Replace regex UX-contract tests with a placeholder e2e smoke test (sign in, see plan).
- GitHub Actions workflow running unit + e2e on push to `redesign`.
- README: run, test, deploy.
**Done when** CI is green on `redesign`; smoke test passes on all four projects.

### Stage 1 — Safety (before any UI work)
**Scope**
1. **Serve only public files** (F8): move static files to `public/`, `outputDirectory: "public"`, move seed data to `lib/server/seed-template.js`, update dev server. Keep all URLs the same.
2. **Save pipeline** (F1, F10, F11, F12, F13): single-flight, 15 s timeout, backoff 2→30 s, retry on `online`, no retry on 4xx, one toast per episode, 401 keeps plan, 409 uses current local plan, version 409 refreshes revision; header states `Saved / Saving… / Offline / Not saved` (retry on tap).
3. **Validation** (F2, F15, F19 server side): shared `validate.js` used by client and server; client trims and blocks invalid input with inline messages; `novalidate` on forms; server returns field errors.
4. **Atomic storage** (F3): Lua check-and-set; `SET NX` seeding; Upstash timeouts; fail closed without credentials.
5. **Request handling** (F16): pre-parsed body size check, Buffer-safe reading, missing `Origin` rejected on writes.
6. **Login rate limit** (F9) and **password-bound sessions** (F28).
7. **Logging** (F17).
8. **Session check** (F27): network failure shows a load error with Retry, not sign-in.
**Tests** unit: save pipeline (fake fetch/timers), validate, storage script, rate limit, auth revocation. e2e: offline edit → ≤3 requests in 10 s and one toast; 500 → `Not saved`, backoff; 400 → no loop, later valid edit saves; 401 mid-edit → sign in → edit saved; parallel saves from two contexts → exactly one wins, other gets conflict; whitespace title blocked inline; `/lib/server/*`, `/tests/*`, `/package.json` return 404 on preview.
**Owner check** Open `/lib/server/default-data.js` on the preview (404); turn on airplane mode, edit, turn off (saves); wrong password 11 times (blocked).
**Done when** all above pass on preview. Merge to `main` promptly — this stage closes the data exposure. After merge: owner sets the repo back to private.

### Stage 2 — Foundations
**Scope**
- `state.js` store with actions, one-slot undo buffer, UI state separate from data (no UI yet for undo).
- Region renderers (header, strip placeholder, summary/filters, timeline, toolbar placeholder, sheets, toasts); no full-app `innerHTML` on updates (F14).
- Focus preservation and return; remove `aria-live` from `#app`; toast status region.
- Menu/popover handling: Escape and outside click close all menus (F26); set menu state before data updates (stage menu bug).
- `tokens.css` with light and dark variables (dark not yet switchable); split CSS into the files in the technical spec; remove dead CSS (F21 `.person-avatar`, `.people-more`).
- Editor: pending people text added on Done (F20); duration and time inputs use custom rounding (F19).
**Tests** e2e: focus stays on lock button after toggling; stage menu closes after pick; Escape closes each menu; open dialog survives a background save; typed-but-not-added person is saved; `14:47` fixed time rounds to 2:50 without browser message.
**Done when** existing behaviour is unchanged visually except the fixes; tests pass.

### Stage 3 — Time-true timeline
**Scope**
- `layout.js`: 4 px/min, range (with next-day end), ticks, lanes; `schedule.js`: `gapBefore`, operations list from the technical spec (logic only).
- Ruler: 5-minute lines, hierarchy, labels at 15/30/60, spine, end marker.
- Card: row order title → time → warning → progress → location → stage → people; stage bar inset and scaling; one-line cards ≤10 min; fitting (drop order, `+N` tags, dots); desktop card grid and <30 min variant.
- Open time blocks (display only, thin variant).
- Conflict columns with hatching, ruler bar and messages.
- Remove `buildTimelineLayout` displacement and the drop placeholder.
**Tests** unit: layout positions, ranges, lanes, ticks. e2e/visual: every card edge within 1 px of its line at 390 and 1280 px; no overlaps in dense, 5-minute, conflict and midnight plans; rows drop in order at 45/30/25/20/15/10/5 min; dots only when clipped; `+N` correct; conflict messages; screenshots match mockups (planning A, conflict E, desktop DA/DD).
**Owner check** Seed plan on phone: Cocktail Hour sits exactly at 4:00; short cards readable; conflict looks like the mockup.
**Done when** visual baselines approved by owner.

### Stage 4 — Direct manipulation
**Scope**
- Phone selection model: tap select, outside deselect, selected ring, reorder handle, handles (top only if flexible), toolbar shell with context and hidden-details line (buttons wired in stage 5), + button hidden while selected.
- Long-press to edit (opens existing editor until stage 5).
- `touch-action: pan-y` on cards; handles and reorder handle only take touch.
- Resize bottom and top: pointer capture, rAF, 1:1 mapping, snap line and label, bubble, live preview of later activities, Esc/cancel restore, `gapBefore` creation/consumption, stop at previous activity.
- Reorder: grip (mouse) / 150 ms hold (touch), lifted card, slot with landing time, hysteresis, neighbours animate via transform, autoscroll, Esc restore, no-op drop ignored, fixed cards not draggable, Alt+↑/↓.
- Desktop hover handles and controls via `(hover:hover) and (pointer:fine)`.
**Tests** e2e (touch projects): swipe from top, middle, bottom, handles-unselected areas of a card scrolls and changes nothing; long-press opens editor; scroll cancels long-press; top handle absent on fixed; 80 px drag moves edge 80 ± 1 px; top resize creates 10 min open time and moving an earlier activity keeps it; drag up consumes it and stops at previous end; reorder first↔last, around fixed, cancel; autoscroll; preview order equals result. Desktop: hover handles, keyboard resize and reorder.
**Owner check** On the phone: scroll the whole day freely; select a card, resize both edges, reorder one activity.
**Done when** no gesture test is flaky over 3 consecutive runs.

### Stage 5 — Editing flows
**Scope**
- Edit sheet (phone) / dialog (desktop) per spec order, Timing block (Flexible/Fixed), inline validation, discard prompt, delete inside editor.
- Toolbar buttons: Edit, Lock/Unlock, Stage (list sheet / desktop menu), Duplicate, Delete.
- Fix/unfix semantics and shift toast; solid dark lock.
- Open-time actions sheet/menu (Keep as buffer → Buffer activity; Extend previous; Add here).
- Add after selected; duplicate after original.
- Delete without confirm; Undo toast (6 s) and ⌘/Ctrl+Z for all listed actions; toast policy (only undo, shifts, errors).
**Tests** unit: every schedule operation. e2e: each action + undo restores exact prior plan; unfix shift toast text; open-time actions produce expected schedule; add after selected; no success toasts appear.
**Owner check** Delete and undo; turn open time into a buffer; fix and unfix Ceremony.

### Stage 6 — Sync and resilience
**Scope**
- Device copy in `localStorage` (write on change/load; read-only fallback offline; clear on sign-out).
- Offline pinned bar; `pagehide` keepalive flush; resend dirty copy on next open.
- Conflict dialog (Use the other version / Keep my changes) with automatic version of the unchosen side.
- Refresh on foreground and 60 s idle poll (`since` parameter).
- Versions moved to their own key with migration; list without bodies; summaries; current marker; delete (swipe / ⋯) with undo; restore auto-snapshot; auto-version pruning.
- Export endpoint and menu item (menu itself in stage 8; temporary entry acceptable).
**Tests** e2e: offline edit → reload offline shows plan read-only with edits kept → reconnect saves; close tab mid-debounce then reopen → change present; two contexts edit → dialog → both choices keep the other side as a version; background tab picks up remote change; version save/restore/delete; migration from old envelope (unit).
**Owner check** Two phones: edit on both, resolve the dialog; airplane mode reload.

### Stage 7 — Day-of
**Scope**
- `dayof.js`: clock (30 s tick), automatic on date / Final, manual switch memory per device per day, 5-minute auto-return to view only.
- View-only mode (phone and desktop) with Edit / Done and amber Editing label.
- Live strip (phone two-line, desktop one-line), all strip states, progress line, pulse, status announcements only on change.
- Time line and pill behind cards; current card outline, Now tag, progress; past cards faded; initial scroll to now.
**Tests** e2e with fixed clock: before first, during, open time, conflict, after last, past midnight; Final on another context turns day-of on after refresh; view-only blocks every mutation (gesture and keyboard); Done and 5-minute return; reduced motion stops pulse.
**Owner check** Rehearse with the menu switch; set status Final on one device and view on another.

### Stage 8 — Remaining features
**Scope**
- Summary line with actionable links (scroll + highlight).
- Person filter chips, fading, pinned row, exact match.
- Collapsed title in top bar on scroll.
- Sunset marker and setting (default 4:19 PM).
- Plan settings: first start, view range (next-day aware), sunset, theme switch (wired in stage 9).
- Menu contents and order; status in phone menu, desktop top bar.
- Print layout (filter-aware) and Print menu item.
- Location and people suggestions (`datalist`).
- Notes glyph.
- Empty state and wedding template endpoint.
- Manifest, icons, apple meta tags.
**Tests** e2e for each; print via `page.emulateMedia({media:'print'})` screenshot; template load + undo; settings validation (end after midnight accepted; invalid rejected inline); view range never moves activities.
**Owner check** Filter to Photographer and print to PDF; add to home screen.

### Stage 9 — Visual polish and accessibility
**Scope**
- Phone type scale and 16 px inputs (F24); 44 px targets; save state visible on phone (F23).
- Single 720 px breakpoint (F22); capability-based interaction verified on iPad; 320 px and landscape layouts; safe areas; `-webkit-backdrop-filter` (F30).
- Dark appearance switch (menu + settings, device-stored, light default) and full dark pass.
- Contrast and focus fixes (F25); card accessible names; icon labels; reduced motion everywhere; keyboard resize direction (F30); remove invalid ARIA.
- Motion per design guide (commit-only).
- Compare every screen with the mockups and fix differences.
**Tests** automated contrast/labels scan on all screens in both themes; visual baselines for all mockup scenarios (phone + desktop, light + dark); keyboard-only journey; widths 320/390/430/740/1024/1440; landscape.
**Owner check** Full walk-through on phone in light and dark; VoiceOver quick check.

### Stage 10 — Release
**Scope**
- Full regression: all unit, e2e, visual; the 30 QA scenarios in the functional spec.
- Cross-check each acceptance criterion and each decision (D1–D25) and finding (F1–F30) against the code; list any gap.
- Remove dead code and temporary entries; update README and docs if implementation required changes.
- Merge to `main`; owner performs production smoke check: sign in, load, edit, refresh, second device, version list, day-of rehearsal, print.
- Confirm production data intact (activity count and last-edited time unchanged except intended edits).
**Done when** owner signs off.

---

## 4. Traceability

| Item | Stage |
|---|---|
| F1–F3, F8–F13, F15–F17, F27, F28 | 1 |
| F14, F19, F20, F21, F26 | 2 |
| F4, F29 (replaced tests) | 3 (and 0) |
| F5, F6, F7 | 4 |
| F18 | 6 |
| F22–F25, F30 | 9 |
| D1, D13 | 7 |
| D2, D5, D23 | 4 |
| D3, D6, D7, D15 | 5 |
| D4, D8, D9, D10, D25 | 3 |
| D11, D12, D16, D17, D18, D24 | 8 |
| D14, D21 | 9 |
| D19, D20 | 6 |
| D22 | 1 |

---

## 5. Risks to watch

| Risk | Mitigation |
|---|---|
| Touch gesture tests flaky in emulation | Use CDP touch events with explicit timing; retry once in CI; owner device check each stage |
| iOS Safari differences (keyboard, `dvh`, pointer events) | WebKit project in Playwright plus owner checks on a real iPhone |
| Moving files to `public/` breaks paths | Keep identical URLs; e2e smoke on preview before merge |
| Lua script errors on Upstash | Unit-test against a fake; one preview test against the preview database |
| Fitting logic causes layout jank | Run once per frame after layout; debounce on resize |
| Existing production plan incompatible | Only additive fields; migration for versions tested on a copy of the production envelope shape |
| Day-of logic around midnight/timezone | Device clock only; explicit tests at 23:59, 00:00, 01:15 |
