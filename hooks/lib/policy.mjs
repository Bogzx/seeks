// Pure, deterministic PreToolUse policy. Claude produces the input; the verdict over
// it is fixed code (no model). First matching DENY wins; default ALLOW. Only edit
// tools + Bash are policed. Every verdict carries a stable `rule` id — that is what the
// decision log records and what `seeks why <name>` replays back.
// What this covers, and what it deliberately does not, is stated in README.md
// ("What the guardrails cover — and what they don't").
import { canon, isInside } from './paths.mjs'; import { anyGlob, globMatch } from './glob.mjs';
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
const DASH_C = /^-[a-z]*c$/i;       // `-c`, and the combined forms `sh -lc …` / `bash -ec …`
function evalPayload(seg){          // `eval "git push"` / `bash -c 'git push'` — the payload is a command, not an argument
  const toks = head(seg); if (!toks.length) return null;
  const b = baseOf(toks[0]);
  if (b === 'eval') return toks.slice(1).join(' ');                            // quotes are already stripped by tokenize
  if (!SHELLS.has(b)) return null;
  const i = toks.findIndex(t => DASH_C.test(t)); if (i !== -1 && toks[i+1] != null) return toks[i+1];
  // `bash <<< 'cd … && echo > status.json'` — a here-string is a script too. (A here-DOC needs
  // no special case: splitSegments already breaks its body into real segments on the newlines.)
  const h = toks.findIndex(t => t.startsWith('<<<'));
  if (h !== -1) return toks[h].length > 3 ? toks[h].slice(3) : (toks[h+1] ?? null);
  return null;
}
const MAX_EVAL_DEPTH = 3;
// ─── notional cwd ─────────────────────────────────────────────────────────────────────
// `cd <run-dir> && echo … > status.json` writes the budget file with a token that mentions
// no path at all. Nothing lexical can see that; only carrying a cwd across segments can. So
// the planner below is a tiny interpreter for exactly one statement — `cd` — and every other
// statement it cannot evaluate collapses the cwd to UNKNOWN (null) rather than to "safe".
const CD_HEADS = new Set(['cd','pushd','chdir']);
const CD_FLAGS = new Set(['-L','-P','-e','-@']);
// An argument we cannot evaluate statically: home, the previous dir, a variable, a
// substitution, a glob. `cd` with no argument goes home. All of them ⇒ UNKNOWN, and UNKNOWN
// is treated as "this could be the run dir" — see mightBeHookOwned().
const OPAQUE_CD_ARG = /[$`*?~[\]]|^-$/;
function applyCd(state, argv){
  if (!argv.length) return;
  const b = baseOf(argv[0]);
  if (b === 'popd'){ state.cwd = state.stack.length ? state.stack.pop() : null; return; }
  if (!CD_HEADS.has(b)) return;
  const args = argv.slice(1).filter(t => !CD_FLAGS.has(t));
  if (b === 'pushd') state.stack.push(state.cwd);
  const arg = args[0];
  state.cwd = (arg == null || OPAQUE_CD_ARG.test(arg)) ? null : resolvePath(state.cwd, arg);
}
// `env -C <dir> …` / `env --chdir=<dir> …` runs the tail somewhere else, and head() strips the
// wrapper — so without this the directory change vanished and the tail read as if it ran here.
// Segment-local: it does not outlive the command, unlike `cd`.
function envChdir(rawToks, cwd){
  if (!rawToks.length || baseOf(rawToks[0]) !== 'env') return cwd;
  for (let i = 1; i < rawToks.length; i++){ const t = rawToks[i];
    if (t === '-C' || t === '--chdir'){ const d = rawToks[i+1]; return d == null || OPAQUE_CD_ARG.test(d) ? null : resolvePath(cwd, d); }
    if (t.startsWith('--chdir=')){ const d = t.slice(8); return OPAQUE_CD_ARG.test(d) ? null : resolvePath(cwd, d); }
    if (t.startsWith('-C') && t.length > 2){ const d = t.slice(2); return OPAQUE_CD_ARG.test(d) ? null : resolvePath(cwd, d); }
    if (!t.startsWith('-') && t.indexOf('=') === -1) break;      // past env's own arguments: the real command
  }
  return cwd;
}
// Every segment that will actually RUN, in order, each tagged with the cwd it runs in and
// with one hop of eval/-c expanded per level. This is the single list every Bash rule reads:
// an evasion closed here is closed for git-push, loop-state and strict mode at once.
export function bashPlan(cmd, cwd = null, depth = 0, state = null){
  const st = state ?? { cwd: cwd ?? null, stack: [] };
  const out = [];
  for (const raw of splitSegments(stripComments(String(cmd ?? '')))){
    const seg = raw.trim(); if (!seg) continue;
    const toks = tokenize(seg), argv = head(seg);
    const cwd = envChdir(toks, st.cwd);
    out.push({ seg, argv, toks, cwd });
    if (depth < MAX_EVAL_DEPTH){
      const inner = evalPayload(seg);
      // `eval` runs in THIS shell, so a `cd` inside it persists afterwards; `sh -c` forks, so
      // it does not. Share the state object for the first, snapshot it for the second.
      if (inner) out.push(...bashPlan(inner, null, depth + 1,
        baseOf(argv[0] ?? '') === 'eval' ? st : { cwd, stack: [] }));
    }
    applyCd(st, argv);
  }
  return out;
}
export const bashSegments = (cmd, cwd = null) => bashPlan(cmd, cwd).map(e => e.seg);
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
const HOOK_FILE = '(?:status\\.json|hook-state\\.json|decisions\\.jsonl)';
const HOOK_FILE_RE = new RegExp(`^${HOOK_FILE}$`, 'i');
const HOOK_OWNED_RE = new RegExp(`(?:^|/)\\.seeks/run/[^/]+/${HOOK_FILE}$`, 'i');
// The same shape, UNANCHORED and separator-agnostic: for when the path is spelled out inside
// something that is not a bare path token — a `python -c` string literal, a heredoc body, an
// awk program. If the full path appears anywhere in the command text at all, that is enough.
const HOOK_OWNED_ANYWHERE_RE = new RegExp(`\\.seeks[/\\\\]+run[/\\\\]+[^/\\\\\\s;&|'"()]+[/\\\\]+${HOOK_FILE}`, 'i');
const HOOK_FILES = ['status.json','hook-state.json','decisions.jsonl'];
const HOOK_MENTION_RE = new RegExp(HOOK_FILE, 'i');
const SEEKS_RUN_RE = /\.seeks[/\\]+run/i;
// ─── lexical path normalization ───────────────────────────────────────────────────────
// `paths.mjs::canon` resolves against the real filesystem and the HOOK's cwd — the wrong tool
// for a string lifted out of a command line, where the cwd that matters is the shell's. This
// is the lexical half: collapse `.`, `..` and duplicate separators, fold `\` into `/`, keep a
// drive letter. `<run-dir>/../<name>/status.json` defeated the old suffix anchor purely
// because nothing ever collapsed the `..`.
function splitPath(p){
  const s = String(p ?? '').split('\\').join('/');
  const m = /^([A-Za-z]:)\/?/.exec(s);
  if (m) return { drive: m[1].toLowerCase(), abs: true, parts: s.slice(m[0].length).split('/') };
  if (s.startsWith('/')) return { drive: '', abs: true, parts: s.slice(1).split('/') };
  return { drive: '', abs: false, parts: s.split('/') };
}
function normParts({ abs, parts }){
  const out = [];
  for (const part of parts){
    if (part === '' || part === '.') continue;
    if (part === '..'){
      if (out.length && out[out.length-1] !== '..') out.pop();
      else if (!abs) out.push('..');            // a relative path may still legitimately climb
      continue; }
    out.push(part); }
  return out;
}
function normalizePath(p){ const s = splitPath(p); return s.drive + (s.abs ? '/' : '') + normParts(s).join('/'); }
function resolvePath(cwd, p){                   // null ⇒ relative path against an UNKNOWN cwd
  if (splitPath(p).abs) return normalizePath(p);
  return cwd == null ? null : normalizePath(cwd + '/' + p);
}
export const isHookOwnedFile = (p) => HOOK_OWNED_RE.test(normalizePath(p));
// UNKNOWN cwd: could SOME cwd make this relative path hook-owned? Deliberately answers "yes"
// whenever it cannot prove "no" — an unresolvable `cd` must not read as safe.
function mightBeHookOwned(rel){
  const parts = normParts(splitPath(rel));
  if (!parts.length || !HOOK_FILE_RE.test(parts[parts.length-1])) return false;
  const pre = parts.slice(0, -1);
  if (pre.includes('..')) return true;                                          // unresolvable
  const n = pre.length;                                                         // …/.seeks/run/<name>/<file>
  if (n >= 3) return pre[n-2].toLowerCase() === 'run' && pre[n-3].toLowerCase() === '.seeks';
  if (n === 2) return pre[0].toLowerCase() === 'run';                           // cwd could end in /.seeks
  return true;                                                                  // 0–1 components: cwd could supply the rest
}
// A token can carry a path behind a redirection operator (`>status.json`, `2>>x`) or behind a
// `key=` (`dd of=status.json`, `--output=…`, and a bare `F=…/status.json` assignment that a
// later `$F` dereferences). Test every reading.
const REDIR_PREFIX = /^(?:[0-9]+|&)?(?:>>|>\||>&|>|<<<|<<|<)/;
// Shell punctuation that tokenize() leaves glued to a path: `$'status.json'` collapses to
// `$status.json`, a backtick command substitution leaves `` status.json` ``, `$(…)` leaves a
// stray `)`. Trimming produces an EXTRA reading, never a replacement — candidates can only
// ever add denials, so a wrong guess here cannot open a hole.
const TRIM_EDGES = /^[\s$"'`({<]+|[\s"'`)};,]+$/g;
function pathCandidates(tok){
  const t = String(tok ?? ''); const out = [t, t.replace(REDIR_PREFIX, ''), t.replace(TRIM_EDGES, '')];
  const eq = t.indexOf('='); if (eq > 0) out.push(t.slice(eq + 1).replace(TRIM_EDGES, ''));
  return out.filter(Boolean);
}
// Interpreter one-liners can write any path from inside a string literal, and parsing embedded
// Python/JS/Perl is out of scope. So the payload is not parsed — it is SCANNED, and any mention
// of a hook-owned filename or a `.seeks/run` fragment denies. This over-matches on purpose
// (`node -e "fs.readFileSync('status.json')"` denies even if that is a project file); the
// false positive is cheap and the sanctioned CLI is always available instead.
const CODE_HEADS = new Set(['python','python2','python3','py','node','nodejs','ts-node','tsx','deno','bun',
  'perl','ruby','php','lua','luajit','tclsh','osascript','rscript','julia','groovy','scala','swipl','ghci','zx',
  'vim','vi','nvim','ex','ed','emacs','emacsclient']);   // an editor's `-c`/`-s` script writes files too
const CODE_FLAGS = new Set(['-c','-e','-E','-r','-p','--eval','--execute','--command','--print']);
const SCRIPT_HEADS = new Set(['awk','gawk','mawk','nawk','sed']);   // the PROGRAM is a bare argument, and it can redirect
const SCRIPT_ARG_FLAGS = new Set(['-F','-v','-f','--field-separator','--assign','--file','-e','--expression']);
function codePayloads(argv){
  if (!argv.length) return []; const b = baseOf(argv[0]); const out = [];
  if (CODE_HEADS.has(b)) for (let i = 1; i < argv.length; i++){ const t = argv[i];
    if (CODE_FLAGS.has(t)){ if (argv[i+1] != null) out.push(argv[++i]); continue; }
    if (t.startsWith('<<<')){ out.push(t.length > 3 ? t.slice(3) : (argv[i+1] ?? '')); continue; }   // `ed -s f <<< 'w status.json'`
    const eq = t.indexOf('=');
    if (eq > 1 && CODE_FLAGS.has(t.slice(0, eq))){ out.push(t.slice(eq + 1)); continue; }
    const m = /^(-[a-zA-Z])(.+)$/.exec(t);                            // `python -c'code'`, glued
    if (m && CODE_FLAGS.has(m[1])) out.push(m[2]);
  }
  if (SCRIPT_HEADS.has(b)) for (let i = 1; i < argv.length; i++){ const t = argv[i];
    if (t.startsWith('-')){ if (SCRIPT_ARG_FLAGS.has(t) && argv[i+1] != null) i++; continue; }
    out.push(t); break;                                               // the first bare argument is the program
  }
  return out;
}
function underRunDir(abs, runDir){        // belt-and-braces: don't rely on the run dir's SHAPE
  const pre = runDir.endsWith('/') ? runDir : runDir + '/';
  return abs.toLowerCase().startsWith(pre.toLowerCase()) && HOOK_FILE_RE.test(abs.slice(pre.length));
}
// A resolved path may still be a PATTERN. `cd <run-dir> && echo x > sta*.json` names no
// hook-owned file lexically, and the shell expands it onto one. Reuse the denylist's own glob
// engine rather than growing a second one: does this pattern cover a file we own?
const GLOB_RE = /[*?[]/;
function hookOwnedResolved(abs, runDir){
  if (HOOK_OWNED_RE.test(abs)) return true;
  if (runDir && underRunDir(abs, runDir)) return true;
  return !!runDir && GLOB_RE.test(abs) && HOOK_FILES.some(f => globMatch(`${runDir}/${f}`, abs));
}
// Deleting or repointing the run dir disarms the budget exactly as thoroughly as rewriting the
// file inside it — and `rm -rf <run-dir>` names no hook-owned FILE at all. So for the handful of
// heads that destroy or redirect a directory, the directory itself is off limits. Everything
// else (`ls`, `cat <run-dir>/summary.md`, writing backlog.md) is untouched, which is why this
// is a short verb list and not a blanket rule over the path.
const DESTRUCTIVE_HEADS = new Set(['rm','rmdir','unlink','shred','mv','chmod','chown','chgrp','ln','truncate','mkfifo','mount',
  'tar','unzip','rsync','cpio','7z','unrar',     // unpacking INTO the run dir overwrites it just as well
  'cp','install']);                              // `cp /tmp/status.json <run-dir>/` names no hook path either
const SEEKS_DIR_SHAPE_RE = /(?:^|\/)\.seeks(?:\/run(?:\/[^/]+)?)?$/i;
const isSeeksTreeDir = (abs, runDir) =>
  SEEKS_DIR_SHAPE_RE.test(abs) || (!!runDir && abs.toLowerCase() === runDir.toLowerCase());
// A relative path we cannot pin down. Claude Code's Bash tool keeps ONE shell across calls, so a
// `cd <run-dir>` in an earlier call is still in effect in this one — and the hook never sees it
// (`input.cwd` is the session's directory, not the shell's). A bare `status.json`, a `./status.json`
// or anything climbing through `..` is therefore un-resolvable in principle, not just in practice.
// Those spellings deny. A path with a real directory in front of it (`src/status.json`) resolves
// against the cwd we were handed and is allowed — that is the deliberate line, and the residual
// hole it leaves (`cd <run-dir>/..` in call 1, `ui/status.json` in call 2) is in the README.
function relIsAmbiguous(cand){
  const parts = normParts(splitPath(cand));
  if (!parts.length || !HOOK_FILE_RE.test(parts[parts.length-1])) return false;
  return parts.length === 1 || parts.includes('..');
}
const DYNAMIC_RE = /[$`]/;          // `$R/status.json`, `$(dirname x)/status.json` — value unknown at decision time
// Bash can write a file in unbounded ways (`>`, `tee`, `dd`, `sed -i`, a heredoc, `python -c`),
// so classifying the VERB is a losing game. The enforceable line is the mention of the path
// itself — nothing legitimate needs it, because reads and writes both have a CLI
// (`seeks status-get` / `status-set` / `why`). Layers, cheapest first; any one denies.
// This is BEST-EFFORT and the README says so in those words: a shell is Turing-complete, and a
// path assembled at runtime, or written by a script this only sees the NAME of, is out of reach.
function bashTouchesHookOwned(cmd, ctx = {}){
  const raw = String(cmd ?? '');
  if (HOOK_OWNED_ANYWHERE_RE.test(raw)) return true;                  // 1. spelled out in full, in ANY context
  const runDir = ctx.runDir ? normalizePath(ctx.runDir) : null;
  const plan = bashPlan(raw, ctx.cwd ?? ctx.worktreePath ?? null);
  // `python3 - <<'EOF' … EOF` — the body is source code, and finding where it ends needs a real
  // parser. Same conservative call as `-c`: an interpreter fed a here-doc gets its whole command
  // text scanned. (A here-doc into a SHELL needs none of this — its body is already segments.)
  if (plan.some(e => e.argv.length && CODE_HEADS.has(baseOf(e.argv[0])) && /<<-?\s*['"]?[A-Za-z_]/.test(e.seg))
      && (HOOK_MENTION_RE.test(raw) || SEEKS_RUN_RE.test(raw))) return true;
  for (const { argv, toks, cwd } of plan){
    for (const p of codePayloads(argv))                               // 2. interpreter / awk / sed program text
      if (HOOK_MENTION_RE.test(p) || SEEKS_RUN_RE.test(p)) return true;
    const destructive = argv.length > 0 && DESTRUCTIVE_HEADS.has(baseOf(argv[0]));
    for (const tok of toks) for (const cand of pathCandidates(tok)){
      if (relIsAmbiguous(cand)) return true;                          // 3. un-pinnable relative spelling
      if ((DYNAMIC_RE.test(cand) || cwd == null) && mightBeHookOwned(cand)) return true;   // 4. unknown cwd / value
      const abs = resolvePath(cwd, cand);                             // 5. resolved against the notional cwd
      if (abs == null) continue;
      if (hookOwnedResolved(abs, runDir)) return true;
      if (destructive && isSeeksTreeDir(abs, runDir)) return true;    // 6. `rm -rf <run-dir>` names no file
    }
  }
  return false;
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
    if (bashTouchesHookOwned(cmd, ctx)) return deny('hook-owned', HOOK_OWNED_DENY);
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
