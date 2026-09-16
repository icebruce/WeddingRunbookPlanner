/**
 * The phone selection toolbar replaces the floating + button while a card is
 * selected. Its buttons are wired in the editing stage; for now the region
 * renders the floating + only, which is what the current build has.
 */
import { icon } from '../icons.js';

export function renderToolbar() {
  return `<button class="mobile-add" type="button" data-action="add" data-focus-key="add-mobile" aria-label="Add activity">${icon('plus')}</button>`;
}
