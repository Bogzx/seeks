export function composeBanner(status, decision, stopFires){
  const s = status || {}; const pass = stopFires ?? 0; const head = `▸ ${s.loop} · pass ${pass}`;
  if (decision.action === 'allow'){
    if (decision.stopKind==='done') return `${head} · ✅ done`;
    if (decision.stopKind==='needs_human') return `${head} · ⏸ needs-human: ${s.last_verdict ?? 'human required'}`;
    if (decision.stopKind==='stuck') return `${head} · ⛔ halt: stuck (${s.no_progress_count ?? 0} no-progress)`;
    if (decision.stopKind==='max_iters') return `${head} · ⛔ halt: max-iters (${pass})`;
    return `${head} · stopped`;
  }
  const change = s.last_change ?? '(no change)'; const verdict = s.last_verdict ? ` · verify: ${s.last_verdict}` : '';
  return `${head} · items ${s.open_items_prev ?? s.open_items}→${s.open_items} · ${change}${verdict} · continuing`;
}
