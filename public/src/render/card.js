import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES, phaseVars } from '../config.js';
import { formatDuration, formatTime } from '../schedule.js';
import { laneStyle } from '../layout.js';

const stageMap = new Map(STAGES.map(stage => [stage.id, stage]));

export function stageOf(id) {
  return stageMap.get(id) || STAGES[0];
}

export function stagePill(stage, { interactive = false, expanded = false, id = '' } = {}) {
  const content = `${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span>`;
  if (!interactive) {
    return `<span class="stage-tag" style="${phaseVars(stage)}">${content}</span>`;
  }
  return `<button class="stage-tag stage-tag--button" type="button" style="${phaseVars(stage)}"
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
 * The stage-change menu, drawn in a layer above the timeline, not inside the
 * card. A card is clipped to its own height — which is its duration — so a
 * menu rendered inside a fifteen-minute card would be invisible.
 */
export function renderCardMenu(item) {
  return `<div class="stage-menu" role="menu" aria-label="Change stage">
    ${STAGES.map(stage => `<button type="button" role="menuitemradio" aria-checked="${stage.id === item.stage}"
      class="stage-menu-option ${stage.id === item.stage ? 'is-current' : ''}"
      data-action="set-stage" data-id="${escapeHtml(item.id)}" data-stage="${stage.id}"
      style="${phaseVars(stage)}">${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span></button>`).join('')}
  </div>`;
}

/** The warning line. It is never dropped: it is the reason to look at the card. */
function warning(item) {
  if (!item.overlaps?.length) return '';
  const text = item.overlaps.length === 1
    ? `Overlaps ${item.overlaps[0].minutes} min with ${item.overlaps[0].withTitle}`
    : `Overlaps ${item.overlapMinutes} min with ${item.overlaps.length} activities`;
  return `<div class="card-row card-warn">${icon('warning')}<span>${escapeHtml(text)}</span></div>`;
}

function glyphs(item) {
  return item.notes ? `<span class="glyph glyph--note" role="img" aria-label="Has notes" title="${escapeHtml(item.notes)}">${icon('note')}</span>` : '';
}

/** What a screen reader hears instead of the visual arrangement. */
function accessibleName(item, stage) {
  const parts = [
    item.title,
    `${formatTime(item.start)} to ${formatTime(item.end)}`,
    formatDuration(item.duration),
    stage.label
  ];
  if (item.locked) parts.push('locked');
  if (item.overlaps?.length) parts.push(`overlaps ${item.overlapMinutes} minutes`);
  if (item.location) parts.push(item.location);
  if (item.people?.length) parts.push(item.people.join(', '));
  return parts.join(', ');
}

export function renderCard(card, { ui, filter = null, nowMinutes = null }) {
  const { item } = card;
  const stage = stageOf(item.stage);
  const groupSelected = ui.groupSelection?.includes(item.id);
  const selected = ui.selectedId === item.id && !groupSelected;
  const stageOpen = ui.openMenu === `stage:${item.id}`;
  const id = escapeHtml(item.id);
  const title = escapeHtml(item.title);
  const narrow = card.totalLanes > 1;
  const faded = filter && !(item.people || []).includes(filter);

  // On the day a card is one of three things, and it says which.
  const dayState = nowMinutes === null
    ? null
    : (item.end <= nowMinutes ? 'past' : item.start <= nowMinutes ? 'live' : 'ahead');
  const live = dayState === 'live';
  const progress = live ? (nowMinutes - item.start) / item.duration : 0;
  // Nothing on a card is a control until Edit has been pressed.
  const viewOnly = Boolean(ui.dayOf && !ui.editingOnDay);
  const draggable = !item.locked && !viewOnly;

  const classes = [
    'card',
    `card--${card.density}`,
    narrow && 'card--narrow',
    dayState === 'past' && 'is-past',
    live && 'is-live',
    selected && 'is-selected',
    groupSelected && 'is-group-selected',
    item.locked && 'is-locked',
    item.overlaps?.length && 'is-overlap',
    faded && 'is-faded',
    stageOpen && 'is-menu-open'
  ].filter(Boolean).join(' ');

  // A row with nothing in it is not a row. An activity with no location used
  // to draw a lone map pin, and an activity with nobody on it used to spend one
  // of the card's rows on an empty line.
  //
  // Location and people are wrapped together because a desktop card puts them
  // on one line, at opposite ends of it. On a phone the wrapper is
  // `display: contents`, so the two rows stack as they always did.
  const people = narrow ? '' : peopleTags(item.people);

  // A five- or ten-minute card is 20–40 px tall. Anything but one line would
  // not fit, so it is built as one line rather than measured down to one.
  const body = card.density === 'line'
    ? `<span class="card-title">${title}</span>${glyphs(item)}<span class="card-line-time">${escapeHtml(formatTime(item.start))}</span>`
    : `<div class="card-row card-title-row"><span class="card-title">${title}</span>${glyphs(item)}${live ? '<span class="now-tag"><i></i>Now</span>' : ''}</div>
       <div class="card-row card-time" data-drop="4"><span>${escapeHtml(narrow ? formatTime(item.start) : item.rangeLabel)}</span><strong>${escapeHtml(formatDuration(item.duration))}</strong></div>
       ${warning(item)}
       ${live ? `<div class="card-row card-progress" data-drop="3" aria-hidden="true"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ''}
       ${narrow ? '' : `<div class="card-row card-stage" data-drop="1">${stagePill(stage, { interactive: true, expanded: stageOpen, id: item.id })}</div>`}
       <div class="card-meta">
         ${item.location ? `<div class="card-row card-location" data-drop="2">${icon('pin')}<span>${escapeHtml(item.location)}</span></div>` : ''}
         ${people ? `<div class="card-row card-people" data-drop="0">${people}</div>` : ''}
       </div>`;

  const overlapVars = card.overlapBox ? `--overlap-top:${card.overlapBox.top}px;--overlap-height:${card.overlapBox.height}px;` : '';

  return `<article class="${classes}" data-activity-id="${id}" data-index="${item.index}"
    data-start="${item.start}" data-end="${item.end}" data-duration="${item.duration}"
    style="top:${card.top}px;height:${card.height}px;${phaseVars(stage)}${laneStyle(card.lane, card.totalLanes)}${overlapVars}"
    tabindex="0" data-action="select" data-id="${id}" data-focus-key="card:${id}"
    aria-label="${escapeHtml(accessibleName(item, stage))}">
    <span class="card-rule" aria-hidden="true"></span>
    ${draggable ? `<span class="card-grip" data-role="move" data-id="${id}" aria-hidden="true">${icon('grip')}</span>` : ''}
    <div class="card-body">${body}</div>
    ${viewOnly ? '' : `<div class="card-controls">
      <button class="lock-button ${item.locked ? 'is-locked' : ''}" type="button"
        data-action="lock" data-id="${id}" data-focus-key="lock:${id}" aria-pressed="${item.locked}"
        aria-label="${item.locked ? `Unlock ${title}` : `Lock ${title} against a group move`}">${icon(item.locked ? 'lock' : 'lock-open')}</button>
      <button class="icon-button card-edit" type="button"
        data-action="edit" data-id="${id}" data-focus-key="edit:${id}"
        aria-label="Edit ${title}">${icon('pencil')}</button>
    </div>`}
    <!-- Handles are in the DOM on any unlocked, draggable card, so a mouse
         can reveal them by hovering (CSS hides/shows them — see cards.css);
         a locked card has nothing here for a pointer to move. They only join
         the tab order once the card is selected, so an unselected card's
         hidden handles do not clutter keyboard navigation. They are real
         buttons so the arrow keys can move an edge without a pointer.
         An open-time gap right on this edge (render/timeline.js) draws its
         own handle for the same edge too, but it follows the same
         hover/select reveal rule as this one, gated on the gap rather than
         the card — so it is never guaranteed to be the one showing, and
         this card's own handle is never left out on its account. -->
    ${draggable ? `<button type="button" class="handle handle--top" data-role="resize-top" data-id="${id}" data-focus-key="resize-top:${id}" tabindex="${selected ? '0' : '-1'}" aria-label="Move the start of ${title}"></button>` : ''}
    ${draggable ? `<button type="button" class="handle handle--bottom" data-role="resize" data-id="${id}" data-focus-key="resize:${id}" tabindex="${selected ? '0' : '-1'}" aria-label="Move the end of ${title}"></button>` : ''}
  </article>`;
}
