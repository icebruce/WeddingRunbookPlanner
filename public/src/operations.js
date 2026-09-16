/**
 * The operations that change a plan.
 *
 * Every one is pure: it takes a plan, returns a new plan, and never touches the
 * one it was given.
 *
 * Nothing here moves an activity that was not asked to move. Shortening,
 * deleting or moving one activity earlier never pulls its neighbours along —
 * that is what `moveGroup` is for, and only when it is asked for. Growing an
 * activity or moving it later does not push anything either: two activities
 * are simply allowed to overlap, and the timeline draws that rather than
 * hiding it.
 */
import { buildSchedule } from './schedule.js';
import { normalizeDuration } from './validate.js';

function clone(plan) {
  return structuredClone(plan);
}

function find(plan, id) {
  return plan.activities.find(activity => activity.id === id) || null;
}

const round5 = minutes => Math.round(minutes / 5) * 5;

/** The bottom edge follows the pointer; the start stays where it is. */
export function resizeBottom(plan, id, newEnd) {
  const activity = find(plan, id);
  if (!activity) return null;

  const duration = normalizeDuration(round5(newEnd) - activity.start);
  if (duration === activity.duration) return null;

  const next = clone(plan);
  find(next, id).duration = duration;
  return { plan: next };
}

/** The top edge follows the pointer; the end stays where it is. */
export function resizeTop(plan, id, newStart) {
  const activity = find(plan, id);
  if (!activity || activity.locked) return null;

  const end = activity.start + activity.duration;
  const start = Math.max(0, Math.min(end - 5, round5(newStart)));
  const duration = end - start;
  if (start === activity.start && duration === activity.duration) return null;

  const next = clone(plan);
  const target = find(next, id);
  target.start = start;
  target.duration = duration;
  return { plan: next };
}

/** Sets an activity's start directly — a drag, or a drop anywhere on the timeline. */
export function moveTo(plan, id, newStart) {
  const activity = find(plan, id);
  if (!activity || activity.locked) return null;

  const start = Math.max(0, round5(newStart));
  if (start === activity.start) return null;

  const next = clone(plan);
  find(next, id).start = start;
  return { plan: next };
}

/**
 * Moves several activities by the same amount of time at once — the one
 * deliberate way several things move together. A locked activity in the
 * selection stays put; everything else in it moves by the full delta.
 */
export function moveGroup(plan, ids, deltaMinutes) {
  const delta = round5(deltaMinutes);
  if (!delta) return null;

  const next = clone(plan);
  let moved = 0;
  for (const id of ids) {
    const activity = find(next, id);
    if (!activity || activity.locked) continue;
    activity.start = Math.max(0, activity.start + delta);
    moved += 1;
  }
  if (!moved) return null;
  return { plan: next, movedCount: moved };
}

export function insertAfter(plan, afterId, activity) {
  const next = clone(plan);
  const index = afterId ? next.activities.findIndex(item => item.id === afterId) : -1;
  if (index >= 0) next.activities.splice(index + 1, 0, activity);
  else next.activities.push(activity);
  return { plan: next };
}

export function duplicate(plan, id, newId) {
  const source = find(plan, id);
  if (!source) return null;
  // The copy sits right after the original, flexed 15 minutes later so it is
  // not stacked exactly on top of it.
  const copy = { ...structuredClone(source), id: newId, start: source.start + source.duration, locked: false };
  return insertAfter(plan, id, copy);
}

export function remove(plan, id) {
  if (!find(plan, id)) return null;
  const next = clone(plan);
  next.activities = next.activities.filter(activity => activity.id !== id);
  return { plan: next };
}

export function toggleLock(plan, id) {
  const activity = find(plan, id);
  if (!activity) return null;
  const next = clone(plan);
  find(next, id).locked = !activity.locked;
  return { plan: next };
}

export function setStage(plan, id, stage) {
  const activity = find(plan, id);
  if (!activity || activity.stage === stage) return null;
  const next = clone(plan);
  find(next, id).stage = stage;
  return { plan: next };
}

export function update(plan, activity) {
  const index = plan.activities.findIndex(item => item.id === activity.id);
  if (index < 0) return null;
  const next = clone(plan);
  next.activities[index] = structuredClone(activity);
  return { plan: next };
}

// ------------------------------------------------------------- open time

function openTimeFor(plan, openTime) {
  const schedule = buildSchedule(plan);
  return schedule.openTimes.find(gap => gap.beforeId === openTime.beforeId && gap.start === openTime.start) || null;
}

/**
 * Turns open time into a real Buffer activity of exactly that length.
 */
export function keepAsBuffer(plan, openTime, newId) {
  const gap = openTimeFor(plan, openTime);
  if (!gap) return null;

  const before = find(plan, gap.beforeId);
  const next = clone(plan);
  const buffer = {
    id: newId,
    title: 'Buffer',
    start: gap.start,
    duration: normalizeDuration(gap.end - gap.start),
    stage: 'buffer',
    location: before?.location || '',
    people: [],
    notes: '',
    locked: false
  };
  const index = next.activities.findIndex(activity => activity.id === gap.beforeId);
  next.activities.splice(Math.max(0, index), 0, buffer);
  return { plan: next, activityId: newId };
}

/**
 * Stretches the activity right before the open time so it ends where the open
 * time does.
 */
export function extendPrevious(plan, openTime) {
  const schedule = buildSchedule(plan);
  const gap = schedule.openTimes.find(entry => entry.beforeId === openTime.beforeId && entry.start === openTime.start);
  if (!gap) return null;

  const previous = [...schedule.items].reverse().find(item => item.end === gap.start);
  if (!previous) return null;

  const next = clone(plan);
  const activity = find(next, previous.id);
  activity.duration = normalizeDuration(gap.end - previous.start);
  return { plan: next };
}

/** A new activity filling the open time exactly. */
export function addInOpenTime(plan, openTime, activity) {
  const gap = openTimeFor(plan, openTime);
  if (!gap) return null;

  const next = clone(plan);
  const created = {
    ...activity,
    start: gap.start,
    // The gap's length is the default, not the rule: the editor offers it
    // pre-filled and a shorter activity simply leaves the rest open.
    duration: normalizeDuration(activity.duration || (gap.end - gap.start))
  };
  const index = next.activities.findIndex(item => item.id === gap.beforeId);
  next.activities.splice(Math.max(0, index), 0, created);
  return { plan: next, activityId: created.id };
}

export function setSettings(plan, changes) {
  return { plan: { ...clone(plan), ...changes } };
}
