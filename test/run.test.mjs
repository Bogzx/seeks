import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { makeTempRepo } from './helpers.mjs';
import { parseRunArgs, claudeCommand } from '../bin/run.mjs';
import { exitCodeFor, bannersIn } from '../bin/lib/driver.mjs';
const CLI = fileURLToPath(new URL('../bin/seeks.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const GREEN = 'node -e "process.exit(0)"', RED = 'node -e "process.exit(1)"';
// A `claude` on PATH that is really the fake (POSIX). On win32 a shim would need a .cmd wrapper, so
// there the fake is passed explicitly — the same code path minus the PATH lookup.
function fakeOnPath(){
  if (process.platform === 'win32') return { env: { SEEKS_CLAUDE_BIN: FAKE } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-fakebin-'));
  fs.writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  return { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}` } };
}
function repo(){ const r = makeTempRepo(); fs.writeFileSync(path.join(r,'a.txt'),'1\n');
  execFileSync('git',['add','-A'],{cwd:r}); execFileSync('git',['commit','-q','-m','i'],{cwd:r}); return r; }
function run(r, args, { mode = 'done', env = {} } = {}){
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'seeks-fakelog-')), 'call.json');
  const res = spawnSync(process.execPath, [CLI, 'run', ...args], { cwd: r, encoding: 'utf8',
    env: { ...process.env, ...fakeOnPath().env, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log, SEEKS_RUN_GRACE_MS: '300', ...env } });
  let call = null; try { call = JSON.parse(fs.readFileSync(log, 'utf8')); } catch {}
  return { code: res.status, out: res.stdout, err: res.stderr, call };
}
const statusOf = (r, n) => JSON.parse(fs.readFileSync(path.join(r,'.seeks','run',n,'status.json'),'utf8'));
const hsOf = (r, n) => JSON.parse(fs.readFileSync(path.join(r,'.seeks','run',n,'hook-state.json'),'utf8'));

test('parseRunArgs: flags, repeated --check, and the refusals', () => {
  const o = parseRunArgs(['fix', '--goal', 'make it green', '--check', 'npm test', '--check', 'npm run lint', '--budget', '2h', '--strict']);
  assert.equal(o.name, 'fix'); assert.deepEqual(o.checks, ['npm test','npm run lint']); assert.equal(o.budget, '2h'); assert.equal(o.strict, true);
  assert.throws(() => parseRunArgs([]), /usage/);
  assert.throws(() => parseRunArgs(['fix', '--goal', 'x']), /--check/, 'a headless loop with no runnable check could never reach done');
  assert.throws(() => parseRunArgs(['fix', '--bogus']), /unknown flag/);
  assert.throws(() => parseRunArgs(['../evil']), /usage/, 'a name is a path component');
  assert.deepEqual(claudeCommand('/x/fake.mjs'), { cmd: process.execPath, pre: ['/x/fake.mjs'] });
  assert.deepEqual(claudeCommand('/usr/bin/claude'), { cmd: '/usr/bin/claude', pre: [] });
});
test('exit codes: 0 only for done', () => {
  assert.equal(exitCodeFor('done'), 0); assert.equal(exitCodeFor('needs_human'), 2);
  for (const k of ['stuck','max_iters','time-budget','time-budget (killed)']) assert.equal(exitCodeFor(k), 3);
  for (const k of ['no-release','spawn-failed','interrupted']) assert.equal(exitCodeFor(k), 1);
  assert.deepEqual(bannersIn({ a: { b: ['▸ x · pass 2 · ✅ done'] } }), ['▸ x · pass 2 · ✅ done']);
});
test('--goal scaffolds a loop, drives a separate claude -p maker with the right flags + env, and exits 0 on done', () => {
  const r = repo();
  const res = run(r, ['fix', '--goal', 'make it green', '--check', GREEN, '--budget', '10m', '--strict']);
  assert.equal(res.code, 0, res.out + res.err);
  assert.match(res.out, /▸ fix · pass 1 · ✅ done/, 'the gate\'s banner is streamed');
  assert.match(res.out, /fix · done · 1 passes/);
  const wt = path.join(r,'.claude','worktrees','fix');
  assert.equal(fs.realpathSync(res.call.cwd), fs.realpathSync(wt), 'the maker runs IN the loop worktree');
  const a = res.call.argv;
  assert.equal(a[a.indexOf('--plugin-dir') + 1].replace(/[\\/]+$/, ''), ROOT);
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.ok(a.includes('-p') && a.includes('stream-json'));
  assert.equal(res.call.block_cap, '0', 'CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0 or the loop dies at ~8 blocks');
  assert.equal(res.call.strict, '1', '--strict → SEEKS_STRICT_BASH=1 in the maker');
  const s = statusOf(r,'fix');
  assert.equal(s.done, true); assert.ok(s.gate_verified_at, 'done came from the gate');
  assert.equal(s.conditions[0].cmd, GREEN); assert.equal(s.time_budget_sec, 600); assert.ok(s.base_sha);
  assert.equal(execFileSync('git',['-C',r,'rev-parse','--abbrev-ref','HEAD'],{encoding:'utf8'}).trim() !== 'seeks/fix', true, 'the user\'s checkout is untouched');
  assert.ok(fs.readFileSync(path.join(r,'.git','info','exclude'),'utf8').includes('/.seeks/run/'), 'run state ignored without editing .gitignore');
  assert.ok(!fs.existsSync(path.join(r,'.gitignore')));
  assert.ok(fs.readFileSync(path.join(r,'.seeks','loops','fix','spec.md'),'utf8').includes('make it green'));
});
test('a red check the maker keeps certifying ends needs-human → exit 2', () => {
  const r = repo();
  const res = run(r, ['red', '--goal', 'x', '--check', RED], { mode: 'red' });
  assert.equal(res.code, 2, res.out + res.err); assert.match(res.out, /needs-human/);
  assert.notEqual(statusOf(r,'red').done, true);
});
test('a maker that never finishes halts at max-iters → exit 3', () => {
  const r = repo();
  const res = run(r, ['idle', '--goal', 'x', '--check', GREEN, '--max-iters', '3'], { mode: 'idle' });
  assert.equal(res.code, 3, res.out + res.err); assert.match(res.out, /halt: max-iters/);
  assert.equal(hsOf(r,'idle').stop_fires, 3);
});
test('a maker that never yields is killed at the wall clock (backstop) → exit 3, and the loop is disarmed', () => {
  const r = repo();
  const t0 = Date.now();
  const res = run(r, ['hang', '--goal', 'x', '--check', GREEN, '--budget', '1s'], { mode: 'hang' });
  assert.equal(res.code, 3, res.out + res.err); assert.match(res.out, /time-budget \(killed\)/);
  assert.ok(Date.now() - t0 < 15000);
  assert.equal(statusOf(r,'hang').armed, false, 'the runner owns the brakes and releases them');
});
test('a maker that dies before any release → exit 1 with its stderr, loop disarmed, resumable', () => {
  const r = repo();
  const res = run(r, ['boom', '--goal', 'x', '--check', GREEN], { mode: 'crash' });
  assert.equal(res.code, 1); assert.match(res.err, /exited \(code 7\) before the gate released/);
  assert.equal(statusOf(r,'boom').armed, false);
  const again = run(r, ['boom']);                                  // resume the same loop, no --goal
  assert.equal(again.code, 0, again.out + again.err);
});
test('no claude binary → exit 1 with install advice, nothing left armed', () => {
  const r = repo();
  const res = run(r, ['nob', '--goal', 'x', '--check', GREEN, '--claude', path.join(r, 'no-such-claude')]);
  assert.equal(res.code, 1); assert.match(res.err, /could not start .*Install Claude Code/);
  assert.equal(statusOf(r,'nob').armed, false);
});
test('--dry-run plans without scaffolding, arming or spawning', () => {
  const r = repo();
  const res = run(r, ['plan', '--goal', 'x', '--check', GREEN, '--dry-run']);
  assert.equal(res.code, 0); const p = JSON.parse(res.out);
  assert.equal(p.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, '0'); assert.ok(p.args.includes('--plugin-dir'));
  assert.equal(res.call, null, 'claude was not spawned'); assert.ok(!fs.existsSync(path.join(r,'.seeks','run','plan')));
});
test('refuses: an armed loop, an unknown loop, --goal on an existing loop', () => {
  const r = repo();
  assert.equal(run(r, ['ghost']).code, 1);
  assert.equal(run(r, ['one', '--goal', 'x', '--check', GREEN]).code, 0);
  assert.match(run(r, ['one', '--goal', 'x', '--check', GREEN]).err, /already exists/);
  const st = statusOf(r,'one'); fs.writeFileSync(path.join(r,'.seeks','run','one','status.json'), JSON.stringify({ ...st, armed:true }));
  fs.writeFileSync(path.join(r,'.seeks','run','one','hook-state.json'), JSON.stringify({ stop_fires:0 }));
  const res = run(r, ['one']);
  assert.equal(res.code, 1); assert.match(res.err, /already armed/); assert.equal(res.call, null);
});
