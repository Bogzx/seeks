import { test } from 'node:test'; import assert from 'node:assert/strict';
import { add } from '../src/add.mjs';
test('add sums two numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
  assert.equal(add(0.1, 0.2), 0.30000000000000004);
});
