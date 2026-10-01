import { execFileSync } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
import { isInside } from './paths.mjs'; import { readStatus } from './status.mjs';
import { readHookState } from './hookstate.mjs';
// The repo's shared .git dir, absolute. Not `--path-format=absolute`: git < 2.31 (Ubuntu 20.04,
// Debian 11) doesn't know that flag and echoes it back on stdout with exit 0, so the "path" came
// out as "--path-format=absolute\n../.git" and every hook quietly found no loop. Plain
// `--git-common-dir` prints a path relative to the -C dir (or an absolute one, from a worktree).
export function gitCommonDir(cwd = process.cwd()){
  try {
    const out = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim();
    return out ? path.resolve(cwd, out) : null;
  } catch { return null; }
}
export function primaryRoot(cwd = process.cwd()){ const c = gitCommonDir(cwd); return c ? path.dirname(c) : null; }
export function seeksDir(cwd = process.cwd()){ const r = primaryRoot(cwd); return r ? path.join(r,'.seeks') : null; }
export function runDir(name, cwd = process.cwd()){ const s = seeksDir(cwd); return s ? path.join(s,'run',name) : null; }
export function hasSeeksNearby(cwd){
  let d = path.resolve(cwd);
  for(;;){ if (fs.existsSync(path.join(d,'.seeks'))) return true; const p = path.dirname(d); if (p===d) return false; d=p; }
}
export function matchLoopByCwd(sDir, cwd, platform = process.platform){
  let names; try { names = fs.readdirSync(path.join(sDir,'run')); } catch { return null; }
  for (const name of names){
    const rd = path.join(sDir,'run',name); const status = readStatus(rd);
    if (!status || status.armed !== true || !status.worktree_path) continue;
    if (readHookState(rd)?.released) continue;   // gate-released terminal → dormant (no gating, policing, or re-inject) until /seeks:start reset-fires
    if (isInside(cwd, status.worktree_path, platform)) return { name, runDir: rd, status };
  }
  return null;
}
// The most recently updated loop — what a no-name /seeks:start|stop picks (seeks latest), and so
// what the UserPromptSubmit hook binds that command's grant to.
export function latestLoop(sDir){
  let best = null, bestT = '';
  try { for (const name of fs.readdirSync(path.join(sDir,'run'))){
    let st = null; try { st = readStatus(path.join(sDir,'run',name)); } catch {}
    const t = (st && st.updated_at) || '';
    if (st && t >= bestT){ bestT = t; best = name; } } } catch {}
  return best;
}
