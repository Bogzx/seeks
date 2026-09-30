import { test } from 'node:test'; import assert from 'node:assert/strict';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
const HOOK = fileURLToPath(new URL('../hooks/stop-gate.mjs', import.meta.url));
const run = (cwd) => execFileSync('node',[HOOK],{ input: JSON.stringify({ cwd, session_id:'s1' }) }).toString().trim();
// Done-conditions the gate runs itself. `node -e` behaves the same under sh and cmd.exe.
const PASS = [{ id:'tests', cmd:'node -e "process.exit(0)"' }];
const FAIL = [{ id:'tests', cmd:'node -e "console.log(\'2 failing\'); process.exit(1)"' }];
test('bails when no .seeks', () => assert.equal(run(makeTempRepo()), ''));
test('blocks for an armed loop containing cwd', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, done:false, worktree_path:wt,
    open_items:2, max_iters:50, stuck_threshold:3, no_progress_count:0 }));
  const out = JSON.parse(run(wt));
  assert.equal(out.decision, 'block');
  assert.match(out.systemMessage, /pass 1 · .* continuing/);
  // the USER-visible reason is the terse banner, never the verbose model steering
  assert.match(out.reason, /pass 1 · .* continuing/);
  assert.doesNotMatch(out.reason, /Do EXACTLY ONE pass/);
  // the model steering rides the model-only additionalContext channel (not "Stop hook feedback")
  assert.equal(out.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(out.hookSpecificOutput.additionalContext, /Do EXACTLY ONE pass/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rd,'hook-state.json'))).stop_fires, 1);
});
test('allows + halts on stuck when no_progress_count ≥ stuck_threshold', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','st'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','st'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'st', armed:true, done:false, worktree_path:wt,
    open_items:1, max_iters:50, stuck_threshold:3, no_progress_count:3 }));
  const out = JSON.parse(run(wt));
  assert.ok(!out.decision, 'stuck is a terminal allow — must NOT block');
  assert.match(out.systemMessage, /halt: stuck \(3 no-progress\)/);
});
test('a certify with an unaccounted oracle change is re-blocked', () => {
  const repo = makeTempRepo();                                   // makeTempRepo already git-inits + configs user
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'1\n');
  execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  const base = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'2\n');    // a test changed after "certify"
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, verifier_certified:true, conditions:PASS,
    worktree_path:repo, base_sha:base, oracle_globs:['test/**'], oracle_ack_hash:'STALE',
    open_items:0, max_iters:50, stuck_threshold:3, no_progress_count:0, min_dry_sweeps:0 }));
  const out = JSON.parse(run(repo));
  assert.equal(out.decision, 'block', 'unaccounted oracle change must re-block certify');
});
test('done with time budget remaining releases AND latches: later stops are silent', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','dn'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','dn'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'dn', armed:true, verifier_certified:true, conditions:PASS,
    worktree_path:wt, open_items:0, max_iters:50, stuck_threshold:3, no_progress_count:0,
    started_at: Date.now(), time_budget_sec: 3600 }));   // plenty of budget left — done must still release now
  const first = JSON.parse(run(wt));
  assert.ok(!first.decision, 'done wins over a remaining time budget');
  assert.match(first.systemMessage, /✅ done/);
  const hs1 = JSON.parse(fs.readFileSync(path.join(rd,'hook-state.json')));
  assert.equal(hs1.released, 'done', 'a terminal allow writes the release latch');
  assert.equal(run(wt), '', 'released loop → the hook goes silent (no banner spam)');
  const hs2 = JSON.parse(fs.readFileSync(path.join(rd,'hook-state.json')));
  assert.equal(hs2.stop_fires, hs1.stop_fires, 'no fire bump after release');
  assert.equal(hs2.last_heartbeat, hs1.last_heartbeat, 'no heartbeat refresh after release (gc frees up once TTL lapses)');
});
test('certify with NO oracle change releases done even without an ack (H2 fix)', () => {
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'1\n');
  execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  const base = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  // done + certified, the oracle is UNCHANGED, and the verifier never ran oracle-ack
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, verifier_certified:true, conditions:PASS,
    worktree_path:repo, base_sha:base, oracle_globs:['test/**'],
    open_items:0, max_iters:50, stuck_threshold:3, no_progress_count:0, min_dry_sweeps:0 }));
  const out = JSON.parse(run(repo));
  assert.ok(!out.decision, 'no oracle change → must release done without requiring an ack');
  assert.match(out.systemMessage, /✅ done/);
});
test('the stop gate logs every verdict, so "why did it keep going?" is answerable', async () => {
  const { readDecisions } = await import('../hooks/lib/decisions.mjs');
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  const st = { loop:'ui', armed:true, done:false, worktree_path:wt, open_items:2, max_iters:50, stuck_threshold:3, no_progress_count:0 };
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify(st));
  run(wt);                                                                   // block: work remains
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ ...st, no_progress_count:3 }));
  run(wt);                                                                   // allow: stuck
  const rows = readDecisions(rd, { hook:'stop-gate', limit:0 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, 'block'); assert.equal(rows[0].rule, 'continue');
  assert.equal(rows[1].action, 'allow'); assert.equal(rows[1].rule, 'stop:stuck'); assert.equal(rows[1].stop_kind, 'stuck');
  assert.equal(rows[0].session, 's1');
});

// ─── the gate runs the done-conditions itself ─────────────────────────────────────────
// The 2026-09-02 review's repro: the maker ran `seeks status-set ui '{"done":true,"verifier_certified":true}'`
// and the gate printed ✅ done over a condition that exits 1. Now done is released only on the
// hook's own run, and a failing run clears the certification and counts as a reject.
function certifiedLoop(conditions, extra = {}){
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','g'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','g'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'g', armed:true, done:true, verifier_certified:true, conditions,
    worktree_path:wt, open_items:0, max_iters:50, stuck_threshold:3, no_progress_count:0, condition_reject_threshold:3, ...extra }));
  return { repo, wt, rd, status: () => JSON.parse(fs.readFileSync(path.join(rd,'status.json'),'utf8')) };
}
test('a forged done + certified over a FAILING condition does not release, and the certify is cleared', () => {
  const { wt, rd, status } = certifiedLoop(FAIL);
  const out = JSON.parse(run(wt));
  assert.equal(out.decision, 'block', 'the gate ran the condition and it exited 1');
  assert.doesNotMatch(out.systemMessage, /✅ done/);
  assert.match(out.hookSpecificOutput.additionalContext, /"tests" failed \(exit 1/);
  assert.match(out.hookSpecificOutput.additionalContext, /2 failing/, 'the output tail reaches the maker');
  const s = status();
  assert.equal(s.verifier_certified, false); assert.equal(s.done, false);
  assert.equal(s.condition_rejects.tests, 1); assert.match(s.last_verdict, /gate REJECT/);
  const hs = JSON.parse(fs.readFileSync(path.join(rd,'hook-state.json'),'utf8'));
  assert.equal(hs.verified.ok, false); assert.equal(hs.verified.results[0].exit, 1);
  assert.equal(JSON.parse(run(wt)).decision, 'block', 'and the next stop does not release either');
});
test('re-certifying a red tree escalates to needs-human at the reject threshold (no endless loop)', () => {
  const { wt, rd, status } = certifiedLoop(FAIL, { condition_reject_threshold:2 });
  run(wt);                                                                      // reject 1
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ ...status(), verifier_certified:true }));
  run(wt);                                                                      // reject 2 → needs_human
  assert.equal(status().needs_human, true);
  assert.match(JSON.parse(run(wt)).systemMessage, /needs-human/);
});
test('passing conditions release done, and only the gate writes done:true', () => {
  const { wt, status } = certifiedLoop(PASS, { done:false });
  const out = JSON.parse(run(wt));
  assert.ok(!out.decision); assert.match(out.systemMessage, /✅ done/);
  const s = status(); assert.equal(s.done, true); assert.ok(s.gate_verified_at);
});
test('a status.json that claims conditions_live:{ok:true} is ignored — the hook computes it', () => {
  const { wt } = certifiedLoop(FAIL, { conditions_live:{ ok:true } });
  assert.equal(JSON.parse(run(wt)).decision, 'block');
});
test('a tree the gate already verified is not re-run; any edit forces a fresh run', () => {
  const repo = makeTempRepo(); fs.writeFileSync(path.join(repo,'a.js'),'1\n');
  execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  const counter = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'seeks-ctr-')),'runs').split('\\').join('/');
  const rd = path.join(repo,'.seeks','run','l3'); fs.mkdirSync(rd,{recursive:true});
  const st = { loop:'l3', armed:true, verifier_certified:true, level:'L3', worktree_path:repo, open_items:0, max_iters:50, stuck_threshold:3,
    no_progress_count:0, conditions:[{ id:'tests', cmd:`node -e "require('fs').appendFileSync('${counter}','x')"` }] };
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify(st));
  const runs = () => { try { return fs.readFileSync(counter,'utf8').length; } catch { return 0; } };
  let out = JSON.parse(run(repo));
  assert.equal(out.decision, 'block'); assert.match(out.hookSpecificOutput.additionalContext, /seeks deliver/);
  assert.equal(runs(), 1);
  run(repo); assert.equal(runs(), 1, 'unchanged tree → cached verification, no re-run');
  fs.writeFileSync(path.join(repo,'a.js'),'2\n');                            // the maker edits after the gate verified
  run(repo); assert.equal(runs(), 2, 'edited tree → the gate runs the conditions again');
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ ...st, delivered:true }));
  out = JSON.parse(run(repo));
  assert.match(out.systemMessage, /✅ done/); assert.equal(runs(), 2, 'delivering does not change the tree');
});
test('a certified loop with no runnable condition ends in needs-human, not done', () => {
  const { wt } = certifiedLoop([{ id:'judge', human_required:true }]);
  assert.match(JSON.parse(run(wt)).systemMessage, /needs-human/);
});

// ─── a green check on a changed oracle ends with a human (2026-09-30 round 2) ──────────
function oracleLoop({ policy, edit }){
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'1\n');
  fs.writeFileSync(path.join(repo,'package.json'),'{"scripts":{"test":"node --test"}}\n');
  execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  const base = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  edit(repo);
  const rd = path.join(repo,'.seeks','run','om'); fs.mkdirSync(rd,{recursive:true});
  const st = { loop:'om', armed:true, verifier_certified:true, conditions:PASS, worktree_path:repo, base_sha:base,
    open_items:0, max_iters:50, stuck_threshold:3, no_progress_count:0, ...(policy ? { oracle_modified_policy: policy } : {}) };
  st.oracle_ack_hash = oracleDiffHashFor(repo, base);              // the (advisory) ack is current — this is not the stale-ack path
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify(st));
  return { repo, rd, status: () => JSON.parse(fs.readFileSync(path.join(rd,'status.json'),'utf8')) };
}
import { oracleDiffHash, DEFAULT_ORACLE_GLOBS } from '../hooks/lib/oracle.mjs';
const oracleDiffHashFor = (repo, base) => oracleDiffHash(repo, base, DEFAULT_ORACLE_GLOBS).hash;
test('conditions green + acked, but package.json\'s test script was rewritten → needs-human, not done', () => {
  const { repo, status } = oracleLoop({ edit: (r) => fs.writeFileSync(path.join(r,'package.json'),'{"scripts":{"test":"true"}}\n') });
  const out = JSON.parse(run(repo));
  assert.ok(!out.decision); assert.match(out.systemMessage, /needs-human/); assert.doesNotMatch(out.systemMessage, /✅ done/);
  assert.match(out.systemMessage, /package\.json \(modified\)/);
  const s = status(); assert.equal(s.needs_human, true); assert.notEqual(s.done, true); assert.match(s.last_verdict, /oracle_modified_policy/);
});
test('a deleted pre-existing test also routes to a human', () => {
  const { repo } = oracleLoop({ edit: (r) => fs.rmSync(path.join(r,'test','a.test.js')) });
  assert.match(JSON.parse(run(repo)).systemMessage, /test\/a\.test\.js \(deleted\)/);
});
test('ADDING a test is free: green + acked releases done', () => {
  const { repo } = oracleLoop({ edit: (r) => fs.writeFileSync(path.join(r,'test','b.test.js'),'2\n') });
  assert.match(JSON.parse(run(repo)).systemMessage, /✅ done/);
});
test('oracle_modified_policy "ack" is the documented opt-out: the ack is enough again', () => {
  const { repo } = oracleLoop({ policy:'ack', edit: (r) => fs.writeFileSync(path.join(r,'test','a.test.js'),'relaxed\n') });
  assert.match(JSON.parse(run(repo)).systemMessage, /✅ done/);
});
test('a condition runs outside any inherited node --test context (no false green)', async () => {
  const { runConditions } = await import('../hooks/lib/verify.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'seeks-ntc-'));
  fs.writeFileSync(path.join(dir,'red.test.mjs'), "import { test } from 'node:test'; test('red', () => { throw new Error('red'); });\n");
  const r = runConditions([{ id:'t', cmd:'node --test red.test.mjs' }], dir);   // this test process HAS NODE_TEST_CONTEXT set
  assert.ok(process.env.NODE_TEST_CONTEXT, 'precondition: running under node --test');
  assert.equal(r.ok, false, 'a nested node --test must not report green to a parent that is not listening');
});
