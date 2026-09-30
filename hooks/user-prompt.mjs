// UserPromptSubmit: the channel a Stop-hook re-drive never passes through. When the user types
// /seeks:start, /seeks:stop or /seeks:delete, mint a short-lived one-shot grant, bound to that
// loop, that lets the CLI move its brakes (arm/disarm, reset the iteration counter, budget,
// re-init, gc). This hook can't tell a human from a process, though: a Claude Code the maker
// starts from its own Bash submits prompts too. Non-interactive sessions never mint (control.mjs),
// and the PreToolUse policy denies starting Claude Code from a loop (rule nested-claude); an
// interactive one driven through a pty is a Bash-tier gap, like the rest of that tier.
import fs from 'node:fs';
import { hasSeeksNearby, seeksDir, latestLoop } from './lib/resolve.mjs';
import { grantKindFromPrompt, grantLoopFromPrompt, issueGrant, nonInteractiveSession } from './lib/control.mjs';
import { appendDecision } from './lib/decisions.mjs';
function stdin(){ try { return fs.readFileSync(0,'utf8'); } catch { return ''; } }
const input = (()=>{ try { return JSON.parse(stdin()); } catch { return {}; } })();
let sDir = null;
try {                                                       // fail-open: never block the user's prompt
  const kind = grantKindFromPrompt(input.prompt);
  const cwd = input.cwd || process.cwd();
  if (kind && hasSeeksNearby(cwd) && (sDir = seeksDir(cwd)) && fs.existsSync(sDir)){
    const loop = grantLoopFromPrompt(input.prompt) ?? latestLoop(sDir);   // the loop the command will act on
    if (nonInteractiveSession()){                           // `claude -p "/seeks:stop"` from the maker's own Bash: no grant
      appendDecision(sDir, { hook:'user-prompt', action:'deny', rule:`grant-refused:${kind}`, loop,
        reason:'non-interactive Claude Code session (-p / SDK): a grant needs a prompt a human typed', session: input.session_id ?? null });
    } else {
      const g = issueGrant(sDir, { kind, loop, session_id: input.session_id ?? null });
      appendDecision(sDir, { hook:'user-prompt', action:'grant', rule:`grant:${kind}`, loop, expires_at: new Date(g.expires_at).toISOString(),
        session: input.session_id ?? null });
    }
  }
} catch (e) {
  appendDecision(sDir, { hook:'user-prompt', action:'crash', rule:'hook-crash', error: String((e && e.stack) || e), session: input.session_id ?? null });
}
process.exit(0);
