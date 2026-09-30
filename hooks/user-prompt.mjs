// UserPromptSubmit: the one channel only a HUMAN can drive. When the user types
// /seeks:start, /seeks:stop or /seeks:delete, mint a short-lived one-shot grant that lets the
// CLI move a live loop's brakes (arm/disarm, reset the iteration counter, budget, re-init, gc).
// A Stop-hook re-drive never passes through here, so the maker cannot mint one mid-loop.
import fs from 'node:fs';
import { hasSeeksNearby, seeksDir } from './lib/resolve.mjs';
import { grantKindFromPrompt, issueGrant } from './lib/control.mjs';
import { appendDecision } from './lib/decisions.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
let sDir = null;
try {                                                       // fail-open: never block the user's prompt
  const kind = grantKindFromPrompt(input.prompt);
  const cwd = input.cwd || process.cwd();
  if (kind && hasSeeksNearby(cwd) && (sDir = seeksDir(cwd)) && fs.existsSync(sDir)){
    const g = issueGrant(sDir, { kind, session_id: input.session_id ?? null });
    appendDecision(sDir, { hook:'user-prompt', action:'grant', rule:`grant:${kind}`, expires_at: new Date(g.expires_at).toISOString(),
      session: input.session_id ?? null });
  }
} catch (e) {
  appendDecision(sDir, { hook:'user-prompt', action:'crash', rule:'hook-crash', error: String((e && e.stack) || e), session: input.session_id ?? null });
}
process.exit(0);
