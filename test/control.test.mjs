import { test } from 'node:test'; import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url'; import fs from 'node:fs'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
import { splitPatch, isLive, grantKindFromPrompt, issueGrant, readGrant, consumeGrant, OWNED_KEYS } from '../hooks/lib/control.mjs';
const CLI = fileURLToPath(new URL('../bin/seeks.mjs', import.meta.url));
const PROMPT_HOOK = fileURLToPath(new URL('../hooks/user-prompt.mjs', import.meta.url));
const cli = (repo, ...a) => spawnSync('node', [CLI, ...a], { cwd: repo, encoding: 'utf8' });
const ok = (repo, ...a) => { const r = cli(repo, ...a); assert.equal(r.status, 0, `${a.join(' ')} → ${r.stderr}`); return r.stdout; };
const refused = (repo, ...a) => { const r = cli(repo, ...a); assert.equal(r.status, 1, `${a.join(' ')} should be refused`); return r.stderr; };
const statusOf = (repo, name = 'ui') => JSON.parse(ok(repo, 'status-get', name));
const hsOf = (repo, name = 'ui') => { try { return JSON.parse(fs.readFileSync(path.join(repo,'.seeks','run',name,'hook-state.json'),'utf8')); } catch { return null; } };
const userTypes = (repo, prompt) => execFileSync('node', [PROMPT_HOOK], { input: JSON.stringify({ cwd: repo, prompt, session_id:'u1' }) });
// A loop the gate is holding: armed, with a worktree, mid-run.
function liveLoop(extra = {}){
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(wt,{recursive:true});
  ok(repo, 'init', 'ui', JSON.stringify({ loop:'ui', worktree_path: wt, max_iters: 5, time_budget_sec: 600, min_dry_sweeps: 2,
    conditions:[{ id:'tests', cmd:'npm test' }], ...extra }));
  ok(repo, 'start', 'ui');
  return { repo, wt };
}

// ─── the pure rules ──────────────────────────────────────────────────────────────────
test('splitPatch: owned keys never pass; protected keys only when not live or granted; tighten-only', () => {
  const p = { done:true, verifier_certified:true, armed:false, max_iters:9e9, last_change:'x', needs_human:false };
  const live = splitPatch(p, { live:true, granted:false });
  assert.deepEqual(live.allowed, { last_change:'x' });
  assert.deepEqual(live.refused.sort(), ['armed','done','max_iters','needs_human','verifier_certified']);
  const granted = splitPatch(p, { live:true, granted:true });
  assert.deepEqual(Object.keys(granted.allowed).sort(), ['last_change','max_iters','needs_human'], 'a grant never unlocks the owned keys');
  assert.deepEqual(Object.keys(splitPatch(p, { live:false }).allowed).sort(), ['last_change','max_iters','needs_human']);
  assert.deepEqual(splitPatch({ needs_human:true, strict_bash:true }, { live:true }).refused, [], 'giving up / locking down needs no grant');
  assert.deepEqual(splitPatch({ strict_bash:false }, { live:true }).refused, ['strict_bash']);
  for (const k of ['done','verifier_certified','armed']) assert.ok(OWNED_KEYS.includes(k));
});
test('isLive: armed and not released by the gate', () => {
  assert.equal(isLive({ armed:true }, {}), true);
  assert.equal(isLive({ armed:true }, { released:'done' }), false);
  assert.equal(isLive({ armed:false }, {}), false);
  assert.equal(isLive(null, null), false);
});
test('grantKindFromPrompt only matches a /seeks control command the user typed', () => {
  assert.equal(grantKindFromPrompt('/seeks:start fix-auth --for 8h'), 'start');
  assert.equal(grantKindFromPrompt('  /seeks:stop'), 'stop');
  assert.equal(grantKindFromPrompt('/seeks:delete ui'), 'delete');
  assert.equal(grantKindFromPrompt('<command-name>/seeks:stop</command-name>'), 'stop');
  assert.equal(grantKindFromPrompt('/seeks:status'), null);
  assert.equal(grantKindFromPrompt('/seeks:starts'), null);
  assert.equal(grantKindFromPrompt('please run /seeks:stop for me'), null, 'mentioning it is not typing it');
  assert.equal(grantKindFromPrompt(undefined), null);
});
test('grants expire and are one-shot', () => {
  const sd = path.join(makeTempRepo(), '.seeks'); fs.mkdirSync(sd);
  issueGrant(sd, { kind:'stop', now: 1000, ttlMs: 100 });
  assert.ok(readGrant(sd, 1050)); assert.equal(readGrant(sd, 1100), null, 'expired');
  issueGrant(sd, { kind:'stop' });
  assert.ok(consumeGrant(sd)); assert.equal(consumeGrant(sd), null, 'spent'); assert.equal(readGrant(sd), null);
});

// ─── the review's repro, through the real CLI ─────────────────────────────────────────
test('the maker cannot self-certify, disarm, or erase its budgets through status-set', () => {
  const { repo } = liveLoop();
  for (const patch of [{ done:true, verifier_certified:true }, { armed:false }, { max_iters:999999, time_budget_sec:null },
    { dry_sweeps:99 }, { min_dry_sweeps:0 }, { conditions:[{ id:'t', cmd:'true' }] }, { oracle_globs:[] }, { worktree_path:'/elsewhere' },
    { needs_human:false }, { level:'L3' }, { strict_bash_allow:['python3'] }, { oracle_modified_policy:'ack' }, { oracle_modified:[] }, { oracle_manifest_diff:'keys' }]){
    const err = refused(repo, 'status-set', 'ui', JSON.stringify({ ...patch, last_change:'tried' }));
    assert.match(err, /refused/);
  }
  const s = statusOf(repo);
  assert.equal(s.armed, true); assert.equal(s.done, false); assert.equal(s.verifier_certified, false);
  assert.equal(s.max_iters, 5); assert.equal(s.time_budget_sec, 600); assert.equal(s.min_dry_sweeps, 2);
  assert.equal(s.conditions[0].cmd, 'npm test'); assert.equal(s.last_change, 'tried', 'the non-protected part of the patch still lands');
  ok(repo, 'status-set', 'ui', '{"open_items":3,"last_change":"pass 2","needs_human":true}');   // normal loop bookkeeping is untouched
});
test('reset-fires, budget-set, start-clock, base-record, re-init and gc are refused on a live loop', () => {
  const { repo } = liveLoop();
  fs.writeFileSync(path.join(repo,'.seeks','run','ui','hook-state.json'), JSON.stringify({ stop_fires: 4 }));
  refused(repo, 'reset-fires', 'ui'); assert.equal(hsOf(repo).stop_fires, 4);
  refused(repo, 'budget-set', 'ui', '9999999'); refused(repo, 'start-clock', 'ui'); refused(repo, 'base-record', 'ui');
  refused(repo, 'init', 'ui', '{"loop":"ui","max_iters":9999}');
  refused(repo, 'gc', 'ui', '--force'); assert.ok(fs.existsSync(path.join(repo,'.seeks','run','ui','status.json')));
  refused(repo, 'start', 'ui'); refused(repo, 'stop', 'ui');
  assert.equal(statusOf(repo).time_budget_sec, 600);
});
test('with the grant the user\'s /seeks:stop mints, the same loop can be disarmed — once', () => {
  const { repo } = liveLoop();
  userTypes(repo, 'please stop');                      assert.equal(readGrant(path.join(repo,'.seeks')), null);
  userTypes(repo, '/seeks:stop ui');
  ok(repo, 'stop', 'ui');
  assert.equal(statusOf(repo).armed, false);
  assert.equal(readGrant(path.join(repo,'.seeks')), null, 'spent by stop');
  const rows = fs.readFileSync(path.join(repo,'.seeks','decisions.jsonl'),'utf8');
  assert.match(rows, /"rule":"grant:stop"/, 'the grant is on the audit log');
});
test('/seeks:start on a live loop: raises the budget with the grant, and spends it', () => {
  const { repo } = liveLoop();
  userTypes(repo, '/seeks:start ui --for 2h');
  ok(repo, 'start', 'ui', '--budget', '2h', '--max-iters', '80');
  const s = statusOf(repo); assert.equal(s.time_budget_sec, 7200); assert.equal(s.max_iters, 80);
  refused(repo, 'reset-fires', 'ui');                  // the grant was one-shot
});
test('start: a fresh loop arms without a grant, resets the counter and clears a release latch', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'wt'); fs.mkdirSync(wt);
  ok(repo, 'init', 'ui', JSON.stringify({ loop:'ui', armed:true, done:true, verifier_certified:true, worktree_path: wt,
    conditions:[{ id:'t', cmd:'npm test' }] }));
  let s = statusOf(repo);
  assert.equal(s.armed, false, 'init never arms'); assert.equal(s.done, false); assert.equal(s.verifier_certified, false);
  fs.writeFileSync(path.join(repo,'.seeks','run','ui','hook-state.json'), JSON.stringify({ stop_fires: 9, released:'max_iters' }));
  ok(repo, 'start', 'ui', '--budget', '30m');
  s = statusOf(repo); assert.equal(s.armed, true); assert.equal(s.time_budget_sec, 1800); assert.ok(s.started_at > 0);
  const hs = hsOf(repo); assert.equal(hs.stop_fires, 0); assert.ok(!hs.released);
});
test('a released loop is not live: the user can re-run it without a grant', () => {
  const { repo } = liveLoop();
  fs.writeFileSync(path.join(repo,'.seeks','run','ui','hook-state.json'), JSON.stringify({ stop_fires: 5, released:'max_iters' }));
  ok(repo, 'status-set', 'ui', '{"max_iters":20}');
  ok(repo, 'start', 'ui');
  assert.equal(statusOf(repo).max_iters, 20); assert.equal(hsOf(repo).stop_fires, 0);
});
test('a shadow loop over a live worktree cannot be armed (it would gate the maker with trivial conditions)', () => {
  const { repo, wt } = liveLoop();
  ok(repo, 'init', 'aaa', JSON.stringify({ loop:'aaa', worktree_path: wt, conditions:[{ id:'t', cmd:'true' }] }));
  assert.match(refused(repo, 'start', 'aaa'), /live loop\(s\) ui already gate this worktree/);
  ok(repo, 'init', 'bbb', JSON.stringify({ loop:'bbb', worktree_path: path.dirname(wt), conditions:[{ id:'t', cmd:'true' }] }));
  refused(repo, 'start', 'bbb');                       // an ancestor of the worktree covers it just as well
  assert.equal(statusOf(repo, 'aaa').armed, false);
});
test('certify records the verifier\'s sign-off (the gate still re-runs the conditions)', () => {
  const { repo } = liveLoop();
  ok(repo, 'certify', 'ui');
  const s = statusOf(repo); assert.equal(s.verifier_certified, true); assert.equal(s.done, false, 'done stays the gate\'s to write');
});
test('the user-prompt hook does nothing outside a seeks project and never blocks the prompt', () => {
  const repo = makeTempRepo();
  assert.equal(userTypes(repo, '/seeks:stop').toString(), '');
  assert.ok(!fs.existsSync(path.join(repo,'.seeks')));
});
