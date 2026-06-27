import { isFresh, seedHeartbeat, staleHeartbeat } from './hookstate.mjs';
export function acquire(runDir, now, ttlMs=600000){
  if (isFresh(runDir, now, ttlMs)) return { ok:false, reason:'loop already running (fresh heartbeat)' };
  seedHeartbeat(runDir, now); return { ok:true };
}
export function release(runDir){ staleHeartbeat(runDir); }
export function isHeld(runDir, now, ttlMs=600000){ return isFresh(runDir, now, ttlMs); }
