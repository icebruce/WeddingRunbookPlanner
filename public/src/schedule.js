/**
 * Scheduling. Pure: every function takes a plan and returns new values, and
 * nothing here touches the DOM or the store.
 *
 * The model: every activity stores its own `start`, in absolute minutes from
 * midnight on the plan's date. Nothing here moves an activity that was not
 * asked to move — this is a calendar, not a chain. Two activities can occupy
 * the same minutes; that is drawn as an overlap, not silently prevented or
 * silently resolved. `locked` means exactly one thing: this activity is not
 * touched by a group move (see `moveGroup` in operations.js) — it is not a
 * participant in "move these together."
 *
 * All times may run past 1440 (midnight): a plan that goes to 1:15 AM stores
 * that activity's start as 1515, not 75, so ordering and duration math never
 * have to guess which day a small number belongs to.
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

/** "1 hr 20 min" — minutes are always shown converted, never as a raw count over 60. */
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
 * Merge every activity's [start, end) into the fewest non-overlapping blocks.
 * This is the one piece of interval math everything else — open time,
 * overlaps, the day's start and end — is built from.
 */
function mergeBlocks(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks = [];
  for (const item of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
      last.items.push(item);
    } else {
      blocks.push({ start: item.start, end: item.end, items: [item] });
    }
  }
  return blocks;
}

/**
 * Every pair of activities whose times overlap, with the exact overlapping
 * range — not "this card conflicts with something", but the minutes it
 * actually shares with the other one.
 */
function findOverlaps(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const overlaps = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].start >= sorted[i].end) break;
      const start = Math.max(sorted[i].start, sorted[j].start);
      const end = Math.min(sorted[i].end, sorted[j].end);
      if (end > start) overlaps.push({ aId: sorted[i].id, bId: sorted[j].id, start, end, minutes: end - start });
    }
  }
  return overlaps;
}

const DEFAULT_VIEW_START = 8 * 60;

export function buildSchedule(plan) {
  const activities = plan?.activities || [];

  const items = activities.map(activity => {
    const duration = normalizeDuration(activity.duration);
    const start = Number.isFinite(activity.start) ? Math.max(0, Math.round(activity.start)) : 0;
    const end = start + duration;
    return {
      ...activity,
      duration,
      start,
      end,
      startLabel: formatTime(start),
      endLabel: formatTime(end),
      rangeLabel: formatRange(start, end),
      locked: Boolean(activity.locked)
    };
  }).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  const titleOf = new Map(items.map(item => [item.id, item.title]));
  const overlaps = findOverlaps(items);
  const overlapsById = new Map();
  for (const item of items) overlapsById.set(item.id, []);
  for (const pair of overlaps) {
    overlapsById.get(pair.aId).push({ withId: pair.bId, withTitle: titleOf.get(pair.bId), start: pair.start, end: pair.end, minutes: pair.minutes });
    overlapsById.get(pair.bId).push({ withId: pair.aId, withTitle: titleOf.get(pair.aId), start: pair.start, end: pair.end, minutes: pair.minutes });
  }
  for (const item of items) {
    const mine = overlapsById.get(item.id);
    item.overlaps = mine;
    item.overlapMinutes = mine.reduce((total, entry) => total + entry.minutes, 0) > 0
      ? Math.max(...mine.map(entry => entry.minutes))
      : 0;
  }

  const blocks = mergeBlocks(items);
  const openTimes = [];
  for (let i = 1; i < blocks.length; i += 1) {
    const before = blocks[i].items.reduce((min, item) => (item.start < min.start ? item : min), blocks[i].items[0]);
    openTimes.push({
      start: blocks[i - 1].end,
      end: blocks[i].start,
      beforeId: before.id,
      beforeTitle: before.title,
      index: i
    });
  }

  const dayStart = blocks.length ? blocks[0].start : DEFAULT_VIEW_START;
  const dayEnd = blocks.length ? blocks[blocks.length - 1].end : DEFAULT_VIEW_START;

  const openMinutes = openTimes.reduce((total, gap) => total + (gap.end - gap.start), 0);
  const conflictMinutes = overlaps.reduce((total, pair) => total + pair.minutes, 0);

  return {
    items,
    openTimes,
    overlaps,
    dayStart,
    dayEnd,
    end: dayEnd,
    endLabel: formatTime(dayEnd),
    summary: {
      count: items.length,
      start: items.length ? dayStart : DEFAULT_VIEW_START,
      end: dayEnd,
      openMinutes,
      conflictMinutes
    }
  };
}
