# Wedding Runbook Planner — Technical Specification

**Status:** Source of truth for architecture and implementation · **Version:** 2.1 · **Date:** 2026-09-16
**Replaces:** `WeddingRunbookPlanner_Technical_Spec.md` (v1)
**Baseline reviewed:** `main` @ `b016c09` · **Working branch:** `redesign`
**Behaviour:** see `FUNCTIONAL_SPEC.md` (wins on behaviour). **Look:** see `DESIGN_GUIDE.md` and mockups.

> **Post-release update (commit `2939550` onward):** the scheduling model in §5 and the data model in §4.1 below describe the *original* redesign as reviewed. A follow-on rewrite replaced propagation/`gapBefore` scheduling with absolute per-activity starts and deliberate group moves; §4.1 and §5 have been updated in place to match. See `IMPLEMENTATION_PLAN.md` and `RELEASE_CHECK.md` for the stage history this superseded.

---

## 1. Constraints

- Stack unchanged: HTML, CSS, vanilla JS (ES modules), Node 20+, Vercel static hosting + Functions, Upstash Redis REST.
- **One vendored runtime dependency:** flatpickr (`public/vendor/flatpickr/`), loaded by `index.html` for date/time pickers — see §8.5. No other runtime dependencies. Allowed dev-only dependency: `@playwright/test`.
- No framework, bundler or build step. Files are served as written.
- Browser support: Safari/iOS 16.4+, last two versions of Chrome, Edge, Firefox.
- Prefer small, explicit modules over abstraction.

---

## 2. Findings from the baseline review (what this spec fixes)

Reproduced on `b016c09` in headless Chromium (1280 px, 740 px, iPhone 13 emulation):

| ID | Finding | Evidence |
|---|---|---|
| F1 | Save retry loop on any failure | `saveNow()` re-runs itself after errors: 881 PUTs and 882 toasts in 3 s offline; header stuck on “Saving…” |
| F2 | One whitespace title makes the plan unsavable | `required` accepts spaces; client trims to `""`; server 400; invalid state retried forever; edits lost on reload |
| F3 | Lost-update race | `storage.js` GETs then SETs; two concurrent writes can both pass the revision check |
| F4 | Timeline displaces cards | `buildTimelineLayout` 68 px minimum height; fixed 4:00 PM Cocktail drawn 11 min late; conflict case 52 min late |
| F5 | Mobile scroll resizes cards | 20 px × full-width resize strip on every card, `touch-action:none`; swipe changed 35 → 5 min |
| F6 | Short cards uneditable on phone | Cards < 30 min hide lock and ⋯; no long-press |
| F7 | Resize edge runs 1.63× the pointer | 8 px per 5 min vs 13 px rendered; CSS transitions on `top/height`; full rebuild per `pointermove` |
| F8 | Server code and seed data publicly downloadable | Confirmed on production: `/lib/server/default-data.js` returns source |
| F9 | No login rate limit | Only a fixed 250 ms delay |
| F10 | 401 during save discards local plan | `state.plan = null` |
| F11 | No request timeouts | Client and Upstash `fetch` can hang indefinitely |
| F12 | “Keep my changes” restores a stale snapshot | Uses `conflict.local` captured when the banner appeared |
| F13 | Version create/restore 409 leaves stale revision | Toast only; fails until reload |
| F14 | Whole-app `innerHTML` render on every change | Focus lost to `BODY`; dialogs re-created; `#app aria-live` re-announces everything; stage menu stays open after selection |
| F15 | Server validation gaps | Status enum, `coupleLabel`, time format (`99:99` accepted), stage allowlist, integer 5-minute durations, unknown fields |
| F16 | `readJson` limits bypassed on Vercel; multi-byte chunk corruption | `req.body` pre-parsed; `raw += chunk` |
| F17 | Zero server logging | No `console.error` in any route |
| F18 | Versions stored inside the plan envelope | Every autosave rewrites up to 40 plan copies |
| F19 | Native validation messages | `step=300` on time inputs, `max=720` on duration |
| F20 | Pending people text dropped on Done | Reproduced |
| F21 | Missing avatar CSS in editor chips | `.person-avatar` has no base style |
| F22 | Breakpoint gap 721–759 px | Mobile rules ≤720, desktop ≥760 |
| F23 | Mobile save state hidden | `display:none` < 760 px |
| F24 | Mobile text and targets too small | 12.5/9.5/8 px text; 34 px targets; 14 px inputs (iOS zoom) |
| F25 | Contrast and focus | Unlocked lock 1.76:1; drag dots 2.62:1; quarter labels 2.87:1; status select and switch have no visible focus |
| F26 | Escape/outside click don't close menus | No handlers; `<details>` menu stays open |
| F27 | Session fetch failure shows login | Network error treated as signed out |
| F28 | Changing `APP_PASSWORD` doesn't revoke sessions | Stateless token without password fingerprint |
| F29 | Regex “UX contract” tests assert rejected designs | e.g. drop placeholder, `offset > 0` |
| F30 | Minor | No-op drag saves; ArrowUp = longer; `aria-selected` on `<article>`; missing `-webkit-backdrop-filter`; landscape safe areas |

---

## 3. Repository layout (target)

```text
WeddingRunbookPlanner/
├── api/                      # Vercel Functions (unchanged names)
│   ├── export.js             # NEW  GET  plan JSON download
│   ├── template.js           # NEW  GET  wedding template activities
│   ├── login.js  logout.js  plan.js  session.js  versions.js
├── lib/server/
│   ├── auth.js  http.js  storage.js  validate.js (NEW)  log.js (NEW)  ratelimit.js (NEW)
│   └── seed-template.js      # template timeline (moved from default-data.js; server-only)
├── public/                   # ONLY static files served to browsers
│   ├── index.html  robots.txt  manifest.webmanifest  icons/
│   ├── styles/ tokens.css  base.css  timeline.css  cards.css  sheets.css  print.css
│   └── src/
│       ├── app.js            # boot, routing between sign-in / load error / planner
│       ├── state.js          # store, actions, undo
│       ├── schedule.js       # pure scheduling
│       ├── layout.js         # pure geometry: positions, lanes, ruler ticks
│       ├── render/ header.js  timeline.js  card.js  toolbar.js  sheets.js  strip.js  toast.js  print.js  pickers.js
│       ├── gestures.js       # select, long-press, resize, drag-to-time, group select/move, autoscroll
│       ├── operations.js     # pure plan operations (resize, moveTo, moveGroup, toggleLock, ...)
│       ├── save.js           # autosave pipeline, device copy, sync
│       ├── dayof.js          # clock, day-of state, strip content
│       ├── api.js  config.js  icons.js  format.js
│   └── vendor/flatpickr/     # vendored date/time picker (the one runtime dependency)
├── scripts/dev-server.mjs    # serves public/ + api/
├── tests/
│   ├── unit/   schedule  layout  save  validate  storage  auth  ratelimit
│   └── e2e/    (Playwright) planner  gestures  dayof  failures  a11y  visual
├── docs/     FUNCTIONAL_SPEC.md  TECHNICAL_SPEC.md  DESIGN_GUIDE.md  IMPLEMENTATION_PLAN.md  mockups/
├── vercel.json  package.json  .env.example  README.md
```

`vercel.json` sets `"outputDirectory": "public"` (no build command). URLs stay `/`, `/src/...`, `/styles/...`. Anything outside `public/` is never served. The file split above is a target; splitting is done only where it reduces size or coupling of `app.js` (currently 1,118 lines).

---

## 4. Data model

### 4.1 Plan (stored)

There is no `dayStart` on the plan — nothing schedules from a single anchor time any more. Every activity carries its own absolute `start`; the day's visible start/end are derived from the activities (`schedule.dayStart`/`dayEnd` in §5), not stored as a setting.

```ts
type Plan = {
  id: string;
  title: string;            // "Wedding Day", 1–80
  coupleLabel: string;      // "Our Wedding", 1–60
  date: string;             // YYYY-MM-DD
  timelineStart?: string | null; // HH:MM, 5-min, view only
  timelineEnd?: string | null;   // HH:MM, 5-min, view only; may be <= timelineStart (= next day)
  sunset?: string | null;        // HH:MM, any minute; null hides marker; default "16:19"
  status: "Draft" | "Working" | "Confirming" | "Final";
  activities: Activity[];   // max 200
};

type Activity = {
  id: string;               // [a-z0-9-]{1,64}
  title: string;            // trimmed, 1–120
  duration: number;         // integer, 5..720, multiple of 5
  stage: StageId;           // allowlist
  location: string;         // 0–140
  people: string[];         // max 30, each 1–80, unique case-insensitively
  notes: string;            // 0–1000
  start: number;            // minutes from the plan date's midnight; absolute, can exceed 1440 for after-midnight activities
  locked: boolean;          // exempts this activity from a group move (moveGroup); not a "flexible vs fixed" flag
};
```

Migration: none required. Missing optional fields default (`sunset` "16:19", view range derived). Unknown fields are dropped on save. There is no `lockedStart`/`gapBefore` any more — an activity's position is always its own `start`, whether `locked` or not.

### 4.2 Storage envelope (Redis)

| Key | Value |
|---|---|
| `wedding-planner:data:v1` | `{ revision, updatedAt, updatedBy, plan }` (versions removed from here) |
| `wedding-planner:versions:v1` | `{ versions: Version[] }` (max 40) |
| `wedding-planner:rl:<ip>` | login attempt counter (TTL 15 min) |

`Version = { id, name, createdAt, auto: boolean, summary: { count, start, end }, plan }`.
Migration: on first read, if the data key still contains `versions`, move them to the versions key (atomic script) and drop the field.

`updatedBy` is a random per-device id (stored on the device) used only to say “another device”.

### 4.3 Stages and phases

| Stage id | Label | Phase |
|---|---|---|
| preparation | Preparation | prep |
| first-look | First look | photo |
| photography | Photography | photo |
| transition | Transition | transit |
| buffer | Buffer | transit |
| ceremony | Ceremony | ceremony |
| celebration | Celebration | cocktail |
| cocktail | Cocktail | cocktail |
| reception | Reception | reception |
| dinner | Dinner | reception |
| party | Party | reception |

Colours per phase are in `DESIGN_GUIDE.md`. Stage ids are unchanged, so stored data stays valid.

---

## 5. Scheduling (`schedule.js`, pure)

There is no propagation and nothing is a chain. Every activity stores its own absolute `start`. Nothing here moves an activity that was not explicitly asked to move — shortening, deleting or moving one activity never pulls its neighbours along. Two activities can occupy the same minutes; `buildSchedule` finds every such pair and reports it as an overlap rather than resolving or hiding it (n-way, not just "one fixed activity vs. the work running into it").

```text
buildSchedule(plan):
  items = activities, each with end = start + duration
  overlaps = every pair of items whose [start,end) ranges intersect, with the exact shared minutes
  openTimes = the gaps between merged occupied blocks (interval-merge of all items)
  dayStart = start of the earliest block; dayEnd = end of the latest block
  summary = { count, start, end, openMinutes, conflictMinutes }
```

Output: `{ items[{id, start, end, overlaps[{withId, withTitle, start, end, minutes}], overlapMinutes}], openTimes[{start, end, beforeId, beforeTitle}], overlaps[{aId, bId, start, end, minutes}], dayStart, dayEnd, summary }`. All times are absolute minutes from the plan date's midnight, and may exceed 1440.

Operations (pure, each returns a new plan — `operations.js`):
- `resizeBottom(plan, id, newEnd)` — end follows the pointer; rejects locked activities; no neighbour is moved.
- `resizeTop(plan, id, newStart)` — start follows the pointer, clamped to `[0, end − 5]`; rejects locked activities; no neighbour is moved or gains stored open time.
- `moveTo(plan, id, newStart)` — sets an activity's absolute start directly (a drag or drop anywhere on the timeline); rejects locked activities.
- `moveGroup(plan, ids, deltaMinutes)` — the one deliberate way several activities move together: shifts every activity in `ids` by the same `deltaMinutes`; a locked activity inside the selection is skipped, not moved.
- `toggleLock(plan, id)` — flips `locked`. `locked` means only "not a participant in a group move"; it does not move the activity or its neighbours, and there is no "unfixing snaps back to follow the previous activity" behaviour.
- `keepAsBuffer(plan, openTime, newId)` — inserts a Buffer activity of exactly that length, spliced before the activity that follows the gap.
- `extendPrevious(plan, openTime)` — stretches the activity right before the open time so it ends where the gap ends.
- `addInOpenTime(plan, openTime, activity)` — inserts a new activity starting at the gap, defaulting to the gap's length.
- `insertAfter(plan, afterId|null, activity)`, `duplicate(plan, id, newId)` (copy starts 1× the original's duration later, unlocked), `remove(plan, id)`, `update(plan, activity)`, `setStage(plan, id, stage)`, `setSettings(plan, changes)`.
- `normalizeDuration(n)` = clamp(round-to-5(n), 5, 720).

No operation returns a `shifted` count — nothing is shifted as a side effect of another change. `moveGroup` returns `movedCount` (how many of the requested ids actually moved, excluding locked ones), used for its own undo label only.

---

## 6. Layout (`layout.js`, pure)

- `PX_PER_MIN = 4` (20 px per 5 min). Exported constant.
- `range(plan, schedule)`: `from = floor5(min(timelineStart, firstStart))`, `to = ceil5(max(timelineEnd(next-day aware), dayEnd))`. Defaults when unset: `from = firstStart − 30`, `to = dayEnd + 30`.
- `y(min) = (min − from) * PX_PER_MIN`. Card box: `top = y(start) + 1`, `height = duration * PX − 2`.
- `ticks(from, to)`: every 5 min with `kind ∈ {hour, half, quarter, five}`; labels only for the first three.
- `lanes(items)`: general interval-graph colouring, not a fixed-vs-overrun split. Activities are walked in start order; each goes into the first lane whose last activity has already ended, opening a new lane otherwise. Mutually-touching activities form a cluster and share that cluster's lane count; activities outside any overlap stay in lane 0 at full width. Lane widths are equal shares of the card width (`100% / totalLanes`, minus a fixed `LANE_GAP_PX` gutter) — there is no 55%/45% asymmetry and no notion of a "fixed" lane.
- `overlapBox(item)`: the exact overlapping sub-range of a card (not its whole height), as a `{top, height}` relative to the card's own top — used to hatch only the minutes that truly collide.
- `density(duration)`: `line` (≤10), `small` (15–25), `standard` (≥30). Controls padding only; which rows show is decided by measurement (§8.3).

Invariant: every box top/bottom equals its time; overlapping activities are drawn overlapping (side by side in their shared lanes), not prevented — "no two full-width boxes intersect" no longer holds by design.

---

## 7. State (`state.js`)

Single store object; changes only through actions:

```js
dispatch(action) -> { prev, next, shifted, label }
```

- Every data action pushes `prev` into a one-slot undo buffer with a label (`"Deleted Toast"`).
- `undo()` restores the buffer (and is itself a data change that saves).
- UI state (selection, open menu, filter, mode, drag/resize preview) lives beside data but is never saved.
- Previews (drag/resize) compute a temporary schedule; data is only changed on commit.

---

## 8. Rendering

### 8.1 Regions
Replace the single `render()` with region renderers: `header`, `strip`, `summary+filters`, `timeline`, `toolbar`, `sheet/dialog`, `toasts`. `update(changes)` calls only the affected ones. Dialogs and sheets are created once per open and never rebuilt by unrelated updates.

### 8.2 Focus
Before a region re-renders, remember the focused element's `data-focus-key`; restore it afterwards. Closing a dialog returns focus to its opener. `#app` has no `aria-live`; toasts use a dedicated `role="status"` region; the strip is `role="status"` with text changed only when the current activity changes.

### 8.3 Fitting (after layout, in one `requestAnimationFrame`)
1. **People row:** show all tags; while `scrollWidth > clientWidth`, hide the last tag and update `+N`.
2. **Card rows:** rows carry `data-drop` priority (people 0, stage 1, location 2, progress 3, time 4). While `body.scrollHeight > body.clientHeight`, hide the lowest remaining priority. Add `.clipped` when anything is hidden (shows dots). Row children are `flex: none` so they cannot shrink instead.
3. Re-run on resize (debounced) and after font load. Hidden details are listed in the toolbar context line.

### 8.4 Print
`@media print` stylesheet plus `render/print.js`, which builds a hidden list layout from the current schedule and filter before calling `window.print()`.

### 8.5 Date/time pickers (`render/pickers.js`)
The one vendored runtime dependency (flatpickr, `public/vendor/flatpickr/`), lazy-loaded on first use rather than pulled from a CDN so the app keeps working with no network beyond the page itself. `initPickers(root, {onChange})` wires every `[data-picker]` input under `root`: `time` (5-minute grid), `date` (calendar only), or `datetime` (an activity's absolute start, which can land on the day after the plan date). `onChange` fires on flatpickr's own change event, not every keystroke. If the script fails to load (offline, nothing cached), the plain input underneath still works.

### 8.6 Back-button / history guard (`app.js`)
On a phone, hardware/gesture back goes to browser history, not the app — left alone it would leave a sheet, menu, or card selection open while navigating away from the whole plan. A single dummy `history.pushState` entry is pushed exactly while any such overlay is open; back then lands on that entry (same URL, no navigation) and the resulting `popstate` is read as "close the top thing" instead. Closing the overlay any other way (Cancel, scrim tap, Escape) consumes the same entry via `history.back()` so the back stack never accumulates dead stops. Because `history.back()`'s `popstate` lands on a later tick while `pushState` is synchronous, the push/pop bookkeeping reacts once on a microtask after a synchronous stretch of store updates finishes, so closing one overlay and immediately opening another (e.g. an open-time sheet handing off to the activity editor) nets out correctly instead of racing.

---

## 9. Gestures (`gestures.js`)

Pointer Events only; one active gesture at a time.

| Gesture | Target | Rules |
|---|---|---|
| Select | card body | `pointerup` without movement > 6 px and no long-press. Ctrl/Cmd-click adds the card to a `groupSelection` (2+ cards) instead of replacing the single selection. |
| Long-press edit | card body (touch) | 500 ms; cancel on move > 10 px, `pointercancel`, or scroll; immediate `.pressed`; suppress following click; not from controls |
| Resize | `.handle.top`, `.handle.bottom` | `touch-action:none` on handles only; pointer capture; visual bar 36×5, hit area 44 px tall × 120 px wide; neither handle rendered for a locked activity |
| Move | card grip (`.card-grip`, always visible on any unlocked, non-view-only card) | pointer capture; dragging sets the card's absolute start via `moveTo` (continuous drag-to-time, not a discrete reorder/index move). With an active `groupSelection`, dragging any selected card's grip moves the whole group together by the same delta via `moveGroup`; locked activities inside the group are skipped. |
| Scroll | everything else | card body `touch-action: pan-y`; never `preventDefault` before a gesture starts |
| Back guard | hardware/gesture back (phone) | see §8.6 — closes the open sheet/menu/selection instead of navigating away |

Performance rules during resize/move:
- Read pointer position in `pointermove`; do all DOM writes in one `requestAnimationFrame`.
- Pointer delta maps to minutes with `PX_PER_MIN` (1:1 with rendered geometry), snapped to 5.
- Schedule preview recomputed at most once per frame, only when the snapped value changes.
- No CSS transitions on the active card. Nothing else moves automatically during a single-card resize/move; during a group move, the other selected cards animate `transform` (not `top`) 180 ms.
- Esc / `pointercancel` restores the pre-gesture snapshot exactly.

Input capability, not width, decides hover behaviour: `@media (hover:hover) and (pointer:fine)` shows hover handles and inline controls; otherwise the selection model applies (iPad included).

---

## 10. Saving (`save.js`)

```text
change → markDirty(seq++) → debounce 650 ms → flush()
flush(): if inFlight: return (flush again after)
         PUT /api/plan {plan, revision, deviceId}  (timeout 15 s)
  200 → revision = res.revision; savedSeq = sentSeq; state Saved; clear device draft if clean
  409 → conflict dialog (current local plan, not a snapshot)
  401 → keep plan + draft; show sign-in; after login: GET, then save or conflict
  400/413/422 → state Not saved; toast reason; no auto-retry until next change or manual retry
  offline / network / 5xx / timeout → state Offline or Not saved; retry after 2,4,8,16,30 s; also on 'online'
```

- Only one request in flight. Successful save re-flushes if more changes arrived.
- One error toast per failure episode.
- **Device copy** (`localStorage`, key `wrp:v1:<planId>`): `{ plan, revision, dirty, savedAt }`, written after each local change and each successful load. Used as a read-only fallback when loading fails offline. Kept through a 401 so unsaved edits survive re-sign-in. Cleared only on explicit sign-out.
- `pagehide` / `visibilitychange:hidden`: if dirty, send with `fetch(..., {keepalive:true})`.
- `visibilitychange:visible` and a 60 s idle poll: `GET /api/plan?since=<revision>` (304-style `{unchanged:true}`); load newer plan only if not dirty.
- Conflict choice: the side not chosen is saved as an automatic version (`auto:true`, name `Other device – <time>` or `My unsaved changes – <time>`).

---

## 11. API

All responses `Cache-Control: no-store`, JSON, `{ error: { code, message, field? } }` on failure.

| Method & path | Auth | Body / query | Success |
|---|---|---|---|
| `GET /api/session` | – | – | `{ authenticated }`; network errors must not be treated as signed out by the client |
| `POST /api/login` | – | `{ password }` | sets cookie; 429 after 10 failures / 15 min per IP |
| `POST /api/logout` | – | – | clears cookie |
| `GET /api/plan` | ✓ | `?since=<rev>` optional | `{ plan, revision, updatedAt, updatedBy }` or `{ unchanged:true }` |
| `PUT /api/plan` | ✓ same-origin | `{ plan, revision, deviceId }` | `{ revision, updatedAt }`; 409 `{ latest }` |
| `GET /api/versions` | ✓ | – | `{ versions: [{id,name,createdAt,auto,summary}] }` (no plan bodies) |
| `POST /api/versions` | ✓ same-origin | `{ name }` or `{ auto:true, name, plan }` | `{ version }` |
| `PUT /api/versions` | ✓ same-origin | `{ id, revision }` restore | auto-snapshots current, then restores; `{ plan, revision }` |
| `DELETE /api/versions?id=` | ✓ same-origin | – | `204` |
| `GET /api/template` | ✓ | – | `{ activities }` |
| `GET /api/export` | ✓ | – | `Content-Disposition: attachment` plan JSON |

### 11.1 Validation (`validate.js`)
Shared rules from §4.1, applied on every write; returns the first failing field. Client uses the same module (served copy in `public/src/validate.js`, kept identical by a unit test).

### 11.2 Request handling (`http.js`)
- If `req.body` is already an object, measure `JSON.stringify(req.body)` against the limit (256 KB).
- Otherwise collect `Buffer` chunks and decode once.
- Same-origin check: `Origin` must match host for mutating requests; missing `Origin` rejected for mutating requests.

---

## 12. Storage (`storage.js`)

- **Atomic save:** Upstash `EVAL` Lua script: read envelope, compare revision, write new envelope with `revision+1`, return result — one round trip. Same pattern for version restore (snapshot + restore in one script).
- **Seeding:** `SET NX` with the template plan on first read.
- **Timeouts:** every Upstash call has a 5 s `AbortController` timeout; one retry for idempotent reads.
- **File driver** (local dev): unchanged behaviour, same function signatures, serialized writes.
- Production without Upstash credentials fails closed with a clear error (never falls back to file storage).

---

## 13. Auth and security

- Password check: timing-safe compare (unchanged).
- Session token: HMAC-SHA256 over `{ iat, exp, pv }` where `pv` = first 16 hex chars of `HMAC(SESSION_SECRET, APP_PASSWORD)`. Changing the password invalidates all sessions.
- Cookie: HttpOnly, Secure (prod), SameSite=Strict, 30 days.
- Rate limit (`ratelimit.js`): Upstash `INCR` + `EXPIRE 900` per IP (`x-forwarded-for` first entry) and a global ceiling (100 / 15 min). Local file mode: in-memory.
- Headers (`vercel.json`): CSP `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `Permissions-Policy`, `X-Robots-Tag: noindex`.
- **Only `public/` is served** (F8). Seed/template data lives in `lib/server/seed-template.js`.
- Repo visibility: return to **private** once Claude Code has access (contains the template timeline).
- Device copy contains the plan in `localStorage`; acceptable per decision D20; cleared on sign-out.

---

## 14. Logging and observability

`log.js`: `log.error(route, code, err, extra)` writes one JSON line (`level, route, code, message, revision`) to `console.error`. Never logs plan content, passwords, cookies or IPs in full (IP hashed). Log: storage failures, 5xx, validation rejections (field only), rate-limit hits, 409s (count only).

---

## 15. Environment

| Variable | Production | Preview | Local |
|---|---|---|---|
| `APP_PASSWORD` | required | required (different) | required |
| `SESSION_SECRET` (≥32 chars) | required | required (different) | required |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_*`) | production DB | **separate** preview DB (confirmed) | unset → file storage |
| `LOCAL_DATA_FILE` | – | – | optional |

Preview and production databases are already separate.

---

## 16. PWA / metadata

`manifest.webmanifest` (name “Our Wedding”, `display: standalone`, theme colour `#F7F7F4`), 180 px apple-touch-icon, 192/512 px icons, `apple-mobile-web-app-capable`. No service worker is required: offline reading uses the device copy when the page itself is still open or cached by the browser. (A minimal service worker that caches `public/` files may be added in stage 7 if offline cold-start proves necessary on device; it must never cache `/api/*`.)

---

## 17. Testing

### 17.1 Unit (`node --test`)
- schedule: overlap detection, open-time gaps, midnight rollover, every operation.
- layout: exact positions, range with next-day end, ticks hierarchy, lanes non-overlap.
- validate: every field boundary; client/server copies identical.
- save: debounce, single-flight, backoff sequence, no retry on 4xx, 401 keeps plan, 409 uses current plan, device copy lifecycle (fake timers + fake fetch).
- storage: atomic script behaviour (fake driver), migration of versions, seed NX, timeouts.
- auth: tamper, expiry, password change revokes. ratelimit: counts, window, 429.

### 17.2 End-to-end (Playwright; local dev server with file storage and a test password)
Projects: Desktop Chrome 1280, iPhone 13 (WebKit), Pixel 7 (Chromium), iPad (WebKit, touch). Covers every acceptance criterion in `FUNCTIONAL_SPEC.md` §9 and the QA list §10. Touch gestures use `page.touchscreen`/CDP touch events. Fault injection via `page.route` (500, 400, 401, 409, delay 20 s) and `context.setOffline`. Clock control for day-of via `page.clock`.

### 17.3 Visual
Screenshot comparisons (Playwright `toHaveScreenshot`, 1 % threshold) for the mockup scenarios on phone and desktop, light and dark. Baselines are reviewed against the mockups before being accepted.

### 17.4 Accessibility
Automated checks with an injected axe-core script (dev-only file, not a dependency) for contrast, labels and roles; manual keyboard and VoiceOver passes per stage checklist.

### 17.5 CI
`npm test` runs unit tests; `npm run test:e2e` runs Playwright. Both must pass before a stage is merged. (GitHub Actions workflow added in stage 2.)

---

## 18. Deployment

- Work on `redesign`; Vercel builds a preview for every push (separate DB).
- Each stage: push → preview → automated tests green → user checks on phone → merge to `main` → production deploy → production smoke check (sign in, load, edit, refresh, version list) done by the user.
- `vercel.json` keeps Git deployment enabled.
- Rollback: redeploy the previous production deployment in Vercel; data format stays backward-compatible (only additive fields).
