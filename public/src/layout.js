/**
 * Geometry. Pure: minutes in, pixels out.
 *
 * One rule, and everything else follows from it: vertical position *is* clock
 * time. A card's top edge sits on its start line and its bottom edge on its end
 * line, at every screen size. Nothing is given a minimum height, because a
 * minimum height would push a card off its own time — which is what the old
 * layout did, drawing a fixed 4:00 PM activity eleven minutes late (F4).
 *
 * Density is handled by showing less inside a card, never by moving it.
 */
import { parseTime } from './schedule.js';

/** 20 px per 5 minutes. The one scale, at every width. */
export const PX_PER_MIN = 4;

/** Cards sit one pixel inside their lines so neighbours never touch. */
export const CARD_INSET = 1;

export const MINUTES_PER_DAY = 24 * 60;

export function floor5(minutes) {
  return Math.floor(minutes / 5) * 5;
}

export function ceil5(minutes) {
  return Math.ceil(minutes / 5) * 5;
}

/**
 * The visible range.
 *
 * It starts at the earlier of the configured "shows from" and the first
 * activity, and ends at the later of "shows until" and the end of the day. The
 * range always grows to fit: a view setting can widen what you see, never crop
 * an activity out of it.
 *
 * "Shows until" may be at or before "shows from", which means the next day —
 * a plan that runs to 1:15 AM is still one day's plan.
 */
export function range(plan, schedule) {
  const firstStart = schedule.items.length ? Math.min(...schedule.items.map(item => item.start)) : schedule.dayStart;
  const lastEnd = schedule.dayEnd;

  const configuredStart = parseTime(plan?.timelineStart);
  const configuredEnd = parseTime(plan?.timelineEnd);

  const from = floor5(configuredStart === null ? firstStart - 30 : Math.min(configuredStart, firstStart));

  let to;
  if (configuredEnd === null) {
    to = ceil5(lastEnd + 30);
  } else {
    let end = configuredEnd;
    // An end at or before the start is the next day.
    while (end <= from) end += MINUTES_PER_DAY;
    to = ceil5(Math.max(end, lastEnd));
  }

  return { from, to, height: (to - from) * PX_PER_MIN };
}

/** Pixels from the top of the timeline for a given absolute minute. */
export function y(minute, from) {
  return (minute - from) * PX_PER_MIN;
}

/** The box for an activity: its exact times, inset by a pixel at each edge. */
export function box(item, from) {
  return {
    top: y(item.start, from) + CARD_INSET,
    height: item.duration * PX_PER_MIN - CARD_INSET * 2
  };
}

/**
 * Every five-minute line, strongest at the hour. Labels only at the hour, half
 * hour and quarter hour — a label every five minutes is noise, and the numbers
 * would collide at this scale (D10).
 */
export function ticks(from, to) {
  const out = [];
  for (let minute = ceil5(from); minute <= to; minute += 5) {
    const withinHour = ((minute % 60) + 60) % 60;
    const kind = withinHour === 0 ? 'hour' : withinHour === 30 ? 'half' : withinHour % 15 === 0 ? 'quarter' : 'five';
    out.push({ minute, kind, top: y(minute, from), labelled: kind !== 'five' });
  }
  return out;
}

/**
 * Columns for conflicts.
 *
 * When work truly overlaps a fixed activity, the two are placed side by side
 * for the whole of their cards rather than drawn on top of each other: the
 * overrunning work on the left, the fixed activity on the right, both still on
 * their real times. Everything else spans the full width.
 */
export const LANE_LEFT_PERCENT = 55;
export const LANE_GAP_PX = 6;

export function lanes(schedule) {
  const assigned = new Map();
  for (const conflict of schedule.conflicts) {
    assigned.set(conflict.fixedId, 1);
    for (const id of conflict.overrunIds) assigned.set(id, 0);
  }
  return assigned;
}

export function laneStyle(lane) {
  if (lane === 0) return `right:calc(${100 - LANE_LEFT_PERCENT}% + ${LANE_GAP_PX / 2}px);`;
  if (lane === 1) return `left:calc(${LANE_LEFT_PERCENT}% + ${LANE_GAP_PX / 2}px);`;
  return '';
}

/**
 * How much room a card has, which decides its padding — not which rows it
 * shows. What fits is decided by measuring the rendered card (§8.3), because
 * the answer depends on the width, the font and the length of the text.
 */
export function density(duration) {
  if (duration <= 10) return 'line';
  if (duration < 30) return 'small';
  return 'standard';
}

/** Everything a renderer needs, in one pass. */
export function buildLayout(plan, schedule) {
  const { from, to, height } = range(plan, schedule);
  const laneOf = lanes(schedule);

  const cards = schedule.items.map(item => ({
    item,
    ...box(item, from),
    lane: laneOf.has(item.id) ? laneOf.get(item.id) : null,
    density: density(item.duration),
    // The hatched part of an overrunning card, in pixels from its own top.
    overrunHeight: item.overrun ? Math.min(item.duration, item.overrun.minutes) * PX_PER_MIN : 0
  }));

  const openTimes = schedule.openTimes.map(gap => ({
    ...gap,
    top: y(gap.start, from) + CARD_INSET,
    height: (gap.end - gap.start) * PX_PER_MIN - CARD_INSET * 2,
    minutes: gap.end - gap.start
  }));

  const conflictRails = schedule.conflicts.map(conflict => ({
    ...conflict,
    top: y(conflict.start, from),
    height: conflict.minutes * PX_PER_MIN
  }));

  const sunsetMinutes = parseTime(plan?.sunset === undefined ? '16:19' : plan?.sunset);

  return {
    from,
    to,
    height,
    cards,
    openTimes,
    conflictRails,
    ticks: ticks(from, to),
    endTop: y(schedule.dayEnd, from),
    sunset: sunsetMinutes === null || sunsetMinutes < from || sunsetMinutes > to
      ? null
      : { minutes: sunsetMinutes, top: y(sunsetMinutes, from) }
  };
}
