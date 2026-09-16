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
import { escapeHtml, focusByKey, paint, uid } from './dom.js';
import { createGestures } from './gestures.js';
import { icon } from './icons.js';
import { SAVE_STATES, createSavePipeline } from './save.js';
import { buildSchedule } from './schedule.js';
import { createStore } from './state.js';
import { renderConflict, renderHeader } from './render/header.js';
import { peopleChips, renderSheet } from './render/sheets.js';
import { renderStrip } from './render/strip.js';
import { renderHeading, renderTimeline } from './render/timeline.js';
import { createToaster } from './render/toast.js';
import { renderToolbar } from './render/toolbar.js';
import { checkPlan, normalizeDuration, roundTimeUp, validateActivity } from './validate.js';

const app = document.querySelector('#app');
const sheetRoot = document.querySelector('#sheet-root');
const toast = createToaster(document.querySelector('#toast-region'));

const store = createStore();
const DEVICE_ID = deviceId();

const saver = createSavePipeline({
  save: (plan, revision, device) => api.save(plan, revision, device),
  getPlan: () => store.plan,
  deviceId: DEVICE_ID,
  onStateChange: next => store.setUi({ saveState: next }, { regions: ['header'] }),
  onSaved: ({ revision, updatedAt }) => store.setRevision(revision, updatedAt),
  onError: message => toast(message, 'error'),
  // The local side of a conflict is read when the user chooses, not captured
  // here, so "Keep my changes" means the plan as it is now (F12).
  onConflict: latest => store.setUi({ conflict: { latest } }, { regions: ['conflict'] }),
  onUnauthorized: () => store.setUi({ authenticated: false })
});

// ---------------------------------------------------------------- screens

const SHELL = `
  <header class="topbar" data-region="header"></header>
  <div data-region="conflict"></div>
  <div data-region="strip"></div>
  <main id="main-plan" class="planner">
    <section class="planner-heading" data-region="heading"></section>
    <section class="timeline" aria-label="Wedding day timeline" data-region="timeline"></section>
  </main>
  <div data-region="toolbar"></div>`;

const REGIONS = {
  header: ({ plan, ui }) => renderHeader({ plan, ui }),
  conflict: ({ ui }) => renderConflict({ ui }),
  strip: () => renderStrip(),
  heading: ({ plan }) => renderHeading({ plan }),
  timeline: ({ plan, ui }) => renderTimeline({ plan, ui }),
  toolbar: () => renderToolbar()
};

let currentScreen = null;
let currentDialogKey = null;
// Focus is returned to whatever opened the sheet when it closes, so a dialog
// never leaves the next Tab starting from the top of the page.
let dialogOpener = null;

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
  if (names.includes('timeline')) gestures.bind();
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
  if (dialog.type === 'activity') return `activity:${dialog.mode}:${dialog.activity.id}`;
  if (dialog.type === 'versions') return `versions:${store.ui.versions.length}`;
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
  store.setUi({ dialog: null }, { regions: [] });
  syncSheet();
}

const gestures = createGestures({
  root: app,
  store,
  commit: (action, payload) => commit(action, payload),
  repaint
});

// ------------------------------------------------------------------ changes

/** Apply an action and let the save pipeline know something changed. */
function commit(action, payload, options) {
  const result = store.dispatch(action, payload, options);
  if (result) saver.markDirty();
  return result;
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
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeSheet();
  });
  dialog.querySelectorAll('.sheet-close').forEach(button => button.addEventListener('click', closeSheet));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeSheet();
  });

  if (dialog.id === 'activity-dialog') {
    dialog.querySelector('#activity-form').addEventListener('submit', submitActivity);
    dialog.querySelector('#delete-activity')?.addEventListener('click', () => {
      const id = store.ui.dialog.activity.id;
      closeSheet();
      commit('activity.remove', { id });
      store.setUi({ selectedId: null }, { regions: ['timeline'] });
    });
    dialog.querySelector('#lock-toggle')?.addEventListener('change', event => {
      dialog.querySelector('#fixed-time-field')?.classList.toggle('is-hidden', !event.target.checked);
    });
    dialog.querySelectorAll('[data-duration-step]').forEach(button => button.addEventListener('click', () => {
      const input = dialog.querySelector('input[name="duration"]');
      input.value = normalizeDuration(Number(input.value) + Number(button.dataset.durationStep));
    }));
    const duration = dialog.querySelector('input[name="duration"]');
    duration?.addEventListener('blur', () => { duration.value = normalizeDuration(Number(duration.value)); });
    bindPeopleEditor(dialog);
    return;
  }

  if (dialog.id === 'versions-dialog') {
    dialog.querySelector('#version-form').addEventListener('submit', createVersion);
    dialog.querySelectorAll('.restore-version').forEach(button => button.addEventListener('click', () => restoreVersion(button.dataset.versionId)));
    return;
  }

  if (dialog.id === 'settings-dialog') {
    dialog.querySelector('#settings-form').addEventListener('submit', submitSettings);
  }
}

function submitActivity(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);

  const data = new FormData(form);
  const locked = data.get('locked') === 'on';
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
  closeSheet();
  if (creating) commit('activity.add', { activity, afterId: store.ui.selectedId });
  else commit('activity.update', { activity });
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
    await flushSave();
    const result = await api.createVersion(new FormData(form).get('name'), store.revision);
    saver.markClean(result.revision);
    store.setRevision(result.revision);
    // The sheet stays open; its identity changes with the list, so it repaints.
    store.setUi({ versions: result.versions }, { regions: [] });
    syncSheet();
  } catch (error) {
    if (error.field) showFieldError(form, error.field, error.message);
    else toast(error.message || 'Could not save that version.', 'error');
    button.disabled = false;
  }
}

async function restoreVersion(id) {
  const version = store.ui.versions.find(item => item.id === id);
  if (!version) return;
  try {
    const result = await api.restoreVersion(id, store.revision);
    saver.markClean(result.revision);
    store.setUi({ versions: result.versions, dialog: null }, { regions: [] });
    store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
  } catch (error) {
    toast(error.message || 'Could not restore that version.', 'error');
  }
}

async function openVersions() {
  rememberOpener('menu-app');
  try {
    await flushSave();
    const result = await api.versions();
    store.setRevision(result.revision);
    store.setUi({ versions: result.versions, openMenu: null, dialog: { type: 'versions' } });
  } catch (error) {
    toast(error.message || 'Could not open version history.', 'error');
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

function addActivity() {
  rememberOpener();
  const activity = {
    id: uid(),
    title: '',
    duration: 30,
    stage: STAGES[0].id,
    location: '',
    people: [],
    notes: '',
    lockedStart: null
  };
  store.setUi({ dialog: { type: 'activity', mode: 'create', activity }, openMenu: null });
}

const ACTION_HANDLERS = {
  select(_, element) {
    store.setUi({ selectedId: element.dataset.id, openMenu: null }, { regions: ['timeline'] });
  },
  edit(_, element) {
    openEditor(element.dataset.id);
  },
  add: addActivity,
  delete(_, element) {
    const id = element.dataset.id;
    commit('activity.remove', { id });
    store.setUi({ selectedId: null, openMenu: null }, { regions: ['timeline'] });
  },
  lock(_, element) {
    const id = element.dataset.id;
    const activity = store.plan.activities.find(item => item.id === id);
    const action = activity?.lockedStart ? 'activity.unfix' : 'activity.fix';
    // The menu closes before the plan changes: closing it afterwards would be
    // undone by the repaint the change triggers.
    store.setUi({ selectedId: id, openMenu: null }, { regions: [] });
    commit(action, { id, scheduleBefore: buildSchedule(store.plan) }, { regions: ['timeline'] });
  },
  'set-stage'(_, element) {
    const id = element.dataset.id;
    store.setUi({ selectedId: id, openMenu: null }, { regions: [] });
    commit('activity.stage', { id, stage: element.dataset.stage }, { regions: ['timeline'] });
  },
  menu(_, element) {
    const name = element.dataset.menu;
    store.setUi({ openMenu: store.ui.openMenu === name ? null : name });
  },
  'menu-action'(_, element) {
    const action = element.dataset.menuAction;
    if (action === 'versions') return void openVersions();
    if (action === 'settings') {
      rememberOpener('menu-app');
      return store.setUi({ openMenu: null, dialog: { type: 'settings' } });
    }
    if (action === 'logout') return void signOut();
  },
  conflict(_, element) {
    resolveConflict(element.dataset.choice);
  },
  'save-retry'() {
    void saver.retry();
  },
  'retry-load'() {
    store.setUi({ loadError: null });
    void (store.ui.authenticated ? loadPlan() : init());
  }
};

function resolveConflict(choice) {
  const latest = store.ui.conflict?.latest;
  if (!latest) return;
  store.setUi({ conflict: null }, { regions: ['conflict'] });

  if (choice === 'remote') {
    saver.markClean(latest.revision);
    store.setPlan(latest.plan, { revision: latest.revision, updatedAt: latest.updatedAt });
    return;
  }
  store.setRevision(latest.revision);
  void saver.resume({ revision: latest.revision });
}

async function signOut() {
  try { await flushSave(); } catch { /* the sign-out still happens; the copy stays on the device */ }
  await api.logout().catch(() => {});
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
  if (store.ui.selectedId && !event.target.closest('.activity-card, dialog, .topbar')) {
    store.setUi({ selectedId: null }, { regions: ['timeline'] });
  }
});

document.addEventListener('dblclick', event => {
  const card = event.target.closest('.activity-card');
  if (!card || event.target.closest('button')) return;
  openEditor(card.dataset.id);
});

document.addEventListener('keydown', event => {
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
      store.setUi({ selectedId: null }, { regions: ['timeline'] });
    }
    return;
  }

  const card = event.target.closest?.('.activity-card');
  if (card && (event.key === 'Enter' || event.key === ' ') && event.target === card) {
    event.preventDefault();
    store.setUi({ selectedId: card.dataset.id, openMenu: null }, { regions: ['timeline'] });
  }

  if (card && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    const index = Number(card.closest('.activity-row').dataset.index);
    commit('activity.move', { id: card.dataset.id, toIndex: index + (event.key === 'ArrowUp' ? -1 : 1) }, { regions: ['timeline'] });
    focusByKey(app, `card:${card.dataset.id}`);
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

window.addEventListener('online', () => void saver.handleOnline());
window.addEventListener('offline', () => repaint(['header']));

store.subscribe(change => repaint(change.regions));

// -------------------------------------------------------------------- boot

async function loadPlan() {
  store.setUi({ loadError: null }, { regions: [] });
  try {
    const result = await api.load();
    saver.markClean(result.revision);
    store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
  } catch (error) {
    if (error.status === 401) {
      store.setUi({ authenticated: false });
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
