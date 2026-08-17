import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('plugin.json name is seeks', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url)));
  assert.equal(m.name, 'seeks');
});
test('plugin.json carries a version, and it never drifts from package.json', () => {
  const p = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url)));
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.match(p.version ?? '', /^\d+\.\d+\.\d+/, 'plugin.json needs a version for /seeks:doctor to report the build');
  assert.equal(p.version, pkg.version, 'plugin.json and package.json versions must be bumped together');
});
test('package.json declares license + repository + engines', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.repository?.url?.includes('Bogzx/seeks'));
  assert.ok(pkg.engines?.node, 'engines.node pins the >=18 requirement the README states');
});
test('hooks.json wires Stop + SessionStart + PreToolUse', () => {
  const h = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url)));
  assert.ok(h.hooks.Stop && h.hooks.SessionStart);
  assert.ok(h.hooks.PreToolUse, 'PreToolUse must be wired');
});
