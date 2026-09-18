/**
 * Light or dark, chosen in the app and remembered on the device (D21).
 *
 * Not a media query: the app does not follow the system setting, so a plan
 * read in a dark room at a venue and the same plan on a laptop look like the
 * same plan. Shared with the read-only page, which offers the same choice with
 * none of the rest of the app around it.
 */
const THEME_KEY = 'wrp:theme';

export function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function writeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme === 'dark' ? 'dark' : 'light');
  } catch {
    // Without storage the choice lasts as long as the tab, which is better
    // than refusing to make it.
  }
}

/**
 * The colour the browser paints its own chrome with — the bar behind the clock
 * on a phone, the title bar of an installed app. It follows the choice made in
 * the app, for the same reason the rest of it does.
 */
export function paintBrowserChrome(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.setAttribute('content', theme === 'dark' ? '#111214' : '#F7F7F4');
}
