/**
 * The picker's value rules — the parts that decide what gets stored, kept
 * apart from the DOM so they can be asserted without a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NEXT_DAY_BEFORE,
  formatClock,
  formatStart,
  parseDate,
  parseTime,
  resolveStart,
  toDateString,
  toTimeString
} from '../../public/src/render/pickers.js';

const PLAN_DATE = '2026-11-21';

test('a time from 4 AM onwards belongs to the plan\'s own date', () => {
  assert.equal(resolveStart(4 * 60), 240, 'four in the morning is the earliest the wedding day starts');
  assert.equal(resolveStart(11 * 60 + 30), 690);
  assert.equal(resolveStart(23 * 60 + 45), 1425);
});

test('a time before 4 AM belongs to the day after', () => {
  // A wedding day starts in the morning, so the small hours are always the far
  // end of the night (FUNCTIONAL_SPEC §5.2).
  assert.equal(resolveStart(0), 1440, 'midnight is the next day, not the start of this one');
  assert.equal(resolveStart(75), 1515);
  assert.equal(resolveStart(NEXT_DAY_BEFORE - 5), 1675, '3:55 AM is the last minute that rolls over');
});

test('the threshold is the one number the rule turns on', () => {
  assert.equal(NEXT_DAY_BEFORE, 240);
  assert.equal(resolveStart(NEXT_DAY_BEFORE) < 1440, true);
  assert.equal(resolveStart(NEXT_DAY_BEFORE - 5) >= 1440, true);
});

test('a start past midnight reads as the next calendar day', () => {
  assert.equal(formatStart(690, PLAN_DATE), 'Sat, Nov 21 · 11:30 AM');
  assert.equal(formatStart(1425, PLAN_DATE), 'Sat, Nov 21 · 11:45 PM');
  assert.equal(formatStart(1515, PLAN_DATE), 'Sun, Nov 22 · 1:15 AM');
});

test('the clock reads the way the rest of the app writes times', () => {
  assert.equal(formatClock(0), '12:00 AM');
  assert.equal(formatClock(12 * 60), '12:00 PM');
  assert.equal(formatClock(13 * 60 + 5), '1:05 PM');
  // An absolute start past midnight still reads as a time of day.
  assert.equal(formatClock(1515), '1:15 AM');
});

test('times and dates survive a round trip', () => {
  assert.equal(toTimeString(parseTime('16:19')), '16:19');
  assert.equal(parseTime('99:99'), null, 'the same rejection validate.js makes');
  assert.equal(parseTime(''), null);
  assert.equal(toDateString(parseDate('2026-11-21')), '2026-11-21');
  assert.equal(parseDate('nope'), null);
});
