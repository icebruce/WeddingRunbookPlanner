/**
 * The autosave pipeline.
 *
 * The old implementation called itself again after every failure, with no
 * delay and no ceiling: three seconds offline produced 881 requests and 882
 * toasts (F1). This one has a single rule for what happens after each outcome,
 * and every path either stops or waits.
 *
 *   change -> debounce 650 ms -> flush
 *   200         revision advances; flush again if more changes arrived
 *   409         hand the caller the other version; stop until it is resolved
 *   401         keep the plan and the pending changes; stop until sign-in
 *   4xx         "Not saved" with a reason; stop until the next change or a tap
 *   5xx/offline "Offline" or "Not saved"; retry after 2, 4, 8, 16, then 30 s
 *
 * Only one request is ever in flight, and the plan is read at the moment of
 * sending rather than captured earlier, so a save never writes a stale copy
 * and "Keep my changes" after a conflict means the plan as it is now (F12).
 */

export const SAVE_STATES = {
  saved: 'saved',
  saving: 'saving',
  offline: 'offline',
  notSaved: 'not-saved'
};

export const DEBOUNCE_MS = 650;
export const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

const HARD_FAILURE_CODES = new Set([400, 403, 404, 413, 422]);

export function createSavePipeline({
  save,
  getPlan,
  deviceId = null,
  revision = null,
  debounceMs = DEBOUNCE_MS,
  backoff = BACKOFF_MS,
  timers = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  onStateChange = () => {},
  onError = () => {},
  onConflict = () => {},
  onUnauthorized = () => {},
  onSaved = () => {}
}) {
  let dirtySeq = 0;
  let savedSeq = 0;
  let sentSeq = 0;
  let currentRevision = revision;
  let state = SAVE_STATES.saved;

  let inFlight = null;
  let debounceTimer = null;
  let retryTimer = null;
  let attempt = 0;
  // One toast per failure episode, not one per attempt.
  let episodeReported = false;
  // Set after an outcome that retrying cannot fix on its own.
  let blocked = null;
  // The page-hide flush sends a save whose answer is never read, so the server
  // can end up one revision ahead of this tab carrying this tab's own writing.
  // This remembers the revision such a send was made at, so that the collision
  // it causes can be told apart from a real one: the same device in a second
  // tab is still a second copy of the plan, and its work is not ours to drop.
  let blindSentAt = null;
  let destroyed = false;

  function setState(next) {
    if (state === next) return;
    state = next;
    onStateChange(state);
  }

  function clearTimers() {
    if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    debounceTimer = null;
    retryTimer = null;
  }

  function pendingState() {
    return isOnline() ? SAVE_STATES.saving : SAVE_STATES.offline;
  }

  function schedule(delay) {
    if (destroyed) return;
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      void flush();
    }, delay);
  }

  function reportOnce(message, code) {
    if (episodeReported) return;
    episodeReported = true;
    onError(message, { code });
  }

  async function flush() {
    if (destroyed) return;
    if (debounceTimer !== null) {
      timers.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    // A second flush while one is in flight is not dropped: the running save
    // re-checks the sequence when it finishes.
    if (inFlight) return inFlight;
    if (blocked) return;
    if (dirtySeq <= savedSeq) {
      setState(SAVE_STATES.saved);
      return;
    }

    sentSeq = dirtySeq;
    setState(pendingState());

    // Held rather than re-read: what the server confirms is what was sent,
    // and the caller keeps it as the base a later three-way merge measures
    // both sides against. A plan is replaced, never mutated in place, so this
    // reference still describes exactly what went over the wire.
    const sending = getPlan();

    inFlight = (async () => {
      try {
        const result = await save(sending, currentRevision, deviceId);
        currentRevision = result?.revision ?? currentRevision;
        savedSeq = Math.max(savedSeq, sentSeq);
        attempt = 0;
        episodeReported = false;
        blindSentAt = null;
        onSaved({ revision: currentRevision, updatedAt: result?.updatedAt ?? null, plan: sending });
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    })();

    const outcome = await inFlight;
    inFlight = null;
    if (destroyed) return;

    if (outcome.ok) {
      if (dirtySeq > savedSeq) return flush();
      setState(SAVE_STATES.saved);
      return;
    }

    handleFailure(outcome.error);
  }

  function handleFailure(error) {
    const status = error?.status ?? 0;

    if (status === 401) {
      // The plan and every pending change stay exactly where they are; the
      // caller shows sign-in and calls resume() afterwards.
      blocked = 'unauthorized';
      setState(SAVE_STATES.notSaved);
      onUnauthorized();
      return;
    }

    if (status === 409) {
      const latest = error?.body?.latest ?? null;
      // A collision with this tab's own page-hide send is not a conflict: the
      // server is holding exactly what we handed it on the way out, one
      // revision on from where we sent it. Asking which copy to keep would be
      // asking about a change that was never in doubt, and one of the answers
      // throws the person's own work away.
      //
      // The test is the revision, not just the device — two tabs of one
      // browser share a device id, and their edits really can diverge.
      const ourBlindWrite = blindSentAt !== null
        && latest
        && deviceId
        && latest.updatedBy === deviceId
        && Number(latest.revision) === Number(blindSentAt) + 1;
      if (ourBlindWrite) {
        blindSentAt = null;
        currentRevision = latest.revision;
        onSaved({ revision: currentRevision, updatedAt: latest.updatedAt ?? null, plan: latest.plan ?? null });
        void flush();
        return;
      }
      blocked = 'conflict';
      setState(SAVE_STATES.notSaved);
      onConflict(latest);
      return;
    }

    if (HARD_FAILURE_CODES.has(status)) {
      // Retrying identical invalid data would loop forever (F1/F2). Wait for
      // the next change or an explicit retry.
      blocked = 'rejected';
      setState(SAVE_STATES.notSaved);
      reportOnce(error?.message || 'That change could not be saved.', error?.code || 'rejected');
      return;
    }

    setState(isOnline() ? SAVE_STATES.notSaved : SAVE_STATES.offline);
    reportOnce(
      isOnline()
        ? 'Could not save. Your changes are still on this screen.'
        : "You're offline. Changes stay on this device and save when you reconnect.",
      error?.code || 'network'
    );
    schedule(backoff[Math.min(attempt, backoff.length - 1)]);
    attempt += 1;
  }

  return {
    get state() { return state; },
    /** True while a request is in the air, for the page-hide flush. */
    get inFlight() { return Boolean(inFlight); },
    get revision() { return currentRevision; },
    get hasPendingChanges() { return dirtySeq > savedSeq; },
    get isBlocked() { return blocked; },

    /** Call after every local change to the plan. */
    markDirty() {
      if (destroyed) return;
      dirtySeq += 1;
      // A fresh change supersedes whatever was rejected, so try again.
      if (blocked === 'rejected') {
        blocked = null;
        attempt = 0;
      }
      if (blocked) return;
      setState(pendingState());
      if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
      debounceTimer = timers.setTimeout(() => {
        debounceTimer = null;
        void flush();
      }, debounceMs);
    },

    /** Send now, skipping the debounce (sign-out, version save, page hide). */
    flushNow() {
      return flush();
    },

    /**
     * The page is going away. There is no time for a round trip, so the
     * request is handed to the browser with `keepalive` and the answer is
     * never read; whatever happens, the device copy still holds the change and
     * it is sent again on the next open.
     */
    flushOnHide(send) {
      if (!this.hasPendingChanges || blocked) return false;
      // The debounce is disarmed: it would fire on the way out and send the
      // same plan a second time at the revision this one is about to advance.
      if (debounceTimer !== null) {
        timers.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      try {
        send(getPlan(), currentRevision, deviceId);
        blindSentAt = currentRevision;
        return true;
      } catch {
        return false;
      }
    },

    /** The header's "Not saved" is tappable; this is what it does. */
    retry() {
      if (destroyed) return;
      blocked = null;
      attempt = 0;
      episodeReported = false;
      return flush();
    },

    /** Wired to the browser's `online` event. */
    handleOnline() {
      if (destroyed || blocked) return;
      if (!this.hasPendingChanges) return;
      attempt = 0;
      return flush();
    },

    /** After a successful sign-in, or after a conflict has been resolved. */
    resume({ revision: nextRevision } = {}) {
      if (nextRevision !== undefined && nextRevision !== null) currentRevision = nextRevision;
      blocked = null;
      attempt = 0;
      episodeReported = false;
      return flush();
    },

    setRevision(next) {
      currentRevision = next;
    },

    /** Mark everything as saved — used after a load or a version restore. */
    markClean(next) {
      if (next !== undefined && next !== null) currentRevision = next;
      savedSeq = dirtySeq;
      attempt = 0;
      episodeReported = false;
      blocked = null;
      clearTimers();
      setState(SAVE_STATES.saved);
    },

    destroy() {
      destroyed = true;
      clearTimers();
    }
  };
}
