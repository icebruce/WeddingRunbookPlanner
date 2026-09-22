# Wedding Runbook Planner — Functional Specification

**Status:** Source of truth for product behaviour · **Version:** 2.1 · **Date:** 2026-09-16
**Replaces:** `WeddingRunbookPlanner_PRD_Functional_Spec.md` (v1, 2026-09-15)
**Companions:** `TECHNICAL_SPEC.md`, `DESIGN_GUIDE.md`, `IMPLEMENTATION_PLAN.md`, mobile and desktop mockups

When this document and the mockups disagree on behaviour, this document wins. When they disagree on look, the mockups and `DESIGN_GUIDE.md` win.

> **Post-release update:** §2.1, §3.5, §4, §5.2, §5.3, §5.6, §5.9 and §5.19 below have been rewritten to match a post-release timeline-model rewrite (commit `2939550` onward) that replaced the original Flexible/Fixed propagation model with independent, absolute activity starts. See `IMPLEMENTATION_PLAN.md`/`RELEASE_CHECK.md` for what shipped before that rewrite.

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
| Family, MC, photographer, venue staff (given the read-only link) | Read the plan, filter to their part, print it; on the day, see what is happening now. They are never given the password and can change nothing (§5.20) |

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
| **Activity** | A block with title, duration, stage, location, people, notes, and its own absolute start. Start and end are 5-minute multiples. |
| **Locked** | Exempts the activity from a group move (§5.6). It has no other effect: locking or unlocking never moves the activity or anything else. Shown with a solid dark lock. |
| **Open time** | Unscheduled time between activities, derived from the gaps in the merged set of occupied minutes. Not stored on any activity. |
| **Overlap** | Any two activities whose times intersect, locked or not. Both keep their true times, drawn side by side for the overlapping stretch. There is no fixed-vs-overrunning asymmetry. |
| **Stage** | Category of an activity. 11 stages grouped into 6 phases; the phase sets the colour. |
| **Time zone** | Where the wedding is (`America/Toronto`). Every “is it the day yet” and “what is happening now” is read on the venue's clock, never the reader's. |
| **Day-of view** | Read-only running view with a live strip, time line and faded past activities. |

### 2.1 Scheduling rules

- Activities each carry their own absolute start; nothing here is a chain. Moving, resizing or deleting one activity never moves another.
- Duration: 5 to 720 minutes, always a multiple of 5. Typed values round to the nearest 5. No browser validation messages.
- All typed clock times round to the nearest 5 minutes.
- Times after midnight belong to the next day when they follow a late activity (e.g. 1:15 AM after an 11 PM activity) — a plan's day can run past 1440 minutes. The start picker decides which day from the clock alone: **a time before 4:00 AM is the day after the plan's date, 4:00 AM and later is the plan's own date** (D36). The one start this cannot express — before 4:00 AM on the plan's own date — is set by dragging the card.
- Growing, shrinking or moving an activity never moves any other activity. Two activities are allowed to occupy the same minutes; that is drawn as an overlap (§3.5), not resolved or hidden.
- The one deliberate way several activities move together is a **group move** (§5.6): select two or more, drag any of them, and every unlocked activity in the selection shifts by the same amount. A locked activity in the selection stays put.
- Open time is never stored on an activity — it is always derived fresh from the current gaps between activities (§5.9).

---

## 3. Screens and layout

### 3.1 Main screen (phone and desktop)

Top to bottom:

1. **Top bar** (sticky): nothing on the left at rest, save state, menu. Desktop also shows the status control. When the large title scrolls away, “Wedding Day · 11:30 AM – 10:45 PM” fades into the empty space — the span rather than the date, because the date is a given by then and does not change, while the span moves whenever the first or last activity does. An empty plan has no span and shows the date instead. The planner name is not shown here — it would repeat the title directly below it. **On the day** the title is in the bar from the start and the large title and summary line are not shown at all (D34); phone shows the title alone, desktop adds the span.
2. **Live strip** (day-of only, sticky under the top bar).
3. **Pinned filter row** (only while a person filter is on, sticky).
4. **Large title**: day title. Not shown in the day-of view — the top bar carries it (D34).
5. **Summary line** (not shown in the day-of view, D34): `SAT, NOV 21 · 11:30 AM – 10:45 PM` as a caption under the title (the date shows even when the plan is empty), then on its own line the actionable items: `35 min open ›` (blue) and `20 min conflict ›` (red) when present. Tapping an actionable item scrolls to the first open time or conflict and highlights it. The rest is plain text.
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

**Desktop card:** one row with bar, time and duration, stage tag, title with glyphs, and the lock button; second row with location left and people right. There is no drag handle and no pencil: the body is the drag surface and a double-click opens the editor. Cards under 30 minutes hide people and show the dots. There is no ⋯ menu on the card face — Delete lives in the activity editor (§5.2).

**Location row:** plain text unless the activity carries a map link, in which case the whole row is a link that opens it in a new tab. It stays a link in day-of view, where it is the one thing on a card that still does something.

### 3.4 Open time block

Dashed, quiet block filling the open interval: `35 min open` / `before Ceremony` / small + button. Under ~15 minutes it becomes a single left-aligned line `10 min open`, with no + button.

Tapping a block selects it — the same select-to-reveal-handles model as a card (§4.3) — showing top/bottom resize handles astride its edges, thin or not (a thin block, under 70 px, has no "before X" line and no + button, but selects exactly the same way). Dragging a handle resizes the open time by resizing whichever activity is on that side of it — the top handle is that activity's own bottom edge, the bottom handle is the next activity's own top edge (§5.5) — so shrinking the open time grows that activity, and growing the open time shrinks it. A handle is absent when the activity it would resize is locked. Whichever activity sits against a block's edge leaves its own matching handle out of its own card, so selecting or hovering that card never draws a second one stacked on the block's. Selecting a block, like selecting a card, is not undone by resizing it: it stays selected once the drag commits.

A tall block's own + button opens the open-time actions (§5.9) directly, without selecting first; so, on a tall block only, does a long press (touch) or double-click (mouse) on the block itself, mirroring how a card offers both its pencil icon and a long press/double-click into the same editor. A thin block has neither: no + button (no room for one) and no long-press/double-click either, only the handles and selecting — there is no way to reach the open-time actions from a thin block at all.

### 3.5 Conflict layout

Any two (or more) activities whose times truly overlap are placed in side-by-side lanes for the overlapping stretch — an equal-width split among however many activities overlap at once (interval-graph colouring, not a fixed-vs-overrunning pair). Locked and unlocked activities are treated identically; there is no asymmetric role. Both/all keep their true times. Only the exact overlapping sub-range of each card is hatched red (not the whole card), and a red bar marks the overlap in the ruler.

Message on each overlapping card: `Overlaps N min with <other title>` (or, for three or more overlapping activities, `Overlaps N min with <count> activities`). There is no separate "Fixed · N min overlap" wording — the message is the same regardless of lock state.

The summary line shows `20 min conflict ›`.

---

## 4. Interaction model

### 4.1 Phone

| Gesture | Result |
|---|---|
| Swipe anywhere on a card or the timeline | Scrolls. Never resizes or moves. |
| Tap card | Selects it (blue ring, handles, toolbar) |
| Double-tap card | Opens the edit sheet |
| Tap empty timeline / outside | Deselects |
| Press and hold a card (300 ms) | Lifts it to be moved (§5.6). Pressed feedback is immediate and deepens across the hold. Cancelled by >10 px of vertical movement (20 px sideways), which makes it a scroll. |
| Drag top/bottom handle of selected card | Resizes (§5.5) |
| Drag a lifted card | Moves it to a new time (§5.6) |
| Tap open time | Open-time actions |
| Pull a sheet down | Dismisses it, asking first if there is unsaved typing — the same as Cancel |
| Tap summary link | Scrolls to open time or conflict |

**Selected card** shows: blue ring; bottom handle; top handle unless locked. Handles are small visible bars with large invisible touch areas. The add button is replaced by the **selection toolbar**:

- Context line: `Getting-ready Portraits · 12:45 – 1:15 PM`
- Second line (only if the card hides anything): the hidden details, e.g. the full people list.
- Buttons: **Delete · Stage · Lock/Unlock · Edit** (Delete in red). Four buttons, four columns; there is no Duplicate (D37).

### 4.2 Desktop

| Action | Result |
|---|---|
| Hover card | Controls brighten; resize handles appear (top unless locked); an unlocked card shows the grab cursor |
| Click card | Selects |
| Ctrl/Cmd-click card | Adds it to a group selection (2+ cards), for a group move (§5.6) |
| Click empty area | Deselects, clears group selection |
| Double-click card | Edit dialog |
| Drag a card by its body (3 px) | Moves the card to a new time; with a group selection, drags every unlocked card in it together by the same amount |
| Drag top/bottom edge | Resizes |
| Click lock | Lock / unlock (exempts from group move; has no other effect) |
| Click stage tag | Stage menu |
| Double-click a card | Opens the Edit dialog (which also offers Duplicate and Delete). There is no pencil and no ⋯ on the card face |
| Click open time | Open-time menu beside it |

### 4.3 Keyboard (desktop)

- Tab moves through controls in reading order; Enter/Space on a card selects it; Enter on a selected card opens Edit.
- Alt + ↑/↓ on a selected, unlocked card moves its start 5 min earlier/later (not a reorder — its time changes, its place in the list follows).
- On a focused resize handle: ↓ moves the edge 5 min later, ↑ 5 min earlier.
- Esc closes menus and dialogs, cancels a drag or resize in progress, then clears selection.
- ⌘/Ctrl + Z undoes the last change (same as the Undo toast).

---

## 5. Features

### 5.1 Add activity
- New activity: 30 min, Preparation, flexible, no location/map link/people/notes.
- Inserted **after the selected card**, or at the end if nothing is selected. It is selected after creation and the edit sheet opens with the name field focused.
- From open time: “Add activity here” creates a flexible activity filling the open time, placed before the activity that follows.

### 5.2 Edit activity
Phone: bottom sheet (Cancel · Edit activity · Done). Desktop: centered dialog, same order.

Fields in order:
1. **Name** — required, trimmed, 1–120 characters.
2. **Timing** block — **Starts** (picker, §8.5 of `TECHNICAL_SPEC.md`) sets the absolute start; there is no separate Flexible/Fixed choice and no calendar, because the day follows from the clock (§2.1). Duration stepper (−/+ 5 min, typed value rounds to nearest 5). Ends (calculated). **Lock**, a toggle, sets whether this activity is exempt from a group move (§5.6) — it does not change where the activity starts, and it says so on the row.
3. **Location** — up to 140 characters, with suggestions from locations already used, and one button beside it for an optional **Google Maps link** (up to 2000 characters, `http` or `https` only). The link row opens on the button and is open already when a link exists. A location with no link stays plain text everywhere — nothing is ever guessed from the words.
4. **Stage** — chip grid, current one outlined.
5. **People** — removable chips, `+ Add` field with suggestions from names already used, Enter adds, duplicates (case-insensitive) ignored, max 30 entries of 80 characters. **Text typed but not yet added is added on Done.**
6. **Notes** — up to 1000 characters.
7. **Delete activity** (existing activities only). There is no Duplicate, here or anywhere (D37).

Done validates and applies; errors appear inline under the field and keep the sheet open. Cancel discards. Swiping the sheet down equals Cancel; if there are unsaved changes, ask “Discard changes?”.

### 5.3 Locking
- Locking or unlocking an activity never changes its start or duration, and never moves any other activity. Its only effect is whether the activity participates in a group move (§5.6).
- Toast: `Locked <title> · Undo` / `Unlocked <title> · Undo`. There is no "N activities shifted" shift toast for locking — nothing shifts.
- A locked activity cannot be resized or moved by any gesture (it cannot be lifted, and has no resize handles) until unlocked.

### 5.4 Stage
- Phone: toolbar → Stage → list sheet with current stage ticked. Desktop: click the stage tag → menu.
- Applies immediately; card colour and tag update; Undo offered.

### 5.5 Resize
Available on the selected card (phone) or hovered/selected card (desktop). Locked activities cannot be resized (no handles are shown). An open-time block's own handles (§3.4) drive the same two edges from the other side, with the same lock rule — unlike "Extend" (§5.9), which is a deliberate menu choice and is allowed regardless of lock state, a handle never resizes a locked activity, dragged from the block or from the card itself.

**Bottom edge:** start stays; end follows the pointer. No other activity moves; if the new end now overlaps a following activity, that is shown as an overlap (§3.5), not prevented or auto-pushed.

**Top edge:** end stays; start follows the pointer, clamped so the activity keeps at least 5 minutes and its start never goes below 0. Dragging it does not create or consume any "stored open time" — open time is always just whatever gap is currently between activities (§5.9), never something attached to a particular activity.

**Both edges:**
- The edge follows the pointer exactly; no lag or easing during the drag.
- The target 5-minute line and its label highlight in blue; a bubble shows `Ends 1:25 PM · 40 min` or `Starts 12:55 PM · 20 min`.
- No other card's position previews or changes during the drag — only the one being resized.
- Release commits; Esc or a cancelled touch restores everything exactly.
- Minimum 5 minutes, maximum 12 hours.
- Undo offered after commit.

### 5.6 Move and group move
- **The card body is the drag surface.** There is no handle. A pointer lifts a card after 3 px of movement; a finger lifts it by holding it still for 300 ms, because what separates a move from a scroll is stillness, not which pixels were touched. The hold arms over the card's own buttons too — the stage pill and people tags would otherwise punch holes in the drag surface — and the click it leaves behind is suppressed, so the button never also fires.
- **Single card:** drag it anywhere on the timeline to set its start directly — a continuous drag-to-time, not a discrete reorder by position. The target 5-minute line and time highlight as the card is dragged, the same as a resize. Locked activities cannot be lifted.
- **Group move:** Ctrl/Cmd-click (desktop) or the equivalent multi-select gesture adds cards to a group selection (2+ cards); dragging any selected card moves every *unlocked* card in the selection by the same amount of time. A locked card in the selection stays exactly where it is — this is the one deliberate way several activities move together, and it never happens as a side effect of any other change.
- Near the top/bottom of the screen the page scrolls automatically while dragging. Speed rises with the square of how far past the edge the pointer is, so the boundary is a creep and the corner crosses the day in seconds; it eases in rather than jolting, and scrolling alone carries the card, so the finger does not have to keep moving.
- Release commits exactly what was shown. Esc or cancel restores the original positions.
- Dropping back on the same time changes nothing (no save). Any movement under one 5-minute step resolves to no change, so an accidental lift cannot alter the plan.
- **If the drop would overlap, the card says so while it is still in the air:** the exact colliding minutes are hatched on both cards, both are outlined, and the readout reports the conflict instead of a time. It is shown, never prevented.
- Desktop keyboard alternative for a single unlocked card: Alt + ↑/↓ moves it 5 min earlier/later (§4.3).

### 5.7 Duplicate
Copies all fields except fixed time (copy is flexible), inserted directly after the original, selected.

### 5.8 Delete
Delete asks first, wherever it is pressed: an alert — `Delete this activity?` / **Delete** / **Keep it** — over whatever is already open, so Keep it comes back to an editor still filled in. On Delete the activity is removed, the schedule updates, and a toast offers **Undo** for 6 seconds. Selection clears.

### 5.9 Open-time actions
Opened by a tall block's + button, or by a long press (touch) / double-click (mouse) on the block itself — a thin block has neither, and offers no way into this sheet at all (§3.4). Header: `35 min open before Ceremony · 2:10 – 2:45 PM`. Open time is computed fresh each time from the current gaps between activities — it is never something stored on an activity that these actions "clear".
1. **Keep as buffer** — inserts a real Buffer activity for exactly that time.
2. **Extend <previous activity>** — the previous activity's end moves to the end of the open time (allowed regardless of that activity's lock state).
3. **Add activity here** — new activity filling the open time.
4. Cancel.
Nothing changes until one is chosen. Each choice can be undone.

### 5.10 Undo
- Single step. Covers add, delete, reorder, resize, stage, fix/unfix, edit-sheet save, open-time actions.
- Shown as a toast `<what happened> · Undo` for 6 seconds; also ⌘/Ctrl+Z on desktop.
- Toasts appear only for: undoable changes and errors. No “Saved” or “Stage updated” toast, and no “N activities shifted” toast — locking, unlocking, resizing and moving one activity never shift another.
- The six seconds are unattended time. The countdown stops while a pointer is over the toast or focus is inside it, and starts again on the way out; a toast can also be swiped right to dismiss (down is nearly free at the bottom of a screen, and dismissed it by accident). Undo is the only way back from a delete, so it does not expire while it is being read. A toast is chrome, not “outside”: pressing its Undo never also clears the selection.

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
- **Delete**: a delete button on the row; undoable via toast.
- Automatic versions are labelled “saved automatically”.
- **Automatic backups** are kept without anyone asking: when a save lands and the plan has gone six hours without one, a copy of the plan *as it was before that save* is kept, named “Automatic backup”. A run of edits inside one window produces one backup, not one per edit.
- Up to 40 versions. Automatic backups are kept at a resolution that drops with age — every one from the past day, then one a day for a week, one a week for two months, one a month before that — so the list spans months rather than the ten days it would hold at full resolution. A version someone named, and the copy kept when a conflict was resolved, are never thinned; past 40 the oldest automatic ones go first.

### 5.19 Plan settings
Sheet / dialog, Done applies:
- **Plan:** Planner name, Day title, Date.
- **Schedule:** Sunset marker. (There is no "First activity starts" setting — nothing schedules from a single anchor time; each activity's own start decides where the day begins.)
- **Timeline view:** Shows from; Shows until (may be after midnight, shown as “next day”). Help: “Only changes what you see. The view always grows to fit every activity.”
Validation inline. Changing the view range never moves activities. The dark/light appearance switch (§5.22) lives only in the main menu, not duplicated here.

### 5.20 Share read-only link
Sheet / dialog from the menu:
- One link, of the form `/share#<token>`. Minted the first time the sheet is opened, so an unshared plan has no link to leak.
- **Copy** puts it on the clipboard; if the clipboard is refused, the link is selected instead and the toast says so.
- **Replace link** issues a new one and stops the old one working immediately, everywhere. This is the only way to revoke it.
- The sheet says plainly what the link allows: read and print, no password, and that it works for anyone it is passed on to.

What the link opens is **not the planner in a different mode** — it is a separate page with no editor on it. No menu, no save state, no version history, no settings, no add button, no handles, no stage control. The person filter and Print or save PDF are offered, because filtering to your own part and printing it is the reason a vendor opens it at all. Dark appearance can be switched, remembered on that device.

The token is held in the URL fragment, which browsers never send to a server, and handed to the API in a header — so it stays out of request logs and out of any `Referer`.

The live strip (§6) appears on the shared page **by date only**, read on the venue's clock: a link opened three weeks early is a plan to read, and the same link on the wedding day opens to what is happening now.

### 5.21 Menu (phone and desktop)
Day-of view (switch) · Dark appearance (switch) · Share read-only link · Print or save PDF · Export backup · Version history · Plan settings · Sign out.

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
- Automatically on when the date **at the venue** is the plan date (from 00:00) and while a plan that runs past midnight is still running. The date is the only rule (D31).
- Manual switch in the menu. If the user switches it off on the day, it stays off on that device for that day.
- On other dates, the switch lets the user rehearse with the real clock.

### 6.2 What changes
- **View only**: header shows `🔒 View only` and **Edit**. Nothing can be moved, resized, fixed or deleted. Desktop hides lock toggles and resize handles, and no card can be lifted; the solid lock on fixed activities stays.
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
| Plan changed on another device | The two plans are merged. Anything only one side changed is taken silently; a toast says changes arrived. Only the same field of the same activity, changed on both sides to different values, asks: dialog “You both changed &lt;activity&gt;” — **Keep mine** / **Use the other version**, with the losing copy saved as an automatic version. Everything already merged stays merged either way. Never a silent overwrite. |
| Tab closed or app backgrounded | Pending changes are sent immediately; if that fails, they remain on the device and are sent on next open — merged with anything that arrived meanwhile. |
| Storage not configured / unavailable on load | Full-screen message “Can't load the plan right now” with Retry. Never an empty plan that looks saved. |
| App opened with no network | Last loaded plan shown read-only with the offline bar, if one is stored on the device. |

### 7.3 Device copy
The last loaded plan and any unsaved changes are kept on the device so the plan can be read without signal and edits survive closing the app. The plan as the server last confirmed it is kept alongside them, so unsent edits can still be merged after the app has been closed and reopened. Cleared on sign-out and when the session is rejected.

### 7.4 Other devices
When the app comes back to the foreground (or every 60 s while visible and idle), it checks for a newer plan and loads it if there are no unsaved local changes.

---

## 8. Accessibility

- All controls are real buttons/inputs with labels (icon-only buttons have text labels for screen readers).
- Visible focus ring on every focusable control.
- Touch targets at least 44 × 44 pt.
- Text contrast ≥ 4.5:1; icons and control outlines ≥ 3:1.
- Every gesture has a non-gesture alternative: double-tap/double-click → toolbar Edit (phone) and Enter on a selected card; drag → Alt+↑/↓ (desktop); resize → Duration stepper.
- Reduced motion: no pulsing, no movement animations (instant changes).
- Dialogs trap focus and return it to the triggering control. Focus is never lost after an action.
- Live strip is a status region, announced only on activity change.

---

## 9. Acceptance criteria

**Timeline:** every card's top/bottom edge matches its start/end line within 1 px at 390 px and 1280 px widths; 5-minute lines visible; hour > half > quarter > 5-minute hierarchy; no labels at 5-minute ticks; range grows to fit activities; sunset marker at the set time.

**Cards:** no two cards visually overlap except in conflict columns; rows drop in the defined order; dots appear exactly when something is hidden; people show full names then `+N`; stage bar matches phase colour.

**Phone gestures:** a swipe starting anywhere on a card scrolls and never changes data; a 300 ms hold lifts it to be moved; movement cancels the hold; a double tap opens edit; handles appear only on unlocked, selected cards; locked cards have no handles and cannot be lifted.

**Resize:** edge follows pointer within 1 px; commits on 5-minute lines; resizing one activity never moves another; Esc restores; undo works.

**Move / group move:** dragged position shown equals committed position; cancel restores; locked cards cannot move on their own or as part of a group selection; autoscroll works; same-position drop does not save; a group move shifts every unlocked selected card by the same amount and leaves locked ones in place.

**Open time and conflicts:** open time visible and actionable; three actions behave as defined; conflicts shown in columns with correct messages and summary.

**Day-of:** turns on by the date at the venue, whatever zone the reader is in; view only until Edit; strip states correct; current activity and time line correct; returns to view only after Done or 5 min away.

**Saving:** offline edits survive reload and save on reconnect with a bounded number of requests; server errors show `Not saved` without request floods; invalid data never blocks later saves; expired session loses nothing; two-device conflict never overwrites silently.

**Security/privacy:** server code and seed data are not downloadable from the site; login attempts are rate-limited; a share token can be used to read the plan and nothing else — it grants no session and every write refuses it.

**Other features:** add after selected; undo for each listed action; person filter and pinned row; print layout; export; empty state and template; versions with auto-snapshot and delete; settings validation; dark switch persists per device; home-screen install.

---

## 10. QA scenarios (minimum)

1. Plan with no overlaps · 2. Activity with open time before it · 3. Two activities overlapping · 4. Three-way overlap · 5. Shrink an activity so it no longer overlaps · 6. Grow an activity into a following one (creates an overlap, nothing is pushed) · 7. 5-, 10-, 15-, 25-, 30-minute and 3-hour cards · 8. Top resize, bottom resize, both in sequence · 9. Resize one activity with an overlapping neighbour unaffected · 10. Drag a card to an earlier time, a later time, onto another activity's time (the overlap previews before the drop), cancel · 10a. Group-select two+ cards (one locked), drag: locked one stays, others move by the same delta; cancel restores all · 11. Scroll starting on every part of a card (phone) · 12. Hold to lift, hold cancelled by movement, double-tap to edit · 13. Stage change, lock/unlock with no shift · 14. Many people, long location, long title · 15. Plan crossing midnight, view range ending after midnight; the start picker puts a time before 4 AM on the next day and 4 AM onward on the plan's date · 16. Activity outside the configured view range · 17. Offline edit → reload → reconnect · 18. Server 500 and 400 on save · 19. Session expiry mid-edit · 20. Two devices editing · 21. Version save/restore/delete · 22. Day-of before/during/open/conflict/after · 23. Edit on the day and auto-return · 24. Person filter + print · 25. Empty plan + template · 26. Dark appearance on all screens · 27. Keyboard-only desktop pass · 28. Screen reader pass on phone · 29. 320 px, 390 px, 430 px, 740 px, 1024 px, 1440 px widths, phone landscape · 30. iPad with touch (no hover) · 31. Phone hardware/gesture back closes an open sheet, menu, or card selection instead of leaving the app · 32. Every picker mode: a start on the wheel, the plan date on the calendar, sunset and both view-range times set and cleared; Escape, the scrim and hardware back each close the picker and leave the sheet open · 33. A location with a map link and one without, on a card, in the shared view and in print.

---

## 11. Decision log

| # | Decision | Replaces |
|---|---|---|
| D1 | Day-of view, automatic on the date; view only until Edit | No day-of support |
| D2 | Phone selection toolbar instead of per-card inline controls | Grip, stage chip, lock, ⋯ and resize strip on every card |
| D3 | Solid dark lock for fixed; red only for conflict and delete | Red lock icon |
| D4 | Stage colours by phase (6), icon identifies the stage | 11 near-duplicate pastels |
| D5 | Top-edge resize for any unlocked activity; open time is always derived, never stored on an activity (superseded by the post-release timeline rewrite, commit `2939550`) | Bottom-only resize; earlier “no top resize” |
| D6 | “Keep as buffer” inserts a Buffer activity | Undefined “keep” with no persistent effect |
| D7 | Delete asks once, then the undo toast still runs (Delete moved to the toolbar's first slot, so a slip must not be final); toasts only for undo, shifts, errors | Browser `confirm()`; confirmation *instead of* undo; earlier “no confirmation at all” |
| D8 | Time-true layout, 20 px per 5 min; rows drop by priority with dots indicator | 68 px minimum card height that pushed cards off their times; 2.6 px/min |
| D9 | Card row order: title, time, location, stage, people; drop order people → stage → location → time | Stage and people shared a row (rejected) |
| D10 | Labels at 15/30/60 only; lines every 5 minutes | Ticks every 15 minutes |
| D11 | Summary line as plain text with blue/red actionable parts; date and time range only | An activity count in the header |
| D12 | Person filter fades non-matching activities, pinned row while on, exact match | None |
| D13 | Live styling as a graphite card in a tinted band (**reversed**: was green on a light tint, and a dark card was the rejected option). Green on a light band ended up doing six jobs at once — surface, border, progress track, fill, pulse and label — so nothing read as distinct. On a dark panel green means only "live". Not full-height: a card in a band, so the plan still scrolls under something | Green on a light tint (was) · dark *full-height* card (still rejected) |
| D14 | iOS text sizes on phone: 17 title, 15 detail, 13 label | 12.5 / 9.5 / 8 px |
| D15 | Add inserts after selection | Always appended at end |
| D16 | Timeline view start/end settings; end may be next day | Not available; end ≤ start rejected even across midnight |
| D17 | Sunset marker (default 4:19 PM) | None |
| D18 | Print layout, export backup, notes glyph, suggestions, empty state with template, home-screen app | None |
| D19 | Versions: current marker, summaries, delete, automatic copy before restore | Restore replaced plan without a copy |
| D20 | Device copy for offline reading and unsaved edits, cleared on sign-out | Nothing stored on device |
| D21 | Dark appearance as an in-app switch, light default, not following the system | — |
| D22 | Changing the password signs out all devices | Sessions survived password change |
| D23 | *(superseded)* Reorder on phone required a short hold on the handle | Immediate drag |
| D24 | *(superseded by D31)* Status control in the phone menu; stays in desktop top bar | Header pill on all sizes |
| D25 | People tags: full names then `+N`, never initials | First five names, then initials |
| D26 | Timeline model rewrite (commit `2939550`): every activity stores its own absolute `start`; nothing propagates or auto-pushes; `locked` only exempts an activity from a deliberate group move | Flexible/Fixed propagation chain with stored `gapBefore` and automatic conflict resolution |
| D27 | Group move: Ctrl/Cmd-click selects multiple cards, dragging any selected card moves every unlocked one by the same delta | No multi-activity move; reorder moved one activity by list position |
| D28 | *(picker superseded by D35)* A single start field replaces the Flexible/Fixed radio and separate time field in the activity editor | Starts: Flexible \| Fixed radio |
| D33 | Automatic backups every six hours, of the state each save replaced, thinned at a resolution that drops with age | Automatic versions existed only at the two moments something had already gone wrong — a conflict, or a restore — so version history was empty exactly when it was needed |
| D32 | A read-only link: one revocable token, opening a separate page that has no editor on it at all. Read-only is the shape of what exists rather than a permission each action has to remember to check | One shared password and one permission level — the photographer and the venue could delete the ceremony |
| D31 | Plan status removed. Three of its four values had no behaviour at all and the fourth, **Final**, silently forced day-of view onto every device — a mode switch wearing a label's name. Day-of now turns on by date alone, read on the plan's `timezone` (default `America/Toronto`) rather than the reader's device | Draft/Working/Confirming/Final, as a select in the desktop top bar and a row in the phone menu |
| D30 | Two diverged plans are merged per activity and per field against the version the server last confirmed; only the same field changed twice is a question, and it names the activity | A dialog offering two whole plans, where choosing one discarded every unrelated change the other side had made |
| D29 | Phone back-button/gesture closes the open sheet, menu, or card selection instead of leaving the app (a dummy history entry pushed while an overlay is open). Scroll restoration is manual: back closes the top thing and the page stays exactly where it is | Back navigated away from the app with an overlay still open; later, back also threw the reader from where they had scrolled to back to the selected card |
| D34 | Day-of: the title lives in the top bar; no large title, no summary line. The band carries the page tint, so the bar still draws no rule against it — but the boundary the plan passes under is now the panel's own edge rather than a border on the band (D13) | Keeping the large title and handing it over behind the strip |
| D35 | The app's own picker, in three modes (`date`, `time`, `datetime`), replaces flatpickr — which hung its calendar off `document.body` and so opened *underneath* the `<dialog>` every field of its lives in, invisible on every platform. The app is back to zero runtime dependencies | flatpickr, vendored (was D28) |
| D36 | The start picker has no calendar: a time before 4:00 AM is the day after the plan's date, 4:00 AM and later is the plan's own date | A day chooser on every edit, for a case that arises once in a plan |
| D37 | No Duplicate — not in the editor, not in the selection toolbar, not as an operation | Duplicate in both places |
| D38 | A location links only where someone pasted a link. Plain text is never turned into a map search | Auto-linking every location, which would send "Bridal suite, 3rd floor" to a map of nothing |
| D39 | Alert buttons: filled `--ink` for the action, quiet for the way back, filled `--bad` where the action throws something away. No icon well, no footnote. The alert is the one place a primary is not `--sel` — it is a decision being forced, not something offered to tap | The mockups' blue alert buttons (`.ab` / `.ab.strong`), which no alert in the app ever shipped; and a *tinted* destructive button, which read quieter than an ordinary primary |
