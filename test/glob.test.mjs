import { test } from 'node:test'; import assert from 'node:assert/strict';
import { globMatch, anyGlob, globMatchCI } from '../hooks/lib/glob.mjs';

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
// `[` and `]` used to be ESCAPED into literals, which is worse than not supporting them: the
// policy's GLOB_RE counted `[` as a glob, so the pattern branch fired and then matched nothing.
test('bracket classes match one character, and never a slash', () => {
  assert.equal(globMatch('status.json', 'status.jso[n]'), true);
  assert.equal(globMatch('status.json', 'status.jso[a-z]'), true);
  assert.equal(globMatch('status.json', 'status.jso[!x]'), true);      // ! negation
  assert.equal(globMatch('status.json', 'status.jso[^x]'), true);      // ^ negation
  assert.equal(globMatch('status.json', 'status.jso[x]'), false);
  assert.equal(globMatch('status.json', 'status.jso[!n]'), false);
  assert.equal(globMatch('status.json', 'status.js[[:alpha:]]n'), true);
  assert.equal(globMatch('status.json', 'status.js[[:digit:]]n'), false);
  assert.equal(globMatch('status.json', 'status.jso[[=n=]]'), true);   // equivalence class
  assert.equal(globMatch('a/b', 'a[/]b'), false);                      // a class never spans a separator
  assert.equal(globMatch('a[/]b', 'a[/]b'), true);                     // …so it stays a literal
});
// Adding class semantics must not take a match away — `app/[slug]/page.tsx` is a real path AND
// a plausible denylist entry, so a bracket group is compiled as class-OR-the-literal-text.
test('a bracket group still matches itself literally', () => {
  assert.equal(globMatch('app/[slug]/page.tsx', 'app/[slug]/page.tsx'), true);
  assert.equal(globMatch('app/s/page.tsx', 'app/[slug]/page.tsx'), true);     // …and as a class
  assert.equal(globMatch('src/[id].js', '**/[id].js'), true);
  assert.equal(globMatch('src/i.js', '**/[id].js'), true);
});
test('an unterminated or empty bracket is an ordinary character', () => {
  assert.equal(globMatch('foo[bar', 'foo[bar'), true);
  assert.equal(globMatch('foo[]', 'foo[]'), true);
  assert.equal(globMatch('x]', '[]]'), false);
  assert.equal(globMatch(']', '[]]'), true);                           // a leading ] is a member (POSIX)
});
test('globMatchCI folds case on every platform, not just win32', () => {
  assert.equal(globMatch('status.json', 'STATUS.JSO[N]', 'linux'), false);
  assert.equal(globMatchCI('status.json', 'STATUS.JSO[N]'), true);
  assert.equal(globMatchCI('status.json', 'STA*.JSON'), true);
});
test('win32 matching is case-insensitive; other platforms case-sensitive (L1)', () => {
  assert.equal(globMatch('wt/Secrets/k', '**/secrets/**', 'win32'), true);   // uppercase path vs lowercase pattern
  assert.equal(globMatch('config/x', '**/Config/**', 'win32'), true);        // uppercase pattern vs lowercase path
  assert.equal(globMatch('config/x', '**/Config/**', 'linux'), false);       // case-sensitive off win32
});
