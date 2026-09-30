// Mechanical oracle-change detection (no judgment). Lists oracle files that differ
// from baseSha (committed + working-tree + untracked), filtered by globs, and hashes
// over (path, blob-sha) so a relaxed assertion moves the hash. Never throws.
import { execFileSync } from 'node:child_process'; import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';
import { anyGlob } from './glob.mjs'; import { manifestKind, oracleChanged } from './manifest.mjs';
// The oracle is not only the tests: it is everything that decides what "the check passed" means.
// A `"test": "true"` in package.json, a `-k 'not slow'` in pytest.ini or a deleted CI step fakes a
// green just as well as a relaxed assertion — so the build manifests and runner configs are
// oracle files too.
export const TEST_GLOBS = ['test/**','tests/**','**/*.test.*','**/*.spec.*','**/*_test.*','**/test_*.*','**/conftest.py'];
export const MANIFEST_GLOBS = [
  '**/package.json', '**/Makefile', '**/makefile', '**/GNUmakefile', '**/justfile',
  '**/pyproject.toml', '**/setup.cfg', '**/setup.py', '**/tox.ini', '**/noxfile.py', '**/pytest.ini',
  '**/jest.config.*', '**/vitest.config.*', '**/vitest.workspace.*', '**/karma.conf.*', '**/.mocharc*',
  '.github/workflows/**', '.gitlab-ci.yml', '.circleci/**', 'azure-pipelines.yml',
];
export const DEFAULT_ORACLE_GLOBS = [...TEST_GLOBS, ...MANIFEST_GLOBS];
// What happens at release when a PRE-EXISTING oracle file was modified or deleted (status key
// `oracle_modified_policy`). New oracle files (added tests) are always free.
//   'needs_human' (default) — the loop ends needs-human with the file list: a model can't be the
//                             one to decide a weakened check is fine, and the maker can call
//                             `seeks oracle-ack` itself.
//   'ack'                   — the pre-2026-10 behaviour: the verifier's `oracle-ack` is enough.
export const ORACLE_POLICIES = ['needs_human', 'ack'];
export const oraclePolicy = (s) => ORACLE_POLICIES.includes(s?.oracle_modified_policy) ? s.oracle_modified_policy : 'needs_human';
// How a mixed-purpose manifest (package.json, pyproject.toml, setup.cfg) is compared (status key
// `oracle_manifest_diff`): 'keys' (default) — only its test-relevant part is oracle (manifest.mjs);
// 'whole' — every byte, so a dependency bump counts too.
export const manifestDiffMode = (s) => s?.oracle_manifest_diff === 'whole' ? 'whole' : 'keys';
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
// Oracle files that existed at baseSha and are now different or gone (committed, staged or in the
// working tree). Additions are not listed: a new test can only add to the oracle. A rename shows as
// a deletion of the old path. Returns null when there is no base to compare against.
export function oracleModifiedPreexisting(worktree, baseSha, globs = DEFAULT_ORACLE_GLOBS, { manifestDiff = 'keys' } = {}){
  if (!baseSha) return null;
  const git = (args, input) => { try { return execFileSync('git',['-C',worktree,...args],{encoding:'utf8',input,maxBuffer:64*1024*1024,stdio:['pipe','pipe','ignore']}); } catch { return null; } };
  const diff = git(['diff','--name-only','--no-renames',baseSha]); if (diff == null) return null;
  const cands = diff.split('\n').map(l => l.trim()).filter(f => f && anyGlob(f, globs));
  if (!cands.length) return [];
  const base = new Map();
  for (const rec of (git(['ls-tree','-r','-z',baseSha,'--',...cands]) ?? '').split('\0')){
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(rec); if (m) base.set(m[2], m[1]); }
  const out = [];
  for (const [f, blob] of base){
    let now = null; try { if (fs.statSync(path.join(worktree, f)).isFile()) now = (git(['hash-object','--',f]) ?? '').trim() || null; } catch {}
    if (now === blob) continue;
    if (now != null && manifestDiff !== 'whole' && manifestKind(f)){            // a manifest: only its oracle part counts
      const before = git(['cat-file','blob',blob]); let after = null; try { after = fs.readFileSync(path.join(worktree, f), 'utf8'); } catch {}
      if (before != null && after != null && !oracleChanged(f, before, after)) continue;
    }
    out.push({ file: f, change: now == null ? 'deleted' : 'modified' });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
