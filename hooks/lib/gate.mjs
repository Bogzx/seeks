function oracleSatisfied(s){
  if (s.oracle_live_hash == null) return true;   // not computed (legacy / fail-open) → don't block
  return s.oracle_ack_hash === s.oracle_live_hash;
}
export function decide(status, hookState){
  const s = status || {}; const hs = hookState || {};
  if (s.armed !== true) return { action:'allow', reason:null, stopKind:null };
  if (s.done === true && s.verifier_certified === true
      && (s.dry_sweeps ?? 0) >= (s.min_dry_sweeps ?? 0)
      && oracleSatisfied(s)) return { action:'allow', reason:null, stopKind:'done' };
  if (s.needs_human === true) return { action:'allow', reason:null, stopKind:'needs_human' };
  if ((s.no_progress_count ?? 0) >= (s.stuck_threshold ?? 3)) return { action:'allow', reason:null, stopKind:'stuck' };
  if ((hs.stop_fires ?? 0) >= (s.max_iters ?? 50)) return { action:'allow', reason:null, stopKind:'max_iters' };
  return { action:'block', stopKind:null,
    reason: `[seeks] Loop ${s.loop}: ${s.open_items ?? '?'} open. Do EXACTLY ONE pass, then STOP — end your turn, do NOT continue into the next pass (I will re-invoke you). Read .seeks/run/${s.loop}/state.md, do the next backlog item (or run the verifier if the backlog is empty), run "seeks progress-tick ${s.loop}", then end your turn.` };
}
