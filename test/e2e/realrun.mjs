// seeks real-repo runner — drive a CREATIVE bug-hunt loop against a REAL project (not a
// fixture). Reads each source module hunting real defects, fixes them, keeps a static floor
// (ruff+mypy) green, until-dry on FINDINGS. Isolated on a seeks/<name> worktree (never merged).
//
//   node test/e2e/realrun.mjs                 # DRY-RUN: scaffold + print the planned command (free)
//   SEEKS_E2E=1 node test/e2e/realrun.mjs     # REAL: drive a claude -p child + report (costs usage)
//
// Knobs (env): SEEKS_REPO (repo root), SEEKS_NAME (loop name), SEEKS_SRC (dir under repo to
// seed module-review items from), SEEKS_VENV (Scripts dir with ruff.exe/mypy.exe for the floor),
// SEEKS_E2E_MODEL (default sonnet), SEEKS_BUDGET (USD cap), SEEKS_MAX_ITERS.
// Point SEEKS_REPO at the target repo; adapt the spec/floor per project (this config suits a Python repo).

import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildArgs, parseStream, terminalFromStatus } from './driver.mjs';

const SEEKS_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const CLI  = SEEKS_ROOT + '/bin/seeks.mjs';
const REPO = (process.env.SEEKS_REPO || '').replace(/\\/g, '/');
if (!REPO) { console.error('set SEEKS_REPO=<path to the target repo> (see the header for SEEKS_SRC/SEEKS_VENV)'); process.exit(2); }
const NAME = process.env.SEEKS_NAME || 'bughunt';
const SRC  = process.env.SEEKS_SRC  || 'src';
const VENV = (process.env.SEEKS_VENV || REPO + '/.venv/Scripts').replace(/\\/g, '/');
const RUFF = VENV + '/ruff.exe', MYPY = VENV + '/mypy.exe';
const ITERS = Number(process.env.SEEKS_MAX_ITERS || 18);

const sh    = (cmd, args, cwd) => { try { return execFileSync(cmd, args, { cwd, encoding:'utf8' }); } catch (e) { return (e.stdout||'') + (e.stderr||''); } };
const seeks = (...a) => execFileSync('node', [CLI, ...a], { cwd: REPO, encoding:'utf8' });
const floor = (wt) => `ruff ${/All checks passed/.test(sh(RUFF,['check','.'],wt)) ? 'clean' : 'ISSUES'} | mypy ${/no issues found|Success/.test(sh(MYPY,['src'],wt)) ? 'clean' : 'ISSUES'}`;

// local ignore (don't touch the user's tracked .gitignore)
const excl = REPO + '/.git/info/exclude';
let ex = fs.existsSync(excl) ? fs.readFileSync(excl,'utf8') : '';
for (const line of ['/.seeks/','/.claude/worktrees/']) if (!ex.includes(line)) ex += (ex && !ex.endsWith('\n') ? '\n' : '') + line + '\n';
fs.writeFileSync(excl, ex);

// fresh worktree on seeks/<name>
const base  = execFileSync('git', ['rev-parse','--abbrev-ref','HEAD'], { cwd:REPO, encoding:'utf8' }).trim();
const wtRel = '.claude/worktrees/' + NAME, wt = REPO + '/' + wtRel;
sh('git', ['worktree','remove','--force', wtRel], REPO);
sh('git', ['branch','-D','seeks/'+NAME], REPO);
fs.rmSync(REPO + '/.seeks/run/' + NAME, { recursive:true, force:true });
execFileSync('git', ['worktree','add', wtRel, '-b', 'seeks/'+NAME, base], { cwd:REPO, encoding:'utf8' });

seeks('init', NAME, JSON.stringify({ loop:NAME, armed:true, done:false, verifier_certified:false,
  open_items:0, items_closed_total:0, no_progress_count:0, condition_rejects:{}, dry_sweeps:0, dry_sweeps_prev:0,
  worktree_path:wt, max_iters:ITERS, stuck_threshold:4, condition_reject_threshold:3, lock_stale_ttl_sec:1800, min_dry_sweeps:2 }));

let modules = [];
try { modules = fs.readdirSync(wt + '/' + SRC).filter(f => f.endsWith('.py') && f !== '__init__.py'); } catch {}
const seed = (modules.length ? modules : ['(whole package)']).map(m =>
  `Creatively review ${SRC}/${m} for REAL bugs (logic, edge cases, error handling, parsing, timezones); fix any found, keep ruff+mypy clean`);
for (const it of seed) seeks('backlog-add', NAME, it);
seeks('status-set', NAME, JSON.stringify({ open_items: seed.length, open_items_prev: seed.length }));

const sd = REPO + '/.seeks/loops/' + NAME; fs.mkdirSync(sd, { recursive:true });
fs.writeFileSync(sd + '/spec.md',
`# Goal\nCreatively READ the source and find + fix REAL bugs — logic errors, off-by-one, wrong boundaries/operators, unhandled None/empty/error paths, bad parsing, timezone/locale bugs, error-handling gaps, resource leaks. Do NOT just make a tool pass.\n\n## Regression floor (keep green after every fix)\n- ruff: \`${RUFF} check .\` -> exit 0.   - mypy: \`${MYPY} src\` -> exit 0.\n(The venv is NOT in the worktree; use the ABSOLUTE tool paths. Do not pip install.)\n\n## Discovery = creative review (the real work)\nEach pass read a module, reason about correctness, find NEW real bugs; backlog-add (file:line + why) then fix minimally. Linters are a floor, not the finder.\n\n## Done (until-dry)\nCertify only after TWO consecutive creative read-throughs surface no new real bug (min_dry_sweeps=2). The verifier spot-checks each fix was a REAL bug.\n`);
fs.writeFileSync(REPO + '/.seeks/run/' + NAME + '/state.md', `# ${NAME}\nfocus: creative bug hunt\n`);

const prompt = `You are running the seeks loop "${NAME}" in this worktree on a REAL repo. Read and follow the /seeks:loop skill. This is a CREATIVE BUG HUNT: each pass, actually READ a module's source and find REAL bugs by reasoning — do NOT just run linters. Fix real bugs minimally; keep ruff (\`${RUFF} check .\`) and mypy (\`${MYPY} src\`) clean. Do EXACTLY one pass, then STOP so the Stop hook re-drives you.`;
const args = buildArgs({ prompt, pluginDir: SEEKS_ROOT, maxTurns: 400, sessionId: randomUUID(),
  model: process.env.SEEKS_E2E_MODEL || 'sonnet', maxBudgetUsd: Number(process.env.SEEKS_BUDGET || 10) });

console.log(`[before] ${floor(wt)} | seeded ${seed.length} module-review items | worktree ${wt}`);
if (!process.env.SEEKS_E2E){
  console.log(`[dry-run] would run: CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0 claude ${args.join(' ')}`);
  console.log(`[dry-run] set SEEKS_E2E=1 to drive the real loop (costs usage).`);
  process.exit(0);
}

console.log(`[run] model ${process.env.SEEKS_E2E_MODEL || 'sonnet'} | budget $${process.env.SEEKS_BUDGET || 10} | max_iters ${ITERS} | driving…`);
const res = spawnSync(process.env.SEEKS_E2E_CLAUDE_BIN || 'claude', args,
  { cwd: wt, env: { ...process.env, CLAUDE_CODE_STOP_HOOK_BLOCK_CAP:'0' }, encoding:'utf8', maxBuffer: 256*1024*1024, timeout: 50*60*1000 });

const parsed = parseStream(res.stdout || '');
const status = JSON.parse(fs.readFileSync(REPO + '/.seeks/run/' + NAME + '/status.json','utf8'));
let hook = {}; try { hook = JSON.parse(fs.readFileSync(REPO + '/.seeks/run/' + NAME + '/hook-state.json','utf8')); } catch {}
const uniq = [...new Set(parsed.banners)];

console.log('\n=== creative bug-hunt: ' + NAME + ' ===');
for (const b of uniq.slice(-30)) console.log('  ' + b);
console.log('terminal: ' + terminalFromStatus(status, hook) + ' (status) | banner: ' + parsed.terminal);
console.log(`status: done=${status.done} certified=${status.verifier_certified} dry=${status.dry_sweeps} closed=${status.items_closed_total} stop_fires=${hook.stop_fires}`);
console.log('[after] ' + floor(wt));
console.log('commits on seeks/' + NAME + ':\n' + (sh('git',['log','--oneline', base + '..seeks/' + NAME], REPO) || '(none)'));
console.log('worktree kept at: ' + wt);
