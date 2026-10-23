import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const selectedJobs = {
  products: ['products', 'ui-tests', 'repository-tests', 'stream-info-tests'],
  raster: ['raster'],
  companion: ['companion'],
};

export function assertResults(plan, needs) {
  for (const job of ['plan', 'source'])
    assert.equal(needs[job]?.result, 'success', `${job} must succeed`);
  for (const [selection, jobs] of Object.entries(selectedJobs)) {
    assert.equal(typeof plan[selection], 'boolean', `Missing selection: ${selection}`);
    for (const job of jobs)
      assert.equal(
        needs[job]?.result,
        plan[selection] ? 'success' : 'skipped',
        `Unexpected ${job} result`,
      );
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const needs = JSON.parse(process.env.CI_NEEDS);
  const outputs = needs.plan.outputs;
  assertResults(
    Object.fromEntries(Object.keys(selectedJobs).map((job) => [job, JSON.parse(outputs[job])])),
    needs,
  );
  console.log('Every selected check succeeded; unselected checks were explicitly skipped.');
}
