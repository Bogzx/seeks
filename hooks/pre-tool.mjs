import fs from 'node:fs';
import { hasSeeksNearby, seeksDir, matchLoopByCwd } from './lib/resolve.mjs';
import { decidePreTool } from './lib/policy.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
try {                                                       // fail-open: a hook error must never block a tool call
  const cwd = input.cwd || process.cwd();
  if (hasSeeksNearby(cwd)){                                 // cheap fast-path, no subprocess
    const sDir = seeksDir(cwd);
    const match = sDir && matchLoopByCwd(sDir, cwd);        // armed-loop-only
    if (match){
      const s = match.status;
      const d = decidePreTool(input.tool_name, input.tool_input || {},
        { level: s.level, worktreePath: s.worktree_path, runDir: match.runDir, denylist: s.denylist ?? [],
          startedAt: s.started_at, timeBudgetSec: s.time_budget_sec, now: Date.now() });
      if (d.action === 'deny')                              // deny → emit JSON; otherwise silent exit 0 (defer to normal flow)
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName:'PreToolUse', permissionDecision:'deny', permissionDecisionReason: d.reason } }));
    }
  }
} catch { /* fail-open */ }
process.exit(0);
