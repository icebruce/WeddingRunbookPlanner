import { DEFAULT_SUNSET } from './validate.js';

/**
 * The timeline a brand-new store is seeded with. Server-only: it lives outside
 * public/ so it is not downloadable from the site (F8).
 *
 * Every activity carries its own `start`, in minutes from midnight on the
 * plan's date — 690 is 11:30 AM. `locked` activities (the photographer's
 * arrival, the ceremony, cocktail hour) are the ones a group move leaves in
 * place; nothing here auto-arranges around them.
 */
export const SEED_PLAN = {
  id: 'wedding-day',
  title: 'Wedding Day',
  coupleLabel: 'Our Wedding',
  date: '2026-11-21',
  sunset: DEFAULT_SUNSET,
  status: 'Working',
  activities: [
    { id: 'getting-ready', title: 'Getting Ready', start: 690, duration: 45, stage: 'preparation', location: 'Getting-ready location · TBD', people: ['Bride', 'Mothers'], notes: '', locked: false },
    { id: 'photographer-arrives', title: 'Photographer Arrives & Details', start: 735, duration: 30, stage: 'photography', location: 'Getting-ready location · TBD', people: ['Bride', 'Photographer'], notes: '', locked: true },
    { id: 'portraits', title: 'Getting-ready Portraits', start: 765, duration: 30, stage: 'photography', location: 'Getting-ready location · TBD', people: ['Bride', 'Photographer'], notes: '', locked: false },
    { id: 'travel-church', title: 'Travel to Church', start: 795, duration: 35, stage: 'transition', location: 'St. Peter and Paul Orthodox Sobor', people: ['Bride', 'Wedding Party'], notes: '', locked: false },
    { id: 'church-buffer', title: 'Arrival & Buffer', start: 830, duration: 25, stage: 'buffer', location: 'St. Peter and Paul Orthodox Sobor', people: ['Bride', 'Wedding Party'], notes: '', locked: false },
    { id: 'ceremony', title: 'Ceremony', start: 885, duration: 60, stage: 'ceremony', location: 'St. Peter and Paul Orthodox Sobor', people: ['Bride', 'Groom', 'Family', 'Guests'], notes: '', locked: true },
    { id: 'travel-richmond', title: 'Travel to Le Richmond', start: 945, duration: 15, stage: 'transition', location: 'Le Richmond · Griffintown', people: ['Bride', 'Groom'], notes: '', locked: false },
    { id: 'cocktail-hour', title: 'Cocktail Hour', start: 960, duration: 75, stage: 'cocktail', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', locked: true },
    { id: 'reception', title: 'Reception', start: 1035, duration: 60, stage: 'reception', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', locked: false },
    { id: 'dinner', title: 'Dinner', start: 1095, duration: 90, stage: 'dinner', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', locked: false },
    { id: 'party', title: 'Dancing & Party', start: 1185, duration: 180, stage: 'party', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', locked: false }
  ]
};

export function createSeedEnvelope(now = new Date()) {
  return {
    revision: 1,
    updatedAt: now.toISOString(),
    updatedBy: null,
    plan: structuredClone(SEED_PLAN),
    versions: []
  };
}
