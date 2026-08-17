import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { appendDecision, readDecisions, decisionsPath, summarizeInput, formatDecisions, summarizeDecisions } from '../hooks/lib/decisions.mjs';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-dec-'));

test('appendDecision writes one JSON line per call, newest last', () => {
  const rd = tmp();
  appendDecision(rd, { hook:'pre-tool', tool:'Bash', action:'allow' });
  appendDecision(rd, { hook:'pre-tool', tool:'Bash', action:'deny', rule:'git-push' });
  const lines = fs.readFileSync(decisionsPath(rd),'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).rule, 'git-push');
  assert.match(JSON.parse(lines[0]).ts, /^\d{4}-\d{2}-\d{2}T/);   // every record is timestamped
});
test('appendDecision never throws, whatever it is handed', () => {
  assert.equal(appendDecision(null, { a:1 }), false);                       // no run dir yet (a crash before resolution)
  assert.equal(appendDecision(path.join(tmp(),'nope','deeper'), { a:1 }), false);   // unwritable path
  const rd = tmp(); const circular = {}; circular.self = circular;
  assert.equal(appendDecision(rd, { hook:'x', bad: circular }), false);     // unserializable record
});
test('readDecisions filters and tails, and survives a torn line', () => {
  const rd = tmp();
  appendDecision(rd, { hook:'pre-tool', tool:'Bash', action:'allow' });
  fs.appendFileSync(decisionsPath(rd), '{"hook":"pre-tool","action":"den\n');   // a half-written line (crash mid-append)
  appendDecision(rd, { hook:'pre-tool', tool:'Edit', action:'deny', rule:'denylist' });
  appendDecision(rd, { hook:'stop-gate', action:'block', rule:'continue' });
  assert.equal(readDecisions(rd, { limit: 0 }).length, 3);                  // the torn line is skipped, not fatal
  assert.equal(readDecisions(rd, { action:'deny' }).length, 1);
  assert.equal(readDecisions(rd, { tool:'Edit' })[0].rule, 'denylist');
  assert.equal(readDecisions(rd, { hook:'stop-gate' }).length, 1);
  assert.equal(readDecisions(rd, { rule:'denylist' }).length, 1);
  assert.equal(readDecisions(rd, { limit: 1 })[0].hook, 'stop-gate');       // limit tails (newest), not heads
  assert.deepEqual(readDecisions(tmp()), []);                               // no log yet → empty, not a throw
});
test('summarizeInput keeps the question and drops the payload', () => {
  assert.deepEqual(summarizeInput('Bash', { command:'git push' }), { command:'git push' });
  // an Edit carries the whole new file body — logging it would put source (and secrets it read) on disk
  assert.deepEqual(summarizeInput('Edit', { file_path:'/wt/a.js', old_string:'x', new_string:'SECRET' }), { file_path:'/wt/a.js' });
  assert.deepEqual(summarizeInput('NotebookEdit', { notebook_path:'/wt/n.ipynb' }), { file_path:'/wt/n.ipynb' });
  assert.equal(summarizeInput('Bash', {}), null);
  assert.equal(summarizeInput('Bash', null), null);
  const long = summarizeInput('Bash', { command:'x'.repeat(5000) }).command;
  assert.ok(long.length < 500 && long.includes('[+'), 'a huge heredoc must be clipped, and say so');
});
test('the log rolls instead of growing without bound', () => {
  const rd = tmp();
  fs.writeFileSync(decisionsPath(rd), 'x'.repeat((1 << 20) + 1));           // just over the cap
  appendDecision(rd, { hook:'pre-tool', action:'allow' });
  assert.ok(fs.existsSync(`${decisionsPath(rd)}.1`), 'the previous window survives one more round');
  assert.equal(readDecisions(rd, { limit: 0 }).length, 1);                  // the live log restarted clean
});
test('formatDecisions marks denies and crashes distinctly; summarize tallies rules', () => {
  const rows = [
    { ts:'T1', hook:'pre-tool', tool:'Bash', action:'allow', input:{ command:'npm test' } },
    { ts:'T2', hook:'pre-tool', tool:'Bash', action:'deny', rule:'git-push', reason:'nope', input:{ command:'git push' } },
    { ts:'T3', hook:'stop-gate', action:'crash', rule:'hook-crash', error:'boom' },
  ];
  const s = formatDecisions(rows);
  assert.match(s, /✖.*git-push/s); assert.match(s, /💥.*hook-crash/s); assert.match(s, /↳ nope/);
  assert.match(formatDecisions([]), /no decisions recorded/);
  assert.deepEqual(summarizeDecisions(rows), { total:3, allow:1, deny:1, crash:1, rules:{ 'git-push':1, 'hook-crash':1 } });
});
