import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decide } from '../hooks/lib/gate.mjs';
const base = { loop:'x', armed:true, needs_human:false, done:false, verifier_certified:false,
  open_items:2, no_progress_count:0, max_iters:50, stuck_threshold:3, conditions:[{ id:'tests', cmd:'npm test' }] };
const OK = { ok:true };   // what the stop hook passes in after it ran the conditions itself and they all passed
const hs = (n) => ({ stop_fires:n });
test('blocks while work remains', () => assert.equal(decide(base, hs(1)).action,'block'));
test('done is released on the gate\'s own condition run — never on status.done', () => {
  assert.equal(decide({ ...base, done:true }, hs(1)).action, 'block', 'status.done is an output of the gate, not an input');
  assert.equal(decide({ ...base, done:true, verifier_certified:true }, hs(1)).action, 'block',
    'a self-written "done + certified" with no gate run of the conditions does not release');
  assert.equal(decide({ ...base, conditions_live:OK }, hs(1)).action, 'block', 'no verifier sign-off → the gate does not even run them');
  const r = decide({ ...base, verifier_certified:true, conditions_live:OK }, hs(1));
  assert.equal(r.action,'allow'); assert.equal(r.stopKind,'done');
});
test('a failing gate run blocks with the failing condition named', () => {
  const r = decide({ ...base, verifier_certified:true, conditions_live:{ ok:false, failed:[{ id:'tests', exit:1, want:0, tail:'1 failing' }] } }, hs(1));
  assert.equal(r.action, 'block');
  assert.match(r.reason, /"tests" failed \(exit 1, expected 0\)/); assert.match(r.reason, /1 failing/);
  assert.match(r.reason, /seeks certify/);
});
test('needs_human allows', () => assert.equal(decide({ ...base, needs_human:true }, hs(1)).stopKind,'needs_human'));
test('stuck allows', () => assert.equal(decide({ ...base, no_progress_count:3 }, hs(1)).stopKind,'stuck'));
test('hook backstop allows at max_iters', () => assert.equal(decide(base, hs(50)).stopKind,'max_iters'));
test('disarmed allows', () => assert.equal(decide({ ...base, armed:false }, hs(1)).action,'allow'));
test('done is gated by min_dry_sweeps (legacy unaffected)', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK };
  assert.equal(decide(d, hs(1)).stopKind, 'done');                                    // legacy: no min_dry_sweeps → done
  assert.equal(decide({ ...d, min_dry_sweeps:2, dry_sweeps:1 }, hs(1)).action, 'block'); // not enough dry → block
  const r = decide({ ...d, min_dry_sweeps:2, dry_sweeps:2 }, hs(1));
  assert.equal(r.action,'allow'); assert.equal(r.stopKind,'done');                     // enough dry → done
});
test('done is gated by oracle ack==live (when live is present)', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK };
  assert.equal(decide(d, hs(1)).stopKind, 'done');                                    // no live hash → legacy/satisfied
  assert.equal(decide({ ...d, oracle_live_hash:'abc', oracle_ack_hash:'abc' }, hs(1)).stopKind, 'done'); // ack matches → done
  assert.equal(decide({ ...d, oracle_live_hash:'abc', oracle_ack_hash:'OLD' }, hs(1)).action, 'block');  // stale ack → block
  assert.equal(decide({ ...d, oracle_live_hash:'abc' }, hs(1)).action, 'block');                          // missing ack → block
});
test('L3 done is gated by delivery', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK };
  assert.equal(decide(d, hs(1)).stopKind, 'done');                                   // base has no level → L2 → unaffected
  const blocked = decide({ ...d, level:'L3' }, hs(1));
  assert.equal(blocked.action, 'block');                                             // L3 not delivered → block
  assert.match(blocked.reason, /seeks deliver/);                                     // …with a delivery-specific nudge (M2)
  assert.equal(decide({ ...d, level:'L3', delivered:true }, hs(1)).stopKind, 'done'); // delivered → done
});
test('L3 undelivered still halts at max_iters (no infinite block)', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK, level:'L3', max_iters:5 };
  assert.equal(decide(d, hs(5)).stopKind, 'max_iters');
});
test('time-budget terminal: past deadline allows + halts', () => {
  const d = { ...base, started_at: 1000, time_budget_sec: 5 };
  assert.equal(decide(d, hs(1), 5999).action, 'block');                 // before deadline → still working
  const r = decide(d, hs(1), 6000);
  assert.equal(r.action, 'allow'); assert.equal(r.stopKind, 'time-budget');
});
test('done still wins over an elapsed budget', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK, started_at:1000, time_budget_sec:5 };
  assert.equal(decide(d, hs(1), 6000).stopKind, 'done');
});
test('exhaustive done is gated by dry_depth_rounds, not dry_sweeps', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK, exhaustive:true };
  assert.equal(decide({ ...d, dry_sweeps:99 }, hs(1)).action, 'block', 'many dry sweeps is NOT enough when exhaustive');
  assert.equal(decide({ ...d, dry_depth_rounds:1 }, hs(1)).action, 'block', '1 depth round < default 2');
  assert.equal(decide({ ...d, dry_depth_rounds:2 }, hs(1)).stopKind, 'done', '2 depth rounds → satisfied');
});
test('no runnable condition → a certify ends in needs-human, never done (fail-closed)', () => {
  const c = { ...base, verifier_certified:true, conditions_live:OK };
  assert.equal(decide({ ...c, conditions:[] }, hs(1)).stopKind, 'needs_human');
  assert.equal(decide({ ...c, conditions:[{ id:'judge', human_required:true }] }, hs(1)).stopKind, 'needs_human');
  const { conditions, ...legacy } = c;                      // pre-conditions status: only a count, nothing to run
  assert.equal(decide({ ...legacy, executable_condition_count:1 }, hs(1)).stopKind, 'needs_human', 'legacy no longer fails open');
  assert.equal(decide(c, hs(1)).stopKind, 'done');
});
test('a no-check loop escalates rather than faking done', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK, conditions:[], needs_human:true };
  assert.equal(decide(d, hs(1)).stopKind, 'needs_human');  // can't done → needs-human is the honest exit
});
test('certified-but-sweep-unsatisfied gives an informative nudge, not the generic block or a self-disarm', () => {
  // exhaustive loop, certified + delivered + oracle-ok, but the depth-round bar is unmet
  const ex = { ...base, verifier_certified:true, conditions_live:OK, exhaustive:true,
    dry_sweeps:99, depth:1, dry_depth_rounds:0, min_dry_depth_rounds:2 };
  const r = decide(ex, hs(1));
  assert.equal(r.action, 'block');
  assert.doesNotMatch(r.reason, /Do EXACTLY ONE pass/, 'must NOT fall through to the uninformative generic block');
  assert.match(r.reason, /depth-round/i, 'names the actual unmet bar (depth rounds)');
  assert.match(r.reason, /disarm/i, 'tells the maker not to disarm/re-certify');
  // until-dry variant names the dry-sweep shortfall
  const ud = { ...base, verifier_certified:true, conditions_live:OK, min_dry_sweeps:3, dry_sweeps:1 };
  const r2 = decide(ud, hs(1));
  assert.equal(r2.action, 'block');
  assert.match(r2.reason, /1\/3/);
  assert.doesNotMatch(r2.reason, /Do EXACTLY ONE pass/);
});
test('certified-but-stale-oracle names the oracle bar with a re-verify instruction', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK, oracle_live_hash:'abc', oracle_ack_hash:'OLD' };
  const r = decide(d, hs(1));
  assert.equal(r.action, 'block');
  assert.doesNotMatch(r.reason, /Do EXACTLY ONE pass/, 'must NOT fall through to the uninformative generic block');
  assert.match(r.reason, /oracle/i, 'names the actual unmet bar (stale oracle ack)');
  assert.match(r.reason, /verifier/i, 'says how to clear it (re-dispatch the verifier, re-ack)');
  assert.match(r.reason, /disarm/i, 'tells the maker not to disarm');
});
test('stale oracle + unmet sweep bar names the sweep bar (sweeps come before re-verify)', () => {
  const d = { ...base, verifier_certified:true, conditions_live:OK, oracle_live_hash:'abc', oracle_ack_hash:'OLD',
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
test('green on a modified pre-existing oracle → needs-human by default; policy "ack" restores done', () => {
  const g = { ...base, verifier_certified:true, conditions_live:OK, oracle_modified:['test/a.test.js (modified)'] };
  const r = decide(g, hs(1));
  assert.equal(r.action, 'allow'); assert.equal(r.stopKind, 'needs_human'); assert.equal(r.detail, 'oracle-modified');
  assert.equal(decide({ ...g, level:'L3' }, hs(1)).stopKind, 'needs_human', 'never nudged to deliver a changed oracle');
  assert.equal(decide({ ...g, oracle_modified_policy:'ack' }, hs(1)).stopKind, 'done');
  assert.equal(decide({ ...g, oracle_modified:[] }, hs(1)).stopKind, 'done');
  const red = decide({ ...g, conditions_live:{ ok:false, failed:[{ id:'tests', exit:1 }] } }, hs(1));
  assert.equal(red.action, 'block', 'a red check is still the maker\'s to fix first');
});
test('green, but the oracle diff could not be computed → needs-human under either policy (the ack accepts changes, not blindness)', () => {
  const g = { ...base, verifier_certified:true, conditions_live:OK, oracle_modified:['git diff (failed, so the oracle check failed)'], oracle_unchecked:true };
  for (const oracle_modified_policy of ['needs_human', 'ack']){
    const r = decide({ ...g, oracle_modified_policy }, hs(1));
    assert.equal(r.stopKind, 'needs_human', oracle_modified_policy); assert.equal(r.detail, 'oracle-unchecked');
  }
});
// ─── review 2026-09-30: which shell runs a done-condition on Windows ──────────────────
test('resolveConditionShell: POSIX uses sh; Windows finds Git Bash like Claude Code, else cmd.exe with a warning', async () => {
  const { resolveConditionShell } = await import('../hooks/lib/verify.mjs');
  const on = (files) => (f) => files.includes(f);
  const noGit = () => null;
  assert.deepEqual(resolveConditionShell({ platform:'linux' }), { shell:true, via:'sh', warning:null });
  let r = resolveConditionShell({ platform:'win32', env:{ CLAUDE_CODE_GIT_BASH_PATH:'D:\\tools\\Git\\bin\\bash.exe' },
    exists: on(['D:\\tools\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe']), gitExecPath: () => 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core' });
  assert.equal(r.shell, 'D:\\tools\\Git\\bin\\bash.exe'); assert.equal(r.via, 'CLAUDE_CODE_GIT_BASH_PATH');
  r = resolveConditionShell({ platform:'win32', env:{ CLAUDE_CODE_GIT_BASH_PATH:'D:\\gone\\bash.exe' },
    exists: on(['C:\\Program Files\\Git\\bin\\bash.exe']), gitExecPath: () => 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core' });
  assert.equal(r.shell, 'C:\\Program Files\\Git\\bin\\bash.exe', 'a stale env path falls through to git --exec-path'); assert.equal(r.via, 'git --exec-path');
  r = resolveConditionShell({ platform:'win32', env:{ PATH:'C:\\Windows\\System32;C:\\msys64\\usr\\bin' },
    exists: on(['C:\\Windows\\System32\\bash.exe', 'C:\\msys64\\usr\\bin\\bash.exe']), gitExecPath: noGit });
  assert.equal(r.shell, 'C:\\msys64\\usr\\bin\\bash.exe', 'PATH, skipping System32\'s WSL bash'); assert.equal(r.via, 'PATH');
  r = resolveConditionShell({ platform:'win32', env:{ PATH:'C:\\Windows\\System32' }, exists: on(['C:\\Windows\\System32\\bash.exe']), gitExecPath: noGit });
  assert.equal(r.shell, true); assert.equal(r.via, 'cmd.exe'); assert.match(r.warning, /cmd\.exe/);
});
test('runConditions runs in the shell it is given and reports it (the gate logs its warning)', async () => {
  const { runConditions } = await import('../hooks/lib/verify.mjs');
  const shell = { shell: true, via: 'cmd.exe', warning: 'no Git Bash found' };
  const r = runConditions([{ id:'t', cmd:'node -e "process.exit(0)"' }], process.cwd(), { shell });
  assert.equal(r.ok, true); assert.deepEqual(r.shell, shell);
  if (process.platform !== 'win32'){                                  // a real path is honoured: bash-only syntax runs
    const bash = ['/bin/bash', '/usr/bin/bash'].find(f => fs.existsSync(f));
    if (bash) assert.equal(runConditions([{ id:'b', cmd:'[[ 1 == 1 ]]' }], process.cwd(), { shell: { shell: bash, via: 'test', warning: null } }).ok, true);
  }
});
