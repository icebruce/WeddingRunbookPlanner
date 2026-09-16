/*
 * F17 — the server used to write nothing at all, so a production failure left
 * no trace beyond a 500 in the browser. These check both halves of the answer:
 * that something is written, and that what is written gives nothing away.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { hashIp, log } from '../../lib/server/log.js';
import { respondWithError } from '../../lib/server/respond.js';
import { ValidationError } from '../../lib/server/validate.js';

/** Runs `body` with console.error captured, and returns the parsed lines. */
function captured(body) {
  const lines = [];
  const original = console.error;
  console.error = message => lines.push(message);
  try {
    body();
  } finally {
    console.error = original;
  }
  return lines.map(line => JSON.parse(line));
}

function fakeResponse() {
  const res = { statusCode: null, headers: {}, body: null };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.writeHead = (code, headers) => { res.statusCode = code; Object.assign(res.headers, headers); };
  res.end = payload => { res.body = payload; };
  return res;
}

test('F17: an error is one JSON line with a route, a code and a time', () => {
  const [line] = captured(() => log.error('plan', 'server_error', new Error('Upstash unreachable')));

  assert.equal(line.level, 'error');
  assert.equal(line.route, 'plan');
  assert.equal(line.code, 'server_error');
  assert.equal(line.message, 'Upstash unreachable');
  assert.ok(!Number.isNaN(Date.parse(line.at)));
});

test('F17: an error is reduced to its message, never its payload', () => {
  const error = new Error('save failed');
  error.plan = { activities: [{ title: 'Getting Ready' }] };
  error.password = 'hunter2';

  const [line] = captured(() => log.error('plan', 'server_error', error));

  const text = JSON.stringify(line);
  assert.ok(!text.includes('Getting Ready'), 'no plan content');
  assert.ok(!text.includes('hunter2'), 'no secrets');
});

test('F17: empty fields are left out rather than written as null', () => {
  const [line] = captured(() => log.warn('login', 'rate_limited', 'too many attempts', { ip: null, tries: 11 }));

  assert.equal('ip' in line, false);
  assert.equal(line.tries, 11);
});

test('F17: an address is counted by a salted hash, never stored', () => {
  process.env.SESSION_SECRET = 'test-secret-0123456789abcdef';
  const hash = hashIp('203.0.113.9');

  assert.notEqual(hash, '203.0.113.9');
  assert.equal(hash.length, 12);
  assert.equal(hash, hashIp('203.0.113.9'), 'the same address counts as the same');
  assert.notEqual(hash, hashIp('203.0.113.10'));
  assert.equal(hashIp(null), null);
});

test('F17: rejected input is logged by field name, never by value', () => {
  const lines = captured(() =>
    respondWithError(fakeResponse(), 'plan', new ValidationError('invalid_plan', "Name can't be empty.", 'title')));

  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'warn');
  assert.equal(lines[0].field, 'title');
  assert.equal(lines[0].message, 'rejected invalid input');
});

test('F17: a 500 tells the log what happened and the browser nothing', () => {
  const res = fakeResponse();
  const lines = captured(() => respondWithError(res, 'plan', new Error('redis: ECONNREFUSED 10.0.0.4:6379')));

  assert.equal(lines[0].message, 'redis: ECONNREFUSED 10.0.0.4:6379');
  assert.equal(res.statusCode, 500);
  assert.ok(!String(res.body).includes('ECONNREFUSED'), 'the address stays out of the response');
  assert.match(String(res.body), /Something went wrong/);
});
