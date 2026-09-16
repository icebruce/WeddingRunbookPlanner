import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES } from '../config.js';
import { buildSchedule, formatDuration, formatTime, minutesToTime } from '../schedule.js';

/**
 * Sheets on a phone, dialogs on a laptop — the same content and the same
 * order either way. A sheet is built once when it opens and is never rebuilt
 * by an unrelated update, so a save landing in the background cannot throw
 * away what is half-typed in it.
 */

function peopleEditor(people, suggestions) {
  const values = (people || []).filter(Boolean);
  return `<div class="people-editor" data-people='${escapeHtml(JSON.stringify(values))}'>
    <div class="people-chip-list">${peopleChips(values)}</div>
    <div class="people-add-row" hidden>
      <input class="people-add-input" maxlength="80" placeholder="Name or group" autocomplete="off"
        list="people-suggestions" aria-label="Add a person or group">
      <button class="button button--quiet people-add-confirm" type="button">Add</button>
    </div>
    <datalist id="people-suggestions">${suggestions.map(name => `<option value="${escapeHtml(name)}"></option>`).join('')}</datalist>
  </div>`;
}

export function peopleChips(values) {
  const chips = values.map(person => `<span class="person-chip"><span>${escapeHtml(person)}</span><button type="button" class="person-remove" data-person="${escapeHtml(person)}" aria-label="Remove ${escapeHtml(person)}">${icon('x')}</button></span>`).join('');
  return `${chips}<button class="people-add-trigger" type="button" aria-expanded="false">${icon('plus')}<span>Add</span></button>`;
}

/** Everything already used in the plan, for the location and people fields. */
function suggestionsFrom(plan) {
  const locations = new Set();
  const people = new Set();
  for (const activity of plan.activities) {
    if (activity.location) locations.add(activity.location);
    for (const person of activity.people || []) people.add(person);
  }
  return { locations: [...locations], people: [...people] };
}

function stageGrid(current) {
  return `<div class="stage-grid" role="radiogroup" aria-label="Stage">
    ${STAGES.map(stage => `<label class="stage-choice ${stage.id === current ? 'is-current' : ''}" style="--phase:${stage.color};--phase-tint:${stage.tint}">
      <input type="radio" name="stage" value="${stage.id}" ${stage.id === current ? 'checked' : ''}>
      ${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span>
    </label>`).join('')}
  </div>`;
}

/**
 * The timing block.
 *
 * "Flexible" and "Fixed" are the two things an activity's start can be, so
 * they are one control rather than a switch with a field that appears beside
 * it. Flexible says what it follows and shows the start it works out to;
 * Fixed offers that same time to edit.
 */
function timingBlock(item, scheduled, plan) {
  const fixed = Boolean(item.lockedStart);
  const start = scheduled ? scheduled.start : null;
  const end = scheduled ? scheduled.end : null;

  return `<fieldset class="field-group timing">
    <legend class="field-label">Timing</legend>
    <div class="group-row">
      <span>Starts</span>
      <span class="segmented" role="radiogroup" aria-label="Starts">
        <label class="${fixed ? '' : 'is-on'}"><input type="radio" name="timing" value="flexible" ${fixed ? '' : 'checked'}>Flexible</label>
        <label class="${fixed ? 'is-on' : ''}"><input type="radio" name="timing" value="fixed" ${fixed ? 'checked' : ''}>Fixed</label>
      </span>
    </div>

    <div class="group-row timing-flexible ${fixed ? 'is-hidden' : ''}">
      <span class="group-note">Follows the activity before it</span>
      <span class="group-value">${start === null ? '—' : escapeHtml(formatTime(start))}</span>
    </div>

    <div class="group-row timing-fixed ${fixed ? '' : 'is-hidden'}">
      <span>Starts at</span>
      <!-- No step attribute: a value off the five-minute grid is rounded up on
           Done rather than refused by the browser in its own words. -->
      <input name="lockedStart" type="time" value="${escapeHtml(item.lockedStart || (start === null ? plan.dayStart : minutesToTime(start)))}">
    </div>

    <div class="group-row">
      <span>Duration</span>
      <span class="stepper">
        <button type="button" data-duration-step="-5" aria-label="Five minutes shorter">${icon('minus')}</button>
        <input name="duration" type="text" inputmode="numeric" value="${Number(item.duration) || 30}" aria-label="Duration in minutes">
        <button type="button" data-duration-step="5" aria-label="Five minutes longer">${icon('plus')}</button>
      </span>
    </div>

    <div class="group-row">
      <span>Ends</span>
      <span class="group-value" data-ends>${end === null ? '—' : escapeHtml(formatTime(end))}</span>
    </div>
  </fieldset>`;
}

export function activitySheet(payload, plan) {
  const creating = payload.mode === 'create';
  const item = payload.activity;
  const scheduled = buildSchedule(plan).items.find(entry => entry.id === item.id) || null;
  const suggestions = suggestionsFrom(plan);

  return `<dialog id="activity-dialog" class="sheet-dialog">
    <form id="activity-form" class="sheet" method="dialog" novalidate>
      <header class="sheet-header">
        <button class="button button--text sheet-close" type="button">Cancel</button>
        <h2>${creating ? 'Add activity' : 'Edit activity'}</h2>
        <button class="button button--text button--done" type="submit">Done</button>
      </header>
      <div class="sheet-body">
        <input type="hidden" name="id" value="${escapeHtml(item.id)}">

        <div class="field">
          <span class="field-label">Name</span>
          <input name="title" maxlength="120" value="${escapeHtml(item.title)}" autocomplete="off" ${creating ? 'autofocus' : ''}>
        </div>

        ${timingBlock(item, scheduled, plan)}

        <div class="field">
          <span class="field-label">Location</span>
          <input name="location" maxlength="140" value="${escapeHtml(item.location || '')}" placeholder="Add a location"
            autocomplete="off" list="location-suggestions">
          <datalist id="location-suggestions">${suggestions.locations.map(place => `<option value="${escapeHtml(place)}"></option>`).join('')}</datalist>
        </div>

        <div class="field">
          <span class="field-label">Stage</span>
          ${stageGrid(item.stage)}
        </div>

        <div class="field">
          <span class="field-label">People</span>
          ${peopleEditor(item.people, suggestions.people)}
        </div>

        <div class="field">
          <span class="field-label">Notes</span>
          <textarea name="notes" maxlength="1000" rows="4" placeholder="Optional planning notes">${escapeHtml(item.notes || '')}</textarea>
        </div>

        ${creating ? '' : `<button id="delete-activity" class="danger-action" type="button">${icon('trash')}<span>Delete activity</span></button>`}
      </div>
    </form>
  </dialog>`;
}

/**
 * The open-time actions (§5.9). Nothing changes until one is chosen, and each
 * option says what it will do in the times it will do it at.
 */
export function openTimeSheet(openTime, plan) {
  const schedule = buildSchedule(plan);
  const minutes = openTime.end - openTime.start;
  const before = schedule.items.find(item => item.id === openTime.beforeId);
  const previous = [...schedule.items].reverse().find(item => item.end === openTime.start);

  return `<dialog id="open-time-dialog" class="action-sheet-dialog">
    <div class="action-sheet">
      <div class="action-group">
        <div class="action-header">
          <strong>${escapeHtml(formatDuration(minutes))} open${before ? ` before ${escapeHtml(before.title)}` : ''}</strong>
          <small>${escapeHtml(formatTime(openTime.start))} – ${escapeHtml(formatTime(openTime.end))}</small>
        </div>
        <button type="button" class="action-option" data-action="open-time-choice" data-choice="buffer">
          <b>Keep as buffer</b><small>Adds a Buffer activity for this time</small>
        </button>
        ${previous ? `<button type="button" class="action-option" data-action="open-time-choice" data-choice="extend">
          <b>Extend ${escapeHtml(previous.title)}</b><small>Ends at ${escapeHtml(formatTime(openTime.end))} instead of ${escapeHtml(formatTime(previous.end))}</small>
        </button>` : ''}
        <button type="button" class="action-option" data-action="open-time-choice" data-choice="add">
          <b>Add activity here</b><small>Starts ${escapeHtml(formatTime(openTime.start))}, ${escapeHtml(formatDuration(minutes))}</small>
        </button>
      </div>
      <div class="action-group">
        <button type="button" class="action-cancel sheet-close">Cancel</button>
      </div>
    </div>
  </dialog>`;
}

/** The stage list, as a sheet, for the phone toolbar's Stage button. */
export function stageSheet(item) {
  return `<dialog id="stage-dialog" class="action-sheet-dialog">
    <div class="action-sheet">
      <div class="action-group">
        <div class="action-header"><strong>Stage</strong><small>${escapeHtml(item.title)}</small></div>
        ${STAGES.map(stage => `<button type="button" class="action-option action-option--row ${stage.id === item.stage ? 'is-current' : ''}"
          data-action="set-stage" data-id="${escapeHtml(item.id)}" data-stage="${stage.id}"
          style="--phase:${stage.color};--phase-tint:${stage.tint}">
          ${icon(stage.icon)}<b>${escapeHtml(stage.label)}</b>${stage.id === item.stage ? icon('check') : ''}
        </button>`).join('')}
      </div>
      <div class="action-group"><button type="button" class="action-cancel sheet-close">Cancel</button></div>
    </div>
  </dialog>`;
}

/** "Discard changes?" — the one question the editor asks. */
export function discardSheet() {
  return `<dialog id="discard-dialog" class="alert-dialog">
    <div class="alert">
      <h2>Discard changes?</h2>
      <p>What you typed here will not be kept.</p>
      <button type="button" class="button button--primary" data-action="discard-confirm">Discard</button>
      <button type="button" class="button button--quiet sheet-close">Keep editing</button>
    </div>
  </dialog>`;
}

export function versionsSheet(versions) {
  return `<dialog id="versions-dialog" class="sheet-dialog sheet-dialog--wide">
    <section class="sheet">
      <header class="sheet-header">
        <button class="button button--text sheet-close" type="button">Close</button>
        <h2>Version history</h2>
        <span class="sheet-header-spacer"></span>
      </header>
      <div class="sheet-body">
        <form id="version-form" class="version-create" novalidate>
          <label class="field"><span class="field-label">Save the current plan as a named version</span><input name="name" maxlength="80" placeholder="e.g. After photographer review"></label>
          <button class="button button--primary" type="submit">${icon('save')}<span>Save version</span></button>
        </form>
        <div class="version-list">
          ${versions.length
            ? versions.map(version => `<article class="version-item"><div><strong>${escapeHtml(version.name)}</strong><span>${escapeHtml(formatVersionDate(version.createdAt))}</span></div><button class="button button--quiet restore-version" type="button" data-version-id="${escapeHtml(version.id)}">Restore</button></article>`).join('')
            : '<div class="empty-state">No saved versions yet.</div>'}
        </div>
      </div>
    </section>
  </dialog>`;
}

export function settingsSheet(plan) {
  return `<dialog id="settings-dialog" class="sheet-dialog">
    <form id="settings-form" class="sheet" method="dialog" novalidate>
      <header class="sheet-header">
        <button class="button button--text sheet-close" type="button">Cancel</button>
        <h2>Plan settings</h2>
        <button class="button button--text button--done" type="submit">Done</button>
      </header>
      <div class="sheet-body">
        <div class="field"><span class="field-label">Planner name</span><input name="coupleLabel" maxlength="60" value="${escapeHtml(plan.coupleLabel || 'Our Wedding')}"></div>
        <div class="field"><span class="field-label">Day title</span><input name="title" maxlength="80" value="${escapeHtml(plan.title)}"></div>
        <div class="field"><span class="field-label">Date</span><input name="date" type="date" value="${escapeHtml(plan.date)}"></div>
        <div class="field"><span class="field-label">First activity starts</span><input name="dayStart" type="time" value="${escapeHtml(plan.dayStart)}"><small>Flexible activities follow on from this time until they meet a fixed one.</small></div>
      </div>
    </form>
  </dialog>`;
}

export function formatVersionDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function renderSheet(ui, plan) {
  const dialog = ui.dialog;
  if (!dialog) return '';
  if (dialog.type === 'activity') return activitySheet(dialog, plan);
  if (dialog.type === 'open-time') return openTimeSheet(dialog.openTime, plan);
  if (dialog.type === 'stage') return stageSheet(dialog.item);
  if (dialog.type === 'versions') return versionsSheet(ui.versions);
  if (dialog.type === 'settings') return settingsSheet(plan);
  return '';
}
