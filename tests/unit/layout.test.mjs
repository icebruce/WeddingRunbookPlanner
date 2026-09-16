import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_INSET,
  PX_PER_MIN,
  box,
  buildLayout,
  density,
  laneStyle,
  lanes,
  overlapBox,
  range,
  ticks,
  y
} from '../../public/src/layout.js';
import { buildSchedule } from '../../public/src/schedule.js';

const T = (h, m = 0) => h * 60 + m;

const activity = (id, start, duration, extra = {}) => ({
  id, title: id, start, duration, stage: 'preparation', location: '', people: [], notes: '', locked: false, ...extra
});

const plan = (activities, extra = {}) => ({
  id: 'wedding-day', title: 'Wedding Day', coupleLabel: 'Our Wedding',
  date: '2026-11-21', status: 'Working', activities, ...extra
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
    activity('a', T(11, 30), 45),
    activity('b', T(12, 15), 5),
    activity('cocktail', T(16), 75)
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
  assert.equal(short.height, 5 * PX_PER_MIN - CARD_INSET * 2);

  const fixed = layout.cards.find(card => card.item.id === 'cocktail');
  assert.equal(fixed.item.start, T(16), 'a 4:00 PM activity is drawn at 4:00 PM');
});

test('non-overlapping cards never share a lane, and each spans the full width', () => {
  const { layout } = layoutOf([
    activity('a', T(11), 45), activity('b', T(12), 5), activity('c', T(12, 10), 10), activity('d', T(13), 30)
  ]);
  for (const card of layout.cards) {
    assert.equal(card.totalLanes, 1);
    assert.equal(laneStyle(card.lane, card.totalLanes), '', 'a lone card gets no left/width override');
  }
});

test('the range defaults to half an hour either side of the earliest and latest activity', () => {
  const { layout } = layoutOf([activity('a', T(11, 30), 60)]);
  assert.equal(layout.from, T(11), '11:30 less 30 minutes');
  assert.equal(layout.to, T(13), '12:30 plus 30 minutes');
  assert.equal(layout.height, (T(13) - T(11)) * PX_PER_MIN);
});

test('a configured view range widens the timeline', () => {
  const { layout } = layoutOf([activity('a', T(11, 30), 60)], { timelineStart: '09:00', timelineEnd: '20:00' });
  assert.equal(layout.from, T(9));
  assert.equal(layout.to, T(20));
});

test('the range always grows to fit; a setting never crops an activity', () => {
  const { layout } = layoutOf(
    [activity('early', T(8), 30), activity('late', T(11, 30), 120)],
    { timelineStart: '12:00', timelineEnd: '13:00' }
  );
  assert.ok(layout.from <= T(8), 'an activity before the configured start still shows');
  assert.ok(layout.to >= T(13, 30), 'an activity after the configured end still shows');
});

test('a view end at or before the start means the next day', () => {
  const { layout } = layoutOf([activity('a', T(22), 60)], {
    timelineStart: '21:00', timelineEnd: '01:15'
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

test('overlapping activities are put in lanes, and nothing else is', () => {
  const { schedule } = layoutOf([
    activity('travel', T(11, 20), 265),
    activity('ceremony', T(14, 45), 60),
    activity('after', T(16), 30)
  ]);

  const { laneOf, totalLanesOf } = lanes(schedule.items);
  assert.equal(totalLanesOf.get('ceremony'), 2, 'ceremony and travel overlap, so both get a lane count');
  assert.equal(totalLanesOf.get('travel'), 2);
  assert.notEqual(laneOf.get('ceremony'), laneOf.get('travel'));
  assert.equal(totalLanesOf.get('after'), 1, 'an activity with no overlap gets a lane count of one — the full width');
});

test('three-way overlaps get three lanes, not two', () => {
  const { schedule } = layoutOf([
    activity('a', T(10), 60),
    activity('b', T(10, 15), 60),
    activity('c', T(10, 30), 60)
  ]);
  const { totalLanesOf } = lanes(schedule.items);
  assert.equal(totalLanesOf.get('a'), 3);
  assert.equal(totalLanesOf.get('b'), 3);
  assert.equal(totalLanesOf.get('c'), 3);
});

test('a lane style narrows the card and shifts it sideways', () => {
  assert.equal(laneStyle(0, 1), '');
  const style = laneStyle(1, 2);
  assert.match(style, /width:calc\(50%/);
  assert.match(style, /left:calc/);
});

test('the exact overlap window is reported, not the whole card', () => {
  const { schedule } = layoutOf([activity('travel', T(11, 20), 265), activity('ceremony', T(14, 45), 60)]);
  const travel = schedule.items.find(item => item.id === 'travel');
  const box_ = overlapBox(travel);
  assert.equal(box_.top, (T(14, 45) - travel.start) * PX_PER_MIN);
  assert.equal(box_.height, 60 * PX_PER_MIN, 'bounded by how long the other activity lasts');
});

test('open time is a box on its own times', () => {
  const { layout } = layoutOf([activity('a', T(11), 30), activity('fixed', T(13), 60)]);
  assert.equal(layout.openTimes.length, 1);
  const gap = layout.openTimes[0];
  assert.equal(gap.minutes, 90);
  assert.equal(gap.top, (T(11, 30) - layout.from) * PX_PER_MIN + CARD_INSET);
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
  const inView = layoutOf([activity('a', T(8), 600)], { sunset: '16:19' }).layout;
  assert.equal(inView.sunset.minutes, T(16, 19));
  assert.equal(inView.sunset.top, (T(16, 19) - inView.from) * PX_PER_MIN);

  const hidden = layoutOf([activity('a', T(8), 30)], { sunset: null }).layout;
  assert.equal(hidden.sunset, null, 'an empty setting hides the marker');

  const outside = layoutOf([activity('a', T(8), 30)], { sunset: '23:00' }).layout;
  assert.equal(outside.sunset, null);
});

test('the end marker sits at the end of the day', () => {
  const { schedule, layout } = layoutOf([activity('a', T(9), 45), activity('b', T(10), 30)]);
  assert.equal(layout.endTop, (schedule.dayEnd - layout.from) * PX_PER_MIN);
});

test('box() is the whole geometry contract', () => {
  const item = { start: T(12, 45), end: T(13, 15), duration: 30 };
  assert.deepEqual(box(item, T(11)), { top: 105 * PX_PER_MIN + CARD_INSET, height: 30 * PX_PER_MIN - CARD_INSET * 2 });
});

test('range is stable for an empty plan', () => {
  const p = plan([]);
  const result = range(p, buildSchedule(p));
  assert.equal(result.from, T(7, 30));
  assert.equal(result.to, T(8, 30));
});
