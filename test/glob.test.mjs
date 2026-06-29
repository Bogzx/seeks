import { test } from 'node:test'; import assert from 'node:assert/strict';
import { globMatch, anyGlob } from '../hooks/lib/glob.mjs';

test('**/.env matches at root and nested', () => {
  assert.equal(globMatch('.env', '**/.env'), true);
  assert.equal(globMatch('src/.env', '**/.env'), true);
  assert.equal(globMatch('a/b/.env', '**/.env'), true);
});
test('secrets globs', () => {
  assert.equal(globMatch('secrets/key.pem', '**/secrets/**'), true);
  assert.equal(globMatch('a/secrets/k', '**/secrets/**'), true);
  assert.equal(globMatch('secrets', '**/secrets/**'), false); // needs contents
});
test('.git/** and test/**', () => {
  assert.equal(globMatch('.git/config', '.git/**'), true);
  assert.equal(globMatch('test/a.test.js', 'test/**'), true);
  assert.equal(globMatch('test/sub/b.js', 'test/**'), true);
});
test('* does not cross a slash', () => {
  assert.equal(globMatch('a/b', 'a*'), false);
  assert.equal(globMatch('ab', 'a*'), true);
  assert.equal(globMatch('src/x.test.js', '**/*.test.*'), true);
  assert.equal(globMatch('src/x.js', '**/*.test.*'), false);
});
test('anyGlob ORs the set', () => {
  assert.equal(anyGlob('a/.env', ['**/secrets/**', '**/.env']), true);
  assert.equal(anyGlob('src/main.mjs', ['**/secrets/**', '**/.env']), false);
});
