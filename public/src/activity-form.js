/**
 * The activity editor and the plan-settings form: field wiring, validation,
 * and the people-chip editor.
 *
 * Split out of app.js. It owns the "has this form actually changed"
 * baseline itself, so the rest of the app only ever asks
 * `hasUnsavedChanges(form)` rather than reaching in for a signature.
 */

import { isViewOnly } from './dayof.js';
import { checkPlan, normalizeDuration, roundTimeUp, validateActivity } from './validate.js';
import { formatDuration, formatTime } from './schedule.js';
import { peopleChips } from './render/sheets.js';
import { initPickers } from './render/pickers.js';

export function createActivityForm({ store, commit, closeSheet, confirmDelete, clock, pickerOptions = {} }) {
  /** The form's contents when it opened, so Cancel knows whether to ask. */
  let baseline = null;

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(node => node.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach(node => {
      node.removeAttribute('aria-invalid');
      node.removeAttribute('aria-describedby');
    });
  }

  /**
   * Validation runs through the module the server uses, so the message shown here
   * is the reason the server would have given — and the sheet stays open with the
   * offending field focused instead of the change being applied and then refused.
   */
  function showFieldError(form, field, message) {
    const name = String(field || '').split('.').pop();
    const control = form.querySelector(`[name="${name}"]`);
    const note = document.createElement('p');
    note.className = 'field-error';
    note.id = `error-${name}`;
    note.setAttribute('role', 'alert');
    note.textContent = message;

    if (!control) {
      form.querySelector('.sheet-body')?.prepend(note);
      return;
    }
    const focusable = control.type === 'hidden'
      ? form.querySelector(`[data-target="${name}"]`)
      : control;
    (focusable || control).setAttribute('aria-invalid', 'true');
    (focusable || control).setAttribute('aria-describedby', note.id);
    (control.closest('.field, .group-row') || control.parentElement).append(note);
    focusable?.focus();
  }

  // ------------------------------------------------------------- people chips

  function peopleValues(root) {
    const editor = root.querySelector('.people-editor');
    if (!editor) return [];
    try {
      const stored = JSON.parse(editor.dataset.people || '[]');
      const values = Array.isArray(stored) ? stored.map(value => String(value).trim()).filter(Boolean) : [];
      // Text typed but not confirmed with Enter used to be dropped on Done (F20).
      const pending = editor.querySelector('.people-add-input')?.value.trim();
      if (pending && !values.some(person => person.toLowerCase() === pending.toLowerCase())) values.push(pending);
      return values;
    } catch {
      return [];
    }
  }

  function setPeopleValues(editor, values) {
    const unique = [];
    const seen = new Set();
    for (const value of values.map(entry => String(entry).trim()).filter(Boolean)) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(value);
    }
    const capped = unique.slice(0, 30);
    editor.dataset.people = JSON.stringify(capped);
    editor.querySelector('.people-chip-list').innerHTML = peopleChips(capped);
  }

  function addPendingPerson(editor) {
    const input = editor.querySelector('.people-add-input');
    const value = input?.value.trim();
    if (!value) return;
    setPeopleValues(editor, [...JSON.parse(editor.dataset.people || '[]'), value]);
    input.value = '';
    editor.querySelector('.people-add-row').hidden = false;
    editor.querySelector('.people-add-input')?.focus();
  }

  function bindPeopleEditor(dialog) {
    const editor = dialog.querySelector('.people-editor');
    if (!editor) return;

    editor.addEventListener('click', event => {
      const trigger = event.target.closest('.people-add-trigger');
      if (trigger) {
        editor.querySelector('.people-add-row').hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        editor.querySelector('.people-add-input')?.focus();
        return;
      }
      const remove = event.target.closest('.person-remove');
      if (remove) {
        const person = remove.dataset.person;
        setPeopleValues(editor, JSON.parse(editor.dataset.people || '[]').filter(value => value !== person));
        return;
      }
      if (event.target.closest('.people-add-confirm')) addPendingPerson(editor);
    });

    editor.querySelector('.people-add-input')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addPendingPerson(editor);
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        editor.querySelector('.people-add-row').hidden = true;
        editor.querySelector('.people-add-trigger')?.focus();
      }
    });
  }

  // ------------------------------------------------------------- date/time

  /** "Ends" is worked out from the start and the duration, and shown live. */
  function updateEnds(dialog) {
    const endNode = dialog.querySelector('[data-ends]');
    const humanNode = dialog.querySelector('[data-duration-human]');
    const duration = normalizeDuration(Number(dialog.querySelector('input[name="duration"]').value));
    if (humanNode) humanNode.textContent = formatDuration(duration);

    if (!endNode) return;
    const start = Number(dialog.querySelector('input[name="start"]').value);
    if (!Number.isFinite(start)) { endNode.textContent = '—'; return; }
    endNode.textContent = formatTime(start + duration);
  }

  /** A stable description of the form, for telling "changed" from "untouched". */
  function formSignature(form) {
    const data = [...new FormData(form).entries()].map(([key, value]) => `${key}=${value}`);
    const people = form.querySelector('.people-editor')?.dataset.people ?? '[]';
    const pending = form.querySelector('.people-add-input')?.value ?? '';
    return JSON.stringify([data, people, pending]);
  }

  // ------------------------------------------------------------------ submit

  /**
   * The day can go back to view only while a sheet is open — five minutes
   * away, or midnight on the date — and commit refuses there, so Done used to
   * close the sheet and drop what was typed. Done on a filled-in sheet is
   * deliberate, not a stray thumb, so it counts as Edit.
   */
  function resumeEditing() {
    if (!isViewOnly(store.ui) || !store.ui.dayOf) return;
    store.setUi({ editingOnDay: true }, { regions: ['header', 'heading', 'timeline', 'toolbar'] });
  }

  function submitActivity(event) {
    event.preventDefault();
    const form = event.currentTarget;
    clearFieldErrors(form);

    const data = new FormData(form);
    const candidate = {
      id: String(data.get('id')),
      title: String(data.get('title')).trim(),
      duration: normalizeDuration(Number(data.get('duration'))),
      stage: String(data.get('stage')),
      location: String(data.get('location')).trim(),
      mapUrl: String(data.get('mapUrl') || '').trim(),
      people: peopleValues(form),
      notes: String(data.get('notes')).trim(),
      start: Number(data.get('start')) || 0,
      locked: data.get('locked') === 'on'
    };

    let activity;
    try {
      activity = validateActivity(candidate);
    } catch (error) {
      showFieldError(form, error.field, error.message);
      return;
    }

    const creating = store.ui.dialog.mode === 'create';
    // An activity created from an open time goes into that gap rather than after
    // the selection; the gap is remembered on the dialog because nothing is
    // committed until now.
    const openTime = store.ui.dialog.openTime || null;
    baseline = null;
    resumeEditing();
    closeSheet();

    if (creating) {
      const result = openTime
        ? commit('openTime.add', { openTime, activity })
        : commit('activity.add', { activity, afterId: store.ui.selectedId });
      if (result) store.setUi({ selectedId: activity.id }, { regions: ['timeline', 'toolbar'] });
    } else {
      commit('activity.update', { activity });
    }
  }

  function submitSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    clearFieldErrors(form);

    const data = new FormData(form);
    const text = name => String(data.get(name) || '').trim();

    const changes = {
      coupleLabel: text('coupleLabel'),
      title: text('title'),
      date: text('date'),
      // Sunset is display-only, so it keeps whatever minute it is given, and an
      // empty field means "no marker" rather than "the default".
      sunset: text('sunset') || null,
      // The view range only changes what is drawn. An end at or before the start
      // is a plan that runs into the next day, not a mistake.
      timelineStart: text('timelineStart') ? roundTimeUp(text('timelineStart')) : undefined,
      timelineEnd: text('timelineEnd') ? roundTimeUp(text('timelineEnd')) : undefined
    };

    const candidate = { ...structuredClone(store.plan), ...changes };
    if (changes.timelineStart === undefined) delete candidate.timelineStart;
    if (changes.timelineEnd === undefined) delete candidate.timelineEnd;

    const result = checkPlan(candidate);
    if (!result.ok) {
      showFieldError(form, result.error.field, result.error.message);
      return;
    }

    const applied = {
      coupleLabel: result.plan.coupleLabel,
      title: result.plan.title,
      date: result.plan.date,
      sunset: result.plan.sunset ?? null
    };
    applied.timelineStart = result.plan.timelineStart ?? null;
    applied.timelineEnd = result.plan.timelineEnd ?? null;

    resumeEditing();
    closeSheet();
    commit('plan.settings', { changes: applied });
    // The date decides whether the day-of view belongs on.
    clock.tick();
  }

  // ------------------------------------------------------------------ dialogs

  /**
   * The Google Maps link.
   *
   * It is behind a button rather than a field of its own on the face of the
   * editor, because most locations never get one — a room, a floor, "TBD".
   * The button says which state it is in before it is pressed: filled once a
   * link is there, outlined while there is not.
   */
  function bindMapLink(dialog) {
    const toggle = dialog.querySelector('#map-link-toggle');
    const row = dialog.querySelector('#map-link-row');
    const field = dialog.querySelector('#map-url-field');
    if (!toggle || !row || !field) return;

    toggle.addEventListener('click', () => {
      row.hidden = !row.hidden;
      toggle.setAttribute('aria-expanded', String(!row.hidden));
      if (!row.hidden) field.focus();
    });

    const paint = () => {
      const linked = Boolean(field.value.trim());
      toggle.setAttribute('aria-pressed', String(linked));
      toggle.setAttribute('aria-label', linked ? 'Edit the Google Maps link' : 'Add a Google Maps link');
    };
    field.addEventListener('input', paint);
    // A link already on the activity opens the row, so it is never hidden
    // behind a button that looks the same as an empty one.
    if (field.value.trim()) {
      row.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
  }

  function bindActivityDialog(dialog) {
    const form = dialog.querySelector('#activity-form');
    form.addEventListener('submit', submitActivity);

    // Deleting from inside the editor is the same delete as anywhere else: it
    // asks first, and there are six seconds to undo. The question is asked on
    // top of the editor, so "Keep it" comes back to the form still filled in.
    dialog.querySelector('#delete-activity')?.addEventListener('click', () => {
      confirmDelete(store.ui.dialog.activity.id, () => {
        baseline = null;
        closeSheet();
      });
    });

    for (const button of dialog.querySelectorAll('[data-duration-step]')) {
      button.addEventListener('click', () => {
        const input = dialog.querySelector('input[name="duration"]');
        input.value = normalizeDuration(Number(input.value) + Number(button.dataset.durationStep));
        updateEnds(dialog);
      });
    }

    const duration = dialog.querySelector('input[name="duration"]');
    duration?.addEventListener('blur', () => {
      duration.value = normalizeDuration(Number(duration.value));
      updateEnds(dialog);
    });
    duration?.addEventListener('input', () => updateEnds(dialog));

    initPickers(dialog, { ...pickerOptions, onChange: () => updateEnds(dialog) });

    bindMapLink(dialog);
    bindPeopleEditor(dialog);
    // What the form looked like on open, so Cancel knows whether to ask.
    baseline = formSignature(form);
  }

  function bindSettingsDialog(dialog) {
    dialog.querySelector('#settings-form').addEventListener('submit', submitSettings);
    initPickers(dialog, pickerOptions);
  }

  function hasUnsavedChanges(form) {
    return baseline !== null && formSignature(form) !== baseline;
  }

  function clearBaseline() {
    baseline = null;
  }

  return { bindActivityDialog, bindSettingsDialog, hasUnsavedChanges, clearBaseline };
}
