/**
 * The phone's selection toolbar (D2).
 *
 * Selecting a card replaces the floating + with a toolbar that says what is
 * selected, lists anything the card had to hide, and offers the five things you
 * can do to it. This is why a card can be quiet: the controls are not on every
 * card, and the details a short card dropped are not lost — they are here.
 */
import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { buildSchedule } from '../schedule.js';
import { isViewOnly } from '../dayof.js';

const BUTTONS = [
  { action: 'edit', label: 'Edit', glyph: 'settings' },
  { action: 'lock', label: null, glyph: null },
  { action: 'menu', label: 'Stage', glyph: 'swatch' },
  { action: 'duplicate', label: 'Duplicate', glyph: 'copy' },
  { action: 'delete', label: 'Delete', glyph: 'trash', danger: true }
];

const addButton = `<button class="mobile-add" type="button" data-action="add" data-focus-key="add-mobile" aria-label="Add activity">${icon('plus')}</button>`;

function editingButtons(item, id) {
  return BUTTONS.map(button => {
    if (button.action === 'lock') {
      return `<button type="button" class="toolbar-button" data-action="lock" data-id="${id}" data-focus-key="toolbar-lock">
        ${icon(item.locked ? 'lock' : 'lock-open')}<span>${item.locked ? 'Unlock' : 'Lock'}</span></button>`;
    }
    if (button.action === 'menu') {
      return `<button type="button" class="toolbar-button" data-action="menu" data-menu="stage:${id}" data-focus-key="toolbar-stage" aria-haspopup="menu">
        ${icon(button.glyph)}<span>${button.label}</span></button>`;
    }
    return `<button type="button" class="toolbar-button ${button.danger ? 'toolbar-button--danger' : ''}"
      data-action="${button.action}" data-id="${id}" data-focus-key="toolbar-${button.action}">
      ${icon(button.glyph)}<span>${button.label}</span></button>`;
  }).join('');
}

/**
 * On the day, until Edit is pressed, the only thing a selected card offers is
 * the way into editing — and the + is not offered at all, because adding an
 * activity is as much an edit as moving one.
 */
function viewOnlyButton() {
  return `<button type="button" class="toolbar-button" data-action="day-of-edit" data-focus-key="toolbar-edit">
    ${icon('settings')}<span>Edit</span></button>`;
}

export function renderToolbar({ plan, ui, hiddenDetails = '' }) {
  const viewOnly = isViewOnly(ui);
  const item = ui.selectedId ? buildSchedule(plan).items.find(entry => entry.id === ui.selectedId) : null;
  if (!item) return viewOnly ? '' : addButton;

  const id = escapeHtml(item.id);
  return `<div class="toolbar ${viewOnly ? 'toolbar--view-only' : ''}" role="group" aria-label="Selected activity">
    <div class="toolbar-context">
      <span><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.rangeLabel)}</span>
      ${hiddenDetails ? `<span class="toolbar-hidden">${escapeHtml(hiddenDetails)}</span>` : ''}
    </div>
    <div class="toolbar-buttons">${viewOnly ? viewOnlyButton() : editingButtons(item, id)}</div>
  </div>`;
}
