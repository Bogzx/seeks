import { pastDeadline } from './budget.mjs';
function oracleSatisfied(s){
  if (s.oracle_live_hash == null) return true;   // not computed (legacy / fail-open) → don't block
  return s.oracle_ack_hash === s.oracle_live_hash;
}
function deliverySatisfied(s){
  return String(s.level || 'L2').toUpperCase() !== 'L3' || s.delivered === true;   // only L3 must deliver before done
}
function sweepSatisfied(s){   // exhaustive loops must cover the catalog + deepen (dry_depth_rounds); others use dry_sweeps
  return s.exhaustive === true
    ? (s.dry_depth_rounds ?? 0) >= (s.min_dry_depth_rounds ?? 2)
    : (s.dry_sweeps ?? 0) >= (s.min_dry_sweeps ?? 0);
}
export function decide(status, hookState, now = Date.now()){
  const s = status || {}; const hs = hookState || {};
  if (s.armed !== true) return { action:'allow', reason:null, stopKind:null };
  if (s.done === true && s.verifier_certified === true
      && sweepSatisfied(s)
      && oracleSatisfied(s)
      && deliverySatisfied(s)) return { action:'allow', reason:null, stopKind:'done' };
  if (s.needs_human === true) return { action:'allow', reason:null, stopKind:'needs_human' };
  if (pastDeadline(s, now)) return { action:'allow', reason:null, stopKind:'time-budget' };
  if ((s.no_progress_count ?? 0) >= (s.stuck_threshold ?? 3)) return { action:'allow', reason:null, stopKind:'stuck' };
  if ((hs.stop_fires ?? 0) >= (s.max_iters ?? 50)) return { action:'allow', reason:null, stopKind:'max_iters' };
  if (s.done === true && s.verifier_certified === true
      && sweepSatisfied(s)
      && oracleSatisfied(s) && !deliverySatisfied(s))   // certified but L3-undelivered → nudge to deliver (M2)
    return { action:'block', stopKind:null,
      reason: `[seeks] Loop ${s.loop} is certified but not delivered. This is an L3 loop — run "seeks deliver ${s.loop}" (pushes seeks/${s.loop} and opens a PR; degrades to push/local if gh/remote are absent), then end your turn.` };
  return { action:'block', stopKind:null,
    reason: `[seeks] Loop ${s.loop}: ${s.open_items ?? '?'} open. Do EXACTLY ONE pass, then STOP — end your turn, do NOT continue into the next pass (I will re-invoke you). Read .seeks/run/${s.loop}/state.md, do the next backlog item (or run the verifier if the backlog is empty), run "seeks progress-tick ${s.loop}", then end your turn.` };
}
