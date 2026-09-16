/**
 * Boot, screen routing and event wiring.
 *
 * Rendering is split into regions that repaint on their own. The old build
 * rewrote the whole of #app on every change, which lost focus to <body>,
 * re-created open dialogs, and — because #app carried aria-live — re-announced
 * the entire screen to a screen reader every time anything happened (F14).
 *
 * Events are delegated from the document, so a repainted region does not need
 * to be re-bound: a control says what it does with `data-action`.
 */
import './actions.js';
import { api } from './api.js';
import { STAGES, deviceId } from './config.js';
import { clearDeviceCopy, readDeviceCopy, writeDeviceCopy } from './device.js';
import { cssEscape, escapeHtml, focusByKey, paint, uid } from './dom.js';
import { AUTO_VIEW_ONLY_MS, cardStateAt, createClock, minutesNow, readOverride, shouldBeOn, stripState, writeOverride } from './dayof.js';
import { createGestures } from './gestures.js';
import { icon } from './icons.js';
import { SAVE_STATES, createSavePipeline } from './save.js';
import { createStore } from './state.js';
import { renderHeader } from './render/header.js';
import { discardSheet, peopleChips, renderSheet } from './render/sheets.js';
import { buildSchedule, formatTime } from './schedule.js';
import { renderStrip } from './render/strip.js';
import { renderHeading, renderSummary, renderTimeline } from './render/timeline.js';
import { fitCards, hiddenDetails, watchFit } from './render/fit.js';
import { createToaster, shiftMessage } from './render/toast.js';
import { renderToolbar } from './render/toolbar.js';
import { checkPlan, normalizeDuration, roundTimeUp, validateActivity } from './validate.js';

const app = document.querySelector('#app');
const sheetRoot = document.querySelector('#sheet-root');
const alertRoot = document.querySelector('#alert-root');
const toast = createToaster(
  document.querySelector('#toast-region'),
  // A sheet is drawn in the top layer, so a toast raised while one is open has
  // to be drawn inside it or it cannot be pressed.
  () => alertRoot.querySelector('dialog[open]') || sheetRoot.querySelector('dialog[open]')
);

const store = createStore();
const DEVICE_ID = deviceId();

const saver = createSavePipeline({
  save: (plan, revision, device) => api.save(plan, revision, device),
  getPlan: () => store.plan,
  deviceId: DEVICE_ID,
  // The offline bar reads the same state as the header, so both repaint.
  onStateChange: next => store.setUi({ saveState: next }, { regions: ['header', 'offline'] }),
  onSaved: ({ revision, updatedAt }) => {
    store.setRevision(revision, updatedAt);
    writeDeviceCopy(store.plan, { revision, dirty: false });
  },
  onError: message => toast(message, { tone: 'error' }),
  // The local side of a conflict is read when the user chooses, not captured
  // here, so "Keep my changes" means the plan as it is now (F12).
  onConflict: latest => store.setUi({ conflict: { latest }, dialog: { type: 'conflict', latest } }),
  onUnauthorized: () => store.setUi({ authenticated: false })
});

/**
 * The offline bar. It is not an error: the plan is on screen, the edits are on
 * the device, and they will go when there is a connection. Saying so is the
 * difference between "wait" and "your work is gone".
 */
function renderOfflineBar({ ui }) {
  if (ui.saveState !== SAVE_STATES.offline && !ui.readOnlyCopy) return '';
  const message = ui.readOnlyCopy
    ? "You're offline. This is the last plan saved on this device."
    : "You're offline. Changes stay on this device and save when you reconnect.";
  return `<div class="pinned-bar pinned-bar--offline" role="status">${escapeHtml(message)}</div>`;
}

// ---------------------------------------------------------------- screens

const SHELL = `
  <header class="topbar" data-region="header"></header>
  <div data-region="offline"></div>
  <div data-region="strip"></div>
  <main id="main-plan" class="planner">
    <section class="planner-heading" data-region="heading"></section>
    <section data-region="summary"></section>
    <section class="timeline" aria-label="Wedding day timeline" data-region="timeline"></section>
  </main>
  <div data-region="toolbar"></div>`;

const REGIONS = {
  header: ({ plan, ui }) => renderHeader({ plan, ui }),
  offline: ({ ui }) => renderOfflineBar({ ui }),
  strip: ({ ui }) => renderStrip({ ui, strip: ui.strip }),
  heading: ({ plan }) => renderHeading({ plan }),
  summary: ({ plan, ui }) => renderSummary({ plan, ui }),
  timeline: ({ plan, ui }) => renderTimeline({ plan, ui }),
  // The toolbar's second line repeats what the selected card had to hide, so
  // it is drawn after the cards have been measured.
  toolbar: ({ plan, ui }) => renderToolbar({
    plan,
    ui,
    hiddenDetails: ui.selectedId ? hiddenDetails(app.querySelector(`.card[data-activity-id="${cssEscape(ui.selectedId)}"]`)) : ''
  })
};

let currentScreen = null;
let currentDialogKey = null;
// Focus is returned to whatever opened the sheet when it closes, so a dialog
// never leaves the next Tab starting from the top of the page.
let dialogOpener = null;
/** The editor's contents when it opened, so Cancel knows whether to ask. */
let editorBaseline = null;

function screenOf(ui) {
  if (ui.loadError && !store.plan) return 'error';
  if (ui.authenticated === null) return 'loading';
  if (!ui.authenticated) return 'signin';
  if (!store.plan) return 'loading';
  return 'planner';
}

function signInScreen() {
  return `<main class="login-view">
    <section class="login-card" aria-labelledby="login-title">
      <div class="brand brand--login">${icon('heart')}<span>Our Wedding</span></div>
      <div class="login-copy">
        <p class="eyebrow">Private planner</p>
        <h1 id="login-title">Wedding Day</h1>
        <p>Enter the shared password to open the day plan.</p>
      </div>
      <form id="login-form" class="form-stack" novalidate>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" autofocus></label>
        <p id="login-error" class="form-error" role="alert" hidden></p>
        <button class="button button--primary button--wide" type="submit">Continue</button>
      </form>
    </section>
  </main>`;
}

function loadingScreen() {
  return `<main class="loading-view"><div class="loading-mark">${icon('heart')}</div><p>Opening your plan…</p></main>`;
}

/** A failed load is never shown as an empty plan or as a sign-in prompt. */
function errorScreen(message) {
  return `<main class="fatal-view">
    <div>${icon('warning')}</div>
    <h1>Can't load the plan right now</h1>
    <p>${escapeHtml(message || 'Please try again.')}</p>
    <button class="button button--primary" type="button" data-action="retry-load">Retry</button>
  </main>`;
}

function repaint(regions = ['all']) {
  const ui = store.ui;
  const screen = screenOf(ui);

  if (screen !== currentScreen) {
    currentScreen = screen;
    if (screen === 'error') app.innerHTML = errorScreen(ui.loadError);
    else if (screen === 'signin') app.innerHTML = signInScreen();
    else if (screen === 'loading') app.innerHTML = loadingScreen();
    else {
      app.innerHTML = SHELL;
      paintRegions(Object.keys(REGIONS));
    }
    syncSheet();
    return;
  }

  if (screen === 'error') {
    app.innerHTML = errorScreen(ui.loadError);
    return;
  }
  if (screen !== 'planner') return;

  paintRegions(regions.includes('all') ? Object.keys(REGIONS) : regions.filter(name => name in REGIONS));
  syncSheet();
}

function paintRegions(names) {
  const context = { plan: store.plan, ui: store.ui };
  for (const name of names) {
    paint(app.querySelector(`[data-region="${name}"]`), REGIONS[name](context));
  }
  if (names.includes('timeline')) {
    gestures.bind();
    // What a card can show depends on its rendered size, so it is measured
    // after the paint rather than guessed from the duration. The toolbar then
    // repeats whatever the selected card had to drop.
    fitCards(app, () => {
      if (store.ui.selectedId) paintRegions(['toolbar']);
    });
  }
}

// ------------------------------------------------------------------ sheets

/**
 * Identity of the open sheet. While it does not change, the sheet is left
 * alone — that is what keeps a background save from rebuilding it. The version
 * list is part of the identity because saving a version changes what the sheet
 * should show.
 */
function dialogKey(dialog) {
  if (!dialog) return null;
  if (dialog.type === 'conflict') return `conflict:${dialog.latest?.revision ?? 'unknown'}`;
  if (dialog.type === 'activity') return `activity:${dialog.mode}:${dialog.activity.id}`;
  if (dialog.type === 'versions') return `versions:${store.ui.versions.length}:${store.revision}`;
  if (dialog.type === 'open-time') return `open-time:${dialog.openTime.beforeId}:${dialog.openTime.start}`;
  if (dialog.type === 'stage') return `stage:${dialog.item.id}`;
  return dialog.type;
}

function syncSheet() {
  const key = dialogKey(store.ui.dialog);
  if (key === currentDialogKey) return;
  const closing = currentDialogKey && !key;
  currentDialogKey = key;

  const open = sheetRoot.querySelector('dialog');
  if (open) open.close();
  sheetRoot.innerHTML = key ? renderSheet(store.ui, store.plan) : '';

  if (!key) {
    if (closing && dialogOpener) focusByKey(app, dialogOpener);
    dialogOpener = null;
    return;
  }

  const dialog = sheetRoot.querySelector('dialog');
  bindSheet(dialog);
  dialog.showModal();
}

function closeSheet() {
  editorBaseline = null;
  store.setUi({ dialog: null }, { regions: [] });
  syncSheet();
}

/**
 * Closing the editor. Swiping a sheet down and pressing Cancel are the same
 * thing, so both ask before throwing away typing — and neither asks when
 * nothing was typed.
 *
 * The question is asked *on top of* the editor, not instead of it: tearing the
 * sheet down to ask "discard changes?" would discard them either way, and
 * "Keep editing" would come back to an empty form.
 */
function requestCloseEditor() {
  const form = sheetRoot.querySelector('#activity-form');
  if (!form || editorBaseline === null || formSignature(form) === editorBaseline) {
    closeSheet();
    return;
  }
  showDiscardAlert();
}

function showDiscardAlert() {
  alertRoot.innerHTML = discardSheet();
  const alert = alertRoot.querySelector('dialog');

  const dismiss = () => {
    alert.close();
    alertRoot.innerHTML = '';
  };
  alert.addEventListener('cancel', event => {
    event.preventDefault();
    dismiss();
  });
  alert.querySelector('[data-action="discard-confirm"]').addEventListener('click', () => {
    dismiss();
    closeSheet();
  });
  alert.querySelector('.sheet-close').addEventListener('click', dismiss);
  alert.showModal();
}

const gestures = createGestures({
  root: app,
  store,
  commit: (action, payload) => commit(action, payload),
  repaint,
  // A long press is the phone's way into the editor; double-click is the
  // pointer equivalent.
  onLongPress: id => openEditor(id)
});

// ------------------------------------------------------------------ changes

/**
 * Apply an action, save it, and offer it back.
 *
 * Every change that a person made deliberately can be taken back for six
 * seconds, which is why deleting does not ask first (D7): the answer to "are
 * you sure?" is being able to say no afterwards. A change that also moved the
 * rest of the day says so in the same toast.
 */
function commit(action, payload, options = {}) {
  // One gate for every change, whatever raised it — a gesture, a keyboard
  // shortcut, a sheet. Blocking each entry point separately would eventually
  // miss one.
  if (isViewOnly()) return null;

  const result = store.dispatch(action, payload, options);
  if (!result) return null;
  saver.markDirty();
  // Written before the save is attempted, so a change survives the app being
  // closed a moment later.
  writeDeviceCopy(store.plan, { revision: store.revision, dirty: true });

  if (options.silent) return result;
  const shift = shiftMessage(result.shifted);
  toast(shift ? `${result.label} · ${shift}` : result.label, {
    action: { label: 'Undo', run: undo }
  });
  return result;
}

/** On the day, nothing changes until someone has pressed Edit. */
function isViewOnly() {
  return Boolean(store.ui.dayOf && !store.ui.editingOnDay);
}

function undo() {
  if (isViewOnly()) return;
  const result = store.undo({ regions: ['all'] });
  if (!result) return;
  saver.markDirty();
  writeDeviceCopy(store.plan, { revision: store.revision, dirty: true });
  // Selecting an activity that the undo removed would leave the toolbar
  // describing something that is no longer there.
  if (store.ui.selectedId && !store.plan.activities.some(a => a.id === store.ui.selectedId)) {
    store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
  }
}

async function flushSave() {
  await saver.flushNow();
  if (saver.hasPendingChanges || saver.isBlocked) throw new Error('Plan is not fully saved');
  store.setRevision(saver.revision);
}

// -------------------------------------------------------------- validation

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach(node => node.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach(node => {
    node.removeAttribute('aria-invalid');
    node.removeAttribute('aria-describedby');
  });
}

/**
 * Validation runs through the module the server uses, so the message shown here
 * is the reason the server would have given — and the sheet stays open with the
 * offending field focused instead of the change being applied and then refused.
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

// ------------------------------------------------------------- people chips

function peopleValues(root) {
  const editor = root.querySelector('.people-editor');
  if (!editor) return [];
  try {
    const stored = JSON.parse(editor.dataset.people || '[]');
    const values = Array.isArray(stored) ? stored.map(value => String(value).trim()).filter(Boolean) : [];
    // Text typed but not confirmed with Enter used to be dropped on Done (F20).
    const pending = editor.querySelector('.people-add-input')?.value.trim();
    if (pending && !values.some(person => person.toLowerCase() === pending.toLowerCase())) values.push(pending);
    return values;
  } catch {
    return [];
  }
}

function setPeopleValues(editor, values) {
  const unique = [];
  const seen = new Set();
  for (const value of values.map(entry => String(entry).trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  const capped = unique.slice(0, 30);
  editor.dataset.people = JSON.stringify(capped);
  editor.querySelector('.people-chip-list').innerHTML = peopleChips(capped);
}

function addPendingPerson(editor) {
  const input = editor.querySelector('.people-add-input');
  const value = input?.value.trim();
  if (!value) return;
  setPeopleValues(editor, [...JSON.parse(editor.dataset.people || '[]'), value]);
  input.value = '';
  editor.querySelector('.people-add-row').hidden = false;
  editor.querySelector('.people-add-input')?.focus();
}

function bindPeopleEditor(dialog) {
  const editor = dialog.querySelector('.people-editor');
  if (!editor) return;

  editor.addEventListener('click', event => {
    const trigger = event.target.closest('.people-add-trigger');
    if (trigger) {
      editor.querySelector('.people-add-row').hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      editor.querySelector('.people-add-input')?.focus();
      return;
    }
    const remove = event.target.closest('.person-remove');
    if (remove) {
      const person = remove.dataset.person;
      setPeopleValues(editor, JSON.parse(editor.dataset.people || '[]').filter(value => value !== person));
      return;
    }
    if (event.target.closest('.people-add-confirm')) addPendingPerson(editor);
  });

  editor.querySelector('.people-add-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addPendingPerson(editor);
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      editor.querySelector('.people-add-row').hidden = true;
      editor.querySelector('.people-add-trigger')?.focus();
    }
  });
}

// ------------------------------------------------------------ sheet wiring

function bindSheet(dialog) {
  const close = dialog.id === 'activity-dialog' ? requestCloseEditor : closeSheet;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  dialog.querySelectorAll('.sheet-close').forEach(button => button.addEventListener('click', close));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });

  if (dialog.id === 'activity-dialog') {
    const form = dialog.querySelector('#activity-form');
    form.addEventListener('submit', submitActivity);

    // Deleting from inside the editor is the same delete as anywhere else: no
    // confirmation, and six seconds to undo.
    dialog.querySelector('#delete-activity')?.addEventListener('click', () => {
      const id = store.ui.dialog.activity.id;
      editorBaseline = null;
      closeSheet();
      commit('activity.remove', { id });
      store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
    });

    // Flexible and Fixed are one choice, so picking one shows what that means.
    for (const radio of dialog.querySelectorAll('input[name="timing"]')) {
      radio.addEventListener('change', () => {
        const fixed = dialog.querySelector('input[name="timing"][value="fixed"]').checked;
        dialog.querySelector('.timing-fixed')?.classList.toggle('is-hidden', !fixed);
        dialog.querySelector('.timing-flexible')?.classList.toggle('is-hidden', fixed);
        for (const label of dialog.querySelectorAll('.segmented label')) {
          label.classList.toggle('is-on', label.querySelector('input').checked);
        }
        updateEnds(dialog);
      });
    }

    for (const button of dialog.querySelectorAll('[data-duration-step]')) {
      button.addEventListener('click', () => {
        const input = dialog.querySelector('input[name="duration"]');
        input.value = normalizeDuration(Number(input.value) + Number(button.dataset.durationStep));
        updateEnds(dialog);
      });
    }

    const duration = dialog.querySelector('input[name="duration"]');
    duration?.addEventListener('blur', () => {
      duration.value = normalizeDuration(Number(duration.value));
      updateEnds(dialog);
    });
    duration?.addEventListener('input', () => updateEnds(dialog));
    dialog.querySelector('input[name="lockedStart"]')?.addEventListener('input', () => updateEnds(dialog));

    bindPeopleEditor(dialog);
    // What the form looked like on open, so Cancel knows whether to ask.
    editorBaseline = formSignature(form);
    return;
  }

  if (dialog.id === 'versions-dialog') {
    dialog.querySelector('#version-form').addEventListener('submit', createVersion);
    for (const button of dialog.querySelectorAll('.restore-version')) {
      button.addEventListener('click', () => void restoreVersion(button.dataset.versionId));
    }
    for (const button of dialog.querySelectorAll('.delete-version')) {
      button.addEventListener('click', () => void removeVersion(button.dataset.versionId));
    }
    return;
  }

  if (dialog.id === 'settings-dialog') {
    dialog.querySelector('#settings-form').addEventListener('submit', submitSettings);
  }

}

/** "Ends" is worked out from the start and the duration, and shown live. */
function updateEnds(dialog) {
  const node = dialog.querySelector('[data-ends]');
  if (!node) return;

  const fixed = dialog.querySelector('input[name="timing"][value="fixed"]')?.checked;
  const duration = normalizeDuration(Number(dialog.querySelector('input[name="duration"]').value));
  const startText = fixed
    ? roundTimeUp(dialog.querySelector('input[name="lockedStart"]').value)
    : null;

  let start;
  if (startText) {
    start = Number(startText.slice(0, 2)) * 60 + Number(startText.slice(3));
  } else {
    const scheduled = buildSchedule(store.plan).items.find(item => item.id === store.ui.dialog?.activity?.id);
    start = scheduled ? scheduled.start : null;
  }

  node.textContent = start === null ? '—' : formatTime(start + duration);
  const flexibleStart = dialog.querySelector('.timing-flexible .group-value');
  if (flexibleStart && start !== null && !fixed) flexibleStart.textContent = formatTime(start);
}

/** A stable description of the form, for telling "changed" from "untouched". */
function formSignature(form) {
  const data = [...new FormData(form).entries()].map(([key, value]) => `${key}=${value}`);
  const people = form.querySelector('.people-editor')?.dataset.people ?? '[]';
  const pending = form.querySelector('.people-add-input')?.value ?? '';
  return JSON.stringify([data, people, pending]);
}

function submitActivity(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);

  const data = new FormData(form);
  const locked = data.get('timing') === 'fixed';
  const candidate = {
    id: String(data.get('id')),
    title: String(data.get('title')).trim(),
    duration: normalizeDuration(Number(data.get('duration'))),
    stage: String(data.get('stage')),
    location: String(data.get('location')).trim(),
    people: peopleValues(form),
    notes: String(data.get('notes')).trim(),
    // A typed time rounds up to the next 5 minutes instead of being refused.
    lockedStart: locked ? (roundTimeUp(String(data.get('lockedStart') || '')) || store.plan.dayStart) : null
  };

  let activity;
  try {
    activity = validateActivity(candidate);
  } catch (error) {
    showFieldError(form, error.field, error.message);
    return;
  }

  const creating = store.ui.dialog.mode === 'create';
  editorBaseline = null;
  closeSheet();

  if (creating) {
    commit('activity.add', { activity, afterId: store.ui.selectedId });
    store.setUi({ selectedId: activity.id }, { regions: ['timeline', 'toolbar'] });
  } else {
    commit('activity.update', { activity });
  }
}

function submitSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);

  const data = new FormData(form);
  const changes = {
    coupleLabel: String(data.get('coupleLabel')).trim(),
    title: String(data.get('title')).trim(),
    date: String(data.get('date')),
    dayStart: roundTimeUp(String(data.get('dayStart') || '')) || ''
  };

  const result = checkPlan({ ...structuredClone(store.plan), ...changes });
  if (!result.ok) {
    showFieldError(form, result.error.field, result.error.message);
    return;
  }

  closeSheet();
  commit('plan.settings', { changes: { coupleLabel: result.plan.coupleLabel, title: result.plan.title, date: result.plan.date, dayStart: result.plan.dayStart } });
}

async function createVersion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  clearFieldErrors(form);
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
    currentDialogKey = null;
    store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
    writeDeviceCopy(result.plan, { revision: result.revision, dirty: false });
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

// ------------------------------------------------------------ interactions

/**
 * Remember the control that opened a sheet, so focus can go back to it.
 * Menu items live inside a popover that is torn down with the menu, so they
 * pass the button that opened the menu as the fallback.
 */
function rememberOpener(fallback = null) {
  dialogOpener = document.activeElement?.closest?.('[data-focus-key]')?.getAttribute('data-focus-key') ?? fallback;
}

function openEditor(id) {
  const activity = store.plan.activities.find(item => item.id === id);
  if (!activity) return;
  rememberOpener();
  if (!dialogOpener) dialogOpener = `card:${id}`;
  store.setUi({ dialog: { type: 'activity', mode: 'edit', activity: structuredClone(activity) }, openMenu: null });
}

function blankActivity() {
  return {
    id: uid(),
    title: '',
    duration: 30,
    stage: STAGES[0].id,
    location: '',
    people: [],
    notes: '',
    lockedStart: null
  };
}

function addActivity() {
  rememberOpener();
  store.setUi({ dialog: { type: 'activity', mode: 'create', activity: blankActivity() }, openMenu: null });
}

const ACTION_HANDLERS = {
  select(_, element) {
    store.setUi({ selectedId: element.dataset.id, openMenu: null }, { regions: ['timeline', 'toolbar'] });
  },
  duplicate(_, element) {
    const result = commit('activity.duplicate', { id: element.dataset.id, newId: uid() });
    if (result) store.setUi({ openMenu: null }, { regions: ['timeline', 'toolbar'] });
  },
  edit(_, element) {
    openEditor(element.dataset.id);
  },
  add: addActivity,
  delete(_, element) {
    const id = element.dataset.id;
    commit('activity.remove', { id });
    store.setUi({ selectedId: null, openMenu: null }, { regions: ['timeline', 'toolbar'] });
  },
  lock(_, element) {
    const id = element.dataset.id;
    const activity = store.plan.activities.find(item => item.id === id);
    const unfixing = Boolean(activity?.lockedStart);
    // The menu closes before the plan changes: closing it afterwards would be
    // undone by the repaint the change triggers.
    store.setUi({ selectedId: id, openMenu: null }, { regions: [] });

    const result = commit(unfixing ? 'activity.unfix' : 'activity.fix', { id },
      { regions: ['timeline', 'toolbar'], silent: unfixing });

    // Unfixing moves the activity, so the toast says where it went as well as
    // what it cost the rest of the day.
    if (result && unfixing) {
      const moved = buildSchedule(store.plan).items.find(entry => entry.id === id);
      const shift = shiftMessage(result.shifted);
      const where = moved ? `${activity.title} now starts ${moved.startLabel}` : result.label;
      toast(shift ? `${where} · ${shift}` : where, { action: { label: 'Undo', run: undo } });
    }
  },
  'set-stage'(_, element) {
    const id = element.dataset.id;
    if (store.ui.dialog?.type === 'stage') closeSheet();
    store.setUi({ selectedId: id, openMenu: null }, { regions: [] });
    commit('activity.stage', { id, stage: element.dataset.stage }, { regions: ['timeline', 'toolbar'] });
  },
  menu(_, element) {
    const name = element.dataset.menu;
    // The toolbar's Stage button opens a list sheet; the stage tag on a card
    // opens a menu beside it.
    if (element.closest('.toolbar') && name.startsWith('stage:')) {
      const item = store.plan.activities.find(entry => entry.id === name.slice(6));
      if (!item) return;
      rememberOpener('toolbar-stage');
      store.setUi({ openMenu: null, dialog: { type: 'stage', item } });
      return;
    }
    store.setUi({ openMenu: store.ui.openMenu === name ? null : name });
  },
  'menu-action'(_, element) {
    const action = element.dataset.menuAction;
    if (action === 'day-of') {
      // Switching by hand is remembered for this date only: turning it off on
      // the morning of the wedding should stay off for the rest of that day,
      // and mean nothing the week after.
      const next = !store.ui.dayOf;
      writeOverride(store.plan.date, next);
      store.setUi({ openMenu: null, editingOnDay: false }, { regions: [] });
      clock.tick();
      return;
    }
    if (action === 'versions') return void openVersions();
    if (action === 'settings') {
      rememberOpener('menu-app');
      return store.setUi({ openMenu: null, dialog: { type: 'settings' } });
    }
    if (action === 'logout') return void signOut();
  },
  conflict(_, element) {
    void resolveConflict(element.dataset.choice);
  },
  'open-time'(_, element) {
    rememberOpener(`open-time:${element.dataset.before}`);
    store.setUi({
      openMenu: null,
      dialog: {
        type: 'open-time',
        openTime: {
          beforeId: element.dataset.before,
          start: Number(element.dataset.start),
          end: Number(element.dataset.end)
        }
      }
    });
  },
  'open-time-choice'(_, element) {
    const { openTime } = store.ui.dialog;
    const choice = element.dataset.choice;
    closeSheet();

    if (choice === 'buffer') {
      const result = commit('openTime.buffer', { openTime, newId: uid('buffer') });
      if (result) store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
      return;
    }
    if (choice === 'extend') return void commit('openTime.extend', { openTime });

    // "Add activity here" creates the activity and opens it, so the name can
    // be typed straight away.
    const activity = blankActivity();
    const result = commit('openTime.add', { openTime, activity });
    if (result) {
      store.setUi({ selectedId: activity.id }, { regions: [] });
      openEditor(activity.id);
    }
  },
  jump(_, element) {
    const target = element.dataset.target === 'conflict'
      ? app.querySelector('.card.is-conflicted, .card.is-overrun')
      : app.querySelector('.open-time');
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('is-highlighted');
    setTimeout(() => target.classList.remove('is-highlighted'), 1600);
  },
  'day-of-edit'() {
    store.setUi({ editingOnDay: true }, { regions: ['header', 'timeline', 'toolbar'] });
  },
  'day-of-done'() {
    returnToViewOnly();
  },
  'save-retry'() {
    void saver.retry();
  },
  'retry-load'() {
    store.setUi({ loadError: null });
    void (store.ui.authenticated ? loadPlan() : init());
  }
};

/**
 * Resolving a conflict never throws a copy away. The side that is not chosen
 * is written to version history first, so "Keep my changes" does not mean
 * "lose theirs" and vice versa.
 */
async function resolveConflict(choice) {
  const latest = store.ui.conflict?.latest;
  if (!latest) return;

  const mine = structuredClone(store.plan);
  closeSheet();
  store.setUi({ conflict: null }, { regions: [] });

  const stamp = new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const keeping = choice === 'remote' ? mine : latest.plan;
  const name = choice === 'remote' ? `My unsaved changes – ${stamp}` : `Other device – ${stamp}`;
  await api.createVersion(name, { auto: true, plan: keeping }).catch(() => {
    toast('The other copy could not be saved to version history.', { tone: 'error' });
  });

  if (choice === 'remote') {
    saver.markClean(latest.revision);
    store.setPlan(latest.plan, { revision: latest.revision, updatedAt: latest.updatedAt });
    writeDeviceCopy(latest.plan, { revision: latest.revision, dirty: false });
    return;
  }

  store.setRevision(latest.revision);
  await saver.resume({ revision: latest.revision });
}

async function signOut() {
  try { await flushSave(); } catch { /* the sign-out still happens; the copy stays on the device */ }
  await api.logout().catch(() => {});
  // Signing out is the one time the copy is cleared: it is the only moment
  // someone has said they are finished with this device.
  clearDeviceCopy(store.plan?.id);
  saver.markClean(null);
  store.resetUi();
  store.setPlan(null, { revision: null });
  store.setUi({ authenticated: false });
}

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

// --------------------------------------------------------------- listeners

document.addEventListener('click', event => {
  // The click a long press leaves behind must not also select or open
  // something.
  if (gestures.suppressingClick) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const control = event.target.closest('[data-action]');
  if (control) {
    // `closest` finds the innermost control, so a button inside a card wins
    // over the card's own select action.
    const handler = ACTION_HANDLERS[control.dataset.action];
    if (handler) {
      handler(event, control);
      return;
    }
  }

  // Anything else closes an open menu (F26) and, outside the timeline, clears
  // the selection.
  if (store.ui.openMenu && !event.target.closest('.menu-popover, .stage-menu, .card-menu')) {
    store.setUi({ openMenu: null });
    return;
  }
  if (store.ui.selectedId && !event.target.closest('.card, dialog, .topbar, .toolbar')) {
    store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
  }
});

document.addEventListener('dblclick', event => {
  const card = event.target.closest('.card');
  if (!card || event.target.closest('button')) return;
  openEditor(card.dataset.id);
});

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    // Inside a field, the browser's own undo is the one that is wanted.
    if (event.target.closest?.('input, textarea, [contenteditable]')) return;
    event.preventDefault();
    undo();
    return;
  }

  if (event.key === 'Escape') {
    if (gestures.active) {
      gestures.cancel();
      return;
    }
    if (store.ui.openMenu) {
      const opener = store.ui.openMenu;
      store.setUi({ openMenu: null });
      focusByKey(app, opener === 'app' ? 'menu-app' : opener);
      return;
    }
    if (store.ui.selectedId && !sheetRoot.querySelector('dialog')) {
      store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
    }
    return;
  }

  const card = event.target.closest?.('.card');
  if (card && (event.key === 'Enter' || event.key === ' ') && event.target === card) {
    event.preventDefault();
    // Enter on a card that is already selected opens it, as the spec says.
    if (event.key === 'Enter' && store.ui.selectedId === card.dataset.id) openEditor(card.dataset.id);
    else store.setUi({ selectedId: card.dataset.id, openMenu: null }, { regions: ['timeline', 'toolbar'] });
  }

  // Every gesture has a keyboard alternative: Alt and the arrows move a card,
  // and the arrows on a focused handle move that edge five minutes.
  if (card && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    const index = Number(card.dataset.index);
    commit('activity.move', { id: card.dataset.id, toIndex: index + (event.key === 'ArrowUp' ? -1 : 1) }, { regions: ['timeline', 'toolbar'] });
    focusByKey(app, `card:${card.dataset.id}`);
    return;
  }

  const handle = event.target.closest?.('[data-role="resize"], [data-role="resize-top"]');
  if (handle && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    // Down moves the edge later, up moves it earlier — the same direction the
    // edge itself moves on screen (F30).
    const delta = event.key === 'ArrowDown' ? 5 : -5;
    const item = buildSchedule(store.plan).items.find(entry => entry.id === handle.dataset.id);
    if (!item) return;
    const top = handle.dataset.role === 'resize-top';
    commit(top ? 'activity.resizeTop' : 'activity.resizeBottom',
      top ? { id: item.id, newStart: item.start + delta } : { id: item.id, newEnd: item.end + delta },
      { regions: ['timeline', 'toolbar'] });
    focusByKey(app, `${top ? 'resize-top' : 'resize'}:${handle.dataset.id}`);
  }
});

document.addEventListener('submit', event => {
  // Delegated, so the form comes from the target rather than currentTarget —
  // currentTarget here is the document.
  if (event.target.id === 'login-form') void handleLogin(event, event.target);
});

document.addEventListener('change', event => {
  if (event.target.dataset?.action === 'status') {
    commit('plan.status', { status: event.target.value }, { regions: ['header'] });
  }
});

/**
 * The day-of clock.
 *
 * Reading it is what decides the strip, the time line and which cards are
 * past, so every tick is a repaint of those and nothing else. Half a minute is
 * enough for a countdown in whole minutes.
 */
const clock = createClock(now => {
  if (!store.plan) return;

  const automatic = shouldBeOn(store.plan, now);
  const override = readOverride(store.plan.date);
  const on = override === null ? automatic : override;

  const changes = { dayOf: on };
  if (on) {
    changes.strip = stripState(store.plan, now);
    changes.nowMinutes = minutesNow(store.plan, now);
  } else {
    changes.strip = null;
    changes.nowMinutes = null;
    changes.editingOnDay = false;
  }

  // The current activity changing is the only thing worth a repaint of the
  // timeline; the countdown alone only changes the strip.
  const currentChanged = store.ui.strip?.current?.id !== changes.strip?.current?.id
    || store.ui.dayOf !== on;
  store.setUi(changes, { regions: currentChanged ? ['header', 'strip', 'timeline'] : ['strip'] });
});

/**
 * Editing on the day is deliberate, and it lapses. Leaving the app for five
 * minutes means whatever was being edited is over, and coming back to a plan
 * that can be changed by a stray thumb is the thing day-of view exists to
 * prevent.
 */
let leftAt = null;

function returnToViewOnly() {
  if (!store.ui.editingOnDay) return;
  store.setUi({ editingOnDay: false, selectedId: null, openMenu: null }, { regions: ['header', 'timeline', 'toolbar'] });
}

watchFit(app);
window.addEventListener('online', () => void saver.handleOnline());
window.addEventListener('offline', () => repaint(['header', 'offline']));

/**
 * Picking up someone else's change.
 *
 * Asked on coming back to the app and every minute while it is visible, and
 * only ever applied when there is nothing of our own waiting to be saved —
 * otherwise this would be the silent overwrite the conflict dialog exists to
 * prevent.
 */
const REFRESH_INTERVAL_MS = 60_000;

async function refreshFromServer() {
  if (!store.plan || !store.ui.authenticated) return;
  if (saver.hasPendingChanges || saver.isBlocked || store.ui.dialog) return;

  try {
    const result = await api.load(store.revision);
    if (result.unchanged) return;
    saver.markClean(result.revision);
    store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
    writeDeviceCopy(result.plan, { revision: result.revision, dirty: false });
  } catch {
    // A failed check is not news. The next one will do.
  }
}

setInterval(() => {
  if (document.visibilityState === 'visible') void refreshFromServer();
}, REFRESH_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (leftAt !== null && Date.now() - leftAt > AUTO_VIEW_ONLY_MS) returnToViewOnly();
    leftAt = null;
    clock.tick();
    void refreshFromServer();
    return;
  }
  leftAt = Date.now();
  // Going away: send anything outstanding now rather than hoping the tab
  // survives long enough for the debounce.
  saver.flushOnHide(api.saveOnHide);
});

window.addEventListener('pagehide', () => saver.flushOnHide(api.saveOnHide));

store.subscribe(change => repaint(change.regions));

// -------------------------------------------------------------------- boot

async function loadPlan() {
  store.setUi({ loadError: null }, { regions: [] });
  try {
    const result = await api.load();
    saver.markClean(result.revision);
    store.setUi({ readOnlyCopy: false }, { regions: [] });
    store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
    writeDeviceCopy(result.plan, { revision: result.revision, dirty: false });

    // Edits made while the app was last open, still unsent.
    const copy = readDeviceCopy(result.plan.id);
    if (copy?.dirty && copy.revision === result.revision) {
      store.setPlan(copy.plan, { revision: result.revision, updatedAt: result.updatedAt });
      saver.markDirty();
    }
    return;
  } catch (error) {
    if (error.status === 401) {
      store.setUi({ authenticated: false });
      return;
    }

    // Nothing could be loaded. If this device has a copy, showing it — clearly
    // marked as such — beats a blank screen and a message.
    const copy = readDeviceCopy();
    if (copy) {
      saver.markClean(copy.revision);
      store.setUi({ readOnlyCopy: true }, { regions: [] });
      store.setPlan(copy.plan, { revision: copy.revision, updatedAt: copy.savedAt });
      if (copy.dirty) saver.markDirty();
      return;
    }
    store.setUi({ loadError: error.message || 'Please try again.' });
  }
}

async function init() {
  repaint();
  try {
    const session = await api.session();
    store.setUi({ authenticated: Boolean(session.authenticated) });
    if (session.authenticated) await loadPlan();
  } catch (error) {
    // A session check that could not be answered says nothing about whether
    // this device is signed in. Showing the sign-in screen would ask for the
    // password over a connection that is down (F27).
    store.setUi({
      loadError: error.code === 'network' || error.code === 'timeout'
        ? "Can't reach the planner right now."
        : (error.message || 'Please try again.')
    });
  }
}

void init();

export { store, saver, SAVE_STATES };
