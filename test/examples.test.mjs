import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { conditionEnv } from '../hooks/lib/verify.mjs';
// examples/add is what the README sends a stranger to. Keep it honest without spending tokens:
// the task starts red, the obvious fix turns it green, and the exact `seeks run` line its README
// prints is accepted by the CLI (as a --dry-run, which starts nothing).
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EX = path.join(ROOT, 'examples', 'add');
const CLI = path.join(ROOT, 'bin', 'seeks.mjs');
function copy(){
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-ex-')));
  fs.cpSync(EX, dir, { recursive: true });
  for (const a of [['init','-q'], ['config','user.email','t@t'], ['config','user.name','t'], ['add','-A'], ['commit','-qm','init']])
    execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  return dir;
}
// conditionEnv: the gate's own env, without the NODE_TEST_CONTEXT under which a nested node --test exits 0 on failures
const npmTest = (cwd) => spawnSync('npm test', { cwd, shell: true, encoding: 'utf8', env: conditionEnv() }).status;
const words = (s) => [...s.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2]);

test('examples/add starts red, and implementing add() turns npm test green', () => {
  const dir = copy();
  assert.notEqual(npmTest(dir), 0, 'the task must start red');
  fs.writeFileSync(path.join(dir, 'src', 'add.mjs'), 'export function add(a, b) { return a + b; }\n');
  assert.equal(npmTest(dir), 0, 'the obvious fix must turn it green');
});
test('the `seeks run` line in examples/add/README.md is accepted as written (--dry-run)', () => {
  const line = /^node ~\/seeks\/bin\/seeks\.mjs (run .*)$/m.exec(fs.readFileSync(path.join(EX, 'README.md'), 'utf8'));
  assert.ok(line, 'examples/add/README.md shows a `node ~/seeks/bin/seeks.mjs run …` line');
  const dir = copy();
  const out = JSON.parse(execFileSync(process.execPath, [CLI, ...words(line[1]), '--dry-run'], { cwd: dir, encoding: 'utf8' }));
  assert.equal(out.dry_run, true); assert.equal(out.loop, 'fix-add'); assert.equal(out.scaffold, true);
  assert.equal(out.env.SEEKS_STRICT_BASH, '1', '--strict reaches the maker');
  assert.ok(!fs.existsSync(path.join(dir, '.seeks')), 'a dry run touches nothing');
});
