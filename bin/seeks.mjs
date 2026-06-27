import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { readStatus, writeStatusAtomic } from '../hooks/lib/status.mjs';
import { runDir, primaryRoot } from '../hooks/lib/resolve.mjs';
import { acquire, release } from '../hooks/lib/lock.mjs';
import { readHookState } from '../hooks/lib/hookstate.mjs';
import { composeBanner } from '../hooks/lib/banner.mjs';
const [cmd, ...a] = process.argv.slice(2);
const out = (x) => process.stdout.write(typeof x === 'string' ? x : JSON.stringify(x));
const backlog = (rd) => path.join(rd,'backlog.md');
const countOpen = (rd) => { try { return (fs.readFileSync(backlog(rd),'utf8').match(/^- \[ \] /gm) || []).length; } catch { return 0; } };
const rdOf = (name) => runDir(name);
try {
switch (cmd) {
  case 'init': { const rd = rdOf(a[0]); fs.mkdirSync(rd,{recursive:true}); writeStatusAtomic(rd, JSON.parse(a[1]));
    for (const f of ['backlog.md','state.md','log.md','summary.md']) { const p = path.join(rd,f); if (!fs.existsSync(p)) fs.writeFileSync(p,''); }
    fs.mkdirSync(path.join(rd,'verify'),{recursive:true}); break; }
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
  case 'progress-tick': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const open = countOpen(rd);
    const prev = s.open_items ?? open; const closedDelta = prev - open; const reseeded = open > prev;
    const progressed = closedDelta > 0 || reseeded;
    writeStatusAtomic(rd, { ...s, open_items_prev: prev, open_items: open,
      items_closed_total: (s.items_closed_total ?? 0) + Math.max(0, closedDelta),
      no_progress_count: progressed ? 0 : (s.no_progress_count ?? 0) + 1, updated_at: new Date().toISOString() }); break; }
  case 'lock-acquire': { const rd = rdOf(a[0]); const ttl = (readStatus(rd)?.lock_stale_ttl_sec ?? 600) * 1000;
    if (!acquire(rd, Date.now(), ttl).ok) { process.stderr.write('loop already running'); process.exit(1); } break; }
  case 'lock-release': release(rdOf(a[0])); break;
  case 'gc': { const name = a[0]; const root = primaryRoot();
    try { execFileSync('git',['-C',root,'worktree','remove','--force',`.claude/worktrees/${name}`]); } catch {}
    try { execFileSync('git',['-C',root,'branch','-D',`seeks/${name}`]); } catch {}
    fs.rmSync(rdOf(name), { recursive:true, force:true }); break; }
  case 'banner': { const rd = rdOf(a[0]); const hs = readHookState(rd) ?? { stop_fires:0 };
    out(composeBanner(readStatus(rd) ?? {}, { action:a[1], stopKind:a[2] ?? null }, hs.stop_fires)); break; }
  default: process.stderr.write(`unknown cmd: ${cmd}`); process.exit(1);
}
} catch (e) { process.stderr.write(String(e && e.message || e)); process.exit(1); }
