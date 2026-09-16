import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { PLAN_STATUSES } from '../config.js';
import { SAVE_STATES } from '../save.js';

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

function statusControl(plan) {
  return `<label class="status-control">
    <span class="sr-only">Plan status</span>
    <span class="status-dot" aria-hidden="true"></span>
    <select data-action="status" data-focus-key="status" aria-label="Plan status">
      ${PLAN_STATUSES.map(status => `<option ${status === plan.status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
    </select>
    ${icon('chevron')}
  </label>`;
}

function appMenu(open) {
  // A <details> element cannot be closed from the outside, which is why Escape
  // and a click elsewhere used to leave the menu open (F26). A plain button
  // plus state can be closed by anything.
  return `<div class="app-menu ${open ? 'is-open' : ''}">
    <button type="button" class="icon-button icon-button--outlined" data-action="menu" data-menu="app" data-focus-key="menu-app" aria-label="Open menu" aria-haspopup="menu" aria-expanded="${open}">${icon('menu')}</button>
    ${open ? `<div class="menu-popover" role="menu">
      <button type="button" role="menuitem" data-action="menu-action" data-menu-action="versions">${icon('history')}<span>Version history</span></button>
      <button type="button" role="menuitem" data-action="menu-action" data-menu-action="settings">${icon('settings')}<span>Plan settings</span></button>
      <div class="menu-divider"></div>
      <button type="button" role="menuitem" data-action="menu-action" data-menu-action="logout">${icon('logout')}<span>Sign out</span></button>
    </div>` : ''}
  </div>`;
}

export function renderHeader({ plan, ui }) {
  return `
    <a href="#main-plan" class="brand" aria-label="${escapeHtml(plan.coupleLabel || 'Our Wedding')} planner">${icon('heart')}<span>${escapeHtml(plan.coupleLabel || 'Our Wedding')}</span></a>
    <div class="topbar-actions">
      ${saveIndicator(ui.saveState)}
      ${statusControl(plan)}
      ${appMenu(ui.openMenu === 'app')}
    </div>`;
}

export function renderConflict({ ui }) {
  if (!ui.conflict) return '';
  return `<div class="conflict-banner" role="alert">
    <div>${icon('warning')}<span><strong>Changed on another device.</strong> Choose which copy to keep.</span></div>
    <div class="conflict-actions">
      <button class="button button--quiet" type="button" data-action="conflict" data-choice="remote">Use the other version</button>
      <button class="button button--primary" type="button" data-action="conflict" data-choice="local">Keep my changes</button>
    </div>
  </div>`;
}
