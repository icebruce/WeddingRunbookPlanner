/**
 * The live panel (D13).
 *
 * A dark card under the top bar that answers the only two questions anyone has
 * on the day: what is happening now, and what is next. It is a graphite panel
 * rather than a green band because green was doing six jobs at once — surface,
 * border, progress track, progress fill, pulse and label — and nothing read as
 * distinct. On the panel green means one thing only: live.
 *
 * It is a `role="status"`, and its text changes only when the current activity
 * changes — a countdown that re-announced itself every thirty seconds would
 * make the app unusable with a screen reader.
 */
import { escapeHtml } from '../dom.js';
import { formatTime } from '../schedule.js';

/**
 * The word beside the dot. It names the state rather than repeating the line
 * below it: "Open" is the whole headline in that state, so the headline slot
 * carries the countdown to what is next instead.
 */
const KICKERS = { during: 'Now', before: 'Soon', open: 'Open' };

/** What the big line says. Everything but an open gap leads with its headline. */
function headlineOf(strip) {
  if (strip.kind === 'open' && strip.detail) return strip.detail;
  return strip.headline;
}

export function renderStrip({ ui, strip }) {
  if (!ui.dayOf || !strip) return '';

  const progress = Math.max(0, Math.min(1, strip.progress ?? 0));
  // Nothing is running before the day starts or after it ends, so there is no
  // measure to draw and the card ends flat.
  const hasProgress = strip.kind === 'during' || strip.kind === 'open';
  const kicker = KICKERS[strip.kind];
  const live = strip.kind === 'during';

  return `<div class="live-strip" role="status" aria-label="${escapeHtml(announcement(strip))}">
    <div class="live-panel">
      <div class="live-head">
        <span class="live-dot ${live ? '' : 'is-still'}" aria-hidden="true"></span>
        ${kicker ? `<span class="live-label">${kicker}</span>` : ''}
        <span class="live-clock">${escapeHtml(strip.clockLabel ?? '')}</span>
      </div>
      <div class="live-activity">${escapeHtml(headlineOf(strip))}</div>
      ${secondLine(strip)}
      ${hasProgress ? `<div class="live-progress" aria-hidden="true"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>` : ''}
    </div>
  </div>`;
}

/**
 * Three tiers, and each colour means something: green is what is running now,
 * white is what is coming, and the words around them recede. The line is empty
 * in the states that have nothing to put on it, and is left out entirely
 * rather than reserving space for it.
 */
function secondLine(strip) {
  const now = nowSide(strip);
  const next = nextSide(strip);
  if (!now && !next) return '';
  return `<div class="live-second">${now}${next}</div>`;
}

function nowSide(strip) {
  if (strip.kind === 'during') {
    const ends = strip.current?.endLabel;
    return `<span class="live-now">
      <b class="live-remaining">${escapeHtml(strip.remainingLabel ?? '')}</b>${ends ? `<span class="live-ends">· ends ${escapeHtml(ends)}</span>` : ''}
    </span>`;
  }
  // Before the day starts, the detail is which activity opens it and when.
  if (strip.kind === 'before' && strip.detail) {
    return `<span class="live-now"><span class="live-opens">${escapeHtml(strip.detail)}</span></span>`;
  }
  return '';
}

/**
 * An overrun replaces what is next: two things running at once is the more
 * urgent fact, and it is the one thing on the panel that is not green.
 */
function nextSide(strip) {
  if (strip.overrunning) {
    return `<span class="live-over">Also now: ${escapeHtml(strip.overrunning.title)}</span>`;
  }
  // Before the day starts, what is "next" is the activity that opens it, which
  // the line beside this one already names — printing it twice said nothing
  // twice.
  if (!strip.next || strip.kind === 'before') return '';
  return `<span class="live-next">
    <span class="live-next-label">Next</span><b>${escapeHtml(formatTime(strip.next.start))}</b><span class="live-next-title">${escapeHtml(strip.next.title)}</span>
  </span>`;
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
