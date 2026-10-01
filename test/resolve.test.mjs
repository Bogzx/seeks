import { test } from 'node:test'; import assert from 'node:assert/strict';
import path from 'node:path'; import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { makeTempRepo } from './helpers.mjs';
import { primaryRoot, seeksDir, hasSeeksNearby, matchLoopByCwd, gitCommonDir } from '../hooks/lib/resolve.mjs';
import { latchRelease, resetFires } from '../hooks/lib/hookstate.mjs';
test('primaryRoot resolves from a subdir', () => {
  const repo = makeTempRepo(); const sub = path.join(repo,'a','b'); fs.mkdirSync(sub,{recursive:true});
  assert.equal(fs.realpathSync.native(primaryRoot(sub)), fs.realpathSync.native(repo));
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

test('primaryRoot from a linked worktree is the main checkout, and gitCommonDir is absolute', () => {
  const repo = makeTempRepo(); fs.writeFileSync(path.join(repo,'a'),'x'); execFileSync('git',['-C',repo,'add','-A']); execFileSync('git',['-C',repo,'commit','-qm','i']);
  execFileSync('git',['-C',repo,'worktree','add','-q',path.join('.claude','worktrees','ui'),'-b','seeks/ui']);
  const wt = path.join(repo,'.claude','worktrees','ui'); fs.mkdirSync(path.join(wt,'src'));
  assert.equal(fs.realpathSync.native(primaryRoot(path.join(wt,'src'))), fs.realpathSync.native(repo));
  assert.ok(path.isAbsolute(gitCommonDir(path.join(repo,'a','..'))));
  assert.equal(primaryRoot(path.dirname(repo)), null, 'outside any repo');
});
// git < 2.31 doesn't know `rev-parse --path-format=absolute`: it prints the flag back and exits 0.
// That used to be the root every hook resolved, so on Ubuntu 20.04 / Debian 11 no hook found its
// loop and all of them allowed everything. A `git` on PATH that behaves that way must not matter.
test('primaryRoot works with a git that echoes unknown rev-parse flags (git < 2.31)', { skip: process.platform === 'win32' && 'POSIX shim' }, () => {
  const repo = makeTempRepo(); const sub = path.join(repo,'a','b'); fs.mkdirSync(sub,{recursive:true});
  const realGit = execFileSync('sh',['-c','command -v git'],{ encoding:'utf8' }).trim();
  const shim = fs.mkdtempSync(path.join(path.dirname(repo),'oldgit-'));
  fs.writeFileSync(path.join(shim,'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--path-format=absolute" ] && echo "$a"; done\n`
    + `args=""; for a in "$@"; do [ "$a" = "--path-format=absolute" ] || args="$args '$a'"; done\neval exec "${realGit}" $args\n`, { mode: 0o755 });
  const RES = fileURLToPath(new URL('../hooks/lib/resolve.mjs', import.meta.url));
  const got = execFileSync(process.execPath, ['--input-type=module','-e',
    `const { primaryRoot } = await import(${JSON.stringify('file://' + RES)}); process.stdout.write(String(primaryRoot(${JSON.stringify(sub)})));`],
    { encoding:'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}` } });
  assert.equal(fs.realpathSync.native(got), fs.realpathSync.native(repo));
});
