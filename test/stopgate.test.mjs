import { test } from 'node:test'; import assert from 'node:assert/strict';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
const HOOK = fileURLToPath(new URL('../hooks/stop-gate.mjs', import.meta.url));
const run = (cwd) => execFileSync('node',[HOOK],{ input: JSON.stringify({ cwd, session_id:'s1' }) }).toString().trim();
test('bails when no .seeks', () => assert.equal(run(makeTempRepo()), ''));
test('blocks for an armed loop containing cwd', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(wt,{recursive:true});
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, done:false, worktree_path:wt,
    open_items:2, max_iters:50, stuck_threshold:3, no_progress_count:0 }));
  const out = JSON.parse(run(wt));
  assert.equal(out.decision, 'block');
  assert.match(out.systemMessage, /pass 1 · .* continuing/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rd,'hook-state.json'))).stop_fires, 1);
});
