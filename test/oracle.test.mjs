import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { makeTempRepo } from './helpers.mjs';
import { oracleDiffHash, DEFAULT_ORACLE_GLOBS } from '../hooks/lib/oracle.mjs';
const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding:'utf8' });
function commitAll(repo, msg){ git(repo,'add','-A'); git(repo,'commit','-q','-m',msg); return git(repo,'rev-parse','HEAD').trim(); }

test('detects a changed oracle file; content change moves the hash', () => {
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'), 'assert(1===1)\n');
  fs.writeFileSync(path.join(repo,'src.js'), 'x\n');
  const base = commitAll(repo,'init');
  // no change yet → empty set, stable hash
  const empty = oracleDiffHash(repo, base);
  assert.deepEqual(empty.files, []);
  // change the test file (working tree)
  fs.writeFileSync(path.join(repo,'test','a.test.js'), 'assert(1===2)\n');
  const r1 = oracleDiffHash(repo, base);
  assert.deepEqual(r1.files, ['test/a.test.js']);
  assert.notEqual(r1.hash, empty.hash);
  // a different content change → different hash again
  fs.writeFileSync(path.join(repo,'test','a.test.js'), 'assert(2===2)\n');
  const r2 = oracleDiffHash(repo, base);
  assert.notEqual(r2.hash, r1.hash);
});
test('globs filter: a non-oracle change is ignored', () => {
  const repo = makeTempRepo();
  fs.writeFileSync(path.join(repo,'src.js'), 'x\n'); const base = commitAll(repo,'init');
  fs.writeFileSync(path.join(repo,'src.js'), 'y\n');
  assert.deepEqual(oracleDiffHash(repo, base).files, []);
});
test('empty-set hash is stable across repos', () => {
  const a = makeTempRepo(); const b = makeTempRepo();
  fs.writeFileSync(path.join(a,'f'),'1'); fs.writeFileSync(path.join(b,'f'),'2');
  const ba = commitAll(a,'i'); const bb = commitAll(b,'i');
  assert.equal(oracleDiffHash(a, ba).hash, oracleDiffHash(b, bb).hash);
});
