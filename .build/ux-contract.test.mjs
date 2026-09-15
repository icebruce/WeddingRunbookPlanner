import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('activity cards use selection before editing', () => {
  assert.match(app, /aria-selected=/);
  assert.match(app, /addEventListener\('dblclick'/);
  assert.match(app, /function selectActivity/);
});

test('inline stage, lock and overflow controls are present', () => {
  assert.match(app, /stage-menu-toggle/);
  assert.match(app, /lock-button/);
  assert.match(app, /card-menu-toggle/);
  assert.match(css, /\.lock-button\.is-locked/);
});

test('people editor uses chips instead of a free-form people field', () => {
  assert.match(app, /people-editor/);
  assert.match(app, /person-chip/);
  assert.doesNotMatch(app, /<input name="people"/);
});

test('timeline exposes 15, 30 and 60 minute visual hierarchy', () => {
  assert.match(app, /timeline-tick--\$\{kind\}/);
  assert.match(css, /\.timeline-tick--hour/);
  assert.match(css, /\.timeline-tick--half/);
  assert.match(css, /\.timeline-tick--quarter/);
});

test('duration entry does not use browser 5-minute step validation', () => {
  const durationInput = app.match(/<input name="duration"[^>]+>/)?.[0] || '';
  assert.ok(durationInput);
  assert.doesNotMatch(durationInput, /step="5"/);
  assert.match(app, /Rounded up to the next 5 minutes/);
});
