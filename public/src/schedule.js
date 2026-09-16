/**
 * Scheduling. Pure: every function takes a plan and returns new values, and
 * nothing here touches the DOM or the store.
 *
 * The rule the whole app rests on:
 *
 *   cursor = first activity starts
 *   for each activity in order
 *     fixed    -> it starts at its clock time. Earlier space before it is open
 *                 time; work running past it is a conflict, and the fixed
 *                 activity does not move.
 *     flexible -> it starts when the previous one ended, plus any open time
 *                 stored against it.
 *     cursor = max(cursor, end)
 *
 * All times are absolute minutes from midnight on the plan's date, so an
 * activity that runs past midnight simply has a start above 1440.
 */
import { normalizeDuration } from './validate.js';

export const MINUTES_PER_DAY = 24 * 60;

export function parseTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function formatTime(totalMinutes, { meridiem = true } = {}) {
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')}${meridiem ? ` ${suffix}` : ''}`;
}

/** "12:45 – 1:15 PM": the first AM/PM is dropped when both halves match. */
export function formatRange(start, end) {
  const startMeridiem = Math.floor((((start % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 720);
  const endMeridiem = Math.floor((((end % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 720);
  return `${formatTime(start, { meridiem: startMeridiem !== endMeridiem })} – ${formatTime(end)}`;
}

export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** "2 hr 10 min" for the day-of strip's countdown. */
export function formatCountdown(minutes) {
  return formatDuration(Math.max(0, Math.round(minutes)));
}

export function clampDuration(minutes) {
  return normalizeDuration(minutes);
}

/**
 * A fixed time belongs to the next day when it would otherwise fall far behind
 * the work already scheduled — a 1:15 AM start after an activity that ended at
 * 11 PM means tomorrow morning, not fourteen hours ago.
 */
function resolveFixedStart(lockedStart, cursor) {
  let start = parseTime(lockedStart);
  if (start === null) return null;
  while (start < cursor - 12 * 60) start += MINUTES_PER_DAY;
  return start;
}

export function buildSchedule(plan) {
  const dayStart = parseTime(plan?.dayStart) ?? 8 * 60;
  let cursor = dayStart;

  const items = [];
  const openTimes = [];
  const conflicts = [];

  for (const [index, activity] of (plan?.activities || []).entries()) {
    const duration = normalizeDuration(activity.duration);
    const fixedStart = activity.lockedStart ? resolveFixedStart(activity.lockedStart, cursor) : null;

    let start;
    let conflictMinutes = 0;

    if (fixedStart !== null) {
      start = fixedStart;
      if (start > cursor) {
        openTimes.push({ start: cursor, end: start, beforeId: activity.id, beforeTitle: activity.title, kind: 'fixed', index });
      } else if (start < cursor) {
        conflictMinutes = cursor - start;
      }
    } else {
      const gap = Number(activity.gapBefore) || 0;
      start = cursor + gap;
      if (gap > 0) {
        openTimes.push({ start: cursor, end: start, beforeId: activity.id, beforeTitle: activity.title, kind: 'stored', index });
      }
    }

    const end = start + duration;
    items.push({
      ...activity,
      index,
      duration,
      start,
      end,
      startLabel: formatTime(start),
      endLabel: formatTime(end),
      rangeLabel: formatRange(start, end),
      conflictMinutes,
      isFixed: fixedStart !== null,
      // Kept for the code that has not moved to isFixed yet.
      isLocked: fixedStart !== null
    });

    cursor = Math.max(cursor, end);
  }

  // A conflict is a fixed activity plus everything still running when it
  // starts. Both keep their true times; the overlap is what is drawn.
  //
  // Two numbers come out of this, and they are not the same. `conflictMinutes`
  // on the fixed activity is how far earlier work runs past its start — the
  // time the day has lost, and what the summary counts. `overrun.minutes` on
  // an overrunning activity is how far it runs *into* the fixed one, which is
  // bounded by how long the fixed activity lasts. A 3-hour overrun into a
  // 1-hour ceremony is 180 minutes late but only 60 minutes on top of it.
  for (const fixed of items) {
    if (!fixed.conflictMinutes) continue;
    const overrun = items.filter(item =>
      item !== fixed && !item.isFixed && item.start < fixed.end && item.end > fixed.start);

    for (const item of overrun) {
      item.overrun = {
        intoId: fixed.id,
        intoTitle: fixed.title,
        minutes: Math.min(item.end, fixed.end) - Math.max(item.start, fixed.start),
        from: Math.max(item.start, fixed.start)
      };
    }
    conflicts.push({
      fixedId: fixed.id,
      fixedTitle: fixed.title,
      overrunIds: overrun.map(item => item.id),
      minutes: fixed.conflictMinutes,
      start: fixed.start
    });
  }

  const openMinutes = openTimes.reduce((total, gap) => total + (gap.end - gap.start), 0);
  const conflictMinutes = conflicts.reduce((total, conflict) => total + conflict.minutes, 0);

  return {
    items,
    openTimes,
    conflicts,
    dayStart,
    dayEnd: cursor,
    // Names the pre-redesign code uses.
    end: cursor,
    endLabel: formatTime(cursor),
    summary: {
      count: items.length,
      start: items.length ? Math.min(...items.map(item => item.start)) : dayStart,
      end: cursor,
      openMinutes,
      conflictMinutes
    }
  };
}

export function gapBefore(activity) {
  return activity.lockedStart ? 0 : (Number(activity.gapBefore) || 0);
}
