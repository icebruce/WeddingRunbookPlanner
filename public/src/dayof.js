/**
 * The day itself (D1).
 *
 * Planning and running are different jobs. On the day, the plan is something
 * to read at a glance while carrying flowers, and the last thing anyone needs
 * is a stray thumb changing when the ceremony starts. So the day-of view is
 * read-only until someone says otherwise, and it says what is happening now
 * rather than making them work it out from a timeline.
 *
 * Everything here is pure except `createClock`: what the view shows is a
 * function of the plan and the current minute, which is what makes it
 * testable at 23:59 and at 00:00.
 */
import { buildSchedule, formatCountdown, formatTime } from './schedule.js';
import { DEFAULT_TIMEZONE } from './validate.js';

/** How often the strip re-reads the clock. */
export const TICK_MS = 30_000;
/**
 * Whether the plan is being read rather than built.
 *
 * Two different reasons give the same answer: it is the day and nobody has
 * tapped Edit, or this is a share link, where there is no Edit to tap. The
 * renderers ask this one question instead of each re-deriving it, so a third
 * reason would not need finding in four places.
 */
export function isViewOnly(ui) {
  return Boolean(ui?.viewOnly || (ui?.dayOf && !ui?.editingOnDay));
}

/** Away this long and the day-of view goes back to read-only. */
export const AUTO_VIEW_ONLY_MS = 5 * 60_000;

/**
 * Everything below reads the clock at the venue, not the clock on the device.
 *
 * It used to read the device's, which was invisible while the only people
 * looking were in the same city as the wedding. A plan shared by link is not
 * read from one city: "is it the day yet" and "what is happening now" are
 * questions about where the wedding is, and answered anywhere else they are
 * simply wrong — by the reader's offset, every time.
 *
 * The zone is a name (`America/Toronto`), never a fixed offset. A fixed −05:00
 * would be right on the wedding day and wrong for the eight months of planning
 * that run through daylight time.
 */
function zoneOf(plan) {
  return plan?.timezone || DEFAULT_TIMEZONE;
}

const zoneFormatters = new Map();

function formatterFor(timeZone) {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch {
      // An unknown zone name should not stop the day working; the device's own
      // clock is a worse answer than the venue's, and a better one than none.
      formatter = new Intl.DateTimeFormat('en-CA', {
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function partsIn(timeZone, date) {
  const parts = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** `YYYY-MM-DD` as the venue reads it right now. */
export function zonedDate(timeZone, now = new Date()) {
  const { year, month, day } = partsIn(timeZone, now);
  return `${year}-${month}-${day}`;
}

/**
 * How far the zone is from UTC at a given instant, in milliseconds. Asked of
 * the engine rather than tabulated, so daylight time needs no calendar here.
 */
function offsetAt(timeZone, date) {
  const { year, month, day, hour, minute, second } = partsIn(timeZone, date);
  const asIfUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) % 24, Number(minute), Number(second));
  return date.getTime() - asIfUtc;
}

/**
 * The instant at which it is midnight on the plan's date, at the venue.
 *
 * Found by correction rather than construction: guess that the wall clock is
 * UTC, ask what the offset actually is there, and move by it. The second pass
 * catches the twice-a-year case where the correction itself crosses a daylight
 * boundary and the first offset was the one on the wrong side of it.
 */
function zonedMidnight(plan) {
  const timeZone = zoneOf(plan);
  const guess = new Date(`${plan.date}T00:00:00Z`);
  const first = new Date(guess.getTime() + offsetAt(timeZone, guess));
  const second = offsetAt(timeZone, first);
  return new Date(guess.getTime() + second);
}

/**
 * Whether the day-of view should be on by itself.
 *
 * On the plan's date from midnight at the venue, and while a plan that runs
 * past midnight is still running. The date is the whole rule: it used to also
 * turn on for good whenever the plan's status was Final, which was a mode
 * switch wearing a label's name (D31).
 */
export function shouldBeOn(plan, now = new Date()) {
  if (!plan) return false;

  if (zonedDate(zoneOf(plan), now) === plan.date) return true;

  // A plan that runs past midnight is still today's plan at 1 a.m.
  const schedule = buildSchedule(plan);
  if (schedule.dayEnd <= 24 * 60) return false;

  const minutesSincePlanStart = (now - zonedMidnight(plan)) / 60_000;
  return minutesSincePlanStart >= 0 && minutesSincePlanStart < schedule.dayEnd;
}

/**
 * The current time as the schedule counts it: minutes from midnight on the
 * plan's date at the venue, so an activity at 1:15 AM the next morning is
 * 1515, not 75.
 */
export function minutesNow(plan, now = new Date()) {
  return Math.floor((now - zonedMidnight(plan)) / 60_000);
}

/**
 * What the live strip says. One shape for every situation, so the strip never
 * has to decide anything itself.
 */
export function stripState(plan, now = new Date()) {
  // The panel shows the venue's own clock beside what is happening on it, so
  // every state carries it rather than each branch remembering to.
  const state = computeStrip(plan, now);
  return { ...state, clockLabel: formatTime(state.minute) };
}

function computeStrip(plan, now) {
  const schedule = buildSchedule(plan);
  const minute = minutesNow(plan, now);
  const { items, openTimes } = schedule;

  if (!items.length) {
    return { kind: 'empty', minute, headline: 'Nothing planned yet', detail: null };
  }

  const first = items[0];
  if (minute < first.start) {
    return {
      kind: 'before',
      minute,
      headline: `Starts in ${formatCountdown(first.start - minute)}`,
      detail: `${first.title}, ${formatTime(first.start)}`,
      next: first,
      progress: 0
    };
  }

  if (minute >= schedule.dayEnd) {
    return { kind: 'after', minute, headline: 'Day complete', detail: null, progress: 1 };
  }

  // Two things can be true at once. The locked activity is the one that is
  // really happening — it is the one with a promise attached — and anything
  // else running alongside it is named rather than hidden.
  const running = items.filter(item => item.start <= minute && item.end > minute);
  const current = running.find(item => item.locked) || running[0];

  if (current) {
    const alsoRunning = running.find(item => item !== current);
    return {
      kind: 'during',
      minute,
      current,
      headline: current.title,
      remaining: current.end - minute,
      remainingLabel: `${formatCountdown(current.end - minute)} left`,
      progress: (minute - current.start) / current.duration,
      next: nextAfter(items, current),
      overrunning: alsoRunning || null,
      detail: alsoRunning ? `Also now: ${alsoRunning.title}` : null
    };
  }

  // Between activities.
  const gap = openTimes.find(entry => entry.start <= minute && entry.end > minute);
  const upcoming = items.find(item => item.start > minute);
  return {
    kind: 'open',
    minute,
    headline: 'Open',
    remaining: gap ? gap.end - minute : null,
    detail: upcoming ? `${formatCountdown(upcoming.start - minute)} until ${upcoming.title}` : null,
    next: upcoming || null,
    progress: gap ? (minute - gap.start) / (gap.end - gap.start) : 0
  };
}

function nextAfter(items, current) {
  return items.find(item => item.start >= current.end) || null;
}

/** How each card is drawn on the day: past, live, or still to come. */
export function cardStateAt(item, minute) {
  if (item.end <= minute) return 'past';
  if (item.start <= minute) return 'live';
  return 'ahead';
}

/**
 * Ticks every half minute, and once immediately. Half a minute is enough for
 * a countdown in whole minutes and cheap enough to leave running all day.
 */
export function createClock(onTick, { intervalMs = TICK_MS, now = () => new Date() } = {}) {
  let timer = null;
  const tick = () => onTick(now());

  return {
    start() {
      if (timer !== null) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    tick
  };
}

/**
 * Whether this device has been told to differ from the automatic answer, for
 * this date only. Switching day-of off on the morning of the wedding should
 * stay off for the rest of that day, and mean nothing the week after.
 */
const OVERRIDE_KEY = 'wrp:dayof-override';

export function readOverride(date) {
  try {
    const stored = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || 'null');
    return stored && stored.date === date ? stored.on : null;
  } catch {
    return null;
  }
}

export function writeOverride(date, on) {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ date, on }));
  } catch {
    // Without storage the switch still works; it just does not outlive the tab.
  }
}

export function clearOverride() {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // Nothing to clear if nothing could be stored.
  }
}
