import test from 'node:test';
import assert from 'node:assert/strict';

import '../../public/src/actions.js';
import { createStore, defineAction } from '../../public/src/state.js';

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
  status: 'Working',
  activities: activities.length ? activities : [activity('a', T(11, 30)), activity('b', T(12)), activity('c', T(12, 30))]
});

const store = (...activities) => createStore({ plan: plan(...activities), revision: 1 });

test('an action never mutates the plan it was given', () => {
  const s = store();
  const before = s.plan;
  s.dispatch('activity.stage', { id: 'a', stage: 'ceremony' });
  assert.equal(before.activities[0].stage, 'preparation', 'the previous plan is untouched');
  assert.equal(s.plan.activities[0].stage, 'ceremony');
  assert.notEqual(s.plan, before);
});

test('every change records one undo step with a readable label', () => {
  const s = store();
  assert.equal(s.canUndo, false);

  const result = s.dispatch('activity.remove', { id: 'b' });
  assert.equal(result.label, 'Deleted b');
  assert.equal(s.canUndo, true);
  assert.equal(s.undoLabel, 'Deleted b');
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'c']);

  s.undo();
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'b', 'c']);
});

test('the undo buffer holds one step, and undoing twice returns to where you were', () => {
  const s = store();
  s.dispatch('activity.remove', { id: 'a' });
  s.dispatch('activity.remove', { id: 'b' });
  assert.deepEqual(s.plan.activities.map(a => a.id), ['c']);

  s.undo();
  assert.deepEqual(s.plan.activities.map(a => a.id), ['b', 'c'], 'only the last change is undone');

  s.undo();
  assert.deepEqual(s.plan.activities.map(a => a.id), ['c'], 'undo is itself undoable');
});

test('an action that changes nothing records nothing', () => {
  const s = store();
  s.dispatch('activity.stage', { id: 'a', stage: 'ceremony' });
  const noop = s.dispatch('activity.stage', { id: 'a', stage: 'ceremony' });

  assert.equal(noop, null);
  assert.equal(s.undoLabel, 'Changed stage of a', 'the earlier step is still the one on offer');
});

test('moving a card to the start it already has is not a change', () => {
  const s = store();
  assert.equal(s.dispatch('activity.moveTo', { id: 'b', start: T(12) }), null);
  assert.equal(s.canUndo, false);
});

test('moving sets the start directly and reports which activity moved', () => {
  const s = store();
  const result = s.dispatch('activity.moveTo', { id: 'c', start: T(9) });
  assert.equal(s.plan.activities.find(a => a.id === 'c').start, T(9));
  assert.equal(result.label, 'Moved c');
});

test('moving a group shifts everyone in it, except a locked member', () => {
  const s = store(activity('a', T(10)), activity('b', T(11)), activity('anchor', T(12), { locked: true }));
  const result = s.dispatch('activity.moveGroup', { ids: ['a', 'b', 'anchor'], deltaMinutes: 15 });

  assert.equal(s.plan.activities.find(x => x.id === 'a').start, T(10, 15));
  assert.equal(s.plan.activities.find(x => x.id === 'b').start, T(11, 15));
  assert.equal(s.plan.activities.find(x => x.id === 'anchor').start, T(12), 'the locked one does not move');
  assert.equal(result.label, 'Moved 2 activities');
});

test('locking toggles in place and does not move the activity', () => {
  const s = store();
  s.dispatch('activity.toggleLock', { id: 'b' });
  assert.equal(s.plan.activities[1].locked, true);
  assert.equal(s.plan.activities[1].start, T(12), 'locking does not move it');

  s.dispatch('activity.toggleLock', { id: 'b' });
  assert.equal(s.plan.activities[1].locked, false);
});

test('durations are normalised by the action, not by the caller', () => {
  const s = store();
  s.dispatch('activity.duration', { id: 'a', duration: 42 });
  assert.equal(s.plan.activities[0].duration, 45);
  assert.equal(s.dispatch('activity.duration', { id: 'a', duration: 43 }), null, '43 also rounds to 45 — no change');
});

test('adding places the activity after the selected one, or at the end', () => {
  const s = store();
  s.dispatch('activity.add', { activity: activity('new', T(11, 45)), afterId: 'a' });
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'new', 'b', 'c']);

  s.dispatch('activity.add', { activity: activity('last', T(13)) });
  assert.deepEqual(s.plan.activities.map(a => a.id), ['a', 'new', 'b', 'c', 'last']);
});

test('UI state is separate from the plan and is never part of a change', () => {
  const s = store();
  s.setUi({ selectedId: 'b', openMenu: 'stage:b' });

  assert.equal(s.ui.selectedId, 'b');
  assert.equal(s.canUndo, false, 'selecting something is not an undoable change');
  assert.equal('selectedId' in s.plan, false);
  assert.equal(JSON.stringify(s.plan).includes('openMenu'), false);
});

test('a group selection lives in its own field, empty by default', () => {
  const s = store();
  assert.deepEqual(s.ui.groupSelection, []);
  s.setUi({ groupSelection: ['a', 'b'] });
  assert.deepEqual(s.ui.groupSelection, ['a', 'b']);
});

test('setUi reports whether anything actually changed', () => {
  const s = store();
  assert.equal(s.setUi({ selectedId: 'b' }), true);
  assert.equal(s.setUi({ selectedId: 'b' }), false, 'setting the same value repaints nothing');
});

test('subscribers are told which regions to repaint and whether data changed', () => {
  const s = store();
  const seen = [];
  s.subscribe(change => seen.push(change));

  s.setUi({ selectedId: 'a' }, { regions: ['timeline', 'toolbar'] });
  s.dispatch('activity.remove', { id: 'a' }, { regions: ['timeline', 'summary'] });

  assert.deepEqual(seen[0], { regions: ['timeline', 'toolbar'], data: false });
  assert.deepEqual(seen[1], { regions: ['timeline', 'summary'], data: true });
});

test('replacing the plan clears the undo buffer, because it belongs to the old plan', () => {
  const s = store();
  s.dispatch('activity.remove', { id: 'a' });
  assert.equal(s.canUndo, true);

  s.setPlan(plan(), { revision: 9 });
  assert.equal(s.canUndo, false);
  assert.equal(s.revision, 9);
});

test('an unknown action is a programming error, not a silent no-op', () => {
  const s = store();
  assert.throws(() => s.dispatch('activity.teleport', {}), /Unknown action/);
});

test('a custom action can still be registered directly', () => {
  defineAction('test.custom', p => ({ plan: p, label: 'Custom' }));
  const s = store();
  const result = s.dispatch('test.custom', {});
  assert.equal(result.label, 'Custom');
});
