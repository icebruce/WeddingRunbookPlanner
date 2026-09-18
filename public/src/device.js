/**
 * The copy of the plan kept on this device (D20).
 *
 * It exists so that two things are true: the plan can be read without a
 * signal, and an edit survives the app being closed. It is written after every
 * local change and after every successful load, and it is cleared only on an
 * explicit sign-out — not when a session expires, because the edits someone
 * made before being signed out are exactly the ones worth keeping.
 *
 * Every access is guarded: in a private window, or with site data blocked,
 * reading and writing both throw, and the app has to work anyway.
 */
const PREFIX = 'wrp:v1:';
const BASE_PREFIX = 'wrp:v1:base:';

function keyFor(planId) {
  return `${PREFIX}${planId || 'wedding-day'}`;
}

function baseKeyFor(planId) {
  return `${BASE_PREFIX}${planId || 'wedding-day'}`;
}

export function readDeviceCopy(planId) {
  try {
    const raw = localStorage.getItem(keyFor(planId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.plan ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDeviceCopy(plan, { revision, dirty }) {
  if (!plan) return;
  try {
    localStorage.setItem(keyFor(plan.id), JSON.stringify({
      plan,
      revision,
      dirty: Boolean(dirty),
      savedAt: new Date().toISOString()
    }));
  } catch {
    // Storage full or blocked. The plan is still on screen and still saving;
    // only the offline fallback is lost.
  }
}

/**
 * The plan as the server last confirmed it, kept beside the copy above.
 *
 * Its only job is to survive the app being closed. Unsaved edits already do;
 * without the version they were made against, reopening to find the plan moved
 * on leaves nothing to merge them into, and the only question left is the
 * wholesale one this all exists to stop asking. It changes only when the
 * server tells us something new, so it is written far less often than the copy
 * and never on the path of a keystroke.
 */
export function readDeviceBase(planId) {
  try {
    const raw = localStorage.getItem(baseKeyFor(planId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.plan ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDeviceBase(plan, revision) {
  if (!plan) return;
  try {
    localStorage.setItem(baseKeyFor(plan.id), JSON.stringify({ plan, revision }));
  } catch {
    // Only the merge ancestor is lost; a conflict then asks the wholesale
    // question instead of merging, which is worse but still never silent.
  }
}

export function clearDeviceCopy(planId) {
  try {
    if (planId) {
      localStorage.removeItem(keyFor(planId));
      localStorage.removeItem(baseKeyFor(planId));
    } else {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(PREFIX)) localStorage.removeItem(key);
      }
    }
  } catch {
    // Nothing to do: if it cannot be read it cannot be shown either.
  }
}
