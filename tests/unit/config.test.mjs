import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAN_STATUSES, STAGES } from '../../public/src/config.js';
import { PLAN_STATUSES as VALIDATED_STATUSES, STAGE_IDS } from '../../public/src/validate.js';

test('the stage picker and the server allowlist describe the same stages', () => {
  assert.deepEqual(STAGES.map(stage => stage.id).sort(), [...STAGE_IDS].sort());
});

test('plan statuses come from one place', () => {
  assert.deepEqual(PLAN_STATUSES, VALIDATED_STATUSES);
});

test('every stage has a label, a colour, a tint and an icon', () => {
  for (const stage of STAGES) {
    assert.ok(stage.label, `${stage.id} needs a label`);
    assert.match(stage.color, /^#[0-9a-f]{6}$/i);
    assert.match(stage.tint, /^#[0-9a-f]{6}$/i);
    assert.ok(stage.icon);
  }
});
