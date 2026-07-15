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
  const blocked = decide({ ...d, level:'L3' }, hs(1));
  assert.equal(blocked.action, 'block');                                             // L3 not delivered → block
  assert.match(blocked.reason, /seeks deliver/);                                     // …with a delivery-specific nudge (M2)
  assert.equal(decide({ ...d, level:'L3', delivered:true }, hs(1)).stopKind, 'done'); // delivered → done
});
test('L3 undelivered still halts at max_iters (no infinite block)', () => {
  const d = { ...base, done:true, verifier_certified:true, level:'L3', max_iters:5 };
  assert.equal(decide(d, hs(5)).stopKind, 'max_iters');
});
test('time-budget terminal: past deadline allows + halts', () => {
  const d = { ...base, started_at: 1000, time_budget_sec: 5 };
  assert.equal(decide(d, hs(1), 5999).action, 'block');                 // before deadline → still working
  const r = decide(d, hs(1), 6000);
  assert.equal(r.action, 'allow'); assert.equal(r.stopKind, 'time-budget');
});
test('done still wins over an elapsed budget', () => {
  const d = { ...base, done:true, verifier_certified:true, started_at:1000, time_budget_sec:5 };
  assert.equal(decide(d, hs(1), 6000).stopKind, 'done');
});
test('exhaustive done is gated by dry_depth_rounds, not dry_sweeps', () => {
  const d = { ...base, done:true, verifier_certified:true, exhaustive:true };
  assert.equal(decide({ ...d, dry_sweeps:99 }, hs(1)).action, 'block', 'many dry sweeps is NOT enough when exhaustive');
  assert.equal(decide({ ...d, dry_depth_rounds:1 }, hs(1)).action, 'block', '1 depth round < default 2');
  assert.equal(decide({ ...d, dry_depth_rounds:2 }, hs(1)).stopKind, 'done', '2 depth rounds → satisfied');
});
test('done requires a real executable check when the count is known', () => {
  const d = { ...base, done:true, verifier_certified:true };
  assert.equal(decide({ ...d, executable_condition_count:0 }, hs(1)).action, 'block', 'no runnable check → cannot self-certify done');
  assert.equal(decide({ ...d, executable_condition_count:1 }, hs(1)).stopKind, 'done');
  assert.equal(decide(d, hs(1)).stopKind, 'done', 'legacy (count unset) → fail open, unchanged');
});
test('a no-check loop escalates rather than faking done', () => {
  const d = { ...base, done:true, verifier_certified:true, executable_condition_count:0, needs_human:true };
  assert.equal(decide(d, hs(1)).stopKind, 'needs_human');  // can't done → needs-human is the honest exit
});
test('certified-but-sweep-unsatisfied gives an informative nudge, not the generic block or a self-disarm', () => {
  // exhaustive loop, certified + delivered + oracle-ok, but the depth-round bar is unmet
  const ex = { ...base, done:true, verifier_certified:true, exhaustive:true,
    dry_sweeps:99, depth:1, dry_depth_rounds:0, min_dry_depth_rounds:2 };
  const r = decide(ex, hs(1));
  assert.equal(r.action, 'block');
  assert.doesNotMatch(r.reason, /Do EXACTLY ONE pass/, 'must NOT fall through to the uninformative generic block');
  assert.match(r.reason, /depth-round/i, 'names the actual unmet bar (depth rounds)');
  assert.match(r.reason, /disarm/i, 'tells the maker not to disarm/re-certify');
  // until-dry variant names the dry-sweep shortfall
  const ud = { ...base, done:true, verifier_certified:true, min_dry_sweeps:3, dry_sweeps:1 };
  const r2 = decide(ud, hs(1));
  assert.equal(r2.action, 'block');
  assert.match(r2.reason, /1\/3/);
  assert.doesNotMatch(r2.reason, /Do EXACTLY ONE pass/);
});
test('certified-but-stale-oracle names the oracle bar with a re-verify instruction', () => {
  const d = { ...base, done:true, verifier_certified:true, oracle_live_hash:'abc', oracle_ack_hash:'OLD' };
  const r = decide(d, hs(1));
  assert.equal(r.action, 'block');
  assert.doesNotMatch(r.reason, /Do EXACTLY ONE pass/, 'must NOT fall through to the uninformative generic block');
  assert.match(r.reason, /oracle/i, 'names the actual unmet bar (stale oracle ack)');
  assert.match(r.reason, /verifier/i, 'says how to clear it (re-dispatch the verifier, re-ack)');
  assert.match(r.reason, /disarm/i, 'tells the maker not to disarm');
});
test('stale oracle + unmet sweep bar names the sweep bar (sweeps come before re-verify)', () => {
  const d = { ...base, done:true, verifier_certified:true, oracle_live_hash:'abc', oracle_ack_hash:'OLD',
    min_dry_sweeps:3, dry_sweeps:1 };
  const r = decide(d, hs(1));
  assert.equal(r.action, 'block');
  assert.match(r.reason, /1\/3/, 'the sweep shortfall is the actionable bar while sweeps are unmet');
  assert.doesNotMatch(r.reason, /Do EXACTLY ONE pass/);
});
test('wind-down: near the deadline the block reason says to wrap up', () => {
  const s = { ...base, started_at: 0, time_budget_sec: 1000 };   // deadline 1e6, window 150s
  const r = decide(s, hs(1), 900000);                            // inside wind-down, before deadline
  assert.equal(r.action, 'block');
  assert.match(r.reason, /summary\.md/);
  assert.match(r.reason, /budget/i);
  const normal = decide(s, hs(1), 100000);                       // far from deadline → normal message
  assert.match(normal.reason, /Do EXACTLY ONE pass/);
});
