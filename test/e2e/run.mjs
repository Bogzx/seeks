// seeks e2e runner — drives ONE scenario with a real `claude -p` child session.
//
//   node test/e2e/run.mjs <scenario>            # DRY-RUN: sets up the fixture + prints the
//                                               # planned command, never spawns claude (free)
//   SEEKS_E2E=1 node test/e2e/run.mjs <scenario> # REAL: spawns claude, drives the loop, asserts
//
// Real runs cost credits and need `claude` logged in (or ANTHROPIC_API_KEY). The Stop-hook loop
// only survives past ~8 blocks because we set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0 in the child env.
// Override the binary with SEEKS_E2E_CLAUDE_BIN (e.g. a full path / claude.cmd on Windows) and the
// model with SEEKS_E2E_MODEL (default sonnet).

import fs from 'node:fs'; import path from 'node:path';
import { spawnSync } from 'node:child_process'; import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildArgs, parseStream, terminalFromStatus } from './driver.mjs';
import { scenarios } from './scenarios.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const name = process.argv[2];
const sc = scenarios[name];
if (!sc){ console.error(`unknown scenario "${name}". known: ${Object.keys(scenarios).join(', ')}`); process.exit(2); }

const ctx = sc.setup();
const prompt = `You are running the seeks loop "${ctx.name}" in this worktree. Read and follow the /seeks:loop skill. Do EXACTLY one pass, then STOP — end your turn so the Stop hook re-drives you.`;
const args = buildArgs({ prompt, pluginDir: REPO_ROOT, maxTurns: sc.maxTurns ?? 200,
  sessionId: randomUUID(), model: process.env.SEEKS_E2E_MODEL || 'sonnet', maxBudgetUsd: sc.maxBudgetUsd ?? 5 });

if (!process.env.SEEKS_E2E){
  console.log(`[dry-run] scenario "${name}"`);
  console.log(`  repo:     ${ctx.repoRoot}`);
  console.log(`  worktree: ${ctx.worktree}`);
  console.log(`  would run (cwd=worktree):  CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0 claude ${args.join(' ')}`);
  console.log(`  set SEEKS_E2E=1 to actually drive the session (costs credits).`);
  process.exit(0);
}

const bin = process.env.SEEKS_E2E_CLAUDE_BIN || 'claude';
const env = { ...process.env, CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: '0' };
console.log(`[run] ${bin} -p (scenario ${name}) in ${ctx.worktree} …`);
const res = spawnSync(bin, args, { cwd: ctx.worktree, env, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 });
if (res.error){ console.error(`spawn failed: ${res.error.message}\n(set SEEKS_E2E_CLAUDE_BIN to the claude binary path)`); process.exit(2); }
const parsed = parseStream(res.stdout || '');

const rd = path.join(ctx.repoRoot, '.seeks', 'run', ctx.name);
const status = JSON.parse(fs.readFileSync(path.join(rd, 'status.json'), 'utf8'));
let hook = {}; try { hook = JSON.parse(fs.readFileSync(path.join(rd, 'hook-state.json'), 'utf8')); } catch {}

const kind = terminalFromStatus(status, hook);   // authoritative — banner-independent (a done loop may emit no banner)
const fails = [];
if (sc.expectKind && kind !== sc.expectKind)
  fails.push(`terminal ${JSON.stringify(kind)} (from status) !== expected ${JSON.stringify(sc.expectKind)}`);
for (const inv of sc.invariants(status, hook, parsed)) if (!inv.ok) fails.push(inv.msg);

console.log(`\n=== scenario ${name} ===`);
console.log(`banners (${parsed.banners.length}):`); for (const b of parsed.banners) console.log('  ' + b);
console.log(`terminal: ${kind} (status) | banner: ${parsed.terminal}`);
console.log(`status: done=${status.done} certified=${status.verifier_certified} dry=${status.dry_sweeps} ` +
            `no_progress=${status.no_progress_count} needs_human=${status.needs_human} stop_fires=${hook.stop_fires}`);
if (res.status !== 0) console.log(`(claude exit code: ${res.status})`);
if (fails.length){ console.error(`\nFAIL:\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('\nPASS'); process.exit(0);
