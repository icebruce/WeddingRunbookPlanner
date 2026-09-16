import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES } from '../config.js';
import { buildSchedule, minutesToTime } from '../schedule.js';

/**
 * A sheet is built once when it opens and is never rebuilt by an unrelated
 * update — a save landing in the background used to re-create the dialog and
 * throw away whatever was half-typed in it (F14).
 */

/**
 * People chips.
 *
 * Text typed into the add field but not confirmed with Enter used to be thrown
 * away on Done (F20). The pending value is read back on submit, so typing a
 * name and pressing Done keeps it.
 */
function peopleEditor(people) {
  const values = (people || []).filter(Boolean);
  return `<div class="people-editor" data-people='${escapeHtml(JSON.stringify(values))}'>
    <div class="people-chip-list">${peopleChips(values)}</div>
    <div class="people-add-row" hidden>
      <input class="people-add-input" maxlength="80" placeholder="Name or group" autocomplete="off" aria-label="Add a person or group">
      <button class="button button--quiet people-add-confirm" type="button">Add</button>
    </div>
  </div>`;
}

export function peopleChips(values) {
  const chips = values.map(person => `<span class="person-chip"><span>${escapeHtml(person)}</span><button type="button" class="person-remove" data-person="${escapeHtml(person)}" aria-label="Remove ${escapeHtml(person)}">${icon('x')}</button></span>`).join('');
  return `${chips}<button class="people-add-trigger" type="button" aria-expanded="false">${icon('plus')}<span>Add</span></button>`;
}

export function activitySheet(payload, plan) {
  const creating = payload.mode === 'create';
  const item = payload.activity;
  const scheduled = buildSchedule(plan).items.find(entry => entry.id === item.id) || null;
  const fixedTime = item.lockedStart || (scheduled ? minutesToTime(scheduled.start) : plan.dayStart);

  return `<dialog id="activity-dialog" class="sheet-dialog">
    <form id="activity-form" class="sheet" method="dialog" novalidate>
      <header class="sheet-header">
        <button class="icon-button sheet-close" type="button" aria-label="Cancel">${icon('x')}</button>
        <h2>${creating ? 'Add activity' : 'Edit activity'}</h2>
        <button class="button button--text" type="submit">Done</button>
      </header>
      <div class="sheet-body form-stack">
        <input type="hidden" name="id" value="${escapeHtml(item.id)}">
        <label class="field"><span>Name</span><input name="title" maxlength="120" value="${escapeHtml(item.title)}" autocomplete="off"></label>
        <label class="field"><span>Stage</span><select name="stage">${STAGES.map(stage => `<option value="${stage.id}" ${stage.id === item.stage ? 'selected' : ''}>${escapeHtml(stage.label)}</option>`).join('')}</select></label>
        <div class="field-grid">
          <label class="field"><span>Starts</span><input value="${escapeHtml(scheduled?.startLabel || 'Calculated')}" readonly tabindex="-1"></label>
          <label class="field"><span>Duration</span>
            <div class="stepper">
              <button type="button" data-duration-step="-5" aria-label="Five minutes shorter">−</button>
              <input name="duration" type="text" inputmode="numeric" value="${Number(item.duration) || 30}" aria-describedby="duration-help">
              <button type="button" data-duration-step="5" aria-label="Five minutes longer">+</button>
            </div>
            <small id="duration-help">Rounded up to the next 5 minutes.</small>
          </label>
        </div>
        <label class="field"><span>Location</span><input name="location" maxlength="140" value="${escapeHtml(item.location || '')}" placeholder="Add a location" autocomplete="off"></label>
        <div class="field"><span>People</span>${peopleEditor(item.people)}<small>Each person or group is its own tag.</small></div>
        <label class="field"><span>Notes</span><textarea name="notes" maxlength="1000" rows="4" placeholder="Optional planning notes">${escapeHtml(item.notes || '')}</textarea></label>
        <div class="lock-setting">
          <div>${icon('lock')}<span><strong>Fixed time</strong><small>Keeps this activity at a set clock time while the rest of the day moves around it.</small></span></div>
          <label class="switch"><input id="lock-toggle" name="locked" type="checkbox" ${item.lockedStart ? 'checked' : ''}><span></span></label>
        </div>
        <label id="fixed-time-field" class="field ${item.lockedStart ? '' : 'is-hidden'}"><span>Starts at</span>
          <!-- No step attribute: a value off the 5-minute grid is rounded up on
               Done rather than refused by the browser with its own message. -->
          <input name="lockedStart" type="time" value="${escapeHtml(fixedTime)}">
        </label>
        ${creating ? '' : `<button id="delete-activity" class="danger-action" type="button">${icon('trash')}<span>Delete activity</span></button>`}
      </div>
    </form>
  </dialog>`;
}

export function versionsSheet(versions) {
  return `<dialog id="versions-dialog" class="sheet-dialog sheet-dialog--wide">
    <section class="sheet">
      <header class="sheet-header">
        <button class="icon-button sheet-close" type="button" aria-label="Close">${icon('x')}</button>
        <h2>Version history</h2>
        <span class="sheet-header-spacer"></span>
      </header>
      <div class="sheet-body">
        <form id="version-form" class="version-create" novalidate>
          <label class="field"><span>Save the current plan as a named version</span><input name="name" maxlength="80" placeholder="e.g. After photographer review"></label>
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
      <header class="sheet-header"><button class="icon-button sheet-close" type="button" aria-label="Cancel">${icon('x')}</button><h2>Plan settings</h2><button class="button button--text" type="submit">Done</button></header>
      <div class="sheet-body form-stack">
        <label class="field"><span>Planner name</span><input name="coupleLabel" maxlength="60" value="${escapeHtml(plan.coupleLabel || 'Our Wedding')}"></label>
        <label class="field"><span>Day title</span><input name="title" maxlength="80" value="${escapeHtml(plan.title)}"></label>
        <label class="field"><span>Date</span><input name="date" type="date" value="${escapeHtml(plan.date)}"></label>
        <label class="field"><span>First activity starts</span><input name="dayStart" type="time" value="${escapeHtml(plan.dayStart)}"><small>Flexible activities follow on from this time until they meet a fixed one.</small></label>
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
  if (!ui.dialog) return '';
  if (ui.dialog.type === 'activity') return activitySheet(ui.dialog, plan);
  if (ui.dialog.type === 'versions') return versionsSheet(ui.versions);
  if (ui.dialog.type === 'settings') return settingsSheet(plan);
  return '';
}
