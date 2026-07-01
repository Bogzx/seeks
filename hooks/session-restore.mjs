import fs from 'node:fs'; import path from 'node:path';
import { hasSeeksNearby, seeksDir, primaryRoot, matchLoopByCwd } from './lib/resolve.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
const cwd = input.cwd || process.cwd();
if (!hasSeeksNearby(cwd)) process.exit(0);
const sDir = seeksDir(cwd); if (!sDir) process.exit(0);
const match = matchLoopByCwd(sDir, cwd); if (!match) process.exit(0);
const rd = match.runDir;
const read = (f) => { try { return fs.readFileSync(path.join(rd,f),'utf8'); } catch { return ''; } };
const spec = (()=>{ try { return fs.readFileSync(path.join(primaryRoot(cwd),'.seeks','loops',match.name,'spec.md'),'utf8'); } catch { return ''; } })();
const ctx =
`seeks loop "${match.name}" is ACTIVE in this worktree — resume it.
GOAL & DONE-CONDITIONS (spec.md):
${spec.slice(0,1500)}
CURRENT state.md:
${read('state.md').slice(0,1500)}
Open items: ${match.status.open_items ?? '?'} (backlog: .seeks/run/${match.name}/backlog.md; context: .seeks/run/${match.name}/context.md)
PER-PASS PROTOCOL (the seeks:loop skill — follow it; this is your steering, the Stop hook shows only a one-line status banner): do EXACTLY ONE pass, then STOP and end your turn — the Stop hook re-invokes you for the next pass. One pass = the next backlog item; or, when the backlog is empty, ONE fresh-lens discovery sweep via a bug-hunter subagent, or the verifier subagent once "seeks sweep-status ${match.name}" reports satisfied:true. ALWAYS run "seeks progress-tick ${match.name}" before ending. Do NOT disarm the loop or self-certify — if the gate keeps blocking, the banner names the unmet bar (dry depth-round, undelivered L3, stale oracle ack); act on it. If the banner shows a wind-down / ⏰ time budget nearly up, stop new work and write summary.md. L3: once done+certified, run "seeks deliver ${match.name}".`;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName:'SessionStart', additionalContext: ctx } }));
process.exit(0);
