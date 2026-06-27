export function decide(status, hookState){
  const s = status || {}; const hs = hookState || {};
  if (s.armed !== true) return { action:'allow', reason:null, stopKind:null };
  if (s.done === true && s.verifier_certified === true) return { action:'allow', reason:null, stopKind:'done' };
  if (s.needs_human === true) return { action:'allow', reason:null, stopKind:'needs_human' };
  if ((s.no_progress_count ?? 0) >= (s.stuck_threshold ?? 3)) return { action:'allow', reason:null, stopKind:'stuck' };
  if ((hs.stop_fires ?? 0) >= (s.max_iters ?? 50)) return { action:'allow', reason:null, stopKind:'max_iters' };
  return { action:'block', stopKind:null,
    reason: `Loop ${s.loop} not done: ${s.open_items ?? '?'} open. Read .seeks/run/${s.loop}/state.md, do the next backlog item (or run the verifier if the backlog is empty), then run "seeks progress-tick ${s.loop}" before ending.` };
}
