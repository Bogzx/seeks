import { execFileSync } from 'node:child_process'; import path from 'node:path'; import fs from 'node:fs';
import { isInside } from './paths.mjs'; import { readStatus } from './status.mjs';
export function primaryRoot(cwd = process.cwd()){
  try {
    const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding:'utf8' }).trim();
    return path.dirname(common);
  } catch { return null; }
}
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
    if (isInside(cwd, status.worktree_path, platform)) return { name, runDir: rd, status };
  }
  return null;
}
