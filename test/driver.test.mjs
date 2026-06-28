import { test } from 'node:test'; import assert from 'node:assert/strict';
import { buildArgs, parseStream } from './e2e/driver.mjs';

test('buildArgs has the headless-loop flags', () => {
  const a = buildArgs({ prompt:'go', pluginDir:'/p', maxTurns:200, sessionId:'sid', model:'sonnet' });
  const s = a.join(' ');
  assert.ok(a.includes('-p') && a.includes('go'));
  assert.match(s, /--plugin-dir \/p/); assert.match(s, /--permission-mode bypassPermissions/);
  assert.match(s, /--output-format stream-json/); assert.match(s, /--include-hook-events/);
  assert.match(s, /--max-turns 200/); assert.match(s, /--session-id sid/); assert.match(s, /--model sonnet/);
});
test('buildArgs omits optional flags when absent', () => {
  const s = buildArgs({ prompt:'go', pluginDir:'/p' }).join(' ');
  assert.ok(!s.includes('--max-turns')); assert.ok(!s.includes('--session-id'));
  assert.ok(!s.includes('--model')); assert.ok(!s.includes('--max-budget-usd'));
});
test('parseStream extracts banners, terminal, result', () => {
  const stream = [
    JSON.stringify({ type:'system', subtype:'init' }),
    JSON.stringify({ type:'system', systemMessage:'▸ e2e · pass 1 · items 3→2 · edited a.js · continuing' }),
    JSON.stringify({ type:'system', systemMessage:'▸ e2e · pass 2 · ✅ done' }),
    JSON.stringify({ type:'result', is_error:false, result:'ok' }),
    'not json — ignored',
  ].join('\n');
  const r = parseStream(stream);
  assert.equal(r.banners.length, 2);
  assert.match(r.banners[0], /pass 1 · items 3→2/);
  assert.match(r.terminal, /✅ done/);
  assert.equal(r.result.is_error, false);
});
test('parseStream: no banners/terminal/result on empty stream', () => {
  const r = parseStream('');
  assert.deepEqual(r.banners, []); assert.equal(r.terminal, null); assert.equal(r.result, null);
});
