import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_INSET,
  PX_PER_MIN,
  box,
  buildLayout,
  density,
  lanes,
  range,
  ticks,
  y
} from '../../public/src/layout.js';
import { buildSchedule } from '../../public/src/schedule.js';

const T = (h, m = 0) => h * 60 + m;

const activity = (id, duration, extra = {}) => ({
  id, title: id, duration, stage: 'preparation', location: '', people: [], notes: '', lockedStart: null, ...extra
});

const plan = (activities, extra = {}) => ({
  id: 'wedding-day', title: 'Wedding Day', coupleLabel: 'Our Wedding',
  date: '2026-11-21', dayStart: '11:30', status: 'Working', activities, ...extra
});

const layoutOf = (activities, extra = {}) => {
  const p = plan(activities, extra);
  return { plan: p, schedule: buildSchedule(p), layout: buildLayout(p, buildSchedule(p)) };
};

test('the scale is 20 px per 5 minutes', () => {
  assert.equal(PX_PER_MIN, 4);
  assert.equal(5 * PX_PER_MIN, 20);
  assert.equal(y(T(12), T(11)), 240, 'one hour is 240 px');
});

test('F4: every card edge sits on its own time, with no minimum height', () => {
  const { layout } = layoutOf([
    activity('a', 45),
    activity('b', 5),
    activity('cocktail', 75, { lockedStart: '16:00' })
  ]);

  for (const card of layout.cards) {
    assert.equal(card.top, (card.item.start - layout.from) * PX_PER_MIN + CARD_INSET, `${card.item.id} top`);
    assert.equal(
      card.top + card.height,
      (card.item.end - layout.from) * PX_PER_MIN - CARD_INSET,
      `${card.item.id} bottom`
    );
  }

  // The five-minute card is 18 px tall and stays that way. Growing it to a
  // readable minimum is exactly what pushed later cards off their times.
  const short = layout.cards.find(card => card.item.id === 'b');
  assert.equal(short.height, 5 * PX_PER_MIN - 2);

  const fixed = layout.cards.find(card => card.item.id === 'cocktail');
  assert.equal(fixed.item.start, T(16), 'a 4:00 PM activity is drawn at 4:00 PM');
});

test('no two full-width cards ever overlap', () => {
  const { layout } = layoutOf([
    activity('a', 45), activity('b', 5), activity('c', 10), activity('d', 30), activity('e', 15)
  ]);
  const full = layout.cards.filter(card => card.lane === null).sort((a, b) => a.top - b.top);
  for (let i = 1; i < full.length; i += 1) {
    assert.ok(
      full[i].top >= full[i - 1].top + full[i - 1].height,
      `${full[i].item.id} starts before ${full[i - 1].item.id} ends`
    );
  }
});

test('the range defaults to half an hour either side of the plan', () => {
  const { layout } = layoutOf([activity('a', 60)]);
  assert.equal(layout.from, T(11), '11:30 less 30 minutes');
  assert.equal(layout.to, T(13), '12:30 plus 30 minutes');
  assert.equal(layout.height, (T(13) - T(11)) * PX_PER_MIN);
});

test('a configured view range widens the timeline', () => {
  const { layout } = layoutOf([activity('a', 60)], { timelineStart: '09:00', timelineEnd: '20:00' });
  assert.equal(layout.from, T(9));
  assert.equal(layout.to, T(20));
});

test('the range always grows to fit; a setting never crops an activity', () => {
  const { layout } = layoutOf(
    [activity('early', 30, { lockedStart: '08:00' }), activity('late', 120)],
    { timelineStart: '12:00', timelineEnd: '13:00' }
  );
  assert.ok(layout.from <= T(8), 'an activity before the configured start still shows');
  assert.ok(layout.to >= T(10, 30), 'an activity after the configured end still shows');
});

test('a view end at or before the start means the next day', () => {
  const { layout } = layoutOf([activity('a', 60, { lockedStart: '22:00' })], {
    dayStart: '22:00', timelineStart: '21:00', timelineEnd: '01:15'
  });
  assert.equal(layout.from, T(21));
  assert.equal(layout.to, T(25, 15), '1:15 AM is after 9:00 PM, not before it');
});

test('ticks run every five minutes with a hierarchy and no five-minute labels', () => {
  const list = ticks(T(12), T(13));
  assert.equal(list.length, 13, 'thirteen lines from 12:00 to 13:00 inclusive');

  const kinds = Object.fromEntries(list.map(tick => [tick.minute, tick.kind]));
  assert.equal(kinds[T(12)], 'hour');
  assert.equal(kinds[T(12, 30)], 'half');
  assert.equal(kinds[T(12, 15)], 'quarter');
  assert.equal(kinds[T(12, 45)], 'quarter');
  assert.equal(kinds[T(12, 5)], 'five');
  assert.equal(kinds[T(12, 50)], 'five');

  assert.deepEqual(
    list.filter(tick => tick.labelled).map(tick => tick.minute),
    [T(12), T(12, 15), T(12, 30), T(12, 45), T(13)]
  );
});

test('ticks land on their exact minute', () => {
  for (const tick of ticks(T(12), T(13))) {
    assert.equal(tick.top, (tick.minute - T(12)) * PX_PER_MIN);
  }
});

test('conflicting activities are put in columns, and nothing else is', () => {
  const { schedule, layout } = layoutOf([
    activity('travel', 200),
    activity('ceremony', 60, { lockedStart: '14:45' }),
    activity('after', 30)
  ]);

  const assigned = lanes(schedule);
  assert.equal(assigned.get('ceremony'), 1, 'the fixed activity takes the right column');
  assert.equal(assigned.get('travel'), 0, 'the overrunning activity takes the left one');
  assert.equal(assigned.has('after'), false);

  const after = layout.cards.find(card => card.item.id === 'after');
  assert.equal(after.lane, null, 'everything else spans the full width');
});

test('columns never intersect, because they are side by side', () => {
  const { layout } = layoutOf([activity('travel', 200), activity('ceremony', 60, { lockedStart: '14:45' })]);
  const left = layout.cards.find(card => card.lane === 0);
  const right = layout.cards.find(card => card.lane === 1);

  assert.ok(left && right);
  // They overlap in time — that is the point — and are separated horizontally.
  assert.ok(left.top < right.top + right.height && right.top < left.top + left.height);
  assert.notEqual(left.lane, right.lane);
});

test('the hatched part of an overrunning card matches the overlap', () => {
  const { layout } = layoutOf([activity('travel', 200), activity('ceremony', 60, { lockedStart: '14:45' })]);
  const travel = layout.cards.find(card => card.item.id === 'travel');
  assert.equal(travel.overrunHeight, travel.item.overrun.minutes * PX_PER_MIN);
  assert.ok(travel.overrunHeight <= travel.height + CARD_INSET * 2);
});

test('the ruler marks the overlap', () => {
  const { layout } = layoutOf([activity('travel', 200), activity('ceremony', 60, { lockedStart: '14:45' })]);
  assert.equal(layout.conflictRails.length, 1);
  assert.equal(layout.conflictRails[0].height, layout.conflictRails[0].minutes * PX_PER_MIN);
});

test('open time is a box on its own times', () => {
  const { layout } = layoutOf([activity('a', 30), activity('fixed', 60, { lockedStart: '13:00' })]);
  assert.equal(layout.openTimes.length, 1);
  const gap = layout.openTimes[0];
  assert.equal(gap.minutes, 60);
  assert.equal(gap.top, (T(12) - layout.from) * PX_PER_MIN + CARD_INSET);
  assert.equal(gap.height, 60 * PX_PER_MIN - 2);
});

test('density decides padding, and only padding', () => {
  assert.equal(density(5), 'line');
  assert.equal(density(10), 'line');
  assert.equal(density(15), 'small');
  assert.equal(density(25), 'small');
  assert.equal(density(30), 'standard');
  assert.equal(density(180), 'standard');
});

test('the sunset marker sits at its time, and is dropped when out of view', () => {
  const inView = layoutOf([activity('a', 600)], { sunset: '16:19' }).layout;
  assert.equal(inView.sunset.minutes, T(16, 19));
  assert.equal(inView.sunset.top, (T(16, 19) - inView.from) * PX_PER_MIN);

  const hidden = layoutOf([activity('a', 30)], { sunset: null }).layout;
  assert.equal(hidden.sunset, null, 'an empty setting hides the marker');

  const outside = layoutOf([activity('a', 30)], { sunset: '23:00' }).layout;
  assert.equal(outside.sunset, null);
});

test('the end marker sits at the end of the day', () => {
  const { schedule, layout } = layoutOf([activity('a', 45), activity('b', 30)]);
  assert.equal(layout.endTop, (schedule.dayEnd - layout.from) * PX_PER_MIN);
});

test('box() is the whole geometry contract', () => {
  const item = { start: T(12, 45), end: T(13, 15), duration: 30 };
  assert.deepEqual(box(item, T(11)), { top: 105 * PX_PER_MIN + 1, height: 30 * PX_PER_MIN - 2 });
});

test('range is stable for an empty plan', () => {
  const p = plan([]);
  const result = range(p, buildSchedule(p));
  assert.equal(result.from, T(11));
  assert.equal(result.to, T(12));
});
