import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES } from '../config.js';
import { formatDuration } from '../schedule.js';

const stageMap = new Map(STAGES.map(stage => [stage.id, stage]));

export function stageOf(id) {
  return stageMap.get(id) || STAGES[0];
}

export function stagePill(stage, { interactive = false, expanded = false, id = '' } = {}) {
  const content = `${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span>${interactive ? icon('chevron') : ''}`;
  if (!interactive) {
    return `<span class="stage-pill" style="--stage-color:${stage.color};--stage-tint:${stage.tint}">${content}</span>`;
  }
  return `<button class="stage-pill stage-pill--button" type="button" style="--stage-color:${stage.color};--stage-tint:${stage.tint}"
    data-action="menu" data-menu="stage:${escapeHtml(id)}" data-focus-key="stage:${escapeHtml(id)}"
    aria-haspopup="menu" aria-expanded="${expanded}" aria-label="Change stage of this activity">${content}</button>`;
}

/**
 * People are shown by name. Initials were unreadable and told the reader
 * nothing they could act on, so a name either fits in full or is counted in
 * the "+N" tag (D25).
 */
export function peopleSummary(people, { max = 5 } = {}) {
  const values = (people || []).filter(Boolean);
  if (!values.length) return '<span class="people-empty">No people assigned</span>';
  const shown = values.slice(0, max);
  const hidden = values.length - shown.length;
  const tags = shown.map(person => `<span class="person-display-tag">${escapeHtml(person)}</span>`).join('');
  const more = hidden > 0 ? `<span class="person-display-tag person-display-tag--count">+${hidden}</span>` : '';
  return `<span class="people-summary" title="${escapeHtml(values.join(', '))}">${tags}${more}</span>`;
}

function stageMenu(item, openMenu) {
  if (openMenu !== `stage:${item.id}`) return '';
  return `<div class="stage-menu" role="menu" aria-label="Change stage">
    ${STAGES.map(stage => `<button type="button" role="menuitemradio" aria-checked="${stage.id === item.stage}"
      class="stage-menu-option ${stage.id === item.stage ? 'is-current' : ''}"
      data-action="set-stage" data-id="${escapeHtml(item.id)}" data-stage="${stage.id}"
      style="--stage-color:${stage.color};--stage-tint:${stage.tint}">${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span></button>`).join('')}
  </div>`;
}

function cardMenu(item, openMenu) {
  if (openMenu !== `card-menu:${item.id}`) return '';
  return `<div class="card-menu" role="menu">
    <button type="button" role="menuitem" data-action="edit" data-id="${escapeHtml(item.id)}">${icon('settings')}<span>Edit activity</span></button>
    <button type="button" role="menuitem" data-action="delete" data-id="${escapeHtml(item.id)}">${icon('trash')}<span>Delete</span></button>
  </div>`;
}

export function renderCard(item, { index, visual, ui }) {
  const stage = stageOf(item.stage);
  const conflict = item.conflictMinutes > 0;
  const selected = ui.selectedId === item.id;
  const stageOpen = ui.openMenu === `stage:${item.id}`;
  const menuOpen = ui.openMenu === `card-menu:${item.id}`;
  const id = escapeHtml(item.id);
  const title = escapeHtml(item.title);

  return `
    <div class="activity-row ${visual.offset > 1 ? 'activity-row--shifted' : ''} ${conflict ? 'activity-row--conflict' : ''} ${(stageOpen || menuOpen) ? 'activity-row--menu-open' : ''}"
      data-activity-id="${id}" data-index="${index}" data-anchor-top="${visual.anchorTop.toFixed(1)}"
      style="--row-top:${visual.top.toFixed(1)}px;--row-height:${visual.height.toFixed(1)}px;--stage-color:${stage.color};--stage-tint:${stage.tint}">
      <article class="activity-card ${item.duration < 30 ? 'activity-card--compact' : ''} ${selected ? 'is-selected' : ''} ${conflict ? 'activity-card--conflict' : ''}"
        tabindex="0" data-action="select" data-id="${id}" data-focus-key="card:${id}"
        aria-label="${title}, ${escapeHtml(item.startLabel)} to ${escapeHtml(item.endLabel)}, ${escapeHtml(formatDuration(item.duration))}, ${escapeHtml(stage.label)}${item.isLocked ? ', fixed' : ''}">
        <button class="drag-handle" type="button" data-role="reorder" data-id="${id}" data-focus-key="reorder:${id}"
          aria-label="Reorder ${title}" title="Drag to reorder. Alt + arrow keys also work." ${item.isLocked ? 'disabled' : ''}>
          <span class="drag-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
        </button>
        <span class="accent-rule" aria-hidden="true"></span>
        <div class="card-time">
          <span class="card-time-range">${escapeHtml(item.startLabel)} – ${escapeHtml(item.endLabel)}</span>
          <strong>${escapeHtml(formatDuration(item.duration))}</strong>
        </div>
        <div class="card-stage stage-control">
          ${stagePill(stage, { interactive: true, expanded: stageOpen, id: item.id })}
          ${stageMenu(item, ui.openMenu)}
        </div>
        <div class="card-main">
          <div class="card-heading">
            <h2>${title}</h2>
            <div class="card-actions">
              <button class="lock-button ${item.isLocked ? 'is-locked' : ''}" type="button"
                data-action="lock" data-id="${id}" data-focus-key="lock:${id}"
                aria-pressed="${item.isLocked}"
                aria-label="${item.isLocked ? `Unfix ${title} from ${escapeHtml(item.startLabel)}` : `Fix ${title} at ${escapeHtml(item.startLabel)}`}">${icon('lock')}</button>
              <div class="card-menu-wrap">
                <button class="icon-button card-menu-toggle ${menuOpen ? 'is-active' : ''}" type="button"
                  data-action="menu" data-menu="card-menu:${id}" data-focus-key="card-menu:${id}"
                  aria-label="More options for ${title}" aria-haspopup="menu" aria-expanded="${menuOpen}">${icon('more')}</button>
                ${cardMenu(item, ui.openMenu)}
              </div>
            </div>
          </div>
          <div class="card-meta">
            <span>${icon('pin')}${escapeHtml(item.location || 'Location not set')}</span>
            <span class="card-people">${peopleSummary(item.people)}</span>
          </div>
        </div>
        ${conflict ? `<div class="card-conflict-note">${icon('warning')}<span>${escapeHtml(formatDuration(item.conflictMinutes))} overlap with previous activity</span></div>` : ''}
        <button class="resize-handle" type="button" data-role="resize" data-id="${id}" data-focus-key="resize:${id}"
          aria-label="Resize ${title}" title="Drag to change duration"><span></span></button>
      </article>
    </div>`;
}
