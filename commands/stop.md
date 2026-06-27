---
description: Disarm a seeks loop so the session can end cleanly.
argument-hint: <loop-name>
---
Stop loop `$0`.
1. `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-set $0 '{"armed":false}'`.
2. `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" lock-release $0`.
3. Call the `ExitWorktree` tool with `action: "keep"`.
