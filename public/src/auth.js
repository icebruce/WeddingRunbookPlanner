/**
 * Sign-in and sign-out.
 *
 * Split out of app.js: once the store, save pipeline and a couple of
 * callbacks are handed in, session lifecycle is a self-contained concern.
 */
import { api } from './api.js';
import { clearDeviceCopy } from './device.js';
import { clearOverride } from './dayof.js';

export function createAuth({ store, saver, flushSave, loadPlan }) {
  async function handleLogin(event, form) {
    event.preventDefault();
    const errorNode = form.querySelector('#login-error');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    errorNode.hidden = true;

    try {
      await api.login(new FormData(form).get('password'));

      // Signing in again mid-edit must not cost the edit: the plan on screen is
      // kept and only the revision is refreshed, so the save can be retried
      // (or turn into a conflict). Loading here would overwrite the work (F10).
      if (store.plan && saver.hasPendingChanges) {
        store.setUi({ authenticated: true });
        const current = await api.load().catch(() => null);
        await saver.resume({ revision: current?.revision ?? store.revision });
        return;
      }

      store.setUi({ authenticated: true });
      await loadPlan();
    } catch (error) {
      errorNode.textContent = error.message || 'Unable to sign in.';
      errorNode.hidden = false;
      button.disabled = false;
    }
  }

  async function signOut() {
    try { await flushSave(); } catch { /* the sign-out still happens; the copy stays on the device */ }
    await api.logout().catch(() => {});
    // Signing out is the one time this device is cleared: it is the only moment
    // someone has said they are finished with it. The day-of override goes too —
    // it is a decision about one date on one device, and the next person to sign
    // in on it should get the plan's own answer.
    clearDeviceCopy(store.plan?.id);
    clearOverride();
    saver.markClean(null);
    store.resetUi();
    store.setPlan(null, { revision: null });
    store.setUi({ authenticated: false });
  }

  return { handleLogin, signOut };
}
