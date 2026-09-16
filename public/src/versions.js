/**
 * Version history: save, restore, delete.
 *
 * Split out of app.js. The sheet's own lifecycle (opening, closing, focus)
 * stays with the rest of the dialog wiring there; this module only does the
 * network calls and the plan-state changes that come out of them.
 */
import { api } from './api.js';
import { writeDeviceCopy } from './device.js';

export function createVersions({ store, saver, toast, flushSave, syncSheet, rememberOpener, resetDialogKey, clock }) {
  /**
   * Validation runs through the module the server uses, so the message shown
   * here is the reason the server would have given — and the sheet stays open
   * with the offending field focused instead of the change being applied and
   * then refused.
   */
  function showFieldError(form, field, message) {
    const name = String(field || '').split('.').pop();
    const control = form.querySelector(`[name="${name}"]`);
    const note = document.createElement('p');
    note.className = 'field-error';
    note.id = `error-${name}`;
    note.setAttribute('role', 'alert');
    note.textContent = message;

    if (!control) {
      form.querySelector('.sheet-body')?.prepend(note);
      return;
    }
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', note.id);
    (control.closest('.field') || control.parentElement).append(note);
    control.focus();
  }

  async function createVersion(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    form.querySelectorAll('.field-error').forEach(node => node.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach(node => {
      node.removeAttribute('aria-invalid');
      node.removeAttribute('aria-describedby');
    });
    button.disabled = true;
    try {
      // A version is a copy of what is stored, so what is on screen has to be
      // stored first.
      await flushSave();
      const result = await api.createVersion(new FormData(form).get('name'));
      // The sheet stays open; its identity changes with the list, so it repaints.
      store.setUi({ versions: result.versions }, { regions: [] });
      syncSheet();
    } catch (error) {
      if (error.field) showFieldError(form, error.field, error.message);
      else toast(error.message || 'Could not save that version.', { tone: 'error' });
      button.disabled = false;
    }
  }

  /**
   * Deleting a version is undoable like everything else — the copy is kept in
   * memory for as long as the toast is on screen and written back if asked.
   */
  async function removeVersion(id) {
    const version = store.ui.versions.find(item => item.id === id);
    if (!version) return;

    try {
      // The body is fetched before the delete, so Undo can put back the plan
      // that was in it rather than whatever is on screen now. The list itself
      // never carries plan bodies.
      const { version: full } = await api.version(id);
      const result = await api.deleteVersion(id);
      store.setUi({ versions: result.versions }, { regions: [] });
      syncSheet();

      toast(`Deleted ${version.name}`, {
        action: {
          label: 'Undo',
          run: async () => {
            try {
              const restored = await api.createVersion(full.name, { auto: full.auto, plan: full.plan });
              store.setUi({ versions: restored.versions }, { regions: [] });
              syncSheet();
            } catch {
              toast('That version could not be put back.', { tone: 'error' });
            }
          }
        }
      });
    } catch (error) {
      toast(error.message || 'Could not delete that version.', { tone: 'error' });
    }
  }

  async function restoreVersion(id) {
    const version = store.ui.versions.find(item => item.id === id);
    if (!version) return;
    try {
      // The server keeps a copy of what is being replaced before it replaces it,
      // so this needs no confirmation of its own.
      const result = await api.restoreVersion(id, store.revision);
      saver.markClean(result.revision);
      store.setUi({ versions: result.versions, dialog: null }, { regions: [] });
      resetDialogKey();
      store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
      writeDeviceCopy(result.plan, { revision: result.revision, dirty: false });
      clock.tick();
      toast(`Restored ${version.name}`);
    } catch (error) {
      toast(error.message || 'Could not restore that version.', { tone: 'error' });
    }
  }

  async function openVersions() {
    rememberOpener('menu-app');
    try {
      await flushSave();
      const result = await api.versions();
      store.setRevision(result.revision, result.updatedAt);
      store.setUi({
        versions: result.versions,
        openMenu: null,
        dialog: { type: 'versions', updatedAt: result.updatedAt }
      });
    } catch (error) {
      toast(error.message || 'Could not open version history.', { tone: 'error' });
    }
  }

  return { createVersion, removeVersion, restoreVersion, openVersions };
}
