import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function assertResults(plan, needs) {
  for (const job of ['plan', 'source'])
    assert.equal(needs[job]?.result, 'success', `${job} must succeed`);
  for (const job of ['products', 'raster', 'companion']) {
    assert.equal(typeof plan[job], 'boolean', `Missing selection: ${job}`);
    assert.equal(needs[job]?.result, plan[job] ? 'success' : 'skipped', `Unexpected ${job} result`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const needs = JSON.parse(process.env.CI_NEEDS);
  const outputs = needs.plan.outputs;
  assertResults(
    Object.fromEntries(
      ['products', 'raster', 'companion'].map((job) => [job, JSON.parse(outputs[job])]),
    ),
    needs,
  );
  console.log('Every selected check succeeded; unselected checks were explicitly skipped.');
}
