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

function findActivity(plan, id) {
  return plan.activities.find(activity => activity.id === id) || null;
}

defineAction('activity.add', (plan, { activity, afterId = null }) => {
  const index = afterId ? plan.activities.findIndex(item => item.id === afterId) : -1;
  if (index >= 0) plan.activities.splice(index + 1, 0, activity);
  else plan.activities.push(activity);
  return { plan, label: `Added ${activity.title}` };
});

defineAction('activity.update', (plan, { activity }) => {
  const index = plan.activities.findIndex(item => item.id === activity.id);
  if (index < 0) return null;
  plan.activities[index] = activity;
  return { plan, label: `Edited ${activity.title}` };
});

defineAction('activity.remove', (plan, { id }) => {
  const activity = findActivity(plan, id);
  if (!activity) return null;
  plan.activities = plan.activities.filter(item => item.id !== id);
  return { plan, label: `Deleted ${activity.title}` };
});

defineAction('activity.stage', (plan, { id, stage }) => {
  const activity = findActivity(plan, id);
  if (!activity || activity.stage === stage) return null;
  activity.stage = stage;
  return { plan, label: `Changed stage of ${activity.title}` };
});

defineAction('activity.duration', (plan, { id, duration }) => {
  const activity = findActivity(plan, id);
  if (!activity) return null;
  const next = normalizeDuration(duration);
  if (next === activity.duration) return null;
  activity.duration = next;
  return { plan, label: `Resized ${activity.title}` };
});

defineAction('activity.move', (plan, { id, toIndex }) => {
  const from = plan.activities.findIndex(item => item.id === id);
  if (from < 0) return null;
  const target = Math.max(0, Math.min(toIndex, plan.activities.length - 1));
  if (target === from) return null;
  const [moved] = plan.activities.splice(from, 1);
  plan.activities.splice(target, 0, moved);
  return { plan, label: `Moved ${moved.title}` };
});

/**
 * Fixing uses the activity's current start, which depends on everything before
 * it — so the schedule is computed from the plan as it was, before the change.
 */
defineAction('activity.fix', (plan, { id, scheduleBefore }) => {
  const activity = findActivity(plan, id);
  if (!activity || activity.lockedStart) return null;
  const scheduled = (scheduleBefore || buildSchedule(plan)).items.find(item => item.id === id);
  if (!scheduled) return null;
  activity.lockedStart = minutesToTime(scheduled.start);
  delete activity.gapBefore;
  return { plan, label: `Fixed ${activity.title}` };
});

defineAction('activity.unfix', (plan, { id }) => {
  const activity = findActivity(plan, id);
  if (!activity || !activity.lockedStart) return null;
  activity.lockedStart = null;
  return { plan, label: `Unfixed ${activity.title}` };
});

defineAction('plan.settings', (plan, { changes }) => {
  Object.assign(plan, changes);
  return { plan, label: 'Changed plan settings' };
});

defineAction('plan.status', (plan, { status }) => {
  if (plan.status === status) return null;
  plan.status = status;
  return { plan, label: `Set status to ${status}` };
});
