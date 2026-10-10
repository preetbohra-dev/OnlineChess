import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { vendorPlan } from '../../scripts/vendor.mjs';

test('committed public/vendor files are byte-identical to node_modules', () => {
  const plan = vendorPlan();
  assert.ok(plan.length > 0);
  for (const { src, dest } of plan) {
    assert.ok(fs.existsSync(dest), `missing vendored file ${dest} (run npm run vendor)`);
    assert.ok(fs.readFileSync(src).equals(fs.readFileSync(dest)), `${dest} differs from ${src}`);
  }
});
