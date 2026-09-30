// Who may move a loop's brakes. The CLI is the only sanctioned writer of status.json, and the
// maker drives it from its own Bash — so before this, `status-set '{"done":true,…}'`,
// `reset-fires` and `budget-set` let the maker certify itself, disarm, or erase its budgets
// through the front door the hooks deliberately leave open.
//
// Three rules, all enforced in bin/seeks.mjs:
//   1. Some keys have exactly one owner and status-set NEVER writes them: `armed` (seeks
//      start/stop), `done` (the Stop gate, after it ran the done-conditions itself),
//      `verifier_certified` (seeks certify) and the hook's own overlays.
//   2. The rest of the budget/gate keys are frozen while the loop is LIVE (armed and not yet
//      released by the gate) — unless the user has just typed a /seeks:start|stop|delete, which
//      the UserPromptSubmit hook turns into a short-lived, one-shot grant. Before a loop is
//      armed, and after the gate has released it, nobody is running it and setup is free.
//   3. A couple of keys may only ever be TIGHTENED while live (needs_human → true, strict_bash
//      → true): a maker giving up or locking itself down needs no permission.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';

export const OWNED_KEYS = ['armed','done','verifier_certified','conditions_live','oracle_live_hash','gate_verified_at'];
export const PROTECTED_KEYS = [
  'max_iters','time_budget_sec','started_at',                                     // the budget
  'conditions','executable_condition_count',                                      // what "done" means
  'min_dry_sweeps','dry_sweeps','dry_lenses','exhaustive','min_dry_depth_rounds',
  'dry_depth_rounds','depth','sweep_lenses',                                      // the sweep bar
  'oracle_globs','oracle_ack_hash','base_ref','base_sha',                         // oracle accounting
  'worktree_path','level','denylist','strict_bash','strict_bash_allow',           // what the policy enforces, and where
  'stuck_threshold','no_progress_count','condition_reject_threshold','condition_rejects',
  'lock_stale_ttl_sec','delivered',
];
const TIGHTEN_ONLY = { needs_human: (v) => v === true, strict_bash: (v) => v === true };

// Split a status-set patch into what may be written now and what is refused.
export function splitPatch(patch, { live, granted }){
  const allowed = {}, refused = [];
  for (const [k, v] of Object.entries(patch ?? {})){
    if (OWNED_KEYS.includes(k)) { refused.push(k); continue; }
    if (live && !granted && k in TIGHTEN_ONLY && !TIGHTEN_ONLY[k](v)) { refused.push(k); continue; }
    if (live && !granted && PROTECTED_KEYS.includes(k) && !(k in TIGHTEN_ONLY)) { refused.push(k); continue; }
    allowed[k] = v;
  }
  return { allowed, refused };
}

// Live = the gate is holding this loop: armed, and not latched released by a terminal verdict.
export const isLive = (status, hookState) => status?.armed === true && !hookState?.released;

// ─── user grants ──────────────────────────────────────────────────────────────────────
// Issued ONLY by hooks/user-prompt.mjs, i.e. only when a human submits the prompt. A Stop-hook
// re-drive never passes through UserPromptSubmit, so nothing the maker does mid-loop can mint
// one. The file is hook-owned (policy.mjs denies it to the edit tools and to Bash).
export const GRANT_FILE = 'control-grant.json';
export const GRANT_TTL_MS = 15 * 60 * 1000;
const COMMAND_RE = /(?:^|<command-name>)\s*\/seeks:(start|stop|delete)\b/;
export function grantKindFromPrompt(prompt){
  const m = COMMAND_RE.exec(String(prompt ?? '').trimStart()); return m ? m[1] : null;
}
export const grantPath = (sDir) => path.join(sDir, GRANT_FILE);
export function issueGrant(sDir, { kind, session_id = null, now = Date.now(), ttlMs = GRANT_TTL_MS }){
  const g = { nonce: crypto.randomUUID(), kind, session_id, issued_at: now, expires_at: now + ttlMs };
  const f = grantPath(sDir); const tmp = `${f}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(g)); fs.renameSync(tmp, f); return g;
}
export function readGrant(sDir, now = Date.now()){
  if (!sDir) return null;
  let g; try { g = JSON.parse(fs.readFileSync(grantPath(sDir), 'utf8')); } catch { return null; }
  return g && typeof g.nonce === 'string' && Number(g.expires_at) > now ? g : null;
}
// One-shot: rename first, so two concurrent consumers cannot both win the same grant.
export function consumeGrant(sDir, now = Date.now()){
  if (!sDir) return null;
  const f = grantPath(sDir); const claimed = `${f}.consumed.${process.pid}`;
  try { fs.renameSync(f, claimed); } catch { return null; }
  let g = null; try { g = JSON.parse(fs.readFileSync(claimed, 'utf8')); } catch {}
  try { fs.unlinkSync(claimed); } catch {}
  return g && typeof g.nonce === 'string' && Number(g.expires_at) > now ? g : null;
}
