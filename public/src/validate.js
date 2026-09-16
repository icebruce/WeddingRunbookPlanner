/**
 * Shared validation for everything that can be stored.
 *
 * The same module runs in the browser and on the server (via
 * lib/server/validate.js, which re-exports it) so the two can never drift:
 * there is one rule set, not two copies kept in step by a test.
 *
 * `validatePlan` does not only accept or reject. It returns a normalised plan:
 * unknown fields are dropped, optional fields get their defaults, and values
 * that are merely untidy (an unrounded duration, a padded title) are cleaned
 * up. Only genuinely wrong values fail, so an older stored plan keeps saving.
 */

export const PLAN_STATUSES = ['Draft', 'Working', 'Confirming', 'Final'];

export const STAGE_IDS = [
  'preparation',
  'first-look',
  'photography',
  'transition',
  'buffer',
  'ceremony',
  'celebration',
  'cocktail',
  'reception',
  'dinner',
  'party'
];

export const LIMITS = {
  planTitle: 80,
  coupleLabel: 60,
  activities: 200,
  activityId: 64,
  activityTitle: 120,
  location: 140,
  notes: 1000,
  people: 30,
  personName: 80,
  durationMin: 5,
  durationMax: 720,
  // An activity's start, in minutes from midnight on the plan's date. The
  // upper bound is two days out — enough for a wedding that runs well past
  // midnight without opening the door to a multi-day plan.
  startMax: 4 * 24 * 60,
  versionName: 80
};

export const DEFAULT_SUNSET = '16:19';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export class ValidationError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;
    this.statusCode = 400;
  }
}

function fail(code, message, field) {
  throw new ValidationError(code, message, field);
}

/** `true` for a well-formed 24-hour clock time. Rejects "99:99" and "9:05". */
export function isTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function isFiveMinuteTime(value) {
  return isTime(value) && Number(value.slice(3)) % 5 === 0;
}

/** Round a typed clock time up to the next 5 minutes (14:47 -> 14:50). */
export function roundTimeUp(value) {
  if (!isTime(value)) return null;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3));
  const total = Math.ceil((hours * 60 + minutes) / 5) * 5;
  const wrapped = total % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Durations are 5-minute multiples between 5 minutes and 12 hours. */
export function normalizeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return LIMITS.durationMin;
  return Math.min(LIMITS.durationMax, Math.max(LIMITS.durationMin, Math.ceil(number / 5) * 5));
}

function text(value, { field, max, min = 0, label }) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail('invalid_type', `${label} must be text.`, field);
  const trimmed = value.trim();
  if (trimmed.length < min) fail('required', `${label} can't be empty.`, field);
  if (trimmed.length > max) fail('too_long', `${label} can't be longer than ${max} characters.`, field);
  return trimmed;
}

function optionalTime(value, { field, label, fiveMinutes = true }) {
  if (value === undefined || value === null || value === '') return null;
  if (!isTime(value)) fail('invalid_time', `${label} must be a time like 14:45.`, field);
  if (fiveMinutes && !isFiveMinuteTime(value)) fail('invalid_time', `${label} must fall on a 5-minute mark.`, field);
  return value;
}

/** An absolute start, in minutes from midnight, on the plan's date or a day after it. */
function activityStart(value, { field }) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail('invalid_start', 'Start time must be a number of minutes from midnight.', field);
  if (number < 0 || number > LIMITS.startMax) fail('invalid_start', 'Start time is out of range.', field);
  return Math.round(number / 5) * 5;
}

/** A calendar date that actually exists — "2026-02-31" is rejected. */
function isRealDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateActivity(input, { field = 'activity', seenIds } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_type', 'Each activity must be an object.', field);

  const id = String(input.id ?? '');
  if (!ID_PATTERN.test(id)) fail('invalid_id', 'Activity id must be lowercase letters, numbers or dashes.', `${field}.id`);
  if (seenIds) {
    if (seenIds.has(id)) fail('duplicate_id', 'Two activities share the same id.', `${field}.id`);
    seenIds.add(id);
  }

  const title = text(input.title, { field: `${field}.title`, max: LIMITS.activityTitle, min: 1, label: 'Name' });

  const rawDuration = Number(input.duration);
  if (!Number.isFinite(rawDuration)) fail('invalid_duration', 'Duration must be a number of minutes.', `${field}.duration`);
  if (rawDuration < 1 || rawDuration > LIMITS.durationMax) {
    fail('invalid_duration', `Duration must be between 5 minutes and ${LIMITS.durationMax / 60} hours.`, `${field}.duration`);
  }
  const duration = normalizeDuration(rawDuration);

  const stage = String(input.stage ?? '');
  if (!STAGE_IDS.includes(stage)) fail('invalid_stage', 'That stage is not one of the available stages.', `${field}.stage`);

  const location = text(input.location, { field: `${field}.location`, max: LIMITS.location, label: 'Location' });
  const notes = text(input.notes, { field: `${field}.notes`, max: LIMITS.notes, label: 'Notes' });

  const rawPeople = input.people ?? [];
  if (!Array.isArray(rawPeople)) fail('invalid_type', 'People must be a list.', `${field}.people`);
  if (rawPeople.length > LIMITS.people) fail('too_many', `An activity can list at most ${LIMITS.people} people.`, `${field}.people`);
  const people = [];
  const seenPeople = new Set();
  for (const entry of rawPeople) {
    const person = text(entry, { field: `${field}.people`, max: LIMITS.personName, label: 'Person' });
    if (!person) continue;
    const key = person.toLowerCase();
    if (seenPeople.has(key)) continue;
    seenPeople.add(key);
    people.push(person);
  }

  const start = activityStart(input.start, { field: `${field}.start` });
  // Locked means one thing only: a group move (moving several activities
  // together) leaves this one where it is. It has no effect on anything else.
  const locked = Boolean(input.locked);

  return { id, title, duration, stage, location, people, notes, start, locked };
}

export function validatePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_type', 'The plan must be an object.', 'plan');

  const id = String(input.id ?? '').trim() || 'wedding-day';
  if (!ID_PATTERN.test(id)) fail('invalid_id', 'Plan id must be lowercase letters, numbers or dashes.', 'id');

  const title = text(input.title, { field: 'title', max: LIMITS.planTitle, min: 1, label: 'Day title' });
  const coupleLabel = text(input.coupleLabel ?? 'Our Wedding', { field: 'coupleLabel', max: LIMITS.coupleLabel, min: 1, label: 'Planner name' });

  const date = String(input.date ?? '');
  if (!isRealDate(date)) fail('invalid_date', 'Date must be a real date like 2026-11-21.', 'date');

  const status = String(input.status ?? 'Working');
  if (!PLAN_STATUSES.includes(status)) fail('invalid_status', 'That is not one of the plan statuses.', 'status');

  const rawActivities = input.activities;
  if (!Array.isArray(rawActivities)) fail('invalid_type', 'Activities must be a list.', 'activities');
  if (rawActivities.length > LIMITS.activities) fail('too_many', `A plan can hold at most ${LIMITS.activities} activities.`, 'activities');

  const seenIds = new Set();
  const activities = rawActivities.map((entry, index) => validateActivity(entry, { field: `activities[${index}]`, seenIds }));

  const plan = {
    id,
    title,
    coupleLabel,
    date,
    status,
    activities
  };

  // The view range only changes what is drawn. `timelineEnd` may be at or
  // before `timelineStart`, which means the view runs into the next day.
  // null and an empty string both mean "not set", which is how clearing the
  // field in settings reaches here.
  const timelineStart = optionalTime(input.timelineStart, { field: 'timelineStart', label: 'Timeline shows from' });
  const timelineEnd = optionalTime(input.timelineEnd, { field: 'timelineEnd', label: 'Timeline shows until' });
  if (timelineStart) plan.timelineStart = timelineStart;
  if (timelineEnd) plan.timelineEnd = timelineEnd;

  // Sunset is display-only, so it is not restricted to a 5-minute mark.
  if (input.sunset === null) plan.sunset = null;
  else if (input.sunset !== undefined && input.sunset !== '') {
    plan.sunset = optionalTime(input.sunset, { field: 'sunset', label: 'Sunset marker', fiveMinutes: false });
  }

  return plan;
}

export function validateVersionName(value) {
  return text(value, { field: 'name', max: LIMITS.versionName, min: 1, label: 'Version name' });
}

/** Non-throwing wrapper, for the client's inline field messages. */
export function checkPlan(input) {
  try {
    return { ok: true, plan: validatePlan(input) };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, error: { code: error.code, message: error.message, field: error.field } };
    throw error;
  }
}
