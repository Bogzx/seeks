import fs from 'node:fs'; import path from 'node:path';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
// A crash row, even when the crash is a lib that fails to IMPORT (a missing or corrupt hooks/lib
// file). The libs load inside the try below, so that throw is caught too; the logger itself is
// loaded lazily, and if IT is what's broken, the row is appended with builtins only to the
// nearest .seeks/decisions.jsonl. Still fail-open: the hook exits 0 either way.
async function logCrash(dir, rec){
  try { const { appendDecision } = await import('./lib/decisions.mjs'); if (appendDecision(dir ?? nearestPlane(), rec)) return; } catch {}
  try { const d = dir ?? nearestPlane(); if (d) fs.appendFileSync(path.join(d, 'decisions.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`); } catch {}
}
function nearestPlane(){
  let d = path.resolve(input.cwd || process.cwd());
  for (;;){ const p = path.join(d, '.seeks'); try { if (fs.statSync(p).isDirectory()) return p; } catch {} const up = path.dirname(d); if (up === d) return null; d = up; }
}
let runDir = null, sDir = null;                             // hoisted so a crash is still recordable: the run dir if we got
try {                                                       // fail-open: a hook error must never trap the session
  const [{ hasSeeksNearby, seeksDir, matchLoopByCwd }, { bumpFire, latchRelease, recordVerification }, { decide, readyForGateCheck },
    { composeBanner }, { oracleDiffHash, oracleModifiedPreexisting, DEFAULT_ORACLE_GLOBS, manifestDiffMode }, { appendDecision },
    { readStatus, writeStatusAtomic }, { executableConditions, runConditions, treeFingerprint, applyConditionReject }] = await Promise.all([
    import('./lib/resolve.mjs'), import('./lib/hookstate.mjs'), import('./lib/gate.mjs'), import('./lib/banner.mjs'), import('./lib/oracle.mjs'),
    import('./lib/decisions.mjs'), import('./lib/status.mjs'), import('./lib/verify.mjs')]);
  // Merge into the CURRENT status (the CLI may have written since we read it), atomically.
  const patchStatus = (rd, patch) => writeStatusAtomic(rd, { ...(readStatus(rd) ?? {}), ...patch, updated_at: new Date().toISOString() });
  const cwd = input.cwd || process.cwd();                   // that far, else the plane-level .seeks
  if (hasSeeksNearby(cwd)){                                 // cheap fast-path, no subprocess
    sDir = seeksDir(cwd);                                   // authoritative: git-common-dir
    const match = sDir && matchLoopByCwd(sDir, cwd);
    if (match){
      runDir = match.runDir;
      const hs = bumpFire(match.runDir, input.session_id ?? null, Date.now());  // own counter + heartbeat
      // Values only this hook computes: whatever status.json claims for them is discarded.
      let status = { ...match.status, oracle_live_hash: undefined, conditions_live: undefined, oracle_modified: undefined };
      if (status.verifier_certified === true){              // only when a certify is pending (rare): is the oracle ack still fresh?
        try { const od = oracleDiffHash(status.worktree_path, status.base_sha, status.oracle_globs);
          if (od.files.length > 0) status = { ...status, oracle_live_hash: od.hash };  // ack only required when oracle files actually changed
        } catch {}
      }
      // The verifier has signed off and every other bar is met: run the done-conditions HERE, in
      // the worktree, and release `done` only on their exit codes. A tree the gate already
      // verified (same fingerprint) is not re-run — that is what makes the L3 deliver round-trip
      // cheap. Any edit changes the fingerprint and forces a fresh run.
      let ran = null;
      if (readyForGateCheck(status)){
        const om = oracleModifiedPreexisting(status.worktree_path, status.base_sha, status.oracle_globs ?? DEFAULT_ORACLE_GLOBS, { manifestDiff: manifestDiffMode(status) });
        if (om) status = { ...status, oracle_modified: om.map(o => `${o.file} (${o.change})`) };
        const fp = treeFingerprint(status.worktree_path);
        const v = hs.verified;
        if (fp && v && v.ok === true && (v.tree === fp || v.tree_after === fp)) status = { ...status, conditions_live: { ok: true, cached: true } };
        else {
          ran = runConditions(executableConditions(status), status.worktree_path, { timeoutSec: status.condition_timeout_sec });
          recordVerification(match.runDir, { ok: ran.ok, tree: fp, tree_after: treeFingerprint(status.worktree_path), at: Date.now(),
            results: ran.results.map(({ id, exit, want, ok, ms }) => ({ id, exit, want, ok, ms })) });
          status = { ...status, conditions_live: { ok: ran.ok, failed: ran.results.filter(r => !r.ok) } };
          if (ran.shell?.warning) appendDecision(match.runDir, { hook:'stop-gate', action:'warn', rule:'condition-shell', reason: ran.shell.warning, session: input.session_id ?? null });
        }
      }
      const d = decide(status, hs, Date.now());
      if (ran && !ran.ok){                                  // the maker's (or verifier's) "pass" didn't hold up: clear it
        const f = ran.results.find(r => !r.ok);
        patchStatus(match.runDir, { verifier_certified: false, done: false, last_verdict: `gate REJECT (${f.id}: exit ${f.exit ?? f.tail})`,
          ...applyConditionReject(readStatus(match.runDir) ?? {}, f.id) });
      }
      if (d.detail === 'oracle-modified'){                  // green, but on a changed oracle: a human decides
        const last_verdict = `green, but oracle files changed: ${status.oracle_modified.join(', ')} — review the diff (to accept: status-set oracle_modified_policy "ack", then /seeks:start)`;
        status = { ...status, last_verdict };
        patchStatus(match.runDir, { last_verdict, oracle_modified: status.oracle_modified, needs_human: true });
      }
      if (d.action === 'allow' && d.stopKind === 'done')    // the ONLY writer of done:true
        patchStatus(match.runDir, { done: true, gate_verified_at: new Date().toISOString() });
      if (d.action === 'allow' && d.stopKind)                  // terminal → latch the release: this banner prints ONCE, then
        latchRelease(match.runDir, d.stopKind, Date.now());     // matchLoopByCwd skips the loop until /seeks:start re-arms it
      const banner = composeBanner(status, d, hs.stop_fires, { color: !!process.env.SEEKS_BANNER_COLOR, now: Date.now() });
      appendDecision(match.runDir, { hook:'stop-gate', action: d.action, rule: d.stopKind ? `stop:${d.stopKind}` : 'continue',
        stop_kind: d.stopKind ?? null, reason: d.reason ?? null, stop_fires: hs.stop_fires ?? null,
        ...(ran ? { conditions: ran.results.map(({ id, exit, ok }) => ({ id, exit, ok })) } : {}),
        session: input.session_id ?? null });   // why the loop kept going (or stopped) is now replayable via `seeks why`
      // Two audiences, two channels. Claude Code surfaces a Stop-block `reason` to the USER
      // (rendered as "Stop hook feedback"), NOT just to the model — so putting the verbose
      // per-pass continue-instruction there spams the transcript on every single pass. The
      // user sees only the one-line `banner`; the model gets the detailed steering via
      // additionalContext (a system reminder, not shown to the user). The loop skill also
      // carries the per-pass discipline, so steering survives even if a client drops
      // additionalContext on a block.
      process.stdout.write(d.action === 'block'
        ? JSON.stringify({ decision:'block', reason:banner, systemMessage:banner,
            hookSpecificOutput: { hookEventName:'Stop', additionalContext: d.reason } })
        : JSON.stringify({ systemMessage: banner }));
    }
  }
} catch (e) {   // fail-open: allow the stop — but record it, or a crashed gate is indistinguishable from a clean release
  await logCrash(runDir ?? sDir, { hook:'stop-gate', action:'crash', rule:'hook-crash',
    error: String((e && e.stack) || e), session: input.session_id ?? null });
}
process.exit(0);
