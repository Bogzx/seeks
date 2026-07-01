// Mechanical oracle-change detection (no judgment). Lists oracle files that differ
// from baseSha (committed + working-tree + untracked), filtered by globs, and hashes
// over (path, blob-sha) so a relaxed assertion moves the hash. Never throws.
import { execFileSync } from 'node:child_process'; import crypto from 'node:crypto';
import { anyGlob } from './glob.mjs';
export const DEFAULT_ORACLE_GLOBS = ['test/**','tests/**','**/*.test.*','**/*.spec.*','**/*_test.*','**/test_*.*'];
// Parse one `git status --porcelain` (v1) line to the path it concerns. Rename/copy lines are
// "XY orig -> new"; only treat ' -> ' as the separator when the status code is actually a rename (R)
// or copy (C), so a real path that legitimately contains ' -> ' isn't mis-parsed as its own suffix.
export function porcelainPath(line){
  const xy = line.slice(0,2); const f = line.slice(3).trim(); if (!f) return '';
  return (/[RC]/.test(xy) && f.includes(' -> ')) ? f.slice(f.indexOf(' -> ') + 4) : f;
}
export function oracleDiffHash(worktree, baseSha, globs = DEFAULT_ORACLE_GLOBS){
  const git = (...args) => { try { return execFileSync('git',['-C',worktree,...args],{encoding:'utf8'}); } catch { return ''; } };
  const names = new Set();
  if (baseSha) for (const l of git('diff','--name-only',baseSha).split('\n')){ const f=l.trim(); if (f) names.add(f); }
  for (const l of git('status','--porcelain').split('\n')){ const f = porcelainPath(l); if (f) names.add(f); }
  const files = [...names].filter(f => anyGlob(f, globs)).sort();
  const parts = files.map(f => { let b=''; try { b = execFileSync('git',['-C',worktree,'hash-object',f],{encoding:'utf8'}).trim(); } catch { b='missing'; } return `${f}:${b}`; });
  const hash = crypto.createHash('sha1').update(parts.join('\n')).digest('hex').slice(0,16);
  return { files, hash };
}
// How many files in the worktree match the oracle globs (tracked + untracked). Zero means the
// content-hash accounting is vacuous — a relaxed test wouldn't be caught (e.g. command-only oracle,
// or tests that don't match the globs). Surfaced so it isn't a silent gap.
export function oracleGlobsPresent(worktree, globs = DEFAULT_ORACLE_GLOBS){
  const git = (...args) => { try { return execFileSync('git',['-C',worktree,...args],{encoding:'utf8'}); } catch { return ''; } };
  const names = new Set();
  for (const l of git('ls-files').split('\n')){ const f = l.trim(); if (f) names.add(f); }
  for (const l of git('ls-files','--others','--exclude-standard').split('\n')){ const f = l.trim(); if (f) names.add(f); }
  return [...names].filter(f => anyGlob(f, globs)).length;
}
