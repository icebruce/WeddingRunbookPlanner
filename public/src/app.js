import { api } from './api.js';
import { PLAN_STATUSES, STAGES } from './config.js';
import { buildSchedule, buildTimelineLayout, clampDuration, formatDuration, formatTime, minutesToTime, parseTime } from './schedule.js';
import { icon } from './icons.js';

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

const state = {
  authenticated: null,
  plan: null,
  revision: null,
  updatedAt: null,
  versions: [],
  saveState: 'saved',
  saveTimer: null,
  savePromise: null,
  changeSeq: 0,
  savedSeq: 0,
  conflict: null,
  dialog: null,
  menuOpen: false,
  selectedActivityId: null,
  stageMenuActivityId: null,
  cardMenuActivityId: null,
  drag: null,
  resize: null
};

const stageMap = new Map(STAGES.map(stage => [stage.id, stage]));

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function uid(prefix = 'activity') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toast(message, tone = 'neutral') {
  const node = document.createElement('div');
  node.className = `toast toast--${tone}`;
  node.textContent = message;
  toastRegion.append(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 180);
  }, 3200);
}

function formatPlanDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function formatVersionDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function getActivity(id) {
  return state.plan?.activities.find(activity => activity.id === id) || null;
}

function getScheduledActivity(id) {
  return buildSchedule(state.plan).items.find(activity => activity.id === id) || null;
}

function saveIndicator() {
  const labels = {
    saved: 'Saved',
    saving: 'Saving…',
    error: 'Save failed',
    conflict: 'Needs attention'
  };
  return `<span class="save-indicator save-indicator--${state.saveState}"><span class="save-dot"></span>${labels[state.saveState] || 'Saved'}</span>`;
}

function loginTemplate() {
  return `
    <main class="login-view">
      <section class="login-card" aria-labelledby="login-title">
        <div class="brand brand--login">${icon('heart')}<span>Our Wedding</span></div>
        <div class="login-copy">
          <p class="eyebrow">Private planner</p>
          <h1 id="login-title">Wedding Day</h1>
          <p>Enter the shared password to open the day plan.</p>
        </div>
        <form id="login-form" class="form-stack">
          <label class="field">
            <span>Password</span>
            <input name="password" type="password" autocomplete="current-password" required autofocus>
          </label>
          <p id="login-error" class="form-error" role="alert" hidden></p>
          <button class="button button--primary button--wide" type="submit">Continue</button>
        </form>
      </section>
    </main>`;
}

function loadingTemplate() {
  return `<main class="loading-view"><div class="loading-mark">${icon('heart')}</div><p>Opening your plan…</p></main>`;
}

function stagePill(stage, { interactive = false, expanded = false } = {}) {
  const content = `${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span>${interactive ? icon('chevron') : ''}`;
  if (!interactive) {
    return `<span class="stage-pill" style="--stage-color:${stage.color};--stage-tint:${stage.tint}">${content}</span>`;
  }
  return `<button class="stage-pill stage-pill--button stage-menu-toggle" type="button" style="--stage-color:${stage.color};--stage-tint:${stage.tint}" aria-haspopup="menu" aria-expanded="${expanded}">${content}</button>`;
}

function personInitials(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function personTone(value) {
  let total = 0;
  for (const char of String(value || '')) total = (total + char.codePointAt(0)) % 4;
  return total + 1;
}

function peopleSummary(people) {
  const values = (people || []).filter(Boolean);
  if (!values.length) return `<span class="people-empty">No people assigned</span>`;
  const primary = values.slice(0, 5).map(person => `<span class="person-display-tag" title="${escapeHtml(person)}">${escapeHtml(person)}</span>`).join('');
  const compact = values.slice(5).map(person => `<span class="person-display-tag person-display-tag--compact" title="${escapeHtml(person)}">${escapeHtml(personInitials(person))}</span>`).join('');
  return `<span class="people-summary" title="${escapeHtml(values.join(', '))}">${primary}${compact}</span>`;
}

function peopleEditorTemplate(people) {
  const values = (people || []).filter(Boolean);
  return `<div class="people-editor" data-people='${escapeHtml(JSON.stringify(values))}'>
    <div class="people-chip-list">
      ${values.map(person => `<span class="person-chip"><span class="person-avatar person-avatar--${personTone(person)}">${escapeHtml(personInitials(person))}</span><span>${escapeHtml(person)}</span><button type="button" class="person-remove" data-person="${escapeHtml(person)}" aria-label="Remove ${escapeHtml(person)}">${icon('x')}</button></span>`).join('')}
      <button class="people-add-trigger" type="button" aria-expanded="false">${icon('plus')}<span>Add</span></button>
    </div>
    <div class="people-add-row" hidden>
      <input class="people-add-input" maxlength="80" placeholder="Name or group" autocomplete="off">
      <button class="button button--quiet people-add-confirm" type="button">Add</button>
    </div>
  </div>`;
}

function getTimeScale(schedule) {
  const configuredStart = parseTime(state.plan.dayStart) ?? schedule.items[0]?.start ?? 8 * 60;
  const firstStart = schedule.items.length ? Math.min(...schedule.items.map(item => item.start)) : configuredStart;
  const start = Math.floor(Math.min(configuredStart, firstStart) / 15) * 15;
  const end = Math.ceil(Math.max(schedule.end, start + 60) / 15) * 15;
  return { start, end, minutePx: 2.6, height: (end - start) * 2.6 + 24 };
}

function timeScaleTemplate(scale) {
  const ticks = [];
  for (let minute = scale.start; minute <= scale.end; minute += 15) {
    const withinHour = ((minute % 60) + 60) % 60;
    const kind = withinHour === 0 ? 'hour' : withinHour === 30 ? 'half' : 'quarter';
    const label = kind === 'hour'
      ? formatTime(minute)
      : formatTime(minute).replace(/\s[AP]M$/, '');
    ticks.push(`<div class="timeline-tick timeline-tick--${kind}" style="top:${((minute - scale.start) * scale.minutePx).toFixed(1)}px"><span>${escapeHtml(label)}</span><i></i></div>`);
  }
  return ticks.join('');
}

function stageMenuTemplate(item) {
  if (state.stageMenuActivityId !== item.id) return '';
  return `<div class="stage-menu" role="menu" aria-label="Change stage">
    ${STAGES.map(stage => `<button type="button" role="menuitemradio" aria-checked="${stage.id === item.stage}" class="stage-menu-option ${stage.id === item.stage ? 'is-current' : ''}" data-stage-value="${stage.id}" style="--stage-color:${stage.color};--stage-tint:${stage.tint}">${icon(stage.icon)}<span>${escapeHtml(stage.label)}</span></button>`).join('')}
  </div>`;
}

function cardMenuTemplate(item) {
  if (state.cardMenuActivityId !== item.id) return '';
  return `<div class="card-menu" role="menu">
    <button type="button" role="menuitem" class="edit-activity">${icon('settings')}<span>Edit activity</span></button>
    <button type="button" role="menuitem" class="delete-card-activity">${icon('trash')}<span>Delete</span></button>
  </div>`;
}

function timelineActivity(item, index, scale, visual) {
  const stage = stageMap.get(item.stage) || STAGES[0];
  const conflict = item.conflictMinutes > 0;
  const selected = state.selectedActivityId === item.id;
  const stageOpen = state.stageMenuActivityId === item.id;
  const menuOpen = state.cardMenuActivityId === item.id;
  const shifted = visual.offset > 1;
  return `
    <div class="activity-row ${shifted ? 'activity-row--shifted' : ''} ${conflict ? 'activity-row--conflict' : ''} ${(stageOpen || menuOpen) ? 'activity-row--menu-open' : ''}" data-activity-id="${escapeHtml(item.id)}" data-index="${index}" data-anchor-top="${visual.anchorTop.toFixed(1)}" style="--row-top:${visual.top.toFixed(1)}px;--row-height:${visual.height.toFixed(1)}px;--stage-color:${stage.color};--stage-tint:${stage.tint}">
      <article class="activity-card ${item.duration < 30 ? 'activity-card--compact' : ''} ${selected ? 'is-selected' : ''} ${conflict ? 'activity-card--conflict' : ''}" tabindex="0" aria-selected="${selected}" aria-label="${escapeHtml(item.title)}, ${escapeHtml(item.startLabel)} to ${escapeHtml(item.endLabel)}, ${escapeHtml(stage.label)}">
        <button class="drag-handle" type="button" aria-label="Reorder ${escapeHtml(item.title)}" title="Drag to reorder. Alt + arrow keys also work." ${item.isLocked ? 'disabled' : ''}>
          <span class="drag-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
        </button>
        <span class="accent-rule" aria-hidden="true"></span>
        <div class="card-time">
          <span class="card-time-range">${escapeHtml(item.startLabel)} – ${escapeHtml(item.endLabel)}</span>
          <strong>${escapeHtml(formatDuration(item.duration))}</strong>
        </div>
        <div class="card-stage stage-control">
          ${stagePill(stage, { interactive: true, expanded: stageOpen })}
          ${stageMenuTemplate(item)}
        </div>
        <div class="card-main">
          <div class="card-heading">
            <h2>${escapeHtml(item.title)}</h2>
            <div class="card-actions">
              <button class="lock-button ${item.isLocked ? 'is-locked' : ''}" type="button" aria-pressed="${item.isLocked}" aria-label="${item.isLocked ? `Unlock ${escapeHtml(item.title)} from ${escapeHtml(item.startLabel)}` : `Lock ${escapeHtml(item.title)} at ${escapeHtml(item.startLabel)}`}" title="${item.isLocked ? `Fixed at ${escapeHtml(item.startLabel)} — click to unlock` : `Lock at ${escapeHtml(item.startLabel)}`}">${icon('lock')}</button>
              <div class="card-menu-wrap">
                <button class="icon-button card-menu-toggle ${menuOpen ? 'is-active' : ''}" type="button" aria-label="More options for ${escapeHtml(item.title)}" aria-haspopup="menu" aria-expanded="${menuOpen}">${icon('more')}</button>
                ${cardMenuTemplate(item)}
              </div>
            </div>
          </div>
          <div class="card-meta">
            <span>${icon('pin')}${escapeHtml(item.location || 'Location not set')}</span>
            <span class="card-people">${peopleSummary(item.people)}</span>
          </div>
        </div>
        ${conflict ? `<div class="card-conflict-note">${icon('warning')}<span>${formatDuration(item.conflictMinutes)} overlap with previous activity</span></div>` : ''}
        <button class="resize-handle" type="button" aria-label="Resize ${escapeHtml(item.title)} duration" title="Drag to change duration"><span></span></button>
      </article>
    </div>`;
}

function conflictBanner() {
  if (!state.conflict) return '';
  return `<div class="conflict-banner" role="alert">
    <div>${icon('warning')}<span><strong>This plan changed on another device.</strong> Choose which copy to keep.</span></div>
    <div class="conflict-actions">
      <button class="button button--quiet" data-conflict="cloud" type="button">Use cloud copy</button>
      <button class="button button--primary" data-conflict="local" type="button">Keep my changes</button>
    </div>
  </div>`;
}

function menuTemplate() {
  return `<details class="app-menu" ${state.menuOpen ? 'open' : ''}>
    <summary class="icon-button icon-button--outlined" aria-label="Open menu">${icon('menu')}</summary>
    <div class="menu-popover">
      <button type="button" data-menu-action="versions">${icon('history')}<span>Version history</span></button>
      <button type="button" data-menu-action="settings">${icon('settings')}<span>Plan settings</span></button>
      <div class="menu-divider"></div>
      <button type="button" data-menu-action="logout">${icon('logout')}<span>Sign out</span></button>
    </div>
  </details>`;
}

function statusControl() {
  return `<label class="status-control">
    <span class="sr-only">Plan status</span>
    <span class="status-dot" aria-hidden="true"></span>
    <select id="plan-status" aria-label="Plan status">
      ${PLAN_STATUSES.map(status => `<option ${status === state.plan.status ? 'selected' : ''}>${status}</option>`).join('')}
    </select>
    ${icon('chevron')}
  </label>`;
}

function appTemplate() {
  const schedule = buildSchedule(state.plan);
  return `
    <header class="topbar">
      <a href="#main-plan" class="brand" aria-label="Our Wedding planner">${icon('heart')}<span>${escapeHtml(state.plan.coupleLabel || 'Our Wedding')}</span></a>
      <div class="topbar-actions">
        ${saveIndicator()}
        ${statusControl()}
        ${menuTemplate()}
      </div>
    </header>
    ${conflictBanner()}
    <main id="main-plan" class="planner">
      <section class="planner-heading">
        <div>
          <p class="eyebrow">One-day planner</p>
          <h1>${escapeHtml(state.plan.title)}</h1>
          <p class="planner-date">${escapeHtml(formatPlanDate(state.plan.date))}</p>
        </div>
        <button id="add-activity" class="button button--primary" type="button">${icon('plus')}<span>Add activity</span></button>
      </section>
      <section class="timeline" aria-label="Wedding day timeline">
        <div class="timeline-labels" aria-hidden="true"><span>Time</span><span>Plan</span></div>
        ${(() => {
          const scale = getTimeScale(schedule);
          const layout = buildTimelineLayout(schedule, { scaleStart: scale.start, minutePx: scale.minutePx });
          const canvasHeight = Math.max(scale.height, layout.height);
          return `<div id="activity-list" class="timeline-canvas" style="height:${canvasHeight.toFixed(1)}px">
            <div class="timeline-ruler" aria-hidden="true">${timeScaleTemplate({ ...scale, height: canvasHeight })}</div>
            <div class="timeline-plan">${layout.rows.map(visual => timelineActivity(visual.item, visual.index, scale, visual)).join('')}</div>
            <div class="end-marker" style="top:${layout.endTop.toFixed(1)}px"><span>${escapeHtml(schedule.endLabel)}</span><i></i><strong>Day plan ends</strong></div>
          </div>`;
        })()}
      </section>
    </main>
    <button id="mobile-add" class="mobile-add" type="button" aria-label="Add activity">${icon('plus')}</button>
    ${dialogTemplate()}`;
}

function activityDialogTemplate(payload) {
  const creating = payload.mode === 'create';
  const item = payload.activity;
  const scheduled = creating ? null : getScheduledActivity(item.id);
  const lockTime = item.lockedStart || scheduled ? (item.lockedStart || minutesToTime(scheduled.start)) : state.plan.dayStart;
  return `<dialog id="activity-dialog" class="sheet-dialog">
    <form id="activity-form" class="sheet" method="dialog">
      <header class="sheet-header">
        <button class="icon-button sheet-close" type="button" aria-label="Close">${icon('x')}</button>
        <h2>${creating ? 'Add Activity' : 'Edit Activity'}</h2>
        <button class="button button--text" type="submit">Done</button>
      </header>
      <div class="sheet-body form-stack">
        <input type="hidden" name="id" value="${escapeHtml(item.id)}">
        <label class="field"><span>Activity name</span><input name="title" required maxlength="100" value="${escapeHtml(item.title)}"></label>
        <label class="field"><span>Stage</span><select name="stage">${STAGES.map(stage => `<option value="${stage.id}" ${stage.id === item.stage ? 'selected' : ''}>${escapeHtml(stage.label)}</option>`).join('')}</select></label>
        <div class="field-grid">
          <label class="field"><span>Start time</span><input value="${escapeHtml(scheduled?.startLabel || 'Calculated')}" readonly></label>
          <label class="field"><span>Duration</span><div class="stepper"><button type="button" data-duration-step="-5" aria-label="Reduce duration by five minutes">−</button><input name="duration" type="number" inputmode="numeric" min="1" max="720" value="${Number(item.duration) || 30}" aria-describedby="duration-help"><button type="button" data-duration-step="5" aria-label="Increase duration by five minutes">+</button></div><small id="duration-help">Rounded up to the next 5 minutes when needed.</small></label>
        </div>
        <label class="field"><span>Location</span><input name="location" maxlength="140" value="${escapeHtml(item.location || '')}" placeholder="Add a location"></label>
        <div class="field"><span>People</span>${peopleEditorTemplate(item.people)}<small>Add people or groups as individual tags.</small></div>
        <label class="field"><span>Notes</span><textarea name="notes" maxlength="1000" rows="4" placeholder="Optional planning notes">${escapeHtml(item.notes || '')}</textarea></label>
        <div class="lock-setting">
          <div>${icon('lock')}<span><strong>Lock / fixed time</strong><small>Keeps this activity anchored while flexible activities ripple around it.</small></span></div>
          <label class="switch"><input id="lock-toggle" name="locked" type="checkbox" ${item.lockedStart ? 'checked' : ''}><span></span></label>
        </div>
        <label id="fixed-time-field" class="field ${item.lockedStart ? '' : 'is-hidden'}"><span>Fixed start time</span><input name="lockedStart" type="time" step="300" value="${escapeHtml(lockTime)}"></label>
        ${creating ? '' : `<button id="delete-activity" class="danger-action" type="button">${icon('trash')}<span>Delete activity</span></button>`}
      </div>
    </form>
  </dialog>`;
}

function versionsDialogTemplate() {
  return `<dialog id="versions-dialog" class="sheet-dialog sheet-dialog--wide">
    <section class="sheet">
      <header class="sheet-header">
        <button class="icon-button sheet-close" type="button" aria-label="Close">${icon('x')}</button>
        <h2>Version History</h2>
        <span class="sheet-header-spacer"></span>
      </header>
      <div class="sheet-body">
        <form id="version-form" class="version-create">
          <label class="field"><span>Save the current plan as a named version</span><input name="name" maxlength="80" placeholder="e.g. After photographer review" required></label>
          <button class="button button--primary" type="submit">${icon('save')}<span>Save version</span></button>
        </form>
        <div class="version-list">
          ${state.versions.length ? state.versions.map(version => `<article class="version-item"><div><strong>${escapeHtml(version.name)}</strong><span>${escapeHtml(formatVersionDate(version.createdAt))}</span></div><button class="button button--quiet restore-version" type="button" data-version-id="${escapeHtml(version.id)}">Restore</button></article>`).join('') : '<div class="empty-state">No named versions yet.</div>'}
        </div>
      </div>
    </section>
  </dialog>`;
}

function settingsDialogTemplate() {
  return `<dialog id="settings-dialog" class="sheet-dialog">
    <form id="settings-form" class="sheet" method="dialog">
      <header class="sheet-header"><button class="icon-button sheet-close" type="button" aria-label="Close">${icon('x')}</button><h2>Plan Settings</h2><button class="button button--text" type="submit">Done</button></header>
      <div class="sheet-body form-stack">
        <label class="field"><span>Planner name</span><input name="coupleLabel" maxlength="60" required value="${escapeHtml(state.plan.coupleLabel || 'Our Wedding')}"></label>
        <label class="field"><span>Day title</span><input name="title" maxlength="80" required value="${escapeHtml(state.plan.title)}"></label>
        <label class="field"><span>Date</span><input name="date" type="date" required value="${escapeHtml(state.plan.date)}"></label>
        <label class="field"><span>Planning day starts</span><input name="dayStart" type="time" step="300" required value="${escapeHtml(state.plan.dayStart)}"><small>Flexible activities ripple forward from this time until they meet a locked activity.</small></label>
      </div>
    </form>
  </dialog>`;
}

function dialogTemplate() {
  if (!state.dialog) return '';
  if (state.dialog.type === 'activity') return activityDialogTemplate(state.dialog);
  if (state.dialog.type === 'versions') return versionsDialogTemplate();
  if (state.dialog.type === 'settings') return settingsDialogTemplate();
  return '';
}

function render() {
  if (state.authenticated === null) app.innerHTML = loadingTemplate();
  else if (!state.authenticated) app.innerHTML = loginTemplate();
  else if (!state.plan) app.innerHTML = loadingTemplate();
  else app.innerHTML = appTemplate();

  bindEvents();
  if (state.dialog) requestAnimationFrame(() => app.querySelector('dialog')?.showModal());
}

function updatePlan(mutator, { save = true } = {}) {
  const next = structuredClone(state.plan);
  mutator(next);
  state.plan = next;
  if (save) {
    state.changeSeq += 1;
    scheduleSave();
  }
  render();
}

function scheduleSave() {
  if (state.conflict) return;
  state.saveState = 'saving';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => void saveNow(), 650);
}

async function saveNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.plan || state.conflict) return;

  if (state.savePromise) {
    await state.savePromise.catch(() => {});
    if (!state.conflict && state.changeSeq > state.savedSeq) return saveNow();
    return;
  }

  if (state.changeSeq <= state.savedSeq) {
    state.saveState = 'saved';
    updateSaveIndicator();
    return;
  }

  const planSnapshot = structuredClone(state.plan);
  const revisionSnapshot = state.revision;
  const sequenceSnapshot = state.changeSeq;
  state.saveState = 'saving';
  updateSaveIndicator();

  const request = api.save(planSnapshot, revisionSnapshot);
  state.savePromise = request;
  try {
    const result = await request;
    state.revision = result.revision;
    state.updatedAt = result.updatedAt;
    state.savedSeq = Math.max(state.savedSeq, sequenceSnapshot);
    state.saveState = state.changeSeq > state.savedSeq ? 'saving' : 'saved';
  } catch (error) {
    if (error.status === 409 && error.body?.latest) {
      state.conflict = { local: structuredClone(state.plan), latest: error.body.latest };
      state.saveState = 'conflict';
      render();
      return;
    }
    if (error.status === 401) {
      state.authenticated = false;
      state.plan = null;
      render();
      return;
    }
    state.saveState = 'error';
    toast('Could not save. Your changes are still on this screen.', 'error');
  } finally {
    if (state.savePromise === request) state.savePromise = null;
    updateSaveIndicator();
  }

  if (!state.conflict && state.changeSeq > state.savedSeq) return saveNow();
}

async function flushSave() {
  if (state.saveTimer || state.saveState === 'saving') await saveNow();
  if (state.savePromise) await state.savePromise;
  if (state.saveState === 'error' || state.saveState === 'conflict') throw new Error('Plan is not fully saved');
}

function updateSaveIndicator() {
  const node = app.querySelector('.save-indicator');
  if (!node) return;
  const replacement = document.createElement('template');
  replacement.innerHTML = saveIndicator();
  node.replaceWith(replacement.content.firstElementChild);
}

function openActivityDialog(activity, mode = 'edit') {
  state.dialog = { type: 'activity', mode, activity: structuredClone(activity) };
  render();
}

async function openVersions() {
  try {
    await flushSave();
    const result = await api.versions();
    state.versions = result.versions;
    state.revision = result.revision;
    state.dialog = { type: 'versions' };
    state.menuOpen = false;
    render();
  } catch (error) {
    toast(error.message || 'Could not open versions.', 'error');
  }
}

function closeDialog() {
  state.dialog = null;
  render();
}

function bindEvents() {
  if (!state.authenticated) {
    const form = app.querySelector('#login-form');
    form?.addEventListener('submit', handleLogin);
    return;
  }
  if (!state.plan) return;

  app.querySelector('#plan-status')?.addEventListener('change', event => updatePlan(plan => { plan.status = event.target.value; }));
  app.querySelector('#add-activity')?.addEventListener('click', handleAdd);
  app.querySelector('#mobile-add')?.addEventListener('click', handleAdd);

  app.querySelectorAll('.activity-card').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('button, .stage-menu, .card-menu')) return;
      selectActivity(card.closest('.activity-row').dataset.activityId);
    });
    card.addEventListener('dblclick', event => {
      if (event.target.closest('button, .stage-menu, .card-menu')) return;
      openActivityDialog(getActivity(card.closest('.activity-row').dataset.activityId));
    });
    card.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key) || event.target !== card) return;
      event.preventDefault();
      selectActivity(card.closest('.activity-row').dataset.activityId);
    });
  });

  app.querySelectorAll('.card-menu-toggle').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const id = button.closest('.activity-row').dataset.activityId;
    state.cardMenuActivityId = state.cardMenuActivityId === id ? null : id;
    state.stageMenuActivityId = null;
    state.selectedActivityId = id;
    render();
  }));
  app.querySelectorAll('.edit-activity').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const row = button.closest('.activity-row');
    openActivityDialog(getActivity(row.dataset.activityId));
  }));
  app.querySelectorAll('.delete-card-activity').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const row = button.closest('.activity-row');
    const activity = getActivity(row.dataset.activityId);
    if (!activity || !window.confirm(`Delete ${activity.title || 'this activity'}?`)) return;
    updatePlan(plan => { plan.activities = plan.activities.filter(item => item.id !== activity.id); });
    state.cardMenuActivityId = null;
    if (state.selectedActivityId === activity.id) state.selectedActivityId = null;
    toast('Activity deleted.');
  }));

  app.querySelectorAll('.stage-menu-toggle').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const id = button.closest('.activity-row').dataset.activityId;
    state.stageMenuActivityId = state.stageMenuActivityId === id ? null : id;
    state.cardMenuActivityId = null;
    state.selectedActivityId = id;
    render();
  }));
  app.querySelectorAll('[data-stage-value]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const row = button.closest('.activity-row');
    const id = row.dataset.activityId;
    const stage = button.dataset.stageValue;
    updatePlan(plan => { plan.activities.find(activity => activity.id === id).stage = stage; });
    state.stageMenuActivityId = null;
    state.selectedActivityId = id;
    toast('Stage updated.', 'success');
  }));

  app.querySelectorAll('.lock-button').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const row = button.closest('.activity-row');
    const id = row.dataset.activityId;
    const scheduled = getScheduledActivity(id);
    updatePlan(plan => {
      const activity = plan.activities.find(item => item.id === id);
      activity.lockedStart = activity.lockedStart ? null : minutesToTime(scheduled.start);
    });
    state.selectedActivityId = id;
    state.stageMenuActivityId = null;
    state.cardMenuActivityId = null;
    toast(button.classList.contains('is-locked') ? 'Fixed time removed.' : `Locked at ${scheduled.startLabel}.`, 'success');
  }));

  app.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', startDrag);
    handle.addEventListener('keydown', handleKeyboardReorder);
  });
  app.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('pointerdown', startResize);
    handle.addEventListener('keydown', handleKeyboardResize);
  });
  app.querySelectorAll('[data-conflict]').forEach(button => button.addEventListener('click', resolveConflict));
  app.querySelectorAll('[data-menu-action]').forEach(button => button.addEventListener('click', handleMenuAction));

  const planner = app.querySelector('.planner');
  planner?.addEventListener('click', event => {
    if (event.target.closest('.activity-card, button, a, input, select, textarea, summary, dialog')) return;
    if (state.selectedActivityId || state.stageMenuActivityId || state.cardMenuActivityId) {
      state.selectedActivityId = null;
      state.stageMenuActivityId = null;
      state.cardMenuActivityId = null;
      render();
    }
  });

  const details = app.querySelector('.app-menu');
  details?.addEventListener('toggle', () => { state.menuOpen = details.open; });

  bindDialogEvents();
}

function selectActivity(id) {
  const changed = state.selectedActivityId !== id || state.stageMenuActivityId || state.cardMenuActivityId;
  state.selectedActivityId = id;
  state.stageMenuActivityId = null;
  state.cardMenuActivityId = null;
  if (changed) render();
}

function bindDialogEvents() {
  const dialog = app.querySelector('dialog');
  if (!dialog) return;
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.querySelectorAll('.sheet-close').forEach(button => button.addEventListener('click', closeDialog));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDialog();
  });

  if (dialog.id === 'activity-dialog') {
    dialog.querySelector('#activity-form')?.addEventListener('submit', handleActivitySubmit);
    dialog.querySelector('#delete-activity')?.addEventListener('click', handleDeleteActivity);
    dialog.querySelector('#lock-toggle')?.addEventListener('change', event => {
      dialog.querySelector('#fixed-time-field')?.classList.toggle('is-hidden', !event.target.checked);
    });
    dialog.querySelectorAll('[data-duration-step]').forEach(button => button.addEventListener('click', () => {
      const input = dialog.querySelector('input[name="duration"]');
      input.value = clampDuration(Number(input.value) + Number(button.dataset.durationStep));
    }));
    const durationInput = dialog.querySelector('input[name="duration"]');
    durationInput?.addEventListener('blur', () => { durationInput.value = clampDuration(Number(durationInput.value)); });
    bindPeopleEditor(dialog);
  }

  if (dialog.id === 'versions-dialog') {
    dialog.querySelector('#version-form')?.addEventListener('submit', handleCreateVersion);
    dialog.querySelectorAll('.restore-version').forEach(button => button.addEventListener('click', handleRestoreVersion));
  }

  if (dialog.id === 'settings-dialog') dialog.querySelector('#settings-form')?.addEventListener('submit', handleSettingsSubmit);
}

function getPeopleEditorValues(root) {
  const editor = root.matches?.('.people-editor') ? root : root.querySelector('.people-editor');
  if (!editor) return [];
  try {
    const values = JSON.parse(editor.dataset.people || '[]');
    return Array.isArray(values) ? values.map(value => String(value).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function setPeopleEditorValues(editor, values) {
  const unique = [...new Set(values.map(value => String(value).trim()).filter(Boolean))].slice(0, 30);
  editor.dataset.people = JSON.stringify(unique);
  const list = editor.querySelector('.people-chip-list');
  const addButton = `<button class="people-add-trigger" type="button" aria-expanded="false">${icon('plus')}<span>Add</span></button>`;
  list.innerHTML = `${unique.map(person => `<span class="person-chip"><span class="person-avatar person-avatar--${personTone(person)}">${escapeHtml(personInitials(person))}</span><span>${escapeHtml(person)}</span><button type="button" class="person-remove" data-person="${escapeHtml(person)}" aria-label="Remove ${escapeHtml(person)}">${icon('x')}</button></span>`).join('')}${addButton}`;
}

function addPeopleEditorValue(editor) {
  const input = editor.querySelector('.people-add-input');
  const value = input?.value.trim();
  if (!value) return;
  const values = getPeopleEditorValues(editor);
  if (!values.some(person => person.toLowerCase() === value.toLowerCase())) values.push(value);
  if (input) input.value = '';
  setPeopleEditorValues(editor, values);
  editor.querySelector('.people-add-row').hidden = false;
  editor.querySelector('.people-add-input')?.focus();
}

function bindPeopleEditor(dialog) {
  const editor = dialog.querySelector('.people-editor');
  if (!editor) return;
  editor.addEventListener('click', event => {
    const addTrigger = event.target.closest('.people-add-trigger');
    if (addTrigger) {
      const addRow = editor.querySelector('.people-add-row');
      addRow.hidden = false;
      addTrigger.setAttribute('aria-expanded', 'true');
      editor.querySelector('.people-add-input')?.focus();
      return;
    }
    const remove = event.target.closest('.person-remove');
    if (remove) {
      const person = remove.dataset.person;
      setPeopleEditorValues(editor, getPeopleEditorValues(editor).filter(value => value !== person));
      return;
    }
    if (event.target.closest('.people-add-confirm')) addPeopleEditorValue(editor);
  });
  editor.querySelector('.people-add-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); addPeopleEditorValue(editor); }
    if (event.key === 'Escape') {
      editor.querySelector('.people-add-row').hidden = true;
      editor.querySelector('.people-add-trigger')?.focus();
    }
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = form.querySelector('#login-error');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  errorNode.hidden = true;
  try {
    await api.login(new FormData(form).get('password'));
    state.authenticated = true;
    await loadPlan();
  } catch (error) {
    errorNode.textContent = error.message || 'Unable to sign in';
    errorNode.hidden = false;
    button.disabled = false;
  }
}

function handleAdd() {
  openActivityDialog({ id: uid(), title: '', duration: 30, stage: 'preparation', location: '', people: [], notes: '', lockedStart: null }, 'create');
}

function handleActivitySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const activity = {
    id: String(data.get('id')),
    title: String(data.get('title')).trim(),
    duration: clampDuration(Number(data.get('duration'))),
    stage: String(data.get('stage')),
    location: String(data.get('location')).trim(),
    people: getPeopleEditorValues(form).slice(0, 30),
    notes: String(data.get('notes')).trim(),
    lockedStart: data.get('locked') === 'on' ? String(data.get('lockedStart') || state.plan.dayStart) : null
  };
  const creating = state.dialog.mode === 'create';
  updatePlan(plan => {
    if (creating) plan.activities.push(activity);
    else {
      const index = plan.activities.findIndex(item => item.id === activity.id);
      if (index >= 0) plan.activities[index] = activity;
    }
  });
  state.dialog = null;
  toast(creating ? 'Activity added.' : 'Activity updated.', 'success');
  render();
}

function handleDeleteActivity() {
  const id = state.dialog.activity.id;
  const title = state.dialog.activity.title || 'this activity';
  if (!window.confirm(`Delete ${title}?`)) return;
  updatePlan(plan => { plan.activities = plan.activities.filter(activity => activity.id !== id); });
  state.dialog = null;
  toast('Activity deleted.');
  render();
}

function handleSettingsSubmit(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  updatePlan(plan => {
    plan.coupleLabel = String(data.get('coupleLabel')).trim();
    plan.title = String(data.get('title')).trim();
    plan.date = String(data.get('date'));
    plan.dayStart = String(data.get('dayStart'));
  });
  state.dialog = null;
  render();
}

async function handleCreateVersion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await flushSave();
    const result = await api.createVersion(new FormData(form).get('name'), state.revision);
    state.versions = result.versions;
    state.revision = result.revision;
    state.saveState = 'saved';
    state.dialog = { type: 'versions' };
    toast('Version saved.', 'success');
    render();
  } catch (error) {
    toast(error.message || 'Could not save version.', 'error');
    button.disabled = false;
  }
}

async function handleRestoreVersion(event) {
  const id = event.currentTarget.dataset.versionId;
  const version = state.versions.find(item => item.id === id);
  if (!version || !window.confirm(`Restore “${version.name}”? The current plan will be replaced.`)) return;
  try {
    const result = await api.restoreVersion(id, state.revision);
    state.plan = result.plan;
    state.versions = result.versions;
    state.revision = result.revision;
    state.updatedAt = result.updatedAt;
    state.changeSeq = 0;
    state.savedSeq = 0;
    state.dialog = null;
    state.saveState = 'saved';
    toast('Version restored.', 'success');
    render();
  } catch (error) {
    toast(error.message || 'Could not restore version.', 'error');
  }
}

async function handleMenuAction(event) {
  const action = event.currentTarget.dataset.menuAction;
  if (action === 'versions') return openVersions();
  if (action === 'settings') {
    state.dialog = { type: 'settings' };
    state.menuOpen = false;
    return render();
  }
  if (action === 'logout') {
    try { await flushSave(); } catch {}
    await api.logout().catch(() => {});
    state.authenticated = false;
    state.plan = null;
    state.revision = null;
    state.dialog = null;
    render();
  }
}

function resolveConflict(event) {
  const choice = event.currentTarget.dataset.conflict;
  if (choice === 'cloud') {
    state.plan = state.conflict.latest.plan;
    state.revision = state.conflict.latest.revision;
    state.updatedAt = state.conflict.latest.updatedAt;
    state.conflict = null;
    state.savedSeq = state.changeSeq;
    state.saveState = 'saved';
    toast('Cloud copy loaded.');
    render();
    return;
  }
  state.plan = state.conflict.local;
  state.revision = state.conflict.latest.revision;
  state.conflict = null;
  state.saveState = 'saving';
  render();
  scheduleSave();
}

function handleKeyboardReorder(event) {
  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const row = event.currentTarget.closest('.activity-row');
  const index = Number(row.dataset.index);
  const direction = event.key === 'ArrowUp' ? -1 : 1;
  const target = index + direction;
  if (target < 0 || target >= state.plan.activities.length) return;
  updatePlan(plan => {
    const [moved] = plan.activities.splice(index, 1);
    plan.activities.splice(target, 0, moved);
  });
  requestAnimationFrame(() => app.querySelector(`.activity-row[data-index="${target}"] .drag-handle`)?.focus());
}

function handleKeyboardResize(event) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const row = event.currentTarget.closest('.activity-row');
  const id = row.dataset.activityId;
  const delta = ['ArrowUp', 'ArrowRight'].includes(event.key) ? 5 : -5;
  updatePlan(plan => {
    const item = plan.activities.find(activity => activity.id === id);
    item.duration = clampDuration(item.duration + delta);
  });
  requestAnimationFrame(() => app.querySelector(`.activity-row[data-activity-id="${CSS.escape(id)}"] .resize-handle`)?.focus());
}

function startDrag(event) {
  if (event.button !== 0 || event.currentTarget.disabled) return;
  event.preventDefault();
  const row = event.currentTarget.closest('.activity-row');
  const card = row.querySelector('.activity-card');
  const fromIndex = Number(row.dataset.index);
  state.selectedActivityId = row.dataset.activityId;
  state.stageMenuActivityId = null;
  state.cardMenuActivityId = null;
  const rect = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  clone.classList.add('drag-floating');
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('button').forEach(button => button.tabIndex = -1);
  document.body.append(clone);

  row.classList.add('is-drag-source');
  const placeholder = document.createElement('div');
  placeholder.className = 'drop-placeholder';
  placeholder.innerHTML = '<span>Drop here</span>';

  state.drag = { pointerId: event.pointerId, row, card, clone, placeholder, fromIndex, offsetY: event.clientY - rect.top, slot: fromIndex, started: false };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.addEventListener('pointermove', moveDrag);
  event.currentTarget.addEventListener('pointerup', endDrag, { once: true });
  event.currentTarget.addEventListener('pointercancel', cancelDrag, { once: true });
  document.body.classList.add('is-reordering');
}

function moveDrag(event) {
  const drag = state.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.started = true;
  drag.clone.style.top = `${event.clientY - drag.offsetY}px`;
  drag.clone.style.left = `${drag.card.getBoundingClientRect().left}px`;
  const list = app.querySelector('#activity-list');
  const rows = [...list.querySelectorAll('.activity-row')].filter(row => row !== drag.row);
  rows.forEach(row => row.classList.remove('is-drop-before', 'is-drop-after'));
  let slot = rows.length;
  for (let i = 0; i < rows.length; i += 1) {
    const rect = rows[i].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      slot = i;
      break;
    }
  }
  drag.slot = slot;
  if (!drag.placeholder.isConnected) list.append(drag.placeholder);
  const listRect = list.getBoundingClientRect();
  if (rows.length === 0) {
    drag.placeholder.style.top = '0px';
    drag.dropTargetRow = null;
  } else if (slot < rows.length) {
    const target = rows[slot];
    target.classList.add('is-drop-before');
    drag.dropTargetRow = target;
    drag.placeholder.style.top = `${Math.max(0, target.getBoundingClientRect().top - listRect.top - 8)}px`;
  } else {
    const target = rows[rows.length - 1];
    target.classList.add('is-drop-after');
    drag.dropTargetRow = target;
    drag.placeholder.style.top = `${Math.max(0, target.getBoundingClientRect().bottom - listRect.top + 2)}px`;
  }
}

function cleanupDrag() {
  const drag = state.drag;
  if (!drag) return;
  app.querySelectorAll('.activity-row.is-drop-before, .activity-row.is-drop-after').forEach(row => row.classList.remove('is-drop-before', 'is-drop-after'));
  drag.clone.remove();
  drag.placeholder.remove();
  drag.row.classList.remove('is-drag-source');
  document.body.classList.remove('is-reordering');
  state.drag = null;
}

function endDrag(event) {
  const drag = state.drag;
  event.currentTarget.removeEventListener('pointermove', moveDrag);
  if (!drag) return;
  const { fromIndex, slot, started } = drag;
  cleanupDrag();
  if (!started) return;
  updatePlan(plan => {
    const [moved] = plan.activities.splice(fromIndex, 1);
    plan.activities.splice(Math.max(0, Math.min(slot, plan.activities.length)), 0, moved);
  });
}

function cancelDrag(event) {
  event.currentTarget.removeEventListener('pointermove', moveDrag);
  cleanupDrag();
}

function startResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const row = event.currentTarget.closest('.activity-row');
  const card = row.querySelector('.activity-card');
  const id = row.dataset.activityId;
  const activity = getActivity(id);
  const tooltip = document.createElement('div');
  tooltip.className = 'resize-tooltip';
  tooltip.textContent = formatDuration(activity.duration);
  document.body.append(tooltip);
  const rect = card.getBoundingClientRect();
  tooltip.style.left = `${rect.right - 70}px`;
  tooltip.style.top = `${rect.bottom - 8}px`;
  card.classList.add('is-resizing');
  state.resize = { pointerId: event.pointerId, id, card, handle: event.currentTarget, startY: event.clientY, startDuration: activity.duration, nextDuration: activity.duration, tooltip };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.addEventListener('pointermove', moveResize);
  event.currentTarget.addEventListener('pointerup', endResize, { once: true });
  event.currentTarget.addEventListener('pointercancel', cancelResize, { once: true });
}

function moveResize(event) {
  const resize = state.resize;
  if (!resize || resize.pointerId !== event.pointerId) return;
  const deltaMinutes = Math.round((event.clientY - resize.startY) / 8) * 5;
  resize.nextDuration = clampDuration(resize.startDuration + deltaMinutes);

  const previewPlan = structuredClone(state.plan);
  const previewActivity = previewPlan.activities.find(activity => activity.id === resize.id);
  previewActivity.duration = resize.nextDuration;
  const previewSchedule = buildSchedule(previewPlan);
  const scale = getTimeScale(previewSchedule);
  const layout = buildTimelineLayout(previewSchedule, { scaleStart: scale.start, minutePx: scale.minutePx });
  const canvas = app.querySelector('#activity-list');
  if (canvas) canvas.style.height = `${Math.max(scale.height, layout.height).toFixed(1)}px`;

  layout.rows.forEach(visual => {
    const row = app.querySelector(`.activity-row[data-activity-id="${CSS.escape(visual.item.id)}"]`);
    if (!row) return;
    row.style.setProperty('--row-top', `${visual.top.toFixed(1)}px`);
    row.style.setProperty('--row-height', `${visual.height.toFixed(1)}px`);
    row.dataset.anchorTop = visual.anchorTop.toFixed(1);
    row.classList.toggle('activity-row--shifted', visual.offset > 1);
    const card = row.querySelector('.activity-card');
    card?.classList.toggle('activity-card--compact', visual.item.duration < 30);
    const rangeNode = row.querySelector('.card-time-range');
    const durationNode = row.querySelector('.card-time strong');
    if (rangeNode) rangeNode.textContent = `${visual.item.startLabel} – ${visual.item.endLabel}`;
    if (durationNode) durationNode.textContent = formatDuration(visual.item.duration);
  });

  const endMarker = app.querySelector('.end-marker');
  if (endMarker) endMarker.style.top = `${layout.endTop.toFixed(1)}px`;
  resize.tooltip.textContent = formatDuration(resize.nextDuration);
  const rect = resize.card.getBoundingClientRect();
  resize.tooltip.style.left = `${rect.right - 70}px`;
  resize.tooltip.style.top = `${rect.bottom - 10}px`;
}

function cleanupResize() {
  if (!state.resize) return;
  state.resize.card.classList.remove('is-resizing');
  state.resize.tooltip.remove();
  state.resize = null;
}

function endResize(event) {
  const resize = state.resize;
  event.currentTarget.removeEventListener('pointermove', moveResize);
  if (!resize) return;
  const { id, nextDuration, startDuration } = resize;
  cleanupResize();
  if (nextDuration !== startDuration) updatePlan(plan => {
    plan.activities.find(activity => activity.id === id).duration = nextDuration;
  });
}

function cancelResize(event) {
  event.currentTarget.removeEventListener('pointermove', moveResize);
  cleanupResize();
  render();
}

async function loadPlan() {
  try {
    const result = await api.load();
    state.plan = result.plan;
    state.revision = result.revision;
    state.updatedAt = result.updatedAt;
    state.changeSeq = 0;
    state.savedSeq = 0;
    state.saveState = 'saved';
    render();
  } catch (error) {
    if (error.status === 401) {
      state.authenticated = false;
      render();
      return;
    }
    app.innerHTML = `<main class="fatal-view"><div>${icon('warning')}</div><h1>Couldn’t open the plan</h1><p>${escapeHtml(error.message || 'Please try again.')}</p><button id="retry-load" class="button button--primary" type="button">Try again</button></main>`;
    app.querySelector('#retry-load')?.addEventListener('click', loadPlan);
  }
}

async function init() {
  render();
  try {
    const session = await api.session();
    state.authenticated = Boolean(session.authenticated);
    render();
    if (state.authenticated) await loadPlan();
  } catch {
    state.authenticated = false;
    render();
  }
}

void init();
