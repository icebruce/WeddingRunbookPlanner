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

const activity = (id, start, duration, extra = {}) => ({
  id,
  title: id,
  start,
  duration,
  stage: 'preparation',
  location: '',
  people: [],
  notes: '',
  locked: false,
  ...extra
});

const plan = (activities, extra = {}) => ({
  id: 'wedding-day',
  title: 'Wedding Day',
  coupleLabel: 'Our Wedding',
  date: '2026-11-21',
  timezone: 'America/Toronto',
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

test('every activity keeps the start it was given — nothing here moves it', () => {
  const result = buildSchedule(plan([
    activity('a', T(10), 30),
    activity('b', T(11), 45),
    activity('c', T(15), 15)
  ]));
  assert.deepEqual(result.items.map(item => [item.start, item.end]), [[T(10), T(10, 30)], [T(11), T(11, 45)], [T(15), T(15, 15)]]);
  assert.equal(result.dayEnd, T(15, 15));
  assert.equal(result.openTimes.length, 2);
  assert.equal(result.overlaps.length, 0);
});

test('activities come back sorted by start, whatever order they were stored in', () => {
  const result = buildSchedule(plan([activity('late', T(14), 30), activity('early', T(9), 30)]));
  assert.deepEqual(result.items.map(item => item.id), ['early', 'late']);
});

test('a gap between activities is exactly the space between them', () => {
  const result = buildSchedule(plan([activity('a', T(10), 30), activity('b', T(11), 30)]));
  assert.equal(result.openTimes.length, 1);
  assert.deepEqual(
    { start: result.openTimes[0].start, end: result.openTimes[0].end, beforeId: result.openTimes[0].beforeId },
    { start: T(10, 30), end: T(11), beforeId: 'b' }
  );
  assert.equal(result.summary.openMinutes, 30);
});

test('two activities that share time overlap — nothing here resolves it', () => {
  const result = buildSchedule(plan([activity('a', T(10), 90), activity('b', T(10, 30), 30)]));
  assert.equal(result.overlaps.length, 1);
  assert.deepEqual(
    { start: result.overlaps[0].start, end: result.overlaps[0].end, minutes: result.overlaps[0].minutes },
    { start: T(10, 30), end: T(11), minutes: 30 }
  );
  assert.equal(result.items[0].overlaps.length, 1);
  assert.equal(result.items[0].overlaps[0].withId, 'b');
  assert.equal(result.items[1].overlapMinutes, 30);
  assert.equal(result.summary.conflictMinutes, 30);
});

test('a locked activity overlapping earlier work is still just an overlap', () => {
  const result = buildSchedule(plan([
    activity('travel', T(10), 200),
    activity('ceremony', T(12), 60, { locked: true })
  ]));
  assert.equal(result.items.find(item => item.id === 'travel').end, T(13, 20));
  assert.equal(result.items.find(item => item.id === 'ceremony').start, T(12), 'a locked activity is never moved by anything here');
  assert.equal(result.overlaps.length, 1);
  assert.equal(result.overlaps[0].minutes, 60, 'the ceremony only lasts an hour, so that bounds the overlap');
});

test('three activities can overlap at once', () => {
  const result = buildSchedule(plan([
    activity('a', T(10), 60),
    activity('b', T(10, 30), 60),
    activity('c', T(10, 45), 30)
  ]));
  assert.equal(result.overlaps.length, 3, 'every pair that shares time counts');
});

test('an activity may start on the day after the plan date', () => {
  const result = buildSchedule(plan([
    activity('evening', T(23), 120),
    activity('afterparty', T(25, 15), 60)
  ]));
  assert.equal(result.items[1].start, T(25, 15), 'stored exactly as given — no day-boundary guessing');
  assert.equal(result.items[1].startLabel, '1:15 AM');
  assert.equal(result.overlaps.length, 0);
});

test('an activity that itself crosses midnight keeps running', () => {
  const result = buildSchedule(plan([activity('party', T(23), 180)]));
  assert.equal(result.dayEnd, T(26));
  assert.equal(result.items[0].endLabel, '2:00 AM');
});

test('durations are normalised before anything else is computed', () => {
  const result = buildSchedule(plan([activity('a', T(10), 42), activity('b', T(11), 3)]));
  assert.deepEqual(result.items.map(item => item.duration), [45, 5]);
});

test('the summary describes the whole day', () => {
  const result = buildSchedule(plan([
    activity('a', T(10), 30),
    activity('b', T(12), 60),
    activity('c', T(13, 30), 30)
  ]));
  assert.deepEqual(result.summary, {
    count: 3,
    start: T(10),
    end: T(14),
    openMinutes: 120,
    conflictMinutes: 0
  });
});

test('an empty plan still has a start and an end', () => {
  const result = buildSchedule(plan([]));
  assert.equal(result.items.length, 0);
  assert.equal(result.dayStart, 480);
  assert.equal(result.dayEnd, 480);
});
