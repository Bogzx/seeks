import { test } from 'node:test'; import assert from 'node:assert/strict';
import path from 'node:path'; import fs from 'node:fs';
import { makeTempRepo } from './helpers.mjs';
import { primaryRoot, seeksDir, hasSeeksNearby, matchLoopByCwd } from '../hooks/lib/resolve.mjs';
import { latchRelease, resetFires } from '../hooks/lib/hookstate.mjs';
test('primaryRoot resolves from a subdir', () => {
  const repo = makeTempRepo(); const sub = path.join(repo,'a','b'); fs.mkdirSync(sub,{recursive:true});
  assert.equal(fs.realpathSync(primaryRoot(sub)), fs.realpathSync(repo));
});
test('hasSeeksNearby true under .seeks, false otherwise', () => {
  const repo = makeTempRepo(); assert.equal(hasSeeksNearby(repo), false);
  fs.mkdirSync(path.join(repo,'.seeks','run'),{recursive:true});
  assert.equal(hasSeeksNearby(path.join(repo,'.seeks')), true);
});
test('matchLoopByCwd finds armed loop containing cwd', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','ui');
  const rd = path.join(repo,'.seeks','run','ui'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'ui', armed:true, worktree_path:wt }));
  assert.equal(matchLoopByCwd(seeksDir(repo), path.join(wt,'src')).name, 'ui');
});
test('matchLoopByCwd skips a gate-released loop until reset-fires', () => {
  const repo = makeTempRepo(); const wt = path.join(repo,'.claude','worktrees','rl');
  const rd = path.join(repo,'.seeks','run','rl'); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify({ loop:'rl', armed:true, worktree_path:wt }));
  latchRelease(rd,'done',1);
  assert.equal(matchLoopByCwd(seeksDir(repo), wt), null, 'released → dormant for every hook (gate, pre-tool, restore)');
  resetFires(rd);
  assert.equal(matchLoopByCwd(seeksDir(repo), wt).name, 'rl', 'reset-fires (/seeks:start) re-activates it');
});
