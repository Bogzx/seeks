// Review lenses for the discovery sweep — each sweep takes a DIFFERENT angle so consecutive
// dry sweeps mean "looked from N distinct perspectives and found nothing", not "repeated one
// blind pass". A loop may override the set via status.sweep_lenses (e.g. intake tailors it).
export const DEFAULT_LENSES = ['concurrency', 'error-handling', 'boundary', 'resource-lifecycle', 'serialization', 'input-trust'];

// nextLens — least-recently-used: any not-yet-used lens first; once all are used, the one whose
// most recent use is earliest.
export function nextLens(used = [], set = DEFAULT_LENSES){
  for (const l of set) if (!used.includes(l)) return l;
  let best = set[0], bestIdx = Infinity;
  for (const l of set){ const idx = used.lastIndexOf(l); if (idx < bestIdx){ bestIdx = idx; best = l; } }
  return best;
}
