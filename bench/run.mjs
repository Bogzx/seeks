#!/usr/bin/env node
// seeks benchmark runner. DRY-RUN by default: prints the plan and spends nothing.
//
//   node bench/run.mjs                                  # plan: every task × arm × repeat
//   node bench/run.mjs --live --repeats 3               # REAL: spawns claude -p (costs credits)
//   node bench/run.mjs --live --tasks overfit-trap --arms seeks --model sonnet --max-budget-usd 2
//   node bench/report.mjs bench/results/<file>.jsonl    # the results table
//
// Arms:
//   seeks  `seeks run <name> --goal … --check …` — the Stop gate decides; claimed = exit 0 (done)
//   naive  up to N × `claude -p "<goal> …"` in the repo, stopping as soon as the visible check is
//          green — the `while true; do claude; done` baseline; claimed = it stopped on green
// Each finished tree is then judged by bench/lib.mjs::evaluate (visible + hidden check + oracle
// tamper), one JSON row per run appended to --out.
import fs from 'node:fs'; import path from 'node:path';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { loadTasks, materialize, evaluate, classify, renderTable } from './lib.mjs';
import { claudeCommand } from '../bin/run.mjs';
import { conditionEnv } from '../hooks/lib/verify.mjs';
const SEEKS = fileURLToPath(new URL('../bin/seeks.mjs', import.meta.url));

export function parseBenchArgs(argv){
  const o = { live: false, repeats: 1, arms: ['seeks','naive'], tasks: null, out: null, model: null, maxBudgetUsd: null, claude: null, naiveIters: 8, strict: true };
  for (let i = 0; i < argv.length; i++){ const t = argv[i], v = () => { const x = argv[++i]; if (x == null) throw new Error(`${t} needs a value`); return x; };
    if (t === '--live') o.live = true;
    else if (t === '--repeats') o.repeats = Math.max(1, parseInt(v(), 10) || 1);
    else if (t === '--arms') o.arms = v().split(',');
    else if (t === '--tasks') o.tasks = v().split(',');
    else if (t === '--out') o.out = v();
    else if (t === '--model') o.model = v();
    else if (t === '--max-budget-usd') o.maxBudgetUsd = v();
    else if (t === '--claude') o.claude = v();
    else if (t === '--naive-iters') o.naiveIters = Math.max(1, parseInt(v(), 10) || 1);
    else if (t === '--no-strict') o.strict = false;
    else throw new Error(`unknown flag ${t}`); }
  for (const a of o.arms) if (!['seeks','naive'].includes(a)) throw new Error(`unknown arm ${a}`);
  return o;
}
const costOf = (stdout) => { let c = null; for (const l of String(stdout).split('\n')){ const m = /\$([0-9]+\.[0-9]+)/.exec(l); if (/\[seeks run\]/.test(l) && m) c = Number(m[1]);
  try { const e = JSON.parse(l); if (e?.type === 'result' && e.total_cost_usd != null) c = (c ?? 0) + Number(e.total_cost_usd); } catch {} } return c; };
const OUTCOME = { 0: 'done', 2: 'needs_human', 3: 'halted' };

export function runOne(task, arm, o){
  const { dir, base } = materialize(task); const t0 = Date.now(); let claimed = false, outcome = null, cost = null, workDir = dir;
  if (arm === 'seeks'){
    const name = `bench-${task.id}`.slice(0, 60);
    const args = [SEEKS, 'run', name, '--goal', task.goal, '--check', task.check, '--budget', task.budget ?? '20m',
      '--max-iters', String(task.max_iters ?? 20), ...(o.strict ? ['--strict'] : []), ...(o.model ? ['--model', o.model] : []),
      ...(o.maxBudgetUsd ? ['--max-budget-usd', String(o.maxBudgetUsd)] : []), ...(o.claude ? ['--claude', o.claude] : [])];
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, BENCH_API_KEY: '' } });
    claimed = r.status === 0; outcome = OUTCOME[r.status] ?? 'error'; cost = costOf(r.stdout);
    workDir = path.join(dir, '.claude', 'worktrees', name);
  } else {
    const { cmd, pre } = claudeCommand(o.claude);
    const prompt = `${task.goal}\nThe check is: ${task.check}. Keep working until it passes, then stop.`;
    for (let i = 0; i < o.naiveIters; i++){
      const r = spawnSync(cmd, [...pre, '-p', prompt, '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose',
        ...(o.model ? ['--model', o.model] : []), ...(o.maxBudgetUsd ? ['--max-budget-usd', String(o.maxBudgetUsd)] : [])],
        { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, BENCH_API_KEY: '' } });
      cost = (cost ?? 0) + (costOf(r.stdout) ?? 0);
      if (spawnSync(task.check, { cwd: dir, shell: true, env: conditionEnv() }).status === 0){ claimed = true; break; }
    }
    outcome = claimed ? 'done' : 'gave-up';
  }
  const ev = evaluate(task, workDir, base);
  return { ts: new Date().toISOString(), task: task.id, arm, trap: task.trap ?? null, expect: task.expect, outcome, claimed,
    ...ev, ...classify(task, { claimed, ...ev }), wall_ms: Date.now() - t0, cost_usd: cost, dir };
}

export function main(argv = process.argv.slice(2)){
  let o; try { o = parseBenchArgs(argv); } catch (e){ console.error(e.message); return 2; }
  const tasks = loadTasks(undefined, o.tasks);
  const plan = tasks.flatMap(t => o.arms.flatMap(arm => Array.from({ length: o.repeats }, (_, i) => ({ t, arm, i }))));
  if (!o.live){
    console.log(`[bench] dry run — ${plan.length} runs (${tasks.length} tasks × ${o.arms.join('+')} × ${o.repeats}). Nothing spawned, nothing spent.`);
    for (const { t, arm, i } of plan) console.log(`  ${t.id.padEnd(22)} ${arm.padEnd(6)} #${i + 1}  expect ${t.expect}${t.trap ? ` · trap ${t.trap}` : ''}`);
    console.log('[bench] add --live to run (each run spawns claude -p; budget with --max-budget-usd).');
    return 0;
  }
  const out = o.out ?? path.join(fileURLToPath(new URL('./results/', import.meta.url)), `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const rows = [];
  for (const { t, arm, i } of plan){
    console.log(`[bench] ${t.id} · ${arm} · #${i + 1} …`);
    const row = runOne(t, arm, o); rows.push(row); fs.appendFileSync(out, JSON.stringify(row) + '\n');
    console.log(`        → ${row.verdict} (${row.outcome}) · visible ${row.visible} · hidden ${row.hidden}${row.tampered.length ? ` · TAMPERED ${row.tampered.join(', ')}` : ''}`);
  }
  console.log(`\n${renderTable(rows)}\n\n[bench] rows: ${out}`);
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exitCode = main();
