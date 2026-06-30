import { test } from 'node:test'; import assert from 'node:assert/strict';
import { sweepProgress, sweepSatisfied } from '../hooks/lib/sweep.mjs';

test('until-dry mode: satisfied when dry_sweeps >= min_dry_sweeps', () => {
  assert.equal(sweepSatisfied({ min_dry_sweeps:2, dry_sweeps:1 }), false);
  assert.equal(sweepSatisfied({ min_dry_sweeps:2, dry_sweeps:2 }), true);
  const p = sweepProgress({ min_dry_sweeps:3, dry_sweeps:1 });
  assert.equal(p.mode, 'until-dry'); assert.equal(p.satisfied, false); assert.equal(p.label, 'sweep 1/3 dry');
});
test('no sweep configured → mode none, satisfied (fail-open), empty label', () => {
  const p = sweepProgress({});
  assert.equal(p.mode, 'none'); assert.equal(p.satisfied, true); assert.equal(p.label, '');
});
test('exhaustive mode: satisfied keys off dry_depth_rounds, NOT dry_sweeps', () => {
  assert.equal(sweepSatisfied({ exhaustive:true, dry_sweeps:99 }), false, 'dry sweeps never satisfy an exhaustive loop');
  assert.equal(sweepSatisfied({ exhaustive:true, dry_depth_rounds:1 }), false, '1 < default target 2');
  assert.equal(sweepSatisfied({ exhaustive:true, dry_depth_rounds:2 }), true);
  assert.equal(sweepSatisfied({ exhaustive:true, dry_depth_rounds:1, min_dry_depth_rounds:1 }), true);
});
test('exhaustive label shows depth, dry-round progress, and catalog coverage', () => {
  const p = sweepProgress({ exhaustive:true, depth:2, dry_depth_rounds:1, min_dry_depth_rounds:2,
    sweep_lenses:['a','b','c','d'], dry_lenses:['a','b'] });
  assert.equal(p.mode, 'exhaustive');
  assert.equal(p.catalog_size, 4); assert.equal(p.catalog_covered, 2);
  assert.match(p.label, /depth 2/); assert.match(p.label, /dry-round 1\/2/); assert.match(p.label, /catalog 2\/4/);
});
test('sweepSatisfied is exactly the predicate the gate uses (mirror)', () => {
  // these mirror gate.test.mjs cases so the gate and the maker/banner can never diverge
  assert.equal(sweepSatisfied({}), true);                                         // legacy fail-open
  assert.equal(sweepSatisfied({ exhaustive:true, dry_sweeps:99, dry_depth_rounds:0 }), false);
});
