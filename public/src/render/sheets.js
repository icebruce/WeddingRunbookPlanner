import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES, phaseVars } from '../config.js';
import { buildSchedule, formatDuration, formatTime } from '../schedule.js';

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
    ${STAGES.map(stage => `<label class="stage-choice ${stage.id === current ? 'is-current' : ''}" style="${phaseVars(stage)}">
      <input type="radio" name="stage" value="${stage.id}" ${stage.id === current ? 'checked' : ''}>
      ${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span>
    </label>`).join('')}
  </div>`;
}

/**
 * The timing block.
 *
 * One field decides when an activity happens: a date and time together, so an
 * activity that runs past midnight is simply set to a time on the next
 * calendar day rather than needing a switch of its own. Duration is entered
 * in minutes — the grid this app schedules on — with the hours-and-minutes
 * reading shown beside it, because "80 min" and "1 hr 20 min" are the same
 * number and only one of them is easy to picture.
 */
function timingBlock(item, plan, start) {
  const startDate = new Date(`${plan.date}T00:00:00`);
  startDate.setMinutes(startDate.getMinutes() + (Number.isFinite(start) ? start : 0));
  const end = (Number.isFinite(start) ? start : 0) + (Number(item.duration) || 30);

  return `<fieldset class="field-group timing">
    <legend class="field-label">Timing</legend>

    <label class="group-row">
      <span>Starts</span>
      <span class="picker-field">
        <input name="start" data-picker="datetime" type="text" value="${escapeHtml(formatDateTimeLocal(startDate))}" readonly>
        ${icon('clock', 'picker-icon')}
      </span>
    </label>

    <div class="group-row">
      <span>Duration</span>
      <span class="stepper">
        <button type="button" data-duration-step="-5" aria-label="Five minutes shorter">${icon('minus')}</button>
        <input name="duration" type="text" inputmode="numeric" value="${Number(item.duration) || 30}" aria-label="Duration in minutes">
        <span class="stepper-unit">min</span>
        <button type="button" data-duration-step="5" aria-label="Five minutes longer">${icon('plus')}</button>
      </span>
      <span class="group-note" data-duration-human>${escapeHtml(formatDuration(Number(item.duration) || 30))}</span>
    </div>

    <div class="group-row">
      <span>Ends</span>
      <span class="group-value" data-ends>${escapeHtml(formatTime(end))}</span>
    </div>
  </fieldset>`;
}

/** "2026-11-21T14:45" — flatpickr's own datetime format, seconds dropped. */
function formatDateTimeLocal(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function activitySheet(payload, plan) {
  const creating = payload.mode === 'create';
  const item = payload.activity;
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

        <label class="field">
          <span class="field-label">Name</span>
          <input name="title" maxlength="120" value="${escapeHtml(item.title)}" autocomplete="off" ${creating ? 'autofocus' : ''}>
        </label>

        ${timingBlock(item, plan, Number(item.start) || 0)}

        <label class="field">
          <span class="field-label">Location</span>
          <input name="location" maxlength="140" value="${escapeHtml(item.location || '')}" placeholder="Add a location"
            autocomplete="off" list="location-suggestions">
          <datalist id="location-suggestions">${suggestions.locations.map(place => `<option value="${escapeHtml(place)}"></option>`).join('')}</datalist>
        </label>

        <div class="field">
          <span class="field-label">Stage</span>
          ${stageGrid(item.stage)}
        </div>

        <div class="field">
          <span class="field-label">People</span>
          ${peopleEditor(item.people, suggestions.people)}
        </div>

        <label class="field">
          <span class="field-label">Notes</span>
          <textarea name="notes" maxlength="1000" rows="4" placeholder="Optional planning notes">${escapeHtml(item.notes || '')}</textarea>
        </label>

        <label class="group-row">
          <span>Lock against group moves</span>
          <input name="locked" type="checkbox" ${item.locked ? 'checked' : ''}>
        </label>

        <div class="sheet-actions">
          ${creating ? '' : `<button id="duplicate-activity" class="button button--quiet" type="button">${icon('copy')}<span>Duplicate</span></button>`}
          ${creating ? '' : `<button id="delete-activity" class="danger-action" type="button">${icon('trash')}<span>Delete activity</span></button>`}
        </div>
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
          style="${phaseVars(stage)}">
          ${icon(stage.icon)}<b>${escapeHtml(stage.label)}</b>${stage.id === item.stage ? icon('check') : ''}
        </button>`).join('')}
      </div>
      <div class="action-group"><button type="button" class="action-cancel sheet-close">Cancel</button></div>
    </div>
  </dialog>`;
}

/**
 * "Changed on another device."
 *
 * Neither copy is thrown away: whichever side is not chosen is kept as an
 * automatic version, so the choice is which one to carry on with rather than
 * which one to lose.
 */
export function conflictSheet(latest) {
  const when = latest?.updatedAt ? formatVersionDate(latest.updatedAt) : null;
  return `<dialog id="conflict-dialog" class="alert-dialog">
    <div class="alert">
      <h2>Changed on another device</h2>
      <p>This plan was saved somewhere else${when ? ` at ${escapeHtml(when)}` : ''}. Whichever you do not choose is kept in version history.</p>
      <button type="button" class="button button--primary" data-action="conflict" data-choice="remote">Use the other version</button>
      <button type="button" class="button button--quiet" data-action="conflict" data-choice="local">Keep my changes</button>
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

/**
 * Version history.
 *
 * The current plan is the first row, marked as such, because "which of these
 * is what I am looking at?" is the first question anyone asks. Every row
 * carries a one-line summary computed when the version was written, so the
 * list can be shown without loading a single plan body.
 */
export function versionsSheet(versions, { plan, updatedAt, deviceLabel = 'this device' } = {}) {
  const current = plan ? buildSummary(plan) : null;

  return `<dialog id="versions-dialog" class="sheet-dialog sheet-dialog--wide">
    <section class="sheet">
      <header class="sheet-header">
        <button class="button button--text sheet-close" type="button">Close</button>
        <h2>Version history</h2>
        <span class="sheet-header-spacer"></span>
      </header>
      <div class="sheet-body">
        <form id="version-form" class="version-create" novalidate>
          <label class="field">
            <span class="field-label">Save the current plan as a named version</span>
            <input name="name" maxlength="80" placeholder="e.g. After photographer review">
          </label>
          <button class="button button--primary" type="submit">${icon('save')}<span>Save version</span></button>
        </form>

        <div class="version-list">
          ${current ? `<article class="version-item version-item--current">
            <div>
              <strong>Current plan</strong>
              <span>Edited ${escapeHtml(relativeTime(updatedAt))} on ${escapeHtml(deviceLabel)}</span>
              <span class="version-summary">${escapeHtml(summaryLine(current))}</span>
            </div>
            <span class="version-badge">Now</span>
          </article>` : ''}

          ${versions.map(version => `<article class="version-item" data-version-id="${escapeHtml(version.id)}">
            <div>
              <strong>${escapeHtml(version.name)}</strong>
              <span>${escapeHtml(formatVersionDate(version.createdAt))}${version.auto ? ' · saved automatically' : ''}</span>
              <span class="version-summary">${escapeHtml(summaryLine(version.summary))}</span>
            </div>
            <div class="version-actions">
              <button class="button button--quiet restore-version" type="button" data-version-id="${escapeHtml(version.id)}">Restore</button>
              <button class="icon-button delete-version" type="button" data-version-id="${escapeHtml(version.id)}" aria-label="Delete ${escapeHtml(version.name)}">${icon('trash')}</button>
            </div>
          </article>`).join('')}

          ${versions.length ? '' : '<div class="empty-state">No saved versions yet.</div>'}
        </div>
      </div>
    </section>
  </dialog>`;
}

function summaryLine(summary) {
  if (!summary || !summary.count) return 'Nothing planned yet';
  const count = `${summary.count} ${summary.count === 1 ? 'activity' : 'activities'}`;
  return summary.start && summary.end ? `${count} · ${summary.start} – ${summary.end}` : count;
}

/** The same summary the server writes onto a version, for the current plan. */
function buildSummary(plan) {
  const schedule = buildSchedule(plan);
  return {
    count: schedule.summary.count,
    start: schedule.summary.count ? formatTime(schedule.summary.start) : null,
    end: schedule.summary.count ? formatTime(schedule.summary.end) : null
  };
}

function relativeTime(value) {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'just now';
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatVersionDate(value);
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
        <fieldset class="field-group settings-group">
          <legend class="field-label">Plan</legend>
          <label class="group-row"><span>Planner name</span><input name="coupleLabel" maxlength="60" value="${escapeHtml(plan.coupleLabel || 'Our Wedding')}"></label>
          <label class="group-row"><span>Day title</span><input name="title" maxlength="80" value="${escapeHtml(plan.title)}"></label>
          <label class="group-row"><span>Date</span>
            <span class="picker-field"><input name="date" data-picker="date" type="text" value="${escapeHtml(plan.date)}" readonly>${icon('clock', 'picker-icon')}</span>
          </label>
          <label class="group-row"><span>Sunset marker</span>
            <span class="picker-field"><input name="sunset" data-picker="time" type="text" value="${escapeHtml(plan.sunset ?? '')}" placeholder="Not set" readonly>${icon('clock', 'picker-icon')}</span>
          </label>
        </fieldset>

        <fieldset class="field-group settings-group">
          <legend class="field-label">Timeline</legend>
          <label class="group-row"><span>Shows from</span>
            <span class="picker-field"><input name="timelineStart" data-picker="time" type="text" value="${escapeHtml(plan.timelineStart ?? '')}" placeholder="Earliest activity" readonly>${icon('clock', 'picker-icon')}</span>
          </label>
          <label class="group-row"><span>Shows until</span>
            <span class="picker-field"><input name="timelineEnd" data-picker="time" type="text" value="${escapeHtml(plan.timelineEnd ?? '')}" placeholder="Latest activity" readonly>${icon('clock', 'picker-icon')}</span>
            ${nextDayNote(plan)}
          </label>
          <p class="group-help">Only changes what you see. The view always grows to fit every activity.</p>
        </fieldset>
      </div>
    </form>
  </dialog>`;
}

/** An end at or before the start means the view runs into the next day. */
function nextDayNote(plan) {
  if (!plan.timelineEnd || !plan.timelineStart) return '';
  return plan.timelineEnd <= plan.timelineStart ? '<small class="group-badge">next day</small>' : '';
}

/**
 * The first thing anybody sees. Two ways forward: build the day one activity
 * at a time, or start from a wedding that already exists and change it.
 */
export function emptyState() {
  return `<div class="empty-plan">
    <div class="empty-glyph">${icon('rings')}</div>
    <h2>Nothing planned yet</h2>
    <p>Add activities one at a time, or start from a wedding timeline and adjust it.</p>
    <button type="button" class="button button--primary" data-action="add">${icon('plus')}<span>Add first activity</span></button>
    <button type="button" class="button button--quiet" data-action="use-template">Use wedding template</button>
  </div>`;
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
  if (dialog.type === 'conflict') return conflictSheet(dialog.latest);
  if (dialog.type === 'versions') return versionsSheet(ui.versions, { plan, updatedAt: dialog.updatedAt });
  if (dialog.type === 'settings') return settingsSheet(plan);
  return '';
}
