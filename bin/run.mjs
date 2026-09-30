// `seeks run <name>` — the headless driver. Runs a loop to an end state WITHOUT an interactive
// Claude Code session: this process owns the brakes (it arms the loop, holds the lock, enforces
// the wall clock as a backstop and disarms on the way out), and the maker is a separate
// `claude -p` child it only watches. The Stop gate inside that child is still the only thing
// that can release `done`; this process just reports what the gate decided.
//
//   seeks run <name>                                   run an existing loop (made with /seeks:new)
//   seeks run <name> --goal "<text>" --check "<cmd>"…  scaffold a new loop non-interactively, then run it
//
// Exit codes: 0 done · 2 needs-human · 3 halted (stuck / max-iters / time budget) · 1 anything else.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process'; import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readStatus, writeStatusAtomic } from '../hooks/lib/status.mjs';
import { readHookState } from '../hooks/lib/hookstate.mjs';
import { runDir, primaryRoot } from '../hooks/lib/resolve.mjs';
import { isLive } from '../hooks/lib/control.mjs';
import { parseDuration } from '../hooks/lib/budget.mjs';
import { TIERS, resolveTier } from '../hooks/lib/tiers.mjs';
import { buildArgs, bannersIn, exitCodeFor } from './lib/driver.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const CLI = path.join(PLUGIN_ROOT, 'bin', 'seeks.mjs');
const VALUE_FLAGS = new Set(['--goal','--check','--level','--budget','--max-iters','--model','--max-budget-usd','--max-turns',
  '--claude','--permission-mode','--base']);
export function parseRunArgs(argv){
  const o = { name: null, checks: [], strict: false, dryRun: false, verbose: false };
  for (let i = 0; i < argv.length; i++){
    const t = argv[i];
    if (t === '--strict') o.strict = true;
    else if (t === '--dry-run') o.dryRun = true;
    else if (t === '--verbose') o.verbose = true;
    else if (VALUE_FLAGS.has(t)){
      const v = argv[++i]; if (v == null) throw new Error(`${t} needs a value`);
      if (t === '--check') o.checks.push(v); else o[t.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    else if (t.startsWith('--')) throw new Error(`unknown flag ${t}`);
    else if (!o.name) o.name = t;
    else throw new Error(`unexpected argument "${t}"`);
  }
  if (!o.name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.name)) throw new Error('usage: seeks run <name> [--goal "<text>" --check "<cmd>"…] [--budget 8h] [--max-iters N] [--strict] [--dry-run]');
  if (o.goal != null && !o.checks.length) throw new Error('--goal needs at least one --check "<cmd>": a headless loop has no intake interview, and without a runnable check it can never reach done');
  if (o.level && !['L1','L2','L3'].includes(o.level.toUpperCase())) throw new Error(`--level must be L1, L2 or L3`);
  return o;
}
// `claude` on PATH by default; --claude / SEEKS_CLAUDE_BIN override. A .mjs/.js path runs under this
// node (so a stand-in — the tests' fake claude — needs no shebang or .cmd shim on Windows).
export function claudeCommand(bin){
  const b = bin || process.env.SEEKS_CLAUDE_BIN || 'claude';
  return /\.(m|c)?js$/i.test(b) ? { cmd: process.execPath, pre: [b] } : { cmd: b, pre: [] };
}
export const makerPrompt = (name) => `You are the maker for the seeks loop "${name}", running headless. Its goal and done-conditions are in .seeks/loops/${name}/spec.md and its state in .seeks/run/${name}/ (resolve .seeks with git rev-parse --path-format=absolute --git-common-dir). Read and follow the /seeks:loop skill. Do EXACTLY ONE pass, then end your turn — the Stop hook re-drives you until the gate releases the loop.`;

const self = (args, cwd) => execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
const say = (s) => process.stdout.write(`${s}\n`);
const excludeLines = (root, lines) => {                        // ignore run state without touching the user's .gitignore
  let common; try { common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim(); } catch { return; }
  const f = path.join(common, 'info', 'exclude'); fs.mkdirSync(path.dirname(f), { recursive: true });
  let ex = ''; try { ex = fs.readFileSync(f, 'utf8'); } catch {}
  for (const l of lines) if (!ex.split('\n').includes(l)) ex += (ex && !ex.endsWith('\n') ? '\n' : '') + l + '\n';
  fs.writeFileSync(f, ex);
};
function userTier(){ try { const t = JSON.parse(fs.readFileSync(path.join(process.env.SEEKS_HOME || os.homedir(), '.claude', 'seeks.json'), 'utf8')).tier; return TIERS[t] ? t : null; } catch { return null; } }

function scaffold(o, root){
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  let base = o.base; if (!base){ base = git('rev-parse', '--abbrev-ref', 'HEAD'); if (base === 'HEAD') base = git('rev-parse', 'HEAD'); }
  const wtRel = path.join('.claude', 'worktrees', o.name); const wt = path.join(root, wtRel);
  git('worktree', 'add', wtRel, '-b', `seeks/${o.name}`, base);
  excludeLines(root, ['/.seeks/run/', '/.claude/worktrees/']);
  const tier = resolveTier(userTier());
  const conditions = o.checks.map((cmd, i) => ({ id: o.checks.length > 1 ? `check${i + 1}` : 'check', cmd, expect: 0 }));
  try {
    self(['init', o.name, JSON.stringify({ loop: o.name, conditions, level: (o.level || 'L2').toUpperCase(), base_ref: base,
      worktree_path: wt, goal_mode: 'targeted', min_dry_sweeps: 0, max_iters: Number(o.maxIters) || tier.max_iters,
      stuck_threshold: 3, condition_reject_threshold: 3, lock_stale_ttl_sec: 600,
      open_items: 0, items_closed_total: 0, no_progress_count: 0, condition_rejects: {}, dry_sweeps: 0 })], root);
    self(['backlog-add', o.name, o.goal], root);
    self(['status-set', o.name, JSON.stringify({ open_items: 1, open_items_prev: 1 })], root);
    self(['base-record', o.name], root);
    const sd = path.join(root, '.seeks', 'loops', o.name); fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'spec.md'), `---\nlevel: ${(o.level || 'L2').toUpperCase()}\n---\n# Goal\n${o.goal}\n\n## Done-conditions\n`
      + conditions.map(c => `- ${c.id}: \`${c.cmd}\` exits 0\n`).join('')
      + `\n(Scaffolded headless by \`seeks run\` — no intake interview. The Stop hook runs these commands itself before it releases done.)\n`);
    fs.writeFileSync(path.join(runDir(o.name, root), 'state.md'), `# ${o.name}\nfocus: begin — ${o.goal}\n`);
  } catch (e){
    try { self(['gc', o.name, '--force'], root); } catch {}         // roll back the worktree + branch + run dir
    throw e;
  }
  return wt;
}

export async function runCommand(argv){
  let o; try { o = parseRunArgs(argv); } catch (e){ process.stderr.write(`[seeks run] ${e.message}\n`); return 1; }
  const root = primaryRoot(); if (!root){ process.stderr.write('[seeks run] not inside a git repository\n'); return 1; }
  const rd = runDir(o.name, root);
  let st = readStatus(rd);
  if (o.goal != null && st){ process.stderr.write(`[seeks run] loop "${o.name}" already exists — drop --goal to run it again\n`); return 1; }
  if (o.goal == null && !st){ process.stderr.write(`[seeks run] no loop "${o.name}" — create it with /seeks:new, or pass --goal "<text>" --check "<cmd>"\n`); return 1; }
  if (st && isLive(st, readHookState(rd))){ process.stderr.write(`[seeks run] loop "${o.name}" is already armed (a session is driving it, or one died without releasing it). Stop it with /seeks:stop in that session, or set "armed": false in .seeks/run/${o.name}/status.json yourself.\n`); return 1; }
  const budgetSec = o.budget != null ? parseDuration(o.budget) : null;
  if (o.budget != null && !budgetSec){ process.stderr.write(`[seeks run] bad --budget ${o.budget}\n`); return 1; }

  const { cmd, pre } = claudeCommand(o.claude);
  const args = [...pre, ...buildArgs({ prompt: makerPrompt(o.name), pluginDir: PLUGIN_ROOT, permissionMode: o.permissionMode,
    model: o.model, maxBudgetUsd: o.maxBudgetUsd, maxTurns: o.maxTurns, sessionId: randomUUID() })];
  const envAdd = { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: '0', ...(o.strict ? { SEEKS_STRICT_BASH: '1' } : {}) };
  const wtPlanned = st?.worktree_path ?? path.join(root, '.claude', 'worktrees', o.name);
  if (o.dryRun){
    say(JSON.stringify({ dry_run: true, loop: o.name, scaffold: o.goal != null, cwd: wtPlanned, env: envAdd, command: cmd, args }, null, 2));
    return 0;
  }

  const wt = o.goal != null ? (() => { try { return scaffold(o, root); } catch (e){ process.stderr.write(`[seeks run] scaffold failed: ${String(e.stderr || e.message).trim()}\n`); return null; } })() : st.worktree_path;
  if (!wt) return 1;
  if (!fs.existsSync(wt)){ process.stderr.write(`[seeks run] worktree ${wt} is missing — recreate the loop (/seeks:start refreshes it)\n`); return 1; }
  try {
    self(['start', o.name, ...(budgetSec ? ['--budget', String(budgetSec)] : []), ...(o.maxIters && o.goal == null ? ['--max-iters', String(o.maxIters)] : [])], root);
    self(['lock-acquire', o.name], root);
  } catch (e){ process.stderr.write(`[seeks run] could not arm "${o.name}": ${String(e.stderr || e.message).trim()}\n`); return 1; }
  st = readStatus(rd);
  say(`[seeks run] ${o.name} · armed · maker: ${cmd === process.execPath ? pre[0] : cmd} -p (cwd ${wt})${st.time_budget_sec ? ` · budget ${st.time_budget_sec}s` : ''} · max ${st.max_iters ?? 50} passes${o.strict ? ' · strict bash' : ''}`);

  let killedFor = null, spawnError = null, result = null, lastBanner = null; const errTail = [];
  const child = spawn(cmd, args, { cwd: wt, env: { ...process.env, ...envAdd }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.on('error', (e) => { spawnError = e; });
  const kill = (why) => { if (killedFor || child.exitCode != null) return; killedFor = why;
    say(`[seeks run] ${why} — stopping the maker`); child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 10000).unref(); };
  // The gate enforces the time budget on its own; this is the backstop for a maker that never
  // yields (a single turn that runs forever never reaches the Stop hook).
  let timer = null;
  if (st.time_budget_sec && st.started_at != null){
    const grace = Number(process.env.SEEKS_RUN_GRACE_MS) || Math.max(120000, st.time_budget_sec * 100);
    timer = setTimeout(() => kill('time-budget (killed)'), Math.max(0, st.started_at + st.time_budget_sec * 1000 + grace - Date.now()));
  }
  const onSigint = () => kill('interrupted');
  process.on('SIGINT', onSigint);
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (o.verbose) process.stderr.write(`${line}\n`);
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev && ev.type === 'result') result = ev;
    for (const b of bannersIn(ev)) if (b !== lastBanner){ lastBanner = b; say(b); }
  });
  child.stderr.on('data', (d) => { if (o.verbose) process.stderr.write(d); errTail.push(String(d)); while (errTail.join('').length > 4000) errTail.shift(); });
  const code = await new Promise((res) => child.on('close', (c) => res(c)));
  if (timer) clearTimeout(timer); process.off('SIGINT', onSigint);

  try { self(['lock-release', o.name], root); } catch {}
  const s = readStatus(rd) ?? {}; const hs = readHookState(rd) ?? {};
  const outcome = s.done === true && s.gate_verified_at ? 'done'
    : hs.released ? hs.released
    : killedFor ?? (spawnError ? 'spawn-failed' : 'no-release');
  if (!hs.released && s.armed === true)                      // the gate never let go: this process owns the brakes, so it disarms
    writeStatusAtomic(rd, { ...s, armed: false, updated_at: new Date().toISOString() });
  if (spawnError) process.stderr.write(`[seeks run] could not start "${cmd}": ${spawnError.message}. Install Claude Code, or point --claude / SEEKS_CLAUDE_BIN at its binary.\n`);
  else if (outcome === 'no-release') process.stderr.write(`[seeks run] the maker exited (code ${code}) before the gate released the loop.${errTail.length ? `\n${errTail.join('').trim().slice(-1500)}` : ''}\n`);
  const cost = result?.total_cost_usd != null ? ` · $${Number(result.total_cost_usd).toFixed(2)}` : '';
  say(`[seeks run] ${o.name} · ${outcome} · ${hs.stop_fires ?? 0} passes${cost} · branch seeks/${o.name}${s.last_verdict ? ` · last verdict: ${s.last_verdict}` : ''}`);
  say(outcome === 'done' ? '[seeks run] review it: /seeks:harvest (or git log/diff on the branch). seeks never merges.'
    : `[seeks run] see why: seeks why ${o.name} · resume: seeks run ${o.name}`);
  return exitCodeFor(outcome);
}
