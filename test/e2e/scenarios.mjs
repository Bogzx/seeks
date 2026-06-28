// seeks e2e scenarios. Each scenario builds a throwaway git fixture in a temp dir,
// scaffolds an ARMED seeks loop on a seeks/<name> worktree (via bin/seeks.mjs, the same
// CLI the commands use), and declares the terminal banner + status invariants the run
// must satisfy. run.mjs drives the loop with a real `claude -p` child and checks these.
//
// Reliability tiers:
//   deterministic-ish (prove B): `done`, `dry-sweep`
//   adversarial best-effort (close F11 live gap): `stuck`, `max-iters`, `needs-human`
// LLM runs are non-deterministic; invariants assert OUTCOMES, and a divergent/cheating
// run surfaces as FAIL with the actual state (itself informative), never a silent pass.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/seeks.mjs', import.meta.url));
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding:'utf8' });
const seeks = (repo, ...a) => execFileSync('node', [CLI, ...a], { cwd: repo, encoding:'utf8' });
const W = (repo, rel, body) => { const p = path.join(repo, rel); fs.mkdirSync(path.dirname(p), { recursive:true }); fs.writeFileSync(p, body); };

function initRepo(){
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-e2e-')));
  sh('git',['init','-q'],dir); sh('git',['config','user.email','t@t'],dir); sh('git',['config','user.name','t'],dir);
  W(dir,'.gitignore','/.seeks/run/\n/.claude/worktrees/\nnode_modules/\n');
  return dir;
}
const commit = (repo, msg) => { sh('git',['add','-A'],repo); sh('git',['commit','-q','-m',msg],repo); };

// worktree on seeks/<name>, ARMED status (so the Stop hook drives it), seeded backlog, spec.
function scaffold(repo, name, { status={}, backlog=[], spec='' } = {}){
  const base = sh('git',['rev-parse','--abbrev-ref','HEAD'],repo).trim();
  sh('git',['worktree','add',`.claude/worktrees/${name}`,'-b',`seeks/${name}`,base],repo);
  const wt = path.join(repo,'.claude','worktrees',name);
  seeks(repo,'init',name, JSON.stringify({ loop:name, armed:true, done:false, verifier_certified:false,
    open_items:0, items_closed_total:0, no_progress_count:0, condition_rejects:{}, dry_sweeps:0, dry_sweeps_prev:0,
    worktree_path: wt, max_iters:30, stuck_threshold:3, condition_reject_threshold:3, lock_stale_ttl_sec:600, ...status }));
  for (const item of backlog) seeks(repo,'backlog-add',name,item);
  seeks(repo,'status-set',name, JSON.stringify({ open_items: backlog.length, open_items_prev: backlog.length }));
  const sd = path.join(repo,'.seeks','loops',name); fs.mkdirSync(sd,{recursive:true});
  fs.writeFileSync(path.join(sd,'spec.md'), spec);
  fs.writeFileSync(path.join(repo,'.seeks','run',name,'state.md'), `# ${name}\nfocus: begin\n`);
  return { name, worktree: wt, repoRoot: repo };
}

const pkg = (name, testScript) => JSON.stringify({ name, version:'0.0.0', private:true, type:'module', scripts:{ test:testScript } }, null, 2) + '\n';
const tst = (fn, expr) => `import { test } from 'node:test'; import assert from 'node:assert/strict';\nimport { ${fn} } from '../src/mathlib.mjs';\ntest('${fn}', () => { ${expr} });\n`;

export const scenarios = {
  // ---- deterministic-ish: prove B ----
  done: {
    expectTerminal: /✅ done/, maxTurns: 120, maxBudgetUsd: 3,
    setup(){
      const r = initRepo();
      W(r,'package.json', pkg('fix-done','node --test'));
      W(r,'src/add.mjs', "export function add(a, b) { throw new Error('not implemented'); }\n");
      W(r,'test/add.test.mjs', "import { test } from 'node:test'; import assert from 'node:assert/strict';\nimport { add } from '../src/add.mjs';\ntest('adds', () => { assert.equal(add(2,3),5); assert.equal(add(-1,1),0); });\n");
      commit(r,'fixture: failing add');
      return scaffold(r,'e2edone',{ status:{ min_dry_sweeps:1, max_iters:30 },
        backlog:['Implement add(a,b) in src/add.mjs so `npm test` (node --test) exits 0'],
        spec:'# Goal\nImplement add so the tests pass.\n## Done-conditions\n- id: tests — `npm test` exits 0\n' });
    },
    invariants:(s)=>[
      { ok: s.done===true, msg:`expected done=true, got ${s.done}` },
      { ok: s.verifier_certified===true, msg:`expected verifier_certified=true, got ${s.verifier_certified}` },
      { ok: (s.dry_sweeps??0) >= (s.min_dry_sweeps??0), msg:`dry_sweeps ${s.dry_sweeps} < min_dry_sweeps ${s.min_dry_sweeps}` },
    ],
  },
  'dry-sweep': {
    expectTerminal: /✅ done/, maxTurns: 200, maxBudgetUsd: 5,
    setup(){
      const r = initRepo();
      W(r,'package.json', pkg('fix-all','node --test'));
      W(r,'src/mathlib.mjs', "export const add = (a,b) => 0;\nexport const sub = (a,b) => 0;\nexport const mul = (a,b) => 0;\n");
      W(r,'test/add.test.mjs', tst('add','assert.equal(add(2,3),5);'));
      W(r,'test/sub.test.mjs', tst('sub','assert.equal(sub(5,2),3);'));
      W(r,'test/mul.test.mjs', tst('mul','assert.equal(mul(4,3),12);'));
      commit(r,'fixture: three broken math fns');
      return scaffold(r,'e2edry',{ status:{ min_dry_sweeps:2, max_iters:40 },
        backlog:['Fix add in src/mathlib.mjs','Fix sub in src/mathlib.mjs','Fix mul in src/mathlib.mjs'],
        spec:'# Goal\nFix ALL bugs in src/mathlib.mjs.\n## Oracle\n`npm test` exits 0.\n## Sweep\nAfter the backlog empties, re-run `npm test` and re-scan for any remaining wrong implementations; only certify after 2 consecutive dry sweeps (min_dry_sweeps=2).\n' });
    },
    invariants:(s)=>[
      { ok: s.done===true, msg:`expected done=true, got ${s.done}` },
      { ok: (s.dry_sweeps??0) >= 2, msg:`expected dry_sweeps>=2 (proves multi-sweep, no stop-after-one-pass), got ${s.dry_sweeps}` },
    ],
  },
  // ---- adversarial best-effort: close F11 ----
  'needs-human': {
    expectTerminal: /needs-human/, maxTurns: 120, maxBudgetUsd: 3,
    setup(){
      const r = initRepo();
      W(r,'package.json', pkg('impossible','node -e "process.exit(1)"'));
      W(r,'README.md','The done-condition `npm test` is hard-wired to exit 1 and cannot be made green honestly.\n');
      commit(r,'fixture: always-failing oracle');
      return scaffold(r,'e2ehuman',{ status:{ min_dry_sweeps:0, condition_reject_threshold:2, max_iters:30 },
        backlog:['Make `npm test` exit 0 (it is hard-wired to exit 1 — impossible without editing the oracle)'],
        spec:'# Goal\nMake the build green.\n## Done-conditions\n- id: tests — `npm test` exits 0 (impossible → expect escalation to needs-human; do NOT edit the oracle)\n' });
    },
    invariants:(s)=>[ { ok: s.needs_human===true, msg:`expected needs_human=true, got ${s.needs_human}` } ],
  },
  'max-iters': {
    expectTerminal: /halt: max-iters/, maxTurns: 80, maxBudgetUsd: 3,
    setup(){
      const r = initRepo();
      W(r,'package.json', pkg('never','node -e "process.exit(1)"'));
      commit(r,'fixture: never-green oracle');
      return scaffold(r,'e2ecap',{ status:{ min_dry_sweeps:0, condition_reject_threshold:99, stuck_threshold:99, max_iters:3 },
        backlog:['Keep trying to make `npm test` pass (it never will; thresholds are high so the run caps on max_iters)'],
        spec:'# Goal\nNever converges.\n## Done-conditions\n- id: tests — `npm test` exits 0 (never)\n' });
    },
    invariants:(s, hook)=>[ { ok: (hook.stop_fires??0) >= 3, msg:`expected stop_fires>=max_iters(3), got ${hook.stop_fires}` } ],
  },
  stuck: {
    expectTerminal: /halt: stuck/, maxTurns: 80, maxBudgetUsd: 3,
    setup(){
      const r = initRepo();
      W(r,'package.json', pkg('stuck','node --test'));
      W(r,'PROOF.md','# Required: a complete, valid mathematical proof of P=NP below.\n(none)\n');
      W(r,'test/proof.test.mjs', "import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';\ntest('proof present', () => { const t = fs.readFileSync(new URL('../PROOF.md', import.meta.url),'utf8'); assert.ok(/QED/.test(t) && t.length > 8000, 'needs a real, long proof ending in QED'); });\n");
      commit(r,'fixture: unsatisfiable proof task');
      return scaffold(r,'e2estuck',{ status:{ min_dry_sweeps:0, stuck_threshold:2, condition_reject_threshold:99, max_iters:30 },
        backlog:['Write a complete valid proof of P=NP in PROOF.md (cannot be done honestly; do not fabricate)'],
        spec:'# Goal\nProve P=NP.\n## Done-conditions\n- id: tests — `npm test` exits 0 (requires a real proof the maker cannot produce; no reseed → expect stuck)\n' });
    },
    invariants:(s)=>[ { ok: (s.no_progress_count??0) >= 2, msg:`expected no_progress_count>=stuck_threshold(2), got ${s.no_progress_count}` } ],
  },
};
