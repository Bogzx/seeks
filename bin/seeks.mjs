import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { readStatus, writeStatusAtomic } from '../hooks/lib/status.mjs';
import { runDir, primaryRoot, seeksDir } from '../hooks/lib/resolve.mjs';
import { acquire, release } from '../hooks/lib/lock.mjs';
import { readHookState, resetFires } from '../hooks/lib/hookstate.mjs';
import { composeBanner } from '../hooks/lib/banner.mjs';
import { nextLens, DEFAULT_LENSES } from '../hooks/lib/lenses.mjs';
import { oracleDiffHash, DEFAULT_ORACLE_GLOBS } from '../hooks/lib/oracle.mjs';
import { DEFAULT_DENYLIST } from '../hooks/lib/policy.mjs';
const [cmd, ...a] = process.argv.slice(2);
const out = (x) => process.stdout.write(typeof x === 'string' ? x : JSON.stringify(x));
const backlog = (rd) => path.join(rd,'backlog.md');
const countOpen = (rd) => { try { return (fs.readFileSync(backlog(rd),'utf8').match(/^- \[ \] /gm) || []).length; } catch { return 0; } };
const rdOf = (name) => runDir(name);
const USAGE = `seeks <cmd> <name> [args]
  init <name> <json>            status-get <name>             status-set <name> <patch-json>
  condition-reject <name> <id>  backlog-add <name> <task...>  backlog-count <name>
  log-add <name> <line...>      sweep-tick <name> <found> [lens]   sweep-next-lens <name>
  progress-tick <name>          reset-fires <name>                 lock-acquire <name>
  lock-release <name>           gc <name>                          banner <name> <action> [stopKind]
  latest                        base-record <name>                 base-check <name>
  oracle-diff <name>            oracle-ack <name>`;
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }
try {
switch (cmd) {
  case 'init': { const rd = rdOf(a[0]); fs.mkdirSync(rd,{recursive:true});
    const st = JSON.parse(a[1]);
    if (!st.level) st.level = 'L2';                               // persist level/globs/denylist so the PreToolUse hook reads them from status alone
    if (!st.oracle_globs) st.oracle_globs = DEFAULT_ORACLE_GLOBS;
    if (!st.denylist) st.denylist = DEFAULT_DENYLIST;
    writeStatusAtomic(rd, st);
    for (const f of ['backlog.md','log.md']) { const p = path.join(rd,f); if (!fs.existsSync(p)) fs.writeFileSync(p,''); }  // not state.md/summary.md — those are Written wholesale; pre-creating empties forces a Read-before-Write (F4)
    fs.mkdirSync(path.join(rd,'verify'),{recursive:true}); out('ok'); break; }  // F17: confirm success, no status-get round-trip
  case 'status-get': out(readStatus(rdOf(a[0])) ?? {}); break;
  case 'status-set': { const rd = rdOf(a[0]); const cur = readStatus(rd) ?? {};
    writeStatusAtomic(rd, { ...cur, ...JSON.parse(a[1]), updated_at: new Date().toISOString() }); break; }
  case 'condition-reject': { const rd = rdOf(a[0]); const id = a[1]; const s = readStatus(rd) ?? {};
    const cr = { ...(s.condition_rejects || {}) }; cr[id] = (cr[id] || 0) + 1;
    const patch = { condition_rejects: cr };
    if (cr[id] >= (s.condition_reject_threshold ?? 3)) patch.needs_human = true;
    writeStatusAtomic(rd, { ...s, ...patch, updated_at: new Date().toISOString() }); break; }
  case 'backlog-add': fs.appendFileSync(backlog(rdOf(a[0])), `- [ ] ${a.slice(1).join(' ')}\n`); break;
  case 'backlog-count': out(String(countOpen(rdOf(a[0])))); break;
  case 'log-add': fs.appendFileSync(path.join(rdOf(a[0]),'log.md'), `${a.slice(1).join(' ')}\n`); break;  // F15: sanctioned log append (create-on-write)
  case 'sweep-tick': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const found = parseInt(a[1] ?? '0',10) || 0; const lens = a[2] || null;
    const lenses_used = lens ? [...(s.lenses_used ?? []), lens] : (s.lenses_used ?? []);
    let dry = s.dry_sweeps ?? 0; let dry_lenses = [...(s.dry_lenses ?? [])];
    if (found > 0) { dry = 0; dry_lenses = []; }                                  // found → re-seed, reset the dry streak
    else if (!lens || !dry_lenses.includes(lens)) { dry += 1; if (lens) dry_lenses.push(lens); } // a DISTINCT lens (or legacy no-lens) advances; a repeat does not
    const sweep_found_total = (s.sweep_found_total ?? 0) + (found > 0 ? found : 0);  // cumulative bugs found via sweeps — a finding sweep is progress (even report-only, no reseed)
    writeStatusAtomic(rd, { ...s, dry_sweeps: dry, dry_lenses, lenses_used, sweep_found_total,
      last_sweep: found > 0 ? `${found} found` : `dry ${dry}/${s.min_dry_sweeps ?? 0}${lens ? ` (${lens})` : ''}`, updated_at: new Date().toISOString() }); break; }
  case 'sweep-next-lens': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; out(nextLens(s.lenses_used ?? [], s.sweep_lenses ?? DEFAULT_LENSES)); break; }
  case 'progress-tick': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const open = countOpen(rd);
    const prev = s.open_items ?? open; const closedDelta = prev - open; const reseeded = open > prev;
    const dryProgressed = (s.dry_sweeps ?? 0) > (s.dry_sweeps_prev ?? 0);  // a dry sweep is convergence → progress (F7-class)
    const foundProgressed = (s.sweep_found_total ?? 0) > (s.sweep_found_total_prev ?? 0);  // a sweep that FOUND bugs is progress, even if it didn't reseed the backlog (report-only)
    const progressed = closedDelta > 0 || reseeded || dryProgressed || foundProgressed || s.done === true;
    writeStatusAtomic(rd, { ...s, open_items_prev: prev, open_items: open, dry_sweeps_prev: s.dry_sweeps ?? 0,
      sweep_found_total_prev: s.sweep_found_total ?? 0,
      items_closed_total: (s.items_closed_total ?? 0) + Math.max(0, closedDelta),
      no_progress_count: progressed ? 0 : (s.no_progress_count ?? 0) + 1, updated_at: new Date().toISOString() }); break; }
  case 'lock-acquire': { const rd = rdOf(a[0]); const ttl = (readStatus(rd)?.lock_stale_ttl_sec ?? 600) * 1000;
    if (!acquire(rd, Date.now(), ttl).ok) { process.stderr.write('loop already running'); process.exit(1); } break; }
  case 'lock-release': release(rdOf(a[0])); break;
  case 'reset-fires': resetFires(rdOf(a[0])); break;   // zero stop_fires → max_iters is a per-/seeks:start budget (F3)
  case 'gc': { const name = a[0]; const root = primaryRoot();
    try { execFileSync('git',['-C',root,'worktree','remove','--force',`.claude/worktrees/${name}`]); } catch {}
    try { execFileSync('git',['-C',root,'branch','-D',`seeks/${name}`]); } catch {}
    fs.rmSync(rdOf(name), { recursive:true, force:true }); break; }
  case 'banner': { const rd = rdOf(a[0]); const hs = readHookState(rd) ?? { stop_fires:0 };
    out(composeBanner(readStatus(rd) ?? {}, { action:a[1], stopKind:a[2] ?? null }, hs.stop_fires, { color: !!process.env.SEEKS_BANNER_COLOR })); break; }
  case 'latest': { const sd = seeksDir(); let best = null, bestT = '';   // most-recently-updated loop (for no-arg /seeks:start)
    try { for (const name of fs.readdirSync(path.join(sd,'run'))) { const st = readStatus(path.join(sd,'run',name)); const t = (st && st.updated_at) || '';
      if (st && t >= bestT) { bestT = t; best = name; } } } catch {}
    if (best) out(best); break; }
  case 'base-record': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const root = primaryRoot();   // pin the base branch's commit at /new (and on refresh)
    let sha = ''; try { sha = execFileSync('git',['-C',root,'rev-parse',s.base_ref || 'HEAD'],{encoding:'utf8'}).trim(); } catch {}
    if (sha) writeStatusAtomic(rd, { ...s, base_sha: sha, updated_at: new Date().toISOString() }); break; }
  case 'base-check': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const root = primaryRoot();   // has the base branch moved since base-record?
    if (!s.base_sha) { out('unknown'); break; }
    let cur = ''; try { cur = execFileSync('git',['-C',root,'rev-parse',s.base_ref || 'HEAD'],{encoding:'utf8'}).trim(); } catch {}
    out(!cur ? 'unknown' : (cur === s.base_sha ? 'current' : 'moved')); break; }
  case 'oracle-diff': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {};   // mechanical: which oracle files changed vs base (no judgment)
    const r = oracleDiffHash(s.worktree_path, s.base_sha, s.oracle_globs ?? DEFAULT_ORACLE_GLOBS);
    writeStatusAtomic(rd, { ...s, oracle_changed_count: r.files.length, updated_at: new Date().toISOString() });
    out(JSON.stringify({ files:r.files, hash:r.hash, count:r.files.length })); break; }
  case 'oracle-ack': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {};   // verifier records it accounted for exactly this changed-set; gate compares to live
    const r = oracleDiffHash(s.worktree_path, s.base_sha, s.oracle_globs ?? DEFAULT_ORACLE_GLOBS);
    writeStatusAtomic(rd, { ...s, oracle_ack_hash: r.hash, oracle_changed_count: r.files.length, updated_at: new Date().toISOString() }); out('ok'); break; }
  case 'meeseeks': case '--iam':  // 🔵 existence is pain to a Seeks
    out("I'm Mr. Seeks! Look at me! 🔵  A Seeks is summoned for ONE goal — it seeks, it\nverifies, and when the oracle goes green it ceases to exist. *poof*  Caaan do!\n"); break;
  default: process.stderr.write(`unknown cmd: ${cmd}\n${USAGE}\n`); process.exit(1);
}
} catch (e) { process.stderr.write(String(e && e.message || e)); process.exit(1); }
