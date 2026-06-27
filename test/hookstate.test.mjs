import { test } from 'node:test'; import assert from 'node:assert/strict';
import { makeTempRepo, seeksRun } from './helpers.mjs'; import fs from 'node:fs';
import { bumpFire, readHookState, isFresh, seedHeartbeat, staleHeartbeat } from '../hooks/lib/hookstate.mjs';
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
