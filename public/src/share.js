/**
 * The plan, read through a share link.
 *
 * A separate page rather than a mode of the planner, and that is the point.
 * Read-only here is not a flag the editor checks before each action — it is
 * that none of the editing exists on this page at all: no gestures module, no
 * toolbar, no store, no save pipeline, and a token that the only endpoint
 * accepting it answers with a plan and nothing else.
 *
 * The token lives in the URL fragment. Browsers never send a fragment to a
 * server, so the one credential a vendor is holding stays out of request logs
 * and out of any `Referer` — it is read here and handed over in a header.
 */
import { escapeHtml, measureTopbarHeight, paint, watchCollapsedTitle } from './dom.js';
import { icon } from './icons.js';
import { createClock, minutesNow, shouldBeOn, stripState } from './dayof.js';
import { fitCards, watchFit } from './render/fit.js';
import { renderFilterBar, renderFilters } from './render/filters.js';
import { renderPrint } from './render/print.js';
import { renderStrip } from './render/strip.js';
import { renderHeading, renderSummary, renderTimeline } from './render/timeline.js';
import { buildSchedule, formatTime } from './schedule.js';
import { readTheme, writeTheme } from './theme.js';

const app = document.getElementById('app');

const SHELL = `
  <header class="topbar" data-region="header"></header>
  <div data-region="strip"></div>
  <div data-region="filterbar"></div>
  <main id="main-plan" class="planner">
    <section class="planner-heading" data-region="heading"></section>
    <section data-region="summary"></section>
    <section data-region="filters"></section>
    <section class="timeline" aria-label="Wedding day timeline" data-region="timeline"></section>
  </main>
  <div data-region="print" aria-hidden="true"></div>`;

/**
 * Everything the renderers ask of a UI state. `viewOnly` is fixed on: there is
 * no Edit here to turn it off, which is what makes every card, open-time block
 * and toolbar draw without a single control.
 */
const ui = {
  viewOnly: true,
  dayOf: false,
  editingOnDay: false,
  selectedId: null,
  groupSelection: [],
  selectedOpenTime: null,
  openMenu: null,
  dialog: null,
  filter: null,
  preview: null,
  strip: null,
  theme: 'light'
};

let plan = null;

function tokenFromUrl() {
  const raw = location.hash.replace(/^#/, '').trim();
  return raw ? decodeURIComponent(raw) : '';
}

function renderHeader() {
  if (!plan) return '';
  const { summary } = buildSchedule(plan);
  const span = summary.count ? `${formatTime(summary.start)} – ${formatTime(summary.end)}` : '';

  return `<div class="topbar-title">
      <span class="collapsed-title" aria-hidden="true"><b>${escapeHtml(plan.title)}</b><small>${escapeHtml(span)}</small></span>
    </div>
    <div class="topbar-actions">
      <span class="mode-pill mode-pill--view">${icon('lock')}View only</span>
      <button type="button" class="icon-button icon-button--outlined" data-action="theme" aria-label="Dark appearance" aria-pressed="${ui.theme === 'dark'}">${icon('moon')}</button>
      <button type="button" class="icon-button icon-button--outlined" data-action="print" aria-label="Print or save PDF">${icon('print')}</button>
    </div>`;
}

const REGIONS = {
  header: renderHeader,
  strip: () => renderStrip({ ui, strip: ui.strip }),
  heading: () => renderHeading({ plan, ui }),
  summary: () => renderSummary({ plan, ui }),
  filters: () => renderFilters({ plan, ui }),
  filterbar: () => renderFilterBar({ plan, ui }),
  timeline: () => renderTimeline({ plan, ui }),
  print: () => renderPrint({ plan, ui })
};

const refreshCollapsedTitle = watchCollapsedTitle(app);

function repaint(names = Object.keys(REGIONS)) {
  for (const name of names) {
    const region = app.querySelector(`[data-region="${name}"]`);
    if (region) paint(region, REGIONS[name]());
  }
  // A card too short for every row drops them by priority, which is measured
  // rather than guessed — the same pass the planner runs, for the same reason.
  fitCards(app);
  // The strip sticks to the bar's underside on this page as well, and the
  // token it reads is only a floor — so the bar is measured here too.
  measureTopbarHeight(app);
  refreshCollapsedTitle();
}

/**
 * Whether the live strip belongs on screen, asked of the venue's clock.
 *
 * This is the whole of it: the plan's date against today where the wedding is.
 * A link opened three weeks early is a plan to read, so there is nothing live
 * to say about it; the same link on the day answers "what is happening now"
 * without the reader doing anything at all. And because the date is read at the
 * venue, it says the same thing to someone reading it from another country.
 */
function tick() {
  if (!plan) return;
  const live = shouldBeOn(plan);
  const next = live ? stripState(plan, new Date()) : null;
  const changed = live !== ui.dayOf || Boolean(next) !== Boolean(ui.strip)
    || next?.headline !== ui.strip?.headline || next?.detail !== ui.strip?.detail
    || next?.progress !== ui.strip?.progress;

  ui.dayOf = live;
  ui.strip = next;
  // `nowMinutes` is what draws the moving line across the timeline.
  ui.nowMinutes = live ? minutesNow(plan) : null;
  if (changed) repaint(['strip', 'timeline', 'header']);
}

const clock = createClock(tick);

function setTheme(theme) {
  ui.theme = theme;
  document.documentElement.dataset.theme = theme;
  writeTheme(theme);
  repaint(['header']);
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;

  if (control.dataset.action === 'print') return window.print();
  if (control.dataset.action === 'theme') return setTheme(ui.theme === 'dark' ? 'light' : 'dark');

  // The only other control on the page is a filter chip.
  if (control.dataset.action === 'filter') {
    const person = control.dataset.person || null;
    ui.filter = person === ui.filter ? null : person;
    repaint(['filters', 'filterbar', 'timeline', 'summary', 'print']);
  }
});

function fatal(message) {
  app.innerHTML = `<div class="fatal-view" role="alert">
    <h1>Wedding Day</h1>
    <p>${escapeHtml(message)}</p>
  </div>`;
}

/** The current link's token. Re-read whenever the fragment changes. */
let token = '';

function fetchPlan() {
  return fetch('/api/shared', { headers: { 'X-Share-Token': token }, cache: 'no-store' });
}

async function load() {
  token = tokenFromUrl();
  if (!token) {
    fatal('This link is incomplete. Ask the couple to send it again.');
    return;
  }

  let response;
  try {
    response = await fetchPlan();
  } catch {
    fatal("Can't reach the plan right now. Try again in a moment.");
    return;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    fatal(body?.error?.message || 'This link is no longer available.');
    return;
  }

  const body = await response.json();
  plan = body.plan;
  document.title = plan.title || 'Wedding Day';

  app.innerHTML = SHELL;
  watchFit(app);
  tick();
  repaint();
  clock.start();
}

/**
 * The plan goes on being edited while it is being read. Picking changes up on
 * return costs one request and saves a vendor reading yesterday's times off a
 * page they left open in a pocket.
 */
async function refresh() {
  if (!plan || !token) return;
  try {
    const response = await fetchPlan();
    if (!response.ok) return;
    const body = await response.json();
    if (JSON.stringify(body.plan) === JSON.stringify(plan)) return;
    plan = body.plan;
    tick();
    repaint();
  } catch {
    // A failed check is not news. The next one will do.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
});

setInterval(() => {
  if (document.visibilityState === 'visible') void refresh();
}, 60_000);

/**
 * A replacement link differs from the one it replaces only in the fragment,
 * and a browser handed a URL that differs only there does not reload — it
 * changes the hash and nothing else. Without this, someone sent a new link
 * while holding the old one open taps it and watches the "no longer
 * available" page not go away.
 */
window.addEventListener('hashchange', () => {
  if (tokenFromUrl() === token) return;
  plan = null;
  clock.stop();
  void load();
});

const theme = readTheme();
document.documentElement.dataset.theme = theme;
ui.theme = theme;
void load();
