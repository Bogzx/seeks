import { test } from 'node:test'; import assert from 'node:assert/strict';
import { decidePreTool } from '../hooks/lib/policy.mjs';
const WT = process.platform === 'win32' ? 'C:/wt/ui' : '/wt/ui';
const RUN = process.platform === 'win32' ? 'C:/proj/.seeks/run/ui' : '/proj/.seeks/run/ui';
const ctx = (level) => ({ level, worktreePath: WT, runDir: RUN, denylist: ['**/.env','**/secrets/**','.git/**'] });
const edit = (p) => ({ file_path: p });

test('L2 allows a source edit inside the worktree', () =>
  assert.equal(decidePreTool('Edit', edit(`${WT}/src/a.js`), ctx('L2')).action, 'allow'));
test('L1 denies a source edit (report-only)', () =>
  assert.equal(decidePreTool('Edit', edit(`${WT}/src/a.js`), ctx('L1')).action, 'deny'));
test('writes under the run dir are allowed at every level', () => {
  for (const lvl of ['L1','L2','L3'])
    assert.equal(decidePreTool('Write', edit(`${RUN}/state.md`), ctx(lvl)).action, 'allow');
});
test('direct status.json / hook-state.json writes are denied at every level', () => {
  for (const lvl of ['L1','L2','L3']){
    assert.equal(decidePreTool('Write', edit(`${RUN}/status.json`), ctx(lvl)).action, 'deny');
    assert.equal(decidePreTool('Write', edit(`${RUN}/hook-state.json`), ctx(lvl)).action, 'deny');
  }
});
test('denylist edits denied', () =>
  assert.equal(decidePreTool('Edit', edit(`${WT}/.env`), ctx('L2')).action, 'deny'));
test('edits outside the worktree denied', () => {
  const outside = process.platform === 'win32' ? 'C:/other/x.js' : '/other/x.js';
  assert.equal(decidePreTool('Edit', edit(outside), ctx('L2')).action, 'deny');
});
test('NotebookEdit uses notebook_path', () =>
  assert.equal(decidePreTool('NotebookEdit', { notebook_path: `${WT}/n.ipynb` }, ctx('L1')).action, 'deny'));
test('git push/merge/rebase denied at EVERY level (delivery is CLI-only)', () => {
  for (const lvl of ['L1','L2','L3']){
    assert.equal(decidePreTool('Bash', { command: 'git push origin x' }, ctx(lvl)).action, 'deny');
    assert.equal(decidePreTool('Bash', { command: 'git merge main' }, ctx(lvl)).action, 'deny');
    assert.equal(decidePreTool('Bash', { command: 'git rebase main' }, ctx(lvl)).action, 'deny');
  }
});
test('git policy is not bypassed by global options / git.exe (H1)', () => {
  const c = ctx('L2');
  for (const cmd of ['git -C /wt push origin main','git.exe push','git --no-pager push',
                     'git -c k=v push origin x','git -C /wt rebase main','git -C /wt merge main']){
    assert.equal(decidePreTool('Bash', { command: cmd }, c).action, 'deny', `should deny: ${cmd}`);
  }
  assert.equal(decidePreTool('Bash', { command: 'git -C /wt commit -m x' }, ctx('L1')).action, 'deny');   // L1 commit via -C
  assert.equal(decidePreTool('Bash', { command: 'git commit -m x && git push' }, c).action, 'deny');        // push in 2nd segment
  assert.equal(decidePreTool('Bash', { command: 'sleep 1 & git push origin main' }, c).action, 'deny');      // lone & background op (3.2)
  assert.equal(decidePreTool('Bash', { command: 'true & git merge main' }, c).action, 'deny');               // lone & before merge (3.2)
});
test('git policy does not false-positive on substrings (M1)', () => {
  const c = ctx('L2');
  assert.equal(decidePreTool('Bash', { command: 'git commit -m "docs: how to git push"' }, c).action, 'allow');
  assert.equal(decidePreTool('Bash', { command: 'echo remember to git push later' }, c).action, 'allow');
  assert.equal(decidePreTool('Bash', { command: 'npm run push-docs' }, c).action, 'allow');
});
test('git commit denied at L1 only', () => {
  assert.equal(decidePreTool('Bash', { command: 'git commit -m x' }, ctx('L1')).action, 'deny');
  assert.equal(decidePreTool('Bash', { command: 'git commit -m x' }, ctx('L2')).action, 'allow');
});
test('unpoliced tools and benign bash allow', () => {
  assert.equal(decidePreTool('Read', edit(`${WT}/.env`), ctx('L1')).action, 'allow');
  assert.equal(decidePreTool('Bash', { command: 'npm test' }, ctx('L2')).action, 'allow');
});
test('missing level defaults to L2', () =>
  assert.equal(decidePreTool('Edit', edit(`${WT}/src/a.js`), { worktreePath: WT, runDir: RUN, denylist: [] }).action, 'allow'));
