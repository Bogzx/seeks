import { test } from 'node:test'; import assert from 'node:assert/strict';
import { preflightAssess } from '../hooks/lib/detect.mjs';

test('preflightAssess: clean system-node + git → ok', () => {
  const r = preflightAssess({ nodeExec: '/usr/bin/node', gitOk: true });
  assert.equal(r.ok, true); assert.equal(r.vmManaged, false); assert.equal(r.hint, '');
});
test('preflightAssess: version-manager node → flagged with a fix hint', () => {
  for (const p of ['/home/u/.nvm/versions/node/v20/bin/node', '/Users/u/.fnm/.../node', '/home/u/.asdf/installs/nodejs/20/bin/node', 'C:\\Users\\u\\.volta\\tools\\node.exe']){
    const r = preflightAssess({ nodeExec: p, gitOk: true });
    assert.equal(r.vmManaged, true, p); assert.equal(r.ok, false);
    assert.match(r.hint, /version manager|symlink|settings\.json/i);
  }
});
test('preflightAssess: missing git → flagged', () => {
  const r = preflightAssess({ nodeExec: '/usr/bin/node', gitOk: false });
  assert.equal(r.ok, false); assert.match(r.hint, /git/i);
});
