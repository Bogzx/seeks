import { test } from 'node:test'; import assert from 'node:assert/strict';
import { DEFAULT_LENSES, nextLens } from '../hooks/lib/lenses.mjs';

test('nextLens: empty used → first lens', () => {
  assert.equal(nextLens([]), DEFAULT_LENSES[0]);
});
test('nextLens: returns the first UNUSED lens', () => {
  assert.equal(nextLens([DEFAULT_LENSES[0], DEFAULT_LENSES[1]]), DEFAULT_LENSES[2]);
});
test('nextLens: all used → least-recently-used', () => {
  assert.equal(nextLens([...DEFAULT_LENSES]), DEFAULT_LENSES[0]);              // first used earliest → LRU
  assert.equal(nextLens([...DEFAULT_LENSES, DEFAULT_LENSES[0]]), DEFAULT_LENSES[1]); // re-using #0 makes #1 the LRU
});
test('nextLens: custom set respected', () => {
  assert.equal(nextLens(['a'], ['a','b','c']), 'b');
});
test('catalog is large and keeps the original six first', () => {
  assert.ok(DEFAULT_LENSES.length >= 14, `catalog too small: ${DEFAULT_LENSES.length}`);
  assert.deepEqual(DEFAULT_LENSES.slice(0,6),
    ['concurrency','error-handling','boundary','resource-lifecycle','serialization','input-trust']);
  assert.ok(DEFAULT_LENSES.includes('security-injection'));
  assert.ok(DEFAULT_LENSES.includes('performance'));
});
test('nextLens is breadth-first: every lens before any repeat', () => {
  const used = [];
  for (let i=0;i<DEFAULT_LENSES.length;i++){ const l = nextLens(used, DEFAULT_LENSES); assert.ok(!used.includes(l)); used.push(l); }
  assert.equal(new Set(used).size, DEFAULT_LENSES.length); // covered all before repeating
});
