import { test } from 'node:test'; import assert from 'node:assert/strict';
import { parseDuration, deadlineMs, pastDeadline } from '../hooks/lib/budget.mjs';

test('parseDuration handles units and bare seconds', () => {
  assert.equal(parseDuration('30s'), 30);
  assert.equal(parseDuration('2m'), 120);
  assert.equal(parseDuration('8h'), 28800);
  assert.equal(parseDuration('1d'), 86400);
  assert.equal(parseDuration('90'), 90);      // bare = seconds
  assert.equal(parseDuration(45), 45);        // number passthrough
  assert.equal(parseDuration('1.5h'), 5400);
});
test('parseDuration returns null on junk/empty', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration('soon'), null);
});
test('deadlineMs needs both started_at and time_budget_sec', () => {
  assert.equal(deadlineMs({}), null);
  assert.equal(deadlineMs({ started_at: 1000 }), null);
  assert.equal(deadlineMs({ started_at: 1000, time_budget_sec: 5 }), 6000);
});
test('pastDeadline is false without a budget, true once elapsed', () => {
  assert.equal(pastDeadline({}, 1e15), false);
  assert.equal(pastDeadline({ started_at: 1000, time_budget_sec: 5 }, 5999), false);
  assert.equal(pastDeadline({ started_at: 1000, time_budget_sec: 5 }, 6000), true);
});
