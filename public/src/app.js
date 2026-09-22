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
import { readDeviceBase, readDeviceCopy, writeDeviceBase, writeDeviceCopy } from './device.js';
import { cssEscape, escapeHtml, focusByKey, paint, uid, watchCollapsedTitle } from './dom.js';
import { AUTO_VIEW_ONLY_MS, createClock, isViewOnly, minutesNow, readOverride, shouldBeOn, stripState, writeOverride } from './dayof.js';
import { createGestures } from './gestures.js';
import { bump } from './haptics.js';
import { bindSheetDrag } from './sheet-drag.js';
import { PX_PER_MIN } from './layout.js';
import { icon } from './icons.js';
import { mergePlans } from './merge.js';
import { SAVE_STATES, createSavePipeline } from './save.js';
import { createStore } from './state.js';
import { paintBrowserChrome, readTheme, writeTheme } from './theme.js';
import { createAuth } from './auth.js';
import { createVersions } from './versions.js';
import { createActivityForm } from './activity-form.js';
import { renderHeader } from './render/header.js';
import { discardSheet, emptyState, renderSheet } from './render/sheets.js';
import { buildSchedule, formatTime } from './schedule.js';
import { renderFilterBar, renderFilters } from './render/filters.js';
import { renderPrint } from './render/print.js';
import { renderStrip } from './render/strip.js';
import { renderHeading, renderSummary, renderTimeline } from './render/timeline.js';
import { fitCards, hiddenDetails, watchFit } from './render/fit.js';
import { createSettle } from './render/settle.js';
import { createToaster } from './render/toast.js';
import { renderToolbar } from './render/toolbar.js';
import { normalizeDuration } from './validate.js';

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

/**
 * How long "Saving…" stays up once it has been shown.
 *
 * Most saves wait out the 650 ms debounce first, so they are readable on their
 * own. The ones that skip it — a version being saved, signing out, the flush
 * on coming back to the tab — can answer in fifty milliseconds, and a word
 * that appears and leaves inside a twentieth of a second is a flicker in the
 * corner of the eye rather than a report. Every other state is shown at once:
 * "Offline" and "Not saved" are things to act on, not things to pace.
 */
const SAVING_MIN_MS = 700;
let shownSaveState = SAVE_STATES.saved;
let savingShownAt = 0;
let saveHoldTimer = null;

function showSaveState(state) {
  shownSaveState = state;
  if (state === SAVE_STATES.saving) savingShownAt = Date.now();
  // The offline bar reads the same state as the header, so both repaint.
  store.setUi({ saveState: state }, { regions: ['header', 'offline'] });
}

function presentSaveState(next) {
  clearTimeout(saveHoldTimer);
  saveHoldTimer = null;

  const owed = SAVING_MIN_MS - (Date.now() - savingShownAt);
  if (next !== SAVE_STATES.saving && shownSaveState === SAVE_STATES.saving && owed > 0) {
    // Show whatever is true when the debt is paid, not what was true now: a
    // failure landing during the hold must not be masked by a stale "Saved".
    saveHoldTimer = setTimeout(() => {
      saveHoldTimer = null;
      showSaveState(saver.state);
    }, owed);
    return;
  }
  showSaveState(next);
}

/**
 * The plan as the server last confirmed it — the common ancestor a merge
 * measures both sides against.
 *
 * Without it the only question that can be asked about two diverged plans is
 * "which one?". With it, almost every divergence answers itself: whatever only
 * one side moved is not in dispute, and there is nothing to ask.
 *
 * It is set from whatever the server tells us it is holding — a load, a
 * refresh, a successful save — and never from the screen.
 */
let basePlan = null;

/**
 * The ancestor moves only when the server says something new, and it is
 * mirrored to the device so that it outlives the tab. Every assignment goes
 * through here so the two can never drift apart.
 */
function setBase(plan, revision) {
  basePlan = plan || null;
  if (plan) writeDeviceBase(plan, revision);
}

const saver = createSavePipeline({
  save: (plan, revision, device) => api.save(plan, revision, device),
  getPlan: () => store.plan,
  deviceId: DEVICE_ID,
  // The offline bar reads the same state as the header, so both repaint.
  onStateChange: presentSaveState,
  onSaved: ({ revision, updatedAt, plan }) => {
    store.setRevision(revision, updatedAt);
    if (plan) setBase(plan, revision);
    writeDeviceCopy(store.plan, { revision, dirty: false });
  },
  onError: message => toast(message, { tone: 'error' }),
  onConflict: latest => {
    // A conflict with nothing to compare against. The store was empty when the
    // write landed, so there is no other version — and a dialog asking which
    // of two copies to keep, when one of them does not exist, is two buttons
    // that do nothing. The header's "Not saved" and its retry are the honest
    // offer; the plan on screen is the only copy there is.
    if (!latest?.plan) {
      toast('That did not save. Tap "Not saved" to try again.', { tone: 'error' });
      return;
    }
    reconcile(latest);
  },
  onUnauthorized: () => store.setUi({ authenticated: false })
});

/**
 * Someone else saved first. Put the two plans together rather than asking
 * which day to keep.
 *
 * Most of the time this is silent, because most of the time the two of you
 * were working on different activities and there is nothing to decide. A toast
 * says what arrived, so the plan changing under you is never a surprise. Only
 * the same field of the same activity, changed twice to different values, is
 * a question — and then the dialog names it.
 */
function reconcile(latest) {
  // No ancestor means this tab never saw a confirmed version of the plan, so
  // there is nothing to measure divergence against. That is the one case where
  // the old whole-plan question is the honest one.
  if (!basePlan) {
    store.setUi({ conflict: { latest }, dialog: { type: 'conflict', latest, conflicts: null } });
    return;
  }

  const { plan, conflicts } = mergePlans(basePlan, store.plan, latest.plan);

  if (conflicts.length) {
    store.setUi({ conflict: { latest }, dialog: { type: 'conflict', latest, conflicts } });
    return;
  }

  applyMerge(plan, latest);
  toast('Merged the changes from the other device.');
}

/**
 * Adopt a merged plan and carry on saving it.
 *
 * The revision moves to the one the other side landed, because that is the
 * version this merge is built on; the save that follows is an ordinary save of
 * an ordinary plan, and if a third change arrives while it is in the air, it
 * merges too.
 */
function applyMerge(plan, latest) {
  setBase(latest.plan, latest.revision);
  store.setPlan(plan, { revision: latest.revision, updatedAt: latest.updatedAt });
  writeDeviceCopy(plan, { revision: latest.revision, dirty: true });
  saver.setRevision(latest.revision);
  void saver.resume({ revision: latest.revision });
}

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
  <div data-region="strip"></div>
  <div data-region="offline"></div>
  <div data-region="filterbar"></div>
  <main id="main-plan" class="planner">
    <section class="planner-heading" data-region="heading"></section>
    <section data-region="summary"></section>
    <section data-region="filters"></section>
    <section class="timeline" aria-label="Wedding day timeline" data-region="timeline"></section>
  </main>
  <div data-region="print" aria-hidden="true"></div>
  <div data-region="toolbar"></div>`;

const REGIONS = {
  header: ({ plan, ui }) => renderHeader({ plan, ui }),
  offline: ({ ui }) => renderOfflineBar({ ui }),
  strip: ({ ui }) => renderStrip({ ui, strip: ui.strip }),
  heading: ({ plan, ui }) => renderHeading({ plan, ui }),
  summary: ({ plan, ui }) => renderSummary({ plan, ui }),
  filters: ({ plan, ui }) => renderFilters({ plan, ui }),
  filterbar: ({ plan, ui }) => renderFilterBar({ plan, ui }),
  timeline: ({ plan, ui }) => plan.activities.length ? renderTimeline({ plan, ui }) : emptyState(),
  // Built from the same plan and the same filter, and only ever seen on paper.
  print: ({ plan, ui }) => renderPrint({ plan, ui }),
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
/**
 * A load that resolves this fast should look instant, so nothing is drawn at
 * all until it has not (DESIGN_GUIDE 4.9). A skeleton that appears for eighty
 * milliseconds is a flash, which is worse than the blank it replaced.
 */
const LOADING_DELAY_MS = 400;
let loadingTimer = null;
/** Set once per visit to the day-of view, so the scroll happens on arrival only. */
let scrolledToNow = false;
// Focus is returned to whatever opened the sheet when it closes, so a dialog
// never leaves the next Tab starting from the top of the page.
let dialogOpener = null;
/** The pending "unhighlight" timer from the last summary-link jump. */
let highlightTimer = null;
/**
 * How long the toolbar plays its exit before the + actually takes its place
 * (DESIGN_GUIDE 4.7: toolbar in/out, 180ms). Matches `--dur-base`.
 */
const TOOLBAR_EXIT_MS = 180;
let toolbarExitTimer = null;

function showLoading() {
  app.innerHTML = '';
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => {
    if (currentScreen === 'loading') app.innerHTML = loadingScreen();
  }, LOADING_DELAY_MS);
}

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

/**
 * The loading skeleton (DESIGN_GUIDE 4.9).
 *
 * Three cards at their rest-height pattern rather than a spinner: the plan
 * then arrives into the shape it was already drawn in, instead of the screen
 * cutting from a message to a timeline. It is `aria-hidden` and the region
 * carries the one sentence a screen reader needs — a skeleton read aloud is
 * three empty boxes.
 */
const SKELETON_HEIGHTS = [240, 120, 360];

function loadingScreen() {
  return `<main class="loading-view planner" aria-busy="true" aria-label="Opening your plan">
    <div class="skeleton-heading" aria-hidden="true">
      <div class="skeleton-line"></div><div class="skeleton-line"></div>
    </div>
    <div class="skeleton-timeline" aria-hidden="true">
      ${SKELETON_HEIGHTS.map(height => `<div class="skeleton-card" style="height:${height}px"></div>`).join('')}
    </div>
  </main>`;
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
    if (screen !== 'loading') clearTimeout(loadingTimer);
    if (screen === 'error') app.innerHTML = errorScreen(ui.loadError);
    else if (screen === 'signin') app.innerHTML = signInScreen();
    else if (screen === 'loading') showLoading();
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

/**
 * Deselecting swaps the toolbar for the + instantly everywhere else in the
 * app: `paint()` is a straight `innerHTML` replace. The toolbar is the one
 * region with an exit of its own (DESIGN_GUIDE 4.7), so leaving it is held
 * back long enough to play it — the old toolbar stays put, `is-leaving`, and
 * the actual swap to the + happens after.
 */
function paintToolbar(context) {
  const container = app.querySelector('[data-region="toolbar"]');
  clearTimeout(toolbarExitTimer);
  const outgoing = container.querySelector('.toolbar:not(.is-leaving)');
  const html = REGIONS.toolbar(context);
  if (outgoing && !html.includes('class="toolbar')) {
    outgoing.classList.add('is-leaving');
    toolbarExitTimer = setTimeout(() => {
      paint(container, html);
      measureBottomFurniture();
    }, TOOLBAR_EXIT_MS);
    return;
  }
  paint(container, html);
}

function paintRegions(names) {
  const context = { plan: store.plan, ui: store.ui };
  // The timeline is rebuilt wholesale, so the only record of where everything
  // just was is the screen itself. Take it before the paint; play the
  // difference straight after, before anything else gets a chance to scroll.
  const settle = names.includes('timeline') ? captureSettle() : null;
  for (const name of names) {
    if (name === 'toolbar') { paintToolbar(context); continue; }
    paint(app.querySelector(`[data-region="${name}"]`), REGIONS[name](context));
  }
  settle?.();
  if (names.includes('toolbar')) measureBottomFurniture();
  // Measured before the handover is re-armed, because the handover lands on
  // the inset. The strip and the pinned bars change height without the heading
  // being touched — the strip's second line wraps, an overrun appears, a
  // filter is turned on — and each of those moves the line the title hands
  // over on, so they re-arm it too.
  const stickyChanged = names.some(name => STICKY_REGIONS.has(name));
  if (stickyChanged) measureStickyInset();
  if (stickyChanged || names.includes('heading')) refreshCollapsedTitle();
  if (names.includes('filters')) watchChipOverflow();
  if (names.includes('timeline')) {
    gestures.bind();
    scrollToNow();
    // What a card can show depends on its rendered size, so it is measured
    // after the paint rather than guessed from the duration. The toolbar then
    // repeats whatever the selected card had to drop.
    fitCards(app, () => {
      if (store.ui.selectedId) paintRegions(['toolbar']);
    });
  }
}

/**
 * How tall the bottom of the screen already is, so a toast can sit above it.
 *
 * That is the 58 px floating + most of the time, but selecting a card replaces
 * the + with the selection toolbar, which is twice as tall — taller again when
 * the selected card has a second line of hidden details to repeat. The toast
 * used to be pinned at a fixed 96 px, tuned for the +, which put it on top of
 * the toolbar's context line and the top of its buttons on every lock,
 * duplicate, stage change and handle resize. Measuring is the only honest
 * answer: the height depends on what the selected card had to hide.
 */
function measureBottomFurniture() {
  const node = app.querySelector('.toolbar, .mobile-add');
  const height = node ? Math.round(node.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--bottom-furniture', `${height}px`);
}

/**
 * How much of the top of the screen is already spoken for.
 *
 * The top bar is always there; the live strip joins it on the day; the offline
 * and filter bars join either, and each other. Anything scrolled into view —
 * a card tabbed onto, the card focus is returned to after Alt+arrow moves it —
 * has to clear whatever is actually showing, which is why this is summed
 * rather than written down as a number.
 */
const STICKY_REGIONS = new Set(['header', 'strip', 'offline', 'filterbar']);

function measureStickyInset() {
  let total = 0;
  for (const node of app.querySelectorAll('.topbar, .live-strip, .pinned-bar')) {
    total += node.getBoundingClientRect().height;
  }
  document.documentElement.style.setProperty('--sticky-inset', `${Math.round(total)}px`);

  // The bar's real height, for the bars that stick to its underside. The token
  // is a design floor (52 px, 62 px on a desktop) and the bar is often taller
  // than it — a notch's safe-area inset is part of its padding — which left the
  // live strip and the pinned bars sticking somewhere inside it. They can only
  // be right if the number they use is measured.
  //
  // Floored rather than rounded. The bar is often a fractional number of
  // pixels — a safe-area inset, browser zoom, a non-integer device pixel ratio
  // — and rounding up parks the strip a fraction of a pixel below the bar,
  // leaving a seam the plan scrolls through and making the bar's own hairline
  // look doubled. Flooring tucks the strip that fraction *under* the bar
  // instead, where nothing can see it: it sits below the bar in the stack.
  const topbar = app.querySelector('.topbar');
  if (topbar) {
    document.documentElement.style.setProperty(
      '--topbar-height', `${Math.floor(topbar.getBoundingClientRect().height)}px`);
  }
}

/**
 * The chip row hides its scrollbar, so the row itself has to say when there is
 * more of it. A chip cut flush at the screen edge reads as the last chip; one
 * fading out reads as a row that carries on. Only the side that really has
 * more is faded, so a row that fits is not given a false edge.
 */
function markChipOverflow() {
  const row = app.querySelector('.filter-chips');
  if (!row) return;
  const max = row.scrollWidth - row.clientWidth;
  row.classList.toggle('has-more-before', row.scrollLeft > 1);
  row.classList.toggle('has-more-after', row.scrollLeft < max - 1);
}

// The row is replaced on every filter repaint, so the observer is re-pointed
// rather than re-created; a new one per paint would leak one per click.
const chipObserver = new ResizeObserver(markChipOverflow);

function watchChipOverflow() {
  const row = app.querySelector('.filter-chips');
  if (!row) return;
  row.addEventListener('scroll', markChipOverflow, { passive: true });
  chipObserver.disconnect();
  chipObserver.observe(row);
  markChipOverflow();
}

/**
 * The on-screen keyboard.
 *
 * It does not move the layout viewport on iOS, so a sheet anchored to the
 * bottom of the page is anchored behind the keyboard, and the field being
 * typed into can sit under it with no way back but a manual scroll. The
 * visual viewport is the only thing that knows the keyboard is there.
 *
 * How much of the screen it covers is measured against the viewport's own
 * resting height, learned by watching, rather than against `innerHeight`.
 * Those two are not the same box on every engine: WebKit reports them against
 * different things, and `visualViewport.height` is not meaningful at all until
 * the page has laid out. Subtracting one from the other gave a resting inset
 * of nearly the whole screen on iOS, which took `max-height` below zero and
 * collapsed the editor sheet to nothing — the pull gesture then dismissed on
 * any movement, because every distance is past 40 % of no height.
 *
 * Against its own resting height the answer is exactly zero when there is no
 * keyboard, whatever the engine thinks `innerHeight` means.
 *
 * Two things other than a keyboard shrink that measurement, and both used to
 * be read as one.
 *
 * A pinch or a double-tap zoom shrinks `visualViewport.height` exactly as a
 * keyboard does — at scale 2.2 this measured a 180 px keyboard that was not
 * there and cut the editor sheet from 607 px to 427 — so a zoomed reading is
 * not a reading at all and is dropped.
 *
 * And the resting height itself was only ever allowed to grow, so one tall
 * measurement — a browser toolbar auto-hiding, a zoom out — biased every
 * reading after it and left the sheet sitting above a keyboard-shaped gap for
 * the rest of the session. Nothing but a text field opens a keyboard, so when
 * none has focus there is no keyboard: whatever the viewport measures then is
 * the resting height, and the inset is zero. That is self-correcting, and it
 * is also what makes a tap on a stage chip put a shortened sheet back — the
 * radio takes focus, the inset clears with it.
 */
/** What a keyboard opens for. Everything else takes focus without one. */
const KEYBOARDLESS_INPUT = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'
]);

function opensKeyboard(node) {
  if (!node || node.disabled || node.readOnly) return false;
  if (node.isContentEditable) return true;
  if (node.tagName === 'TEXTAREA') return true;
  return node.tagName === 'INPUT' && !KEYBOARDLESS_INPUT.has(node.type);
}

function trackKeyboardInset() {
  const viewport = window.visualViewport;
  if (!viewport) return;

  let restingExtent = 0;

  const update = () => {
    // Zoomed in or out, the visual viewport is not measuring the keyboard.
    if (Math.abs(viewport.scale - 1) > 0.01) return;

    const extent = viewport.height + viewport.offsetTop;
    // Nothing useful to read yet. Writing a number now is how the sheet ends
    // up with no height at all.
    if (!(extent > 0)) return;

    const focused = document.activeElement;
    if (!opensKeyboard(focused)) {
      restingExtent = extent;
      document.documentElement.style.setProperty('--keyboard-inset', '0px');
      return;
    }

    restingExtent = Math.max(restingExtent, extent);
    const inset = Math.round(Math.max(0, restingExtent - extent));
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);

    // The sheet has just been resized under the field; put it back in view.
    if (inset > 0 && focused?.closest?.('.sheet-body')) {
      focused.scrollIntoView({ block: 'nearest' });
    }
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  // Focus is the other half of the measurement, so it is read when focus
  // moves and not only when the viewport does — a keyboard dismissed by a tap
  // elsewhere does not always resize anything.
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 0));
  window.addEventListener('resize', () => {
    restingExtent = 0;
    update();
  });
  update();
}

/**
 * On arriving at the day-of view, put the current time in the upper third:
 * what is happening now belongs near the top of the screen, with what is
 * coming below it, because that is the direction the day is read in.
 */
function scrollToNow() {
  if (!store.ui.dayOf || store.ui.nowMinutes === null || store.ui.nowMinutes === undefined) {
    scrolledToNow = false;
    return;
  }
  if (scrolledToNow) return;

  const line = app.querySelector('.now-line');
  if (!line) return;
  scrolledToNow = true;

  const top = line.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: Math.max(0, top - window.innerHeight / 3), behavior: 'instant' });
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
  if (dialog.type === 'share') return `share:${dialog.share?.token ?? 'none'}`;
  if (dialog.type === 'versions') return `versions:${store.ui.versions.length}:${store.revision}`;
  if (dialog.type === 'open-time') return `open-time:${dialog.openTime.beforeId}:${dialog.openTime.start}`;
  if (dialog.type === 'stage') return `stage:${dialog.item.id}`;
  return dialog.type;
}

/**
 * Close a dialog and let it leave.
 *
 * `overlay` is a transitionable property, so a closed dialog stays in the top
 * layer for exactly as long as its exit takes (styles/sheets.css) — but only
 * while it is still on the page. Tearing the node down on the same tick as
 * `close()`, which is what used to happen, is what made an exit animation
 * impossible. It is marked on the way out so that nothing else mistakes it for
 * the live one, and removed once it has gone.
 *
 * A little longer than the exit itself: a timer that fires on the exact
 * millisecond can land a frame early and cut the last of it.
 */
const SHEET_EXIT_MS = 260;

function releaseDialog(dialog) {
  if (!dialog || dialog.classList.contains('is-leaving')) return;
  dialog.close();
  dialog.classList.add('is-leaving');
  // It is a picture from here on: nothing in it can be reached, focused or
  // read out, so the fifth of a second it spends leaving cannot be mistaken
  // for a fifth of a second of it still being there.
  dialog.inert = true;
  setTimeout(() => dialog.remove(), SHEET_EXIT_MS);
}

/**
 * Make room for a dialog about to open. Anything still leaving goes at once:
 * a new question supersedes the fading picture of the old one, and two of the
 * same dialog must never be in the document together.
 */
function clearLeaving(root) {
  for (const stale of root.querySelectorAll('dialog.is-leaving')) stale.remove();
}

/** The sheet that is actually open, as opposed to one still on its way out. */
function liveSheet() {
  return sheetRoot.querySelector('dialog:not(.is-leaving)');
}

function syncSheet() {
  const key = dialogKey(store.ui.dialog);
  if (key === currentDialogKey) return;
  const closing = currentDialogKey && !key;
  currentDialogKey = key;

  // Appended rather than assigned: the sheet on its way out is still on the
  // page, and overwriting the root would take it with it. One sheet handing
  // straight to another — the open-time sheet into the activity editor — puts
  // both here for a fifth of a second, the new one on top of the old.
  releaseDialog(liveSheet());

  if (!key) {
    if (closing && dialogOpener) focusByKey(app, dialogOpener);
    dialogOpener = null;
    return;
  }

  clearLeaving(sheetRoot);
  sheetRoot.insertAdjacentHTML('beforeend', renderSheet(store.ui, store.plan));
  const dialog = sheetRoot.lastElementChild;
  bindSheet(dialog);
  dialog.showModal();
}

function closeSheet() {
  activityForm.clearBaseline();
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
  const form = liveSheet()?.querySelector('#activity-form');
  if (!form || !activityForm.hasUnsavedChanges(form)) {
    closeSheet();
    return;
  }
  showDiscardAlert();
}

function showDiscardAlert() {
  clearLeaving(alertRoot);
  alertRoot.insertAdjacentHTML('beforeend', discardSheet());
  const alert = alertRoot.lastElementChild;

  const dismiss = () => {
    releaseDialog(alert);
    syncOverlayHistory();
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
  syncOverlayHistory();
}

// -------------------------------------------------------------- back button
//
// The browser restores the scroll position it recorded for a history entry, and
// the entry this module pushes is recorded at the moment something was opened.
// Selecting a card near the top of the day, scrolling a long way down and
// pressing back therefore did two things: it cleared the selection, and it
// threw the reader back to where the card had been. Back closes the top thing;
// it is not a way of travelling, and the page stays exactly where it is.
history.scrollRestoration = 'manual';

// On a phone, "back" is the hardware button or edge gesture, and it goes to
// the browser's history, not to the app. Left alone it leaves the whole plan
// behind whatever was open — a sheet, a menu, a selected card — instead of
// closing that one thing the way every native app on the phone does.
//
// The fix is a single dummy history entry that exists exactly while
// something is open. Back then lands on that entry, which does not
// navigate anywhere (same URL), and the resulting `popstate` is read as
// "close the top thing" instead. Closing that thing any other way (Cancel,
// tapping the scrim, Escape) consumes the same entry with `history.back()`
// so the phone's back stack never grows a trail of dead stops.
//
// `history.back()` is not immediate — its `popstate` lands on a later tick —
// while `pushState` takes effect at once. Closing one sheet and opening the
// next (the open-time sheet handing straight to the activity editor;
// finishing that editor and landing back on the card it created selected)
// happens in the same synchronous stretch of code, as two separate store
// updates. Reacting to each update as it happens would call `back()` for
// the close and then `pushState` for the reopen before that `back()` had
// even landed, leaving the real history position one entry off from what
// this module believes it is. Reacting once, on a microtask queued after
// the synchronous stretch finishes, sees only the net change — nothing to
// do at all when a close is immediately followed by an open.
let overlayHistoryPushed = false;
let ignoreNextPopstate = false;
let overlaySyncQueued = false;

function topOverlayOpen() {
  return Boolean(
    alertRoot.querySelector('dialog[open]') ||
    sheetRoot.querySelector('dialog[open]') ||
    store.ui.openMenu ||
    store.ui.selectedId ||
    // An open-time block that is selected is showing its handles and has taken
    // over the timeline's one selection, exactly as a card does. Leaving it out
    // meant back left the app instead of clearing it.
    store.ui.selectedOpenTime
  );
}

function syncOverlayHistory() {
  if (overlaySyncQueued) return;
  overlaySyncQueued = true;
  queueMicrotask(() => {
    overlaySyncQueued = false;
    const open = topOverlayOpen();
    if (open && !overlayHistoryPushed) {
      overlayHistoryPushed = true;
      history.pushState({ wrpOverlay: true }, '');
    } else if (!open && overlayHistoryPushed) {
      overlayHistoryPushed = false;
      ignoreNextPopstate = true;
      history.back();
    }
  });
}

window.addEventListener('popstate', () => {
  if (ignoreNextPopstate) {
    ignoreNextPopstate = false;
    return;
  }
  if (!topOverlayOpen()) return;
  overlayHistoryPushed = false;

  const alert = alertRoot.querySelector('dialog[open]');
  if (alert) {
    alert.dispatchEvent(new Event('cancel', { cancelable: true }));
    return;
  }
  const sheet = sheetRoot.querySelector('dialog[open]');
  if (sheet) {
    (sheet.id === 'activity-dialog' ? requestCloseEditor : closeSheet)();
    return;
  }
  if (store.ui.openMenu) {
    store.setUi({ openMenu: null });
    return;
  }
  if (store.ui.selectedId) {
    store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
    return;
  }
  if (store.ui.selectedOpenTime) {
    store.setUi({ selectedOpenTime: null }, { regions: ['timeline'] });
  }
});

/**
 * Committed changes move rather than teleport (DESIGN_GUIDE §6).
 *
 * Nothing settles while a gesture is running: an edge or a card being dragged
 * follows the pointer exactly, and a repaint that happened to land mid-drag
 * must not start easing the thing under the finger.
 */
const captureSettle = createSettle(app, { enabled: () => !gestures.active });

const gestures = createGestures({
  root: app,
  store,
  commit: (action, payload) => commit(action, payload),
  repaint,
  // Double-click and double-tap open a card's editor. A long press is not an
  // alternative to them any more — on a card it is what lifts it to be moved.
  // An open-time block has nothing to lift, so it keeps the long press as its
  // own way into the actions sheet, alongside a double-click.
  onDoubleClick: id => openEditor(id),
  onOpenTimeActivate: (beforeId, start, end) => openOpenTimeSheet(beforeId, start, end)
});

// ------------------------------------------------------------------ changes

/**
 * Apply an action, save it, and offer it back.
 *
 * Every change that a person made deliberately can be taken back for six
 * seconds, which is why deleting does not ask first (D7): the answer to "are
 * you sure?" is being able to say no afterwards.
 */
function commit(action, payload, options = {}) {
  // One gate for every change, whatever raised it — a gesture, a keyboard
  // shortcut, a sheet. Blocking each entry point separately would eventually
  // miss one.
  if (isViewOnly(store.ui)) return null;

  const result = store.dispatch(action, payload, options);
  if (!result) return null;
  saver.markDirty();
  // Written before the save is attempted, so a change survives the app being
  // closed a moment later.
  writeDeviceCopy(store.plan, { revision: store.revision, dirty: true });

  if (options.silent) return result;
  toast(result.label, { action: { label: 'Undo', run: undo } });
  return result;
}

function undo() {
  if (isViewOnly(store.ui)) return;
  const result = store.undo({ regions: ['all'] });
  if (!result) return;
  // Undo puts the plan back somewhere it has already been, which is the one
  // change on screen that nothing was watching happen — the thumb was on the
  // toast, not on the card that moved.
  bump();
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

// ------------------------------------------------------------ sheet wiring

function bindSheet(dialog) {
  const close = dialog.id === 'activity-dialog' ? requestCloseEditor : closeSheet;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  dialog.querySelectorAll('.sheet-close').forEach(button => button.addEventListener('click', close));
  // The grabber at the top of a sheet promises this. Same `close` as Cancel,
  // so a sheet with typing in it still asks before throwing it away.
  bindSheetDrag(dialog, { close });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });

  // A tap on a stage chip, a duration stepper or any other non-text control
  // does not open the keyboard, so the browser has no reason of its own to
  // scroll it into view — unlike a text field, which it scrolls above the
  // keyboard automatically. Without this the row a phone just interacted
  // with can sit under the keyboard, or off the bottom of a short sheet,
  // with no way back to it but a manual scroll.
  //
  // This is deliberately not `scrollIntoView`. That walks every scrollable
  // ancestor, and a `<dialog>` is one — the UA stylesheet gives it
  // `overflow: auto` — so tapping a stage chip scrolled the sheet body by
  // half a screen *and* shifted the dialog underneath it, which is what made
  // the editor feel like it had seized. Here nothing moves unless the row is
  // genuinely outside the body, and then only the body moves, by the least
  // it can.
  const sheetBody = dialog.querySelector('.sheet-body');
  sheetBody?.addEventListener('focusin', event => {
    const row = event.target.closest('.field, .group-row, .stage-choice');
    if (!row) return;
    const view = sheetBody.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const MARGIN = 12;
    const below = box.bottom - (view.bottom - MARGIN);
    const above = (view.top + MARGIN) - box.top;
    const delta = below > 0 ? below : above > 0 ? -above : 0;
    if (delta) sheetBody.scrollBy({ top: delta, behavior: 'smooth' });
  });

  if (dialog.id === 'activity-dialog') {
    activityForm.bindActivityDialog(dialog);
    return;
  }

  if (dialog.id === 'versions-dialog') {
    dialog.querySelector('#version-form').addEventListener('submit', versions.createVersion);
    for (const button of dialog.querySelectorAll('.restore-version')) {
      button.addEventListener('click', () => void versions.restoreVersion(button.dataset.versionId));
    }
    for (const button of dialog.querySelectorAll('.delete-version')) {
      button.addEventListener('click', () => void versions.removeVersion(button.dataset.versionId));
    }
    return;
  }

  if (dialog.id === 'settings-dialog') {
    activityForm.bindSettingsDialog(dialog);
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

/** The + button, or a long press/double-click on the block itself (gestures.js). */
function openOpenTimeSheet(beforeId, start, end) {
  rememberOpener();
  if (!dialogOpener) dialogOpener = `open-time:${beforeId}`;
  store.setUi({
    openMenu: null,
    selectedOpenTime: null,
    dialog: { type: 'open-time', openTime: { beforeId, start, end } }
  });
}

/** Where a new activity starts: right after whatever is selected, or after the last activity, or 8 AM on an empty plan. */
function defaultStart() {
  const items = buildSchedule(store.plan).items;
  const selected = store.ui.selectedId && items.find(item => item.id === store.ui.selectedId);
  if (selected) return selected.end;
  return items.length ? Math.max(...items.map(item => item.end)) : 8 * 60;
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
    start: defaultStart(),
    locked: false
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
    // The menu closes before the plan changes: closing it afterwards would be
    // undone by the repaint the change triggers.
    store.setUi({ selectedId: id, openMenu: null }, { regions: [] });
    commit('activity.toggleLock', { id }, { regions: ['timeline', 'toolbar'] });
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
    if (action === 'print') {
      store.setUi({ openMenu: null });
      // The print layout is already on the page; the browser decides what to
      // do with it.
      requestAnimationFrame(() => window.print());
      return;
    }
    if (action === 'export') {
      store.setUi({ openMenu: null });
      // A download, not a navigation. Setting location.href asks the browser
      // to go to the file and hope it comes back; Safari does not treat that
      // as a download at all, and the app would be unloaded if it did not.
      const link = document.createElement('a');
      link.href = '/api/export';
      link.download = `wedding-plan-${store.plan?.date || 'backup'}.json`;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      return;
    }
    if (action === 'theme') {
      setTheme(store.ui.theme === 'dark' ? 'light' : 'dark');
      store.setUi({ openMenu: null });
      return;
    }
    if (action === 'share') return void openShare();
    if (action === 'versions') return void versions.openVersions();
    if (action === 'settings') {
      rememberOpener('menu-app');
      return store.setUi({ openMenu: null, dialog: { type: 'settings' } });
    }
    if (action === 'logout') return void auth.signOut();
  },
  conflict(_, element) {
    void resolveConflict(element.dataset.choice);
  },
  'share-copy'() {
    void copyShareLink();
  },
  'share-rotate'() {
    void rotateShareLink();
  },
  'select-open-time'(_, element) {
    // Never toggles off on a repeat tap — same as a card's own 'select' —
    // so the click a handle drag leaves behind (its own pointerdown calls
    // preventDefault/stopPropagation, but not on the click that follows) is
    // a harmless no-op here exactly as it is on a card, not something to
    // guard against.
    // 'toolbar' too: selecting a block may silently clear a selected card
    // (setUi, state.js — only one of the two is ever "the" selection), and
    // that card's toolbar needs to go with it.
    store.setUi({ selectedOpenTime: element.dataset.before, openMenu: null }, { regions: ['timeline', 'toolbar'] });
  },
  'open-time'(_, element) {
    openOpenTimeSheet(element.dataset.before, Number(element.dataset.start), Number(element.dataset.end));
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

    // "Add activity here" opens the editor on a blank activity; nothing goes
    // into the plan until Done, exactly as the + does.
    //
    // It used to commit first and open afterwards. Pressing Cancel then left
    // an untitled activity in the plan, which the server refuses — and a plan
    // the server refuses is a plan that never saves again.
    rememberOpener();
    store.setUi({
      openMenu: null,
      dialog: {
        type: 'activity',
        mode: 'create',
        openTime,
        // Pre-filled with the length of the gap, which is what it will be if
        // the field is left alone.
        activity: { ...blankActivity(), start: openTime.start, duration: normalizeDuration(openTime.end - openTime.start) }
      }
    });
  },
  jump(_, element) {
    const target = element.dataset.target === 'conflict'
      ? app.querySelector('.card.is-overlap')
      : app.querySelector('.open-time');
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('is-highlighted');
    // A repaint before the highlight finishes (the jumped-to card gets
    // edited, say) detaches this exact node; the old timer would then just
    // do nothing, but it is still cleared so two jumps in a row cannot leave
    // the wrong element highlighted.
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      target.classList.remove('is-highlighted');
      highlightTimer = null;
    }, 1600);
  },
  'day-of-edit'() {
    store.setUi({ editingOnDay: true }, { regions: ['header', 'heading', 'timeline', 'toolbar'] });
  },
  'day-of-done'() {
    returnToViewOnly();
  },
  filter(_, element) {
    const person = element.dataset.person || null;
    // The print layout is filtered too — "print my part" is the reason to
    // print at all — so it repaints with everything else.
    store.setUi({ filter: person === store.ui.filter ? null : person },
      { regions: ['filters', 'filterbar', 'timeline', 'print'] });
  },
  'use-template'() {
    void useTemplate();
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
 * The read-only link.
 *
 * Asked for rather than kept: the token is minted the first time anyone opens
 * this sheet, so a plan nobody has shared has no link to leak.
 */
async function openShare() {
  rememberOpener('menu-app');
  try {
    const { share } = await api.share();
    store.setUi({ openMenu: null, dialog: { type: 'share', share, origin: location.origin } });
  } catch (error) {
    toast(error.message || 'Could not open the shared link.', { tone: 'error' });
  }
}

async function copyShareLink() {
  const field = document.getElementById('share-link-field');
  if (!field) return;
  try {
    await navigator.clipboard.writeText(field.value);
    toast('Link copied');
  } catch {
    // No clipboard permission, or an insecure context. Selecting the text is
    // the fallback every platform still has.
    field.focus();
    field.select();
    toast('Copy the selected link');
  }
}

/**
 * Replacing the link is the only way to revoke it, so it says so first. The
 * old one stops working the moment this returns — including for anyone
 * currently reading the plan through it.
 */
async function rotateShareLink() {
  try {
    const { share } = await api.rotateShare();
    // The sheet's identity is the token it is showing, so replacing the token
    // is what rebuilds it — no separate nudge needed.
    store.setUi({ dialog: { type: 'share', share, origin: location.origin } });
    toast('New link created. The old one no longer works.');
  } catch (error) {
    toast(error.message || 'Could not replace the link.', { tone: 'error' });
  }
}

/**
 * Answering the one question a merge could not answer by itself.
 *
 * The choice is which side wins the disputed field — not which day to keep, so
 * everything already merged stays merged either way. A full copy of the side
 * that loses goes to version history first: the merge only ever drops a value
 * somebody deliberately chose against, and even that is recoverable.
 */
async function resolveConflict(choice) {
  const latest = store.ui.conflict?.latest;
  if (!latest) return;

  const mine = structuredClone(store.plan);
  const merging = Array.isArray(store.ui.dialog?.conflicts) && store.ui.dialog.conflicts.length > 0;
  closeSheet();
  store.setUi({ conflict: null }, { regions: [] });

  const stamp = new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const losing = choice === 'theirs' ? mine : latest.plan;
  const name = choice === 'theirs' ? `My unsaved changes – ${stamp}` : `Other device – ${stamp}`;
  await api.createVersion(name, { auto: true, plan: losing }).catch(() => {
    toast('The other copy could not be saved to version history.', { tone: 'error' });
  });

  if (merging && basePlan) {
    // Re-run the same merge with the answer, rather than applying the choice
    // by a second route that could disagree with the first.
    const { plan } = mergePlans(basePlan, mine, latest.plan, { prefer: choice });
    applyMerge(plan, latest);
    return;
  }

  // No common ancestor: the wholesale question, answered wholesale.
  if (choice === 'theirs') {
    saver.markClean(latest.revision);
    setBase(latest.plan, latest.revision);
    store.setPlan(latest.plan, { revision: latest.revision, updatedAt: latest.updatedAt });
    writeDeviceCopy(latest.plan, { revision: latest.revision, dirty: false });
    return;
  }

  setBase(latest.plan, latest.revision);
  store.setRevision(latest.revision);
  await saver.resume({ revision: latest.revision });
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
  // A toast is chrome, not "outside". Pressing its Undo used to clear the
  // selection as well as undoing — the toolbar vanished from under the thumb
  // that was about to use it again, and the timeline repainted twice for the
  // one change.
  if (store.ui.selectedId && !event.target.closest('.card, dialog, .topbar, .toolbar, .toast')) {
    store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
  }
  if (store.ui.selectedOpenTime && !event.target.closest('.open-time, dialog, .toast')) {
    store.setUi({ selectedOpenTime: null }, { regions: ['timeline'] });
  }
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
    if (store.ui.selectedId && !sheetRoot.querySelector('dialog[open]')) {
      store.setUi({ selectedId: null }, { regions: ['timeline', 'toolbar'] });
    }
    if (store.ui.selectedOpenTime && !sheetRoot.querySelector('dialog[open]')) {
      store.setUi({ selectedOpenTime: null }, { regions: ['timeline'] });
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

  // Same, for an open-time block and its actions sheet.
  const openTime = event.target.closest?.('.open-time');
  if (openTime && (event.key === 'Enter' || event.key === ' ') && event.target === openTime) {
    event.preventDefault();
    const before = openTime.dataset.before;
    // A thin block has no + button and no long-press/double-click either
    // (gestures.js) — Enter follows suit and never opens the sheet on one.
    const thin = openTime.classList.contains('open-time--thin');
    if (!thin && event.key === 'Enter' && store.ui.selectedOpenTime === before) {
      openOpenTimeSheet(before, Number(openTime.dataset.start), Number(openTime.dataset.end));
    } else {
      store.setUi({ selectedOpenTime: before, openMenu: null }, { regions: ['timeline', 'toolbar'] });
    }
  }

  // Every gesture has a keyboard alternative: Alt and the arrows move a card
  // five minutes earlier or later, and the arrows on a focused handle move
  // that edge by the same amount.
  if (card && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    const item = buildSchedule(store.plan).items.find(entry => entry.id === card.dataset.id);
    if (!item || item.locked) return;
    const delta = event.key === 'ArrowUp' ? -5 : 5;
    commit('activity.moveTo', { id: card.dataset.id, start: item.start + delta }, { regions: ['timeline', 'toolbar'] });
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
    // Read the key straight off the handle that was actually used, rather
    // than reconstructing `resize(-top):id` — an open-time block's handles
    // drive the same edge through a second element with its own distinct
    // key (render/timeline.js), and reconstructing would always resolve to
    // whichever of the two happens to come first in the DOM.
    focusByKey(app, handle.getAttribute('data-focus-key'));
  }
});

document.addEventListener('submit', event => {
  // Delegated, so the form comes from the target rather than currentTarget —
  // currentTarget here is the document.
  if (event.target.id === 'login-form') void auth.handleLogin(event, event.target);
});

document.addEventListener('change', event => {
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
  // `summary` is in the list because the summary is not shown on the day
  // (D34) — without it, turning day-of on left the date and the open/conflict
  // links sitting under the strip from the last planning paint.
  store.setUi(changes, { regions: currentChanged ? ['header', 'heading', 'summary', 'strip', 'timeline', 'toolbar'] : ['strip'] });
  // The time line and the live progress bar move on every tick, not only when
  // one activity hands over to the next — without this they stood still for
  // the whole of a two-hour reception while the strip counted down beside
  // them. They are moved in place: repainting the timeline twice a minute
  // would fight whatever is being dragged or read.
  advanceNow(changes.nowMinutes ?? null);
});

const auth = createAuth({ store, saver, flushSave, loadPlan });
const versions = createVersions({
  store,
  saver,
  toast,
  flushSave,
  syncSheet,
  rememberOpener,
  resetDialogKey: () => { currentDialogKey = null; },
  clock
});
const activityForm = createActivityForm({
  store,
  commit,
  closeSheet,
  clock,
  // A picker opens on top of the sheet that owns the field. It goes in the
  // alert root for the same reason the discard question does: that root is
  // already what Escape, the scrim and hardware back look at first, so a
  // picker needs no plumbing of its own to close correctly.
  pickerOptions: { overlayRoot: alertRoot, onOverlayChange: syncOverlayHistory }
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
  store.setUi({ editingOnDay: false, selectedId: null, openMenu: null }, { regions: ['header', 'heading', 'timeline', 'toolbar'] });
}

/**
 * Moves what the clock owns, without a repaint: the time line, its pill, and
 * the bar across the activity happening now.
 */
function advanceNow(nowMinutes) {
  const grid = app.querySelector('.timeline-grid');
  if (!grid) return;

  const line = grid.querySelector('.now-line');
  const pill = grid.querySelector('.now-pill');
  const from = Number(grid.dataset.from);

  if (line && pill && nowMinutes !== null && Number.isFinite(from)) {
    const top = (nowMinutes - from) * PX_PER_MIN;
    line.style.top = `${top}px`;
    pill.style.top = `${top - 11}px`;
    pill.textContent = formatTime(nowMinutes, { meridiem: false });
  }

  const bar = grid.querySelector('.card.is-live .card-progress i');
  const live = bar?.closest('.card');
  if (bar && live && nowMinutes !== null) {
    const start = Number(live.dataset.start);
    const duration = Number(live.dataset.duration);
    if (duration > 0) {
      const done = Math.max(0, Math.min(1, (nowMinutes - start) / duration));
      bar.style.width = `${Math.round(done * 100)}%`;
    }
  }
}

/**
 * The theme is a choice about this device, not about the plan, so it is stored
 * here and never saved. Light is the default and the app does not follow the
 * system setting (D21): a plan read in a dark room at a venue and the same
 * plan on a laptop should look like the same plan.
 */
function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  paintBrowserChrome(next);
  writeTheme(next);
  store.setUi({ theme: next }, { regions: ['header'] });
}

/** Starting from a wedding that already exists, rather than a blank page. */
async function useTemplate() {
  try {
    const { activities } = await api.template();
    const plan = structuredClone(store.plan);
    plan.activities = activities.map((activity, index) => ({ ...activity, id: uid(`t${index}`) }));

    const result = store.dispatch('plan.replaceActivities', { activities: plan.activities });
    if (!result) return;
    saver.markDirty();
    writeDeviceCopy(store.plan, { revision: store.revision, dirty: true });
    toast(`Added ${plan.activities.length} activities`, { action: { label: 'Undo', run: undo } });
  } catch (error) {
    toast(error.message || 'Could not load the template.', { tone: 'error' });
  }
}

const refreshCollapsedTitle = watchCollapsedTitle(app);

watchFit(app);
// The toolbar drops its button labels under 340 px and the layout changes
// outright on rotation, so the furniture is re-read rather than remembered.
window.addEventListener('resize', () => {
  measureBottomFurniture();
  measureStickyInset();
  // Rotation changes both the bar's height and the strip's, and the handover
  // line is measured from the pair of them.
  refreshCollapsedTitle();
});
trackKeyboardInset();
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

// The 60-second interval and the visibility handler can land on the same
// tick — a tab regaining focus just as the timer fires — and without this
// both would open their own request.
let refreshing = false;

async function refreshFromServer() {
  if (refreshing) return;
  if (!store.plan || !store.ui.authenticated) return;
  if (saver.hasPendingChanges || saver.isBlocked || store.ui.dialog) return;

  refreshing = true;
  try {
    const result = await api.load(store.revision);
    if (result.unchanged) return;
    saver.markClean(result.revision);
    setBase(result.plan, result.revision);
    store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
    writeDeviceCopy(result.plan, { revision: result.revision, dirty: false });
  } catch {
    // A failed check is not news. The next one will do.
  } finally {
    refreshing = false;
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
    // Anything handed to the browser on the way out was sent without waiting
    // for an answer, so on the way back this tab does not know whether it
    // landed. Sending it again settles that; the server sorts out the revision.
    if (saver.hasPendingChanges && !saver.isBlocked) void saver.flushNow();
    void refreshFromServer();
    return;
  }
  leftAt = Date.now();
  // Going away: send anything outstanding now rather than hoping the tab
  // survives long enough for the debounce.
  saver.flushOnHide(api.saveOnHide);
});

window.addEventListener('pagehide', () => saver.flushOnHide(api.saveOnHide));

store.subscribe(change => {
  // The top bar carries the day's start and end once the title has collapsed,
  // so every change to the plan's data has to reach it. Adding it here rather
  // than to each caller's region list is deliberate: those lists are about
  // what must not reflow under a moving finger, and a gesture that forgot the
  // bar would leave a stale time sitting at the top of the screen. The bar is
  // a fixed height, so repainting it never moves anything.
  repaint(change.data ? [...change.regions, 'header'] : change.regions);
  syncOverlayHistory();
});

// -------------------------------------------------------------------- boot

async function loadPlan() {
  store.setUi({ loadError: null }, { regions: [] });

  // Read before the load, not after it.
  //
  // This used to write the freshly-loaded plan to the device and then ask the
  // device whether it was holding unsent work — of the record it had just
  // overwritten, with `dirty` set to false by the very line above the question.
  // The answer was always no, so the recovery below could never run, and an
  // edit made offline and then closed was dropped the moment the app reopened
  // with a signal. Nothing said so. §7.2 promises the opposite.
  const pending = readDeviceCopy();
  const ancestor = readDeviceBase();

  try {
    const result = await api.load();
    const unsent = pending?.dirty && pending.plan?.id === result.plan.id ? pending : null;

    store.setUi({ readOnlyCopy: false }, { regions: [] });
    saver.markClean(result.revision);
    setBase(result.plan, result.revision);

    if (!unsent) {
      store.setPlan(result.plan, { revision: result.revision, updatedAt: result.updatedAt });
      writeDeviceCopy(result.plan, { revision: result.revision, dirty: false });
      // The clock's first tick happened before there was a plan to read, and
      // whether the day-of view belongs on is a question about the plan.
      clock.tick();
      return;
    }

    // There is unsent work. If the server is still where it was when that work
    // was made, it is simply pending again. If it has moved on since, this is
    // the same divergence a save conflict is, arriving through a different
    // door — so it is answered the same way, by merging rather than by picking
    // a side.
    if (Number(unsent.revision) === Number(result.revision)) {
      store.setPlan(unsent.plan, { revision: result.revision, updatedAt: result.updatedAt });
      writeDeviceCopy(unsent.plan, { revision: result.revision, dirty: true });
      clock.tick();
      saver.markDirty();
      return;
    }

    const base = ancestor?.plan && Number(ancestor.revision) === Number(unsent.revision)
      ? ancestor.plan
      : null;

    if (!base) {
      // No ancestor for that revision, so there is nothing to measure the two
      // against. The unsent work goes on screen — it is still "mine", exactly
      // as it would be had the collision happened during a save — and the
      // wholesale dialog asks the only question left.
      store.setPlan(unsent.plan, { revision: result.revision, updatedAt: result.updatedAt });
      writeDeviceCopy(unsent.plan, { revision: result.revision, dirty: true });
      clock.tick();
      saver.markDirty();
      store.setUi({ conflict: { latest: result }, dialog: { type: 'conflict', latest: result, conflicts: null } });
      return;
    }

    const { plan, conflicts } = mergePlans(base, unsent.plan, result.plan);
    store.setPlan(plan, { revision: result.revision, updatedAt: result.updatedAt });
    writeDeviceCopy(plan, { revision: result.revision, dirty: true });
    clock.tick();
    saver.markDirty();
    if (conflicts.length) {
      store.setUi({ conflict: { latest: result }, dialog: { type: 'conflict', latest: result, conflicts } });
    } else {
      toast('Your unsent changes were merged with the ones from the other device.');
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
      clock.tick();
      return;
    }
    store.setUi({ loadError: error.message || 'Please try again.' });
  }
}

async function init() {
  const theme = readTheme();
  document.documentElement.dataset.theme = theme;
  paintBrowserChrome(theme);
  store.setUi({ theme }, { regions: [] });

  repaint();
  clock.start();
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
