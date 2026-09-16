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

/** How often the strip re-reads the clock. */
export const TICK_MS = 30_000;
/** Away this long and the day-of view goes back to read-only. */
export const AUTO_VIEW_ONLY_MS = 5 * 60_000;

/**
 * Whether the day-of view should be on by itself.
 *
 * On the plan's date from midnight, while a plan that runs past midnight is
 * still running, and whenever the status is Final — which is how one person
 * turns it on for everyone.
 */
export function shouldBeOn(plan, now = new Date()) {
  if (!plan) return false;
  if (plan.status === 'Final') return true;

  const today = localDate(now);
  if (today === plan.date) return true;

  // A plan that runs past midnight is still today's plan at 1 a.m.
  const schedule = buildSchedule(plan);
  if (schedule.dayEnd <= 24 * 60) return false;

  const planDay = new Date(`${plan.date}T00:00:00`);
  const minutesSincePlanStart = (now - planDay) / 60_000;
  return minutesSincePlanStart >= 0 && minutesSincePlanStart < schedule.dayEnd;
}

function localDate(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The current time as the schedule counts it: minutes from midnight on the
 * plan's date, so an activity at 1:15 AM the next morning is 1515, not 75.
 */
export function minutesNow(plan, now = new Date()) {
  const planDay = new Date(`${plan.date}T00:00:00`);
  return Math.floor((now - planDay) / 60_000);
}

/**
 * What the live strip says. One shape for every situation, so the strip never
 * has to decide anything itself.
 */
export function stripState(plan, now = new Date()) {
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
