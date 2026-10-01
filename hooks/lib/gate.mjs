import { pastDeadline, windDownNear } from './budget.mjs';
import { sweepProgress, sweepSatisfied } from './sweep.mjs';   // shared predicate (banner + sweep-status CLI use the same)
import { executableConditions } from './verify.mjs';
import { oraclePolicy } from './oracle.mjs';
function oracleSatisfied(s){
  if (s.oracle_live_hash == null) return true;   // not computed (legacy / fail-open) → don't block
  return s.oracle_ack_hash === s.oracle_live_hash;
}
function deliverySatisfied(s){
  return String(s.level || 'L2').toUpperCase() !== 'L3' || s.delivered === true;   // only L3 must deliver before done
}
// Fail-closed: `done` is released on the gate's OWN run of the stored conditions, so a loop with
// nothing runnable has nothing to release on. (It used to fail open when the count was unknown.)
const hasRealCheck = (s) => executableConditions(s).length >= 1;
// The verifier's sign-off is in and every other bar is met → the stop hook should now run the
// done-conditions itself. Exported so the hook and decide() can't disagree about when.
export function readyForGateCheck(s){
  return !!s && s.armed === true && s.verifier_certified === true && hasRealCheck(s) && oracleSatisfied(s) && sweepSatisfied(s);
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
  // `verifier_certified` is the verifier's word (seeks certify) — advice. `conditions_live` is the
  // stop hook's own run of the done-conditions on this tree — the only thing `done` releases on.
  // status.done is an OUTPUT of this gate, never an input: writing it changes nothing here.
  const certified = s.verifier_certified === true && hasRealCheck(s);
  const verified = readyForGateCheck(s) && s.conditions_live?.ok === true;
  // Green — but on a check whose pre-existing tests/manifests were changed. Whether that change
  // still measures the goal is a judgment the maker must not make for itself (it can run
  // oracle-ack), so by default a human does. `oracle_modified` is computed by the stop hook.
  // `oracle_unchecked`: the stop hook could not compute that diff (a git call failed). That is not
  // "nothing changed", and the `ack` policy accepts changes, not blindness, so it is needs-human too.
  if (verified && s.oracle_unchecked === true)
    return { action:'allow', reason:null, stopKind:'needs_human', detail:'oracle-unchecked' };
  if (verified && oraclePolicy(s) === 'needs_human' && (s.oracle_modified?.length ?? 0) > 0)
    return { action:'allow', reason:null, stopKind:'needs_human', detail:'oracle-modified' };
  if (verified && deliverySatisfied(s)) return { action:'allow', reason:null, stopKind:'done' };
  if (s.needs_human === true) return { action:'allow', reason:null, stopKind:'needs_human' };
  if (s.verifier_certified === true && !hasRealCheck(s))           // nothing runnable to release on → a human decides
    return { action:'allow', reason:null, stopKind:'needs_human' };
  if (pastDeadline(s, now)) return { action:'allow', reason:null, stopKind:'time-budget' };
  if ((s.no_progress_count ?? 0) >= (s.stuck_threshold ?? 3)) return { action:'allow', reason:null, stopKind:'stuck' };
  if ((hs.stop_fires ?? 0) >= (s.max_iters ?? 50)) return { action:'allow', reason:null, stopKind:'max_iters' };
  // Certified but a terminal gate is still unmet — name EXACTLY which one. A generic "do one pass"
  // here is what drove the wrongful self-disarm: the maker, seeing nothing left to do and no reason,
  // thrashed and then disarmed a loop the gate was still (correctly) holding.
  if (certified && !sweepSatisfied(s))                              // sweeps are the outer bar: converge them before re-verifying
    return { action:'block', stopKind:null, reason: sweepNudge(s) };
  if (certified && !oracleSatisfied(s))                             // an oracle (test) file changed after the ack → re-verify, don't thrash
    return { action:'block', stopKind:null,
      reason: `[seeks] Loop ${s.loop} is certified but the oracle ack is STALE — an oracle (test) file changed after the verifier's last "seeks oracle-ack". Re-dispatch the verifier: it must re-run the done-conditions, account for the new oracle diff in verify/oracle.md, then run "seeks oracle-ack ${s.loop}" and "seeks certify ${s.loop}". Do NOT disarm.` };
  if (readyForGateCheck(s) && s.conditions_live && s.conditions_live.ok !== true){   // the gate ran them and one failed
    const f = (s.conditions_live.failed ?? [])[0] ?? {};
    return { action:'block', stopKind:null,
      reason: `[seeks] Loop ${s.loop}: the verifier certified, but the Stop gate ran the done-conditions itself and "${f.id ?? '?'}" failed (exit ${f.exit ?? '?'}, expected ${f.want ?? 0}). Certification is cleared. Output tail:\n${f.tail ?? ''}\nFix it, then re-dispatch the verifier and "seeks certify ${s.loop}". Do NOT disarm.` };
  }
  if (verified && !deliverySatisfied(s))                           // verified by the gate but L3-undelivered → nudge to deliver (M2)
    return { action:'block', stopKind:null,
      reason: `[seeks] Loop ${s.loop} is certified but not delivered. This is an L3 loop — run "seeks deliver ${s.loop}" (pushes seeks/${s.loop} and opens a PR; degrades to push/local if gh/remote are absent), then end your turn.` };
  return { action:'block', stopKind:null,
    reason: windDownNear(s, now)
      ? `[seeks] Loop ${s.loop}: time budget nearly up — STOP starting new work. Write summary.md (what you found / what's left), commit it, then end your turn.`
      : `[seeks] Loop ${s.loop}: ${s.open_items ?? '?'} open. Do EXACTLY ONE pass, then STOP — end your turn, do NOT continue into the next pass (I will re-invoke you). Read .seeks/run/${s.loop}/state.md, do the next backlog item (or run the verifier if the backlog is empty), run "seeks progress-tick ${s.loop}", then end your turn.` };
}
