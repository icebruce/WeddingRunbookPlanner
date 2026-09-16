// Stage ids and plan statuses come from the shared validation module so the
// picker can never offer a value the server would reject.
import { PLAN_STATUSES, STAGE_IDS } from './validate.js';

export { PLAN_STATUSES };

/*
 * Eleven stages, six phase colours. The colours themselves live in tokens.css
 * — these are the token names, so a stage carries its phase rather than a hex,
 * and the dark palette is a matter of redefining the token.
 */
const PHASE = {
  preparation: 'prep',
  'first-look': 'photo',
  photography: 'photo',
  transition: 'transit',
  buffer: 'transit',
  ceremony: 'ceremony',
  celebration: 'cocktail',
  cocktail: 'cocktail',
  reception: 'reception',
  dinner: 'reception',
  party: 'reception'
};

export const STAGES = [
  { id: 'preparation', label: 'Preparation', icon: 'sparkles' },
  { id: 'first-look', label: 'First Look', icon: 'heart' },
  { id: 'photography', label: 'Photography', icon: 'camera' },
  { id: 'transition', label: 'Transition', icon: 'car' },
  { id: 'buffer', label: 'Buffer', icon: 'clock' },
  { id: 'ceremony', label: 'Ceremony', icon: 'rings' },
  { id: 'celebration', label: 'Celebration', icon: 'party' },
  { id: 'cocktail', label: 'Cocktail', icon: 'glass' },
  { id: 'reception', label: 'Reception', icon: 'table' },
  { id: 'dinner', label: 'Dinner', icon: 'fork' },
  { id: 'party', label: 'Party', icon: 'music' }
].map(stage => ({
  ...stage,
  phase: PHASE[stage.id],
  color: `var(--phase-${PHASE[stage.id]})`,
  tint: `var(--phase-${PHASE[stage.id]}-tint)`
}));

/**
 * The two custom properties every element that shows a phase needs. The tag's
 * background is mixed on the element itself, so both have to be set there: a
 * custom property is resolved where it is declared.
 */
export function phaseVars(stage) {
  return `--phase:${stage.color};--phase-tint:${stage.tint};`;
}

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
