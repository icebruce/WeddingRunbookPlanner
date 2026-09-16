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

/**
 * Cards sit inside their lines rather than touching them, so two activities
 * that meet exactly — one ending at 4:00, the next starting at 4:00 — read as
 * card, gap, the hour line, gap, card, instead of two borders pressed
 * together.
 */
export const CARD_INSET = 2;

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

export const LANE_GAP_PX = 6;

/**
 * How many activities overlap at once, and which slot each takes.
 *
 * This is ordinary interval-graph colouring: walking activities in start
 * order, each goes in the first lane whose last activity has already ended;
 * if none is free, it opens a new one. Activities that never overlap anything
 * share lane 0 and never learn a lane count was computed at all — only a
 * genuine overlap costs width.
 */
export function lanes(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds = [];
  const laneOf = new Map();

  // Clusters of mutually-touching activities share one lane count, so a lane
  // opened for a three-way overlap does not shrink the unrelated activity
  // that happens to follow it.
  let clusterEnd = -Infinity;
  let clusterItems = [];
  const clusters = [];

  for (const item of sorted) {
    if (item.start >= clusterEnd && clusterItems.length) {
      clusters.push(clusterItems);
      clusterItems = [];
      laneEnds.length = 0;
    }
    let lane = laneEnds.findIndex(end => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    laneOf.set(item.id, lane);
    clusterItems.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (clusterItems.length) clusters.push(clusterItems);

  const totalLanesOf = new Map();
  for (const cluster of clusters) {
    const count = Math.max(...cluster.map(item => laneOf.get(item.id))) + 1;
    for (const item of cluster) totalLanesOf.set(item.id, count);
  }

  return { laneOf, totalLanesOf };
}

/** A card's horizontal slice when it shares its width with others. */
export function laneStyle(lane, totalLanes) {
  if (totalLanes <= 1) return '';
  const width = `calc(${100 / totalLanes}% - ${LANE_GAP_PX * (totalLanes - 1) / totalLanes}px)`;
  const left = `calc((100% + ${LANE_GAP_PX}px) / ${totalLanes} * ${lane})`;
  return `left:${left};width:${width};right:auto;`;
}

/**
 * The same slice, written straight onto an element's live style — for a
 * gesture's preview, which restyles a card every frame and cannot keep
 * appending to `cssText` without the attribute growing without bound. A card
 * that has left an overlap has its lane properties cleared, not just left
 * unset, so it falls back to the full-width rule in the stylesheet.
 */
export function applyLaneStyle(el, lane, totalLanes) {
  if (totalLanes <= 1) {
    el.style.left = '';
    el.style.width = '';
    el.style.right = '';
    return;
  }
  el.style.width = `calc(${100 / totalLanes}% - ${LANE_GAP_PX * (totalLanes - 1) / totalLanes}px)`;
  el.style.left = `calc((100% + ${LANE_GAP_PX}px) / ${totalLanes} * ${lane})`;
  el.style.right = 'auto';
}

/**
 * The exact minutes an activity overlaps with any other — not the card's
 * whole height, just the part that truly collides — expressed as a top/height
 * relative to the card's own top.
 */
export function overlapBox(item) {
  if (!item.overlaps?.length) return null;
  const start = Math.min(...item.overlaps.map(entry => entry.start));
  const end = Math.max(...item.overlaps.map(entry => entry.end));
  return { top: (start - item.start) * PX_PER_MIN, height: (end - start) * PX_PER_MIN };
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
  const { laneOf, totalLanesOf } = lanes(schedule.items);

  const cards = schedule.items.map(item => {
    const totalLanes = totalLanesOf.get(item.id) || 1;
    return {
      item,
      ...box(item, from),
      lane: laneOf.get(item.id) || 0,
      totalLanes,
      density: density(item.duration),
      overlapBox: overlapBox(item)
    };
  });

  const openTimes = schedule.openTimes.map(gap => ({
    ...gap,
    top: y(gap.start, from) + CARD_INSET,
    height: (gap.end - gap.start) * PX_PER_MIN - CARD_INSET * 2,
    minutes: gap.end - gap.start
  }));

  const sunsetMinutes = parseTime(plan?.sunset === undefined ? '16:19' : plan?.sunset);

  return {
    from,
    to,
    height,
    cards,
    openTimes,
    ticks: ticks(from, to),
    endTop: y(schedule.dayEnd, from),
    sunset: sunsetMinutes === null || sunsetMinutes < from || sunsetMinutes > to
      ? null
      : { minutes: sunsetMinutes, top: y(sunsetMinutes, from) }
  };
}
