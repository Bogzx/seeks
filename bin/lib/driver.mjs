// seeks headless driver — pure helpers shared by `seeks run` (bin/run.mjs) and the e2e harness
// (test/e2e/run.mjs, which re-exports them from test/e2e/driver.mjs). Unit-tested in
// test/driver.test.mjs. Zero deps.
//
// buildArgs(opts) → argv for `claude` headless, with the flags the research pinned as
// required for a Stop-hook-driven loop: -p, --plugin-dir, bypassPermissions, stream-json,
// --include-hook-events, --verbose. The CALLER must also set
// CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0 in the child env or the loop dies at ~8 blocks.

export function buildArgs(o){
  const a = ['-p', o.prompt, '--plugin-dir', o.pluginDir,
    '--permission-mode', o.permissionMode || 'bypassPermissions',
    '--output-format', 'stream-json', '--include-hook-events', '--verbose'];
  if (o.maxTurns != null) a.push('--max-turns', String(o.maxTurns));
  if (o.sessionId) a.push('--session-id', o.sessionId);
  if (o.model) a.push('--model', o.model);
  if (o.maxBudgetUsd != null) a.push('--max-budget-usd', String(o.maxBudgetUsd));
  return a;
}

// parseStream(text) → { events, banners, terminal, result }
// Robust to the exact stream-json shape: it deep-scans every string field for a seeks
// banner (▸ <loop> · pass N …) rather than assuming where systemMessage lands, finds the
// final result event, and reports the last terminal banner if one appeared.
// terminalFromStatus(status, hookState) → 'done'|'needs_human'|'stuck'|'max_iters'|null
// Authoritative terminal detection straight from status.json (banner-independent): a loop that
// disarms on certify emits no terminal banner, so assertions must read status, not the stream.
// Reuses the gate's decide() (forcing armed so terminals evaluate) to stay DRY.
import { decide } from '../../hooks/lib/gate.mjs';
export const BANNER_RE = /▸ .+? · pass \d+[^\n"]*/;
// Every seeks banner inside one parsed stream-json event, wherever the client put systemMessage.
export function bannersIn(ev){
  const out = []; const walk = (o) => { if (o && typeof o === 'object') for (const v of Object.values(o)){
    if (typeof v === 'string'){ const m = v.match(BANNER_RE); if (m) out.push(m[0]); } else walk(v); } };
  walk(ev); return out;
}
// `seeks run` exit codes: 0 only when the gate released done.
export const EXIT = { done: 0, error: 1, needs_human: 2, halted: 3 };
export function exitCodeFor(outcome){
  if (outcome === 'done') return EXIT.done;
  if (outcome === 'needs_human') return EXIT.needs_human;
  if (['stuck','max_iters','time-budget','time-budget (killed)'].includes(outcome)) return EXIT.halted;
  return EXIT.error;
}
export function terminalFromStatus(status = {}, hookState = {}){
  if (status.done === true && status.gate_verified_at) return 'done';   // written only by the Stop gate, after its own condition run
  const d = decide({ ...status, armed: true }, hookState);
  return d.action === 'allow' ? d.stopKind : null;
}

export function parseStream(text){
  const events = [];
  for (const l of String(text).split('\n')){ const t = l.trim(); if (!t) continue; try { events.push(JSON.parse(t)); } catch {} }
  const banners = events.flatMap(bannersIn);
  const result = events.find(e => e && e.type === 'result') ?? null;
  let terminal = null; for (const b of banners) if (/✅ done|needs-human|halt:/.test(b)) terminal = b;
  return { events, banners, terminal, result };
}
