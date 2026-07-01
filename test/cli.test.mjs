import { test } from 'node:test'; import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
const CLI = fileURLToPath(new URL('../bin/seeks.mjs', import.meta.url));
const run = (repo, ...a) => execFileSync('node',[CLI,...a],{ cwd: repo }).toString().trim();
function seed(repo, name, status){ const rd = path.join(repo,'.seeks','run',name); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify(status)); fs.writeFileSync(path.join(rd,'backlog.md'),''); return rd; }

test('status-set merges atomically', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', open_items:5 });
  run(repo,'status-set','ui','{"open_items":3,"last_change":"x"}');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.open_items,3); assert.equal(s.loop,'ui'); assert.equal(s.last_change,'x');
});
test('condition-reject increments deeply + escalates at threshold', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', condition_rejects:{ lint:2 }, condition_reject_threshold:3 });
  run(repo,'condition-reject','ui','tests');                  // tests:1, lint preserved
  let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.condition_rejects.tests,1); assert.equal(s.condition_rejects.lint,2); assert.ok(!s.needs_human);
  run(repo,'condition-reject','ui','tests'); run(repo,'condition-reject','ui','tests'); // tests:3 → escalate
  s = JSON.parse(run(repo,'status-get','ui')); assert.equal(s.condition_rejects.tests,3); assert.equal(s.needs_human,true);
});
test('progress-tick: close=reset, no-op=increment, reseed=reset', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui', open_items:2, no_progress_count:0, items_closed_total:0 });
  fs.writeFileSync(path.join(rd,'backlog.md'), '- [ ] a\n');           // 1 open ⇒ closed 1
  run(repo,'progress-tick','ui'); let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.open_items,1); assert.equal(s.items_closed_total,1); assert.equal(s.no_progress_count,0);
  run(repo,'progress-tick','ui'); s = JSON.parse(run(repo,'status-get','ui'));  // unchanged ⇒ no progress
  assert.equal(s.no_progress_count,1);
  fs.writeFileSync(path.join(rd,'backlog.md'), '- [ ] a\n- [ ] b\n- [ ] c\n'); // reseed to 3
  run(repo,'progress-tick','ui'); s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.open_items,3); assert.equal(s.no_progress_count,0);
});
test('backlog-add collapses embedded newlines so one arg stays one item (3.6)', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui', open_items:0 });
  run(repo,'backlog-add','ui','first line\nsecond line\n- [ ] injected extra');   // embedded newlines + a fake checklist line
  const body = fs.readFileSync(path.join(rd,'backlog.md'),'utf8');
  assert.equal((body.match(/^- \[ \] /gm) || []).length, 1);   // exactly one item — continuation lines can't desync the count
  assert.equal(run(repo,'backlog-count','ui'), '1');
});
test('progress-tick: a certify (done) pass counts as progress, not stuck', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui', open_items:0, no_progress_count:2, done:true });
  // backlog empty (0 open), nothing closed, not reseeded — but done:true ⇒ progress ⇒ no_progress resets
  run(repo,'progress-tick','ui'); const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.no_progress_count,0);
});
test('--help prints usage and exits 0', () => {
  const out = run(makeTempRepo(),'--help');
  assert.match(out, /seeks <cmd> <name>/); assert.match(out, /reset-fires/); assert.match(out, /log-add/);
});
test('init prints ok and writes status', () => {
  const repo = makeTempRepo();
  const out = run(repo,'init','ui','{"loop":"ui","open_items":0}');
  assert.equal(out, 'ok');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.loop,'ui');
});
test('init defaults level, oracle_globs, denylist when absent', () => {
  const repo = makeTempRepo();
  run(repo,'init','ui','{"loop":"ui","open_items":0}');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.level, 'L2');
  assert.ok(Array.isArray(s.oracle_globs) && s.oracle_globs.includes('test/**'));
  assert.ok(Array.isArray(s.denylist) && s.denylist.includes('**/.env'));
});
test('init keeps caller-provided level/globs', () => {
  const repo = makeTempRepo();
  run(repo,'init','ui','{"loop":"ui","level":"L1","oracle_globs":["spec/**"]}');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.level, 'L1'); assert.deepEqual(s.oracle_globs, ['spec/**']);
});
test('log-add appends lines to log.md (create-on-write)', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui' });
  run(repo,'log-add','ui','pass 1 — edited foo.ts');
  run(repo,'log-add','ui','pass 2 — ran verifier');
  const log = fs.readFileSync(path.join(rd,'log.md'),'utf8');
  assert.match(log, /pass 1 — edited foo\.ts/);
  assert.match(log, /pass 2 — ran verifier/);
  assert.equal(log.trim().split('\n').length, 2);
});
test('reset-fires zeroes stop_fires, keeps heartbeat', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui' });
  fs.writeFileSync(path.join(rd,'hook-state.json'), JSON.stringify({ stop_fires:4, last_heartbeat:123, session_id:'s' }));
  run(repo,'reset-fires','ui');
  const hs = JSON.parse(fs.readFileSync(path.join(rd,'hook-state.json'),'utf8'));
  assert.equal(hs.stop_fires,0); assert.equal(hs.last_heartbeat,123);
});
test('sweep-tick: found resets dry to 0; empty increments dry', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', dry_sweeps:1, min_dry_sweeps:2 });
  run(repo,'sweep-tick','ui','3'); let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.dry_sweeps,0); assert.match(s.last_sweep, /3 found/);
  run(repo,'sweep-tick','ui','0'); s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.dry_sweeps,1); assert.match(s.last_sweep, /dry 1\/2/);
});
test('progress-tick: a dry sweep counts as progress (no false stuck)', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', open_items:0, no_progress_count:0, dry_sweeps:0, dry_sweeps_prev:0, min_dry_sweeps:2 });
  run(repo,'sweep-tick','ui','0'); run(repo,'progress-tick','ui');
  let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.dry_sweeps,1); assert.equal(s.no_progress_count,0);
  run(repo,'sweep-tick','ui','0'); run(repo,'progress-tick','ui');
  s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.dry_sweeps,2); assert.equal(s.no_progress_count,0);
});
test('progress-tick: a sweep that FINDS bugs counts as progress (report-only, no reseed)', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', open_items:0, no_progress_count:0, dry_sweeps:0, dry_sweeps_prev:0, min_dry_sweeps:2 });
  run(repo,'sweep-tick','ui','4','concurrency'); run(repo,'progress-tick','ui'); // found 4, backlog stays empty (report-only)
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.dry_sweeps,0, 'found → dry reset');
  assert.equal(s.no_progress_count,0, 'finding bugs IS progress — must not count toward stuck');
});
test('sweep-tick with lens: distinct lenses advance dry; a repeat does NOT', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', dry_sweeps:0, min_dry_sweeps:2 });
  run(repo,'sweep-tick','ui','0','concurrency'); let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.dry_sweeps,1); assert.deepEqual(s.dry_lenses,['concurrency']);
  run(repo,'sweep-tick','ui','0','concurrency'); s = JSON.parse(run(repo,'status-get','ui')); // repeat → no advance
  assert.equal(s.dry_sweeps,1); assert.deepEqual(s.dry_lenses,['concurrency']);
  run(repo,'sweep-tick','ui','0','boundary'); s = JSON.parse(run(repo,'status-get','ui'));   // distinct → advance
  assert.equal(s.dry_sweeps,2); assert.deepEqual(s.dry_lenses,['concurrency','boundary']);
  assert.deepEqual(s.lenses_used,['concurrency','concurrency','boundary']);
  assert.match(s.last_sweep, /\(boundary\)/);
});
test('sweep-tick caps lenses_used history — bounded, LRU tail preserved', () => {
  const repo = makeTempRepo();
  const long = Array.from({ length: 64 }, (_, i) => `L${i}`);   // already at the default cap (max(16*4,64)=64)
  seed(repo,'ui',{ loop:'ui', lenses_used: long });
  run(repo,'sweep-tick','ui','0','concurrency');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.lenses_used.length, 64, 'history stays bounded, not append-forever');
  assert.equal(s.lenses_used[s.lenses_used.length-1], 'concurrency', 'newest lens kept at the tail');
  assert.equal(s.lenses_used[0], 'L1', 'oldest entry (L0) dropped');
});
test('sweep-tick: found resets the dry streak + dry_lenses', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', dry_sweeps:2, dry_lenses:['concurrency','boundary'], min_dry_sweeps:2 });
  run(repo,'sweep-tick','ui','3','serialization'); const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.dry_sweeps,0); assert.deepEqual(s.dry_lenses,[]);
});
test('sweep-next-lens rotates through the set', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', lenses_used:['concurrency'] });
  assert.equal(run(repo,'sweep-next-lens','ui'), 'error-handling');
});
test('sweep-status reports the gate sweep predicate (single source of truth)', () => {
  const repo = makeTempRepo();
  seed(repo,'u',{ loop:'u', min_dry_sweeps:3, dry_sweeps:1 });
  let p = JSON.parse(run(repo,'sweep-status','u'));
  assert.equal(p.mode,'until-dry'); assert.equal(p.satisfied,false); assert.equal(p.label,'sweep 1/3 dry');
  seed(repo,'u2',{ loop:'u2', min_dry_sweeps:3, dry_sweeps:3 });
  assert.equal(JSON.parse(run(repo,'sweep-status','u2')).satisfied, true);
  // exhaustive: dry_sweeps must NOT satisfy — only dry_depth_rounds does (mirrors the gate)
  seed(repo,'ex',{ loop:'ex', exhaustive:true, dry_sweeps:99, dry_depth_rounds:0, min_dry_depth_rounds:2 });
  p = JSON.parse(run(repo,'sweep-status','ex'));
  assert.equal(p.mode,'exhaustive'); assert.equal(p.satisfied,false);
  seed(repo,'ex2',{ loop:'ex2', exhaustive:true, dry_depth_rounds:2, min_dry_depth_rounds:2 });
  assert.equal(JSON.parse(run(repo,'sweep-status','ex2')).satisfied, true);
});
test('latest returns the most-recently-updated loop', () => {
  const repo = makeTempRepo();
  seed(repo,'old',{ loop:'old', updated_at:'2026-01-01T00:00:00Z' });
  seed(repo,'newer',{ loop:'newer', updated_at:'2026-06-01T00:00:00Z' });
  assert.equal(run(repo,'latest'), 'newer');
});
test('base-record + base-check track base-branch movement', () => {
  const repo = makeTempRepo();
  fs.writeFileSync(path.join(repo,'a.txt'),'1'); execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','init'],{cwd:repo});
  const base = execFileSync('git',['rev-parse','--abbrev-ref','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  seed(repo,'ui',{ loop:'ui', base_ref: base });
  run(repo,'base-record','ui');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.ok(s.base_sha && s.base_sha.length >= 7);
  assert.equal(run(repo,'base-check','ui'), 'current');
  fs.writeFileSync(path.join(repo,'a.txt'),'2'); execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','move'],{cwd:repo});
  assert.equal(run(repo,'base-check','ui'), 'moved');
});
test('base-check returns unknown when base_sha absent', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', base_ref:'main' });
  assert.equal(run(repo,'base-check','ui'), 'unknown');
});
test('deliver requires L3', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', level:'L2', worktree_path:repo });
  assert.throws(() => run(repo,'deliver','ui'));  // non-L3 → exit 1 → execFileSync throws
});
test('deliver L3 local-mode records delivered + mode', () => {
  const repo = makeTempRepo();
  fs.writeFileSync(path.join(repo,'a'),'1'); execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  execFileSync('git',['branch','seeks/ui'],{cwd:repo});
  seed(repo,'ui',{ loop:'ui', level:'L3', worktree_path:repo, base_ref:'HEAD' });
  const out = JSON.parse(run(repo,'deliver','ui'));
  assert.equal(out.delivered, true); assert.equal(out.mode, 'local');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.delivered, true); assert.equal(s.delivery_mode, 'local');
});
test('tier-set + tier-get round-trip via SEEKS_HOME', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'seeks-home-')));
  const repo = makeTempRepo();
  const r = (...a) => execFileSync('node',[CLI,...a],{ cwd: repo, env:{...process.env, SEEKS_HOME: home} }).toString().trim();
  assert.equal(r('tier-get'), 'none');
  assert.equal(r('tier-set','light'), 'ok');
  const g = JSON.parse(r('tier-get'));
  assert.equal(g.tier, 'light');
  assert.equal(g.roles.verifier.model, 'sonnet');
  assert.equal(g.max_iters, 30); assert.equal(g.min_dry_sweeps, 1);
});
test('tier-set rejects an unknown tier', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'seeks-home-')));
  assert.throws(() => execFileSync('node',[CLI,'tier-set','bogus'],{ cwd: makeTempRepo(), env:{...process.env, SEEKS_HOME: home} }));
});
test('role reads {model,effort} from .seeks/config.json', () => {
  const repo = makeTempRepo();
  const sd = path.join(repo,'.seeks'); fs.mkdirSync(sd,{recursive:true});
  fs.writeFileSync(path.join(sd,'config.json'), JSON.stringify({ roles:{ verifier:{model:'opus',effort:'max'} } }));
  const out = JSON.parse(run(repo,'role','verifier'));
  assert.equal(out.model,'opus'); assert.equal(out.effort,'max');
});
test('oracle-diff + oracle-ack round-trip on a real worktree', () => {
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'1\n');
  execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  const base = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  seed(repo,'ui',{ loop:'ui', worktree_path:repo, base_sha:base, oracle_globs:['test/**'] });
  // no change → empty
  let d = JSON.parse(run(repo,'oracle-diff','ui')); assert.equal(d.count, 0);
  // change the test → count 1
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'2\n');
  d = JSON.parse(run(repo,'oracle-diff','ui')); assert.equal(d.count, 1);
  // ack records the current hash
  run(repo,'oracle-ack','ui');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.oracle_ack_hash, d.hash); assert.equal(s.oracle_changed_count, 1);
});
test('budget-set + start-clock stamp the budget and start time', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui' });
  run(repo,'budget-set','ui','28800');
  let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.time_budget_sec, 28800);
  const before = Date.now();
  run(repo,'start-clock','ui');
  s = JSON.parse(run(repo,'status-get','ui'));
  assert.ok(s.started_at >= before - 1000 && s.started_at <= Date.now() + 1000);
});
test('sweep-tick: exhaustive full-catalog dry bumps depth + dry_depth_rounds', () => {
  const repo = makeTempRepo();
  seed(repo,'ex',{ loop:'ex', exhaustive:true, sweep_lenses:['a','b'], dry_sweeps:0, dry_lenses:[], depth:1, dry_depth_rounds:0 });
  run(repo,'sweep-tick','ex','0','a'); let s = JSON.parse(run(repo,'status-get','ex'));
  assert.equal(s.dry_sweeps,1); assert.equal(s.depth,1); assert.equal(s.dry_depth_rounds,0); // catalog not yet covered
  run(repo,'sweep-tick','ex','0','b'); s = JSON.parse(run(repo,'status-get','ex'));
  assert.equal(s.depth,2, 'full catalog dry → deepen'); assert.equal(s.dry_depth_rounds,1);
  assert.deepEqual(s.dry_lenses,[], 'streak reset for the new depth'); assert.equal(s.dry_sweeps,0);
});
test('sweep-tick: non-exhaustive is unchanged (no depth fields)', () => {
  const repo = makeTempRepo();
  seed(repo,'n',{ loop:'n', sweep_lenses:['a','b'], dry_sweeps:0, dry_lenses:[] });
  run(repo,'sweep-tick','n','0','a'); run(repo,'sweep-tick','n','0','b');
  const s = JSON.parse(run(repo,'status-get','n'));
  assert.equal(s.dry_sweeps,2); assert.ok(s.depth === undefined); assert.ok(s.dry_depth_rounds === undefined);
});
test('init derives executable_condition_count from conditions', () => {
  const repo = makeTempRepo();
  run(repo,'init','ui', JSON.stringify({ loop:'ui', conditions:[{id:'t',cmd:'npm test',expect:0},{id:'h',human_required:true}] }));
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.executable_condition_count, 1);
});
test('init refuses a loop with no runnable check and no human_required', () => {
  const repo = makeTempRepo();
  assert.throws(() => run(repo,'init','ui', JSON.stringify({ loop:'ui', conditions:[{id:'x',human_required:false}] })));
});
test('init accepts a human_required-only loop (subjective)', () => {
  const repo = makeTempRepo();
  run(repo,'init','ui', JSON.stringify({ loop:'ui', conditions:[{id:'judge',human_required:true}] }));
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.executable_condition_count, 0);   // allowed: routes to needs-human, never done
});
test('init without conditions is unchanged (legacy)', () => {
  const repo = makeTempRepo();
  run(repo,'init','ui', JSON.stringify({ loop:'ui', open_items:0 }));
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.ok(s.executable_condition_count === undefined);
});
test('preflight reports node + git status', () => {
  const r = JSON.parse(run(makeTempRepo(),'preflight'));
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(r.nodeExec && r.nodeExec.length > 0);
  assert.equal(r.gitOk, true);   // git is on PATH in the test env
});
test('oracle-diff surfaces oracle_globs_present (vacuous-accounting signal)', () => {
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'1\n');
  execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  const base = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  seed(repo,'ui',{ loop:'ui', worktree_path:repo, base_sha:base, oracle_globs:['test/**'] });
  let d = JSON.parse(run(repo,'oracle-diff','ui'));
  assert.equal(d.globs_present, 1);
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.oracle_globs_present, 1);
  seed(repo,'v',{ loop:'v', worktree_path:repo, base_sha:base, oracle_globs:['nope/**'] });
  d = JSON.parse(run(repo,'oracle-diff','v'));
  assert.equal(d.globs_present, 0);   // vacuous: nothing matches → accounting would be empty
});
