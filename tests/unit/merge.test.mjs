import test from 'node:test';
import assert from 'node:assert/strict';

import { describeConflicts, isEqual, mergePlans } from '../../public/src/merge.js';

const T = (h, m = 0) => h * 60 + m;

const activity = (id, start, extra = {}) => ({
  id,
  title: id,
  start,
  duration: 30,
  stage: 'preparation',
  location: '',
  people: [],
  notes: '',
  locked: false,
  ...extra
});

const plan = (...activities) => ({
  id: 'wedding-day',
  title: 'Wedding Day',
  coupleLabel: 'Our Wedding',
  date: '2026-11-21',
  activities
});

const base = () => plan(
  activity('ceremony', T(14, 45), { title: 'Ceremony' }),
  activity('dinner', T(18, 15), { title: 'Dinner' }),
  activity('party', T(20, 30), { title: 'Party' })
);

const edit = (source, id, changes) => ({
  ...source,
  activities: source.activities.map(item => (item.id === id ? { ...item, ...changes } : item))
});

const find = (result, id) => result.plan.activities.find(item => item.id === id);

test('the case this exists for: each side edits a different activity', () => {
  const mine = edit(base(), 'ceremony', { start: T(15) });
  const theirs = edit(base(), 'dinner', { title: 'Dinner service' });

  const result = mergePlans(base(), mine, theirs);

  assert.deepEqual(result.conflicts, []);
  assert.equal(find(result, 'ceremony').start, T(15));
  assert.equal(find(result, 'dinner').title, 'Dinner service');
  assert.equal(result.plan.activities.length, 3);
});

test('different fields of the same activity merge without a question', () => {
  const mine = edit(base(), 'dinner', { title: 'Dinner service' });
  const theirs = edit(base(), 'dinner', { location: 'Le Richmond' });

  const result = mergePlans(base(), mine, theirs);

  assert.deepEqual(result.conflicts, []);
  assert.equal(find(result, 'dinner').title, 'Dinner service');
  assert.equal(find(result, 'dinner').location, 'Le Richmond');
});

test('the same field changed twice is a conflict, named by activity and field', () => {
  const mine = edit(base(), 'ceremony', { start: T(15) });
  const theirs = edit(base(), 'ceremony', { start: T(15, 30) });

  const result = mergePlans(base(), mine, theirs);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, 'activity');
  assert.equal(result.conflicts[0].title, 'Ceremony');
  assert.deepEqual(result.conflicts[0].fields, ['start']);
});

test('prefer decides a real conflict, and only a real one', () => {
  const mine = edit(base(), 'ceremony', { start: T(15) });
  const theirs = edit(edit(base(), 'ceremony', { start: T(15, 30) }), 'party', { title: 'Dancing' });

  assert.equal(mergePlans(base(), mine, theirs, { prefer: 'mine' }).plan.activities[0].start, T(15));

  const preferTheirs = mergePlans(base(), mine, theirs, { prefer: 'theirs' });
  assert.equal(preferTheirs.plan.activities[0].start, T(15, 30));
  // The undisputed edit lands whichever side is preferred.
  assert.equal(find(preferTheirs, 'party').title, 'Dancing');
});

test('the same edit made on both devices is not a conflict', () => {
  const mine = edit(base(), 'party', { title: 'Dancing' });
  const theirs = edit(base(), 'party', { title: 'Dancing' });

  const result = mergePlans(base(), mine, theirs);

  assert.deepEqual(result.conflicts, []);
  assert.equal(find(result, 'party').title, 'Dancing');
});

test('an activity added on one side survives the other side saving first', () => {
  const mine = plan(...base().activities, activity('speeches', T(19, 30), { title: 'Speeches' }));
  const theirs = edit(base(), 'party', { start: T(21) });

  const result = mergePlans(base(), mine, theirs);

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.plan.activities.length, 4);
  assert.equal(find(result, 'speeches').title, 'Speeches');
  assert.equal(find(result, 'party').start, T(21));
});

test('activities added on both sides both survive', () => {
  const mine = plan(...base().activities, activity('speeches', T(19, 30)));
  const theirs = plan(...base().activities, activity('cake', T(19)));

  const result = mergePlans(base(), mine, theirs);

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.plan.activities.length, 5);
});

test('a delete the other side did not touch simply happens', () => {
  const mine = plan(...base().activities.filter(item => item.id !== 'party'));
  const theirs = edit(base(), 'dinner', { title: 'Dinner service' });

  const result = mergePlans(base(), mine, theirs);

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.plan.activities.length, 2);
  assert.equal(find(result, 'party'), undefined);
});

test('deleting what the other side was editing keeps the work and asks', () => {
  const mine = plan(...base().activities.filter(item => item.id !== 'party'));
  const theirs = edit(base(), 'party', { title: 'Dancing until late' });

  const result = mergePlans(base(), mine, theirs);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, 'deleted-here');
  assert.equal(result.conflicts[0].title, 'Dancing until late');
  assert.equal(find(result, 'party').title, 'Dancing until late');
});

test('the other side deleting what I was editing keeps my work and asks', () => {
  const mine = edit(base(), 'party', { title: 'Dancing until late' });
  const theirs = plan(...base().activities.filter(item => item.id !== 'party'));

  const result = mergePlans(base(), mine, theirs);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, 'deleted-there');
  assert.equal(find(result, 'party').title, 'Dancing until late');
});

test('both deleting the same activity is agreement, not a conflict', () => {
  const without = plan(...base().activities.filter(item => item.id !== 'party'));

  const result = mergePlans(base(), without, without);

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.plan.activities.length, 2);
});

test('plan-level settings merge the same way', () => {
  const mine = { ...base(), sunset: '16:19' };
  const theirs = { ...base(), title: 'Our Wedding Day' };

  const result = mergePlans(base(), mine, theirs);

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.plan.sunset, '16:19');
  assert.equal(result.plan.title, 'Our Wedding Day');
});

test('a field neither side has seen before merges the day it is added', () => {
  // The schema keeps moving; the merge must not need telling.
  const mine = { ...base(), timezone: 'America/Toronto' };
  const result = mergePlans(base(), mine, base());

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.plan.timezone, 'America/Toronto');
});

test('a field dropped from the schema does not come back', () => {
  const withStatus = { ...base(), status: 'Working' };
  const mine = base();

  const result = mergePlans(withStatus, mine, withStatus);

  assert.equal(Object.hasOwn(result.plan, 'status'), false);
});

test('no changes on either side is the identity', () => {
  const result = mergePlans(base(), base(), base());
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.plan, base());
});

test('isEqual is structural', () => {
  assert.equal(isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(isEqual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(isEqual([1, 2], [2, 1]), false);
  assert.equal(isEqual(null, {}), false);
});

test('conflicts are described in a sentence', () => {
  assert.equal(describeConflicts([]), '');
  assert.equal(describeConflicts([{ title: 'Ceremony' }]), 'Ceremony');
  assert.equal(describeConflicts([{ title: 'Ceremony' }, { title: 'Dinner' }]), 'Ceremony and Dinner');
  assert.equal(
    describeConflicts([{ title: 'Ceremony' }, { title: 'Dinner' }, { title: 'Party' }]),
    'Ceremony, Dinner and Party'
  );
  // One activity with two fields in dispute is still one name.
  assert.equal(describeConflicts([{ title: 'Ceremony' }, { title: 'Ceremony' }]), 'Ceremony');
});
