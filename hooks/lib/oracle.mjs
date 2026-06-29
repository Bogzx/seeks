// Mechanical oracle-change detection (no judgment). Lists oracle files that differ
// from baseSha (committed + working-tree + untracked), filtered by globs, and hashes
// over (path, blob-sha) so a relaxed assertion moves the hash. Never throws.
import { execFileSync } from 'node:child_process'; import crypto from 'node:crypto';
import { anyGlob } from './glob.mjs';
export const DEFAULT_ORACLE_GLOBS = ['test/**','tests/**','**/*.test.*','**/*.spec.*','**/*_test.*','**/test_*.*'];
export function oracleDiffHash(worktree, baseSha, globs = DEFAULT_ORACLE_GLOBS){
  const git = (...args) => { try { return execFileSync('git',['-C',worktree,...args],{encoding:'utf8'}); } catch { return ''; } };
  const names = new Set();
  if (baseSha) for (const l of git('diff','--name-only',baseSha).split('\n')){ const f=l.trim(); if (f) names.add(f); }
  for (const l of git('status','--porcelain').split('\n')){ const f=l.slice(3).trim(); if (f) names.add(f.includes(' -> ')?f.split(' -> ')[1]:f); }
  const files = [...names].filter(f => anyGlob(f, globs)).sort();
  const parts = files.map(f => { let b=''; try { b = execFileSync('git',['-C',worktree,'hash-object',f],{encoding:'utf8'}).trim(); } catch { b='missing'; } return `${f}:${b}`; });
  const hash = crypto.createHash('sha1').update(parts.join('\n')).digest('hex').slice(0,16);
  return { files, hash };
}
