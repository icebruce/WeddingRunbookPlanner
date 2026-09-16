import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES } from '../config.js';
import { formatDuration, formatTime } from '../schedule.js';
import { laneStyle } from '../layout.js';

const stageMap = new Map(STAGES.map(stage => [stage.id, stage]));

export function stageOf(id) {
  return stageMap.get(id) || STAGES[0];
}

export function stagePill(stage, { interactive = false, expanded = false, id = '' } = {}) {
  const content = `${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span>`;
  if (!interactive) {
    return `<span class="stage-tag" style="--phase:${stage.color}">${content}</span>`;
  }
  return `<button class="stage-tag stage-tag--button" type="button" style="--phase:${stage.color}"
    data-action="menu" data-menu="stage:${escapeHtml(id)}" data-focus-key="stage:${escapeHtml(id)}"
    aria-haspopup="menu" aria-expanded="${expanded}" aria-label="Change stage">${content}${icon('chevron')}</button>`;
}

/**
 * People are shown by name. Names that do not fit are counted in a "+N" tag
 * rather than shrunk to initials, which told the reader nothing they could act
 * on (D25). Which names fit is decided by measuring — see fit.js.
 */
export function peopleTags(people) {
  const values = (people || []).filter(Boolean);
  if (!values.length) return '';
  return values.map(person => `<span class="tag">${escapeHtml(person)}</span>`).join('');
}

/**
 * Card menus are drawn in a layer above the timeline, not inside the card.
 * A card is clipped to its own height — which is its duration — so a menu
 * rendered inside a fifteen-minute card would be invisible.
 */
export function renderCardMenu(item, kind) {
  if (kind === 'stage') return stageMenu(item);
  if (kind === 'card-menu') return cardMenu(item);
  return '';
}

function stageMenu(item) {
  return `<div class="stage-menu" role="menu" aria-label="Change stage">
    ${STAGES.map(stage => `<button type="button" role="menuitemradio" aria-checked="${stage.id === item.stage}"
      class="stage-menu-option ${stage.id === item.stage ? 'is-current' : ''}"
      data-action="set-stage" data-id="${escapeHtml(item.id)}" data-stage="${stage.id}"
      style="--phase:${stage.color}">${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span></button>`).join('')}
  </div>`;
}

function cardMenu(item) {
  return `<div class="card-menu" role="menu">
    <button type="button" role="menuitem" data-action="edit" data-id="${escapeHtml(item.id)}">${icon('settings')}<span>Edit activity</span></button>
    <button type="button" role="menuitem" data-action="duplicate" data-id="${escapeHtml(item.id)}">${icon('save')}<span>Duplicate</span></button>
    <button type="button" role="menuitem" class="is-danger" data-action="delete" data-id="${escapeHtml(item.id)}">${icon('trash')}<span>Delete</span></button>
  </div>`;
}

/** The warning line. It is never dropped: it is the reason to look at the card. */
function warning(item) {
  if (item.overrun) {
    const text = item.duration < 20
      ? `${item.overrun.minutes} min over`
      : `Runs ${item.overrun.minutes} min into ${item.overrun.intoTitle}`;
    return `<div class="card-row card-warn">${icon('warning')}<span>${escapeHtml(text)}</span></div>`;
  }
  if (item.conflictMinutes) {
    return `<div class="card-row card-warn">${icon('warning')}<span>Fixed · ${item.conflictMinutes} min overlap</span></div>`;
  }
  return '';
}

function glyphs(item) {
  const out = [];
  if (item.isFixed) out.push(`<span class="glyph glyph--fixed" role="img" aria-label="Fixed time">${icon('lock')}</span>`);
  if (item.notes) out.push(`<span class="glyph glyph--note" role="img" aria-label="Has notes">${icon('note')}</span>`);
  return out.join('');
}

/** What a screen reader hears instead of the visual arrangement. */
function accessibleName(item, stage) {
  const parts = [
    item.title,
    `${formatTime(item.start)} to ${formatTime(item.end)}`,
    formatDuration(item.duration),
    stage.label
  ];
  if (item.isFixed) parts.push('fixed');
  if (item.overrun) parts.push(`runs ${item.overrun.minutes} minutes into ${item.overrun.intoTitle}`);
  if (item.conflictMinutes) parts.push(`${item.conflictMinutes} minute overlap`);
  if (item.location) parts.push(item.location);
  if (item.people?.length) parts.push(item.people.join(', '));
  return parts.join(', ');
}

export function renderCard(card, { ui, filter = null, nowMinutes = null }) {
  const { item } = card;
  const stage = stageOf(item.stage);
  const selected = ui.selectedId === item.id;
  const stageOpen = ui.openMenu === `stage:${item.id}`;
  const menuOpen = ui.openMenu === `card-menu:${item.id}`;
  const id = escapeHtml(item.id);
  const title = escapeHtml(item.title);
  const narrow = card.lane !== null;
  const faded = filter && !(item.people || []).includes(filter);

  // On the day a card is one of three things, and it says which.
  const dayState = nowMinutes === null
    ? null
    : (item.end <= nowMinutes ? 'past' : item.start <= nowMinutes ? 'live' : 'ahead');
  const live = dayState === 'live';
  const progress = live ? (nowMinutes - item.start) / item.duration : 0;
  // Nothing on a card is a control until Edit has been pressed. The solid
  // lock on a fixed activity stays, because it is information, not a button.
  const viewOnly = Boolean(ui.dayOf && !ui.editingOnDay);

  const classes = [
    'card',
    `card--${card.density}`,
    narrow && 'card--narrow',
    dayState === 'past' && 'is-past',
    live && 'is-live',
    selected && 'is-selected',
    item.overrun && 'is-overrun',
    item.conflictMinutes && 'is-conflicted',
    faded && 'is-faded',
    (stageOpen || menuOpen) && 'is-menu-open'
  ].filter(Boolean).join(' ');

  // A five- or ten-minute card is 20–40 px tall. Anything but one line would
  // not fit, so it is built as one line rather than measured down to one.
  const body = card.density === 'line'
    ? `<span class="card-title">${title}</span>${glyphs(item)}<span class="card-line-time">${escapeHtml(formatTime(item.start))}</span>`
    : `<div class="card-row card-title-row"><span class="card-title">${title}</span>${glyphs(item)}${live ? '<span class="now-tag"><i></i>Now</span>' : ''}</div>
       <div class="card-row card-time" data-drop="4"><span>${escapeHtml(narrow ? formatTime(item.start) : item.rangeLabel)}</span><strong>${escapeHtml(formatDuration(item.duration))}</strong></div>
       ${warning(item)}
       ${live ? `<div class="card-row card-progress" data-drop="3" aria-hidden="true"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ''}
       <div class="card-row card-location" data-drop="2">${icon('pin')}<span>${escapeHtml(item.location || '')}</span></div>
       ${narrow ? '' : `<div class="card-row card-stage" data-drop="1">${stagePill(stage, { interactive: true, expanded: stageOpen, id: item.id })}</div>`}
       ${narrow ? '' : `<div class="card-row card-people" data-drop="0">${peopleTags(item.people)}</div>`}`;

  return `<article class="${classes}" data-activity-id="${id}" data-index="${item.index}"
    data-start="${item.start}" data-end="${item.end}" data-duration="${item.duration}"
    style="top:${card.top}px;height:${card.height}px;--phase:${stage.color};--phase-tint:${stage.tint};${laneStyle(card.lane)}${card.overrunHeight ? `--overrun-height:${card.overrunHeight}px;` : ''}"
    tabindex="0" data-action="select" data-id="${id}" data-focus-key="card:${id}"
    aria-label="${escapeHtml(accessibleName(item, stage))}">
    <span class="card-rule" aria-hidden="true"></span>
    ${item.isFixed || viewOnly ? '' : `<span class="card-grip" data-role="reorder" data-id="${id}" aria-hidden="true">${icon('grip')}</span>`}
    <div class="card-body">${body}</div>
    <span class="card-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    ${viewOnly ? '' : `<div class="card-controls">
      <button class="lock-button ${item.isFixed ? 'is-fixed' : ''}" type="button"
        data-action="lock" data-id="${id}" data-focus-key="lock:${id}" aria-pressed="${item.isFixed}"
        aria-label="${item.isFixed ? `Unfix ${title} from ${escapeHtml(item.startLabel)}` : `Fix ${title} at ${escapeHtml(item.startLabel)}`}">${icon(item.isFixed ? 'lock' : 'lock-open')}</button>
      <button class="icon-button card-menu-toggle" type="button"
        data-action="menu" data-menu="card-menu:${id}" data-focus-key="card-menu:${id}"
        aria-label="More options for ${title}" aria-haspopup="menu" aria-expanded="${menuOpen}">${icon('more')}</button>
    </div>`}
    <!-- Handles exist only on the selected card, and the top one only where
         there is a start to move: a fixed activity has none. They are real
         buttons so the arrow keys can move an edge without a pointer. -->
    ${selected && !item.isFixed && !viewOnly ? `<button type="button" class="handle handle--top" data-role="resize-top" data-id="${id}" data-focus-key="resize-top:${id}" aria-label="Move the start of ${title}"></button>` : ''}
    ${selected && !viewOnly ? `<button type="button" class="handle handle--bottom" data-role="resize" data-id="${id}" data-focus-key="resize:${id}" aria-label="Move the end of ${title}"></button>
      <button type="button" class="card-reorder" data-role="reorder" data-id="${id}" data-focus-key="reorder:${id}" aria-label="Move ${title}">${icon('reorder')}</button>` : ''}
  </article>`;
}
