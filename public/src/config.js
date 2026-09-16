// Stage ids and plan statuses come from the shared validation module so the
// picker can never offer a value the server would reject.
import { PLAN_STATUSES, STAGE_IDS } from './validate.js';

export { PLAN_STATUSES };

export const STAGES = [
  { id: 'preparation', label: 'Preparation', color: '#8b72f2', tint: '#f0ecff', icon: 'sparkles' },
  { id: 'first-look', label: 'First Look', color: '#ef5875', tint: '#fff0f3', icon: 'heart' },
  { id: 'photography', label: 'Photography', color: '#7357eb', tint: '#f0edff', icon: 'camera' },
  { id: 'transition', label: 'Transition', color: '#4a9be8', tint: '#eaf5ff', icon: 'car' },
  { id: 'buffer', label: 'Buffer', color: '#8c939d', tint: '#f0f1f3', icon: 'clock' },
  { id: 'ceremony', label: 'Ceremony', color: '#ef4d65', tint: '#fff0f2', icon: 'rings' },
  { id: 'celebration', label: 'Celebration', color: '#e5a02c', tint: '#fff6e5', icon: 'party' },
  { id: 'cocktail', label: 'Cocktail', color: '#c97837', tint: '#fff2e7', icon: 'glass' },
  { id: 'reception', label: 'Reception', color: '#5b9d74', tint: '#edf8f0', icon: 'table' },
  { id: 'dinner', label: 'Dinner', color: '#718f64', tint: '#eff6ec', icon: 'fork' },
  { id: 'party', label: 'Party', color: '#a65eb4', tint: '#f8edf9', icon: 'music' }
];

// A mismatch here would let the editor offer a stage the server rejects.
const configured = new Set(STAGES.map(stage => stage.id));
for (const id of STAGE_IDS) {
  if (!configured.has(id)) throw new Error(`Stage "${id}" is missing from STAGES`);
}

/** A random id for this browser, used only to say "another device". */
const DEVICE_KEY = 'wrp:device-id';

export function deviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = `d-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    // Private mode, or storage disabled: an in-memory id is still useful for
    // the life of this tab.
    return `d-ephemeral-${Math.random().toString(36).slice(2, 10)}`;
  }
}
