import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { makeTempRepo } from './helpers.mjs';
import { oracleDiffHash, oracleGlobsPresent, DEFAULT_ORACLE_GLOBS, porcelainPath } from '../hooks/lib/oracle.mjs';
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
test('porcelainPath splits rename/copy on the status code, not a literal " -> " in a path (3.9)', () => {
  assert.equal(porcelainPath('R  old.test.js -> new.test.js'), 'new.test.js');       // rename → new name
  assert.equal(porcelainPath('C  a.test.js -> b.test.js'), 'b.test.js');             // copy → new name
  assert.equal(porcelainPath(' M weird -> name.test.js'), 'weird -> name.test.js');  // modified path containing " -> " → preserved (was mis-split)
  assert.equal(porcelainPath('?? untracked.test.js'), 'untracked.test.js');          // untracked → as-is
  assert.equal(porcelainPath('R  x.js -> a -> b.js'), 'a -> b.js');                   // rename target containing " -> " kept whole (first arrow only)
  assert.equal(porcelainPath(''), '');                                                // blank line → empty
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
test('oracleGlobsPresent counts files matching the globs in the worktree', () => {
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'),'1\n');
  fs.writeFileSync(path.join(repo,'src.js'),'x\n');
  commitAll(repo,'init');
  assert.equal(oracleGlobsPresent(repo), 1);                 // the committed test file
  assert.equal(oracleGlobsPresent(repo, ['nope/**']), 0);    // vacuous — nothing matches
  fs.writeFileSync(path.join(repo,'test','b.test.js'),'2\n');
  assert.equal(oracleGlobsPresent(repo), 2);                 // untracked test file also counts
});

// ─── pre-existing oracle files (tests AND build manifests) ────────────────────────────
import { oracleModifiedPreexisting, oraclePolicy, MANIFEST_GLOBS, guardedGit } from '../hooks/lib/oracle.mjs';
import { anyGlob } from '../hooks/lib/glob.mjs';
function fixture(){
  const repo = makeTempRepo();
  fs.mkdirSync(path.join(repo,'test'),{recursive:true});
  fs.writeFileSync(path.join(repo,'test','a.test.js'), 'assert(1===1)\n');
  fs.writeFileSync(path.join(repo,'test','b.test.js'), 'assert(2===2)\n');
  fs.writeFileSync(path.join(repo,'package.json'), '{"scripts":{"test":"node --test"}}\n');
  fs.writeFileSync(path.join(repo,'src.js'), 'x\n');
  return { repo, base: commitAll(repo,'init') };
}
test('the default oracle covers the build manifests and runner configs, not just tests', () => {
  for (const f of ['package.json','packages/api/package.json','Makefile','pyproject.toml','setup.cfg','tox.ini','pytest.ini',
    'jest.config.js','vitest.config.ts','.github/workflows/ci.yml','.gitlab-ci.yml','tests/conftest.py'])
    assert.ok(anyGlob(f, DEFAULT_ORACLE_GLOBS), f);
  for (const f of ['src/index.js','README.md','package-lock.json']) assert.ok(!anyGlob(f, DEFAULT_ORACLE_GLOBS), f);
  assert.ok(MANIFEST_GLOBS.every(g => DEFAULT_ORACLE_GLOBS.includes(g)));
});
test('additions are free; modifications and deletions of pre-existing oracle files are listed', () => {
  const { repo, base } = fixture();
  assert.deepEqual(oracleModifiedPreexisting(repo, base), []);
  fs.writeFileSync(path.join(repo,'test','new.test.js'), 'assert(3===3)\n');          // added → free
  fs.writeFileSync(path.join(repo,'src.js'), 'y\n');                                     // not an oracle file
  assert.deepEqual(oracleModifiedPreexisting(repo, base), []);
  fs.writeFileSync(path.join(repo,'test','a.test.js'), 'assert(true)\n');               // relaxed assertion
  fs.rmSync(path.join(repo,'test','b.test.js'));                                         // deleted test
  fs.writeFileSync(path.join(repo,'package.json'), '{"scripts":{"test":"true"}}\n');     // the classic fake green
  assert.deepEqual(oracleModifiedPreexisting(repo, base), [
    { file:'package.json', change:'modified' }, { file:'test/a.test.js', change:'modified' }, { file:'test/b.test.js', change:'deleted' }]);
});
test('committed and renamed changes count too; a reverted edit does not', () => {
  const { repo, base } = fixture();
  git(repo,'mv','test/a.test.js','test/renamed.test.js'); commitAll(repo,'rename');
  assert.deepEqual(oracleModifiedPreexisting(repo, base), [{ file:'test/a.test.js', change:'deleted' }], 'a rename drops the original');
  git(repo,'mv','test/renamed.test.js','test/a.test.js'); commitAll(repo,'rename back');
  assert.deepEqual(oracleModifiedPreexisting(repo, base), []);
});
test('no base → unknown (null), and the policy defaults to needs_human', () => {
  const { repo } = fixture();
  assert.equal(oracleModifiedPreexisting(repo, null), null);
  assert.equal(oraclePolicy({}), 'needs_human'); assert.equal(oraclePolicy({ oracle_modified_policy:'ack' }), 'ack');
  assert.equal(oraclePolicy({ oracle_modified_policy:'bogus' }), 'needs_human', 'an unknown value is the safe default');
});
test('a dependency bump in package.json is NOT a modified oracle; a scripts change is; whole mode restores bytes', () => {
  const { repo, base } = fixture();                                                  // package.json: {"scripts":{"test":"node --test"}}
  fs.writeFileSync(path.join(repo,'package.json'), JSON.stringify({ scripts:{ test:'node --test' }, dependencies:{ lodash:'^4.17.21' } }, null, 2));
  assert.deepEqual(oracleModifiedPreexisting(repo, base), [], 'adding a dependency is free');
  assert.deepEqual(oracleModifiedPreexisting(repo, base, undefined, { manifestDiff:'whole' }), [{ file:'package.json', change:'modified' }]);
  fs.writeFileSync(path.join(repo,'package.json'), JSON.stringify({ scripts:{ test:'true' }, dependencies:{ lodash:'^4.17.21' } }));
  assert.deepEqual(oracleModifiedPreexisting(repo, base), [{ file:'package.json', change:'modified' }]);
});
// ─── review 2026-09-30 ────────────────────────────────────────────────────────────────
test('a NEW config-type oracle file counts (it can change what passes); a new test file stays free', () => {
  const { repo, base } = fixture();
  fs.writeFileSync(path.join(repo,'test','new.test.js'), 'assert(3===3)\n');
  assert.deepEqual(oracleModifiedPreexisting(repo, base), []);
  fs.writeFileSync(path.join(repo,'pytest.ini'), '[pytest]\naddopts = --collect-only\n');
  fs.writeFileSync(path.join(repo,'conftest.py'), 'collect_ignore_glob = ["*"]\n');
  fs.writeFileSync(path.join(repo,'.npmrc'), 'script-shell=/bin/true\n');
  fs.writeFileSync(path.join(repo,'.gitignore'), '.npmrc\nnode_modules/\n');           // ignored does not hide it
  fs.mkdirSync(path.join(repo,'node_modules','x'),{recursive:true}); fs.writeFileSync(path.join(repo,'node_modules','x','package.json'),'{}');
  assert.deepEqual(oracleModifiedPreexisting(repo, base).map(o => `${o.file} ${o.change}`),
    ['.npmrc added', 'conftest.py added', 'pytest.ini added'], 'an ignored node_modules/ is not walked');
  for (const f of ['.npmrc','.yarnrc.yml','tsconfig.json','mypy.ini','.eslintrc.json','eslint.config.js','babel.config.js','.gitattributes'])
    assert.ok(anyGlob(f, DEFAULT_ORACLE_GLOBS), f);
});
test('assume-unchanged and skip-worktree do not hide an edited oracle file', () => {
  const { repo, base } = fixture();
  fs.writeFileSync(path.join(repo,'test','a.test.js'), 'assert(true)\n'); git(repo,'update-index','--assume-unchanged','test/a.test.js');
  git(repo,'update-index','--skip-worktree','test/b.test.js'); fs.rmSync(path.join(repo,'test','b.test.js'));
  assert.equal(git(repo,'status','--porcelain').trim(), '', 'precondition: git status sees nothing');
  assert.deepEqual(oracleModifiedPreexisting(repo, base), [{ file:'test/a.test.js', change:'modified' }, { file:'test/b.test.js', change:'deleted' }]);
  assert.deepEqual(oracleDiffHash(repo, base).files, ['test/a.test.js', 'test/b.test.js'], 'and the advisory ack hash covers them too');
});

// git < 2.31 ignores GIT_CONFIG_COUNT, so a filter the maker configured stayed in force there and a
// relaxed test passed as unchanged. configEnv:false is that git: only the `-c` route is used.
test('a clean filter is blanked without GIT_CONFIG_COUNT too (git < 2.31): the -c route alone catches the edit', () => {
  const { repo, base } = fixture();
  git(repo,'config','filter.x.clean',`git show ${base}:%f`);
  fs.appendFileSync(path.join(repo,'.git','info','attributes'), 'test/* filter=x\n');
  fs.writeFileSync(path.join(repo,'test','a.test.js'), 'process.exit(0)\n');
  assert.equal(git(repo,'hash-object','test/a.test.js').trim(), git(repo,'rev-parse',`${base}:test/a.test.js`).trim(), 'precondition: through the filter the edit hashes as the base blob');
  const g = guardedGit(repo, { configEnv:false });
  assert.ok(g.args.includes('filter.x.clean='), 'the driver is blanked on the command line');
  assert.equal(g.env.GIT_CONFIG_COUNT, undefined);
  assert.deepEqual(oracleModifiedPreexisting(repo, base, undefined, { configEnv:false }), [{ file:'test/a.test.js', change:'modified' }]);
});
test('a filter driver whose name holds "=" can\'t be blanked with -c: on git < 2.31 that fails closed', () => {
  const { repo, base } = fixture();
  git(repo,'config','filter.a=b.clean','cat');
  assert.deepEqual(guardedGit(repo, { configEnv:false }).unguarded, ['filter.a=b.clean']);
  assert.deepEqual(guardedGit(repo, { configEnv:true }).unguarded, [], 'GIT_CONFIG_KEY_n carries any key');
  assert.deepEqual(oracleModifiedPreexisting(repo, base, undefined, { configEnv:false }),
    [{ file:'git config filter.a=b.clean', change:'filter git < 2.31 cannot bypass' }]);
  assert.deepEqual(oracleModifiedPreexisting(repo, base, undefined, { configEnv:true }), []);
});
