---
description: Arm and run a seeks loop in this terminal until done/needs-human/stuck.
argument-hint: <loop-name>
---
Start loop `$0`.
1. `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" lock-acquire $0` — if it exits non-zero, the loop is running elsewhere (fresh heartbeat). STOP and tell the user.
2. **Reset sticky guards + the iteration counter** so a paused/halted loop resumes with a fresh budget: `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-set $0 '{"armed":true,"needs_human":false,"no_progress_count":0}'` then `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" reset-fires $0` (zeroes `stop_fires` so `max_iters` is a budget **per `/seeks:start`** — without this a max-iters-halted loop re-halts instantly). If it previously halted on max-iters, ask the user whether to raise `max_iters` first.
3. Call the `EnterWorktree` tool with `path: ".claude/worktrees/$0"`.
4. Begin **exactly the first pass** per the `/seeks:loop` skill (read it now), then **STOP — end your turn after that single pass.** Do NOT continue into the next pass. End the pass with `progress-tick`, then stop. The Stop hook re-invokes you for each subsequent pass and sustains the loop until done / needs-human / stuck / `max_iters`.
