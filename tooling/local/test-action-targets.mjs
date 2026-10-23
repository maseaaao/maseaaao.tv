import assert from 'node:assert/strict';
import { validateActionTargets as check } from './action-targets.mjs';

const a = {
  id: 'a',
  name: 'test',
  enabled: true,
  subActions: [{ type: 34, enabled: true, sceneName: 'Scene' }],
};
assert.equal(check([a], [], []).issues.length, 1);
assert.equal(check([a], ['Scene'], []).issues.length, 0);
assert.equal(check([{ ...a, enabled: false }], [], []).issues.length, 0);
assert.equal(
  check([{ ...a, subActions: [{ actionId: 'missing', enabled: true }] }], [], []).issues.length,
  1,
);
assert.equal(
  check([{ ...a, subActions: [{ inputName: 'Mic', enabled: true }] }], [], []).issues.length,
  1,
);
assert.equal(
  check([{ ...a, subActions: [{ type: 34, sceneName: '%dynamic%', enabled: true }] }], [], [])
    .warnings.length,
  1,
);
console.log(
  'PASS: missing scene/input/Action, existing scene, disabled Action and dynamic scene; no live requests.',
);
