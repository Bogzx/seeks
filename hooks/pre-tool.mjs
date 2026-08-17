import fs from 'node:fs';
import { hasSeeksNearby, seeksDir, matchLoopByCwd } from './lib/resolve.mjs';
import { decidePreTool, strictBashEnabled } from './lib/policy.mjs';
import { appendDecision, summarizeInput } from './lib/decisions.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
let runDir = null, sDir = null;                             // hoisted so a crash is still recordable: the run dir if we got
try {                                                       // that far, else the plane-level .seeks (a corrupt status.json
  const cwd = input.cwd || process.cwd();                   // throws inside resolution, before the loop is known)
  if (hasSeeksNearby(cwd)){                                 // cheap fast-path, no subprocess
    sDir = seeksDir(cwd);
    const match = sDir && matchLoopByCwd(sDir, cwd);        // armed-loop-only
    if (match){
      runDir = match.runDir;
      const s = match.status;
      const d = decidePreTool(input.tool_name, input.tool_input || {},
        { level: s.level, worktreePath: s.worktree_path, runDir: match.runDir, denylist: s.denylist ?? [],
          startedAt: s.started_at, timeBudgetSec: s.time_budget_sec, now: Date.now(),
          strictBash: strictBashEnabled(process.env, s), strictBashAllow: s.strict_bash_allow ?? [] });
      appendDecision(match.runDir, { hook:'pre-tool', tool: input.tool_name ?? null, action: d.action,
        rule: d.rule ?? null, reason: d.reason ?? null, input: summarizeInput(input.tool_name, input.tool_input),
        level: s.level ?? null, session: input.session_id ?? null });
      if (d.action === 'deny')                              // deny → emit JSON; otherwise silent exit 0 (defer to normal flow)
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName:'PreToolUse', permissionDecision:'deny', permissionDecisionReason: d.reason } }));
    }
  }
} catch (e) {                                               // fail-open — but never SILENTLY: the crash is itself a record,
  appendDecision(runDir ?? sDir, { hook:'pre-tool', tool: input.tool_name ?? null, action:'crash', rule:'hook-crash',
    error: String((e && e.stack) || e), input: summarizeInput(input.tool_name, input.tool_input),
    session: input.session_id ?? null });                   // so "allowed" and "enforcement was off" stop looking identical
}
process.exit(0);
