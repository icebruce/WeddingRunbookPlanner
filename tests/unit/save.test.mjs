import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKOFF_MS, DEBOUNCE_MS, SAVE_STATES, createSavePipeline } from '../../public/src/save.js';

/** A controllable clock: nothing runs until the test advances time. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map();
  return {
    api: {
      setTimeout(fn, delay) {
        const id = nextId++;
        scheduled.set(id, { fn, at: now + delay });
        return id;
      },
      clearTimeout(id) {
        scheduled.delete(id);
      }
    },
    get now() { return now; },
    /** Runs everything due within `ms`, letting promises settle between steps. */
    async advance(ms) {
      const target = now + ms;
      let guard = 0;
      while (guard++ < 1000) {
        const due = [...scheduled.entries()].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [id, task] = due[0];
        scheduled.delete(id);
        now = Math.max(now, task.at);
        task.fn();
        await flushMicrotasks();
      }
      now = target;
      await flushMicrotasks();
    }
  };
}

function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

function apiError(status, extra = {}) {
  return Object.assign(new Error(extra.message || `HTTP ${status}`), { status, ...extra });
}

function harness({ save, plan = { title: 'Wedding Day' }, isOnline = () => true, ...options } = {}) {
  const timers = fakeTimers();
  const events = { states: [], errors: [], conflicts: [], unauthorized: 0, saved: [] };
  let currentPlan = plan;

  const pipeline = createSavePipeline({
    save,
    getPlan: () => currentPlan,
    revision: 1,
    deviceId: 'device-1',
    timers: timers.api,
    isOnline,
    onStateChange: state => events.states.push(state),
    onError: (message, meta) => events.errors.push({ message, ...meta }),
    onConflict: latest => events.conflicts.push(latest),
    onUnauthorized: () => { events.unauthorized += 1; },
    onSaved: result => events.saved.push(result),
    ...options
  });

  return {
    pipeline,
    timers,
    events,
    setPlan(next) { currentPlan = next; }
  };
}

test('a change is sent once, after the debounce', async () => {
  const sent = [];
  const { pipeline, timers } = harness({
    save: async (plan, revision, deviceId) => {
      sent.push({ plan, revision, deviceId });
      return { revision: revision + 1, updatedAt: 'now' };
    }
  });

  pipeline.markDirty();
  pipeline.markDirty();
  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS - 1);
  assert.equal(sent.length, 0, 'nothing is sent while the user is still typing');

  await timers.advance(2);
  assert.equal(sent.length, 1, 'three changes in one burst are one request');
  assert.equal(sent[0].revision, 1);
  assert.equal(sent[0].deviceId, 'device-1');
  assert.equal(pipeline.state, SAVE_STATES.saved);
  assert.equal(pipeline.revision, 2, 'the revision advances with the response');
});

test('only one request is in flight, and changes made during it are saved next', async () => {
  let inFlight = 0;
  let peak = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];

  const { pipeline, timers, setPlan } = harness({
    save: async plan => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      sent.push(plan.title);
      if (sent.length === 1) await gate;
      inFlight -= 1;
      return { revision: sent.length + 1 };
    }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(sent.length, 1);

  setPlan({ title: 'Changed mid-flight' });
  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(sent.length, 1, 'the second change waits for the first request');

  release();
  await timers.advance(1);
  assert.equal(peak, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[1], 'Changed mid-flight');
  assert.equal(pipeline.state, SAVE_STATES.saved);
});

test('the plan is read when the request is sent, never captured earlier', async () => {
  const sent = [];
  const { pipeline, timers, setPlan } = harness({
    save: async plan => { sent.push(plan.title); return { revision: 2 }; }
  });

  pipeline.markDirty();
  setPlan({ title: 'Typed after the change was registered' });
  await timers.advance(DEBOUNCE_MS);
  assert.equal(sent[0], 'Typed after the change was registered');
});

test('F1: repeated server errors back off instead of looping', async () => {
  let attempts = 0;
  const { pipeline, timers, events } = harness({
    save: async () => { attempts += 1; throw apiError(500); }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(attempts, 1);
  assert.equal(pipeline.state, SAVE_STATES.notSaved);

  await timers.advance(BACKOFF_MS[0]);
  assert.equal(attempts, 2);
  await timers.advance(BACKOFF_MS[1]);
  assert.equal(attempts, 3);
  await timers.advance(BACKOFF_MS[2]);
  assert.equal(attempts, 4);

  assert.equal(events.errors.length, 1, 'one toast for the whole episode, not one per attempt');
});

test('F1: ten seconds offline produces at most three requests and one message', async () => {
  let attempts = 0;
  const { pipeline, timers, events } = harness({
    isOnline: () => false,
    save: async () => { attempts += 1; throw apiError(0, { code: 'network' }); }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  await timers.advance(10_000);

  assert.ok(attempts <= 3, `expected at most 3 requests in 10 s, saw ${attempts}`);
  assert.equal(events.errors.length, 1);
  assert.equal(pipeline.state, SAVE_STATES.offline, 'the header says Offline, not Not saved');
});

test('the backoff stops growing at 30 seconds', async () => {
  let attempts = 0;
  const { pipeline, timers } = harness({
    save: async () => { attempts += 1; throw apiError(503); }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  for (const delay of BACKOFF_MS) await timers.advance(delay);
  const afterCeiling = attempts;

  await timers.advance(29_000);
  assert.equal(attempts, afterCeiling, 'no attempt before the 30 s ceiling elapses');
  await timers.advance(1_100);
  assert.equal(attempts, afterCeiling + 1);
});

test('a reconnection retries immediately rather than waiting out the backoff', async () => {
  let online = false;
  let attempts = 0;
  const { pipeline, timers } = harness({
    isOnline: () => online,
    save: async () => {
      attempts += 1;
      if (!online) throw apiError(0, { code: 'network' });
      return { revision: 2 };
    }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(attempts, 1);

  online = true;
  await pipeline.handleOnline();
  await flushMicrotasks();
  assert.equal(attempts, 2);
  assert.equal(pipeline.state, SAVE_STATES.saved);
});

test('F2: rejected data is not retried, and a later valid change saves', async () => {
  let attempts = 0;
  let reject = true;
  const { pipeline, timers, events } = harness({
    save: async () => {
      attempts += 1;
      if (reject) throw apiError(400, { code: 'required', message: "Name can't be empty." });
      return { revision: 2 };
    }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(attempts, 1);
  assert.equal(pipeline.state, SAVE_STATES.notSaved);
  assert.equal(events.errors[0].message, "Name can't be empty.");

  await timers.advance(60_000);
  assert.equal(attempts, 1, 'invalid data is never retried on a timer');

  reject = false;
  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(attempts, 2, 'the next change is tried again');
  assert.equal(pipeline.state, SAVE_STATES.saved);
  assert.equal(events.errors.length, 1);
});

test('a manual retry from the header re-sends a rejected save', async () => {
  let attempts = 0;
  const { pipeline, timers } = harness({
    save: async () => { attempts += 1; if (attempts === 1) throw apiError(422); return { revision: 2 }; }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(attempts, 1);

  await pipeline.retry();
  await flushMicrotasks();
  assert.equal(attempts, 2);
  assert.equal(pipeline.state, SAVE_STATES.saved);
});

test('F10: a 401 keeps the plan and the pending change', async () => {
  let attempts = 0;
  let authorised = false;
  const { pipeline, timers, events } = harness({
    save: async () => {
      attempts += 1;
      if (!authorised) throw apiError(401);
      return { revision: 5 };
    }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(events.unauthorized, 1);
  assert.equal(pipeline.hasPendingChanges, true, 'the change is still pending, not discarded');
  assert.equal(events.errors.length, 0, 'signing in again is not an error toast');

  await timers.advance(60_000);
  assert.equal(attempts, 1, 'no retry loop against a sign-in wall');

  authorised = true;
  await pipeline.resume({ revision: 4 });
  await flushMicrotasks();
  assert.equal(attempts, 2);
  assert.equal(pipeline.hasPendingChanges, false);
  assert.equal(pipeline.state, SAVE_STATES.saved);
});

test('F12: a 409 reports the other version and stops until it is resolved', async () => {
  let attempts = 0;
  const latest = { plan: { title: 'From the other device' }, revision: 9 };
  const { pipeline, timers, events } = harness({
    save: async () => { attempts += 1; throw apiError(409, { body: { latest } }); }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.equal(events.conflicts.length, 1);
  assert.equal(events.conflicts[0].revision, 9);

  await timers.advance(60_000);
  assert.equal(attempts, 1, 'a conflict is a question for the user, not something to retry');
});

test('a collision with this tab\'s own page-hide send is adopted, not put to the user', async () => {
  // The page-hide flush hands the browser a save and never reads the answer,
  // so the server ends up a revision ahead carrying this tab's own writing.
  // The tab then collides with itself, and asking "which copy do you want?"
  // about your own change offers to throw it away.
  const sent = [];
  let collided = false;
  const { pipeline, timers, events } = harness({
    save: async (plan, revision) => {
      sent.push(revision);
      if (!collided) {
        collided = true;
        throw apiError(409, {
          body: { latest: { plan: { title: 'Wedding Day' }, revision: 2, updatedBy: 'device-1', updatedAt: 'then' } }
        });
      }
      return { revision: revision + 1 };
    }
  });

  pipeline.markDirty();
  pipeline.flushOnHide(() => {});
  await pipeline.flushNow();
  await timers.advance(0);

  assert.deepEqual(events.conflicts, [], 'the user is not asked about their own change');
  assert.deepEqual(sent, [1, 2], 'it carries on from the revision the server reported');
  assert.equal(pipeline.revision, 3);
  assert.equal(pipeline.isBlocked, null);
});

test('a second tab on the same device is still a second copy', async () => {
  // Two tabs of one browser share a device id and their edits really can
  // diverge, so the device alone cannot be the test — only a collision with
  // the revision this tab's own blind send would have produced.
  const { pipeline, timers, events } = harness({
    save: async () => {
      throw apiError(409, {
        body: { latest: { plan: { title: 'From the other tab' }, revision: 9, updatedBy: 'device-1' } }
      });
    }
  });

  pipeline.markDirty();
  pipeline.flushOnHide(() => {});
  await pipeline.flushNow();
  await timers.advance(0);

  assert.equal(events.conflicts.length, 1, 'revision 9 is not the 2 our blind send would have made');
  assert.equal(pipeline.isBlocked, 'conflict');
});

test('a conflict from another device is still the user\'s to answer', async () => {
  const { pipeline, timers, events } = harness({
    save: async () => {
      throw apiError(409, {
        body: { latest: { plan: { title: 'Theirs' }, revision: 7, updatedBy: 'device-2' } }
      });
    }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  await timers.advance(0);

  assert.equal(events.conflicts.length, 1);
  assert.equal(pipeline.isBlocked, 'conflict');
});

test('the collision is adopted once, not forever', async () => {
  // Adopting on every 409 would hide a real problem behind a silent loop.
  let attempts = 0;
  const { pipeline, timers, events } = harness({
    save: async (plan, revision) => {
      attempts += 1;
      throw apiError(409, {
        body: { latest: { plan: {}, revision: Number(revision) + 1, updatedBy: 'device-1' } }
      });
    }
  });

  pipeline.markDirty();
  pipeline.flushOnHide(() => {});
  await pipeline.flushNow();
  await timers.advance(0);

  assert.equal(events.conflicts.length, 1, 'the second collision is handed over');
  assert.equal(attempts, 2, 'one adoption, then it asks');
  assert.equal(pipeline.isBlocked, 'conflict');
});

test('the page-hide flush disarms the debounce it is standing in for', async () => {
  const sent = [];
  const { pipeline, timers } = harness({
    save: async (plan, revision) => { sent.push(revision); return { revision: revision + 1 }; }
  });

  const blind = [];
  pipeline.markDirty();
  const handed = pipeline.flushOnHide((plan, revision) => blind.push(revision));
  assert.equal(handed, true);
  assert.deepEqual(blind, [1], 'the change went out with the page');

  // The armed debounce must not fire behind it and send the same plan again at
  // a revision the blind send has already spent.
  await timers.advance(60_000);
  assert.deepEqual(sent, [], 'nothing followed it out');
});

test('F13: resuming at the revision the server reported clears the conflict', async () => {
  const sent = [];
  let conflictOnce = true;
  const { pipeline, timers } = harness({
    save: async (plan, revision) => {
      sent.push(revision);
      if (conflictOnce) {
        conflictOnce = false;
        throw apiError(409, { body: { latest: { revision: 9 } } });
      }
      return { revision: 10 };
    }
  });

  pipeline.markDirty();
  await timers.advance(DEBOUNCE_MS);
  assert.deepEqual(sent, [1]);

  await pipeline.resume({ revision: 9 });
  await flushMicrotasks();
  assert.deepEqual(sent, [1, 9], 'the retry carries the revision the server reported');
  assert.equal(pipeline.state, SAVE_STATES.saved);
});

test('markClean after a load or restore leaves nothing pending', async () => {
  let attempts = 0;
  const { pipeline, timers } = harness({ save: async () => { attempts += 1; return { revision: 3 }; } });

  pipeline.markDirty();
  pipeline.markClean(12);
  await timers.advance(60_000);

  assert.equal(attempts, 0);
  assert.equal(pipeline.revision, 12);
  assert.equal(pipeline.hasPendingChanges, false);
  assert.equal(pipeline.state, SAVE_STATES.saved);
});

test('state moves Saving -> Saved and never reports Saved while work is pending', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { pipeline, timers, events } = harness({
    save: async () => { await gate; return { revision: 2 }; }
  });

  pipeline.markDirty();
  assert.equal(pipeline.state, SAVE_STATES.saving, 'the header reacts before the request goes out');
  await timers.advance(DEBOUNCE_MS);
  assert.equal(pipeline.state, SAVE_STATES.saving);

  release();
  await timers.advance(1);
  assert.deepEqual(events.states, [SAVE_STATES.saving, SAVE_STATES.saved]);
});

test('destroy cancels pending work', async () => {
  let attempts = 0;
  const { pipeline, timers } = harness({ save: async () => { attempts += 1; return { revision: 2 }; } });

  pipeline.markDirty();
  pipeline.destroy();
  await timers.advance(60_000);
  assert.equal(attempts, 0);
});
