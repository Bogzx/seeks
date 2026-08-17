// Append-only decision log — the observability half of the enforcement plane.
//
// The hooks are deliberately FAIL-OPEN: a hook error must never block a tool call or trap a
// session. The cost was that "allowed" and "enforcement silently off" looked identical from
// the outside — a crashed pre-tool hook is indistinguishable from a clean allow. So every
// PreToolUse verdict, every Stop-gate verdict and every hook CRASH lands here as one JSON
// line, and `seeks why <name>` (/seeks:why) replays it.
//
// Writing the log must never itself be the reason a hook fails: every function here swallows
// its own errors and returns a boolean.
import fs from 'node:fs'; import path from 'node:path';
export const decisionsPath = (runDir) => path.join(runDir, 'decisions.jsonl');
const MAX_BYTES = 1 << 20;          // 1 MiB, then roll ONCE — an overnight run must not grow unbounded
const CLIP = 400;                   // one heredoc command must not blow up a line
const clip = (s, n = CLIP) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…[+${t.length - n} chars]` : t; };
// What of a tool call is worth keeping. Deliberately NOT the whole tool_input: an Edit carries
// the full new file contents, which would put source (and anything the model read) in the log.
export function summarizeInput(tool, input){
  if (!input || typeof input !== 'object') return null;
  if (tool === 'Bash') return input.command == null ? null : { command: clip(input.command) };
  const p = input.file_path ?? input.notebook_path;
  return p == null ? null : { file_path: clip(p, 300) };
}
export function appendDecision(runDir, rec){
  if (!runDir) return false;
  try {
    const f = decisionsPath(runDir);
    // Roll before appending, not after: rename is atomic, so there is no window in which the
    // log is missing, and the previous window survives in decisions.jsonl.1 for one more round.
    try { if (fs.statSync(f).size > MAX_BYTES) fs.renameSync(f, `${f}.1`); } catch {}
    fs.appendFileSync(f, `${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`);
    return true;
  } catch { return false; }
}
export function readDecisions(runDir, { limit = 20, action = null, tool = null, hook = null, rule = null } = {}){
  let raw = ''; try { raw = fs.readFileSync(decisionsPath(runDir), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of raw.split('\n')){
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }     // a torn tail line must not poison the whole replay
    if (action && r.action !== action) continue;
    if (tool && r.tool !== tool) continue;
    if (hook && r.hook !== hook) continue;
    if (rule && r.rule !== rule) continue;
    rows.push(r);
  }
  return limit > 0 ? rows.slice(-limit) : rows;
}
// A hook can crash BEFORE it knows which loop it is in (a corrupt status.json is the common
// case — resolution itself throws). Those records land in the plane-level `.seeks/decisions.jsonl`
// instead, so `seeks why` merges both and the crash is never simply lost.
export function readDecisionsMerged(dirs, opts = {}){
  const { limit = 20, ...filters } = opts;
  const rows = dirs.filter(Boolean).flatMap(d => readDecisions(d, { ...filters, limit: 0 }))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return limit > 0 ? rows.slice(-limit) : rows;
}
const MARK = { deny:'✖', block:'✖', crash:'💥' };
const subject = (r) => r.tool
  ? `${r.tool}${r.input?.command ? `  ${r.input.command}` : r.input?.file_path ? `  ${r.input.file_path}` : ''}`
  : (r.stop_kind ? `stop → ${r.stop_kind}` : (r.hook ?? '?'));
export function formatDecisions(rows){
  if (!rows.length) return 'no decisions recorded for this loop yet (nothing has run under the hooks, or the run dir was gc\'d)';
  return rows.map(r =>
    `${MARK[r.action] ?? '✔'} ${r.ts}  [${r.hook}] ${r.action}${r.rule ? ` · ${r.rule}` : ''}\n` +
    `    ${subject(r)}` +
    (r.reason ? `\n    ↳ ${r.reason}` : '') +
    (r.error ? `\n    ↳ ${clip(r.error, 600)}` : '')
  ).join('\n');
}
// One-line tally, so /seeks:why can lead with the shape before the detail.
export function summarizeDecisions(rows){
  const t = { total: rows.length, allow: 0, deny: 0, crash: 0, rules: {} };
  for (const r of rows){
    if (r.action === 'allow') t.allow++;
    else if (r.action === 'crash') t.crash++;
    else t.deny++;
    if (r.rule) t.rules[r.rule] = (t.rules[r.rule] ?? 0) + 1;
  }
  return t;
}
