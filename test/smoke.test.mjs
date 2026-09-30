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
test('hooks.json wires Stop + SessionStart + PreToolUse + UserPromptSubmit', () => {
  const h = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url)));
  assert.ok(h.hooks.Stop && h.hooks.SessionStart);
  assert.ok(h.hooks.PreToolUse, 'PreToolUse must be wired');
  assert.ok(h.hooks.UserPromptSubmit, 'UserPromptSubmit mints the user\'s grant for /seeks:start|stop|delete');
  assert.ok(h.hooks.Stop[0].hooks[0].timeout >= 600, 'the Stop hook runs the done-conditions: it needs more than the default timeout');
});
test('every command doc has frontmatter, and /seeks:why is shipped', () => {
  const dir = new URL('../commands/', import.meta.url);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  assert.ok(files.includes('why.md'), '/seeks:why must ship with the plugin');
  for (const f of files){
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.match(src, /^---\r?\ndescription: /, `${f} needs a description in its frontmatter`);   // \r?: the repo checks out CRLF on win32
  }
});
test('the repo carries the community-health files a public plugin needs', () => {
  const root = new URL('../', import.meta.url);
  for (const f of ['LICENSE','CONTRIBUTING.md','SECURITY.md','.github/ISSUE_TEMPLATE/bug_report.yml'])
    assert.ok(fs.existsSync(new URL(f, root)), `${f} is missing`);
  // the whole point of the bug template is that it asks for the export bundle
  const bug = fs.readFileSync(new URL('.github/ISSUE_TEMPLATE/bug_report.yml', root), 'utf8');
  assert.match(bug, /\/seeks:export/, 'the bug template must ask for /seeks:export output');
  assert.match(bug, /\/seeks:why/, 'the bug template must ask for /seeks:why output');
});
test('the README ships small enough to render — the logo is not a megabyte', () => {
  const png = fs.statSync(new URL('../assets/seeks.png', import.meta.url));
  assert.ok(png.size < 120_000, `assets/seeks.png is ${png.size} bytes; it renders at 240px wide`);
});
test('CI tests every Node major that package.json engines promises, and pins actions by SHA', () => {
  const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  const min = Number(/>=\s*(\d+)/.exec(pkg.engines.node)[1]);
  const matrix = (/node: \[([^\]]+)\]/.exec(ci)[1].match(/\d+/g) || []).map(Number);
  assert.equal(Math.min(...matrix), min, `engines says >=${min}; CI's oldest leg is ${Math.min(...matrix)}`);
  for (const m of ci.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} is not pinned by commit SHA`);
});
