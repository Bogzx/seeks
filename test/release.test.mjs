import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { checkBump, isRuntime } from '../scripts/check-version-bump.mjs';
test('a PR that changes what the plugin runs must bump the version; docs and tests need not', () => {
  for (const f of ['hooks/lib/policy.mjs', 'bin/seeks.mjs', 'skills/loop/SKILL.md', 'commands/new.md', '.claude-plugin/plugin.json']) assert.ok(isRuntime(f), f);
  for (const f of ['README.md', 'test/policy.test.mjs', 'examples/demo.mjs', '.github/workflows/ci.yml', '.claude-plugin/marketplace.json', 'binder/x']) assert.ok(!isRuntime(f), f);
  assert.equal(checkBump({ changed: ['README.md'], baseVersion: '0.2.0', headVersion: '0.2.0' }).ok, true);
  assert.equal(checkBump({ changed: ['hooks/lib/policy.mjs'], baseVersion: '0.2.0', headVersion: '0.2.1' }).ok, true);
  const r = checkBump({ changed: ['hooks/lib/policy.mjs', 'README.md'], baseVersion: '0.2.0', headVersion: '0.2.0' });
  assert.equal(r.ok, false); assert.deepEqual(r.runtime, ['hooks/lib/policy.mjs']); assert.match(r.message, /still 0\.2\.0/);
});
test('the CHANGELOG has an entry for the version plugin.json ships', () => {
  const v = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url))).version;
  const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(log, new RegExp(`^## ${v.replace(/\./g, '\\.')}\\b`, 'm'), `CHANGELOG.md needs a "## ${v}" section`);
});
test('package.json exposes the CLI as `seeks`, and the script runs under env node', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.bin?.seeks, 'bin/seeks.mjs');
  assert.match(fs.readFileSync(new URL('../bin/seeks.mjs', import.meta.url), 'utf8'), /^#!\/usr\/bin\/env node\r?\n/);
});
