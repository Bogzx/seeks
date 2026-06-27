---
description: Arm and run a seeks loop in this terminal until done/needs-human/stuck.
argument-hint: <loop-name>
---
Start loop `$0`.
1. `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" lock-acquire $0` — if it exits non-zero, the loop is running elsewhere (fresh heartbeat). STOP and tell the user.
2. **Reset sticky guards** so a paused loop resumes: `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-set $0 '{"armed":true,"needs_human":false,"no_progress_count":0}'`. If it previously halted on max-iters, ask the user whether to raise `max_iters` and `status-set` it.
3. Call the `EnterWorktree` tool with `path: ".claude/worktrees/$0"`.
4. Begin the first pass per the `/seeks:loop` skill (read it now). The Stop hook sustains the loop; end every pass with `progress-tick`.
