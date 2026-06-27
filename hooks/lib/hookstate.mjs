import fs from 'node:fs'; import path from 'node:path';
const hp = (rd) => path.join(rd,'hook-state.json');
function write(rd,obj){ const f=hp(rd); const t=`${f}.tmp.${process.pid}`; fs.writeFileSync(t,JSON.stringify(obj)); fs.renameSync(t,f); }
export function readHookState(rd){ try { return JSON.parse(fs.readFileSync(hp(rd),'utf8')); } catch { return null; } }
export function bumpFire(rd, sessionId, now){
  const c = readHookState(rd) ?? { stop_fires:0 };
  const n = { stop_fires:(c.stop_fires||0)+1, last_heartbeat:now, session_id: sessionId ?? c.session_id ?? null };
  write(rd, n); return n;
}
export function seedHeartbeat(rd, now){ const c = readHookState(rd) ?? { stop_fires:0, session_id:null }; write(rd, { ...c, last_heartbeat:now }); }
export function isFresh(rd, now, ttlMs){ const h = readHookState(rd); return !!h && h.last_heartbeat!=null && (now - h.last_heartbeat) < ttlMs; }
export function staleHeartbeat(rd){ const c = readHookState(rd); if (c) write(rd, { ...c, last_heartbeat:0 }); }
export function resetFires(rd){ const c = readHookState(rd) ?? {}; write(rd, { ...c, stop_fires:0 }); }
