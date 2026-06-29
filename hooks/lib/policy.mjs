// Pure, deterministic PreToolUse policy. Claude produces the input; the verdict over
// it is fixed code (no model). First matching DENY wins; default ALLOW. Only edit
// tools + Bash are policed. See docs/superpowers/specs/2026-06-29-seeks-enforcement-plane-design.md §5.
import { canon, isInside } from './paths.mjs'; import { anyGlob } from './glob.mjs';
export const DEFAULT_DENYLIST = ['**/.env','**/secrets/**','.git/**'];
const EDIT_TOOLS = new Set(['Edit','Write','MultiEdit','NotebookEdit']);
const allow = { action:'allow', reason:null };
const deny = (reason) => ({ action:'deny', reason });
const targetPath = (tool, ti) => !ti ? null : (tool === 'NotebookEdit' ? (ti.notebook_path ?? null) : (ti.file_path ?? null));
function relTo(absChild, parent){
  if (!parent) return null; const c = canon(absChild); let p = canon(parent);
  if (c === p) return ''; if (!p.endsWith('/')) p += '/'; return c.startsWith(p) ? c.slice(p.length) : null;
}
function bashGit(cmd){ const c = String(cmd || '');
  if (/\bgit\s+push\b/.test(c)) return 'push';
  if (/\bgit\s+(merge|rebase)\b/.test(c)) return 'merge';
  if (/\bgit\s+commit\b/.test(c)) return 'commit'; return null; }
export function decidePreTool(toolName, toolInput, ctx = {}){
  const level = String(ctx.level || 'L2').toUpperCase();
  if (toolName === 'Bash'){
    const op = bashGit(toolInput?.command);
    if (op === 'push'  && level !== 'L3') return deny(`[seeks] ${level}: this loop never pushes — 'git push' is blocked.`);
    if (op === 'merge' && level !== 'L3') return deny(`[seeks] ${level}: this loop never merges/rebases onto the base.`);
    if (op === 'commit' && level === 'L1') return deny('[seeks] L1 is report-only: no commits. Write findings under .seeks/run/<name>/.');
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
  return allow;
}
