import { test } from 'node:test'; import assert from 'node:assert/strict';
import { composeBanner } from '../hooks/lib/banner.mjs';
const s = { loop:'ui', open_items_prev:9, open_items:7, last_change:'edited Button.tsx',
  last_verdict:'REJECT (typecheck)', no_progress_count:0 };
test('continuing', () => assert.match(composeBanner(s,{action:'block',stopKind:null},12),
  /▸ ui · pass 12 · items 9→7 · edited Button.tsx · verify: REJECT \(typecheck\) · continuing/));
test('done', () => assert.match(composeBanner(s,{action:'allow',stopKind:'done'},12), /✅ done/));
test('done banner shows the L3 delivery outcome', () => {
  assert.match(composeBanner({...s, delivery_mode:'pr', pr_url:'https://h/pr/5'}, {action:'allow',stopKind:'done'}, 9), /✅ done · PR https:\/\/h\/pr\/5/);
  assert.match(composeBanner({...s, delivery_mode:'push'}, {action:'allow',stopKind:'done'}, 9), /✅ done · pushed \(no PR\)/);
  assert.match(composeBanner({...s, delivery_mode:'local'}, {action:'allow',stopKind:'done'}, 9), /branch kept local/);
  assert.ok(!composeBanner(s, {action:'allow',stopKind:'done'}, 9).includes('PR ')); // non-L3 → plain done
});
test('max-iters distinct from stuck', () => {
  assert.match(composeBanner(s,{action:'allow',stopKind:'max_iters'},50), /⛔ halt: max-iters \(50\)/);
  assert.match(composeBanner({...s,no_progress_count:3},{action:'allow',stopKind:'stuck'},20), /⛔ halt: stuck \(3 no-progress\)/);
});
test('time-budget halt renders a clock banner', () => {
  const out = composeBanner({ loop:'x' }, { action:'allow', stopKind:'time-budget' }, 7);
  assert.match(out, /⏰ halt: time budget/);
  assert.match(out, /pass 7/);
});
test('time-budget banner shows a findings/state summary tail', () => {
  const out = composeBanner({ loop:'x', sweep_found_total:5, open_items:3, depth:2 },
    { action:'allow', stopKind:'time-budget' }, 9);
  assert.match(out, /⏰ halt: time budget/);
  assert.match(out, /5 found/); assert.match(out, /3 open/); assert.match(out, /depth 2/);
});
test('continuing banner shows time remaining when a budget is set', () => {
  const s = { loop:'x', open_items_prev:3, open_items:2, last_change:'edited a.ts', started_at:0, time_budget_sec:3600 };
  const out = composeBanner(s, { action:'block', stopKind:null }, 4, { now: 600000 }); // 10m in, 50m left
  assert.match(out, /50m left/);
  const noBudget = composeBanner({ loop:'x', open_items:2 }, { action:'block', stopKind:null }, 4, { now: 600000 });
  assert.ok(!noBudget.includes('left'));
});
test('banner shows oracle segment when changes are present', () => {
  assert.match(composeBanner({ ...s, oracle_changed_count: 2 }, { action:'block', stopKind:null }, 5), /oracle: 2 changed/);
  assert.ok(!composeBanner(s, { action:'block', stopKind:null }, 5).includes('oracle:'));
});
test('banner shows sweep segment only when min_dry_sweeps set', () => {
  assert.match(composeBanner({...s, min_dry_sweeps:2, dry_sweeps:1},{action:'block',stopKind:null},14), /sweep 1\/2 dry/);
  assert.ok(!composeBanner(s,{action:'block',stopKind:null},14).includes('sweep'));
});
test('banner sweep segment shows the active (last-used) lens', () => {
  assert.match(composeBanner({...s, min_dry_sweeps:2, dry_sweeps:1, lenses_used:['concurrency','boundary']},
    {action:'block',stopKind:null},14), /sweep 1\/2 dry \(lens: boundary\)/);
  const noLens = composeBanner({...s, min_dry_sweeps:2, dry_sweeps:1},{action:'block',stopKind:null},14);
  assert.match(noLens, /sweep 1\/2 dry/); assert.ok(!noLens.includes('lens:'));
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
