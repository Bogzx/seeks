// Single source of truth for "are the discovery sweeps satisfied?" — consumed by the gate
// (the release predicate), the banner (display), and the `sweep-status` CLI the loop skill
// consults before it certifies. Keeping all three on ONE predicate is what stops the maker,
// the banner, and the gate from drifting onto different thresholds (the bug where an
// exhaustive loop certified on `min_dry_sweeps` while the gate held out for `dry_depth_rounds`,
// deadlocking with an uninformative block).
import { DEFAULT_LENSES } from './lenses.mjs';

export function sweepProgress(status){
  const s = status || {};
  if (s.exhaustive === true){                                   // exhaustive: deepen until the catalog goes dry enough
    const catalog = s.sweep_lenses ?? DEFAULT_LENSES;
    const target = s.min_dry_depth_rounds ?? 2;
    const rounds = s.dry_depth_rounds ?? 0;
    const covered = catalog.filter(l => (s.dry_lenses ?? []).includes(l)).length;
    return { mode:'exhaustive', satisfied: rounds >= target, depth: s.depth ?? 1,
      dry_depth_rounds: rounds, min_dry_depth_rounds: target,
      catalog_size: catalog.length, catalog_covered: covered,
      label: `depth ${s.depth ?? 1} · dry-round ${rounds}/${target} · catalog ${covered}/${catalog.length}` };
  }
  const min = s.min_dry_sweeps ?? 0;                            // until-dry: N consecutive dry sweeps (0 = legacy/no sweep)
  const dry = s.dry_sweeps ?? 0;
  return { mode: min > 0 ? 'until-dry' : 'none', satisfied: dry >= min,
    dry_sweeps: dry, min_dry_sweeps: min,
    label: min > 0 ? `sweep ${dry}/${min} dry` : '' };
}

export function sweepSatisfied(status){ return sweepProgress(status).satisfied; }
