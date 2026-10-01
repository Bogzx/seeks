// Installed users only receive a new seeks when plugin.json's "version" changes: Claude Code keys
// its plugin cache and `claude plugin update` on that string, so commits pushed under an unchanged
// version never reach anyone who already installed it. 0.1.0 sat unchanged from 2026-08-17 to
// 2026-10-01 while the gate was rewritten. This check fails a PR that changes what the plugin runs
// without bumping the version.
//   node scripts/check-version-bump.mjs <base-ref>     (CI passes the PR's base commit)
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
// What Claude Code loads from the plugin: a change here changes behaviour for installed users.
export const RUNTIME_PATHS = ['hooks/', 'bin/', 'skills/', 'commands/', '.claude-plugin/plugin.json'];
export const isRuntime = (f) => RUNTIME_PATHS.some(p => p.endsWith('/') ? f.startsWith(p) : f === p);
// → { ok, runtime: [changed runtime files], message }
export function checkBump({ changed, baseVersion, headVersion }){
  const runtime = changed.filter(isRuntime);
  if (!runtime.length) return { ok: true, runtime, message: 'no runtime files changed; no version bump needed' };
  if (headVersion && headVersion !== baseVersion) return { ok: true, runtime, message: `version ${baseVersion} → ${headVersion}` };
  return { ok: false, runtime, message: `${runtime.length} runtime file(s) changed (${runtime.slice(0, 5).join(', ')}${runtime.length > 5 ? ', …' : ''}) `
    + `but .claude-plugin/plugin.json is still ${baseVersion}. Bump it (and package.json) and add a CHANGELOG entry: installed users `
    + `only get an update when that string changes. For a change that needs no release, label the PR no-version-bump.` };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])){
  const base = process.argv[2]; if (!base){ process.stderr.write('usage: check-version-bump.mjs <base-ref>\n'); process.exit(2); }
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
  const version = (ref) => { try { return JSON.parse(git('show', `${ref}:.claude-plugin/plugin.json`)).version ?? null; } catch { return null; } };
  const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const r = checkBump({ changed, baseVersion: version(base), headVersion: version('HEAD') });
  (r.ok ? process.stdout : process.stderr).write(`[version-bump] ${r.message}\n`);
  process.exit(r.ok ? 0 : 1);
}
