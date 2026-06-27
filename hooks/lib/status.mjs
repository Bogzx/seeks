import fs from 'node:fs'; import path from 'node:path';
export function statusPath(runDir){ return path.join(runDir,'status.json'); }
export function readStatus(runDir, retries=3){
  const f = statusPath(runDir);
  for (let i=0;i<=retries;i++){
    let raw; try { raw = fs.readFileSync(f,'utf8'); } catch { return null; }
    try { return JSON.parse(raw); } catch(e){ if (i===retries) throw e; const u=Date.now()+15; while(Date.now()<u){} }
  }
}
export function writeStatusAtomic(runDir, obj){
  const f = statusPath(runDir); const tmp = `${f}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj,null,2)); fs.renameSync(tmp, f);
}
