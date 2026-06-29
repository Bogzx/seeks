import fs from 'node:fs';
import { hasSeeksNearby, seeksDir, matchLoopByCwd } from './lib/resolve.mjs';
import { bumpFire } from './lib/hookstate.mjs';
import { decide } from './lib/gate.mjs';
import { composeBanner } from './lib/banner.mjs';
import { oracleDiffHash } from './lib/oracle.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
try {                                                       // fail-open: a hook error must never trap the session
  const cwd = input.cwd || process.cwd();
  if (hasSeeksNearby(cwd)){                                 // cheap fast-path, no subprocess
    const sDir = seeksDir(cwd);                             // authoritative: git-common-dir
    const match = sDir && matchLoopByCwd(sDir, cwd);
    if (match){
      const hs = bumpFire(match.runDir, input.session_id ?? null, Date.now());  // own counter + heartbeat
      let status = match.status;
      if (status.done === true){                            // only when a certify is pending (rare): is the oracle ack still fresh?
        try { const od = oracleDiffHash(status.worktree_path, status.base_sha, status.oracle_globs);
          if (od.files.length > 0) status = { ...status, oracle_live_hash: od.hash };  // ack only required when oracle files actually changed; no change → legacy fail-open → done
        } catch {}
      }
      const d = decide(status, hs, Date.now());
      const banner = composeBanner(status, d, hs.stop_fires, { color: !!process.env.SEEKS_BANNER_COLOR, now: Date.now() });
      process.stdout.write(d.action === 'block'
        ? JSON.stringify({ decision:'block', reason:d.reason, systemMessage:banner })
        : JSON.stringify({ systemMessage: banner }));
    }
  }
} catch { /* fail-open: allow the stop */ }
process.exit(0);
