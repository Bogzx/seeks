---
description: Disarm a seeks loop so the session can end cleanly.
argument-hint: "[loop-name]"
---
Run shell via the Bash tool.

1. **Pick the loop (`<name>`).** If `$0` is non-empty, `<name>` = `$0`. Otherwise resolve the most-recent loop → `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" latest`. If that prints nothing, tell the user there is no loop to stop and STOP (do not run the steps below with an empty name — that just errors).
2. Disarm it: `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-set <name> '{"armed":false}'`.
3. Release the lock: `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" lock-release <name>`.
4. Call the `ExitWorktree` tool with `action: "keep"`, then tell the user which loop you disarmed (its work + `spec.md` survive; re-arm with `/seeks:start <name>`).
