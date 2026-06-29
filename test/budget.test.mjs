import { test } from 'node:test'; import assert from 'node:assert/strict';
import { parseDuration, deadlineMs, pastDeadline, windDownNear } from '../hooks/lib/budget.mjs';

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
test('windDownNear: inside the last 15% (min 30s), before the deadline', () => {
  const s = { started_at: 0, time_budget_sec: 1000 };       // deadline 1_000_000ms, window=150s
  assert.equal(windDownNear(s, 840000), false);             // before window
  assert.equal(windDownNear(s, 850000), true);              // window start
  assert.equal(windDownNear(s, 999999), true);              // just before deadline
  assert.equal(windDownNear(s, 1000000), false);            // past deadline (that's the terminal, not wind-down)
  assert.equal(windDownNear({}, 5), false);                 // no budget
  const short = { started_at: 0, time_budget_sec: 60 };     // window = max(30, 9) = 30s
  assert.equal(windDownNear(short, 29000), false);
  assert.equal(windDownNear(short, 30000), true);
});
