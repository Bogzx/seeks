// Usage tiers: per-role models/effort + iteration budget. Single source of truth,
// consumed at /seeks:new (seeding) and at subagent dispatch (commands/skill).
export const DEFAULT_TIER = 'balanced';
export const TIERS = {
  light: {
    roles: { maker:{model:'sonnet',effort:'high'}, intake:{model:'sonnet',effort:'high'},
             analyzer:{model:'sonnet',effort:'high'}, verifier:{model:'sonnet',effort:'high'},
             triage:{model:'haiku',effort:'low'} },
    max_iters: 30, max_iters_openended: 80, min_dry_sweeps: 1,
  },
  balanced: {
    roles: { maker:{model:'opus',effort:'high'}, intake:{model:'sonnet',effort:'high'},
             analyzer:{model:'sonnet',effort:'high'}, verifier:{model:'opus',effort:'high'},
             triage:{model:'sonnet',effort:'low'} },
    max_iters: 50, max_iters_openended: 200, min_dry_sweeps: 2,
  },
  'all-out': {
    roles: { maker:{model:'opus',effort:'high'}, intake:{model:'opus',effort:'high'},
             analyzer:{model:'opus',effort:'high'}, verifier:{model:'opus',effort:'max'},
             triage:{model:'opus',effort:'high'} },
    max_iters: 80, max_iters_openended: 400, min_dry_sweeps: 3,
  },
};
export function resolveTier(name){ return TIERS[name] || TIERS[DEFAULT_TIER]; }
