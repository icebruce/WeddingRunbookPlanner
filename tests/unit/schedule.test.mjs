import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSchedule,
  clampDuration,
  formatCountdown,
  formatDuration,
  formatRange,
  formatTime,
  minutesToTime,
  parseTime
} from '../../public/src/schedule.js';

const T = (h, m = 0) => h * 60 + m;

const activity = (id, duration, extra = {}) => ({
  id,
  title: id,
  duration,
  stage: 'preparation',
  location: '',
  people: [],
  notes: '',
  lockedStart: null,
  ...extra
});

const plan = (activities, extra = {}) => ({
  id: 'wedding-day',
  title: 'Wedding Day',
  coupleLabel: 'Our Wedding',
  date: '2026-11-21',
  dayStart: '10:00',
  status: 'Working',
  activities,
  ...extra
});

test('parses and formats times', () => {
  assert.equal(parseTime('14:45'), 885);
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseTime('9:05'), null);
  assert.equal(formatTime(885), '2:45 PM');
  assert.equal(formatTime(885, { meridiem: false }), '2:45');
  assert.equal(formatTime(0), '12:00 AM');
  assert.equal(formatTime(T(24, 15)), '12:15 AM', 'past midnight wraps for display');
  assert.equal(minutesToTime(T(25, 15)), '01:15');
});

test('a range drops the first AM/PM when both halves match', () => {
  assert.equal(formatRange(T(12, 45), T(13, 15)), '12:45 – 1:15 PM');
  assert.equal(formatRange(T(11, 30), T(12, 15)), '11:30 AM – 12:15 PM');
});

test('durations read the way a person would say them', () => {
  assert.equal(formatDuration(30), '30 min');
  assert.equal(formatDuration(60), '1 hr');
  assert.equal(formatDuration(90), '1 hr 30 min');
  assert.equal(formatDuration(180), '3 hr');
  assert.equal(formatCountdown(130), '2 hr 10 min');
  assert.equal(clampDuration(42), 45);
});

test('flexible activities follow on from each other', () => {
  const result = buildSchedule(plan([activity('a', 30), activity('b', 45), activity('c', 15)]));
  assert.deepEqual(result.items.map(item => [item.start, item.end]), [[600, 630], [630, 675], [675, 690]]);
  assert.equal(result.dayEnd, 690);
  assert.equal(result.openTimes.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test('a fixed activity leaves open time in front of it', () => {
  const result = buildSchedule(plan([activity('a', 30), activity('b', 60, { lockedStart: '12:00' })]));
  assert.deepEqual(result.items.map(item => item.start), [600, 720]);
  assert.equal(result.openTimes.length, 1);
  assert.deepEqual(
    { ...result.openTimes[0], index: undefined },
    { start: 630, end: 720, beforeId: 'b', beforeTitle: 'b', kind: 'fixed', index: undefined }
  );
  assert.equal(result.summary.openMinutes, 90);
});

test('a fixed activity does not move when earlier work runs into it', () => {
  const result = buildSchedule(plan([activity('a', 200), activity('fixed', 60, { lockedStart: '12:00' })]));
  const [first, fixed] = result.items;

  assert.equal(first.start, 600);
  assert.equal(first.end, 800, 'the overrunning activity keeps its real end');
  assert.equal(fixed.start, 720, 'the fixed activity stays exactly where it was fixed');
  // Two different numbers, and both are true. The fixed card says how far
  // earlier work runs past its start (80 min: 10:00 + 200 = 1:20 PM against a
  // 12:00 start). The overrunning card says how far it runs *into* that
  // activity, which is bounded by how long the fixed activity itself lasts.
  assert.equal(fixed.conflictMinutes, 80);
  assert.equal(first.overrun.minutes, 60, 'the fixed activity only runs 12:00–1:00');

  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].overrunIds, ['a']);
  assert.equal(first.overrun.intoTitle, 'fixed');
  assert.equal(result.summary.conflictMinutes, 80, 'the summary counts time lost, as the mockup does');
});

test('stored open time places a flexible activity later', () => {
  const result = buildSchedule(plan([activity('a', 30), activity('b', 30, { gapBefore: 15 })]));
  assert.deepEqual(result.items.map(item => item.start), [600, 645]);
  assert.equal(result.openTimes[0].kind, 'stored');
  assert.equal(result.openTimes[0].end - result.openTimes[0].start, 15);
});

test('stored open time is ignored on a fixed activity', () => {
  const result = buildSchedule(plan([activity('a', 30), activity('b', 30, { lockedStart: '13:00', gapBefore: 45 })]));
  assert.equal(result.items[1].start, T(13));
});

test('a fixed time after midnight belongs to the next day', () => {
  const result = buildSchedule(plan([
    activity('evening', 120, { lockedStart: '23:00' }),
    activity('afterparty', 60, { lockedStart: '01:15' })
  ], { dayStart: '22:00' }));

  assert.equal(result.items[0].start, T(23));
  assert.equal(result.items[1].start, T(25, 15), '1:15 AM the next morning, not this morning');
  assert.equal(result.items[1].startLabel, '1:15 AM');
  assert.equal(result.conflicts.length, 0);
});

test('an activity that itself crosses midnight keeps running', () => {
  const result = buildSchedule(plan([activity('party', 180, { lockedStart: '23:00' })], { dayStart: '22:00' }));
  assert.equal(result.dayEnd, T(26));
  assert.equal(result.items[0].endLabel, '2:00 AM');
});

test('durations are normalised before anything is placed', () => {
  const result = buildSchedule(plan([activity('a', 42), activity('b', 3)]));
  assert.deepEqual(result.items.map(item => item.duration), [45, 5]);
  assert.deepEqual(result.items.map(item => item.start), [600, 645]);
});

test('the summary describes the whole day', () => {
  const result = buildSchedule(plan([
    activity('a', 30),
    activity('b', 60, { lockedStart: '12:00' }),
    activity('c', 30)
  ]));
  assert.deepEqual(result.summary, {
    count: 3,
    start: 600,
    end: 810,
    openMinutes: 90,
    conflictMinutes: 0
  });
});

test('an empty plan still has a start and an end', () => {
  const result = buildSchedule(plan([]));
  assert.equal(result.items.length, 0);
  assert.equal(result.dayStart, 600);
  assert.equal(result.dayEnd, 600);
});

test('several activities can overrun one fixed activity', () => {
  const result = buildSchedule(plan([
    activity('a', 60),
    activity('b', 180),
    activity('fixed', 60, { lockedStart: '12:00' })
  ]));
  assert.deepEqual(result.conflicts[0].overrunIds, ['b'], 'only the ones still running when it starts');
  assert.equal(result.items[0].overrun, undefined);
  assert.equal(result.items[1].overrun.minutes, 60);
});
