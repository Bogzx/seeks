import fs from 'node:fs'; import path from 'node:path';
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
const cwd = input.cwd || process.cwd();
let match, primaryRoot, sDir = null;
try {                                                       // fail-open: a hook error must never break SessionStart
  const r = await import('./lib/resolve.mjs'); primaryRoot = r.primaryRoot;
  if (!r.hasSeeksNearby(cwd)) process.exit(0);              // cheap fast-path, no subprocess
  sDir = r.seeksDir(cwd); if (!sDir) process.exit(0);
  match = r.matchLoopByCwd(sDir, cwd);                      // armed-loop-only; readStatus may throw on a corrupt status.json
} catch (e) {                                               // a bad status.json in ANY run dir must not kill SessionStart for every loop
  await logCrash(sDir, { hook:'session-restore', action:'crash', rule:'hook-crash', error: String((e && e.stack) || e), session: input.session_id ?? null });
  process.exit(0);
}
if (!match) process.exit(0);
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
PER-PASS PROTOCOL (the seeks:loop skill — follow it; this is your steering, the Stop hook shows only a one-line status banner): do EXACTLY ONE pass, then STOP and end your turn — the Stop hook re-invokes you for the next pass. One pass = the next backlog item; or, when the backlog is empty, ONE fresh-lens discovery sweep via a bug-hunter subagent, or the verifier subagent once "seeks sweep-status ${match.name}" reports satisfied:true. ALWAYS run "seeks progress-tick ${match.name}" before ending. Do NOT disarm the loop or self-certify (certify is the verifier subagent's "seeks certify ${match.name}"; the Stop hook then re-runs the done-conditions itself) — if the gate keeps blocking, the banner names the unmet bar (dry depth-round, undelivered L3, stale oracle ack); act on it. If the banner shows a wind-down / ⏰ time budget nearly up, stop new work and write summary.md. L3: when the gate says the conditions passed but the loop is undelivered, run "seeks deliver ${match.name}".`;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName:'SessionStart', additionalContext: ctx } }));
process.exit(0);
