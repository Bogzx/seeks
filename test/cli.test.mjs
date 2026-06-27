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
