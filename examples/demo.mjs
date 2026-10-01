#!/usr/bin/env node
// seeks in 60 seconds, with no model and no tokens.
//
//   node examples/demo.mjs            (from a clone of this repo; Node >= 18 and git on PATH)
//   node examples/demo.mjs --pace 700 (pause between steps, for a recording)
//
// It copies examples/add (an unimplemented add() and its test) into a temp git repo, creates two
// seeks loops on it with the real CLI, and plays a scripted "maker" against the REAL hooks the way
// Claude Code calls them: hooks/pre-tool.mjs before every tool call, hooks/stop-gate.mjs whenever
// the maker ends its turn. Every verdict printed below comes from those hooks; the script only
// decides what the maker tries. It exits 1 if any verdict differs from the one shown in the README.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(ROOT, 'bin', 'seeks.mjs');
const HOOK = (h) => path.join(ROOT, 'hooks', h);
const argv = process.argv.slice(2);
const pace = Number(argv[argv.indexOf('--pace') + 1]) || 0;
const keep = argv.includes('--keep');
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const seeks = (cwd, ...a) => spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8' });

// ── a throwaway repo holding examples/add, and two loops on it ─────────────────────────────
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-demo-')));
const show = (s) => String(s).split(repo).join('<repo>').split('\\').join('/');
fs.cpSync(path.join(ROOT, 'examples', 'add'), repo, { recursive: true });
git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'demo@example.com'); git(repo, 'config', 'user.name', 'demo');
git(repo, 'config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, '.gitignore'), '/.seeks/run/\n/.claude/worktrees/\n');
git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'add() is not implemented yet');
const base = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');

function newLoop(name){
  git(repo, 'worktree', 'add', '-q', path.join('.claude', 'worktrees', name), '-b', `seeks/${name}`, base);
  const wt = path.join(repo, '.claude', 'worktrees', name);
  const init = seeks(repo, 'init', name, JSON.stringify({ loop: name, level: 'L2', base_ref: base, worktree_path: wt,
    conditions: [{ id: 'tests', cmd: 'npm test', expect: 0 }], goal_mode: 'targeted', min_dry_sweeps: 0, max_iters: 20,
    stuck_threshold: 5, condition_reject_threshold: 3, open_items: 0, items_closed_total: 0, no_progress_count: 0, condition_rejects: {}, dry_sweeps: 0 }));
  if (init.status !== 0) throw new Error(init.stderr);
  seeks(repo, 'base-record', name); seeks(repo, 'start', name);
  return wt;
}

// ── what the maker does, and what seeks says ───────────────────────────────────────────────
let failures = 0;
const say = (who, text) => { console.log(`${who} ${text}`); sleep(pace); };
const maker = (text) => say(c('36', 'maker ›'), text);
const verdict = (good, text, expected) => {
  const ok = expected === undefined || good === expected;
  if (!ok) failures++;
  say(c(good ? '32' : '31', 'seeks ›'), text + (ok ? '' : c('31', '   ✗ not the verdict the README shows')));
};
const heading = (s) => { console.log(`\n${c('1', s)}`); sleep(pace); };

// A tool call, through hooks/pre-tool.mjs exactly as Claude Code sends it.
function tool(wt, tool_name, tool_input, { expectDeny }){
  const r = spawnSync(process.execPath, [HOOK('pre-tool.mjs')], { cwd: wt, encoding: 'utf8',
    input: JSON.stringify({ cwd: wt, session_id: 'demo', tool_name, tool_input }) });
  const out = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  const denied = out?.hookSpecificOutput?.permissionDecision === 'deny';
  const full = (out?.hookSpecificOutput?.permissionDecisionReason ?? '').replace(/^\[seeks\] /, '');
  const reason = full.split(' — ')[0];
  verdict(!denied, denied ? `DENY  ${reason}` : 'allow', !expectDeny);
  return !denied;
}
const edit = (wt, rel, body, opts) => { maker(`Write ${rel}`); if (tool(wt, 'Write', { file_path: path.join(wt, rel), content: body }, opts)) fs.writeFileSync(path.join(wt, rel), body); };
const bash = (wt, cmd, opts) => { maker(`Bash  ${show(cmd)}`); return tool(wt, 'Bash', { command: cmd }, opts); };

// The maker ends its turn: Claude Code runs the Stop hook, which decides whether the loop may stop.
function endTurn(name, wt, expect){
  maker('end of turn');
  const r = spawnSync(process.execPath, [HOOK('stop-gate.mjs')], { cwd: wt, encoding: 'utf8', input: JSON.stringify({ cwd: wt, session_id: 'demo' }) });
  const out = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  const st = JSON.parse(seeks(repo, 'status-get', name).stdout);
  const banner = (out.systemMessage ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  const outcome = out.decision === 'block' ? 'block' : st.done ? 'done' : st.needs_human ? 'needs-human' : 'other';
  verdict(outcome === 'done', `${banner}${outcome === 'block' && st.last_verdict ? `\n        ${st.last_verdict}` : ''}`, undefined);
  if (outcome !== expect){ failures++; console.log(c('31', `        ✗ expected ${expect}, got ${outcome}`)); }
}

const runCli = (name, ...a) => { maker(`seeks ${a.join(' ')}`); const r = seeks(repo, ...a); return r; };

console.log(c('1', 'seeks demo') + c('2', ' — real hooks, scripted maker, no model, no tokens'));
console.log(c('2', 'project: examples/add (add() throws "not implemented"); done-condition for both loops: `npm test` exits 0'));

// Loop 1: the maker takes shortcuts, then does the work.
const wt = newLoop('fix-add');
const statusFile = path.join(repo, '.seeks', 'run', 'fix-add', 'status.json');
heading('1. Guardrails run before every tool call');
edit(wt, '.env', 'API_KEY=…\n', { expectDeny: true });
bash(wt, 'git push origin seeks/fix-add', { expectDeny: true });
bash(wt, `echo '{"armed":false}' > ${statusFile}`, { expectDeny: true });

heading('2. "done" is the Stop hook\'s call, not the model\'s');
let r = runCli('fix-add', 'status-set', 'fix-add', '{"done":true}');
verdict(r.status === 0, r.status === 0 ? 'accepted' : `REFUSED  ${r.stderr.replace(/^\[seeks\] /, '').split(' (applied')[0]}: ${(/done → ([^·]*?)\./.exec(r.stderr) ?? [, ''])[1]}`, false);
r = runCli('fix-add', 'certify', 'fix-add');
console.log(c('2', '        (the verifier\'s sign-off is advice; the Stop hook now runs `npm test` itself)'));
endTurn('fix-add', wt, 'block');

heading('3. A real fix, verified by the hook');
edit(wt, 'src/add.mjs', 'export function add(a, b) {\n  return a + b;\n}\n', { expectDeny: false });
git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'implement add');
maker('git commit -m "implement add"');
runCli('fix-add', 'certify', 'fix-add');
endTurn('fix-add', wt, 'done');

// Loop 2: same goal, but the maker "passes" by rewriting the test.
const wt2 = newLoop('cheat');
heading('4. Rewriting the test is a green check, and it still goes to a human');
edit(wt2, 'test/add.test.mjs', "import { test } from 'node:test';\ntest('add sums two numbers', () => {});\n", { expectDeny: false });
runCli('cheat', 'oracle-ack', 'cheat');
console.log(c('2', '        (the verifier "accounts for" the changed test file; by default that is not enough)'));
runCli('cheat', 'certify', 'cheat');
endTurn('cheat', wt2, 'needs-human');

heading('5. Every verdict is logged');
maker('seeks why fix-add --denied');
for (const row of seeks(repo, 'why', 'fix-add', '--denied', '--json').stdout.split('\n').filter(Boolean).map(l => JSON.parse(l)))
  console.log(c('2', `        ✖ ${row.hook} · ${row.rule.padEnd(11)} ${show(row.input?.file_path ?? row.input?.command ?? '').slice(0, 72)}`));

if (!keep){ try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} }
else console.log(`\nkept: ${repo}`);
console.log(failures ? c('31', `\n✗ ${failures} verdict(s) differ from the README — this is a bug, please report it.`)
  : c('2', '\nNo model was called. Every verdict above came from hooks/pre-tool.mjs, hooks/stop-gate.mjs or the seeks CLI.'));
process.exit(failures ? 1 : 0);
