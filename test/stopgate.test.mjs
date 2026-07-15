import { test } from 'node:test'; import assert from 'node:assert/strict';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
const HOOK = fileURLToPath(new URL('../hooks/stop-gate.mjs', import.meta.url));
const run = (cwd) => execFileSync('node',[HOOK],{ input: JSON.stringify({ cwd, session_id:'s1' }) }).toString().trim();
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
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, done:true, verifier_certified:true,
    worktree_path:repo, base_sha:base, oracle_globs:['test/**'], oracle_ack_hash:'STALE',
    open_items:0, max_iters:50, stuck_threshold:3, no_progress_count:0, min_dry_sweeps:0 }));
  const out = JSON.parse(run(repo));
  assert.equal(out.decision, 'block', 'unaccounted oracle change must re-block certify');
});
test('done with time budget remaining releases AND latches: later stops are silent', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','dn'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','dn'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'dn', armed:true, done:true, verifier_certified:true,
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
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, done:true, verifier_certified:true,
    worktree_path:repo, base_sha:base, oracle_globs:['test/**'],
    open_items:0, max_iters:50, stuck_threshold:3, no_progress_count:0, min_dry_sweeps:0 }));
  const out = JSON.parse(run(repo));
  assert.ok(!out.decision, 'no oracle change → must release done without requiring an ack');
  assert.match(out.systemMessage, /✅ done/);
});
