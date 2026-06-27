import { test } from 'node:test'; import assert from 'node:assert/strict';
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
