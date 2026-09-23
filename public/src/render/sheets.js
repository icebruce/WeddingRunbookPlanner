import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';
import { STAGES, phaseVars } from '../config.js';
import { buildSchedule, formatDuration, formatTime } from '../schedule.js';
import { pickerField } from './pickers.js';
import { describeConflicts } from '../merge.js';

/**
 * Sheets on a phone, dialogs on a laptop — the same content and the same
 * order either way. A sheet is built once when it opens and is never rebuilt
 * by an unrelated update, so a save landing in the background cannot throw
 * away what is half-typed in it.
 */

/**
 * Where focus lands when a sheet opens.
 *
 * `showModal()` focuses the first element carrying `autofocus`, and failing
 * that the first focusable thing in the dialog — which here is Cancel, so
 * editing an activity opened with a focus ring sitting on the one button that
 * throws the edit away. Adding an activity used to answer that by focusing the
 * name field, which raised the keyboard over the sheet as it was still
 * arriving and buried the timing block underneath it.
 *
 * Neither is right. Focus goes to the sheet itself: nothing is armed, nothing
 * is covered, Tab walks into the fields in order, and Escape still closes. The
 * ring is `:focus-visible`, which a programmatic focus does not trigger, so
 * there is nothing to see.
 */
const SHEET_FOCUS = 'tabindex="-1" autofocus';

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
    ${STAGES.map(stage => `<label class="stage-choice" style="${phaseVars(stage)}">
      <input type="radio" name="stage" value="${stage.id}" ${stage.id === current ? 'checked' : ''}>
      ${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span>
    </label>`).join('')}
  </div>`;
}

/**
 * The timing block.
 *
 * One field decides when an activity happens. There is no calendar on it: an
 * activity in a wedding plan starts either on the plan's own date or in the
 * small hours after it, and which of the two is worked out from the clock
 * rather than asked (FUNCTIONAL_SPEC §5.2). Duration is entered in minutes —
 * the grid this app schedules on — with the hours-and-minutes reading under
 * the label, because "80 min" and "1 hr 20 min" are the same number and only
 * one of them is easy to picture. Under the label rather than beside the
 * stepper: a reading that shares the row is as wide as its own text, and the
 * row grew and shrank with it.
 *
 * Lock sits here, with the other two things that decide where this activity
 * sits in the day, and says what it actually does: it never moves anything,
 * it only exempts this activity from a group move (§5.3).
 */
function timingBlock(item, plan, start) {
  const minutes = Number.isFinite(start) ? start : 0;
  const end = minutes + (Number(item.duration) || 30);

  return `<span class="field-label">Timing</span>
  <fieldset class="field-group timing">
    <legend class="sr-only">Timing</legend>

    <div class="group-row">
      <span>Starts</span>
      ${pickerField('start', { kind: 'datetime', value: String(minutes), label: 'Starts', planDate: plan.date })}
    </div>

    <div class="group-row">
      <span class="duration-label">Duration<small class="group-note" data-duration-human>${escapeHtml(formatDuration(Number(item.duration) || 30))}</small></span>
      <span class="stepper">
        <button type="button" data-duration-step="-5" aria-label="Five minutes shorter">${icon('minus')}</button>
        <input name="duration" type="text" inputmode="numeric" value="${Number(item.duration) || 30}" aria-label="Duration in minutes">
        <span class="stepper-unit">min</span>
        <button type="button" data-duration-step="5" aria-label="Five minutes longer">${icon('plus')}</button>
      </span>
    </div>

    <div class="group-row">
      <span>Ends</span>
      <span class="group-value" data-ends>${escapeHtml(formatTime(end))}</span>
    </div>

    <label class="group-row lock-row">
      <span class="lock-label"><span class="lock-title">Lock${icon('lock')}</span><small>Stays put in a group move</small></span>
      <span class="switch"><input name="locked" type="checkbox" ${item.locked ? 'checked' : ''}><span></span></span>
    </label>
  </fieldset>`;
}

/**
 * The location field.
 *
 * One text field for what the card shows, and one button beside it for the
 * Google Maps link. The button wears the link glyph rather than a map one:
 * attaching a link is all it does — it does not search for a place. Plain words stay plain words — a card only offers to open
 * a map when someone has actually supplied one, so a location like
 * "Getting-ready location · TBD" never becomes a link to nowhere.
 */
function locationField(item, places) {
  const linked = Boolean(item.mapUrl);
  return `<div class="field">
    <span class="field-label">Location</span>
    <div class="location-row">
      <input name="location" maxlength="140" value="${escapeHtml(item.location || '')}" placeholder="Add a location"
        autocomplete="off" list="location-suggestions" aria-label="Location">
      <button type="button" class="map-button" id="map-link-toggle" aria-pressed="${linked}"
        aria-expanded="false" aria-controls="map-link-row"
        aria-label="${linked ? 'Edit the Google Maps link' : 'Add a Google Maps link'}">${icon('link')}</button>
    </div>
    <div class="map-link-row" id="map-link-row" hidden>
      <label class="field-label" for="map-url-field">Google Maps link</label>
      <input id="map-url-field" name="mapUrl" type="url" maxlength="2000" value="${escapeHtml(item.mapUrl || '')}"
        placeholder="Paste a link from Google Maps" autocomplete="off" spellcheck="false" inputmode="url">
      <p class="map-link-help">Paste a link and the card's location opens it. Leave it empty and the location stays plain text.</p>
    </div>
    <datalist id="location-suggestions">${places.map(place => `<option value="${escapeHtml(place)}"></option>`).join('')}</datalist>
  </div>`;
}

export function activitySheet(payload, plan) {
  const creating = payload.mode === 'create';
  const item = payload.activity;
  const suggestions = suggestionsFrom(plan);

  return `<dialog id="activity-dialog" class="sheet-dialog">
    <form id="activity-form" class="sheet" method="dialog" novalidate ${SHEET_FOCUS}>
      <header class="sheet-header">
        <button class="button button--text sheet-close" type="button">Cancel</button>
        <h2>${creating ? 'Add activity' : 'Edit activity'}</h2>
        <button class="button button--text button--done" type="submit">Done</button>
      </header>
      <div class="sheet-body">
        <input type="hidden" name="id" value="${escapeHtml(item.id)}">

        <label class="field">
          <span class="field-label">Name</span>
          <input name="title" maxlength="120" value="${escapeHtml(item.title)}" autocomplete="off">
        </label>

        ${timingBlock(item, plan, Number(item.start) || 0)}

        ${locationField(item, suggestions.locations)}

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
/**
 * The question, asked only where it is real.
 *
 * With a common ancestor to compare against, everything the two of you changed
 * separately has already been merged by the time this appears, so the dialog
 * names the one thing left in dispute instead of offering two whole days. The
 * second form — no ancestor — is the old wholesale question, kept for the one
 * case where this tab never saw a confirmed version and merging is impossible.
 */
export function conflictSheet(latest, conflicts) {
  const when = latest?.updatedAt ? formatVersionDate(latest.updatedAt) : null;

  if (!conflicts?.length) {
    return `<dialog id="conflict-dialog" class="alert-dialog">
      <div class="alert">
        <h2>Changed on another device</h2>
        <p>This plan was saved somewhere else${when ? ` at ${escapeHtml(when)}` : ''}. Whichever you do not choose is kept in version history.</p>
        <button type="button" class="button button--primary" data-action="conflict" data-choice="theirs">Use the other version</button>
        <button type="button" class="button button--quiet" data-action="conflict" data-choice="mine">Keep my changes</button>
      </div>
    </dialog>`;
  }

  const names = describeConflicts(conflicts);
  const plural = conflicts.length > 1 || new Set(conflicts.map(entry => entry.title)).size > 1;
  return `<dialog id="conflict-dialog" class="alert-dialog">
    <div class="alert">
      <h2>You both changed ${escapeHtml(names)}</h2>
      <p>Everything else you each changed is already merged. Only ${plural ? 'these' : 'this'} need${plural ? '' : 's'} a decision${when ? `, from a save at ${escapeHtml(when)}` : ''}. The version you do not keep stays in version history.</p>
      <button type="button" class="button button--primary" data-action="conflict" data-choice="mine">Keep mine</button>
      <button type="button" class="button button--quiet" data-action="conflict" data-choice="theirs">Use the other version</button>
    </div>
  </dialog>`;
}

/**
 * The read-only link.
 *
 * One link, and one button that replaces it. There is no list of links to
 * curate and no expiry to set, because the plan stops mattering the day after
 * the wedding and a link nobody can turn off would be worse than one anybody
 * can replace. What it does and does not allow is said plainly: the people
 * being sent it are being trusted with the day's locations and everyone's
 * names, and whoever sends it should know that before they do.
 */
export function shareSheet(share, { origin = '' } = {}) {
  const url = share?.token ? `${origin}/share#${share.token}` : '';

  return `<dialog id="share-dialog" class="sheet-dialog">
    <section class="sheet" ${SHEET_FOCUS}>
      <header class="sheet-header">
        <button class="button button--text sheet-close" type="button">Close</button>
        <h2>Share read-only link</h2>
        <span class="sheet-header-spacer"></span>
      </header>
      <div class="sheet-body">
        <p class="sheet-note">Anyone with this link can read the plan and print it. They cannot change anything, and they are never asked for the password. On the wedding day it opens straight to what is happening now.</p>

        <div class="share-link">
          <input id="share-link-field" type="text" readonly value="${escapeHtml(url)}" aria-label="Read-only link">
          <button type="button" class="button button--primary" data-action="share-copy">${icon('copy')}<span>Copy</span></button>
        </div>

        <p class="sheet-note">Keep it to the people who need it — it works for anyone it is passed on to. Replacing it stops the old one working everywhere, straight away.</p>
        <button type="button" class="button button--quiet" data-action="share-rotate">Replace link</button>
      </div>
    </section>
  </dialog>`;
}

/**
 * The two questions the app asks before something is thrown away. Both are the
 * same alert: what is about to happen, what it costs, the answer that does it,
 * and the way back underneath.
 */
function confirmAlert({ id, title, body, action, confirmLabel, cancelLabel, danger = false }) {
  return `<dialog id="${id}" class="alert-dialog">
    <div class="alert">
      <h2>${title}</h2>
      <p>${body}</p>
      <button type="button" class="button ${danger ? 'button--danger' : 'button--primary'} alert-confirm"
        data-action="${action}">${confirmLabel}</button>
      <button type="button" class="button button--quiet sheet-close">${cancelLabel}</button>
    </div>
  </dialog>`;
}

/** "Discard changes?" — the one question the editor asks about typing. */
export function discardSheet() {
  return confirmAlert({
    id: 'discard-dialog',
    title: 'Discard changes?',
    body: 'What you typed here will not be kept.',
    action: 'discard-confirm',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing'
  });
}

/**
 * "Delete this activity?" — asked wherever Delete is pressed. The undo toast
 * still follows the delete; the question is in front of it, not instead of it,
 * because Delete now sits in the toolbar slot a thumb reaches for first.
 */
export function deleteSheet(title) {
  return confirmAlert({
    id: 'delete-dialog',
    title: 'Delete this activity?',
    body: `${escapeHtml(title)} comes off the day. Undo is offered for six seconds.`,
    action: 'delete-confirm',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep it',
    danger: true
  });
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
    <section class="sheet" ${SHEET_FOCUS}>
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
    <form id="settings-form" class="sheet" method="dialog" novalidate ${SHEET_FOCUS}>
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
          <div class="group-row"><span>Date</span>
            ${pickerField('date', { kind: 'date', value: plan.date, label: 'Date', planDate: plan.date, glyph: 'rings' })}
          </div>
          <div class="group-row"><span>Sunset marker</span>
            ${pickerField('sunset', { kind: 'time', value: plan.sunset ?? '', label: 'Sunset marker', placeholder: 'Not set', optional: true, glyph: 'sun' })}
          </div>
        </fieldset>

        <fieldset class="field-group settings-group">
          <legend class="field-label">Timeline</legend>
          <div class="group-row"><span>Shows from</span>
            ${pickerField('timelineStart', { kind: 'time', value: plan.timelineStart ?? '', label: 'Shows from', placeholder: 'Earliest activity', optional: true })}
          </div>
          <div class="group-row"><span>Shows until</span>
            ${pickerField('timelineEnd', { kind: 'time', value: plan.timelineEnd ?? '', label: 'Shows until', placeholder: 'Latest activity', optional: true })}
            ${nextDayNote(plan)}
          </div>
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
  if (dialog.type === 'conflict') return conflictSheet(dialog.latest, dialog.conflicts);
  if (dialog.type === 'share') return shareSheet(dialog.share, { origin: dialog.origin });
  if (dialog.type === 'versions') return versionsSheet(ui.versions, { plan, updatedAt: dialog.updatedAt });
  if (dialog.type === 'settings') return settingsSheet(plan);
  return '';
}
