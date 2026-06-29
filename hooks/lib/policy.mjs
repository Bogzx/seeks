// Pure, deterministic PreToolUse policy. Claude produces the input; the verdict over
// it is fixed code (no model). First matching DENY wins; default ALLOW. Only edit
// tools + Bash are policed. See docs/superpowers/specs/2026-06-29-seeks-enforcement-plane-design.md §5.
import { canon, isInside } from './paths.mjs'; import { anyGlob } from './glob.mjs';
import { pastDeadline } from './budget.mjs';
export const DEFAULT_DENYLIST = ['**/.env','**/secrets/**','.git/**'];
const EDIT_TOOLS = new Set(['Edit','Write','MultiEdit','NotebookEdit']);
const allow = { action:'allow', reason:null };
const deny = (reason) => ({ action:'deny', reason });
const targetPath = (tool, ti) => !ti ? null : (tool === 'NotebookEdit' ? (ti.notebook_path ?? null) : (ti.file_path ?? null));
function relTo(absChild, parent){
  if (!parent) return null; const c = canon(absChild); let p = canon(parent);
  if (c === p) return ''; if (!p.endsWith('/')) p += '/'; return c.startsWith(p) ? c.slice(p.length) : null;
}
// Bash git classification (honest-drift best-effort). Split into top-level segments,
// tokenize each respecting quotes, then read the real subcommand after git's global
// options — so `git -C wt push` / `git.exe push` are caught and a commit MESSAGE that
// merely contains "git push" is not. (Subshell obfuscation is out of scope.)
function splitSegments(cmd){
  const segs = []; let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++){ const c = cmd[i];
    if (q){ cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'"){ q = c; cur += c; continue; }
    if (c === ';' || c === '\n'){ segs.push(cur); cur = ''; continue; }
    if ((c === '&' || c === '|') && cmd[i+1] === c){ segs.push(cur); cur = ''; i++; continue; }
    if (c === '|'){ segs.push(cur); cur = ''; continue; }
    cur += c; }
  segs.push(cur); return segs;
}
function tokenize(seg){
  const toks = []; let cur = '', q = null, has = false;
  for (let i = 0; i < seg.length; i++){ const c = seg[i];
    if (q){ if (c === q) q = null; else cur += c; has = true; continue; }
    if (c === '"' || c === "'"){ q = c; has = true; continue; }
    if (/\s/.test(c)){ if (has){ toks.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true; }
  if (has) toks.push(cur); return toks;
}
const GIT_RE = /(^|[\/\\])git(\.exe)?$/i;
const TAKES_ARG = new Set(['-C','-c','--git-dir','--work-tree','--namespace','--exec-path']);
function gitOp(seg){
  let toks = tokenize(seg);
  while (toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0]) || toks[0] === 'sudo')) toks.shift();  // env-assignments / sudo
  if (!toks.length || !GIT_RE.test(toks[0])) return null;
  let i = 1;
  while (i < toks.length){ const t = toks[i];
    if (t === '--'){ i++; break; }
    if (t.startsWith('-')){ i += (t.indexOf('=') === -1 && TAKES_ARG.has(t)) ? 2 : 1; continue; }
    break; }
  const sub = toks[i];
  if (sub === 'push') return 'push';
  if (sub === 'merge' || sub === 'rebase') return 'merge';
  if (sub === 'commit') return 'commit';
  return null;
}
function bashGit(cmd){
  const ops = new Set(splitSegments(String(cmd || '')).map(gitOp).filter(Boolean));
  if (ops.has('push')) return 'push';      // push/merge are denied at every level; surface them first
  if (ops.has('merge')) return 'merge';
  if (ops.has('commit')) return 'commit';
  return null;
}
export function decidePreTool(toolName, toolInput, ctx = {}){
  const level = String(ctx.level || 'L2').toUpperCase();
  const wrapUp = pastDeadline({ started_at: ctx.startedAt, time_budget_sec: ctx.timeBudgetSec }, ctx.now ?? Date.now());
  if (toolName === 'Bash'){
    const cmd = toolInput?.command;
    const op = bashGit(cmd);
    if (op === 'push' || op === 'merge') return deny('[seeks] delivery is automated via "seeks deliver" (L3 only); the agent never pushes/merges/rebases directly.');
    if (op === 'commit' && level === 'L1') return deny('[seeks] L1 is report-only: no commits. Write findings under .seeks/run/<name>/.');
    if (wrapUp && op !== 'commit' && !/seeks\.mjs/.test(String(cmd || '')))   // past the deadline: only wrap-up bash (seeks CLI, git commit)
      return deny('[seeks] time budget reached — only wrap-up allowed (seeks CLI, git commit, write summary.md), then end your turn.');
    return allow;
  }
  if (!EDIT_TOOLS.has(toolName)) return allow;
  const p = targetPath(toolName, toolInput); if (!p) return allow;
  const abs = canon(p);
  if (/\/\.seeks\/run\/[^/]+\/(status|hook-state)\.json$/.test(abs))
    return deny('[seeks] never hand-write status.json/hook-state.json — drive state via bin/seeks.mjs.');
  if (ctx.runDir && isInside(abs, ctx.runDir)) return allow;            // run-dir allow-zone
  const rel = relTo(abs, ctx.worktreePath);
  if (rel != null && anyGlob(rel, ctx.denylist ?? [])) return deny(`[seeks] '${rel}' is on the denylist — refusing to edit.`);
  if (ctx.worktreePath && !isInside(abs, ctx.worktreePath)) return deny('[seeks] edits must stay inside the loop worktree.');
  if (level === 'L1') return deny('[seeks] L1 is report-only: no source edits. Write findings under .seeks/run/<name>/.');
  if (wrapUp) return deny('[seeks] time budget reached — only summary/run-dir writes allowed; stop editing source and end your turn.');
  return allow;
}
