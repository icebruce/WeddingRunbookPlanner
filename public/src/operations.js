/**
 * The operations that change a plan.
 *
 * Every one is pure: it takes a plan, returns a new plan, and never touches the
 * one it was given. Each also reports `shifted` — how many later activities
 * moved and by how much — because that is what the toast has to say
 * ("2 activities shifted · +15 min").
 */
import { buildSchedule, minutesToTime, parseTime } from './schedule.js';
import { normalizeDuration, normalizeGap } from './validate.js';

function clone(plan) {
  return structuredClone(plan);
}

function find(plan, id) {
  return plan.activities.find(activity => activity.id === id) || null;
}

function startsOf(plan) {
  const map = new Map();
  for (const item of buildSchedule(plan).items) map.set(item.id, item.start);
  return map;
}

/**
 * Compares the day before and after a change, so the caller can report what
 * moved. Only activities that existed on both sides are counted.
 */
function shiftBetween(before, after) {
  let count = 0;
  let deltaMinutes = 0;
  for (const [id, start] of before) {
    if (!after.has(id)) continue;
    const delta = after.get(id) - start;
    if (delta === 0) continue;
    count += 1;
    // The reported delta is the one most activities share, which for a ripple
    // is every one of them.
    if (deltaMinutes === 0) deltaMinutes = delta;
  }
  return { count, deltaMinutes };
}

function withShift(plan, before, extra = {}) {
  return { plan, shifted: shiftBetween(before, startsOf(plan)), ...extra };
}

/** The end follows the pointer; the start stays where it is. */
export function resizeBottom(plan, id, newEnd) {
  const before = startsOf(plan);
  const start = before.get(id);
  if (start === undefined) return null;

  const next = clone(plan);
  const activity = find(next, id);
  const duration = normalizeDuration(newEnd - start);
  if (duration === activity.duration) return null;
  activity.duration = duration;
  return withShift(next, before);
}

/**
 * The end stays; the start follows the pointer.
 *
 * Dragging down shortens the activity and leaves open time before it, stored
 * against the activity so it travels with it when earlier work changes.
 * Dragging up consumes that open time first and stops at the previous
 * activity's end — it never creates an overlap.
 */
export function resizeTop(plan, id, newStart) {
  const schedule = buildSchedule(plan);
  const item = schedule.items.find(entry => entry.id === id);
  if (!item || item.isFixed) return null;

  // Where this activity would start with no open time in front of it.
  const cursorBefore = item.start - (Number(item.gapBefore) || 0);
  const limit = item.end - 5;
  const clamped = Math.max(cursorBefore, Math.min(newStart, limit));
  const gap = normalizeGap(clamped - cursorBefore);
  const duration = normalizeDuration(item.end - (cursorBefore + gap));

  if (gap === (Number(item.gapBefore) || 0) && duration === item.duration) return null;

  const before = startsOf(plan);
  const next = clone(plan);
  const activity = find(next, id);
  if (gap > 0) activity.gapBefore = gap;
  else delete activity.gapBefore;
  activity.duration = duration;
  return withShift(next, before);
}

export function move(plan, id, toIndex) {
  const from = plan.activities.findIndex(activity => activity.id === id);
  if (from < 0) return null;
  // A fixed activity starts at its clock time whatever its position, so moving
  // it would change the order without changing the day.
  if (plan.activities[from].lockedStart) return null;

  const target = Math.max(0, Math.min(toIndex, plan.activities.length - 1));
  if (target === from) return null;

  const before = startsOf(plan);
  const next = clone(plan);
  const [moved] = next.activities.splice(from, 1);
  next.activities.splice(target, 0, moved);
  return withShift(next, before);
}

export function insertAfter(plan, afterId, activity) {
  const before = startsOf(plan);
  const next = clone(plan);
  const index = afterId ? next.activities.findIndex(item => item.id === afterId) : -1;
  if (index >= 0) next.activities.splice(index + 1, 0, activity);
  else next.activities.push(activity);
  return withShift(next, before);
}

export function duplicate(plan, id, newId) {
  const source = find(plan, id);
  if (!source) return null;
  // The copy is flexible: two activities cannot both own the same clock time.
  const copy = { ...structuredClone(source), id: newId, lockedStart: null };
  delete copy.gapBefore;
  return insertAfter(plan, id, copy);
}

export function remove(plan, id) {
  if (!find(plan, id)) return null;
  const before = startsOf(plan);
  const next = clone(plan);
  next.activities = next.activities.filter(activity => activity.id !== id);
  return withShift(next, before);
}

/** Fixes an activity at the time it currently starts. */
export function fix(plan, id) {
  const schedule = buildSchedule(plan);
  const item = schedule.items.find(entry => entry.id === id);
  if (!item || item.isFixed) return null;

  const before = startsOf(plan);
  const next = clone(plan);
  const activity = find(next, id);
  activity.lockedStart = minutesToTime(item.start);
  delete activity.gapBefore;
  return withShift(next, before);
}

/** Returns an activity to following the one before it. */
export function unfix(plan, id) {
  const activity = find(plan, id);
  if (!activity || !activity.lockedStart) return null;

  const before = startsOf(plan);
  const next = clone(plan);
  find(next, id).lockedStart = null;
  const result = withShift(next, before);
  result.newStart = startsOf(next).get(id);
  return result;
}

export function setStage(plan, id, stage) {
  const activity = find(plan, id);
  if (!activity || activity.stage === stage) return null;
  const next = clone(plan);
  find(next, id).stage = stage;
  return { plan: next, shifted: { count: 0, deltaMinutes: 0 } };
}

export function update(plan, activity) {
  const index = plan.activities.findIndex(item => item.id === activity.id);
  if (index < 0) return null;
  const before = startsOf(plan);
  const next = clone(plan);
  next.activities[index] = structuredClone(activity);
  return withShift(next, before);
}

// ------------------------------------------------------------- open time

function openTimeFor(plan, openTime) {
  const schedule = buildSchedule(plan);
  return schedule.openTimes.find(gap => gap.beforeId === openTime.beforeId && gap.start === openTime.start) || null;
}

/**
 * Turns open time into a real Buffer activity of exactly that length, placed
 * before the activity the open time sat in front of. Any stored open time
 * there is cleared, because the buffer now occupies it.
 */
export function keepAsBuffer(plan, openTime, newId) {
  const gap = openTimeFor(plan, openTime);
  if (!gap) return null;

  const before = startsOf(plan);
  const next = clone(plan);
  const target = find(next, gap.beforeId);
  if (target) delete target.gapBefore;

  const buffer = {
    id: newId,
    title: 'Buffer',
    duration: normalizeDuration(gap.end - gap.start),
    stage: 'buffer',
    location: target?.location || '',
    people: [],
    notes: '',
    lockedStart: null
  };
  const index = next.activities.findIndex(activity => activity.id === gap.beforeId);
  next.activities.splice(Math.max(0, index), 0, buffer);
  return withShift(next, before, { activityId: newId });
}

/**
 * Stretches the activity before the open time so it ends where the open time
 * does. Allowed even when that activity is fixed: a fixed start is a promise
 * about when something begins, not about how long it runs.
 */
export function extendPrevious(plan, openTime) {
  const schedule = buildSchedule(plan);
  const gap = schedule.openTimes.find(entry => entry.beforeId === openTime.beforeId && entry.start === openTime.start);
  if (!gap) return null;

  const previous = [...schedule.items].reverse().find(item => item.end === gap.start);
  if (!previous) return null;

  const before = startsOf(plan);
  const next = clone(plan);
  const activity = find(next, previous.id);
  activity.duration = normalizeDuration(gap.end - previous.start);
  // Stored open time in front of the following activity is now consumed.
  const target = find(next, gap.beforeId);
  if (target && gap.kind === 'stored') delete target.gapBefore;
  return withShift(next, before);
}

/** A new flexible activity filling the open time exactly. */
export function addInOpenTime(plan, openTime, activity) {
  const gap = openTimeFor(plan, openTime);
  if (!gap) return null;

  const before = startsOf(plan);
  const next = clone(plan);
  const target = find(next, gap.beforeId);
  if (target && gap.kind === 'stored') delete target.gapBefore;

  const created = {
    ...activity,
    duration: normalizeDuration(gap.end - gap.start),
    lockedStart: null
  };
  delete created.gapBefore;
  const index = next.activities.findIndex(item => item.id === gap.beforeId);
  next.activities.splice(Math.max(0, index), 0, created);
  return withShift(next, before, { activityId: created.id });
}

export function setSettings(plan, changes) {
  const before = startsOf(plan);
  const next = { ...clone(plan), ...changes };
  return withShift(next, before);
}

export { parseTime };
