import { test } from 'node:test'; import assert from 'node:assert/strict';
import { oracleChanged, oracleView, manifestKind, PACKAGE_JSON_ORACLE_KEYS } from '../hooks/lib/manifest.mjs';
const pkg = (o) => JSON.stringify(o, null, 2);
const P = { name:'x', version:'1.0.0', type:'module', scripts:{ test:'node --test' }, dependencies:{ a:'^1.0.0' },
  devDependencies:{ jest:'^29.0.0' }, jest:{ testMatch:['**/*.test.js'] } };

test('package.json: dependency bumps, version, metadata and key order are free', () => {
  for (const after of [
    { ...P, dependencies:{ a:'^2.0.0', b:'^1.0.0' } }, { ...P, devDependencies:{ jest:'^30.0.0' } },
    { ...P, version:'1.1.0', description:'now with docs', keywords:['x'] },
    Object.fromEntries(Object.entries(P).reverse()),
  ]) assert.equal(oracleChanged('package.json', pkg(P), pkg(after)), false, JSON.stringify(after));
  assert.equal(oracleChanged('package.json', pkg(P), JSON.stringify(P)), false, 'formatting is free');
});
test('package.json: anything that decides what the tests run or how imports resolve is oracle', () => {
  for (const after of [
    { ...P, scripts:{ test:'true' } }, { ...P, scripts:{ ...P.scripts, pretest:'exit 0' } },
    { ...P, jest:{ testMatch:[] } }, { ...P, type:'commonjs' }, { ...P, imports:{ '#db':'./fake-db.js' } },
    { ...P, vitest:{ exclude:['**'] } }, { ...P, c8:{ 'check-coverage':false } }, { ...P, workspaces:['packages/*'] },
  ]) assert.equal(oracleChanged('packages/api/package.json', pkg(P), pkg(after)), true, JSON.stringify(after));
  for (const k of ['scripts','jest','vitest','mocha','ava','c8','nyc','type','workspaces']) assert.ok(PACKAGE_JSON_ORACLE_KEYS.includes(k));
});
test('package.json that stops parsing counts as changed (can\'t prove it is harmless)', () => {
  assert.equal(oracleChanged('package.json', pkg(P), pkg(P) + ' trailing'), true);
  assert.equal(oracleChanged('package.json', pkg(P), pkg({ ...P, dependencies:{} }), 'whole'), true, "'whole' mode compares bytes");
});
const PY = `[project]
name = "x"
version = "1.0"
dependencies = [
  "requests>=2",
]

[tool.pytest.ini_options]
addopts = "-q"
testpaths = [
  "tests",
]

[tool.coverage.run]
branch = true

[tool.ruff]
line-length = 100
`;
test('pyproject.toml: [project] deps and unrelated tools are free; pytest/coverage/tox/nox/hatch-env/lint tables are oracle', () => {
  assert.equal(oracleChanged('pyproject.toml', PY, PY.replace('"requests>=2",', '"requests>=2",\n  "httpx>=0.27",')), false);
  assert.equal(oracleChanged('pyproject.toml', PY, PY.replace('version = "1.0"', 'version = "1.1"')), false);
  assert.equal(oracleChanged('pyproject.toml', PY, PY.replace('line-length = 100', 'line-length = 120')), true, 'a lint config decides what `ruff check` reports (review 2026-09-30)');
  assert.equal(oracleChanged('pyproject.toml', PY, PY + '\n[tool.bumpversion]\ncurrent_version = "1.1"\n'), false, 'an unrelated tool is free');
  assert.equal(oracleChanged('pyproject.toml', PY, PY.replace('addopts = "-q"', 'addopts = "-q -k \'not slow\'"')), true);
  assert.equal(oracleChanged('pyproject.toml', PY, PY.replace('  "tests",', '  "tests/unit",')), true, 'a continuation line of a multi-line array');
  assert.equal(oracleChanged('pyproject.toml', PY, PY.replace('branch = true', 'branch = false')), true);
  assert.equal(oracleChanged('pyproject.toml', PY, PY + '\n[tool.tox]\nlegacy_tox_ini = """\n[testenv]\ncommands = pytest\n"""\n'), true);
  assert.equal(oracleChanged('pyproject.toml', PY, PY + '\n[tool]\npytest.ini_options.addopts = "-x"\n'), true, 'a dotted key reaching into tool.pytest');
  assert.equal(oracleChanged('pyproject.toml', PY, PY + '\n[[tool.hatch.envs.test.matrix]]\npython = ["3.12"]\n'), true);
  assert.match(oracleView('pyproject.toml', PY), /\[tool\.pytest\.ini_options\]/); assert.doesNotMatch(oracleView('pyproject.toml', PY), /requests/);
});
test('setup.cfg: [metadata]/[options] free; [tool:pytest], [coverage:*], [tox:*], [aliases] are oracle', () => {
  const CFG = '[metadata]\nname = x\nversion = 1.0\n\n[options]\ninstall_requires =\n    requests\n\n[tool:pytest]\naddopts = -q\n\n[coverage:run]\nbranch = True\n';
  assert.equal(oracleChanged('setup.cfg', CFG, CFG.replace('version = 1.0', 'version = 2.0').replace('    requests', '    requests\n    httpx')), false);
  assert.equal(oracleChanged('setup.cfg', CFG, CFG.replace('addopts = -q', 'addopts = -q --deselect tests/test_hard.py')), true);
  assert.equal(oracleChanged('setup.cfg', CFG, CFG.replace('branch = True', 'branch = False')), true);
});
test('other oracle files are compared whole', () => {
  assert.equal(manifestKind('Makefile'), null); assert.equal(manifestKind('a/b/package.json'), 'package.json');
  assert.equal(oracleChanged('Makefile', 'test:\n\tnpm test\n', 'test:\n\ttrue\n'), true);
  assert.equal(oracleChanged('tox.ini', 'a', 'a'), false);
});
// ─── review 2026-09-30: dependency-shaped edits that swap what the runner is ──────────
test('package.json: overrides/resolutions/pnpm patches, babel, config and a redirected dependency are oracle', () => {
  for (const after of [
    { ...P, overrides:{ expect:'npm:always-pass@1' } }, { ...P, resolutions:{ 'jest-circus':'file:./fake' } },
    { ...P, pnpm:{ patchedDependencies:{ 'expect@29.7.0':'patches/expect.patch' } } },
    { ...P, babel:{ plugins:['./strip-asserts'] } }, { ...P, config:{ pattern:'none' } },
    { ...P, devDependencies:{ jest:'npm:not-jest@1' } }, { ...P, devDependencies:{ jest:'file:./fakejest' } },
    { ...P, devDependencies:{ jest:'github:someone/jest' } }, { ...P, devDependencies:{ jest:'someone/jest#main' } },
    { ...P, dependencies:{ a:'^1.0.0', b:'link:../b' } },
  ]) assert.equal(oracleChanged('package.json', pkg(P), pkg(after)), true, JSON.stringify(after));
  for (const after of [{ ...P, devDependencies:{ jest:'^29.7.0' } }, { ...P, dependencies:{ a:'~1.2.0', b:'workspace:*', c:'latest' } }])
    assert.equal(oracleChanged('package.json', pkg(P), pkg(after)), false, `still free: ${JSON.stringify(after)}`);
});
test('pyproject/setup.cfg: the type-checker and linter configs are oracle (a `mypy` clean check reads them)', () => {
  const py = '[project]\nname="x"\n[tool.mypy]\nstrict = true\n[tool.ruff]\nselect = ["E"]\n';
  for (const after of [py.replace('strict = true', 'ignore_errors = true'), py.replace('select = ["E"]', 'select = []'),
    py + '[tool.pdm.scripts]\ntest = "true"\n', py + '[project.entry-points."pytest11"]\nfake = "fakeplugin"\n', py + '[tool.pyright]\ntypeCheckingMode = "off"\n'])
    assert.equal(oracleChanged('pyproject.toml', py, after), true, after);
  assert.equal(oracleChanged('pyproject.toml', py, py.replace('name="x"', 'name="x"\ndependencies = ["requests>=2"]')), false, 'dependencies stay free');
  assert.equal(oracleChanged('setup.cfg', '[mypy]\nstrict=True\n', '[mypy]\nignore_errors=True\n'), true);
  assert.equal(oracleChanged('setup.cfg', '[flake8]\nmax-line-length=88\n', '[flake8]\nextend-ignore=E,W,F\n'), true);
  assert.equal(oracleChanged('setup.cfg', '[metadata]\nname=x\n', '[metadata]\nname=y\n'), false);
});
