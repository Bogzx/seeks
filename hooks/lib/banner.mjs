// Color is OPT-IN (opts.color, gated by SEEKS_BANNER_COLOR in the hook) — default is plain.
// The systemMessage channel was confirmed to render plain in v1; a channel that strips ANSI
// would otherwise show raw escapes, so we never emit codes unless the operator asks for them.
export function composeBanner(status, decision, stopFires, opts = {}){
  const s = status || {}; const pass = stopFires ?? 0; const head = `▸ ${s.loop} · pass ${pass}`;
  const C = opts.color ? { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', z:'\x1b[0m' }
                       : { g:'', r:'', y:'', z:'' };
  if (decision.action === 'allow'){
    if (decision.stopKind==='done'){
      const dm = s.delivery_mode;
      const deliv = dm === 'pr' ? ` · PR ${s.pr_url ?? '(created)'}` : dm === 'push' ? ` · pushed (no PR)` : dm === 'local' ? ` · branch kept local` : '';
      return `${head} · ${C.g}✅ done${C.z}${deliv}`;
    }
    if (decision.stopKind==='needs_human') return `${head} · ${C.y}⏸ needs-human: ${s.last_verdict ?? 'human required'}${C.z}`;
    if (decision.stopKind==='stuck') return `${head} · ${C.r}⛔ halt: stuck (${s.no_progress_count ?? 0} no-progress)${C.z}`;
    if (decision.stopKind==='max_iters') return `${head} · ${C.r}⛔ halt: max-iters (${pass})${C.z}`;
    return `${head} · stopped`;
  }
  const change = s.last_change ?? '(no change)'; const verdict = s.last_verdict ? ` · verify: ${s.last_verdict}` : '';
  const lens = s.lenses_used?.length ? ` (lens: ${s.lenses_used[s.lenses_used.length - 1]})` : '';
  const sweep = (s.min_dry_sweeps ?? 0) > 0 ? ` · sweep ${s.dry_sweeps ?? 0}/${s.min_dry_sweeps} dry${lens}` : '';
  const oracle = (s.oracle_changed_count ?? 0) > 0 ? ` · oracle: ${s.oracle_changed_count} changed` : '';
  return `${head} · items ${s.open_items_prev ?? s.open_items}→${s.open_items}${sweep}${oracle} · ${change}${verdict} · continuing`;
}
