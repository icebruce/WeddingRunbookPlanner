/**
 * The plan actions available in this stage.
 *
 * Each is a pure function of the plan; the scheduling operations from the
 * technical specification (resize, reorder around fixed activities, open-time
 * handling) arrive with the timeline work and register here alongside them.
 */
import { defineAction } from './state.js';
import { normalizeDuration } from './validate.js';
import { buildSchedule, minutesToTime } from './schedule.js';
import {
  addInOpenTime,
  duplicate,
  extendPrevious,
  fix,
  insertAfter,
  keepAsBuffer,
  move,
  remove,
  resizeBottom,
  resizeTop,
  setStage,
  unfix,
  update
} from './operations.js';

function findActivity(plan, id) {
  return plan.activities.find(activity => activity.id === id) || null;
}

/**
 * Most actions are an operation plus a label. The operation decides whether
 * anything changed and how far the rest of the day moved; the label is what
 * the undo toast says.
 */
function fromOperation(run, label) {
  return (plan, payload) => {
    const result = run(plan, payload);
    if (!result) return null;
    const activity = findActivity(plan, payload.id) || result.plan.activities.find(a => a.id === result.activityId);
    return { plan: result.plan, shifted: result.shifted, label: label(activity, payload, result) };
  };
}

defineAction('activity.add', (plan, { activity, afterId = null }) => {
  const result = insertAfter(plan, afterId, activity);
  return { plan: result.plan, shifted: result.shifted, label: `Added ${activity.title}` };
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

defineAction('activity.move', fromOperation(
  (plan, { id, toIndex }) => move(plan, id, toIndex),
  activity => `Moved ${activity.title}`
));

defineAction('activity.fix', fromOperation(
  (plan, { id }) => fix(plan, id),
  activity => `Fixed ${activity.title}`
));

defineAction('activity.unfix', fromOperation(
  (plan, { id }) => unfix(plan, id),
  activity => `Unfixed ${activity.title}`
));

defineAction('activity.duplicate', fromOperation(
  (plan, { id, newId }) => duplicate(plan, id, newId),
  activity => `Duplicated ${activity.title}`
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
  Object.assign(plan, changes);
  return { plan, label: 'Changed plan settings' };
});

defineAction('plan.status', (plan, { status }) => {
  if (plan.status === status) return null;
  plan.status = status;
  return { plan, label: `Set status to ${status}` };
});
