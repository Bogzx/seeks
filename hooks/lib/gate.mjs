import { pastDeadline, windDownNear } from './budget.mjs';
import { sweepProgress, sweepSatisfied } from './sweep.mjs';   // shared predicate (banner + sweep-status CLI use the same)
function oracleSatisfied(s){
  if (s.oracle_live_hash == null) return true;   // not computed (legacy / fail-open) → don't block
  return s.oracle_ack_hash === s.oracle_live_hash;
}
function deliverySatisfied(s){
  return String(s.level || 'L2').toUpperCase() !== 'L3' || s.delivered === true;   // only L3 must deliver before done
}
function hasRealCheck(s){   // a loop with a KNOWN-zero executable-condition count can't self-certify done (→ needs-human); unknown = legacy fail-open
  return s.executable_condition_count == null || s.executable_condition_count >= 1;
}
function sweepNudge(s){   // certified but the sweep bar is unmet — say EXACTLY which threshold, so the maker converges instead of thrashing/self-disarming
  const sp = sweepProgress(s);
  if (sp.mode === 'exhaustive')
    return `[seeks] Loop ${s.loop} is verifier-certified, but the EXHAUSTIVE review bar is not met: dry depth-round ${sp.dry_depth_rounds}/${sp.min_dry_depth_rounds} (depth ${sp.depth}, catalog ${sp.catalog_covered}/${sp.catalog_size} dry this round). 'done' will NOT release until the full lens catalog comes up dry enough to reach ${sp.min_dry_depth_rounds} depth-rounds — or the time budget winds the loop down, which is the normal end for an exhaustive run. Keep sweeping the next lens ("seeks sweep-next-lens ${s.loop}"); do NOT re-certify and do NOT disarm.`;
  return `[seeks] Loop ${s.loop} is certified but only ${sp.dry_sweeps}/${sp.min_dry_sweeps} dry sweeps. Run one more discovery sweep through a fresh lens ("seeks sweep-next-lens ${s.loop}"); 'done' releases at ${sp.min_dry_sweeps} dry sweeps. Do NOT disarm.`;
}
export function decide(status, hookState, now = Date.now()){
  const s = status || {}; const hs = hookState || {};
  if (s.armed !== true) return { action:'allow', reason:null, stopKind:null };
  const certifiedCore = s.done === true && s.verifier_certified === true && hasRealCheck(s) && oracleSatisfied(s);
  if (certifiedCore && sweepSatisfied(s) && deliverySatisfied(s)) return { action:'allow', reason:null, stopKind:'done' };
  if (s.needs_human === true) return { action:'allow', reason:null, stopKind:'needs_human' };
  if (pastDeadline(s, now)) return { action:'allow', reason:null, stopKind:'time-budget' };
  if ((s.no_progress_count ?? 0) >= (s.stuck_threshold ?? 3)) return { action:'allow', reason:null, stopKind:'stuck' };
  if ((hs.stop_fires ?? 0) >= (s.max_iters ?? 50)) return { action:'allow', reason:null, stopKind:'max_iters' };
  // Certified but a terminal gate is still unmet — name EXACTLY which one. A generic "do one pass"
  // here is what drove the wrongful self-disarm: the maker, seeing nothing left to do and no reason,
  // thrashed and then disarmed a loop the gate was still (correctly) holding.
  if (certifiedCore && !sweepSatisfied(s))
    return { action:'block', stopKind:null, reason: sweepNudge(s) };
  if (certifiedCore && sweepSatisfied(s) && !deliverySatisfied(s))   // certified + swept but L3-undelivered → nudge to deliver (M2)
    return { action:'block', stopKind:null,
      reason: `[seeks] Loop ${s.loop} is certified but not delivered. This is an L3 loop — run "seeks deliver ${s.loop}" (pushes seeks/${s.loop} and opens a PR; degrades to push/local if gh/remote are absent), then end your turn.` };
  return { action:'block', stopKind:null,
    reason: windDownNear(s, now)
      ? `[seeks] Loop ${s.loop}: time budget nearly up — STOP starting new work. Write summary.md (what you found / what's left), commit it, then end your turn.`
      : `[seeks] Loop ${s.loop}: ${s.open_items ?? '?'} open. Do EXACTLY ONE pass, then STOP — end your turn, do NOT continue into the next pass (I will re-invoke you). Read .seeks/run/${s.loop}/state.md, do the next backlog item (or run the verifier if the backlog is empty), run "seeks progress-tick ${s.loop}", then end your turn.` };
}
