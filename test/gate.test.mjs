import { test } from 'node:test'; import assert from 'node:assert/strict';
import { decide } from '../hooks/lib/gate.mjs';
const base = { loop:'x', armed:true, needs_human:false, done:false, verifier_certified:false,
  open_items:2, no_progress_count:0, max_iters:50, stuck_threshold:3 };
const hs = (n) => ({ stop_fires:n });
test('blocks while work remains', () => assert.equal(decide(base, hs(1)).action,'block'));
test('done requires verifier_certified', () => {
  assert.equal(decide({ ...base, done:true }, hs(1)).action, 'block');             // not certified → still block
  const r = decide({ ...base, done:true, verifier_certified:true }, hs(1));
  assert.equal(r.action,'allow'); assert.equal(r.stopKind,'done');
});
test('needs_human allows', () => assert.equal(decide({ ...base, needs_human:true }, hs(1)).stopKind,'needs_human'));
test('stuck allows', () => assert.equal(decide({ ...base, no_progress_count:3 }, hs(1)).stopKind,'stuck'));
test('hook backstop allows at max_iters', () => assert.equal(decide(base, hs(50)).stopKind,'max_iters'));
test('disarmed allows', () => assert.equal(decide({ ...base, armed:false }, hs(1)).action,'allow'));
test('done is gated by min_dry_sweeps (legacy unaffected)', () => {
  const d = { ...base, done:true, verifier_certified:true };
  assert.equal(decide(d, hs(1)).stopKind, 'done');                                    // legacy: no min_dry_sweeps → done
  assert.equal(decide({ ...d, min_dry_sweeps:2, dry_sweeps:1 }, hs(1)).action, 'block'); // not enough dry → block
  const r = decide({ ...d, min_dry_sweeps:2, dry_sweeps:2 }, hs(1));
  assert.equal(r.action,'allow'); assert.equal(r.stopKind,'done');                     // enough dry → done
});
test('done is gated by oracle ack==live (when live is present)', () => {
  const d = { ...base, done:true, verifier_certified:true };
  assert.equal(decide(d, hs(1)).stopKind, 'done');                                    // no live hash → legacy/satisfied
  assert.equal(decide({ ...d, oracle_live_hash:'abc', oracle_ack_hash:'abc' }, hs(1)).stopKind, 'done'); // ack matches → done
  assert.equal(decide({ ...d, oracle_live_hash:'abc', oracle_ack_hash:'OLD' }, hs(1)).action, 'block');  // stale ack → block
  assert.equal(decide({ ...d, oracle_live_hash:'abc' }, hs(1)).action, 'block');                          // missing ack → block
});
test('L3 done is gated by delivery', () => {
  const d = { ...base, done:true, verifier_certified:true };
  assert.equal(decide(d, hs(1)).stopKind, 'done');                                   // base has no level → L2 → unaffected
  assert.equal(decide({ ...d, level:'L3' }, hs(1)).action, 'block');                 // L3 not delivered → block
  assert.equal(decide({ ...d, level:'L3', delivered:true }, hs(1)).stopKind, 'done'); // delivered → done
});
