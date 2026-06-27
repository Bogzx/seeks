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
