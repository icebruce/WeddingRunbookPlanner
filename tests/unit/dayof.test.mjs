import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_VIEW_ONLY_MS,
  TICK_MS,
  cardStateAt,
  clearOverride,
  createClock,
  minutesNow,
  readOverride,
  shouldBeOn,
  stripState,
  writeOverride
} from '../../public/src/dayof.js';

const DATE = '2026-11-21';
// A wall-clock time at the venue, as an instant. The offset is spelled out
// because every date in this file is in November, when Montreal is on EST —
// the app itself never assumes a fixed offset (see the time-zone tests below),
// but a test that did not pin one would assert whatever the runner's own zone
// happened to be, which is the bug these times exist to catch.
const at = (hours, minutes = 0, day = 21) =>
  new Date(`2026-11-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-05:00`);

const T = (h, m = 0) => h * 60 + m;

const activity = (id, start, duration, extra = {}) => ({
  id, title: id, start, duration, stage: 'preparation', location: '', people: [], notes: '', locked: false, ...extra
});

const plan = (activities, extra = {}) => ({
  id: 'wedding-day', title: 'Wedding Day', coupleLabel: 'Our Wedding',
  date: DATE, timezone: 'America/Toronto', activities, ...extra
});

const day = () => plan([
  activity('ready', T(11, 30), 45, { title: 'Getting Ready' }),
  activity('portraits', T(12, 15), 30, { title: 'Portraits' }),
  activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true }),
  activity('party', T(15, 45), 120, { title: 'Dancing & Party' })
]);

test('D1: the day-of view turns itself on on the day', () => {
  assert.equal(shouldBeOn(day(), at(0, 1)), true, 'from midnight on the date');
  assert.equal(shouldBeOn(day(), at(13)), true);
  assert.equal(shouldBeOn(day(), at(13, 0, 20)), false, 'not the day before');
  assert.equal(shouldBeOn(day(), at(13, 0, 22)), false, 'not the day after');
});

test('a plan running past midnight is still today\'s plan at one in the morning', () => {
  const late = plan([
    activity('party', T(22), 240, { title: 'Dancing & Party', locked: true })
  ]);

  assert.equal(shouldBeOn(late, at(1, 30, 22)), true, 'still running');
  assert.equal(shouldBeOn(late, at(3, 30, 22)), false, 'over by then');
  assert.equal(shouldBeOn(day(), at(1, 30, 22)), false, 'a plan that ended does not linger');
});

test('the clock counts from midnight on the plan\'s date, not from today', () => {
  assert.equal(minutesNow(day(), at(13, 32)), 13 * 60 + 32);
  assert.equal(minutesNow(day(), at(1, 15, 22)), 25 * 60 + 15, 'one in the morning is 1515, not 75');
});

test('before the first activity, the strip counts down to it', () => {
  const state = stripState(day(), at(11, 0));
  assert.equal(state.kind, 'before');
  assert.equal(state.headline, 'Starts in 30 min');
  assert.equal(state.detail, 'Getting Ready, 11:30 AM');
});

test('during an activity, the strip says what it is and how long is left', () => {
  const state = stripState(day(), at(11, 45));
  assert.equal(state.kind, 'during');
  assert.equal(state.headline, 'Getting Ready');
  assert.equal(state.remaining, 30);
  assert.equal(state.remainingLabel, '30 min left');
  assert.ok(state.progress > 0.3 && state.progress < 0.4);
  assert.equal(state.next.title, 'Portraits');
});

test('during open time, the strip counts down to what is next', () => {
  const state = stripState(day(), at(13, 30));
  assert.equal(state.kind, 'open');
  assert.equal(state.headline, 'Open');
  assert.equal(state.detail, '1 hr 15 min until Ceremony');
  assert.equal(state.next.title, 'Ceremony');
});

test('when two things are happening at once, the locked one is what is really happening', () => {
  const overlap = plan([
    activity('travel', T(11, 30), 240, { title: 'Travel to Church' }),
    activity('ceremony', T(14, 45), 60, { title: 'Ceremony', locked: true })
  ]);

  const state = stripState(overlap, at(15, 0));
  assert.equal(state.kind, 'during');
  assert.equal(state.current.id, 'ceremony', 'the one with a promise attached');
  assert.equal(state.overrunning.id, 'travel');
  assert.equal(state.detail, 'Also now: Travel to Church');
});

test('after the last activity, the day is complete', () => {
  const state = stripState(day(), at(18, 0));
  assert.equal(state.kind, 'after');
  assert.equal(state.headline, 'Day complete');
});

test('the strip works at 23:59, at midnight and at 01:15', () => {
  const late = plan([
    activity('party', T(22), 240, { title: 'Dancing & Party', locked: true })
  ]);

  const before = stripState(late, at(23, 59));
  assert.equal(before.kind, 'during');
  assert.equal(before.remaining, 121);

  const midnight = stripState(late, at(0, 0, 22));
  assert.equal(midnight.kind, 'during', 'midnight is not the end of the day');
  assert.equal(midnight.remaining, 120);

  const after = stripState(late, at(1, 15, 22));
  assert.equal(after.kind, 'during');
  assert.equal(after.remaining, 45);

  assert.equal(stripState(late, at(2, 30, 22)).kind, 'after');
});

test('an empty plan says so rather than pretending', () => {
  assert.equal(stripState(plan([]), at(13)).kind, 'empty');
});

test('cards are past, live or still to come', () => {
  const [ready, portraits] = day().activities;
  const item = (start, duration) => ({ start, end: start + duration });

  assert.equal(cardStateAt(item(690, 45), 800), 'past');
  assert.equal(cardStateAt(item(690, 45), 700), 'live');
  assert.equal(cardStateAt(item(690, 45), 600), 'ahead');
  assert.ok(ready && portraits);
});

test('the clock ticks once immediately and then every half minute', () => {
  const ticks = [];
  const timers = [];
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearInterval = () => {};

  try {
    const clock = createClock(now => ticks.push(now), { now: () => at(13, 32) });
    clock.start();
    assert.equal(ticks.length, 1, 'the first answer is not half a minute away');
    assert.equal(timers[0].ms, TICK_MS);

    timers[0].fn();
    assert.equal(ticks.length, 2);

    clock.start();
    assert.equal(timers.length, 1, 'starting twice does not start two clocks');
  } finally {
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
  }
});

test('five minutes away is the point at which editing lapses', () => {
  assert.equal(AUTO_VIEW_ONLY_MS, 5 * 60_000);
});

// ------------------------------------------------------------- the override

/** A minimal in-memory stand-in for the browser's localStorage. */
function fakeLocalStorage() {
  const backing = new Map();
  return {
    getItem: key => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: key => backing.delete(key)
  };
}

/** Runs `fn` with a fresh fake localStorage in place, then restores whatever was there. */
function withStorage(storage, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

test('writing an override persists it, and reading it back for that date returns it', () => {
  withStorage(fakeLocalStorage(), () => {
    assert.equal(readOverride(DATE), null, 'nothing stored yet');
    writeOverride(DATE, true);
    assert.equal(readOverride(DATE), true);

    writeOverride(DATE, false);
    assert.equal(readOverride(DATE), false, 'the latest write wins');
  });
});

test('clearOverride removes the stored override', () => {
  withStorage(fakeLocalStorage(), () => {
    writeOverride(DATE, true);
    assert.equal(readOverride(DATE), true);

    clearOverride();
    assert.equal(readOverride(DATE), null);
  });
});

test('an override written for one date does not affect another date', () => {
  withStorage(fakeLocalStorage(), () => {
    writeOverride(DATE, false);
    assert.equal(readOverride('2026-12-25'), null, 'a different date sees no override');
    assert.equal(readOverride(DATE), false, 'the date it was written for still sees it');
  });
});

test('without storage available, reading, writing and clearing all fail quietly', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  delete globalThis.localStorage;
  try {
    assert.equal(readOverride(DATE), null, 'no override to read without storage');
    assert.doesNotThrow(() => writeOverride(DATE, true));
    assert.doesNotThrow(() => clearOverride());
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('a storage that throws on access is treated the same as no storage at all', () => {
  const angry = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  withStorage(angry, () => {
    assert.equal(readOverride(DATE), null);
    assert.doesNotThrow(() => writeOverride(DATE, true));
    assert.doesNotThrow(() => clearOverride());
  });
});

// --------------------------------------------------------------- time zones

const MONTREAL = 'America/Toronto';

const zoned = (extra = {}) => ({
  id: 'wedding-day',
  title: 'Wedding Day',
  coupleLabel: 'Our Wedding',
  date: '2026-11-21',
  timezone: MONTREAL,
  activities: [
    { id: 'a', title: 'Ceremony', start: 14 * 60 + 45, duration: 60, stage: 'ceremony', location: '', people: [], notes: '', locked: false }
  ],
  ...extra
});

test('the day-of view follows the venue clock, not the reader\'s', () => {
  // 03:30 UTC on the 22nd is 22:30 on the 21st in Montreal: still the wedding
  // day at the venue, already the day after in London.
  const stillTheDay = new Date('2026-11-22T03:30:00Z');
  assert.equal(shouldBeOn(zoned(), stillTheDay), true);

  // 04:00 UTC on the 21st is 23:00 on the 20th in Montreal: not yet.
  assert.equal(shouldBeOn(zoned(), new Date('2026-11-21T04:00:00Z')), false);
});

test('minutesNow counts from midnight at the venue', () => {
  // 19:45 UTC on the wedding day is 2:45 PM in Montreal (EST, UTC-5).
  assert.equal(minutesNow(zoned(), new Date('2026-11-21T19:45:00Z')), 14 * 60 + 45);
});

test('a summer plan uses daylight time, which a fixed offset would get wrong', () => {
  // July: Montreal is EDT (UTC-4). 16:00 UTC is noon, not 11 AM.
  const summer = zoned({ date: '2026-07-11' });
  assert.equal(minutesNow(summer, new Date('2026-07-11T16:00:00Z')), 12 * 60);
});

test('a missing time zone falls back to the venue default', () => {
  const noZone = zoned();
  delete noZone.timezone;
  assert.equal(minutesNow(noZone, new Date('2026-11-21T19:45:00Z')), 14 * 60 + 45);
});

test('the plan status no longer turns the day-of view on (D31)', () => {
  // A day that is not the wedding day stays a planning day, whatever any
  // leftover status field says.
  const other = zoned({ date: '2026-11-21', status: 'Final' });
  assert.equal(shouldBeOn(other, new Date('2026-06-01T16:00:00Z')), false);
});
