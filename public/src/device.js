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

function keyFor(planId) {
  return `${PREFIX}${planId || 'wedding-day'}`;
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

export function clearDeviceCopy(planId) {
  try {
    if (planId) localStorage.removeItem(keyFor(planId));
    else {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(PREFIX)) localStorage.removeItem(key);
      }
    }
  } catch {
    // Nothing to do: if it cannot be read it cannot be shown either.
  }
}
