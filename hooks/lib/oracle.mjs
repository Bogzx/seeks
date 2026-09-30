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
  // …and the files that decide HOW a check runs without being a test or a script. `script-shell=/bin/true`
  // in .npmrc turns `npm test` into `true`; a tsconfig/mypy/eslint/ruff config decides what a type or
  // lint check reports; .gitattributes can route a file through a clean filter git then diffs instead.
  '**/.npmrc', '**/.yarnrc', '**/.yarnrc.yml', '**/.pnpmfile.cjs', '**/bunfig.toml',
  '**/.babelrc', '**/.babelrc.*', '**/babel.config.*', '**/tsconfig*.json', '**/.nycrc*', '**/.c8rc*',
  '**/.eslintrc*', '**/eslint.config.*', '**/.coveragerc', '**/mypy.ini', '**/.mypy.ini', '**/ruff.toml', '**/.ruff.toml',
  '**/.flake8', '**/.pylintrc', '**/.gitattributes',
];
export const DEFAULT_ORACLE_GLOBS = [...TEST_GLOBS, ...MANIFEST_GLOBS];
// Oracle files whose mere ADDITION can change what passes: a new pytest.ini with `addopts = --co`,
// a .mocharc/vitest.config that matches no tests, a root conftest.py that skips everything, a new
// .npmrc. A new test file only adds checks, so it stays free; a new config file is a change.
export const CONFIG_GLOBS = [...MANIFEST_GLOBS, '**/conftest.py'];
// Every git call here ignores `git replace` refs: `git replace <base> HEAD` made the base commit
// read as the current one, so a committed test edit vanished from the diff.
const GIT_ENV = () => ({ ...process.env, GIT_NO_REPLACE_OBJECTS: '1' });
// …and no clean filter or fsmonitor the maker configured. `git config filter.x.clean 'git show
// <base>:%f'` plus `test/* filter=x` in .git/info/attributes made an edited test hash as its base
// blob, so git diff reported nothing. Every configured filter driver is blanked for these calls
// (an empty command is a pass-through), except LFS, pinned to its standard command. Passed as
// GIT_CONFIG_KEY_n/VALUE_n (git ≥ 2.31), not `-c k=v`, because a driver name may contain '='.
const LFS_STD = { clean: 'git-lfs clean -- %f', process: 'git-lfs filter-process', smudge: 'git-lfs smudge -- %f' };
export function guardedGitEnv(worktree){
  const kv = [['core.fsmonitor', 'false']];
  let cfg = ''; try { cfg = execFileSync('git',['-C',worktree,'config','-z','--get-regexp','^filter\\..*\\.(clean|process|smudge)$'],{encoding:'utf8',env:GIT_ENV(),stdio:['ignore','pipe','ignore']}); } catch {}
  for (const rec of cfg.split('\0')){
    const key = rec.split('\n')[0]; const m = /^filter\.([\s\S]+)\.(clean|process|smudge)$/i.exec(key); if (!m) continue;
    kv.push([key, m[1].toLowerCase() === 'lfs' ? LFS_STD[m[2].toLowerCase()] : '']);
  }
  const env = { ...GIT_ENV(), GIT_CONFIG_COUNT: String(kv.length) };
  kv.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  return env;
}
// What happens at release when a PRE-EXISTING oracle file was modified or deleted, or a config-type
// one was added (status key `oracle_modified_policy`). New test files are always free.
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
  const env = guardedGitEnv(worktree);
  const git = (...args) => { try { return execFileSync('git',['-C',worktree,...args],{encoding:'utf8',env}); } catch { return ''; } };
  const names = new Set(indexHidden(worktree));
  if (baseSha) for (const l of git('diff','--name-only',baseSha).split('\n')){ const f=l.trim(); if (f) names.add(f); }
  for (const l of git('status','--porcelain').split('\n')){ const f = porcelainPath(l); if (f) names.add(f); }
  const files = [...names].filter(f => anyGlob(f, globs)).sort();
  const parts = files.map(f => { let b=''; try { b = execFileSync('git',['-C',worktree,'hash-object',f],{encoding:'utf8',env}).trim(); } catch { b='missing'; } return `${f}:${b}`; });
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
// Tracked files git has been told not to look at: `git update-index --assume-unchanged` (lowercase
// tag in `ls-files -v`) or `--skip-worktree` (S). git diff/status then skip them, so an edited
// test was invisible here while the runner ran the edited copy. They are always re-checked.
export function indexHidden(worktree){
  let out = ''; try { out = execFileSync('git',['-C',worktree,'ls-files','-v','-z'],{encoding:'utf8',env:guardedGitEnv(worktree),maxBuffer:64*1024*1024,stdio:['ignore','pipe','ignore']}); } catch { return []; }
  return out.split('\0').filter(r => r.length > 2 && (/^[a-z]/.test(r) || r[0] === 'S')).map(r => r.slice(2));
}
// Oracle files that existed at baseSha and are now different or gone (committed, staged or in the
// working tree), plus config-type oracle files (CONFIG_GLOBS) that did NOT exist there. A new test
// file is not listed: it can only add to the oracle. A rename shows as a deletion of the old path.
// Returns null when there is no base to compare against.
export function oracleModifiedPreexisting(worktree, baseSha, globs = DEFAULT_ORACLE_GLOBS, { manifestDiff = 'keys' } = {}){
  if (!baseSha) return null;
  const env = guardedGitEnv(worktree);
  const git = (args, input) => { try { return execFileSync('git',['-C',worktree,...args],{encoding:'utf8',input,env,maxBuffer:64*1024*1024,stdio:['pipe','pipe','ignore']}); } catch { return null; } };
  const diff = git(['diff','--name-only','--no-renames',baseSha]); if (diff == null) return null;
  const lines = (t) => (t ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const hidden = indexHidden(worktree);
  const sparse = (git(['config','--bool','core.sparseCheckout']) ?? '').trim() === 'true';   // there, a skip-worktree file is legitimately absent
  const cands = [...new Set([...lines(diff), ...hidden])].filter(f => anyGlob(f, globs));
  // Untracked files too, ignored ones included (a new .npmrc is often gitignored — and the maker can
  // add it to .gitignore). --directory collapses an ignored tree like node_modules/ to one entry.
  const untracked = [...lines(git(['ls-files','--others','--exclude-standard'])),
    ...lines(git(['ls-files','--others','--ignored','--exclude-standard','--directory'])).filter(f => !f.endsWith('/'))];
  const addCands = [...new Set([...cands, ...untracked])].filter(f => anyGlob(f, globs) && anyGlob(f, CONFIG_GLOBS));
  const base = new Map(); const q = [...new Set([...cands, ...addCands])];
  if (!q.length) return [];
  for (const rec of (git(['ls-tree','-r','-z',baseSha,'--',...q]) ?? '').split('\0')){
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(rec); if (m) base.set(m[2], m[1]); }
  const out = [];
  for (const [f, blob] of base){
    if (!cands.includes(f)) continue;
    let now = null; try { if (fs.statSync(path.join(worktree, f)).isFile()) now = (git(['hash-object','--',f]) ?? '').trim() || null; } catch {}
    if (now === blob) continue;
    if (now == null && sparse && hidden.includes(f)) continue;
    if (now != null && manifestDiff !== 'whole' && manifestKind(f)){            // a manifest: only its oracle part counts
      const before = git(['cat-file','blob',blob]); let after = null; try { after = fs.readFileSync(path.join(worktree, f), 'utf8'); } catch {}
      if (before != null && after != null && !oracleChanged(f, before, after)) continue;
    }
    out.push({ file: f, change: now == null ? 'deleted' : 'modified' });
  }
  for (const f of addCands){
    if (base.has(f)) continue;
    try { if (!fs.statSync(path.join(worktree, f)).isFile()) continue; } catch { continue; }
    out.push({ file: f, change: 'added' });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
