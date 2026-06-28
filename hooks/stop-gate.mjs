import fs from 'node:fs';
import { hasSeeksNearby, seeksDir, matchLoopByCwd } from './lib/resolve.mjs';
import { bumpFire } from './lib/hookstate.mjs';
import { decide } from './lib/gate.mjs';
import { composeBanner } from './lib/banner.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
const cwd = input.cwd || process.cwd();
if (!hasSeeksNearby(cwd)) process.exit(0);          // cheap fast-path, no subprocess
const sDir = seeksDir(cwd);                          // authoritative: git-common-dir
if (!sDir) process.exit(0);
const match = matchLoopByCwd(sDir, cwd);
if (!match) process.exit(0);
const hs = bumpFire(match.runDir, input.session_id ?? null, Date.now());  // own counter + heartbeat
const d = decide(match.status, hs);
const banner = composeBanner(match.status, d, hs.stop_fires, { color: !!process.env.SEEKS_BANNER_COLOR });
process.stdout.write(d.action === 'block'
  ? JSON.stringify({ decision:'block', reason:d.reason, systemMessage:banner })
  : JSON.stringify({ systemMessage: banner }));
process.exit(0);
