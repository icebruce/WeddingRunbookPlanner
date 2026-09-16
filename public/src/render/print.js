/**
 * Printing (D18).
 *
 * A printed plan is a different thing from the screen one: nobody hands a
 * photographer a scale drawing of the day. It is a list, grouped by phase,
 * with the times, who is involved, and any notes — the things somebody
 * holding a sheet of paper at a venue actually needs.
 *
 * It honours the person filter, because "print my part" is the whole reason
 * to print at all.
 */
import { escapeHtml } from '../dom.js';
import { STAGES } from '../config.js';
import { buildSchedule, formatDuration, formatTime } from '../schedule.js';

const PHASES = [
  { id: 'prep', label: 'Getting ready', stages: ['preparation'], colour: '#7A66E8' },
  { id: 'photo', label: 'Photos', stages: ['first-look', 'photography'], colour: '#1F8A9B' },
  { id: 'transit', label: 'Travel and buffer', stages: ['transition', 'buffer'], colour: '#6F7885' },
  { id: 'ceremony', label: 'Ceremony', stages: ['ceremony'], colour: '#A67C0F' },
  { id: 'cocktail', label: 'Cocktail and celebration', stages: ['celebration', 'cocktail'], colour: '#C44E78' },
  { id: 'reception', label: 'Reception', stages: ['reception', 'dinner', 'party'], colour: '#3F8A57' }
];

const stageLabel = id => STAGES.find(stage => stage.id === id)?.label ?? id;
const phaseOf = stage => PHASES.find(phase => phase.stages.includes(stage)) ?? PHASES[0];

export function renderPrint({ plan, ui }) {
  const schedule = buildSchedule(plan);
  const items = ui.filter
    ? schedule.items.filter(item => (item.people || []).includes(ui.filter))
    : schedule.items;

  const date = new Date(`${plan.date}T12:00:00`);
  const dateLabel = Number.isNaN(date.getTime())
    ? plan.date
    : new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);

  // Groups appear in the order the day runs, not in the order of the list.
  const groups = PHASES
    .map(phase => ({ phase, items: items.filter(item => phaseOf(item.stage).id === phase.id) }))
    .filter(group => group.items.length);

  return `<div class="print-sheet">
    <header class="print-header">
      <div>
        <p class="print-planner">${escapeHtml(plan.coupleLabel || 'Our Wedding')}</p>
        <h1>${escapeHtml(plan.title)}</h1>
        <p class="print-date">${escapeHtml(dateLabel)}</p>
      </div>
      <dl class="print-facts">
        <div><dt>Runs</dt><dd>${escapeHtml(formatTime(schedule.summary.start))} – ${escapeHtml(formatTime(schedule.summary.end))}</dd></div>
        <div><dt>Activities</dt><dd>${items.length}</dd></div>
        ${plan.sunset ? `<div><dt>Sunset</dt><dd>${escapeHtml(formatTime(toMinutes(plan.sunset)))}</dd></div>` : ''}
        ${ui.filter ? `<div><dt>Showing</dt><dd>${escapeHtml(ui.filter)}</dd></div>` : ''}
        <div><dt>Printed</dt><dd>${escapeHtml(new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date()))}</dd></div>
      </dl>
    </header>

    ${groups.map(group => `<section class="print-group">
      <h2><span class="print-swatch" style="background:${group.phase.colour}"></span>${escapeHtml(group.phase.label)}</h2>
      ${group.items.map(item => `<article class="print-row">
        <div class="print-time">
          <strong>${escapeHtml(item.rangeLabel)}</strong>
          <span>${escapeHtml(formatDuration(item.duration))}</span>
        </div>
        <div class="print-details">
          <h3>${escapeHtml(item.title)}${item.locked ? '<span class="print-fixed">Locked</span>' : ''}</h3>
          <p class="print-stage">${escapeHtml(stageLabel(item.stage))}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</p>
          ${item.people?.length ? `<p class="print-people">${escapeHtml(item.people.join(', '))}</p>` : ''}
          ${item.notes ? `<p class="print-notes">${escapeHtml(item.notes)}</p>` : ''}
        </div>
      </article>`).join('')}
    </section>`).join('')}

    ${items.length ? '' : '<p class="print-empty">Nothing to print for this filter.</p>'}
  </div>`;
}

function toMinutes(value) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
