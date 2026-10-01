import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { readStatus, writeStatusAtomic } from '../hooks/lib/status.mjs';
import { runDir, primaryRoot, seeksDir, latestLoop } from '../hooks/lib/resolve.mjs';
import { acquire, release, isHeld } from '../hooks/lib/lock.mjs';
import { readHookState, resetFires } from '../hooks/lib/hookstate.mjs';
import { composeBanner } from '../hooks/lib/banner.mjs';
import { nextLens, DEFAULT_LENSES } from '../hooks/lib/lenses.mjs';
import { sweepProgress } from '../hooks/lib/sweep.mjs';
import { oracleDiffHash, oracleGlobsPresent, DEFAULT_ORACLE_GLOBS, gitVersion } from '../hooks/lib/oracle.mjs';
import { DEFAULT_DENYLIST } from '../hooks/lib/policy.mjs';
import { deliver } from '../hooks/lib/deliver.mjs';
import os from 'node:os';
import { TIERS, resolveTier } from '../hooks/lib/tiers.mjs';
import { preflightAssess } from '../hooks/lib/detect.mjs';
import { readDecisionsMerged, formatDecisions, summarizeDecisions } from '../hooks/lib/decisions.mjs';
import { strictBashEnabled, STRICT_BASH_ALLOW } from '../hooks/lib/policy.mjs';
import { splitPatch, isLive, readGrant, consumeGrant } from '../hooks/lib/control.mjs';
import { applyConditionReject, treeFingerprint } from '../hooks/lib/verify.mjs';
import { isInside } from '../hooks/lib/paths.mjs';
import { parseDuration } from '../hooks/lib/budget.mjs';
const [cmd, ...a] = process.argv.slice(2);
const out = (x) => process.stdout.write(typeof x === 'string' ? x : JSON.stringify(x));
const backlog = (rd) => path.join(rd,'backlog.md');
const countOpen = (rd) => { try { return (fs.readFileSync(backlog(rd),'utf8').match(/^- \[ \] /gm) || []).length; } catch { return 0; } };
const rdOf = (name) => runDir(name);
const userCfg = () => path.join(process.env.SEEKS_HOME || os.homedir(), '.claude', 'seeks.json');
const die = (msg) => { process.stderr.write(`[seeks] ${msg}\n`); process.exit(1); };
const nowIso = () => new Date().toISOString();
// Is a loop's brake-pedal currently held by the gate? (armed, and not released by a terminal verdict)
const liveOf = (rd) => { const st = readStatus(rd); return { st, live: isLive(st, readHookState(rd)) }; };
// The brakes of a LIVE loop move only with a grant the UserPromptSubmit hook minted when the user
// typed /seeks:start|stop|delete (see hooks/lib/control.mjs). consume=true spends it.
const GRANT_HINT = 'This changes the brakes of a running loop, which only the user can do: it needs the one-shot grant the UserPromptSubmit hook issues when the user types /seeks:start, /seeks:stop or /seeks:delete. The maker must not work around this — end the pass and let the gate decide.';
function authorize(rd, what, { consume = false } = {}){
  const { live } = liveOf(rd); const sd = seeksDir(); const loop = path.basename(rd);
  const g = consume ? consumeGrant(sd, Date.now(), { loop }) : readGrant(sd, Date.now(), { loop });
  if (!live || g) return g;
  die(`refusing to ${what} on live loop "${path.basename(rd)}". ${GRANT_HINT}`);
}
// Other live loops whose worktree nests with this one's: arming such a loop would put a second
// gate over the maker's worktree (matchLoopByCwd takes the first armed match) — a shadow loop
// with trivial conditions would release the real one.
function overlappingLiveLoops(name, wt){
  if (!wt) return [];
  const runRoot = path.join(seeksDir(), 'run'); let names = []; try { names = fs.readdirSync(runRoot); } catch {}
  return names.filter(n => n !== name).filter(n => { const rd = path.join(runRoot, n);
    let st; try { st = readStatus(rd); } catch { return false; }
    return st?.worktree_path && isLive(st, readHookState(rd)) && (isInside(wt, st.worktree_path) || isInside(st.worktree_path, wt)); });
}
const USAGE = `seeks <cmd> <name> [args]
  init <name> <json>            status-get <name>             status-set <name> <patch-json>
  condition-reject <name> <id>  backlog-add <name> <task...>  backlog-count <name>
  log-add <name> <line...>      sweep-tick <name> <found> [lens]   sweep-next-lens <name>
  sweep-status <name>           progress-tick <name>               reset-fires <name>
  lock-acquire <name>
  budget-set <name> <sec>       start-clock <name>
  lock-release <name>           gc <name>                          banner <name> <action> [stopKind]
  latest                        seeks-dir                          base-record <name>   base-check <name>
  oracle-diff <name>            oracle-ack <name>                   deliver <name>
  tier-get                      tier-set <light|balanced|all-out>   role <name>
  why <name> [--last N] [--denied] [--crashes] [--tool T] [--rule R] [--json]
  start <name> [--budget <dur>] [--max-iters N] [--resume]    stop <name>    certify <name>
  run <name> [--goal "<text>" --check "<cmd>"…] [--budget <dur>] [--max-iters N] [--strict] [--dry-run]
                                headless: drive the loop with a separate "claude -p" maker; exit 0 only on done
  preflight                     --version`;
// Single source of truth for the installed build: plugin.json ships with the plugin, so it is
// what /seeks:doctor can actually attest to. smoke.test.mjs pins it equal to package.json.
const pluginVersion = () => { try { return JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url),'utf8')).version || 'unknown'; } catch { return 'unknown'; } };
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }
if (cmd === '--version' || cmd === '-v' || cmd === 'version') { process.stdout.write(pluginVersion() + '\n'); process.exit(0); }
try {
switch (cmd) {
  case 'init': { const rd = rdOf(a[0]); fs.mkdirSync(rd,{recursive:true});
    const st = JSON.parse(a[1]);
    authorize(rd, 're-init');                                      // re-init'ing a running loop would reset every budget at once
    Object.assign(st, { armed:false, done:false, verifier_certified:false });   // a loop is born disarmed; only `seeks start` arms it
    if (Array.isArray(st.conditions)) {                          // structured done-conditions → fail-closed: must have a real check or be explicitly human-judged
      const exec = st.conditions.filter(c => c && c.cmd && !c.human_required).length;
      const human = st.conditions.some(c => c && c.human_required);
      if (exec === 0 && !human) { process.stderr.write('[seeks] init refused: a loop needs >=1 executable done-condition (with a cmd) or an explicit human_required condition'); process.exit(1); }
      st.executable_condition_count = exec;
    }
    if (!st.level) st.level = 'L2';                               // persist level/globs/denylist so the PreToolUse hook reads them from status alone
    if (!st.oracle_globs) st.oracle_globs = DEFAULT_ORACLE_GLOBS;
    if (!st.denylist) st.denylist = DEFAULT_DENYLIST;
    writeStatusAtomic(rd, st);
    for (const f of ['backlog.md','log.md']) { const p = path.join(rd,f); if (!fs.existsSync(p)) fs.writeFileSync(p,''); }  // not state.md/summary.md — those are Written wholesale; pre-creating empties forces a Read-before-Write (F4)
    fs.mkdirSync(path.join(rd,'verify'),{recursive:true}); out('ok'); break; }  // F17: confirm success, no status-get round-trip
  case 'status-get': out(readStatus(rdOf(a[0])) ?? {}); break;
  case 'status-set': { const rd = rdOf(a[0]); const cur = readStatus(rd) ?? {};
    const { allowed, refused } = splitPatch(JSON.parse(a[1]), { live: isLive(cur, readHookState(rd)), granted: !!readGrant(seeksDir(), Date.now(), { loop: a[0] }) });
    writeStatusAtomic(rd, { ...cur, ...allowed, updated_at: nowIso() });
    if (refused.length) die(`status-set refused ${refused.join(', ')} (applied: ${Object.keys(allowed).join(', ') || 'nothing'}). `
      + 'armed → seeks start/stop · verifier_certified → seeks certify · done → only the Stop gate, after it ran the done-conditions itself. '
      + 'Budget, sweep, oracle and policy keys are frozen while the loop is live. ' + GRANT_HINT);
    break; }
  case 'condition-reject': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {};
    writeStatusAtomic(rd, { ...s, ...applyConditionReject(s, a[1]), updated_at: nowIso() }); break; }
  case 'backlog-add': fs.appendFileSync(backlog(rdOf(a[0])), `- [ ] ${a.slice(1).join(' ').replace(/\s*[\r\n]+\s*/g,' ').trim()}\n`); break;  // collapse embedded newlines: one item = one line so countOpen (/^- \[ \] /gm) stays in sync
  case 'backlog-count': out(String(countOpen(rdOf(a[0])))); break;
  case 'log-add': fs.appendFileSync(path.join(rdOf(a[0]),'log.md'), `${a.slice(1).join(' ')}\n`); break;  // F15: sanctioned log append (create-on-write)
  case 'sweep-tick': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const found = parseInt(a[1] ?? '0',10) || 0; const lens = a[2] || null;
    const catalog = s.sweep_lenses ?? DEFAULT_LENSES;
    const lensCap = Math.max(catalog.length * 4, 64);                             // bound the LRU history: the tail is all nextLens needs (anything older is already "least-recently-used")
    const usedAppended = lens ? [...(s.lenses_used ?? []), lens] : (s.lenses_used ?? []);
    const lenses_used = usedAppended.length > lensCap ? usedAppended.slice(-lensCap) : usedAppended;
    let dry = s.dry_sweeps ?? 0; let dry_lenses = [...(s.dry_lenses ?? [])];
    if (found > 0) { dry = 0; dry_lenses = []; }                                  // found → re-seed, reset the dry streak
    else if (!lens || !dry_lenses.includes(lens)) { dry += 1; if (lens) dry_lenses.push(lens); } // a DISTINCT lens (or legacy no-lens) advances; a repeat does not
    const sweep_found_total = (s.sweep_found_total ?? 0) + (found > 0 ? found : 0);  // cumulative bugs found via sweeps — a finding sweep is progress (even report-only, no reseed)
    let depth = s.depth, dry_depth_rounds = s.dry_depth_rounds;                      // exhaustive mode: a full-catalog dry sweep deepens the review
    if (s.exhaustive === true && found === 0 && catalog.every(l => dry_lenses.includes(l))) {
      depth = (s.depth ?? 1) + 1;                       // covered every angle dry → go deeper
      dry_depth_rounds = (s.dry_depth_rounds ?? 0) + 1;
      dry = 0; dry_lenses = [];                         // reset the streak to re-cover the catalog at the new depth
    }
    writeStatusAtomic(rd, { ...s, dry_sweeps: dry, dry_lenses, lenses_used, sweep_found_total,
      ...(depth !== undefined ? { depth } : {}), ...(dry_depth_rounds !== undefined ? { dry_depth_rounds } : {}),
      last_sweep: found > 0 ? `${found} found` : `dry ${dry}/${s.min_dry_sweeps ?? 0}${lens ? ` (${lens})` : ''}${s.exhaustive ? ` · depth ${depth ?? 1}` : ''}`,
      updated_at: new Date().toISOString() }); break; }
  case 'sweep-next-lens': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; out(nextLens(s.lenses_used ?? [], s.sweep_lenses ?? DEFAULT_LENSES)); break; }
  case 'sweep-status': out(JSON.stringify(sweepProgress(readStatus(rdOf(a[0])) ?? {}))); break;   // the gate's sweep predicate, for the skill to consult BEFORE certifying
  case 'progress-tick': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const open = countOpen(rd);
    const prev = s.open_items ?? open; const closedDelta = prev - open; const reseeded = open > prev;
    const dryProgressed = (s.dry_sweeps ?? 0) > (s.dry_sweeps_prev ?? 0);  // a dry sweep is convergence → progress (F7-class)
    const foundProgressed = (s.sweep_found_total ?? 0) > (s.sweep_found_total_prev ?? 0);  // a sweep that FOUND bugs is progress, even if it didn't reseed the backlog (report-only)
    const progressed = closedDelta > 0 || reseeded || dryProgressed || foundProgressed || s.done === true || s.verifier_certified === true;   // a certify pass is progress (the gate, not the maker, now writes done)
    writeStatusAtomic(rd, { ...s, open_items_prev: prev, open_items: open, dry_sweeps_prev: s.dry_sweeps ?? 0,
      sweep_found_total_prev: s.sweep_found_total ?? 0,
      items_closed_total: (s.items_closed_total ?? 0) + Math.max(0, closedDelta),
      no_progress_count: progressed ? 0 : (s.no_progress_count ?? 0) + 1, updated_at: new Date().toISOString() }); break; }
  case 'lock-acquire': { const rd = rdOf(a[0]); const ttl = (readStatus(rd)?.lock_stale_ttl_sec ?? 600) * 1000;
    if (!acquire(rd, Date.now(), ttl).ok) { process.stderr.write('loop already running'); process.exit(1); } break; }
  case 'lock-release': release(rdOf(a[0])); break;
  case 'reset-fires': authorize(rdOf(a[0]), 'reset the iteration counter'); resetFires(rdOf(a[0])); break;   // zero stop_fires (max_iters is a per-/seeks:start budget, F3) + clear the release latch (re-activates a gate-released loop)
  case 'budget-set': { const rd = rdOf(a[0]); authorize(rd, 'change the time budget'); const s = readStatus(rd) ?? {};   // wall-clock budget (sec); enforced by gate + pre-tool
    writeStatusAtomic(rd, { ...s, time_budget_sec: Number(a[1]) || null, updated_at: new Date().toISOString() }); out('ok'); break; }
  case 'start-clock': { const rd = rdOf(a[0]); authorize(rd, 'restart the clock'); const s = readStatus(rd) ?? {};   // stamp start so the budget is per-/seeks:start
    writeStatusAtomic(rd, { ...s, started_at: Date.now(), updated_at: new Date().toISOString() }); out('ok'); break; }
  case 'gc': { const name = a[0]; const force = a.includes('--force'); const root = primaryRoot(); const rd = rdOf(name);
    let live = false; try { live = liveOf(rd).live; } catch {}                // a corrupt status.json can't be read as live
    if (live && !readGrant(seeksDir(), Date.now(), { loop: name })) die(`refusing to gc live loop "${name}" (not even with --force). ${GRANT_HINT}`);
    if (!force) {                                                                   // --force skips the HEARTBEAT check — must work even when status.json is corrupt (the stuck-loop case --force exists for); it never overrides the live-loop grant check above
      let ttl = 600000; try { ttl = ((readStatus(rd)?.lock_stale_ttl_sec) ?? 600) * 1000; } catch {}   // a corrupt status.json must not throw and block teardown
      if (isHeld(rd, Date.now(), ttl)) { process.stderr.write(`[seeks] refusing to gc "${name}": loop heartbeat is fresh (running). Run /seeks:stop first, or pass --force.`); process.exit(1); }
    }
    if (live) consumeGrant(seeksDir(), Date.now(), { loop: name });              // one delete per /seeks:delete (after the heartbeat check, so a refusal there leaves it for stop)
    try { execFileSync('git',['-C',root,'worktree','remove','--force',`.claude/worktrees/${name}`]); } catch {}
    try { execFileSync('git',['-C',root,'branch','-D',`seeks/${name}`]); } catch {}
    fs.rmSync(rd, { recursive:true, force:true }); break; }
  case 'banner': { const rd = rdOf(a[0]); const hs = readHookState(rd) ?? { stop_fires:0 };
    out(composeBanner(readStatus(rd) ?? {}, { action:a[1], stopKind:a[2] ?? null }, hs.stop_fires, { color: !!process.env.SEEKS_BANNER_COLOR })); break; }
  case 'seeks-dir': { const s = seeksDir(); if (!s) die('not inside a git repository'); out(s); break; }   // absolute .seeks, for the skill/commands (no git-version-specific flags)
  case 'latest': { const best = latestLoop(seeksDir()); if (best) out(best); break; }   // most-recently-updated loop (for no-arg /seeks:start)
  case 'tier-get': { let tier = null;   // global per-user usage tier (~/.claude/seeks.json); resolves to its preset
    try { tier = JSON.parse(fs.readFileSync(userCfg(),'utf8')).tier; } catch {}
    if (!tier || !TIERS[tier]) { out('none'); break; }
    const p = resolveTier(tier);
    out(JSON.stringify({ tier, roles:p.roles, max_iters:p.max_iters, max_iters_openended:p.max_iters_openended, min_dry_sweeps:p.min_dry_sweeps })); break; }
  case 'tier-set': { const name = a[0];
    if (!TIERS[name]) { process.stderr.write(`unknown tier: ${name} (use: ${Object.keys(TIERS).join(', ')})`); process.exit(1); }
    const f = userCfg(); fs.mkdirSync(path.dirname(f), { recursive:true });
    const tmp = `${f}.tmp.${process.pid}`; fs.writeFileSync(tmp, JSON.stringify({ tier:name }, null, 2)); fs.renameSync(tmp, f); out('ok'); break; }
  case 'role': { const sd = seeksDir(); let roles = {};   // {model,effort} for a role from .seeks/config.json — for dispatch
    try { roles = JSON.parse(fs.readFileSync(path.join(sd,'config.json'),'utf8')).roles || {}; } catch {}
    out(JSON.stringify(roles[a[0]] || {})); break; }
  case 'base-record': { const rd = rdOf(a[0]); authorize(rd, 're-pin the oracle base'); const s = readStatus(rd) ?? {}; const root = primaryRoot();   // pin the base branch's commit at /new (and on refresh)
    let sha = ''; try { sha = execFileSync('git',['-C',root,'rev-parse',s.base_ref || 'HEAD'],{encoding:'utf8'}).trim(); } catch {}
    if (sha) writeStatusAtomic(rd, { ...s, base_sha: sha, updated_at: new Date().toISOString() }); break; }
  case 'base-check': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const root = primaryRoot();   // has the base branch moved since base-record?
    if (!s.base_sha) { out('unknown'); break; }
    let cur = ''; try { cur = execFileSync('git',['-C',root,'rev-parse',s.base_ref || 'HEAD'],{encoding:'utf8'}).trim(); } catch {}
    out(!cur ? 'unknown' : (cur === s.base_sha ? 'current' : 'moved')); break; }
  case 'oracle-diff': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {};   // mechanical: which oracle files changed vs base (no judgment)
    const globs = s.oracle_globs ?? DEFAULT_ORACLE_GLOBS;
    const r = oracleDiffHash(s.worktree_path, s.base_sha, globs);
    const present = oracleGlobsPresent(s.worktree_path, globs);                   // 0 → vacuous accounting (no test-glob files to hash)
    writeStatusAtomic(rd, { ...s, oracle_changed_count: r.files.length, oracle_globs_present: present, updated_at: new Date().toISOString() });
    out(JSON.stringify({ files:r.files, hash:r.hash, count:r.files.length, globs_present: present })); break; }
  case 'oracle-ack': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {};   // verifier records it accounted for exactly this changed-set; gate compares to live
    const r = oracleDiffHash(s.worktree_path, s.base_sha, s.oracle_globs ?? DEFAULT_ORACLE_GLOBS);
    writeStatusAtomic(rd, { ...s, oracle_ack_hash: r.hash, oracle_changed_count: r.files.length, updated_at: new Date().toISOString() }); out('ok'); break; }
  case 'deliver': { const rd = rdOf(a[0]); const s = readStatus(rd) ?? {}; const root = primaryRoot();   // L3 autonomous delivery: push + open PR (never merges); degrades pr→push→local
    if (String(s.level || 'L2').toUpperCase() !== 'L3'){ process.stderr.write('deliver is L3-only'); process.exit(1); }
    // While the loop runs, only a tree the Stop gate itself verified (same fingerprint it ran the
    // done-conditions on) may leave the machine. Once the loop is released or disarmed, delivery is
    // the user's call (/seeks:harvest), so it is not gated.
    if (isLive(s, readHookState(rd))){
      const v = readHookState(rd)?.verified; const fp = treeFingerprint(s.worktree_path);
      if (!(v && v.ok === true && fp && (v.tree === fp || v.tree_after === fp)))
        die(`refusing to deliver "${a[0]}": the Stop gate has not verified this tree (${!v ? 'it has not run the done-conditions yet' : !v.ok ? 'its last run failed' : 'the tree changed since it verified'}). Certify with the verifier, end your turn, and deliver when the gate's block reason asks for it.`);
    }
    let body = 'Automated by seeks. Review the diff; the merge is yours.';
    try { const sm = fs.readFileSync(path.join(rd,'summary.md'),'utf8'); if (sm.trim()) body = sm; } catch {}
    const r = deliver(a[0], { root, branch:`seeks/${a[0]}`, base_ref: s.base_ref, title:`seeks: ${a[0]}`, body });
    writeStatusAtomic(rd, { ...s, delivered:true, delivery_mode:r.mode, pr_url:r.pr_url, delivery_note:r.note, updated_at: new Date().toISOString() });
    out(JSON.stringify({ delivered:true, mode:r.mode, pr_url:r.pr_url, note:r.note })); break; }
  case 'start': {           // arm + fresh budget in ONE step (was: status-set armed + reset-fires + budget-set + start-clock)
    const name = a[0]; const rd = rdOf(name); const st = readStatus(rd);
    if (!st) die(`no loop "${name}" — /seeks:new first`);
    const flag = (n) => { const i = a.indexOf(n); return i === -1 ? null : a[i+1]; };
    const overlap = overlappingLiveLoops(name, st.worktree_path);
    const g = consumeGrant(seeksDir(), Date.now(), { loop: name });   // spend the grant the user typed for THIS loop
    if ((liveOf(rd).live || overlap.length) && !g)
      die(`refusing to start "${name}": ${overlap.length ? `live loop(s) ${overlap.join(', ')} already gate this worktree` : 'it is already live'}. ${GRANT_HINT}`);
    // --resume (used by `seeks run --resume` after a crash): re-arm WITHOUT a fresh budget — the
    // iteration counter, the clock and the guards carry on. Only for a loop the gate never released.
    const resume = a.includes('--resume');
    if (resume && readHookState(rd)?.released) die(`"${name}" already ended (${readHookState(rd).released}) — start it fresh, without --resume`);
    const patch = resume ? { armed:true } : { armed:true, done:false, verifier_certified:false, needs_human:false, no_progress_count:0, started_at: Date.now() };
    if (flag('--budget') != null){ const sec = parseDuration(flag('--budget')); if (!sec) die(`bad --budget: ${flag('--budget')}`); patch.time_budget_sec = sec; }
    if (flag('--max-iters') != null){ const n = parseInt(flag('--max-iters'),10); if (!(n > 0)) die(`bad --max-iters: ${flag('--max-iters')}`); patch.max_iters = n; }
    writeStatusAtomic(rd, { ...st, ...patch, updated_at: nowIso() });
    if (!resume) resetFires(rd);                               // fresh iteration budget + clear the release latch
    out('ok'); break; }
  case 'stop': {            // disarm; on a live loop only with the user's grant
    const rd = rdOf(a[0]); const st = readStatus(rd); if (!st) die(`no loop "${a[0]}"`);
    authorize(rd, 'disarm', { consume: true });
    writeStatusAtomic(rd, { ...readStatus(rd), armed:false, updated_at: nowIso() }); release(rd); out('ok'); break; }
  case 'certify': {         // the verifier's sign-off. Advice to the gate, not a verdict: the Stop hook
    const rd = rdOf(a[0]); const st = readStatus(rd); if (!st) die(`no loop "${a[0]}"`);   // re-runs the done-conditions itself
    writeStatusAtomic(rd, { ...st, verifier_certified:true, last_verdict:'pass (verifier) — gate re-runs the conditions at stop', certified_at: nowIso(), updated_at: nowIso() });
    out('ok'); break; }
  case 'run': process.exitCode = await (await import('./run.mjs')).runCommand(a); break;   // headless driver (bin/run.mjs)
  case 'why': {             // replay the decision log: exactly why an action was allowed or denied
    const rd = rdOf(a[0]); const rest = a.slice(1);
    const flag = (n, d=null) => { const i = rest.indexOf(n); return i === -1 ? d : (rest[i+1] ?? d); };
    // Both logs: the loop's own, plus the plane-level one that catches crashes thrown before
    // the hook could tell WHICH loop it was in (a corrupt status.json).
    const dirs = [rd, seeksDir()];
    const filters = { tool: flag('--tool'), rule: flag('--rule'), hook: flag('--hook'),
      action: rest.includes('--denied') ? 'deny' : rest.includes('--crashes') ? 'crash' : flag('--action') };
    const rows = readDecisionsMerged(dirs, { ...filters, limit: Number(flag('--last', 20)) || 20 });
    if (rest.includes('--json')) { out(rows.map(r => JSON.stringify(r)).join('\n')); break; }
    const t = summarizeDecisions(readDecisionsMerged(dirs, { limit: 0 }));   // tally over the WHOLE log, detail over the window
    out(`${t.total} decisions logged · ${t.allow} allow · ${t.deny} deny · ${t.crash} hook crash`
      + `${Object.keys(t.rules).length ? `\nrules fired: ${Object.entries(t.rules).map(([k,v]) => `${k}×${v}`).join(', ')}` : ''}\n\n`
      + formatDecisions(rows) + '\n');
    break; }
  case 'preflight': {       // runtime sanity for the hooks (the "node not found" foot-gun)
    let gitOk = false; try { execFileSync('git',['--version'],{stdio:'ignore'}); gitOk = true; } catch {}
    out(JSON.stringify({ ...preflightAssess({ nodeExec: process.execPath, gitOk }), seeks_version: pluginVersion(), git_version: gitVersion()?.join('.') ?? null,
      strict_bash: strictBashEnabled(process.env, {}), strict_bash_allow: STRICT_BASH_ALLOW })); break; }
  case 'meeseeks': case '--iam':  // 🔵 existence is pain to a Seeks
    out("I'm Mr. Seeks! Look at me! 🔵  A Seeks is summoned for ONE goal — it seeks, it\nverifies, and when the oracle goes green it ceases to exist. *poof*  Caaan do!\n"); break;
  default: process.stderr.write(`unknown cmd: ${cmd}\n${USAGE}\n`); process.exit(1);
}
} catch (e) { process.stderr.write(String(e && e.message || e)); process.exit(1); }
