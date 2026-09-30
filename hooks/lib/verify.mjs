// The deterministic half of "done". The verifier subagent is an LLM in the same session as the
// maker, so its verdict is advice; what the Stop gate releases `done` on is this: every
// executable done-condition stored at `init`, run by the HOOK in the loop's worktree, exiting
// with its expected code on the current tree. No model in the loop.
import { spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';

export const DEFAULT_CONDITION_TIMEOUT_SEC = 600;
export const executableConditions = (s) =>
  (Array.isArray(s?.conditions) ? s.conditions : []).filter(c => c && typeof c.cmd === 'string' && c.cmd.trim() && !c.human_required);

// `expect` was always free text written by the intake ("0", "exit 0", 0, "all green"). Only an
// exit code is machine-checkable; anything else means exit 0, and the prose stays the
// verifier's job to judge.
export function expectedExit(expect){
  if (typeof expect === 'number' && Number.isInteger(expect)) return expect;
  const m = /^\s*(?:exit(?:\s*code)?\s*)?(-?\d+)\s*$/i.exec(String(expect ?? ''));
  return m ? Number(m[1]) : 0;
}
const tail = (s, n = 600) => { const t = String(s ?? ''); return t.length > n ? `…${t.slice(-n)}` : t; };

export function runConditions(conds, cwd, { timeoutSec = DEFAULT_CONDITION_TIMEOUT_SEC, budgetMs = 55 * 60 * 1000, now = Date.now } = {}){
  const results = []; const deadline = now() + budgetMs;
  for (const c of conds){
    const id = String(c.id ?? c.cmd); const want = expectedExit(c.expect);
    const left = deadline - now();
    if (left <= 0){ results.push({ id, cmd: c.cmd, ok: false, exit: null, want, ms: 0, tail: 'not run: the gate\'s verification budget was spent' }); continue; }
    const t0 = now();
    const r = spawnSync(c.cmd, { cwd, shell: true, encoding: 'utf8', windowsHide: true,
      timeout: Math.min((Number(c.timeout_sec) || timeoutSec) * 1000, left), maxBuffer: 32 * 1024 * 1024 });
    const exit = r.error ? null : r.status;
    results.push({ id, cmd: c.cmd, ok: exit === want, exit, want, ms: now() - t0,
      tail: r.error ? String(r.error.code || r.error.message) : tail(`${r.stdout ?? ''}${r.stderr ?? ''}`) });
  }
  return { ok: results.length > 0 && results.every(r => r.ok), results };
}

// Content fingerprint of the worktree (HEAD + every dirty or untracked file's blob), so a pass
// the gate already verified is not re-run on an unchanged tree — and ANY edit invalidates it.
// Loop state under .seeks/ is excluded: the hook writes it on every stop. null → not a git tree
// (never cached).
export function treeFingerprint(wt){
  const git = (args, input) => execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe','pipe','ignore'] });
  let head, porcelain;
  try { head = git(['rev-parse', 'HEAD']).trim(); porcelain = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']); }
  catch { return null; }
  const recs = porcelain.split('\0'); const files = [];
  for (let i = 0; i < recs.length; i++){
    const r = recs[i]; if (!r) continue;
    const xy = r.slice(0, 2), f = r.slice(3);
    if (/[RC]/.test(xy)) i++;                                   // -z: a rename's source is the next record
    if (!f.split('/').includes('.seeks')) files.push(f);
  }
  files.sort();
  const present = files.filter(f => { try { return fs.statSync(path.join(wt, f)).isFile(); } catch { return false; } });
  let blobs = [];
  if (present.length){ try { blobs = git(['hash-object', '--stdin-paths'], present.join('\n') + '\n').trim().split('\n'); } catch { return null; } }
  const byFile = new Map(present.map((f, i) => [f, blobs[i]]));
  const h = crypto.createHash('sha1').update(head);
  for (const f of files) h.update(`\n${f}:${byFile.get(f) ?? 'deleted'}`);
  return h.digest('hex').slice(0, 20);
}

// The reject bookkeeping `seeks condition-reject` has always done, shared so the gate's own
// failures count toward the same needs-human escalation (a maker that keeps re-certifying a
// red tree ends up in front of a human, not in an endless loop).
export function applyConditionReject(s, id){
  const cr = { ...(s.condition_rejects || {}) }; cr[id] = (cr[id] || 0) + 1;
  const patch = { condition_rejects: cr };
  if (cr[id] >= (s.condition_reject_threshold ?? 3)) patch.needs_human = true;
  return patch;
}
