const attrs = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';

const paths = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  lock: '<rect x="6.5" y="10" width="11" height="9" rx="2"/><path d="M9 10V7.5a3 3 0 0 1 6 0V10"/>',
  pin: '<path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a2.5 2.5 0 0 1 0 5M16.5 14a4.3 4.3 0 0 1 4 5"/>',
  heart: '<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>',
  camera: '<path d="M4 7.5h3l1.5-2h7L17 7.5h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  car: '<path d="m5 11 1.8-4h10.4l1.8 4M4 11h16v6H4Z"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  rings: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/><path d="M12 5.5 14 3l2 2.5"/>',
  party: '<path d="m5 19 4-12 8 8Z"/><path d="M15 4h.01M19 8h.01M12 2v3M19 3l-2 2M21 12h-3"/>',
  glass: '<path d="M7 4h10l-1 7a4 4 0 0 1-8 0Z"/><path d="M12 15v5M9 20h6"/>',
  table: '<path d="M5 10h14v8H5Z"/><path d="M8 10V6h8v4M8 18v3M16 18v3"/>',
  fork: '<path d="M7 3v7M4 3v5a3 3 0 0 0 6 0V3M7 10v11M16 3v18M16 3c3 2 3 7 0 9"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2ZM6 13l.8 2.2L9 16l-2.2.8L6 19l-.8-2.2L3 16l2.2-.8Z"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M9 12h9"/>',
  warning: '<path d="M12 3 2.5 20h19Z"/><path d="M12 9v4M12 17h.01"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  save: '<path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>'
};

export function icon(name, className = '') {
  return `<svg class="icon ${className}" ${attrs}>${paths[name] || paths.sparkles}</svg>`;
}
