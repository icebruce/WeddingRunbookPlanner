import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { STAGES } from '../../public/src/config.js';
import { STAGE_IDS } from '../../public/src/validate.js';

test('the stage picker and the server allowlist describe the same stages', () => {
  assert.deepEqual(STAGES.map(stage => stage.id).sort(), [...STAGE_IDS].sort());
});

test('every stage has a label, a phase colour, a tint and an icon', () => {
  // The colours themselves live in tokens.css; a stage names one. A name with
  // no token behind it resolves to nothing at all, which is why this reads the
  // stylesheet rather than trusting the shape of the string.
  const tokens = readFileSync(new URL('../../public/styles/tokens.css', import.meta.url), 'utf8');
  for (const stage of STAGES) {
    assert.ok(stage.label, `${stage.id} needs a label`);
    assert.match(stage.color, /^var\(--phase-[a-z]+\)$/);
    assert.match(stage.tint, /^var\(--phase-[a-z]+-tint\)$/);
    assert.ok(tokens.includes(`  --phase-${stage.phase}: #`), `--phase-${stage.phase} is not a token`);
    assert.ok(tokens.includes(`  --phase-${stage.phase}-tint: #`), `--phase-${stage.phase}-tint is not a token`);
    assert.ok(stage.icon);
  }
});
