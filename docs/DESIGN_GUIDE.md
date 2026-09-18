# Wedding Runbook Planner — Design Guide

**Status:** Source of truth for look and feel · **Version:** 1.1 · **Date:** 2026-09-16
**Visual references:** `docs/mockups/mobile.html`, `docs/mockups/desktop.html` (approved). When a detail isn't covered here, match the mockups.

> **Post-release update:** the post-release timeline rewrite (see `TECHNICAL_SPEC.md`/`FUNCTIONAL_SPEC.md`) renamed "Fixed" to "Locked" throughout the product and changed the card/conflict styling accordingly; §4.3 and §9 below have been updated to match.

---

## 1. Principles

1. **Time is the layout.** Vertical position always equals clock time. Density is handled by showing less, never by moving things.
2. **Quiet at rest, clear in action.** Cards are calm; controls appear on selection (phone) or hover (desktop).
3. **One colour, one job.** Colour carries meaning only as defined in §3.
4. **Direct manipulation feels attached.** Edges and cards follow the finger with no lag; motion happens only after release.
5. **Phone is not a squeezed desktop.** Same content and rules, different controls.
6. **Readable first.** iOS text sizes on phones; nothing essential below 12 px.

---

## 2. Tokens

Defined once in `public/styles/tokens.css` as CSS custom properties on `:root`, with dark values on `:root[data-theme="dark"]`. Never hard-code colours in component CSS.

### 2.1 Neutrals

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F7F4` | `#111214` | Page |
| `--surface` | `#FFFFFF` | `#1C1D20` | Cards, sheets, menus |
| `--surface-2` | `#F4F4F1` | `#232428` | Grouped fields, version rows |
| `--fill` | `#F2F2EF` | `#2A2B2F` | People tags, icon wells |
| `--fill-strong` | `#E9E9E5` | `#33343A` | `+N` tag, segmented background |
| `--ink` | `#1C1C1E` | `#F2F2F0` | Titles, primary text, fixed lock |
| `--ink-2` | `#3A3C42` | `#D5D6DA` | Secondary strong text, icons |
| `--soft` | `#6B6E76` | `#9EA1A8` | Metadata, labels |
| `--faint` | `#8E9098` | `#7C7F86` | Placeholders, note glyph |
| `--hair` | `#E7E7E2` | `#2C2D31` | Dividers |
| `--dots` | `#B3B5BA` | `#5E6066` | “More” indicator |

### 2.2 Role colours

| Token | Light | Dark | The only uses |
|---|---|---|---|
| `--sel` / `--sel-tint` | `#0A6CFF` / `#EAF2FF` | `#3D8BFF` / `#16233A` | Selection ring, handles, snap line and label, drop line/slot, links, primary text buttons, active filter row |
| `--bad` / `--bad-tint` | `#D0342C` / `#FCEDEC` | `#FF6259` / `#3A1D1C` | Conflicts, overrun hatching, delete, “Not saved”, form errors |
| `--live` / `--live-dot` / `--live-tint` | `#1E9E52` / `#34C759` / `#EEF7F1` | `#3DD06C` / `#34C759` / `#16301F` | Day-of strip, current activity outline and tag, time line and pill, progress |
| `--fixed` (= `--ink`) | `#1C1C1E` | `#F2F2F0` | Solid lock only |
| `--amber` / `--amber-tint` | `#8A5A00` / `#FFF1D6` | `#F2C46B` / `#3A2C10` | Sunset marker, “Editing” label on the day |
| `--ok` | `#34A853` | `#34C759` | “Saved” dot only |

The save dot never animates. A save lasts the 650 ms debounce plus a round trip, and a one-second pulse over that window dies mid-fade — a flicker in the corner of the eye on every nudge of a card. “Saving…” stays up for 700 ms minimum once shown, so the paths that skip the debounce (version save, sign-out, the flush on returning to the tab) cannot blink it; what is shown when that debt is paid is whatever is true *then*, never a stale “Saved”.
| `--brand` | `#D65A73` | `#E27A90` | Heart in the brand mark only |

Red never means “fixed”. Green never means “selected”. Blue never means “live”.

### 2.3 Phase colours (stage bar, tag icon, tag tint)

| Phase | Stages | Colour | Tint (light) |
|---|---|---|---|
| Getting ready | Preparation | `#7A66E8` | `#F1EEFD` |
| Photos | First look, Photography | `#1F8A9B` | `#E5F3F5` |
| Travel and buffer | Transition, Buffer | `#6F7885` | `#EFF1F3` |
| Ceremony | Ceremony | `#A67C0F` | `#F8F1DC` |
| Cocktail and celebration | Celebration, Cocktail | `#C44E78` | `#FBEBF1` |
| Reception | Reception, Dinner, Party | `#3F8A57` | `#E7F3EA` |

Dark tints: `color-mix(in srgb, <phase> 22%, var(--surface))`; tag icon `color-mix(in srgb, <phase> 70%, #fff)`. Tag text always uses `--ink-2`, never the phase colour.

Stage icons: Preparation ✦ sparkle · First look ♡ heart · Photography camera · Transition car · Buffer clock · Ceremony rings · Celebration party popper · Cocktail glass · Reception table · Dinner fork & knife · Party music note. Inline SVG, 24-unit grid, 1.8 stroke, round caps.

### 2.4 Typography

Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`. Brand mark only: `ui-serif, "New York", Georgia, serif`. Numbers in times use `font-variant-numeric: tabular-nums`.

| Style | Phone | Desktop | Weight | Use |
|---|---|---|---|---|
| Large title | 34/37 | 44/46 | 700, −0.025em | Day title |
| Title 3 | 20 | 20 | 650 | Empty state |
| Headline | 17/22 | 16/21 | 600 | Card title, sheet title, live activity |
| Body | 17 | 15 | 400 | Form values, list rows |
| Subhead | 15/20 | 14/19 | 400 | Card time, location, summary line, date |
| Footnote | 13 | 13 | 400–600 | Tags, labels, help, save state, toolbar context |
| Caption | 12 | 12 | 500–700 | Toolbar labels, live label and summary meta line (caps, +0.04em), ruler quarter labels, pills |
| Ruler hour / half / quarter | 14 / 13 / 12 | same | 700 / 600 / 500 | Time ruler |

Minimum: 12 px anywhere; 16 px for any text input on phones (prevents iOS zoom).

### 2.5 Spacing, radius, elevation

- Spacing scale: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28 px. Screen side padding: 18 px phone, 28 px desktop.
- Radius: 12 cards, fields, gap blocks · 16–18 sheets top corners, toasts, dialogs, empty card · 24 toolbar · pills fully rounded.
- Elevation:
  - Card rest: `0 0 0 .5px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.04), 0 3px 10px rgba(0,0,0,.03)`
  - Hover (desktop): `0 6px 20px rgba(0,0,0,.08)`
  - Lifted (dragging): `0 22px 50px rgba(0,0,0,.2)` + 1 px `--sel` outline, rotate −0.6°, scale 1.02
  - Floating (toolbar, menus, dialogs): `0 12px 36px rgba(0,0,0,.16)`
  - Dark mode: replace shadows with a 0.5 px `rgba(255,255,255,.07)` outline.
- Glass (top bar, pinned rows, toolbar): background at 92–96 % opacity + `backdrop-filter: blur(20px)` (with `-webkit-` prefix).

---

## 3. The time grid

- **Scale:** 4 px per minute (20 px per 5 minutes), all widths.
- **Columns:** phone ruler 56 px, plan starts at 64 px, 12 px right margin. Desktop ruler 80 px, plan starts at 92 px, max content width 1100 px.
- **Spine:** 1 px vertical line at the ruler's right edge (`#CFCFC8` / dark `#3A3B3F`).
- **Lines and ticks:**

| Kind | Line across plan | Tick length | Tick colour | Label |
|---|---|---|---|---|
| Hour | `#D2D2CB`, 1 px | 14 px, 1.5 px | `#8F8F88` | `12 PM`, 14/700 `--ink` |
| Half hour | `#DDDDD7` | 10 px | `#A9A9A2` | `12:30`, 13/600 `#43464D` |
| Quarter | `#E6E6E1` | 7 px | `#C0C0B9` | `12:15`, 12/500 `#686B72` |
| 5 minutes | `#EEEEEA` | 4 px | `#D2D2CB` | none |

- **Snap label** (resizing/dragging): white text on `--sel` pill replacing the label at that line; the line itself turns `--sel` 1.5 px.
- **Cards** sit 1 px inside their lines (top +1, height −2).
- **Markers** in the ruler column use 22 px pills: time now (green), sunset (amber with sun icon). Their lines run *behind* cards. The time-now line, its pill and the live progress bar ease over 500 ms when the clock moves them: the clock ticks every 30 s, which is a 2 px step, and the one thing on the page that moves by itself all day should not twitch.
- **End marker:** `10:45 PM ——— End of day`, subhead, `--soft`.

---

## 4. Components

### 4.1 Top bar
Height 52 phone / 62 desktop **minimum**, sticky, glass. The hairline bottom border is drawn only once something is passing underneath — it fades in over 160 ms on the same handover that brings in the collapsed title, and there is no rule at rest. The bar is often taller than the minimum (a notch's safe-area inset is part of its padding), so everything that sticks to its underside reads the measured height (`--topbar-height`, written by app.js) rather than the floor (`--topbar-min`). The title cell is a fixed 34 px, because an empty cell and the two-line collapsed title must measure the same and the bar must not resize at the handover.
Left: empty at rest — the large title is immediately below, and the planner name above it said the same thing twice — then, once scrolled, the collapsed title (`Wedding Day` 17/650 over `11:30 AM – 10:45 PM` 12, tabular) fades into that space. The two share one grid cell and cross-fade over 160 ms with a 2 px rise; neither is ever `display: none`, so the handover costs no reflow. The line that triggers it has a 10 px band — collapse as the title goes under the bar, restore only once it is 10 px clear — so resting the scroll on the handover cannot flip it back and forth. Right: save state (footnote, 7 px dot), then 44 px menu button. Desktop adds status control (34 px pill) before the menu.
Day-of right side: `🔒 View only` pill (30 px) + **Edit** text button (17/600 `--sel`). Editing on the day: amber `● Editing` pill + **Done**.

### 4.2 Summary line and filter chips
Summary: the date and time range on one caption line under the title (12/700 caps, +0.04em, `--soft`, tabular); separators `·`; no activity count. Actionable items on their own line, subhead 600, `--sel` (open time) or `--bad` (conflict) with a 13 px chevron, each given a 44 px hit area by a pseudo-element so the line still reads as one 20 px row.
Filter chips: 36 px tall, 18 px radius, 15 px text, `--surface` with hairline; selected: `--ink` fill, white text. Horizontal scroll, no scrollbar.
Pinned filter row: 44 px, `--sel-tint` glass, `Showing **Photographer** · 2 of 12` and a 44 px ✕.

### 4.3 Activity card

```
┌──────────────────────────────────────────┐
│ ▌ Getting-ready Portraits  🔒 ▤  ● Now   │  title row (17/22)
│ ▌ 12:45 – 1:15 PM   30 min               │  time (15/20, duration --ink-2 500)
│ ▌ ⚠ Runs 5 min into Ceremony             │  warning (14/600 --bad) if any
│ ▌ ▬▬▬▬▬▬▬▬▬▬───────────                  │  progress (3 px, live only)
│ ▌ ⌖ Getting-ready location · TBD         │  location (15/20 --soft)
│ ▌ (📷 Photography)                        │  stage tag (26 px)
│ ▌ (Bride) (Photographer) (+4)        ··· │  people (26 px) · dots if clipped
└──────────────────────────────────────────┘
```

- Stage bar: 3 px wide, 2 px radius, 10 px from the left, inset 8 px top/bottom (5 px on one-line cards).
- Body: left 26 px, padding 9/12 (small cards 7/12, row gap 2), row gap 4.
- One-line cards (≤10 min): title 15/18, lock, dots, start time (13 `--soft`) on one line.
- Drop order when space runs out: people → stage → location → progress → time. Title and warning never drop.
- “More” dots: three 3.5 px dots, 2.5 px apart, 9 px from right, 7 px from bottom.
- Glyphs after title: lock 15 px `--fixed` (solid), note 15 px `--faint`, `● Now` tag 20 px `--live-tint`/`--live`.
- Tags: 26 px tall, 13 px radius, 13/550; stage tag uses phase tint with phase-coloured icon; people tags use `--fill`; `+N` uses `--fill-strong` and 650.
- No drag handle. The card body is the drag surface; where there is a mouse, the grab cursor is the whole affordance. The stage bar therefore sits at its specced 10 px from the left, and the body starts at 26 px.

**Desktop card:** columns `bar | time 132 | stage 138 | title & meta (1fr) | lock`. Row 1: time range (13 `--soft`) over duration (14/600), stage tag, title (16/600) with glyphs, lock (34 px button, `#9A9CA3`, locked `--fixed`). There is no pencil and no ⋯ button on the card face — a double-click opens the editor, and Duplicate and Delete live in it. Row 2: location left, people right. Under 30 min: padding 7, people hidden, dots shown.

**States**

| State | Treatment |
|---|---|
| Rest | Rest elevation |
| Hover (desktop) | Hover elevation; controls `#5F6269`; resize handles 34×9 hollow `--sel` capsule at top (unless locked) and bottom; grab cursor on an unlocked card |
| Pressed (touch) | Scale 0.99, 100 ms |
| Charging (touch) | Scale 0.972 over the 300 ms hold, linear, with hover elevation. The press visibly deepens so the lift is telegraphed rather than sprung — with no handle to advertise the gesture, this is the affordance. |
| Focus | 2 px `--sel` ring offset 2 px |
| Selected | 2 px `--sel` ring + `0 8px 22px rgba(10,108,255,.14)`; handles 34×9 hollow `--sel` capsule top (unless locked) and bottom; body right padding 46 px |
| Resizing | Selected + snap line/label + bubble (`--ink` background, white 13/600, 10 px radius) |
| Dragging (move) | Lifted elevation, scale 1.03, **no tilt** — on a timeline the card's edges are read against the snap line, and rotating them puts the two out of parallel exactly when the reading matters; the shadow carries the elevation instead. The card follows the pointer with a live snap line/label at its new time, same treatment as resizing; a group move (§5.6 of `FUNCTIONAL_SPEC.md`) animates the other selected, unlocked cards to their new positions on release |
| Drop would overlap | Lifted card outlined 1.5 px `--bad`; both cards hatched over the exact colliding minutes and outlined as any overlap is; the snap line, its label and the bubble all turn `--bad` and the bubble reports `Overlaps N min` in place of the time |
| Live | 1.5 px `--live` outline + soft green shadow; `● Now` tag; green progress |
| Past (day-of) | Opacity 0.45 |
| Filtered out | Opacity 0.32 |
| Overlapping | 1 px `rgba(208,52,44,.45)` outline on every card in the overlap, locked or not; only the exact overlapping sub-range is hatched 135° red at 10 %/2 % (not the whole card); `Overlaps N min with <title>` warning on each |
| Overlap lanes | Equal-width lanes across however many activities overlap at once (interval-graph colouring; no fixed/overrunning asymmetry), 6 px gap; narrow cards wrap title and location, hide stage and people; red 3 px bar in the ruler over the overlap |

### 4.4 Open time block
Dashed 1.5 px `#CFCFC8`, 12 px radius, `rgba(255,255,255,.35)` fill. Centered `35 min open` (16/600 `--ink-2`), `before Ceremony` (14 `--soft`), 30 px + button. Under 70 px tall: single left-aligned line, 13/600, no button. Active (tapped) or selected: `--sel` border, `--sel-tint` fill, `--sel` text.

Same resize handles as a card (§4.3: 34×9 hollow `--sel` capsule), astride its own top/bottom edge, hidden until selected or — where there's a mouse — hovered/focused, same as a card's, thin or not. Tapping the block (anything but its + button) selects it; a tall block's + button opens the open-time actions (§5.9 of `FUNCTIONAL_SPEC.md`) directly, and — on a tall block only — so does a long press (touch) or double-click (mouse) on the block itself, the same pair of gestures a card offers alongside its own pencil icon. A thin block (under 70 px) has no room for a + button, and no long press or double-click either: selecting it and dragging its handles is all it offers, with no way to reach the open-time actions at all. Its handle touch target is 32 px rather than the usual 44 (a full-size target on both edges of a short block would cover the whole thing and leave nothing for its own tap). A handle is absent on either side where the activity it would resize is locked, same as a card's own. Whichever activity sits right against a thin block's edge leaves its own matching handle out entirely — hovering or selecting that card would otherwise draw a second, identical capsule on the exact same edge.

### 4.5 Selection toolbar (phone)
Floating, 12 px from sides, 30 px above the home indicator, 24 px radius, glass white. Context line 13 (`**Title** · time`), optional hidden-details line 13 `--soft` (single line, ellipsis). Five equal buttons 54 px tall: 22 px icon over 12 px label; Delete in `--bad`. Replaces the + button while a card is selected.

### 4.6 Live strip
Sticky under the top bar, full width, `--live-tint` at 94 % with blur, hairline `rgba(30,158,82,.18)` bottom border, no radius, no shadow.
Phone (≈58 px): line 1 — pulsing dot 8 px, `NOW` (12/700 caps `--live`), activity (16/650, ellipsis), `23 min left` right-aligned (14/600 `--live`); line 2 — indented 16 px, `Next **1:55 PM** Arrival & Buffer` (14 `--soft`). 2 px progress line along the bottom (`--live-dot` on 12 % green).
Desktop (44 px, one line): dot, `LIVE · 1:32 PM`, activity, `23 min left · ends 1:55 PM`, right-aligned `Next 1:55 PM Arrival & Buffer · location`.
Pulse: `box-shadow` ring expanding 0 → 7 px and fading, 1.8 s, infinite; disabled with reduced motion.

### 4.7 Sheets, dialogs, menus
- **Sheet (phone):** 16 px top radius, grabber 36×5, header 52 px with `Cancel` (17 `--sel`), title (17/600), `Done` (17/650 `--sel`); body padding 18/16, section gap 22. Scrim `rgba(0,0,0,.3)`.
  A sheet opens with focus on itself, never on a control inside it: focusing the first field raised the keyboard over the sheet as it was still arriving and buried the timing block, and focusing nothing at all left the ring on `Cancel` — the one button that throws the edit away. Nothing is armed, nothing is covered, and Tab walks into the fields in order.
  The grabber means what it means everywhere else: the sheet can be pulled down to dismiss. It follows the finger exactly, resists an upward pull, and the scrim lightens as it goes. Letting go past 40 % of its height, or above 0.5 px/ms, dismisses through the same path as Cancel — so a sheet with typing in it still asks, with the sheet back at rest underneath the question. The pull starts anywhere on the sheet's own chrome, and inside the scrolling body only at the very top, because below that a downward drag means scrolling back up. Wide layouts get a centred dialog and no pull.
- **Dialog (desktop):** 580 px wide, 16 px radius, same header at 15/16 px, two-column body grid where fields are short.
- **Grouped fields:** `--surface-2`, 12 px radius, 50 px rows (42 desktop), 0.5 px dividers; label left (body), value right (`--soft`).
- **Inputs:** 46 px (40 desktop), `--surface-2`, 12 px radius, 17 px text (15 desktop); focus 2 px `--sel` ring on `--surface`; error 1.5 px `--bad` ring plus message below (15 `--bad` with warning icon).
- **Segmented control:** `--fill-strong` track 9 px radius, 30 px segments, selected white with small shadow.
- **Stepper:** 36 px track, 44 px buttons, value 16/600.
- **Action sheet (phone):** two grouped cards (14 px radius); header 14/600 + 13 `--soft`; options 62 px min, centered, 18 px `--sel` title + 13 `--soft` description; separate Cancel 58 px 18/650.
- **Menu:** 250 px, 14 px radius, rows 46 px, icon 19 px + 17 px text; value or switch right-aligned; 6 px separators between groups. Desktop menus 15 px text, 40 px rows.
- **Alert:** 36 px side margins, 18 px radius, icon well 44 px, title 17/650, body 14, stacked 46 px buttons (primary filled `--sel`), footnote 13.
- **Drop line:** 2 px `--sel` centred on the minute being snapped to, with a 7 px leading dot, spanning the plan column; red when landing there would overlap. Drawn in the plan layer, above every card and below the lifted one — the ruler is painted first, so a tick is always behind the card it is placing — and positioned from the clock, not by finding a tick, so it exists at every minute including those outside the ruler's range. The card's own top border settles the usual 2 px inset below it: cards sit inside their lines, they do not stand on them.
- **Toast:** dark `rgba(28,28,30,.96)` in both themes, 16 px radius, 50 px min height, 14 px text, `Undo` 15/650 `#7FB3FF`; phone 16 px side margins, floated 20 px above whatever occupies the bottom of the screen — the floating + or the taller selection toolbar, measured rather than assumed; desktop centered 28 px from bottom. Auto-hide 6 s; one at a time. The countdown is *unattended* time: it stops while a pointer is over the toast or focus is inside it, and resumes on the way out, because Undo is the only way back from a delete. A toast can also be swiped **right** to dismiss — it follows the finger, resists leftward, and leaves past 28 px or 0.4 px/ms. Down was the wrong axis: the toast already sits at the bottom of the screen, so a few pixels of thumb travel dismissed it by accident, and sideways is the reach every notification list has taught. It is `touch-action: pan-y`, so a finger that lands on it while scrolling the day still scrolls the day.
- **Pinned bars** (offline, filter): 44 px min, glass, 14–15 px text, sticky under the top bar.

### 4.8 Buttons
Primary 50 px (phone) / 40 px (desktop), 14/12 px radius, `--ink` fill, white 17/15 px 600. Secondary: `#EDEDE9` fill, `--ink`. Text buttons: `--sel`, 44 px hit area. Destructive: `--bad` text. Icon buttons: 44 px hit area, 22 px icon. Floating add: 58 px circle, `--ink`, 26 px +, shadow `0 10px 26px rgba(0,0,0,.25)`.

### 4.9 Empty, loading, error
- Empty plan card: centered, 18 px radius, icon well 48 px (brand colour icon), Title 3, subhead text, primary + secondary buttons.
- Loading: nothing at all for the first 400 ms, then a skeleton of 3 cards at their rest height pattern (240 / 120 / 360 px), in the real page padding, so the plan arrives into the shape it was drawn in. Never a spinner.
- Load failure: centered message + Retry (primary); never an empty timeline.

### 4.10 Print
White A4/Letter, 44/52 px margins, header rule 1.5 px black; phase group labels 11 px caps with a 10 px colour square; rows `150 px time | details` with 0.5 px dividers; `Fixed` as a small outlined label; notes italic. No colour fills other than the phase squares.

---

## 5. Layout and responsiveness

- **One width breakpoint: 720 px.** ≤720: phone layout (sheets, toolbar, floating add, collapsed-title behaviour). >720: desktop layout (dialogs, inline card controls, header add button). Content max width 1100 px, centered.
- **Input capability decides interaction**, not width: `(hover:hover) and (pointer:fine)` enables hover controls and edge handles on hover; coarse pointers use the selection model at any width (iPad, touch laptops).
- Card content adapts to the card's own height and width through fitting (drop order + `+N` tags), not through extra breakpoints. A card being resized re-fits as it goes, on every frame its height changes — density is handled by showing less, and a resize is the one gesture where density is visibly changing.
- Narrow phones (320 px): ruler 48 px, plan starts at 54 px; filter chips scroll; toolbar labels may drop to icons only below 340 px.
- Landscape phones: respect `env(safe-area-inset-left/right)` on the top bar, strip, timeline and toolbar.
- Safe areas: top bar pads `env(safe-area-inset-top)` in standalone mode; toolbar, toasts and floating add sit above `env(safe-area-inset-bottom)`.
- Use `dvh` for sheet heights; sheets scroll their body and keep the header visible; focused fields scroll into view above the keyboard. `dvh` follows the browser's chrome, not the keyboard, so the sheet is lifted by `--keyboard-inset`, read from `visualViewport` and 0 wherever the platform already shrinks the layout viewport itself.
- Two measured insets, published as custom properties and used for scroll margins: `--sticky-inset` (the top bar plus whichever of the live strip and the pinned bars are showing) and `--bottom-furniture` (the floating + or the selection toolbar). Nothing scrolled into view may land under either.
- The page sets `overscroll-behavior-y: contain`: a flick at the top of the plan belongs to the plan, not to the browser's pull-to-refresh.
- Horizontal scrollers with hidden scrollbars (the filter chips) fade 24 px on whichever side has more to show, and neither side when the row fits.

---

## 6. Motion

Every number below is a token in `tokens.css` — `--dur-quick|base|lift|sheet|sheet-out`, `--ease-out|lift|sheet` — and component CSS references the token, never the value. Two curves and no more: `--ease-lift` is the one overshoot, `--ease-sheet` carries anything arriving from an edge, everything else is a plain ease-out.

| What | Duration | Easing |
|---|---|---|
| Hover, pressed | 100–160 ms | ease-out |
| Charging press (touch) | the hold's own 300 ms | linear |
| Lift | 210 ms | `cubic-bezier(.2,.9,.3,1.25)` — the one overshoot in the app |
| Selection ring, handles, toolbar in/out | 180 ms | ease-out (toolbar slides 12 px + fade) |
| Sheet / dialog / action sheet / alert | 240 ms in, 200 ms out | `cubic-bezier(.2,.8,.2,1)` |
| A card row returning after a re-fit | 140 ms (fade + 3 px rise) | ease-out |
| Neighbours during drag, cards after a committed change | 180 ms `transform` | ease-out |

A region is repainted by replacing its HTML, so the settle after a committed change is done with FLIP (`render/settle.js`): measure, paint, invert, release. It is measured against the clock rather than the page — the visible range starts half an hour before the first activity, so moving that activity re-bases every pixel on the timeline, and a page-space comparison would animate the whole day sliding for one card's nudge. Cards, open-time blocks and the end marker all settle; a card that ends up where it already is does not move, which is why a committed drag stays put and a cancelled one eases back. Interrupting a settle continues from where the card actually is, not from where it started.
| Active resize edge, dragged card | **none** (follows pointer) | — |

The lift is on the individual `scale` property and the travel on `translate`, so the hand is never eased and the card springs out of the squeeze the press held it in rather than popping between two sizes. A lifted card translates *then* scales, anchored at its top edge (`transform-origin: 50% 0`). Scaling first multiplies the travel — three per cent of it — so a long drag left the card below the finger and off the line placing it, by more the further it went; scaling about the centre added a second drift that varied with the card's height. Both edges a drag is read against now sit exactly where the clock says.

**Sharp for what you did; smooth for what the system did.** The lift is the only moment that overshoots, because it confirms an act. Everything that follows from it — the settle, neighbours moving, a cancelled drag returning — stays on the calm curve.
| Live pulse | 1.8 s loop | ease-out |
| Toast | 200 ms | ease-out |

Every dialog arrives *and* leaves. The old rule animated only the way in, because a `<dialog>` drops out of the top layer the moment it closes and an exit would have meant leaving a closed sheet lying over the page. `overlay` is transitionable, so with `allow-discrete` it stays in the top layer for exactly the length of its exit and no longer; app.js keeps the node for that long, marks it `inert`, and a dialog opening supersedes one still leaving. The two action sheets and the alert, which had no motion at all, now arrive on the same curve as the sheet they interrupt — an alert settles in place (fade + `scale(.96)`), anything anchored to an edge rises from it.

A card resized across a density boundary re-fits as it goes, and a row *returning* fades in over 140 ms. A row leaving is not animated: the card's own edge is moving over it at that moment, and the fit pass measures the rows it has just hidden, so deferring their `display` would make it measure a card that no longer exists.

Motion happens after release, never during. `prefers-reduced-motion: reduce` removes all movement and the pulse (opacity changes allowed). One exception is made by name: the charging press is the *only* thing that says a lift is coming, so under reduced motion the scale is dropped and a `--sel` ring fades in over the same 300 ms instead. Removing it outright would leave a reader who asked for less motion with no warning at all.

**Haptics** (`haptics.js`) are two words and stay two. A **tick** (8 ms) says *that happened*: a card lifting, a card landing, an open-time block's long press opening its sheet, a sheet pulled away, a toast swiped off. A **bump** (two taps) says *and it was the destructive one, or the wrong one*: an undo, and a drag crossing into a collision — announced once on the way in, never repeated while it lasts. Anything finer, such as a pulse per five-minute step, is a buzz rather than feedback. Every one of these moments already says what it is on screen; the tap is the second telling, never the only one.

iOS has no Vibration API at all — not Safari, not a home-screen PWA — and there is no supported way to ask WebKit for a haptic. iOS is silent; that is not a reason to withhold it from Android and installed PWAs.

---

## 7. Touch and pointer

- Touch targets ≥ 44 × 44 pt; visible glyphs may be smaller.
- Handles: visible 34×9 hollow `--sel` capsule (`--surface` fill, 2 px border), centered astride the card's top/bottom edge line, not inset from it; hit area 44 px tall × 120 px wide, centered on the edge, extending outward only on the selected card.
- Hold to lift a card: 300 ms, with immediate pressed state that deepens across the hold. Long enough to rule out the stationary beat before a swipe, short enough not to feel like a wait — Apple's 500 ms is for presses that are *contended*, and here the only rival is scrolling, which movement already settles.
- Movement thresholds: 6 px for tap vs drag; **3 px** for a pointer to lift a card (AppKit's own drag threshold, safe because anything under 10 px rounds to zero minutes); **10 px vertical / 20 px horizontal** to cancel a hold. The cancel is judged per axis, not by distance: the competing gesture is a vertical scroll, and sideways drift is a thumb pivoting around its knuckle.
- Autoscroll while dragging: edge zone 72 px for a fine pointer, 15 % of the viewport (64–120 px) for a coarse one, tightening to 64 px at the bottom on touch because a thumb rests low. Speed 60 → 720 px/s, rising with the square of the depth past the boundary, eased in over 120 ms and scaled by elapsed time rather than counted per frame.
- `-webkit-touch-callout: none` and `user-select: none` on cards and handles; text in sheets remains selectable.

---

## 8. Accessibility

- Contrast ≥ 4.5:1 text, ≥ 3:1 icons/borders (checked in both themes). Unlocked lock icon on desktop uses `#8E9098` minimum.
- Focus ring on every control: 2 px `--sel`, 2 px offset; never removed.
- Icon-only buttons have labels (`Lock Getting-ready Portraits`).
- Card accessible name: `Getting-ready Portraits, 12:45 to 1:15 PM, 30 minutes, Photography, locked` (+ hidden details).
- Colour is never the only signal: locked has a lock icon, overlap has an icon and text, live has “Now”.
- Reduced motion and larger text (browser zoom to 200 %) keep the layout usable; card text wraps rather than overlaps.

---

## 9. Writing style

- Plain, short, sentence case. No exclamation marks.
- Times: `2:45 PM`; ranges `12:45 – 1:15 PM` (drop the first AM/PM when both match); durations `30 min`, `1 hr`, `1 hr 30 min`.
- Name things the way the couple would: “Locked” (the current term — superseded the earlier “Fixed”, which no longer means the same thing since the timeline rewrite removed the flexible/fixed chain), “Open time” (not “gap”), “Changed on another device”, “Not saved”.
- Toasts say what happened and offer the fix: `Deleted Toast · Undo`, `Locked <title> · Undo`. There is no “N activities shifted” toast any more — locking, unlocking, resizing and moving one activity never shift another.
- Errors say what to do: “That password didn't work. Try again.”, “Name can't be empty.”

---

## 10. Do and don't

| Do | Don't |
|---|---|
| Shrink content to fit true time | Give cards a minimum height that shifts them |
| Show hidden details on selection | Show details on hover only |
| Use blue for anything selected or tappable | Use blue for live or locked |
| Keep red for problems and delete | Colour the lock red |
| Show a live snap line/label at the time the card will land, exactly like a resize | Show a floating “Drop here” pill or a discrete insertion line by list position |
| Show full names then `+N` | Show initials |
| Use sheets on phone, dialogs on desktop | Use browser `confirm()` / `alert()` |
| Animate after commit | Animate an edge or a dragged card behind the finger |
