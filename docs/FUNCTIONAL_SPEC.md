# Wedding Runbook Planner — Functional Specification

**Status:** Source of truth for product behaviour · **Version:** 2.0 · **Date:** 2026-09-16
**Replaces:** `WeddingRunbookPlanner_PRD_Functional_Spec.md` (v1, 2026-09-15)
**Companions:** `TECHNICAL_SPEC.md`, `DESIGN_GUIDE.md`, `IMPLEMENTATION_PLAN.md`, mobile and desktop mockups

When this document and the mockups disagree on behaviour, this document wins. When they disagree on look, the mockups and `DESIGN_GUIDE.md` win.

---

## 1. Product

A private, shared, one-day planner for a wedding. It has two jobs:

1. **Plan** the day: build an ordered timeline where most activities follow each other and a few are fixed to a clock time.
2. **Run** the day: on November 21, show what is happening now and next, and prevent accidental edits.

It stays small: one plan, one shared password, no accounts, no guest/vendor/budget management.

### 1.1 Users

| User | Needs |
|---|---|
| The couple (primary) | Build and change the plan on phone and laptop; run it on the day |
| Family, MC, photographer, venue staff (given the password) | Read the plan, filter to their part, print it; occasional edits |

### 1.2 Principles (in priority order when they conflict)

1. **Time truth.** Nothing on screen misstates when something starts or ends.
2. **No lost work.** No edit is silently dropped or overwritten.
3. **Clear direct manipulation.** It is always obvious whether a gesture scrolls, selects, resizes or moves.
4. **Phone first.** Every feature works fully on a phone.
5. **Readable and accessible.**
6. **Quiet, minimal design.**
7. **Density.** Fitting more on screen comes last.

### 1.3 Non-goals

Guest lists, RSVPs, seating, budgets, vendor contracts, chat, calendar sync, maps, native apps, user accounts or roles, videographer workflows, multi-day plans.

### 1.4 Wedding context (seed data, editable, never hard-coded in logic)

Saturday, November 21, 2026 · Ceremony at St. Peter and Paul Orthodox Sobor, 2:45 PM (fixed) · Cocktail at Le Richmond, Griffintown, 4:00 PM (fixed) · Photographer from about midday · Getting-ready location TBD · Sunset about 4:19 PM.

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **Activity** | A block with title, duration, stage, location, people, notes. Start and end are 5-minute multiples. |
| **Flexible** | Starts when the previous activity ends (plus any open time placed before it). Default. |
| **Fixed** | Starts at a set clock time. Never moved by changes elsewhere. Shown with a solid dark lock. |
| **Open time** | Unscheduled time between activities. Either before a fixed activity (automatic) or placed before a flexible activity by resizing its top edge (stored). |
| **Conflict** | Earlier work runs past the start of a fixed activity. The fixed activity stays put; the overlap is shown. |
| **Stage** | Category of an activity. 11 stages grouped into 6 phases; the phase sets the colour. |
| **Plan status** | Draft, Working, Confirming, Final. Final switches on day-of view. |
| **Day-of view** | Read-only running view with a live strip, time line and faded past activities. |

### 2.1 Scheduling rules

- Activities are an ordered list. The first flexible activity starts at **First activity starts** (plan setting).
- Flexible activity: `start = end of previous + stored open time before it`.
- Fixed activity: `start = its fixed time`. If the previous work ends earlier, the difference is open time. If later, it is a conflict.
- Times after midnight belong to the next day when they follow a late activity (e.g. a fixed 1:15 AM after an 11 PM activity).
- Duration: 5 to 720 minutes, always a multiple of 5. Typed values round **up** (42 → 45, 3 → 5). No browser validation messages.
- All typed clock times round up to the next 5 minutes.
- Growing an activity pushes later flexible activities; it does not consume stored open time placed before a later activity, and never moves a fixed activity.
- Shrinking an activity pulls later flexible activities earlier. Open time created before a fixed activity stays as open time until the user decides (§5.9).

---

## 3. Screens and layout

### 3.1 Main screen (phone and desktop)

Top to bottom:

1. **Top bar** (sticky): brand heart + “Our Wedding”, save state, menu. Desktop also shows the status control. When the large title scrolls away, the brand is replaced by “Wedding Day · Sat, Nov 21”.
2. **Live strip** (day-of only, sticky under the top bar).
3. **Pinned filter row** (only while a person filter is on, sticky).
4. **Large title**: day title and full date.
5. **Summary line**: `11:30 AM – 10:45 PM · 12 activities`, then on its own line the actionable items: `35 min open ›` (blue) and `20 min conflict ›` (red) when present. Tapping an actionable item scrolls to the first open time or conflict and highlights it. The rest is plain text.
6. **Person filter chips**: Everyone plus each distinct person or group used in the plan, in first-use order.
7. **Timeline**: time ruler on the left, activities and open time on the right, end-of-day marker.
8. **Add**: floating + button on phones (hidden while a card is selected), “Add activity” button in the desktop header with the note “Adds after the selected activity”.

No sidebar. No persistent footer.

### 3.2 Timeline ruler

- Scale: **20 px per 5 minutes** on every screen size.
- A horizontal line every 5 minutes across the plan area. Strength: hour > half hour > quarter hour > 5 minutes.
- Labels only at hours (`12 PM`), half hours (`12:30`) and quarter hours (`12:15`). No 5-minute labels, except the live snap label while resizing or dragging.
- A vertical spine at the right edge of the label column.
- Visible range: from the earlier of **Timeline shows from** and the first activity, to the later of **Timeline shows until** and the last activity end. The range always grows to fit every activity; settings never crop.
- **Sunset marker**: a small amber pill with a sun icon at the sunset time in the label column, and a dotted line behind cards.
- **End marker**: `10:45 PM ——— End of day` after the last activity.

### 3.3 Activity card

**Position:** top edge on the start line, bottom edge on the end line (1 px inset each side so neighbours never touch). No minimum height that breaks this.

**Rows, in order:**
1. Title (with solid lock if fixed, note glyph if it has notes, “Now” tag if live)
2. Time range and duration (`12:45 – 1:15 PM  30 min`)
3. Warning line if overrunning or conflicting (never dropped)
4. Progress bar (live activity only)
5. Location
6. Stage tag
7. People tags

**Fitting:** if the rows don't fit the card height, rows are hidden in this order until they fit: people → stage → location → progress → time. Title and warning always stay. When anything is hidden, three faint dots appear in the card's bottom-right corner.

At the approved scale this gives:

| Duration | Shown |
|---|---|
| 45 min + | All rows (people may collapse to `+N`) |
| 30–40 min | Title, time, location, stage |
| 25 min | Title, time, location |
| 15–20 min | Title, time |
| 5–10 min (one-line card) | Title, lock, dots, start time on one line |

**People tags:** as many full names as fit in one row, then `+N`. Never initials.

**Stage colour:** a vertical bar on the card's left in the stage's phase colour, inset top and bottom, scaling with the card.

**Desktop card:** one row with grip, bar, time and duration, stage tag, title with glyphs, lock and ⋯ buttons; second row with location left and people right. Cards under 30 minutes hide people and show the dots.

### 3.4 Open time block

Dashed, quiet block filling the open interval: `35 min open` / `before Ceremony` / small + button. Under ~15 minutes it becomes a single left-aligned line `10 min open`. Tapping it opens the open-time actions (§5.9).

### 3.5 Conflict layout

When activities truly overlap in time, they are placed side by side in columns for the overlapping stretch (overrunning work left, fixed activity right). Both keep their true times. The overlapping part of the overrunning card is hatched red, and a red bar marks the overlap in the ruler. Messages:
- On the overrunning card: `Runs 5 min into Ceremony` (short cards: `15 min over`).
- On the fixed card: `Fixed · 20 min overlap`.
The summary line shows `20 min conflict ›`.

---

## 4. Interaction model

### 4.1 Phone

| Gesture | Result |
|---|---|
| Swipe anywhere on a card or the timeline | Scrolls. Never resizes or moves. |
| Tap card | Selects it (blue ring, handles, toolbar) |
| Tap empty timeline / outside | Deselects |
| Long-press card (~500 ms) | Opens the edit sheet. Cancelled if the finger moves >10 px or scrolling starts. Pressed feedback appears immediately. |
| Drag top/bottom handle of selected card | Resizes (§5.5) |
| Press and hold reorder handle (~150 ms), then drag | Moves the card (§5.6) |
| Tap open time | Open-time actions |
| Tap summary link | Scrolls to open time or conflict |

**Selected card** shows: blue ring; reorder handle (≡) on its right; bottom handle; top handle only if flexible. Handles are small visible bars with large invisible touch areas. The add button is replaced by the **selection toolbar**:

- Context line: `Getting-ready Portraits · 12:45 – 1:15 PM`
- Second line (only if the card hides anything): the hidden details, e.g. the full people list.
- Buttons: **Edit · Lock/Unlock · Stage · Duplicate · Delete** (Delete in red).

### 4.2 Desktop

| Action | Result |
|---|---|
| Hover card | Controls brighten; resize handles appear (top only if flexible) |
| Click card | Selects |
| Click empty area | Deselects |
| Double-click card | Edit dialog |
| Drag grip | Moves the card |
| Drag top/bottom edge | Resizes |
| Click lock | Fix / unfix |
| Click stage tag | Stage menu |
| Click ⋯ | Edit, Duplicate, Delete |
| Click open time | Open-time menu beside it |

### 4.3 Keyboard (desktop)

- Tab moves through controls in reading order; Enter/Space on a card selects it; Enter on a selected card opens Edit.
- Alt + ↑/↓ moves the selected flexible card up/down.
- On a focused resize handle: ↓ moves the edge 5 min later, ↑ 5 min earlier.
- Esc closes menus and dialogs, cancels a drag or resize in progress, then clears selection.
- ⌘/Ctrl + Z undoes the last change (same as the Undo toast).

---

## 5. Features

### 5.1 Add activity
- New activity: 30 min, Preparation, flexible, no location/people/notes.
- Inserted **after the selected card**, or at the end if nothing is selected. It is selected after creation and the edit sheet opens with the name field focused.
- From open time: “Add activity here” creates a flexible activity filling the open time, placed before the activity that follows.

### 5.2 Edit activity
Phone: bottom sheet (Cancel · Edit activity · Done). Desktop: centered dialog, same order.

Fields in order:
1. **Name** — required, trimmed, 1–120 characters.
2. **Timing** block — Starts: `Flexible | Fixed`. Flexible shows “Follows the activity before it” and the calculated start. Fixed shows an editable time. Duration stepper (−/+ 5 min, typed value rounds up). Ends (calculated).
3. **Location** — up to 140 characters, with suggestions from locations already used.
4. **Stage** — chip grid, current one outlined.
5. **People** — removable chips, `+ Add` field with suggestions from names already used, Enter adds, duplicates (case-insensitive) ignored, max 30 entries of 80 characters. **Text typed but not yet added is added on Done.**
6. **Notes** — up to 1000 characters.
7. **Delete activity** (existing activities only).

Done validates and applies; errors appear inline under the field and keep the sheet open. Cancel discards. Swiping the sheet down equals Cancel; if there are unsaved changes, ask “Discard changes?”.

### 5.3 Fixed times (lock)
- Fixing a flexible activity fixes it at its current start.
- Unfixing returns it to flexible; it moves to follow the previous activity. A toast reports the effect: `Ceremony now starts 2:10 PM · 3 activities shifted · Undo`.
- Fixed activities cannot be moved and have no top resize handle. Their bottom edge can be resized.

### 5.4 Stage
- Phone: toolbar → Stage → list sheet with current stage ticked. Desktop: click the stage tag → menu.
- Applies immediately; card colour and tag update; Undo offered.

### 5.5 Resize
Available on the selected card (phone) or hovered/selected card (desktop).

**Bottom edge:** start stays; end follows the pointer; later flexible activities move; fixed ones stay (and show a conflict if reached).

**Top edge (flexible only):** end stays; start follows the pointer.
- Dragging down shortens the activity and creates open time before it (stored with the activity).
- Dragging up first uses that stored open time; it stops at the previous activity's end (no overlap created).
- The open time moves together with the activity when earlier activities change.

**Both edges:**
- The edge follows the pointer exactly; no lag or easing during the drag.
- The target 5-minute line and its label highlight in blue; a bubble shows `Ends 1:25 PM · 40 min` or `Starts 12:55 PM · 20 min`.
- Later activities preview their new positions during the drag.
- Release commits; Esc or a cancelled touch restores everything exactly.
- Minimum 5 minutes, maximum 12 hours.
- Undo offered after commit.

### 5.6 Reorder
- Starts only from the grip (desktop) or reorder handle (phone, after a short hold). Fixed activities cannot be moved.
- While dragging: the card lifts and follows the pointer; one insertion line and a slot at the **exact landing time** (`Lands at 1:50 PM`) appear; neighbours animate to their new times; the slot changes only after the pointer passes the midpoint of the next position (with a small buffer to prevent flicker).
- Near the top/bottom of the screen the page scrolls automatically.
- Release commits exactly what was shown. Esc or cancel restores the original order.
- Dropping onto the same position changes nothing (no save).
- If the result creates a conflict, it is shown in the preview.
- Desktop keyboard alternative: Alt + ↑/↓.

### 5.7 Duplicate
Copies all fields except fixed time (copy is flexible), inserted directly after the original, selected.

### 5.8 Delete
No confirmation dialog. The activity is removed, the schedule updates, and a toast offers **Undo** for 6 seconds. Selection clears.

### 5.9 Open-time actions
Opened by tapping open time (phone: action sheet; desktop: menu next to it). Header: `35 min open before Ceremony · 2:10 – 2:45 PM`.
1. **Keep as buffer** — inserts a real Buffer activity for exactly that time (and clears any stored open time there).
2. **Extend <previous activity>** — the previous activity's end moves to the end of the open time (allowed even if the previous activity is fixed).
3. **Add activity here** — new flexible activity filling the open time.
4. Cancel.
Nothing changes until one is chosen. Each choice can be undone.

### 5.10 Undo
- Single step. Covers add, duplicate, delete, reorder, resize, stage, fix/unfix, edit-sheet save, open-time actions.
- Shown as a toast `<what happened> · Undo` for 6 seconds; also ⌘/Ctrl+Z on desktop.
- Toasts appear only for: undoable changes, schedule shifts (`2 activities shifted · +15 min`), errors. No “Saved” or “Stage updated” toasts.

### 5.11 Person filter
- Chips: Everyone + each distinct entry in the plan's people lists. Exact match only (“Bride” does not match “All Guests”).
- Non-matching activities fade to about one third opacity but keep their place.
- While on, a blue row stays pinned under the top bar: `Showing Photographer · 2 of 12 ✕`.
- The filter is not saved to the plan; it resets on reload.
- Print uses the active filter.

### 5.12 Summary line
See §3.1. Updates live with the schedule.

### 5.13 Sunset marker
From plan setting **Sunset marker** (default 4:19 PM; empty hides it). Display only.

### 5.14 Notes indicator
A small note glyph after the title when notes are not empty.

### 5.15 Print or save PDF
Menu → Print or save PDF. Uses the browser print dialog with a dedicated print layout: header (planner name, day title, date, time range, sunset, active filter, printed time), then a list grouped by phase with time and duration, title, `Fixed` marker, location, people and notes. No timeline drawing, no controls. Page breaks never split an activity.

### 5.16 Export backup
Menu → Export backup downloads `wedding-plan-YYYY-MM-DD.json` containing the plan (not versions, not secrets).

### 5.17 Empty plan
`Nothing planned yet` with **Add first activity** and **Use wedding template** (loads the template timeline, which is then fully editable; undoable).

### 5.18 Version history
Sheet (phone) / dialog (desktop):
- Save the current plan with a name (1–80 characters).
- List: **Current plan** first (marked, “Edited 2 min ago on this phone”), then saved versions newest first. Each shows name, date/time, and a summary `12 activities · 11:30 AM – 10:45 PM`.
- **Restore**: asks for confirmation, then saves the current plan as `Before restore – <time>` automatically, then restores.
- **Delete**: swipe left (phone) or ⋯ (desktop); undoable via toast.
- Automatic versions are labelled “saved automatically”. Up to 40 versions; the oldest automatic ones are removed first.

### 5.19 Plan settings
Sheet / dialog, Done applies:
- **Plan:** Planner name, Day title, Date.
- **Schedule:** First activity starts; Sunset marker.
- **Timeline view:** Shows from; Shows until (may be after midnight, shown as “next day”). Help: “Only changes what you see. The view always grows to fit every activity.”
- **Appearance:** Theme `Light | Dark` (default Light). Stored on this device only.
Validation inline. Changing the view range never moves activities.

### 5.20 Plan status
Draft · Working · Confirming · Final. Phone: in the menu. Desktop: control in the top bar. Setting **Final** turns on day-of view on all devices (§6).

### 5.21 Menu (phone and desktop)
Day-of view (switch) · Dark appearance (switch) · Status (phone only) · Print or save PDF · Export backup · Version history · Plan settings · Sign out.

### 5.22 Dark appearance
Manual switch in the menu and in Plan settings. Light is the default; the app does **not** follow the system setting. The choice is remembered on the device.

### 5.23 Sign in / out
- One shared password. Error: “That password didn't work. Try again.” with the field kept and focused. Show/Hide password toggle.
- Too many attempts: “Too many attempts. Try again in 15 minutes.”
- Session lasts 30 days on the device. Changing the password signs every device out.
- Sign out: saves pending changes first; if that fails, asks before signing out. Clears the device copy (§7.3).

### 5.24 Home-screen app
The site can be added to the home screen with its own icon and name “Our Wedding”, opening without browser chrome.

---

## 6. Day-of view

### 6.1 Turning it on and off
- Automatically on when the device date is the plan date (from 00:00) and while a plan that runs past midnight is still running; and whenever status is **Final**.
- Manual switch in the menu. If the user switches it off on the day, it stays off on that device for that day.
- On other dates, the switch lets the user rehearse with the real clock.

### 6.2 What changes
- **View only**: header shows `🔒 View only` and **Edit**. Nothing can be moved, resized, fixed or deleted. Desktop hides grips, lock toggles and resize handles; the solid lock on fixed activities stays.
- **Live strip** under the header: pulsing green dot · `NOW` · current activity · `23 min left` (green) on the first line; `Next 1:55 PM Arrival & Buffer` on the second; a thin green progress line along the bottom edge. Desktop: one line, with location of the next activity.
- **Time line**: green line at the current time with a green dot and time pill in the ruler, running behind cards.
- **Current activity**: green outline, pulsing `Now` tag, green progress bar.
- **Past activities**: faded.
- On open, the timeline scrolls so the current time is in the upper third.
- Tapping a card in view-only mode shows the toolbar context and hidden details with a single **Edit** button that switches to editing.

### 6.3 Strip states
| Situation | Strip |
|---|---|
| Before first activity | `Starts in 2 hr 10 min · Getting Ready, 11:30 AM` |
| During an activity | As above |
| During open time | `Open · 12 min until Ceremony` |
| During a conflict | Current = the fixed activity; `Runs over` shown in red on the second line |
| After the last activity | `Day complete` |

The strip updates every 30 seconds. Screen readers announce only when the current activity changes.

### 6.4 Editing on the day
- **Edit** switches to editing: header shows an amber `Editing` label and **Done**. All planning interactions work; the live strip stays.
- **Done** returns to view only. Leaving the app for more than 5 minutes also returns to view only.

---

## 7. Saving, sync and failure behaviour

### 7.1 Autosave
- Every change applies on screen immediately and saves automatically about half a second after the last change.
- Save state in the top bar (phone and desktop): `Saved` (green dot) · `Saving…` · `Offline` (grey dot) · `Not saved` (red, tappable to retry).
- Changes made while a save is in progress are saved next; no edit is dropped.

### 7.2 Failures
| Situation | Behaviour |
|---|---|
| No network | Header `Offline`; pinned grey bar: “You're offline. Changes stay on this phone and save when you reconnect.” Edits continue. Saves resume automatically on reconnect. |
| Server error / timeout (15 s) | Header `Not saved`; retry automatically with increasing delay (2 s up to 30 s); one error toast, not repeated. |
| Invalid data rejected | Header `Not saved`; toast with the reason; no automatic retry; the offending change is highlighted and can be undone. |
| Session expired | Unsaved changes are kept on the device; sign-in screen appears; after sign-in, changes are saved (or the conflict flow runs if the plan changed meanwhile). |
| Plan changed on another device | Dialog “Changed on another device” — **Use the other version** / **Keep my changes**. Whichever is not chosen is saved as an automatic version. Never a silent overwrite. |
| Tab closed or app backgrounded | Pending changes are sent immediately; if that fails, they remain on the device and are sent on next open. |
| Storage not configured / unavailable on load | Full-screen message “Can't load the plan right now” with Retry. Never an empty plan that looks saved. |
| App opened with no network | Last loaded plan shown read-only with the offline bar, if one is stored on the device. |

### 7.3 Device copy
The last loaded plan and any unsaved changes are kept on the device so the plan can be read without signal and edits survive closing the app. Cleared on sign-out and when the session is rejected.

### 7.4 Other devices
When the app comes back to the foreground (or every 60 s while visible and idle), it checks for a newer plan and loads it if there are no unsaved local changes.

---

## 8. Accessibility

- All controls are real buttons/inputs with labels (icon-only buttons have text labels for screen readers).
- Visible focus ring on every focusable control.
- Touch targets at least 44 × 44 pt.
- Text contrast ≥ 4.5:1; icons and control outlines ≥ 3:1.
- Every gesture has a non-gesture alternative: long-press → toolbar Edit; drag → Alt+↑/↓ (desktop); resize → Duration stepper.
- Reduced motion: no pulsing, no movement animations (instant changes).
- Dialogs trap focus and return it to the triggering control. Focus is never lost after an action.
- Live strip is a status region, announced only on activity change.

---

## 9. Acceptance criteria

**Timeline:** every card's top/bottom edge matches its start/end line within 1 px at 390 px and 1280 px widths; 5-minute lines visible; hour > half > quarter > 5-minute hierarchy; no labels at 5-minute ticks; range grows to fit activities; sunset marker at the set time.

**Cards:** no two cards visually overlap except in conflict columns; rows drop in the defined order; dots appear exactly when something is hidden; people show full names then `+N`; stage bar matches phase colour.

**Phone gestures:** a swipe starting anywhere on a card scrolls and never changes data; long-press opens edit; scroll cancels long-press; handles appear only on the selected card; fixed cards have no top handle.

**Resize:** edge follows pointer within 1 px; commits on 5-minute lines; top resize creates and consumes stored open time as defined; Esc restores; undo works.

**Reorder:** landing position shown equals committed position; cancel restores; fixed cards cannot move; autoscroll works; same-position drop does not save.

**Open time and conflicts:** open time visible and actionable; three actions behave as defined; conflicts shown in columns with correct messages and summary.

**Day-of:** turns on by date and by Final; view only until Edit; strip states correct; current activity and time line correct; returns to view only after Done or 5 min away.

**Saving:** offline edits survive reload and save on reconnect with a bounded number of requests; server errors show `Not saved` without request floods; invalid data never blocks later saves; expired session loses nothing; two-device conflict never overwrites silently.

**Security/privacy:** server code and seed data are not downloadable from the site; login attempts are rate-limited.

**Other features:** add after selected; duplicate; undo for each listed action; person filter and pinned row; print layout; export; empty state and template; versions with auto-snapshot and delete; settings validation; dark switch persists per device; home-screen install.

---

## 10. QA scenarios (minimum)

1. All-flexible plan · 2. Fixed activity with open time before it · 3. Conflict with fixed activity · 4. Shrink before a fixed activity · 5. Grow into open time · 6. Grow into a fixed activity · 7. 5-, 10-, 15-, 25-, 30-minute and 3-hour cards · 8. Top resize down then up · 9. Top resize after earlier activity grows · 10. Drag first→last, last→first, around a fixed activity, cancel · 11. Scroll starting on every part of a card (phone) · 12. Long-press edit, long-press cancelled by scroll · 13. Stage change, fix/unfix with shift toast · 14. Many people, long location, long title · 15. Plan crossing midnight, view range ending after midnight · 16. Activity outside the configured view range · 17. Offline edit → reload → reconnect · 18. Server 500 and 400 on save · 19. Session expiry mid-edit · 20. Two devices editing · 21. Version save/restore/delete · 22. Day-of before/during/open/conflict/after · 23. Edit on the day and auto-return · 24. Person filter + print · 25. Empty plan + template · 26. Dark appearance on all screens · 27. Keyboard-only desktop pass · 28. Screen reader pass on phone · 29. 320 px, 390 px, 430 px, 740 px, 1024 px, 1440 px widths, phone landscape · 30. iPad with touch (no hover).

---

## 11. Decision log

| # | Decision | Replaces |
|---|---|---|
| D1 | Day-of view, automatic on the date and when Final; view only until Edit | Final had no behaviour; no day-of support |
| D2 | Phone selection toolbar instead of per-card inline controls | Grip, stage chip, lock, ⋯ and resize strip on every card |
| D3 | Solid dark lock for fixed; red only for conflict and delete | Red lock icon |
| D4 | Stage colours by phase (6), icon identifies the stage | 11 near-duplicate pastels |
| D5 | Top-edge resize for flexible activities, creating stored open time; none for fixed | Bottom-only resize; earlier “no top resize” |
| D6 | “Keep as buffer” inserts a Buffer activity | Undefined “keep” with no persistent effect |
| D7 | Undo toast instead of delete confirmation; toasts only for undo, shifts, errors | Browser confirm; toast after every change |
| D8 | Time-true layout, 20 px per 5 min; rows drop by priority with dots indicator | 68 px minimum card height that pushed cards off their times; 2.6 px/min |
| D9 | Card row order: title, time, location, stage, people; drop order people → stage → location → time | Stage and people shared a row (rejected) |
| D10 | Labels at 15/30/60 only; lines every 5 minutes | Ticks every 15 minutes |
| D11 | Summary line as plain text with blue/red actionable parts | None |
| D12 | Person filter fades non-matching activities, pinned row while on, exact match | None |
| D13 | Live styling in green on a light tint; slim strip | Dark full-height card (rejected) |
| D14 | iOS text sizes on phone: 17 title, 15 detail, 13 label | 12.5 / 9.5 / 8 px |
| D15 | Add inserts after selection; duplicate after original | Always appended at end |
| D16 | Timeline view start/end settings; end may be next day | Not available; end ≤ start rejected even across midnight |
| D17 | Sunset marker (default 4:19 PM) | None |
| D18 | Print layout, export backup, notes glyph, suggestions, empty state with template, home-screen app | None |
| D19 | Versions: current marker, summaries, delete, automatic copy before restore | Restore replaced plan without a copy |
| D20 | Device copy for offline reading and unsaved edits, cleared on sign-out | Nothing stored on device |
| D21 | Dark appearance as an in-app switch, light default, not following the system | — |
| D22 | Changing the password signs out all devices | Sessions survived password change |
| D23 | Reorder on phone requires a short hold on the handle | Immediate drag |
| D24 | Status control in the phone menu; stays in desktop top bar | Header pill on all sizes |
| D25 | People tags: full names then `+N`, never initials | First five names, then initials |
