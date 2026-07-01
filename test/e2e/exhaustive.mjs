// Deterministic e2e for the exhaustive-sweep gate fix — NO live model.
//
// Reproduces the exact arc the reviewed run hit and proves the fix end-to-end through the
// REAL binaries: the Stop hook (hooks/stop-gate.mjs) reading a real stdin payload, against a
// real git worktree whose .seeks state is mutated only through the real CLI (bin/seeks.mjs).
//
//   node test/e2e/exhaustive.mjs
//
// Arc:
//   [1] An exhaustive L3 loop is certified + delivered but dry_depth_rounds 0/2 (the maker
//       certified early on dry_sweeps, like the run). The gate must BLOCK with an INFORMATIVE
//       reason (names the depth-round bar) — not the old generic "do one pass" that caused the
//       thrash + self-disarm — and the banner must show the honest exhaustive progress.
//   [2] The maker keeps sweeping (the corrected behavior). The gate releases `done` EXACTLY when
//       `seeks sweep-status` (the predicate the skill now consults) flips to satisfied — proving
//       the single source of truth: gate, banner, and maker can no longer diverge.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CLI  = path.join(REPO, 'bin', 'seeks.mjs');
const HOOK = path.join(REPO, 'hooks', 'stop-gate.mjs');
const sh    = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' });
const seeks = (repo, ...a) => execFileSync('node', [CLI, ...a], { cwd: repo, encoding: 'utf8' }).trim();

// Invoke the REAL Stop hook the way Claude Code does: pipe it {cwd, session_id} on stdin,
// from inside the worktree. Returns the hook's parsed JSON decision (or {} when it stays silent).
function fireStopHook(worktree, sessionId = 's1') {
  const out = execFileSync('node', [HOOK], {
    cwd: worktree, input: JSON.stringify({ cwd: worktree, session_id: sessionId }), encoding: 'utf8',
  }).trim();
  return out ? JSON.parse(out) : {};
}

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

// --- scaffold a real repo + worktree + armed exhaustive loop (small 2-lens catalog so we can drive it) ---
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-e2e-ex-')));
sh('git', ['init', '-q'], repo); sh('git', ['config', 'user.email', 't@t'], repo); sh('git', ['config', 'user.name', 't'], repo);
fs.writeFileSync(path.join(repo, '.gitignore'), '/.seeks/run/\n/.claude/worktrees/\n');
fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
sh('git', ['add', '-A'], repo); sh('git', ['commit', '-q', '-m', 'init'], repo);
const base = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
const name = 'exrun';
sh('git', ['worktree', 'add', `.claude/worktrees/${name}`, '-b', `seeks/${name}`, base], repo);
const wt = path.join(repo, '.claude', 'worktrees', name);

// The exact stuck state: exhaustive, certified + delivered (L3), but dry_depth_rounds 0/2.
seeks(repo, 'init', name, JSON.stringify({
  loop: name, armed: true, done: true, verifier_certified: true, delivered: true, level: 'L3',
  exhaustive: true, sweep_lenses: ['a', 'b'], dry_lenses: [], dry_sweeps: 3, depth: 1,
  dry_depth_rounds: 0, min_dry_depth_rounds: 2, executable_condition_count: 1,
  worktree_path: wt, max_iters: 50, stuck_threshold: 99, condition_reject_threshold: 99, base_ref: base,
}));

console.log(`\n[1] stuck state — certified + delivered, but exhaustive bar unmet (dry_depth_rounds 0/2):`);
let r;
for (let i = 0; i < 3; i++) {                                  // the run got re-prompted here pass after pass
  r = fireStopHook(wt);
  const steer = r.hookSpecificOutput?.additionalContext || '';   // model-facing steering — NOT rendered to the user as "Stop hook feedback"
  ok(r.decision === 'block', `fire ${i + 1}: gate BLOCKS — does not wrongly release a sweep-unsatisfied loop`);
  ok(/depth-round/i.test(steer), `fire ${i + 1}: model steering NAMES the unmet bar (depth-round)`);
  ok(!/Do EXACTLY ONE pass/.test(steer), `fire ${i + 1}: NOT the old uninformative generic block`);
  ok(/do NOT.*disarm/i.test(steer), `fire ${i + 1}: explicitly tells the maker not to disarm`);
  // the USER-visible reason is the terse banner, never the verbose steering (the "Stop hook feedback" spam fix)
  ok(/dry-round 0\/2/.test(r.reason || '') && !/Do EXACTLY ONE pass/.test(r.reason || ''),
     `fire ${i + 1}: user-facing reason is the terse banner, not the model steering`);
}
ok(/continuing/.test(r.systemMessage || ''), 'banner: continuing (not a terminal release)');
ok(/dry-round 0\/2/.test(r.systemMessage || ''), 'banner: honest exhaustive progress "dry-round 0/2" (not the misleading "sweep 3/3 dry")');
ok(!/✅ done/.test(r.systemMessage || ''), 'banner: does NOT show ✅ done');

const ss = JSON.parse(seeks(repo, 'sweep-status', name));
ok(ss.satisfied === false, 'sweep-status (what the skill consults BEFORE certifying) says satisfied:false — a compliant maker would never have certified early');

console.log(`\n[2] maker keeps sweeping (the corrected behavior) until the exhaustive bar is met:`);
for (const [i, lens] of ['a', 'b', 'a', 'b'].entries()) {
  seeks(repo, 'sweep-tick', name, '0', lens);                  // one dry sweep through a fresh lens, via the real CLI
  const s = JSON.parse(seeks(repo, 'sweep-status', name));
  const released = fireStopHook(wt).decision !== 'block';
  console.log(`  sweep ${i + 1} (${lens}): ${s.label}  →  satisfied=${s.satisfied}, gate ${released ? 'RELEASES' : 'holds'}`);
  ok(released === s.satisfied, `sweep ${i + 1}: gate release === sweep-status.satisfied (single source of truth)`);
}

const finalStatus = JSON.parse(seeks(repo, 'status-get', name));
ok(finalStatus.dry_depth_rounds === 2, `dry_depth_rounds reached the target (${finalStatus.dry_depth_rounds}/2)`);
const fin = fireStopHook(wt);
ok(fin.decision !== 'block', 'gate now ALLOWS the stop (no block) — the loop terminates on its own, no self-disarm needed');
ok(/✅ done/.test(fin.systemMessage || ''), 'banner shows ✅ done (clean terminal release)');

try { sh('git', ['worktree', 'remove', '--force', `.claude/worktrees/${name}`], repo); } catch {}
try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}

console.log(failures ? `\nFAIL (${failures})` : '\nPASS');
process.exit(failures ? 1 : 0);
