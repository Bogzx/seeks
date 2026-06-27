---
description: Create a new seeks loop — interview for goal + executable done-conditions, analyze, create worktree, scaffold.
argument-hint: <loop-name>
---
Create loop `$0`. Self-contained; run shell via the Bash tool.

1. **Intake** (one question at a time): goal; **executable done-conditions** (each: `id`, command, expected exit/output). Subjective acceptance → mark `human-required`. Refuse to proceed until ≥1 runnable check exists (or all are human-required).
2. **Recipe** `.seeks/loops/$0/spec.md` with frontmatter `level` (default L2) and a `## Done-conditions` list.
3. **config** — if `.seeks/config.json` is absent, create it with defaults: `{"default_level":"L2","max_iters":50,"stuck_threshold":3,"condition_reject_threshold":3,"lock_stale_ttl_sec":600,"base_ref":"<current branch from `git rev-parse --abbrev-ref HEAD`>","denylist":["**/.env","**/secrets/**",".git/**"],"roles":{"intake":{"model":"opus","effort":"high"},"analyzer":{"model":"opus","effort":"high"},"maker":{"model":"opus","effort":"high"},"verifier":{"model":"opus","effort":"max"},"triage":{"model":"sonnet","effort":"low"}}}`.
4. **Analyze** — edge-trace imports/refs/call-sites from the goal (not keyword scan); write `.seeks/run/$0/context.md` (depth-capped).
5. **Worktree** — `git worktree add .claude/worktrees/$0 -b seeks/$0 "$(git rev-parse --abbrev-ref HEAD)"`. Ensure `.gitignore` contains `/.seeks/run/` and `/.claude/worktrees/` (append any missing line).
6. **Scaffold** — `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" init $0 '{"loop":"$0","armed":false,"done":false,"verifier_certified":false,"open_items":0,"items_closed_total":0,"no_progress_count":0,"condition_rejects":{},"worktree_path":"<ABS path of .claude/worktrees/$0>","max_iters":50,"stuck_threshold":3,"condition_reject_threshold":3,"lock_stale_ttl_sec":600}'`. Then `backlog-add` each starter item, and **reconcile**: `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-set $0 "{\"open_items\":<count>,\"open_items_prev\":<count>}"`. Write an initial `state.md`.
7. **On any failure, roll back via Node:** `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" gc $0` (removes worktree+branch+run dir). Report the failure.

Tell the user: `/seeks:start $0`.
