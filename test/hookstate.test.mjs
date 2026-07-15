import { test } from 'node:test'; import assert from 'node:assert/strict';
import { makeTempRepo, seeksRun } from './helpers.mjs'; import fs from 'node:fs';
import { bumpFire, readHookState, isFresh, seedHeartbeat, staleHeartbeat, resetFires, latchRelease } from '../hooks/lib/hookstate.mjs';
const mk = () => { const rd = seeksRun(makeTempRepo(),'x'); fs.mkdirSync(rd,{recursive:true}); return rd; };
test('bumpFire increments + sets heartbeat', () => {
  const rd = mk(); bumpFire(rd,'s1',1000); const hs = bumpFire(rd,'s1',2000);
  assert.equal(hs.stop_fires, 2); assert.equal(hs.last_heartbeat, 2000); assert.equal(hs.session_id,'s1');
});
test('isFresh respects ttl; stale after release', () => {
  const rd = mk(); seedHeartbeat(rd, 0);
  assert.equal(isFresh(rd, 100, 1000), true);
  assert.equal(isFresh(rd, 2000, 1000), false);
  seedHeartbeat(rd, 5000); staleHeartbeat(rd);
  assert.equal(isFresh(rd, 5001, 1000), false);
});
test('resetFires zeroes stop_fires but preserves heartbeat', () => {
  const rd = mk(); bumpFire(rd,'s1',1000); bumpFire(rd,'s1',2000);
  assert.equal(readHookState(rd).stop_fires, 2);
  resetFires(rd);
  assert.equal(readHookState(rd).stop_fires, 0);
  assert.equal(readHookState(rd).last_heartbeat, 2000);
});
test('latchRelease records the terminal kind; resetFires re-activates', () => {
  const rd = mk(); bumpFire(rd,'s1',1000);
  latchRelease(rd,'done',2000);
  const h = readHookState(rd);
  assert.equal(h.released, 'done'); assert.equal(h.released_at, 2000);
  assert.equal(h.stop_fires, 1, 'the latch preserves the counter');
  resetFires(rd);
  const r = readHookState(rd);
  assert.equal(r.stop_fires, 0);
  assert.ok(!r.released, '/seeks:start (reset-fires) clears the latch so the loop can run again');
});
