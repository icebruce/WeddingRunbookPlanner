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

  const rails = layout.conflictRails.map(rail =>
    `<div class="conflict-rail" style="top:${rail.top}px;height:${rail.height}px" title="${escapeHtml(`${rail.minutes} min overlap`)}"></div>`
  ).join('');

  const sunset = layout.sunset
    ? `<div class="sunset-line" style="top:${layout.sunset.top}px"></div>
       <div class="sunset-pill" style="top:${layout.sunset.top - 11}px">${icon('sun')}<span>${escapeHtml(formatTime(layout.sunset.minutes, { meridiem: false }))}</span></div>`
    : '';

  return `${lines}${rails}${sunset}`;
}

/**
 * Open time is drawn, not implied. Under about 70 px there is no room for the
 * second line or the + button, so it becomes a single line.
 */
function openTimeBlock(gap) {
  const thin = gap.height < 70;
  return `<div class="open-time ${thin ? 'open-time--thin' : ''}" style="top:${gap.top}px;height:${gap.height}px"
    data-action="open-time" data-before="${escapeHtml(gap.beforeId)}" data-start="${gap.start}" data-end="${gap.end}"
    role="button" tabindex="0" data-focus-key="open-time:${escapeHtml(gap.beforeId)}"
    aria-label="${escapeHtml(`${formatDuration(gap.minutes)} open before ${gap.beforeTitle}, ${formatTime(gap.start)} to ${formatTime(gap.end)}`)}">
    <strong>${escapeHtml(formatDuration(gap.minutes))} open</strong>
    ${thin ? '' : `<small>before ${escapeHtml(gap.beforeTitle)}</small><span class="open-time-add">${icon('plus')}</span>`}
  </div>`;
}

/**
 * The open menu, drawn above the cards rather than inside one. A card is
 * clipped to its duration, so a menu inside a short card would be cut off.
 */
function menuLayer(layout, ui) {
  const match = /^(stage|card-menu):(.+)$/.exec(ui.openMenu || '');
  if (!match) return '';
  const [, kind, id] = match;
  const card = layout.cards.find(entry => entry.item.id === id);
  if (!card) return '';

  const top = card.top + (kind === 'stage' ? 34 : 40);
  const side = kind === 'stage' ? 'left:8px' : 'right:4px';
  return `<div class="card-menu-layer" style="top:${top}px;${side}">${renderCardMenu(card.item, kind)}</div>`;
}

export function renderTimeline({ plan, ui }) {
  const schedule = buildSchedule(plan);
  const layout = buildLayout(plan, schedule);

  return `<div class="timeline-grid" style="height:${layout.height + 48}px">
    <div class="timeline-ruler" aria-hidden="true">${ruler(layout)}</div>
    <div class="timeline-plan">
      ${layout.openTimes.map(openTimeBlock).join('')}
      ${layout.cards.map(card => renderCard(card, { ui, filter: ui.filter })).join('')}
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
 */
export function renderSummary({ plan, ui }) {
  const schedule = buildSchedule(plan);
  const { summary } = schedule;
  if (!summary.count) return '';

  const links = [];
  if (summary.openMinutes) {
    links.push(`<button type="button" class="summary-link" data-action="jump" data-target="open-time">${escapeHtml(formatDuration(summary.openMinutes))} open${icon('chevron')}</button>`);
  }
  if (summary.conflictMinutes) {
    links.push(`<button type="button" class="summary-link summary-link--bad" data-action="jump" data-target="conflict">${icon('warning')}${escapeHtml(formatDuration(summary.conflictMinutes))} conflict${icon('chevron')}</button>`);
  }

  return `<p class="summary">
    <span>${escapeHtml(formatTime(summary.start))} – ${escapeHtml(formatTime(summary.end))}</span>
    <span class="summary-sep">·</span>
    <span>${summary.count} ${summary.count === 1 ? 'activity' : 'activities'}</span>
    ${links.length ? `<span class="summary-break"></span>${links.join('')}` : ''}
  </p>`;
}

export function renderHeading({ plan }) {
  return `<div>
      <h1>${escapeHtml(plan.title)}</h1>
      <p class="planner-date">${escapeHtml(formatPlanDate(plan.date))}</p>
    </div>
    <div class="planner-add-wrap">
      <button class="button button--primary planner-add" type="button" data-action="add" data-focus-key="add">${icon('plus')}<span>Add activity</span></button>
      <p class="add-hint">Adds after the selected activity</p>
    </div>`;
}

export function formatPlanDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}
