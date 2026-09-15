export const DEFAULT_DATA = {
  revision: 1,
  updatedAt: null,
  plan: {
    id: 'wedding-day',
    title: 'Wedding Day',
    coupleLabel: 'Our Wedding',
    date: '2026-11-21',
    dayStart: '11:30',
    status: 'Working',
    activities: [
      { id: 'getting-ready', title: 'Getting Ready', duration: 45, stage: 'preparation', location: 'Getting-ready location · TBD', people: ['Bride', 'Mothers'], notes: '', lockedStart: null },
      { id: 'photographer-arrives', title: 'Photographer Arrives & Details', duration: 30, stage: 'photography', location: 'Getting-ready location · TBD', people: ['Bride', 'Photographer'], notes: '', lockedStart: '12:15' },
      { id: 'portraits', title: 'Getting-ready Portraits', duration: 30, stage: 'photography', location: 'Getting-ready location · TBD', people: ['Bride', 'Photographer'], notes: '', lockedStart: null },
      { id: 'travel-church', title: 'Travel to Church', duration: 35, stage: 'transition', location: 'St. Peter and Paul Orthodox Sobor', people: ['Bride', 'Wedding Party'], notes: '', lockedStart: null },
      { id: 'church-buffer', title: 'Arrival & Buffer', duration: 25, stage: 'buffer', location: 'St. Peter and Paul Orthodox Sobor', people: ['Bride', 'Wedding Party'], notes: '', lockedStart: null },
      { id: 'ceremony', title: 'Ceremony', duration: 60, stage: 'ceremony', location: 'St. Peter and Paul Orthodox Sobor', people: ['Bride', 'Groom', 'Family', 'Guests'], notes: '', lockedStart: '14:45' },
      { id: 'travel-richmond', title: 'Travel to Le Richmond', duration: 15, stage: 'transition', location: 'Le Richmond · Griffintown', people: ['Bride', 'Groom'], notes: '', lockedStart: null },
      { id: 'cocktail-hour', title: 'Cocktail Hour', duration: 75, stage: 'cocktail', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', lockedStart: '16:00' },
      { id: 'reception', title: 'Reception', duration: 60, stage: 'reception', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', lockedStart: null },
      { id: 'dinner', title: 'Dinner', duration: 90, stage: 'dinner', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', lockedStart: null },
      { id: 'party', title: 'Dancing & Party', duration: 180, stage: 'party', location: 'Le Richmond · Griffintown', people: ['All Guests'], notes: '', lockedStart: null }
    ]
  },
  versions: []
};
