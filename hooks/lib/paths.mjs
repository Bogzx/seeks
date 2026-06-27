import path from 'node:path'; import fs from 'node:fs';
export function canon(p, platform = process.platform) {
  let r = path.resolve(p);
  try { r = fs.realpathSync.native(r); } catch { /* may not exist */ }
  r = r.split('\\').join('/');
  if (platform === 'win32') r = r.toLowerCase();
  return r;
}
export function isInside(child, parent, platform = process.platform) {
  const c = canon(child, platform); let p = canon(parent, platform);
  if (c === p) return true; if (!p.endsWith('/')) p += '/'; return c.startsWith(p);
}
