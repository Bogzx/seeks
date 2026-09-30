// A hook whose lib fails to IMPORT used to exit 1 before its try/catch: fail-open, but with no
// crash row, so "allowed" and "enforcement was off" looked identical (review 2026-09-30).
// Each entrypoint now loads its libs inside the try; these break a lib in a copy of the plugin.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { makeTempRepo } from './helpers.mjs';
const HOOKS = fileURLToPath(new URL('../hooks', import.meta.url));
function brokenPlugin(lib){                                           // a copy of hooks/ with one lib that throws on import
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-broken-'));
  fs.cpSync(HOOKS, path.join(root, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hooks', 'lib', lib), "throw new Error('boom: broken lib');\n");
  return root;
}
function project(){
  const repo = makeTempRepo(); fs.mkdirSync(path.join(repo, '.seeks', 'run'), { recursive: true });
  const wt = path.join(repo, '.claude', 'worktrees', 'ui'); fs.mkdirSync(wt, { recursive: true });
  return { repo, wt };
}
const run = (root, hook, payload) => spawnSync('node', [path.join(root, 'hooks', `${hook}.mjs`)], { input: JSON.stringify(payload), encoding: 'utf8' });
const crashRows = (repo) => { try { return fs.readFileSync(path.join(repo, '.seeks', 'decisions.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.action === 'crash'); } catch { return []; } };
const PAYLOAD = { 'pre-tool': { tool_name: 'Bash', tool_input: { command: 'echo hi' } }, 'stop-gate': {}, 'user-prompt': { prompt: '/seeks:stop ui' }, 'session-restore': {} };

for (const [lib, why, hooks] of [['resolve.mjs', 'a lib every hook imports', Object.keys(PAYLOAD)],
  ['decisions.mjs', 'the logger itself: the builtins-only fallback writes the row', ['pre-tool', 'stop-gate', 'user-prompt']],
  ['verify.mjs', 'the stop gate\'s condition runner', ['stop-gate']], ['policy.mjs', 'the pre-tool policy', ['pre-tool']]]){
  test(`a throwing import of ${lib} is logged as a hook crash, and the hook still fails open (${why})`, () => {
    const root = brokenPlugin(lib);
    for (const hook of hooks){ const extra = PAYLOAD[hook];
      const { repo, wt } = project();
      const r = run(root, hook, { cwd: wt, session_id: 's1', ...extra });
      assert.equal(r.status, 0, `${hook} must exit 0 (fail-open): ${r.stderr}`);
      assert.equal(r.stdout, '', `${hook} must not emit a verdict`);
      const rows = crashRows(repo);
      assert.equal(rows.length, 1, `${hook}: one crash row in .seeks/decisions.jsonl`);
      assert.equal(rows[0].hook, hook); assert.equal(rows[0].rule, 'hook-crash'); assert.match(rows[0].error, /boom: broken lib/);
    }
  });
}
test('outside a seeks project a broken import writes nothing anywhere', () => {
  const root = brokenPlugin('resolve.mjs'); const dir = makeTempRepo();
  const r = run(root, 'pre-tool', { cwd: dir, tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(r.status, 0); assert.ok(!fs.existsSync(path.join(dir, '.seeks')));
});
