import { test } from 'node:test'; import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url'; import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process'; import { makeTempRepo } from './helpers.mjs';
const CLI = fileURLToPath(new URL('../bin/seeks.mjs', import.meta.url));
const run = (repo, ...a) => execFileSync('node',[CLI,...a],{ cwd: repo }).toString().trim();
function seed(repo, name, status){ const rd = path.join(repo,'.seeks','run',name); fs.mkdirSync(rd,{recursive:true});
  fs.writeFileSync(path.join(rd,'status.json'), JSON.stringify(status)); fs.writeFileSync(path.join(rd,'backlog.md'),''); return rd; }

test('status-set merges atomically', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', open_items:5 });
  run(repo,'status-set','ui','{"open_items":3,"last_change":"x"}');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.open_items,3); assert.equal(s.loop,'ui'); assert.equal(s.last_change,'x');
});
test('condition-reject increments deeply + escalates at threshold', () => {
  const repo = makeTempRepo(); seed(repo,'ui',{ loop:'ui', condition_rejects:{ lint:2 }, condition_reject_threshold:3 });
  run(repo,'condition-reject','ui','tests');                  // tests:1, lint preserved
  let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.condition_rejects.tests,1); assert.equal(s.condition_rejects.lint,2); assert.ok(!s.needs_human);
  run(repo,'condition-reject','ui','tests'); run(repo,'condition-reject','ui','tests'); // tests:3 → escalate
  s = JSON.parse(run(repo,'status-get','ui')); assert.equal(s.condition_rejects.tests,3); assert.equal(s.needs_human,true);
});
test('progress-tick: close=reset, no-op=increment, reseed=reset', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui', open_items:2, no_progress_count:0, items_closed_total:0 });
  fs.writeFileSync(path.join(rd,'backlog.md'), '- [ ] a\n');           // 1 open ⇒ closed 1
  run(repo,'progress-tick','ui'); let s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.open_items,1); assert.equal(s.items_closed_total,1); assert.equal(s.no_progress_count,0);
  run(repo,'progress-tick','ui'); s = JSON.parse(run(repo,'status-get','ui'));  // unchanged ⇒ no progress
  assert.equal(s.no_progress_count,1);
  fs.writeFileSync(path.join(rd,'backlog.md'), '- [ ] a\n- [ ] b\n- [ ] c\n'); // reseed to 3
  run(repo,'progress-tick','ui'); s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.open_items,3); assert.equal(s.no_progress_count,0);
});
test('progress-tick: a certify (done) pass counts as progress, not stuck', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui', open_items:0, no_progress_count:2, done:true });
  // backlog empty (0 open), nothing closed, not reseeded — but done:true ⇒ progress ⇒ no_progress resets
  run(repo,'progress-tick','ui'); const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.no_progress_count,0);
});
test('--help prints usage and exits 0', () => {
  const out = run(makeTempRepo(),'--help');
  assert.match(out, /seeks <cmd> <name>/); assert.match(out, /reset-fires/); assert.match(out, /log-add/);
});
test('init prints ok and writes status', () => {
  const repo = makeTempRepo();
  const out = run(repo,'init','ui','{"loop":"ui","open_items":0}');
  assert.equal(out, 'ok');
  const s = JSON.parse(run(repo,'status-get','ui'));
  assert.equal(s.loop,'ui');
});
test('log-add appends lines to log.md (create-on-write)', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui' });
  run(repo,'log-add','ui','pass 1 — edited foo.ts');
  run(repo,'log-add','ui','pass 2 — ran verifier');
  const log = fs.readFileSync(path.join(rd,'log.md'),'utf8');
  assert.match(log, /pass 1 — edited foo\.ts/);
  assert.match(log, /pass 2 — ran verifier/);
  assert.equal(log.trim().split('\n').length, 2);
});
test('reset-fires zeroes stop_fires, keeps heartbeat', () => {
  const repo = makeTempRepo(); const rd = seed(repo,'ui',{ loop:'ui' });
  fs.writeFileSync(path.join(rd,'hook-state.json'), JSON.stringify({ stop_fires:4, last_heartbeat:123, session_id:'s' }));
  run(repo,'reset-fires','ui');
  const hs = JSON.parse(fs.readFileSync(path.join(rd,'hook-state.json'),'utf8'));
  assert.equal(hs.stop_fires,0); assert.equal(hs.last_heartbeat,123);
});
