import { test } from 'node:test'; import assert from 'node:assert/strict';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
import { latchRelease } from '../hooks/lib/hookstate.mjs';
const HOOK = fileURLToPath(new URL('../hooks/session-restore.mjs', import.meta.url));
const run = (cwd) => execFileSync('node',[HOOK],{ input: JSON.stringify({ cwd, source:'compact' }) }).toString().trim();
test('no-op outside a loop worktree', () => assert.equal(run(makeTempRepo()), ''));
test('injects protocol + open count inside a loop worktree', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, worktree_path:wt, open_items:4 }));
  fs.writeFileSync(path.join(rd,'state.md'), '# focus: x');
  const out = JSON.parse(run(wt));
  assert.match(out.hookSpecificOutput.additionalContext, /progress-tick/i);
  assert.match(out.hookSpecificOutput.additionalContext, /open items: 4/i);
});
test('does NOT re-inject a gate-released loop (done means done)', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','dn'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','dn'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'dn', armed:true, worktree_path:wt, open_items:0 }));
  latchRelease(rd,'done',1);
  assert.equal(run(wt), '', 'a finished loop must not tell a fresh session to resume it');
});
