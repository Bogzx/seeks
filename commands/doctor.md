---
description: Health + regression check for seeks.
---
Report:

1) **`node` + `git` on PATH** — run `node -v` and `git --version`. If either is missing, the Stop hook can't run (every stop fails with `Stop hook error: … node not found`) — print this remedy verbatim:
   - Install Node **≥18 system-wide, not via nvm/fnm/asdf** (version managers only put `node` on *interactive* shells; hooks run non-interactive).
   - Quick fixes: `sudo ln -s "$(command -v node)" /usr/local/bin/node`; **or** add `"env": { "PATH": "/your/node/bin:/usr/bin:/bin" }` to `~/.claude/settings.json`; **or** launch `claude` from a shell where `node -v` works.
   - **Caveat:** this command's shell ≠ the hook's shell, so `node` showing up *here* doesn't prove hooks can see it — if stops still error with "node not found", apply a fix above regardless.

2) **orphaned worktrees/branches** under `.claude/worktrees/` vs `.seeks/loops/`.

3) **regression probe** — for each loop, read `hook-state.json` `stop_fires`; if a loop's history shows it repeatedly halting near ~8 fires *despite* making progress (the signal that the platform's progress-reset broke), advise the user to add `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` to their `settings.json` `env`. Note: a plugin cannot self-set this.
