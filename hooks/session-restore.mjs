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
PER-PASS PROTOCOL: do the next backlog item; when the backlog is empty, run the verifier subagent on the executable done-conditions; ALWAYS run "seeks progress-tick ${match.name}" before ending.`;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName:'SessionStart', additionalContext: ctx } }));
process.exit(0);
