import fs from 'node:fs';
import { hasSeeksNearby, seeksDir, matchLoopByCwd } from './lib/resolve.mjs';
import { decidePreTool } from './lib/policy.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
const cwd = input.cwd || process.cwd();
if (!hasSeeksNearby(cwd)) process.exit(0);                 // cheap fast-path, no subprocess
const sDir = seeksDir(cwd); if (!sDir) process.exit(0);
const match = matchLoopByCwd(sDir, cwd); if (!match) process.exit(0);  // armed-loop-only
const s = match.status;
const d = decidePreTool(input.tool_name, input.tool_input || {},
  { level: s.level, worktreePath: s.worktree_path, runDir: match.runDir, denylist: s.denylist ?? [] });
if (d.action === 'deny')                                    // deny → emit JSON; otherwise silent exit 0 (no opinion, defer to normal flow)
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName:'PreToolUse', permissionDecision:'deny', permissionDecisionReason: d.reason } }));
process.exit(0);
