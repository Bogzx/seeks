---
description: Disarm a seeks loop so the session can end cleanly.
argument-hint: "[loop-name]"
---
Run shell via the Bash tool.

1. **Pick the loop (`<name>`).** If `$0` is non-empty, `<name>` = `$0`. Otherwise resolve the most-recent loop → `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" latest`. If that prints nothing, tell the user there is no loop to stop and STOP (do not run the steps below with an empty name — that just errors).
2. Disarm it and release its lock: `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" stop <name>`. On a loop the gate is still holding, this works only because the user just typed `/seeks:stop` — seeks' `UserPromptSubmit` hook turned that into a one-shot grant. If it refuses, tell the user; as a last resort they can set `"armed": false` in `.seeks/run/<name>/status.json` from their own editor. Never work around the refusal yourself.
3. Call the `ExitWorktree` tool with `action: "keep"`, then tell the user which loop you disarmed (its work + `spec.md` survive; re-arm with `/seeks:start <name>`).
