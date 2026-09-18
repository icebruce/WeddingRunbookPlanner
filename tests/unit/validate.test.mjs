import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SUNSET,
  LIMITS,
  STAGE_IDS,
  ValidationError,
  checkPlan,
  isFiveMinuteTime,
  isTime,
  normalizeDuration,
  roundTimeUp,
  validateActivity,
  validatePlan,
  validateVersionName
} from '../../lib/server/validate.js';

const activity = (extra = {}) => ({
  id: 'ceremony',
  title: 'Ceremony',
  duration: 60,
  stage: 'ceremony',
  location: 'Church',
  people: ['Bride'],
  notes: '',
  start: 885,
  locked: false,
  ...extra
});

const plan = (extra = {}) => ({
  id: 'wedding-day',
  title: 'Wedding Day',
  coupleLabel: 'Our Wedding',
  date: '2026-11-21',
  timezone: 'America/Toronto',
  activities: [activity()],
  ...extra
});

function rejects(input, field) {
  const result = checkPlan(input);
  assert.equal(result.ok, false, `expected ${field} to be rejected`);
  assert.equal(result.error.field, field);
  return result.error;
}

test('accepts the seed-shaped plan and returns a normalised copy', () => {
  const result = validatePlan(plan());
  assert.equal(result.title, 'Wedding Day');
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].duration, 60);
  assert.equal(result.activities[0].start, 885);
});

test('F2: a whitespace-only title is rejected, not silently emptied', () => {
  const error = rejects(plan({ title: '   ' }), 'title');
  assert.equal(error.code, 'required');
  rejects(plan({ activities: [activity({ title: '  ' })] }), 'activities[0].title');
});

test('titles are trimmed rather than stored with padding', () => {
  const result = validatePlan(plan({ title: '  Wedding Day  ' }));
  assert.equal(result.title, 'Wedding Day');
});

test('F15: the time format rejects impossible clock times', () => {
  assert.equal(isTime('99:99'), false);
  assert.equal(isTime('24:00'), false);
  assert.equal(isTime('9:05'), false);
  assert.equal(isTime('14:45'), true);
  rejects(plan({ activities: [activity({ start: 'soon' })] }), 'activities[0].start');
});

test('D31: a leftover status field is dropped, not preserved', () => {
  // Plans stored before the field was removed still carry it. Unknown fields
  // are dropped on write, which is the whole migration.
  assert.equal(Object.hasOwn(validatePlan(plan({ status: 'Working' })), 'status'), false);
});

test('the time zone is a real zone name, and defaults to the venue', () => {
  assert.equal(validatePlan(plan({ timezone: 'Europe/Lisbon' })).timezone, 'Europe/Lisbon');

  const withoutZone = plan();
  delete withoutZone.timezone;
  assert.equal(validatePlan(withoutZone).timezone, 'America/Toronto');

  const error = rejects(plan({ timezone: 'Mars/Olympus' }), 'timezone');
  assert.equal(error.code, 'invalid_timezone');
});

test('F15: the stage allowlist is closed', () => {
  for (const stage of STAGE_IDS) {
    assert.equal(validatePlan(plan({ activities: [activity({ stage })] })).activities[0].stage, stage);
  }
  rejects(plan({ activities: [activity({ stage: 'after-party' })] }), 'activities[0].stage');
});

test('F15: coupleLabel is required and bounded', () => {
  rejects(plan({ coupleLabel: '' }), 'coupleLabel');
  rejects(plan({ coupleLabel: 'x'.repeat(LIMITS.coupleLabel + 1) }), 'coupleLabel');
  assert.equal(validatePlan(plan({ coupleLabel: undefined })).coupleLabel, 'Our Wedding');
});

test('F15: durations are whole 5-minute multiples inside the range', () => {
  assert.equal(validatePlan(plan({ activities: [activity({ duration: 42 })] })).activities[0].duration, 45);
  assert.equal(validatePlan(plan({ activities: [activity({ duration: 3 })] })).activities[0].duration, 5);
  rejects(plan({ activities: [activity({ duration: 0 })] }), 'activities[0].duration');
  rejects(plan({ activities: [activity({ duration: 721 })] }), 'activities[0].duration');
  rejects(plan({ activities: [activity({ duration: 'soon' })] }), 'activities[0].duration');
});

test('F15: unknown fields are dropped instead of stored', () => {
  const result = validatePlan(plan({
    secret: 'nope',
    activities: [activity({ colour: 'red', __proto__hack: 1 })]
  }));
  assert.equal('secret' in result, false);
  assert.deepEqual(Object.keys(result.activities[0]).sort(), ['duration', 'id', 'location', 'locked', 'notes', 'people', 'stage', 'start', 'title']);
});

test('activity ids follow the documented pattern and stay unique', () => {
  rejects(plan({ activities: [activity({ id: 'Has Spaces' })] }), 'activities[0].id');
  rejects(plan({ activities: [activity({ id: 'a'.repeat(65) })] }), 'activities[0].id');
  const duplicate = checkPlan(plan({ activities: [activity(), activity()] }));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'duplicate_id');
});

test('people are bounded, trimmed and de-duplicated case-insensitively', () => {
  const result = validatePlan(plan({ activities: [activity({ people: ['Bride', ' bride ', 'Groom'] })] }));
  assert.deepEqual(result.activities[0].people, ['Bride', 'Groom']);
  rejects(plan({ activities: [activity({ people: Array.from({ length: LIMITS.people + 1 }, (_, i) => `P${i}`) })] }), 'activities[0].people');
  rejects(plan({ activities: [activity({ people: ['x'.repeat(LIMITS.personName + 1)] })] }), 'activities[0].people');
});

test('location and notes have upper bounds', () => {
  rejects(plan({ activities: [activity({ location: 'x'.repeat(LIMITS.location + 1) })] }), 'activities[0].location');
  rejects(plan({ activities: [activity({ notes: 'x'.repeat(LIMITS.notes + 1) })] }), 'activities[0].notes');
});

test('dates must be real calendar dates', () => {
  rejects(plan({ date: '2026-02-31' }), 'date');
  rejects(plan({ date: '21-11-2026' }), 'date');
  assert.equal(validatePlan(plan({ date: '2026-11-21' })).date, '2026-11-21');
});

test('a start is rounded to the 5-minute grid rather than refused', () => {
  assert.equal(validatePlan(plan({ activities: [activity({ start: 887 })] })).activities[0].start, 885);
  rejects(plan({ activities: [activity({ start: -5 })] }), 'activities[0].start');
  rejects(plan({ activities: [activity({ start: LIMITS.startMax + 10 })] }), 'activities[0].start');
});

test('an activity can be locked, which is only ever a plain boolean', () => {
  assert.equal(validatePlan(plan({ activities: [activity({ locked: true })] })).activities[0].locked, true);
  assert.equal(validatePlan(plan({ activities: [activity({ locked: 'yes' })] })).activities[0].locked, true);
  assert.equal(validatePlan(plan({ activities: [activity({ locked: undefined })] })).activities[0].locked, false);
});

test('the view range may end after midnight, and sunset is display-only', () => {
  const result = validatePlan(plan({ timelineStart: '11:00', timelineEnd: '01:15', sunset: '16:19' }));
  assert.equal(result.timelineStart, '11:00');
  assert.equal(result.timelineEnd, '01:15', 'an end at or before the start means the next day');
  assert.equal(result.sunset, '16:19');

  assert.equal(validatePlan(plan({ sunset: '16:19' })).sunset, DEFAULT_SUNSET);
  assert.equal(validatePlan(plan({ sunset: null })).sunset, null, 'null hides the marker');
  assert.equal('sunset' in validatePlan(plan()), false, 'absent means "use the default"');
  rejects(plan({ timelineStart: '11:02' }), 'timelineStart');
  rejects(plan({ sunset: '25:00' }), 'sunset');
});

test('the activity cap is enforced', () => {
  const many = Array.from({ length: LIMITS.activities + 1 }, (_, i) => activity({ id: `a${i}` }));
  rejects(plan({ activities: many }), 'activities');
});

test('errors carry a code, a message and the field that failed', () => {
  try {
    validatePlan(plan({ title: '' }));
    assert.fail('expected a ValidationError');
  } catch (error) {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.field, 'title');
    assert.match(error.message, /can't be empty/);
  }
});

test('F19: rounding helpers round up, without browser validation', () => {
  assert.equal(roundTimeUp('14:47'), '14:50');
  assert.equal(roundTimeUp('14:45'), '14:45');
  assert.equal(roundTimeUp('23:58'), '00:00', 'wraps past midnight');
  assert.equal(roundTimeUp('99:99'), null);
  assert.equal(normalizeDuration(42), 45);
  assert.equal(normalizeDuration(0), 5);
  assert.equal(normalizeDuration(10_000), 720);
  assert.equal(isFiveMinuteTime('14:45'), true);
  assert.equal(isFiveMinuteTime('14:47'), false);
});

test('version names are trimmed, required and bounded', () => {
  assert.equal(validateVersionName('  After review  '), 'After review');
  assert.throws(() => validateVersionName('   '), /can't be empty/);
  assert.throws(() => validateVersionName('x'.repeat(LIMITS.versionName + 1)), /longer than/);
});

test('validateActivity can be used on its own', () => {
  const result = validateActivity(activity({ duration: 7 }));
  assert.equal(result.duration, 10);
});
