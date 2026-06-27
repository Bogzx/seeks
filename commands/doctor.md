---
description: Health + regression check for seeks.
---
Report: 1) are `node` and `git` on PATH? 2) orphaned worktrees/branches under `.claude/worktrees/` vs `.seeks/loops/`? 3) **regression probe** — for each loop, read `hook-state.json` `stop_fires`; if a loop's history shows it repeatedly halting near ~8 fires *despite* making progress (the signal that the platform's progress-reset broke), advise the user to add `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` to their `settings.json` `env`. Note: a plugin cannot self-set this.
