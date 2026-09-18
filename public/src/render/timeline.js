import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { buildLayout } from '../layout.js';
import { buildSchedule, formatDuration, formatTime } from '../schedule.js';
import { renderCard, renderCardMenu } from './card.js';

/** Hour, half hour and quarter hour are labelled; five-minute lines are not. */
function tickLabel(minute) {
  const withinHour = ((minute % 60) + 60) % 60;
  if (withinHour === 0) return formatTime(minute);
  return formatTime(minute, { meridiem: false });
}

function ruler(layout) {
  const lines = layout.ticks.map(tick =>
    `<div class="tick tick--${tick.kind}" style="top:${tick.top}px"><s></s>${tick.labelled ? `<b>${escapeHtml(tickLabel(tick.minute))}</b>` : ''}</div>`
  ).join('');

  const sunset = layout.sunset
    ? `<div class="sunset-line" style="top:${layout.sunset.top}px"></div>
       <div class="sunset-pill" style="top:${layout.sunset.top - 11}px">${icon('sun')}<span>${escapeHtml(formatTime(layout.sunset.minutes, { meridiem: false }))}</span></div>`
    : '';

  return `${lines}${sunset}`;
}

/**
 * Open time is drawn, not implied. Under about 70 px there is no room for the
 * second line or the + button, so it becomes a single line.
 *
 * It behaves like a card in every size: tapping its body selects it
 * (revealing the resize handles), the same select-to-reveal model a card
 * uses, hidden otherwise — never always-visible, thin or not. A tall block's
 * own + button opens the actions sheet directly, and a long press (touch) or
 * double-click (mouse) on the block is a second way there too — see
 * gestures.js's onOpenTimePointerDown/onOpenTimeActivate and app.js's
 * `onOpenTimeActivate` wiring — mirroring how a card offers its pencil icon
 * *and* long-press/double-click into the same editor. A thin block has no +
 * and no long-press/double-click either: with no room for the sheet's own
 * button, the handles are what it offers, nothing more — see gestures.js,
 * which reads this same 70 px line off `.open-time--thin` to skip arming
 * either gesture there.
 *
 * The handles are the same `.handle` control a card uses, just aimed at a
 * neighbour: the top one is the previous activity's own bottom handle in
 * disguise (`data-role="resize"` against `afterId`, the activity this gap is
 * right after), and the bottom one is the next activity's own top handle
 * (`data-role="resize-top"` against `beforeId`, the activity this gap is
 * right before) — see gestures.js and schedule.js's `afterId`/`afterTitle`.
 * Reusing those roles means the existing pointer and keyboard resize wiring
 * needs no changes at all to pick them up. Either is absent when the
 * activity it would resize is locked — same rule a card's own handle
 * follows.
 */
function openTimeBlock(gap, ui, viewOnly) {
  const thin = gap.height < 70;
  const selected = ui.selectedOpenTime === gap.beforeId;
  const label = escapeHtml(`${formatDuration(gap.minutes)} open before ${gap.beforeTitle}, ${formatTime(gap.start)} to ${formatTime(gap.end)}`);

  const bodyAttrs = viewOnly ? '' : `data-action="select-open-time" data-before="${escapeHtml(gap.beforeId)}"
    data-start="${gap.start}" data-end="${gap.end}" role="button" tabindex="0" aria-pressed="${selected}"`;

  const addButton = thin ? '' : `<button type="button" class="open-time-add" data-action="open-time"
      data-before="${escapeHtml(gap.beforeId)}" data-start="${gap.start}" data-end="${gap.end}"
      tabindex="${selected ? '0' : '-1'}" data-focus-key="open-time-add:${escapeHtml(gap.beforeId)}"
      aria-label="${escapeHtml(`Add time before ${gap.beforeTitle}`)}">${icon('plus')}</button>`;

  // These carry their own focus-key, distinct from the target activity's own
  // handle (`resize:${id}` / `resize-top:${id}` on the card itself) — two
  // different elements can drive the same edge, and app.js's keyboard
  // handler returns focus to whichever one was actually used, by reading it
  // straight off that element rather than reconstructing it from role+id.
  const handles = viewOnly ? '' : `${gap.afterLocked ? '' : `<button type="button" class="handle handle--top" data-role="resize" data-id="${escapeHtml(gap.afterId)}"
      tabindex="${selected ? '0' : '-1'}" data-focus-key="resize:gap:${escapeHtml(gap.beforeId)}"
      aria-label="${escapeHtml(`Resize the end of ${gap.afterTitle}`)}"></button>`}
    ${gap.beforeLocked ? '' : `<button type="button" class="handle handle--bottom" data-role="resize-top" data-id="${escapeHtml(gap.beforeId)}"
      tabindex="${selected ? '0' : '-1'}" data-focus-key="resize-top:gap:${escapeHtml(gap.beforeId)}"
      aria-label="${escapeHtml(`Resize the start of ${gap.beforeTitle}`)}"></button>`}`;

  return `<div class="open-time ${thin ? 'open-time--thin' : ''} ${selected ? 'is-selected' : ''}" style="top:${gap.top}px;height:${gap.height}px"
    ${bodyAttrs} data-focus-key="open-time:${escapeHtml(gap.beforeId)}" aria-label="${label}">
    <strong>${escapeHtml(formatDuration(gap.minutes))} open</strong>
    ${thin ? '' : `<small>before ${escapeHtml(gap.beforeTitle)}</small>${addButton}`}
    ${handles}
  </div>`;
}

/**
 * The stage menu, drawn above the cards rather than inside one. A card is
 * clipped to its duration, so a menu inside a short card would be cut off.
 */
function menuLayer(layout, ui) {
  const match = /^stage:(.+)$/.exec(ui.openMenu || '');
  if (!match) return '';
  const card = layout.cards.find(entry => entry.item.id === match[1]);
  if (!card) return '';

  return `<div class="card-menu-layer" style="top:${card.top + 34}px;left:8px">${renderCardMenu(card.item)}</div>`;
}

/**
 * The current time, drawn across the plan with its own pill in the ruler. It
 * runs behind the cards: it is a reading of where the day has got to, not
 * another thing competing for attention.
 */
function nowLine(layout, nowMinutes) {
  if (nowMinutes === null || nowMinutes < layout.from || nowMinutes > layout.to) return '';
  const top = (nowMinutes - layout.from) * 4;
  return `<div class="now-line" style="top:${top}px"></div>
    <div class="now-pill" style="top:${top - 11}px">${escapeHtml(formatTime(nowMinutes, { meridiem: false }))}</div>`;
}

export function renderTimeline({ plan, ui }) {
  const schedule = buildSchedule(plan);
  const layout = buildLayout(plan, schedule);
  const nowMinutes = ui.dayOf ? (ui.nowMinutes ?? null) : null;

  // `data-from` is the minute the grid starts at. The clock moves the now-line
  // and the live progress bar in place from it, twice a minute, rather than
  // repainting every card to shift one line two pixels.
  return `<div class="timeline-grid ${ui.dayOf ? 'is-day-of' : ''}" data-from="${layout.from}" style="height:${layout.height + 48}px">
    <div class="timeline-ruler" aria-hidden="true">${ruler(layout)}${nowLine(layout, nowMinutes)}</div>
    <div class="timeline-plan">
      ${layout.openTimes.map(gap => openTimeBlock(gap, ui, Boolean(ui.dayOf && !ui.editingOnDay))).join('')}
      ${layout.cards.map(card => renderCard(card, { ui, filter: ui.filter, nowMinutes })).join('')}
      ${menuLayer(layout, ui)}
    </div>
    <div class="timeline-end" style="top:${layout.endTop + 10}px">
      <span>${escapeHtml(formatTime(schedule.dayEnd))}</span><i></i><span>End of day</span>
    </div>
  </div>`;
}

/**
 * The summary is plain text; only the parts worth acting on look tappable, and
 * tapping one scrolls to the first open time or conflict (D11).
 *
 * The date lives here rather than under the title, so that "when" is one line
 * — the day and the hours it runs — instead of two stacked ones. It is shown
 * even before the first activity exists: an empty plan still has a day. The
 * activity count is gone; the start and end already say how big the day is,
 * and the count is still on every version row and the filter bar, where it
 * answers a question someone is actually asking.
 */
export function renderSummary({ plan, ui }) {
  // Not on the day (D25). The strip already answers what is happening and what
  // is next, the span is in the top bar, and neither open time nor a conflict
  // is something anyone acts on while the day is running — acting on one means
  // pressing Edit first.
  if (ui?.dayOf) return '';

  const { summary } = buildSchedule(plan);

  const range = summary.count
    ? `<span class="summary-sep" aria-hidden="true">·</span>
       <span>${escapeHtml(formatTime(summary.start))} – ${escapeHtml(formatTime(summary.end))}</span>`
    : '';

  const links = [];
  if (summary.openMinutes) {
    links.push(`<button type="button" class="summary-link" data-action="jump" data-target="open-time">${escapeHtml(formatDuration(summary.openMinutes))} open${icon('chevron')}</button>`);
  }
  if (summary.conflictMinutes) {
    links.push(`<button type="button" class="summary-link summary-link--bad" data-action="jump" data-target="conflict">${icon('warning')}${escapeHtml(formatDuration(summary.conflictMinutes))} conflict${icon('chevron')}</button>`);
  }

  return `<div class="summary">
    <p class="summary-meta">${escapeHtml(shortPlanDate(plan.date))}${range}</p>
    ${links.length ? `<p class="summary-links">${links.join('')}</p>` : ''}
  </div>`;
}

export function renderHeading({ plan, ui }) {
  // Adding is editing, so on the day this is not offered until Edit has been
  // pressed — the same rule the + on a phone follows.
  const viewOnly = Boolean(ui?.dayOf && !ui?.editingOnDay);
  // On the day the title moves into the top bar (D25). A large title that
  // scrolls away behind the live strip earns nothing on the one day the strip
  // is the header — and the handover happened where nobody could see it.
  const heading = ui?.dayOf ? '' : `<div>
      <h1>${escapeHtml(plan.title)}</h1>
    </div>`;
  return `${heading}
    ${viewOnly ? '' : `<div class="planner-add-wrap">
      <button class="button button--primary planner-add" type="button" data-action="add" data-focus-key="add">${icon('plus')}<span>Add activity</span></button>
      <p class="add-hint">Adds after the selected activity</p>
    </div>`}`;
}

/**
 * `Sat, Nov 21` — the one short-date form in the app, shared by the summary
 * meta line and the collapsed title in the top bar, which have to agree.
 */
export function shortPlanDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}
