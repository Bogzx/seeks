import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
// A crash row, even when the crash is a lib that fails to IMPORT (a missing or corrupt hooks/lib
// file). The libs load inside the try below, so that throw is caught too; the logger itself is
// loaded lazily, and if IT is what's broken, the row is appended with builtins only to the
// nearest .seeks/decisions.jsonl. Still fail-open: the hook exits 0 either way.
async function logCrash(dir, rec){
  try { const { appendDecision } = await import('./lib/decisions.mjs'); if (appendDecision(dir ?? nearestPlane(), rec)) return; } catch {}
  try { const d = dir ?? nearestPlane(); if (d) fs.appendFileSync(path.join(d, 'decisions.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`); } catch {}
}
function nearestPlane(){
  let d = path.resolve(input.cwd || process.cwd());
  for (;;){ const p = path.join(d, '.seeks'); try { if (fs.statSync(p).isDirectory()) return p; } catch {} const up = path.dirname(d); if (up === d) return null; d = up; }
}
// Where the guardrails live — protected from the loop (policy.mjs, rule plugin-dir). Every
// spelling of it: this file's own location, $CLAUDE_PLUGIN_ROOT, and their resolved forms.
const pluginRoots = () => { const out = new Set();
  for (const r of [fileURLToPath(new URL('..', import.meta.url)), process.env.CLAUDE_PLUGIN_ROOT]){ if (!r) continue;
    out.add(r); try { out.add(fs.realpathSync.native(r)); } catch {} }
  return [...out]; };
let runDir = null, sDir = null;                             // hoisted so a crash is still recordable: the run dir if we got
try {                                                       // that far, else the plane-level .seeks (a corrupt status.json
  const [{ hasSeeksNearby, seeksDir, matchLoopByCwd }, { decidePreTool, strictBashEnabled }, { appendDecision, summarizeInput }] =
    await Promise.all([import('./lib/resolve.mjs'), import('./lib/policy.mjs'), import('./lib/decisions.mjs')]);
  const cwd = input.cwd || process.cwd();                   // throws inside resolution, before the loop is known)
  if (hasSeeksNearby(cwd)){                                 // cheap fast-path, no subprocess
    sDir = seeksDir(cwd);
    const match = sDir && matchLoopByCwd(sDir, cwd);        // armed-loop-only
    if (match){
      runDir = match.runDir;
      const s = match.status;
      const d = decidePreTool(input.tool_name, input.tool_input || {},
        { level: s.level, worktreePath: s.worktree_path, runDir: match.runDir, denylist: s.denylist ?? [],
          cwd,                                                  // the shell's ACTUAL cwd — what a relative
                                                                // Bash path resolves against (`> status.json`)

          startedAt: s.started_at, timeBudgetSec: s.time_budget_sec, now: Date.now(),
          strictBash: strictBashEnabled(process.env, s), strictBashAllow: s.strict_bash_allow ?? [], pluginRoot: pluginRoots() });
      appendDecision(match.runDir, { hook:'pre-tool', tool: input.tool_name ?? null, action: d.action,
        rule: d.rule ?? null, reason: d.reason ?? null, input: summarizeInput(input.tool_name, input.tool_input),
        level: s.level ?? null, session: input.session_id ?? null });
      if (d.action === 'deny')                              // deny → emit JSON; otherwise silent exit 0 (defer to normal flow)
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName:'PreToolUse', permissionDecision:'deny', permissionDecisionReason: d.reason } }));
    }
  }
} catch (e) {                                               // fail-open — but never SILENTLY: the crash is itself a record,
  await logCrash(runDir ?? sDir, { hook:'pre-tool', tool: input.tool_name ?? null, action:'crash', rule:'hook-crash',
    error: String((e && e.stack) || e), input: input.tool_input?.command != null ? { command: String(input.tool_input.command).slice(0, 400) }
      : (input.tool_input?.file_path ?? input.tool_input?.notebook_path) != null ? { file_path: String(input.tool_input.file_path ?? input.tool_input.notebook_path).slice(0, 300) } : null,
    session: input.session_id ?? null });                   // so "allowed" and "enforcement was off" stop looking identical
}
process.exit(0);
