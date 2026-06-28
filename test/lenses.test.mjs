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
