---
description: Delete a seeks loop (worktree, branch, run state).
argument-hint: <loop-name>
---
GC loop `$0`: 1) if `seeks/$0` has commits not in `base_ref`, confirm with the user first. 2) `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" gc $0`. Keep `.seeks/loops/$0/spec.md` unless asked to remove it.
