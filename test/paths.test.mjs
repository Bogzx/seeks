import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { isInside } from '../hooks/lib/paths.mjs';
test('separators normalized + case-insensitive on win32', () => {
  assert.equal(isInside('C:/a/b/c', 'C:\\a\\b', 'win32'), true);
  assert.equal(isInside('C:/A/B/c', 'c:/a/b', 'win32'), true);
});
test('case-sensitive off win32', () => { assert.equal(isInside('/A/B/c', '/a/b', 'linux'), false); });
test('boundary not fooled by prefix', () => {
  assert.equal(isInside('/foo/bar', '/foo/ba', 'linux'), false);
  assert.equal(isInside('/foo/ba', '/foo/ba', 'linux'), true);
});
test('canon follows a symlinked ancestor even for a not-yet-existing leaf (3.5)', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-canon-'));
  try {
    const outside = path.join(base, 'outside');   // symlink target, NOT under the confine dir
    const confine = path.join(base, 'confine');
    fs.mkdirSync(outside); fs.mkdirSync(confine);
    const link = path.join(confine, 'link');
    try { fs.symlinkSync(outside, link, 'dir'); }
    catch { t.skip('symlink creation not permitted here'); return; }
    // The leaf does not exist yet (the Write-new-file case). canon must still resolve the
    // symlinked ancestor, so a write under it is detected as OUTSIDE the confine dir.
    assert.equal(isInside(path.join(link, 'newfile.txt'), confine), false);
    // Control: a real (non-symlink) subdir with a not-yet-existing leaf stays inside.
    assert.equal(isInside(path.join(confine, 'realsub', 'newfile.txt'), confine), true);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
