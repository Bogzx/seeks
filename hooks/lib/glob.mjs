// Tiny zero-dep glob matcher for denylist + oracle_globs. POSIX paths (forward
// slashes), anchored full-path. * stays within a segment; ** spans directories;
// **/ matches zero or more leading segments; ? matches one non-slash char.
export function globToRegExp(glob){
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
  return new RegExp(re + '$');
}
export function globMatch(relPath, pattern){ return globToRegExp(pattern).test(String(relPath).split('\\').join('/')); }
export function anyGlob(relPath, patterns = []){ return patterns.some(p => globMatch(relPath, p)); }
