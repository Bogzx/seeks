import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { makeTempRepo } from './helpers.mjs';
import { isGithubRemote, deliveryMode, deliver } from '../hooks/lib/deliver.mjs';

test('isGithubRemote', () => {
  assert.equal(isGithubRemote('git@github.com:o/r.git'), true);
  assert.equal(isGithubRemote('https://github.com/o/r.git'), true);
  assert.equal(isGithubRemote('https://gitlab.com/o/r.git'), false);
  assert.equal(isGithubRemote(''), false);
});
test('deliveryMode matrix', () => {
  assert.equal(deliveryMode({hasRemote:true, isGithub:true, hasGh:true}), 'pr');
  assert.equal(deliveryMode({hasRemote:true, isGithub:true, hasGh:false}), 'push');
  assert.equal(deliveryMode({hasRemote:true, isGithub:false, hasGh:true}), 'push');
  assert.equal(deliveryMode({hasRemote:false, isGithub:false, hasGh:false}), 'local');
});
test('deliver: no remote → local mode', () => {
  const repo = makeTempRepo();
  fs.writeFileSync(path.join(repo,'a'),'1'); execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  execFileSync('git',['branch','seeks/x'],{cwd:repo});
  const r = deliver('x', { root: repo, branch:'seeks/x', base_ref:'HEAD' });
  assert.equal(r.mode, 'local');
});
test('deliver: local bare remote (non-github) → push mode, branch lands on remote', () => {
  const repo = makeTempRepo();
  fs.writeFileSync(path.join(repo,'a'),'1'); execFileSync('git',['add','-A'],{cwd:repo}); execFileSync('git',['commit','-q','-m','i'],{cwd:repo});
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'seeks-bare-')));
  execFileSync('git',['init','--bare','-q',bare]);
  execFileSync('git',['remote','add','origin',bare],{cwd:repo});
  execFileSync('git',['branch','seeks/x'],{cwd:repo});
  const r = deliver('x', { root: repo, branch:'seeks/x', base_ref:'HEAD' });
  assert.equal(r.mode, 'push');
  assert.match(execFileSync('git',['-C',bare,'branch','--list','seeks/x'],{encoding:'utf8'}), /seeks\/x/);
});
