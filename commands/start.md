---
description: Arm and run a seeks loop (the most-recent one if no name given); refreshes a stale base on re-run.
argument-hint: "[loop-name]"
---
Run shell via the Bash tool; never bare-`cd` (use `git -C` / subshells / absolute paths).

1. **Pick the loop (`<name>`).** If no name was given → `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" latest` (the most-recently-touched loop); if that prints nothing, tell the user there are no loops (`/seeks:new <goal>` first) and STOP. Otherwise `<name>` = `$0`. Tell the user which loop you're starting.
2. **Freshness check (re-run / stale base).** Read `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-get <name>` and `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" base-check <name>`. If the loop's `done` is **true** (you're re-running a finished loop) **OR** `base-check` prints `moved` (the base branch advanced since this loop was set up), **ask the user once** (default **yes**): *"Base `<base_ref>` has moved / this loop already finished — refresh it against the latest code before running? (recommended)"*. On **yes**:
   - **Finished loop → fresh re-scaffold from the latest base** (keep the recipe): `node … gc <name>` (removes the old worktree+branch+run — **keeps `spec.md`**); re-create `git worktree add .claude/worktrees/<name> -b seeks/<name> "<base_ref>"`; **re-analyze** the blast radius and rewrite `.seeks/run/<name>/context.md`; `node … init <name> '{…fresh status from spec.md — armed:false, done:false, verifier_certified:false, dry_sweeps:0, no_progress_count:0, base_ref, worktree_path, the spec's min_dry_sweeps/max_iters/thresholds…}'`; `node … base-record <name>`; `backlog-add` the starter items from `spec.md`; reconcile `open_items`; write a fresh `state.md`.
   - **In-progress loop, base moved → rebase + re-analyze** (keep the work): `git -C .claude/worktrees/<name> rebase "<base_ref>"` (on conflict, STOP and tell the user to resolve); rewrite `context.md`; `node … base-record <name>`.
   On **no**, continue without refreshing.
3. `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" lock-acquire <name>` — if it exits non-zero, the loop is running elsewhere (fresh heartbeat). STOP and tell the user.
4. **Reset sticky guards + the iteration counter** so a paused/halted loop resumes with a fresh budget: `node … status-set <name> '{"armed":true,"needs_human":false,"no_progress_count":0}'` then `node … reset-fires <name>`. If it previously halted on max-iters, ask the user whether to raise `max_iters` first.
5. Call the `EnterWorktree` tool with `path: ".claude/worktrees/<name>"`.
6. Begin **exactly the first pass** per the `/seeks:loop` skill (read it now), then **STOP — end your turn after that single pass.** Do NOT continue into the next pass. End the pass with `progress-tick`, then stop. The Stop hook re-invokes you for each subsequent pass and sustains the loop until done / needs-human / stuck / `max_iters`.
