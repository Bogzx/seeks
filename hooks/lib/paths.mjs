import path from 'node:path'; import fs from 'node:fs';
// Windows and macOS (APFS and HFS+ by default) treat `.ENV` and `.env` as the same file. Folding
// case is always safe for a DENY match (the denylist globs): it can only deny more. It is not safe
// for a containment check on a case-sensitive macOS volume, where `/x/WT` is a different directory
// from `/x/wt` — so callers that test containment pass `fold` explicitly (policy.mjs folds those on
// win32 only, and relies on realpath, which returns the on-disk case of every existing ancestor).
export const foldsCase = (platform = process.platform) => platform === 'win32' || platform === 'darwin';
export function canon(p, platform = process.platform, fold = foldsCase(platform)) {
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
  if (fold) r = r.toLowerCase();
  return r;
}
export function isInside(child, parent, platform = process.platform, fold = foldsCase(platform)) {
  const c = canon(child, platform, fold); let p = canon(parent, platform, fold);
  if (c === p) return true; if (!p.endsWith('/')) p += '/'; return c.startsWith(p);
}
