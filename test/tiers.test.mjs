import { test } from 'node:test'; import assert from 'node:assert/strict';
import { TIERS, resolveTier, DEFAULT_TIER } from '../hooks/lib/tiers.mjs';

test('DEFAULT_TIER is balanced', () => assert.equal(DEFAULT_TIER, 'balanced'));
test('resolveTier returns the named preset; unknown → default', () => {
  assert.equal(resolveTier('light').roles.verifier.model, 'sonnet');
  assert.equal(resolveTier('all-out').roles.verifier.effort, 'max');
  assert.equal(resolveTier('balanced').roles.maker.model, 'opus');
  assert.equal(resolveTier('balanced').roles.verifier.model, 'opus');
  assert.deepEqual(resolveTier('nonsense'), TIERS[DEFAULT_TIER]);
});
test('every preset has all 5 roles + the three knobs', () => {
  for (const [name, p] of Object.entries(TIERS)){
    for (const r of ['maker','intake','analyzer','verifier','triage'])
      assert.ok(p.roles[r] && p.roles[r].model && p.roles[r].effort, `${name}.${r}`);
    assert.equal(typeof p.max_iters, 'number');
    assert.equal(typeof p.max_iters_openended, 'number');
    assert.equal(typeof p.min_dry_sweeps, 'number');
  }
});
test('tiers scale up on max_iters', () => {
  assert.ok(TIERS.light.max_iters < TIERS.balanced.max_iters);
  assert.ok(TIERS.balanced.max_iters < TIERS['all-out'].max_iters);
});
