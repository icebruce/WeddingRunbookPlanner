/**
 * The plan actions available in this stage.
 *
 * Each is a pure function of the plan. Nothing here reports "how far the rest
 * of the day moved" any more — there is no rest-of-the-day to move. The one
 * exception is `activity.moveGroup`, which is the one deliberate way several
 * activities move at once.
 */
import { defineAction } from './state.js';
import { normalizeDuration } from './validate.js';
import { buildSchedule, formatTime } from './schedule.js';
import {
  addInOpenTime,
  extendPrevious,
  insertAfter,
  keepAsBuffer,
  moveGroup,
  moveTo,
  remove,
  resizeBottom,
  resizeTop,
  setSettings,
  setStage,
  toggleLock,
  update
} from './operations.js';

function findActivity(plan, id) {
  return plan.activities.find(activity => activity.id === id) || null;
}

/**
 * Most actions are an operation plus a label. The operation decides whether
 * anything changed; the label is what the undo toast says.
 */
function fromOperation(run, label) {
  return (plan, payload) => {
    const result = run(plan, payload);
    if (!result) return null;
    const activity = findActivity(plan, payload.id) || result.plan.activities.find(a => a.id === result.activityId);
    return { plan: result.plan, label: label(activity, payload, result) };
  };
}

defineAction('activity.add', (plan, { activity, afterId = null }) => {
  const result = insertAfter(plan, afterId, activity);
  return { plan: result.plan, label: `Added ${activity.title}` };
});

defineAction('activity.update', fromOperation(
  (plan, { activity }) => update(plan, activity),
  (_, payload) => `Edited ${payload.activity.title}`
));

defineAction('activity.remove', fromOperation(
  (plan, { id }) => remove(plan, id),
  activity => `Deleted ${activity.title}`
));

defineAction('activity.stage', fromOperation(
  (plan, { id, stage }) => setStage(plan, id, stage),
  activity => `Changed stage of ${activity.title}`
));

defineAction('activity.duration', (plan, { id, duration }) => {
  const activity = findActivity(plan, id);
  if (!activity) return null;
  const next = normalizeDuration(duration);
  if (next === activity.duration) return null;
  const scheduled = buildSchedule(plan).items.find(item => item.id === id);
  return fromOperation(
    (p, payload) => resizeBottom(p, payload.id, scheduled.start + next),
    a => `Resized ${a.title}`
  )(plan, { id });
});

defineAction('activity.resizeBottom', fromOperation(
  (plan, { id, newEnd }) => resizeBottom(plan, id, newEnd),
  activity => `Resized ${activity.title}`
));

defineAction('activity.resizeTop', fromOperation(
  (plan, { id, newStart }) => resizeTop(plan, id, newStart),
  activity => `Resized ${activity.title}`
));

// The new time is in the label, not just the title: a move made by dragging is
// undone from the toast, and "Moved Ceremony" does not say whether it landed
// where it was meant to.
defineAction('activity.moveTo', fromOperation(
  (plan, { id, start }) => moveTo(plan, id, start),
  (activity, { start }) => `Moved ${activity.title} to ${formatTime(start)}`
));

defineAction('activity.moveGroup', (plan, { ids, deltaMinutes }) => {
  const result = moveGroup(plan, ids, deltaMinutes);
  if (!result) return null;
  return { plan: result.plan, label: `Moved ${result.movedCount} ${result.movedCount === 1 ? 'activity' : 'activities'}` };
});

defineAction('activity.toggleLock', fromOperation(
  (plan, { id }) => toggleLock(plan, id),
  activity => (activity?.locked ? `Unlocked ${activity.title}` : `Locked ${activity.title}`)
));

defineAction('openTime.buffer', fromOperation(
  (plan, { openTime, newId }) => keepAsBuffer(plan, openTime, newId),
  () => 'Added Buffer'
));

defineAction('openTime.extend', fromOperation(
  (plan, { openTime }) => extendPrevious(plan, openTime),
  () => 'Extended the previous activity'
));

defineAction('openTime.add', fromOperation(
  (plan, { openTime, activity }) => addInOpenTime(plan, openTime, activity),
  (_, payload) => `Added ${payload.activity.title || 'activity'}`
));

defineAction('plan.settings', (plan, { changes }) => {
  const same = Object.entries(changes).every(([key, value]) => (plan[key] ?? null) === (value ?? null));
  if (same) return null;
  return { ...setSettings(plan, changes), label: 'Changed plan settings' };
});

/**
 * Replacing the whole day at once, which only the wedding template does. It is
 * one undoable step: "use the template" should be as easy to take back as it
 * was to take.
 */
defineAction('plan.replaceActivities', (plan, { activities }) => {
  plan.activities = structuredClone(activities);
  return { plan, label: 'Used the wedding template' };
});
