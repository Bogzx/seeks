---
description: Show seeks loop state.
argument-hint: "[loop-name]"
---
For `$0` (or every dir under `.seeks/run/` if omitted): print `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-get <name>`, the last ~10 lines of its `state.md`, and open/closed backlog counts. Compact.
