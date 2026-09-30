// `seeks run <name>` — the headless driver. Runs a loop to an end state WITHOUT an interactive
// Claude Code session: this process owns the brakes (it arms the loop, holds the lock, enforces
// the wall clock as a backstop and disarms on the way out), and the maker is a separate
// `claude -p` child it only watches — optionally inside a container. The Stop gate inside that
// child is still the only thing that can release `done`; this process just reports what it decided.
//
//   seeks run <name>                                   run an existing loop (made with /seeks:new)
//   seeks run <name> --goal "<text>" --check "<cmd>"…  scaffold a new loop non-interactively, then run it
//   seeks run <name> --resume                          continue after the maker crashed: same session, same budget
//   … --container [--image I] [--network N]            run the maker in `docker run`, not on the host
//   … --json                                           one machine-readable summary on stdout (progress → stderr)
//
// Exit codes: 0 done · 2 needs-human · 3 halted (stuck / max-iters / time budget) · 1 anything else.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import readline from 'node:readline';
import { spawn, spawnSync, execFileSync } from 'node:child_process'; import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readStatus, writeStatusAtomic } from '../hooks/lib/status.mjs';
import { readHookState, recordRunner } from '../hooks/lib/hookstate.mjs';
import { runDir, primaryRoot } from '../hooks/lib/resolve.mjs';
import { isLive } from '../hooks/lib/control.mjs';
import { parseDuration } from '../hooks/lib/budget.mjs';
import { TIERS, resolveTier } from '../hooks/lib/tiers.mjs';
import { buildArgs, bannersIn, exitCodeFor } from './lib/driver.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const CLI = path.join(PLUGIN_ROOT, 'bin', 'seeks.mjs');
export const DEFAULT_IMAGE = 'seeks-maker:latest';
// Credentials the maker needs inside a container, passed by NAME (docker copies the host value if
// set) — never a mounted ~/.claude, never the host HOME.
export const CONTAINER_ENV_PASSTHROUGH = ['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN',
  'ANTHROPIC_VERTEX_PROJECT_ID','CLOUD_ML_REGION','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'];
const VALUE_FLAGS = new Set(['--goal','--check','--level','--budget','--max-iters','--model','--max-budget-usd','--max-turns',
  '--claude','--permission-mode','--base','--image','--network','--docker']);
const BOOL_FLAGS = { '--strict':'strict', '--dry-run':'dryRun', '--verbose':'verbose', '--container':'container', '--json':'json', '--resume':'resume' };
export function parseRunArgs(argv){
  const o = { name: null, checks: [], strict: false, dryRun: false, verbose: false, container: false, json: false, resume: false };
  for (let i = 0; i < argv.length; i++){
    const t = argv[i];
    if (t in BOOL_FLAGS) o[BOOL_FLAGS[t]] = true;
    else if (VALUE_FLAGS.has(t)){
      const v = argv[++i]; if (v == null) throw new Error(`${t} needs a value`);
      if (t === '--check') o.checks.push(v); else o[t.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    else if (t.startsWith('--')) throw new Error(`unknown flag ${t}`);
    else if (!o.name) o.name = t;
    else throw new Error(`unexpected argument "${t}"`);
  }
  if (!o.name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.name)) throw new Error('usage: seeks run <name> [--goal "<text>" --check "<cmd>"…] [--budget 8h] [--max-iters N] [--strict] [--container] [--json] [--resume] [--dry-run]');
  if (o.goal != null && !o.checks.length) throw new Error('--goal needs at least one --check "<cmd>": a headless loop has no intake interview, and without a runnable check it can never reach done');
  if (o.resume && o.goal != null) throw new Error('--resume continues an existing loop; it can\'t be combined with --goal');
  if (o.level && !['L1','L2','L3'].includes(o.level.toUpperCase())) throw new Error(`--level must be L1, L2 or L3`);
  if ((o.image || o.network || o.docker) && !o.container) throw new Error('--image/--network/--docker only apply with --container');
  return o;
}
// A binary by name/path; a .mjs/.js path runs under this node (so a stand-in — the tests' fake
// claude / fake docker — needs no shebang or .cmd shim on Windows).
export function binCommand(bin){ return /\.(m|c)?js$/i.test(bin) ? { cmd: process.execPath, pre: [bin] } : { cmd: bin, pre: [] }; }
export const claudeCommand = (bin) => binCommand(bin || process.env.SEEKS_CLAUDE_BIN || 'claude');
export const makerPrompt = (name, resumed = false) => resumed
  ? `The previous maker process for the seeks loop "${name}" exited before the loop ended. Continue it: re-read .seeks/run/${name}/state.md and follow the /seeks:loop skill. Do EXACTLY ONE pass, then end your turn — the Stop hook re-drives you.`
  : `You are the maker for the seeks loop "${name}", running headless. Its goal and done-conditions are in .seeks/loops/${name}/spec.md and its state in .seeks/run/${name}/ (resolve .seeks with git rev-parse --path-format=absolute --git-common-dir). Read and follow the /seeks:loop skill. Do EXACTLY ONE pass, then end your turn — the Stop hook re-drives you until the gate releases the loop.`;

// `docker run` for the maker. Everything is mounted at the SAME absolute path it has on the host, so
// status.json's worktree_path, the worktree's gitdir pointer and --plugin-dir all resolve unchanged:
//   worktree   rw  — the maker's working tree
//   <root>/.git rw — a worktree commits into the main repo's object store (the refs live there too)
//   <root>/.seeks rw — the hooks read/write loop state; HOME is a per-loop dir under it
//   plugin     ro  — the guardrails, read-only by construction
// Nothing else from the host: no HOME, no ~/.claude, no other repos. Credentials by env NAME only.
export function containerArgs({ name, containerName, worktree, root, pluginRoot, home, image, network, env, claudeArgv, uid = null }){
  const v = (p, ro = false) => ['-v', `${p}:${p}${ro ? ':ro' : ''}`];
  return ['run', '--rm', '--init', '--name', containerName, '--label', `seeks.loop=${name}`,
    ...(uid ? ['--user', uid] : []), '--network', network, '--tmpfs', '/tmp', '-w', worktree,
    ...v(worktree), ...v(path.join(root, '.git')), ...v(path.join(root, '.seeks')), ...v(pluginRoot, true),
    '-e', `HOME=${home}`, ...Object.entries(env).flatMap(([k, val]) => ['-e', `${k}=${val}`]),
    ...CONTAINER_ENV_PASSTHROUGH.flatMap(k => ['-e', k]),
    image, ...claudeArgv];
}

const self = (args, cwd) => execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
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
  const say = (s) => (o.json ? process.stderr : process.stdout).write(`${s}\n`);   // --json: stdout carries ONLY the summary
  const fail = (msg, extra = {}) => { process.stderr.write(`[seeks run] ${msg}\n`);
    if (o.json) process.stdout.write(JSON.stringify({ loop: o.name, outcome: 'error', exit_code: 1, error: msg, ...extra }) + '\n');
    return 1; };
  if (o.container && process.platform === 'win32') return fail('--container needs a POSIX host (the worktree is mounted at its own path inside a Linux container) — run it from WSL');
  const root = primaryRoot(); if (!root) return fail('not inside a git repository');
  const rd = runDir(o.name, root);
  let st = readStatus(rd);
  if (o.goal != null && st) return fail(`loop "${o.name}" already exists — drop --goal to run it again`);
  if (o.goal == null && !st) return fail(`no loop "${o.name}" — create it with /seeks:new, or pass --goal "<text>" --check "<cmd>"`);
  if (st && isLive(st, readHookState(rd))) return fail(`loop "${o.name}" is already armed (a session is driving it, or one died without releasing it). Stop it with /seeks:stop in that session, or set "armed": false in .seeks/run/${o.name}/status.json yourself.`);
  const prevRunner = readHookState(rd)?.runner ?? null;
  if (o.resume){
    if (!prevRunner?.session_id) return fail(`nothing to resume for "${o.name}": no earlier \`seeks run\` session was recorded`);
    if (readHookState(rd)?.released) return fail(`"${o.name}" already ended (${readHookState(rd).released}) — run it again without --resume`);
    if (prevRunner.container !== o.container) return fail(`the previous run was ${prevRunner.container ? '' : 'not '}in a container; resume it the same way (its conversation lives ${prevRunner.container ? 'in the container HOME' : 'in your ~/.claude'})`);
  }
  const budgetSec = o.budget != null ? parseDuration(o.budget) : null;
  if (o.budget != null && !budgetSec) return fail(`bad --budget ${o.budget}`);

  const sessionId = o.resume ? prevRunner.session_id : randomUUID();
  const claudeArgv = buildArgs({ prompt: makerPrompt(o.name, o.resume), pluginDir: PLUGIN_ROOT, permissionMode: o.permissionMode,
    model: o.model, maxBudgetUsd: o.maxBudgetUsd, maxTurns: o.maxTurns, ...(o.resume ? { resume: sessionId } : { sessionId }) });
  const makerEnv = { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: '0', ...(o.strict ? { SEEKS_STRICT_BASH: '1' } : {}) };
  const wtPlanned = st?.worktree_path ?? path.join(root, '.claude', 'worktrees', o.name);
  const containerName = `seeks-${o.name}-${randomBytes(3).toString('hex')}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
  const home = path.join(rd, 'container-home');                 // per-loop, persistent (so --resume finds the conversation)
  let spawnSpec;
  if (o.container){
    const docker = binCommand(o.docker || process.env.SEEKS_DOCKER_BIN || 'docker');
    const uid = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : null;
    spawnSpec = { ...docker, args: [...docker.pre, ...containerArgs({ name: o.name, containerName, worktree: wtPlanned, root, pluginRoot: PLUGIN_ROOT,
      home, image: o.image || process.env.SEEKS_IMAGE || DEFAULT_IMAGE, network: o.network || 'bridge', env: makerEnv,
      claudeArgv: [o.claude || 'claude', ...claudeArgv], uid })], env: process.env, killArgs: [...docker.pre, 'kill', containerName] };
  } else {
    const c = claudeCommand(o.claude);
    spawnSpec = { ...c, args: [...c.pre, ...claudeArgv], env: { ...process.env, ...makerEnv } };
  }
  if (o.dryRun){
    process.stdout.write(JSON.stringify({ dry_run: true, loop: o.name, scaffold: o.goal != null, resume: o.resume, container: o.container,
      cwd: wtPlanned, env: makerEnv, command: spawnSpec.cmd, args: spawnSpec.args }, null, 2) + '\n');
    return 0;
  }

  let wt = st?.worktree_path;
  if (o.goal != null){ try { wt = scaffold(o, root); } catch (e){ return fail(`scaffold failed: ${String(e.stderr || e.message).trim()}`); } }
  if (!fs.existsSync(wt)) return fail(`worktree ${wt} is missing — recreate the loop (/seeks:start refreshes it)`);
  try {
    self(['start', o.name, ...(o.resume ? ['--resume'] : []), ...(budgetSec ? ['--budget', String(budgetSec)] : []),
      ...(o.maxIters && o.goal == null ? ['--max-iters', String(o.maxIters)] : [])], root);
    self(['lock-acquire', o.name], root);
  } catch (e){ return fail(`could not arm "${o.name}": ${String(e.stderr || e.message).trim()}`); }
  if (o.container) fs.mkdirSync(home, { recursive: true });
  const t0 = Date.now();
  recordRunner(rd, { session_id: sessionId, container: o.container, container_name: o.container ? containerName : null,
    started_at: t0, resumed_from: o.resume ? prevRunner.started_at : null });
  st = readStatus(rd);
  say(`[seeks run] ${o.name} · ${o.resume ? 'resumed' : 'armed'} · maker: ${o.container ? `docker (${containerName})` : spawnSpec.cmd === process.execPath ? spawnSpec.pre[0] : spawnSpec.cmd} -p (cwd ${wt})`
    + `${st.time_budget_sec ? ` · budget ${st.time_budget_sec}s` : ''} · max ${st.max_iters ?? 50} passes${o.strict ? ' · strict bash' : ''}`);

  let killedFor = null, spawnError = null, result = null, lastBanner = null; const errTail = [];
  const child = spawn(spawnSpec.cmd, spawnSpec.args, { cwd: wt, env: spawnSpec.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.on('error', (e) => { spawnError = e; });
  const kill = (why) => { if (killedFor || child.exitCode != null) return; killedFor = why;
    say(`[seeks run] ${why} — stopping the maker`);
    if (spawnSpec.killArgs) spawnSync(spawnSpec.cmd, spawnSpec.killArgs, { stdio: 'ignore', timeout: 30000 });   // the container, not just its client
    child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 10000).unref(); };
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
  const binName = o.container ? 'docker' : spawnSpec.cmd;
  if (spawnError) process.stderr.write(`[seeks run] could not start "${binName}": ${spawnError.message}. ${o.container ? 'Install Docker, or point --docker / SEEKS_DOCKER_BIN at it.' : 'Install Claude Code, or point --claude / SEEKS_CLAUDE_BIN at its binary.'}\n`);
  else if (outcome === 'no-release') process.stderr.write(`[seeks run] the maker exited (code ${code}) before the gate released the loop — continue it with: seeks run ${o.name} --resume${o.container ? ' --container' : ''}${errTail.length ? `\n${errTail.join('').trim().slice(-1500)}` : ''}\n`);
  const exit = exitCodeFor(outcome);
  const summary = { loop: o.name, outcome, exit_code: exit, done: outcome === 'done', passes: hs.stop_fires ?? 0,
    cost_usd: result?.total_cost_usd ?? null, branch: `seeks/${o.name}`, worktree: wt, last_verdict: s.last_verdict ?? null,
    gate_verified_at: s.gate_verified_at ?? null, session_id: sessionId, resumed: o.resume, container: o.container,
    maker_exit_code: code, duration_ms: Date.now() - t0 };
  if (o.json) process.stdout.write(JSON.stringify(summary) + '\n');
  const cost = summary.cost_usd != null ? ` · $${Number(summary.cost_usd).toFixed(2)}` : '';
  say(`[seeks run] ${o.name} · ${outcome} · ${summary.passes} passes${cost} · branch seeks/${o.name}${s.last_verdict ? ` · last verdict: ${s.last_verdict}` : ''}`);
  say(outcome === 'done' ? '[seeks run] review it: /seeks:harvest (or git log/diff on the branch). seeks never merges.'
    : `[seeks run] see why: seeks why ${o.name}${outcome === 'no-release' ? '' : ` · run it again: seeks run ${o.name}`}`);
  return exit;
}
