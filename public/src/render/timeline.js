import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { buildSchedule, buildTimelineLayout, formatTime, parseTime } from '../schedule.js';
import { renderCard } from './card.js';

/**
 * Scale and tick placement are still the pre-redesign ones; the time-true grid
 * (4 px per minute, lines every five minutes, cards on their exact edges)
 * belongs to the timeline stage. What changes here is only that the timeline is
 * a region that repaints on its own.
 */
export function timeScale(plan, schedule) {
  const configuredStart = parseTime(plan.dayStart) ?? schedule.items[0]?.start ?? 8 * 60;
  const firstStart = schedule.items.length ? Math.min(...schedule.items.map(item => item.start)) : configuredStart;
  const start = Math.floor(Math.min(configuredStart, firstStart) / 15) * 15;
  const end = Math.ceil(Math.max(schedule.end, start + 60) / 15) * 15;
  return { start, end, minutePx: 2.6, height: (end - start) * 2.6 + 24 };
}

function ticks(scale) {
  const out = [];
  for (let minute = scale.start; minute <= scale.end; minute += 15) {
    const withinHour = ((minute % 60) + 60) % 60;
    const kind = withinHour === 0 ? 'hour' : withinHour === 30 ? 'half' : 'quarter';
    const label = kind === 'hour' ? formatTime(minute) : formatTime(minute).replace(/\s[AP]M$/, '');
    out.push(`<div class="timeline-tick timeline-tick--${kind}" style="top:${((minute - scale.start) * scale.minutePx).toFixed(1)}px"><span>${escapeHtml(label)}</span><i></i></div>`);
  }
  return out.join('');
}

export function renderTimeline({ plan, ui }) {
  const schedule = buildSchedule(plan);
  const scale = timeScale(plan, schedule);
  const layout = buildTimelineLayout(schedule, { scaleStart: scale.start, minutePx: scale.minutePx });
  const canvasHeight = Math.max(scale.height, layout.height);

  return `<div class="timeline-labels" aria-hidden="true"><span>Time</span><span>Plan</span></div>
    <div id="activity-list" class="timeline-canvas" style="height:${canvasHeight.toFixed(1)}px">
      <div class="timeline-ruler" aria-hidden="true">${ticks(scale)}</div>
      <div class="timeline-plan">${layout.rows.map(visual => renderCard(visual.item, { index: visual.index, visual, ui })).join('')}</div>
      <div class="end-marker" style="top:${layout.endTop.toFixed(1)}px"><span>${escapeHtml(schedule.endLabel)}</span><i></i><strong>End of day</strong></div>
    </div>`;
}

export function renderHeading({ plan }) {
  return `<div>
      <p class="eyebrow">One-day planner</p>
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
