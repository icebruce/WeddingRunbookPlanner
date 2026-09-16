/**
 * The live strip (D13).
 *
 * A slim band under the top bar that answers the only two questions anyone has
 * on the day: what is happening now, and what is next. It is green on a light
 * tint rather than a dark full-height card, because it sits above the plan all
 * day and has to be readable at a glance without taking the screen.
 *
 * It is a `role="status"`, and its text changes only when the current activity
 * changes — a countdown that re-announced itself every thirty seconds would
 * make the app unusable with a screen reader.
 */
import { escapeHtml } from '../dom.js';
import { formatTime } from '../schedule.js';

export function renderStrip({ ui, strip }) {
  if (!ui.dayOf || !strip) return '';

  const progress = Math.max(0, Math.min(1, strip.progress ?? 0));
  const next = strip.next
    ? `Next <b>${escapeHtml(formatTime(strip.next.start))}</b> ${escapeHtml(strip.next.title)}`
    : '';

  return `<div class="live-strip" role="status" aria-label="${escapeHtml(announcement(strip))}">
    <div class="live-line">
      <span class="live-dot" aria-hidden="true"></span>
      <span class="live-label">Now</span>
      <span class="live-activity">${escapeHtml(strip.headline)}</span>
      ${strip.remainingLabel ? `<span class="live-remaining">${escapeHtml(strip.remainingLabel)}</span>` : ''}
    </div>
    <div class="live-second">${strip.detail && strip.kind !== 'during' ? escapeHtml(strip.detail) : next}
      ${strip.overrunning ? `<span class="live-over">Also now: ${escapeHtml(strip.overrunning.title)}</span>` : ''}
    </div>
    <div class="live-progress" aria-hidden="true"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>
  </div>`;
}

/**
 * What a screen reader hears. Deliberately without the countdown: it is read
 * when the activity changes, and "23 minutes left" would be wrong by the time
 * it finished being spoken.
 */
function announcement(strip) {
  if (strip.kind === 'during') return `Now: ${strip.headline}`;
  if (strip.kind === 'before') return `${strip.headline}. ${strip.detail ?? ''}`;
  if (strip.kind === 'open') return `Open. ${strip.detail ?? ''}`;
  return strip.headline;
}
