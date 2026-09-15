import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, clampDuration, formatDuration, formatTime, parseTime } from '../src/schedule.js';

const plan = activities => ({ dayStart: '10:00', activities });
const item = (id, duration, lockedStart = null) => ({ id, title: id, duration, stage: 'preparation', location: '', people: [], notes: '', lockedStart });

test('parses and formats times', () => {
  assert.equal(parseTime('14:45'), 885);
  assert.equal(parseTime('25:00'), null);
  assert.equal(formatTime(885), '2:45 PM');
  assert.equal(formatDuration(90), '1h 30m');
});

test('ripples flexible activities', () => {
  const result = buildSchedule(plan([item('a', 30), item('b', 45), item('c', 15)]));
  assert.deepEqual(result.items.map(x => [x.start, x.end]), [[600, 630], [630, 675], [675, 690]]);
});

test('creates open time before a fixed anchor', () => {
  const result = buildSchedule(plan([item('a', 30), item('b', 45, '11:30')]));
  assert.equal(result.items[1].gapBefore, 60);
  assert.equal(result.items[1].conflictMinutes, 0);
  assert.equal(result.items[1].startLabel, '11:30 AM');
});

test('detects an overrun into a fixed anchor and keeps anchor fixed', () => {
  const result = buildSchedule(plan([item('a', 120), item('b', 45, '11:30')]));
  assert.equal(result.items[1].startLabel, '11:30 AM');
  assert.equal(result.items[1].conflictMinutes, 30);
  assert.equal(result.totalConflicts, 1);
  assert.equal(result.endLabel, '12:15 PM');
});

test('clamps durations to five-minute steps', () => {
  assert.equal(clampDuration(3), 5);
  assert.equal(clampDuration(42), 45);
  assert.equal(clampDuration(46), 50);
  assert.equal(clampDuration(999), 720);
});

test('treats post-midnight fixed times as next day', () => {
  const result = buildSchedule(plan([item('a', 900), item('b', 30, '01:15')]));
  assert.equal(result.items[1].start, 1515);
  assert.equal(result.items[1].startLabel, '1:15 AM');
  assert.equal(result.items[1].conflictMinutes, 0);
});
