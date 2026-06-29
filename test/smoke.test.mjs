import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('plugin.json name is seeks', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url)));
  assert.equal(m.name, 'seeks');
});
test('hooks.json wires Stop + SessionStart + PreToolUse', () => {
  const h = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url)));
  assert.ok(h.hooks.Stop && h.hooks.SessionStart);
  assert.ok(h.hooks.PreToolUse, 'PreToolUse must be wired');
});
