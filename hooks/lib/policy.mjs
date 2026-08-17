// Pure, deterministic PreToolUse policy. Claude produces the input; the verdict over
// it is fixed code (no model). First matching DENY wins; default ALLOW. Only edit
// tools + Bash are policed. Every verdict carries a stable `rule` id — that is what the
// decision log records and what `seeks why <name>` replays back.
// What this covers, and what it deliberately does not, is stated in README.md
// ("What the guardrails cover — and what they don't").
import { canon, isInside } from './paths.mjs'; import { anyGlob } from './glob.mjs';
import { pastDeadline } from './budget.mjs';
// The floor, not a suggestion. `**/.env` alone never matched `.env.local`; `.git/**` was
// ANCHORED, so a submodule's `vendor/lib/.git/config` was editable; and there was no
// pattern at all for private keys, `.npmrc` (`_authToken`), `~/.aws` or `~/.ssh`.
export const DEFAULT_DENYLIST = [
  '**/.env', '**/.env.*',                     // .env.local / .env.production / .env.test
  '**/secrets/**',
  '**/.git', '**/.git/**',                    // unanchored: a submodule's .git, and a worktree's .git FILE (repointing it escapes confinement)
  '**/*.pem',
  '**/id_rsa*', '**/id_ed25519*', '**/id_ecdsa*', '**/id_dsa*',   // deliberately prefix-globbed: `id_rsa_prod` is the common naming
  '**/.npmrc', '**/.aws/**', '**/.ssh/**',
];
// The default set is a FLOOR: a loop's own `denylist` adds to it, it cannot narrow it.
// Before this, a stale (or hand-crafted) status.json silently shipped the old, holed list.
export const effectiveDenylist = (extra) => [...DEFAULT_DENYLIST, ...(Array.isArray(extra) ? extra : [])];
const EDIT_TOOLS = new Set(['Edit','Write','MultiEdit','NotebookEdit']);
const allow = { action:'allow', rule:null, reason:null };
const deny = (rule, reason) => ({ action:'deny', rule, reason });
const HOOK_OWNED_DENY = '[seeks] status.json / hook-state.json / decisions.jsonl are hook-owned — never read or write them directly (that state holds the iteration cap, the clock, the verifier gate and the audit log). Drive state via bin/seeks.mjs: "seeks status-get <name>" / "seeks status-set <name> <patch-json>" / "seeks why <name>".';
const targetPath = (tool, ti) => !ti ? null : (tool === 'NotebookEdit' ? (ti.notebook_path ?? null) : (ti.file_path ?? null));
function relTo(absChild, parent){
  if (!parent) return null; const c = canon(absChild); let p = canon(parent);
  if (c === p) return ''; if (!p.endsWith('/')) p += '/'; return c.startsWith(p) ? c.slice(p.length) : null;
}

// ─── shell parsing ────────────────────────────────────────────────────────────────────
// ONE tokenizer, ONE segment splitter, ONE prefix stripper. Every Bash rule below is built
// from them, so an evasion closed for `git push` is closed for loop-state and strict mode
// in the same edit — the three can't drift apart. (Honest-drift best-effort: obfuscation
// through `$(…)` or variable indirection stays out of scope, and README says so.)
function stripComments(cmd){        // an unquoted `#` at a word boundary comments out the rest of the LINE
  let out = '', q = null;
  for (let i = 0; i < cmd.length; i++){ const c = cmd[i];
    if (q){ out += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'"){ q = c; out += c; continue; }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(cmd[i-1]))){
      while (i < cmd.length && cmd[i] !== '\n') i++;   // drop to end of line
      out += '\n'; continue; }                          // keep the break so neighbouring segments don't fuse
    out += c; }
  return out;
}
function splitSegments(cmd){
  const segs = []; let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++){ const c = cmd[i];
    if (c === '\\' && q !== "'" && i + 1 < cmd.length){ cur += c + cmd[i+1]; i++; continue; }  // an escaped char is never a delimiter or a quote
    if (q){ cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'"){ q = c; cur += c; continue; }
    if (c === ';' || c === '\n'){ segs.push(cur); cur = ''; continue; }
    if (c === '&' && (cmd[i-1] === '>' || cmd[i-1] === '<' || cmd[i+1] === '>')){ cur += c; continue; }  // `2>&1` / `&>log` is a redirection, NOT a control operator
    if ((c === '&' || c === '|') && cmd[i+1] === c){ segs.push(cur); cur = ''; i++; continue; }
    if (c === '|' || c === '&'){ segs.push(cur); cur = ''; continue; }   // lone | (pipe) or & (background) both end a segment
    if (c === '(' || c === ')' || c === '{' || c === '}'){ segs.push(cur); cur = ''; continue; }  // `(git push)` / `{ git push; }` — a group boundary is not an argument
    cur += c; }
  segs.push(cur); return segs;
}
function tokenize(seg){
  const toks = []; let cur = '', q = null, has = false;
  for (let i = 0; i < seg.length; i++){ const c = seg[i];
    // `\"` inside a double-quoted string is a literal quote, not the closing one — without this,
    // `eval "eval \"git push\""` tokenized into nonsense and the nested push escaped.
    if (c === '\\' && q !== "'" && i + 1 < seg.length){ cur += seg[++i]; has = true; continue; }
    if (q){ if (c === q) q = null; else cur += c; has = true; continue; }
    if (c === '"' || c === "'"){ q = c; has = true; continue; }
    if (/\s/.test(c)){ if (has){ toks.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true; }
  if (has) toks.push(cur); return toks;
}
const baseOf = (t) => String(t ?? '').split(/[\/\\]/).pop().replace(/\.exe$/i,'').toLowerCase();
// Transparent wrappers: they run their tail as a command, so the tail is what the policy
// must read. `env git push` and `sudo -u ci git push` were both walking straight through.
const WRAPPERS = new Set(['sudo','doas','env','command','builtin','exec','nohup','nice','time','setsid','stdbuf','timeout','ionice','xargs']);
// Per-wrapper flags that consume the NEXT token. Without these, `sudo -u ci git push` reads
// as the command `ci` and the push walks through — the exact class of bug this file exists to
// stop. Per-wrapper and not one global set, because `env -i` takes no argument while
// `stdbuf -i` does; merging them would re-open the hole from the other side.
const WRAPPER_ARG_FLAGS = {
  sudo: ['-u','-g','-p','-r','-t','-C','--user','--group','--prompt'],
  doas: ['-u','-C'],
  env:  ['-u','-C','-S','--unset','--chdir','--split-string'],
  nice: ['-n','--adjustment'],
  timeout: ['-s','-k','--signal','--kill-after'],
  stdbuf: ['-i','-o','-e','--input','--output','--error'],
  ionice: ['-c','-n','-p','-P','-u'],
  xargs: ['-n','-P','-I','-d','-a','-E','-L','-s','--max-args','--max-procs','--replace','--delimiter','--arg-file'],
};
function head(seg){                 // the real argv of a segment, past env-assignments and wrappers
  let t = tokenize(seg);
  for (let guard = 0; t.length && guard < 16; guard++){
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])){ t = t.slice(1); continue; }   // VAR=val prefix
    const b = baseOf(t[0]); if (!WRAPPERS.has(b)) break;
    const argFlags = new Set(WRAPPER_ARG_FLAGS[b] ?? []);
    t = t.slice(1);
    while (t.length && t[0].startsWith('-') && t[0] !== '-')                   // the wrapper's own flags…
      t = t.slice(t[0].indexOf('=') === -1 && argFlags.has(t[0]) ? 2 : 1);     // …and their arguments
    if (t.length && (b === 'nice' || b === 'timeout' || b === 'ionice') && /^[0-9]+[a-z]?$/i.test(t[0])) t = t.slice(1);  // `timeout 30 git push`
  }
  return t;
}
const SHELLS = new Set(['sh','bash','zsh','dash','ksh','busybox']);
function evalPayload(seg){          // `eval "git push"` / `bash -c 'git push'` — the payload is a command, not an argument
  const toks = head(seg); if (!toks.length) return null;
  const b = baseOf(toks[0]);
  if (b === 'eval') return toks.slice(1).join(' ');                            // quotes are already stripped by tokenize
  if (SHELLS.has(b)){ const i = toks.indexOf('-c'); if (i !== -1 && toks[i+1] != null) return toks[i+1]; }
  return null;
}
const MAX_EVAL_DEPTH = 3;
// Every segment that will actually RUN, with one hop of eval/-c expanded per level.
// This is the single list every Bash rule reads.
export function bashSegments(cmd, depth = 0){
  const out = [];
  for (const raw of splitSegments(stripComments(String(cmd ?? '')))){
    const seg = raw.trim(); if (!seg) continue;
    out.push(seg);
    if (depth < MAX_EVAL_DEPTH){ const inner = evalPayload(seg); if (inner) out.push(...bashSegments(inner, depth + 1)); }
  }
  return out;
}
const TAKES_ARG = new Set(['-C','-c','--git-dir','--work-tree','--namespace','--exec-path']);
function gitSub(seg){               // the real subcommand after git's global options, or null
  const toks = head(seg);
  if (!toks.length || baseOf(toks[0]) !== 'git') return null;
  let i = 1;
  while (i < toks.length){ const t = toks[i];
    if (t === '--'){ i++; break; }
    if (t.startsWith('-')){ i += (t.indexOf('=') === -1 && TAKES_ARG.has(t)) ? 2 : 1; continue; }
    break; }
  return toks[i] ?? null;
}
function bashGit(cmd){
  const subs = new Set(bashSegments(cmd).map(gitSub).filter(Boolean));
  if (subs.has('push')) return 'push';                          // push/merge are denied at every level; surface them first
  if (subs.has('merge') || subs.has('rebase')) return 'merge';
  if (subs.has('commit')) return 'commit';
  return null;
}
// Hook-owned files: the iteration cap, wall-clock, verifier gate and denylist all read out
// of them, so one write disarms every budget at once — and decisions.jsonl is the audit log
// that would prove it happened. ONE predicate, consumed by the edit-tool branch AND the Bash
// branch, so the two can never drift apart.
const HOOK_OWNED_RE = /(?:^|\/)\.seeks\/run\/[^/]+\/(?:status\.json|hook-state\.json|decisions\.jsonl)$/i;
export const isHookOwnedFile = (p) => HOOK_OWNED_RE.test(String(p ?? '').split('\\').join('/'));
// Bash can write a file in unbounded ways (`>`, `tee`, `dd`, `sed -i`, a heredoc, `python -c`),
// so classifying the VERB is a losing game. The enforceable line is the mention of the path
// itself — nothing legitimate needs it, because reads and writes both have a CLI
// (`seeks status-get` / `status-set` / `why`).
const REDIR_PREFIX = /^[0-9]*(?:>>|>\||>|<<<|<<|<)/;
function bashTouchesHookOwned(cmd){
  return bashSegments(cmd).some(seg =>
    tokenize(seg).some(t => isHookOwnedFile(t.replace(REDIR_PREFIX, ''))));
}
const SEEKS_CLI_RE = /(?:^|[\/\\])seeks\.mjs$/i;
function isSeeksCli(seg){           // `node /…/bin/seeks.mjs <cmd>` or a direct exec of it
  const toks = head(seg); if (!toks.length) return false;
  if (SEEKS_CLI_RE.test(toks[0])) return true;
  if (baseOf(toks[0]) !== 'node') return false;
  const script = toks.slice(1).find(t => !t.startsWith('-'));   // node's own flags come first, then the script
  return !!script && SEEKS_CLI_RE.test(script);
}
const WRAPUP_GIT = new Set(['add','commit','status','diff','log','rev-parse','stash']);
// Past the deadline only wrap-up may run, and EVERY segment must qualify — so a legitimate
// wrap-up command cannot smuggle a second one along. This used to be a substring test for
// "seeks.mjs" ANYWHERE in the string, which `rm -rf /important # seeks.mjs` walked straight
// through; the check is now over stripped, tokenized segments.
export function isWrapUpBash(cmd){
  const segs = bashSegments(cmd);
  return segs.length > 0 && segs.every(seg => isSeeksCli(seg) || WRAPUP_GIT.has(gitSub(seg)));
}
// ─── strict Bash mode (opt-in) ────────────────────────────────────────────────────────
// The honest answer for an untrusted goal: instead of policing a Turing-complete shell by
// pattern, deny everything whose head command isn't on an allowlist — so `curl … | sh`,
// `rm -rf`, `chmod`, `ssh`, `nc` and any bare binary are denied rather than merely
// un-policed. It is an ALLOWLIST, NOT A SANDBOX: `node` and `npm` are on it because the
// loop needs a toolchain, and `node -e` can do anything. A container is still the only
// guarantee — README says exactly this.
export const STRICT_BASH_ALLOW = [
  // read + inspect
  'ls','cat','head','tail','wc','grep','rg','find','file','stat','pwd','echo','printf','true','false',
  'sort','uniq','cut','tr','diff','realpath','dirname','basename','which','date','sleep','sed','awk','jq','test','[',
  // the loop's own working set
  'cd','pushd','popd','export','set','mkdir','cp','mv','touch',
  // toolchain: git is separately policed above; node/npm are how the seeks CLI and most checks run
  'git','node','npm','npx','pnpm','yarn','bun','make','just',
];
const TRUTHY = new Set(['1','true','yes','on']);
// One predicate for "is strict mode on", read by the hook and by `seeks preflight`, so the
// env var and the per-loop flag can't be honoured in one place and ignored in the other.
export const strictBashEnabled = (env = {}, status = {}) =>
  TRUTHY.has(String(env.SEEKS_STRICT_BASH ?? '').toLowerCase()) || status?.strict_bash === true;
function strictBashOffender(cmd, extra){
  const okay = new Set([...STRICT_BASH_ALLOW, ...(Array.isArray(extra) ? extra : []).map(baseOf)]);
  for (const seg of bashSegments(cmd)){
    if (isSeeksCli(seg)) continue;
    const toks = head(seg); if (!toks.length) continue;          // a bare redirection or empty group runs nothing
    const b = baseOf(toks[0]);
    if (!okay.has(b)) return b;
  }
  return null;
}

export function decidePreTool(toolName, toolInput, ctx = {}){
  const level = String(ctx.level || 'L2').toUpperCase();
  const wrapUp = pastDeadline({ started_at: ctx.startedAt, time_budget_sec: ctx.timeBudgetSec }, ctx.now ?? Date.now());
  if (toolName === 'Bash'){
    const cmd = toolInput?.command;
    const op = bashGit(cmd);
    if (op === 'push' || op === 'merge') return deny('git-push', '[seeks] delivery is automated via "seeks deliver" (L3 only); the agent never pushes/merges/rebases directly.');
    if (op === 'commit' && level === 'L1') return deny('l1-commit', '[seeks] L1 is report-only: no commits. Write findings under .seeks/run/<name>/.');
    if (bashTouchesHookOwned(cmd)) return deny('hook-owned', HOOK_OWNED_DENY);
    if (ctx.strictBash){
      const bad = strictBashOffender(cmd, ctx.strictBashAllow);
      if (bad) return deny('strict-bash', `[seeks] SEEKS_STRICT_BASH is on and '${bad}' is not on the Bash allowlist — denied. Allowed heads: ${STRICT_BASH_ALLOW.join(' ')}. Add more with "strict_bash_allow" in the loop's status (via "seeks status-set <name> '{\\"strict_bash_allow\\":[\\"cargo\\"]}'"), or turn strict mode off for a goal you trust.`);
    }
    if (wrapUp && !isWrapUpBash(cmd))   // past the deadline: only wrap-up bash (seeks CLI, git add/commit/status/diff)
      return deny('wrap-up', '[seeks] time budget reached — only wrap-up allowed (seeks CLI, git add/commit, write summary.md), then end your turn.');
    return allow;
  }
  if (!EDIT_TOOLS.has(toolName)) return allow;
  const p = targetPath(toolName, toolInput); if (!p) return allow;
  const abs = canon(p);
  if (isHookOwnedFile(abs)) return deny('hook-owned', HOOK_OWNED_DENY);
  if (ctx.runDir && isInside(abs, ctx.runDir)) return allow;            // run-dir allow-zone
  const rel = relTo(abs, ctx.worktreePath);
  if (rel != null && anyGlob(rel, effectiveDenylist(ctx.denylist)))
    return deny('denylist', `[seeks] '${rel}' is on the denylist — refusing to edit.`);
  if (ctx.worktreePath && !isInside(abs, ctx.worktreePath)) return deny('outside-worktree', '[seeks] edits must stay inside the loop worktree.');
  if (level === 'L1') return deny('l1-edit', '[seeks] L1 is report-only: no source edits. Write findings under .seeks/run/<name>/.');
  if (wrapUp) return deny('wrap-up', '[seeks] time budget reached — only summary/run-dir writes allowed; stop editing source and end your turn.');
  return allow;
}
