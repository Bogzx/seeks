import { test } from 'node:test'; import assert from 'node:assert/strict';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
const HOOK = fileURLToPath(new URL('../hooks/pre-tool.mjs', import.meta.url));
const run = (cwd, payload) => execFileSync('node',[HOOK],{ input: JSON.stringify({ cwd, ...payload }) }).toString().trim();
function armLoop(level){
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, worktree_path:wt,
    level, denylist:['**/.env'], oracle_globs:[] }));
  return { repo, wt, rd };
}
test('bails (allows) when no .seeks', () => assert.equal(run(makeTempRepo(), { tool_name:'Edit', tool_input:{ file_path:'/x' } }), ''));
test('L1 denies a source edit with a reason', () => {
  const { wt } = armLoop('L1');
  const out = JSON.parse(run(wt, { tool_name:'Edit', tool_input:{ file_path: path.join(wt,'src','a.js') } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /report-only/);
});
test('L2 allows a source edit (no output)', () => {
  const { wt } = armLoop('L2');
  assert.equal(run(wt, { tool_name:'Edit', tool_input:{ file_path: path.join(wt,'src','a.js') } }), '');
});
test('denies a direct status.json write', () => {
  const { wt, rd } = armLoop('L2');
  const out = JSON.parse(run(wt, { tool_name:'Write', tool_input:{ file_path: path.join(rd,'status.json') } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});
test('fail-open (exit 0, no throw) on a corrupt status.json (M3)', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), '{ not valid json');   // readStatus throws after retries
  assert.equal(run(wt, { tool_name:'Edit', tool_input:{ file_path: path.join(wt,'src','a.js') } }), '');  // must exit 0 with no deny
});
test('denies edits once past the time budget', () => {
  const { wt, rd } = armLoop('L2');
  const s = JSON.parse(fs.readFileSync(path.join(rd,'status.json'),'utf8'));
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ ...s, started_at: 1000, time_budget_sec: 1 })); // deadline far in the past
  const out = JSON.parse(run(wt, { tool_name:'Edit', tool_input:{ file_path: path.join(wt,'src','a.js') } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /time budget/);
});
test('past deadline: wrap-up actions are allowed, other work denied', () => {
  const { wt, rd } = armLoop('L2');
  const s = JSON.parse(fs.readFileSync(path.join(rd,'status.json'),'utf8'));
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ ...s, started_at: 1000, time_budget_sec: 1 }));
  // allowed wrap-up: git commit, seeks CLI, write summary.md in the run dir
  assert.equal(run(wt, { tool_name:'Bash', tool_input:{ command:'git commit -m "wrap up"' } }), '');
  assert.equal(run(wt, { tool_name:'Bash', tool_input:{ command:'node /x/bin/seeks.mjs progress-tick ui' } }), '');
  assert.equal(run(wt, { tool_name:'Write', tool_input:{ file_path: path.join(rd,'summary.md') } }), '');
  // denied: other bash work + push
  let out = JSON.parse(run(wt, { tool_name:'Bash', tool_input:{ command:'npm test' } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny'); assert.match(out.hookSpecificOutput.permissionDecisionReason, /time budget/);
  out = JSON.parse(run(wt, { tool_name:'Bash', tool_input:{ command:'git push origin HEAD' } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});
