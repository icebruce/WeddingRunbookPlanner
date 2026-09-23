import { isViewOnly } from '../dayof.js';
import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { SAVE_STATES } from '../save.js';
import { buildSchedule, formatTime } from '../schedule.js';
import { shortPlanDate } from './timeline.js';

const SAVE_LABELS = {
  [SAVE_STATES.saved]: 'Saved',
  [SAVE_STATES.saving]: 'Saving…',
  [SAVE_STATES.offline]: 'Offline',
  [SAVE_STATES.notSaved]: 'Not saved'
};

export function saveIndicator(saveState) {
  const label = SAVE_LABELS[saveState] || SAVE_LABELS[SAVE_STATES.saved];
  // "Not saved" is the only save state the user can do something about, so it
  // is the only one that is a button.
  if (saveState === SAVE_STATES.notSaved) {
    return `<button type="button" class="save-indicator save-indicator--not-saved" data-action="save-retry" data-focus-key="save-retry" aria-label="Not saved. Tap to try again."><span class="save-dot"></span>${label}</button>`;
  }
  return `<span class="save-indicator save-indicator--${saveState}" role="status"><span class="save-dot"></span>${label}</span>`;
}

const MENU_ITEMS = [
  { action: 'day-of', label: 'Day-of view', glyph: 'live', switch: true },
  { action: 'theme', label: 'Dark appearance', glyph: 'moon', switch: true },
  { action: 'share', label: 'Share read-only link', glyph: 'link', group: true },
  { action: 'print', label: 'Print or save PDF', glyph: 'print' },
  { action: 'export', label: 'Export backup', glyph: 'download' },
  { action: 'versions', label: 'Version history', glyph: 'history' },
  { action: 'settings', label: 'Plan settings', glyph: 'settings' },
  { action: 'logout', label: 'Sign out', glyph: 'logout', group: true }
];

function menuRow(item, ui) {
  const on = item.action === 'day-of' ? Boolean(ui.dayOf) : item.action === 'theme' ? ui.theme === 'dark' : false;
  const trailing = item.switch ? `<span class="menu-switch ${on ? '' : 'is-off'}"></span>` : '';

  return `<button type="button" role="menuitem" class="${item.group ? 'is-grouped' : ''}"
    data-action="menu-action" data-menu-action="${item.action}" ${item.switch ? `aria-pressed="${on}"` : ''}>
    ${icon(item.glyph)}<span>${escapeHtml(item.label)}</span>${trailing}</button>`;
}

/**
 * Plan settings is left out in view only: commit refuses there, so its Done
 * closed the sheet and dropped the change without a word.
 */
function menuItems(ui) {
  return isViewOnly(ui) ? MENU_ITEMS.filter(item => item.action !== 'settings') : MENU_ITEMS;
}

function appMenu(open, ui) {
  // A <details> element cannot be closed from the outside, which is why Escape
  // and a click elsewhere used to leave the menu open (F26). A plain button
  // plus state can be closed by anything.
  return `<div class="app-menu ${open ? 'is-open' : ''}">
    <button type="button" class="icon-button icon-button--outlined" data-action="menu" data-menu="app" data-focus-key="menu-app" aria-label="Open menu" aria-haspopup="menu" aria-expanded="${open}">${icon('menu')}</button>
    ${open ? `<div class="menu-popover" role="menu">
      ${menuItems(ui).map(item => menuRow(item, ui)).join('')}
    </div>` : ''}
  </div>`;
}

/**
 * On the day the top bar changes job. It stops offering the controls for
 * building a plan and says which mode you are in: reading it, or — having
 * deliberately said so — editing it while it runs.
 */
function dayOfControls(ui) {
  if (ui.editingOnDay) {
    return `<span class="mode-pill mode-pill--editing"><i></i>Editing</span>
      <button type="button" class="button button--text" data-action="day-of-done" data-focus-key="day-of-done">Done</button>`;
  }
  return `<span class="mode-pill mode-pill--view">${icon('lock')}View only</span>
    <button type="button" class="button button--text" data-action="day-of-edit" data-focus-key="day-of-edit">Edit</button>`;
}

/**
 * Once the large title has scrolled away the top bar takes it over, so that
 * "which day is this?" is answerable from anywhere in a long plan.
 *
 * It carries the day's span rather than its date. By the time the title has
 * collapsed the date is a given — it was on screen a moment ago and it never
 * changes — whereas the span moves every time the first or last activity does,
 * which makes it the half of "when" worth keeping in view. A plan with nothing
 * in it has no span yet, so it falls back to the date.
 *
 * On the day there is no large title to take over from (D34): the strip is the
 * day's header and the page below it is the plan itself, so this is shown
 * outright and is the page's own `h1` rather than a copy of one — which is why
 * it is not hidden from a screen reader there. The span is desktop-only in that
 * mode: on a phone the bar is also carrying the mode pill and Edit, and one
 * line of title is what is left over.
 */
function collapsedTitle(plan, dayOf) {
  const { summary } = buildSchedule(plan);
  const detail = summary.count
    ? `${formatTime(summary.start)} – ${formatTime(summary.end)}`
    : shortPlanDate(plan.date);
  const body = `<b>${escapeHtml(plan.title)}</b><small>${escapeHtml(detail)}</small>`;
  if (dayOf) return `<h1 class="collapsed-title collapsed-title--static">${body}</h1>`;
  return `<span class="collapsed-title" aria-hidden="true">${body}</span>`;
}

export function renderHeader({ plan, ui }) {
  // Empty at rest while the plan is being built. The large title sits
  // immediately below the bar, and naming the plan directly above its own title
  // said the same thing twice — so the cell holds nothing until the title
  // scrolls away and takes its place. On the day there is no title below to
  // duplicate, so the cell carries it from the start. The planner name is still
  // on the sign-in screen, the print header and in Plan settings, which is
  // where it is asked for rather than merely seen.
  const title = `<div class="topbar-title">${collapsedTitle(plan, Boolean(ui.dayOf))}</div>`;

  if (ui.dayOf) {
    return `${title}<div class="topbar-actions">${dayOfControls(ui)}${appMenu(ui.openMenu === 'app', ui)}</div>`;
  }

  return `${title}
    <div class="topbar-actions">
      ${saveIndicator(ui.saveState)}
      ${appMenu(ui.openMenu === 'app', ui)}
    </div>`;
}

/*
 * The "changed on another device" banner used to live here. It is a dialog
 * now: the choice decides which copy the day carries on from, and that is not
 * something to leave sitting at the top of the page while editing continues.
 */
