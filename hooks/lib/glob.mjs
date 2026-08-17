// Tiny zero-dep glob matcher for denylist + oracle_globs. POSIX paths (forward
// slashes), anchored full-path. * stays within a segment; ** spans directories;
// **/ matches zero or more leading segments; ? matches one non-slash char;
// [abc] / [a-z] / [!a] / [^a] / [[:alpha:]] is a ONE-character class that never spans a
// slash. Case-insensitive on win32 (paths there are case-folded) so uppercase patterns match.
// A bracket group compiles to class-OR-the-literal-text, on purpose: `app/[slug]/page.tsx`
// is a real path AND a real denylist entry, so teaching the engine class semantics must only
// ever ADD matches, never take one away. (This engine is also what decides whether a glob in
// a Bash command resolves onto a hook-owned file — see policy.mjs::hookOwnedResolved.)
const POSIX_CLASS = {
  alpha:'A-Za-z', digit:'0-9', alnum:'A-Za-z0-9', lower:'a-z', upper:'A-Z', word:'\\w',
  space:'\\s', blank:' \\t', xdigit:'0-9A-Fa-f', cntrl:'\\x00-\\x1f', print:'\\x20-\\x7e',
  graph:'\\x21-\\x7e', punct:'!-\\/:-@\\[-`{-~',
};
const escLiteral = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Compile the `[…]` starting at g[i]. Returns null when it is NOT a class — unterminated,
// empty, or spanning a `/` — and the caller then treats `[` as an ordinary character.
function bracketClass(g, i){
  let j = i + 1, neg = false;
  if (g[j] === '!' || g[j] === '^'){ neg = true; j++; }
  let body = '';
  for (let first = true; j < g.length; j++, first = false){
    const c = g[j];
    if (c === ']'){                                   // a `]` FIRST is a literal member (POSIX)
      if (first){ body += '\\]'; continue; }
      return body ? { src: (neg ? '[^/' : '[') + body + ']', end: j } : null; }
    if (c === '/') return null;                       // a class never spans a separator
    if (c === '[' && g[j+1] === ':'){                 // [[:alpha:]] & friends
      const k = g.indexOf(':]', j + 2), name = k === -1 ? null : g.slice(j + 2, k);
      if (name && POSIX_CLASS[name]){ body += POSIX_CLASS[name]; j = k + 1; continue; }
      body += '\\['; continue; }
    if (c === '[' && (g[j+1] === '=' || g[j+1] === '.')){   // [[=a=]] equivalence / [[.a.]] collating
      const k = g.indexOf(g[j+1] + ']', j + 2);
      if (k !== -1){ body += g.slice(j + 2, k).replace(/[\]^\\[-]/g, '\\$&'); j = k + 1; continue; }
      body += '\\['; continue; }
    body += (c === '-' ? '-' : c.replace(/[\]^\\[]/g, '\\$&'));   // `-` stays: that is the range
  }
  return null;                                        // unterminated
}
export function globToRegExp(glob, platform = process.platform){
  const g = String(glob).split('\\').join('/');
  let re = '^';
  for (let i = 0; i < g.length; i++){
    const c = g[i];
    if (c === '*'){
      if (g[i+1] === '*'){ i++; if (g[i+1] === '/'){ re += '(?:.*/)?'; i++; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '['){
      const cls = bracketClass(g, i);
      if (cls){ re += `(?:${cls.src}|${escLiteral(g.slice(i, cls.end + 1))})`; i = cls.end; }
      else re += '\\[';
    }
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', platform === 'win32' ? 'i' : '');
}
export function globMatch(relPath, pattern, platform = process.platform){ return globToRegExp(pattern, platform).test(String(relPath).split('\\').join('/')); }
export function anyGlob(relPath, patterns = [], platform = process.platform){ return patterns.some(p => globMatch(relPath, p, platform)); }
// Case-insensitive on EVERY platform, for callers whose names are case-folded by policy rather
// than by the filesystem: policy.mjs matches the hook-owned filenames `/i` everywhere else, so
// a glob resolving onto one must not quietly start depending on the host.
export const globMatchCI = (relPath, pattern) => globMatch(relPath, pattern, 'win32');
