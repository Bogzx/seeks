import path from 'node:path'; import fs from 'node:fs';
export function canon(p, platform = process.platform) {
  let r = path.resolve(p);
  try { r = fs.realpathSync.native(r); }
  catch {                                    // leaf (or a tail of it) may not exist yet — e.g. a Write creating a new file.
    let cur = r, tail = '';                   // Resolve the nearest EXISTING ancestor so a symlinked ancestor dir is still
    for (;;){                                 // honored, then re-append the not-yet-existing tail. Without this a symlinked
      const parent = path.dirname(cur);       // ancestor pointing outside the worktree would let a new-file write escape
      if (parent === cur) break;              // isInside() confinement undetected (canon would return the lexical path).
      tail = tail ? path.join(path.basename(cur), tail) : path.basename(cur);
      try { r = path.join(fs.realpathSync.native(parent), tail); break; } catch { cur = parent; }
    }
  }
  r = r.split('\\').join('/');
  if (platform === 'win32') r = r.toLowerCase();
  return r;
}
export function isInside(child, parent, platform = process.platform) {
  const c = canon(child, platform); let p = canon(parent, platform);
  if (c === p) return true; if (!p.endsWith('/')) p += '/'; return c.startsWith(p);
}
