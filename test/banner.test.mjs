import { test } from 'node:test'; import assert from 'node:assert/strict';
import { composeBanner } from '../hooks/lib/banner.mjs';
const s = { loop:'ui', open_items_prev:9, open_items:7, last_change:'edited Button.tsx',
  last_verdict:'REJECT (typecheck)', no_progress_count:0 };
test('continuing', () => assert.match(composeBanner(s,{action:'block',stopKind:null},12),
  /▸ ui · pass 12 · items 9→7 · edited Button.tsx · verify: REJECT \(typecheck\) · continuing/));
test('done', () => assert.match(composeBanner(s,{action:'allow',stopKind:'done'},12), /✅ done/));
test('max-iters distinct from stuck', () => {
  assert.match(composeBanner(s,{action:'allow',stopKind:'max_iters'},50), /⛔ halt: max-iters \(50\)/);
  assert.match(composeBanner({...s,no_progress_count:3},{action:'allow',stopKind:'stuck'},20), /⛔ halt: stuck \(3 no-progress\)/);
});
test('color is opt-in: default stays plain, {color:true} adds ANSI', () => {
  const plain = composeBanner(s,{action:'allow',stopKind:'done'},12);
  assert.ok(!plain.includes('\x1b['), 'default banner must be plain (no ANSI) — verified-plain channel, no regression');
  const colored = composeBanner(s,{action:'allow',stopKind:'done'},12,{color:true});
  assert.ok(colored.includes('\x1b[32m'), 'done → green');
  assert.ok(colored.includes('\x1b[0m'), 'has reset');
  assert.match(colored, /✅ done/);
  assert.match(composeBanner(s,{action:'allow',stopKind:'max_iters'},50,{color:true}), /\x1b\[31m/); // halt → red
  assert.match(composeBanner(s,{action:'block',stopKind:null},3,{color:true}), /continuing/);          // block path still works with color on
});
