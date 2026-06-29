// Tiny zero-dep glob matcher for denylist + oracle_globs. POSIX paths (forward
// slashes), anchored full-path. * stays within a segment; ** spans directories;
// **/ matches zero or more leading segments; ? matches one non-slash char.
// Case-insensitive on win32 (paths there are case-folded) so uppercase patterns match.
export function globToRegExp(glob, platform = process.platform){
  const g = String(glob).split('\\').join('/');
  let re = '^';
  for (let i = 0; i < g.length; i++){
    const c = g[i];
    if (c === '*'){
      if (g[i+1] === '*'){ i++; if (g[i+1] === '/'){ re += '(?:.*/)?'; i++; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', platform === 'win32' ? 'i' : '');
}
export function globMatch(relPath, pattern, platform = process.platform){ return globToRegExp(pattern, platform).test(String(relPath).split('\\').join('/')); }
export function anyGlob(relPath, patterns = [], platform = process.platform){ return patterns.some(p => globMatch(relPath, p, platform)); }
