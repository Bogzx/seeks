---
name: loop
description: Per-pass discipline for an active seeks loop. Drive state ONLY through bin/seeks.mjs (which self-resolves .seeks via git). Never hand-write status.json.
---

# seeks — per-pass protocol

> **CARDINAL RULE: do exactly ONE pass, then STOP and end your turn.** Never loop internally across passes. Ending your turn is what lets the Stop hook drive the next pass, advance `stop_fires` (so the `max_iters` backstop + stuck guard can fire), and survive context compaction. A loop where you never yield is unkillable by the hook.
>
> **Wind-down:** if the Stop-hook continue-message says the **time budget is nearly up**, treat it as a wind-down — do NOT start new work: write/refresh `summary.md` (what you found, what's still open), commit it, then end your turn. The clock will halt the loop shortly after.

State for loop `<name>` lives in the PRIMARY checkout's `.seeks/run/<name>/`. You are usually inside the loop's worktree; **always mutate state through the CLI, which resolves the control plane via git** — never write `.seeks/...` by relative path yourself:
`node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" <subcommand> <name> ...`  (run via the Bash tool).

## Every pass
1. **Orient** — read `.seeks/run/<name>/{state.md,backlog.md,context.md}` and `.seeks/loops/<name>/spec.md` (resolve `.seeks` with `git rev-parse --path-format=absolute --git-common-dir` if needed).
2. **Backlog has `- [ ]` items** → do the SINGLE next one (respect `level`: L1 = no edits, findings to state.md; L2 = edit + commit on `seeks/<name>`). Mark it `- [x]`; record:
   `… status-set <name> '{"last_change":"<what you did>"}'`; `… log-add <name> "pass N — <summary>"` (appends to `log.md`; never hand-append by relative path); commit `seeks(<name>): pass N — <summary>` (L2+).
3. **Backlog EMPTY** → decide by `min_dry_sweeps` (in status.json):
   - **`min_dry_sweeps` is 0 / unset (default)** → go straight to the **verifier** (legacy behavior, below).
   - **`min_dry_sweeps` > 0 (an until-dry loop, e.g. "fix all bugs")** → first run **one creative discovery sweep, through a fresh lens each pass**. Get the angle: `LENS=$(… sweep-next-lens <name>)` (rotates breadth-first through the full view catalog). **Depth (exhaustive mode):** read `depth` from status — depth 1 = each module's logic; depth 2 = cross-module dataflow; depth 3 = adversarial inputs / write probing tests. Review through `$LENS` **at the current depth**; when a full catalog pass comes up dry the engine deepens automatically (via `sweep-tick`) and you keep hunting until the time budget halts you or `dry_depth_rounds` reaches its target. Then actually READ the source across the goal's blast radius and reason about correctness **specifically through `$LENS`** — hunt for *real* defects the tests don't catch. **Re-running tests/linters is only a regression floor, NOT the bug finder.** For fresh eyes, dispatch a bug-hunter subagent (**using the triage role's model** — `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" role triage`) so it isn't anchored on your own edits. Then `… sweep-tick <name> <count-of-NEW-real-bugs> "$LENS"`, then **end the pass** unless ready to verify. **Note:** a dry sweep only advances `dry_sweeps` if its lens is *new* to the current dry streak — repeating a lens won't count, so always take the lens `sweep-next-lens` gives you.
     - **Found > 0** → `… backlog-add <name> "<each new item>"` (re-seed); end the pass. (`sweep-tick` reset `dry_sweeps` to 0.)
     - **Found == 0 and `dry_sweeps` < `min_dry_sweeps`** → end the pass; the loop keeps sweeping until it's come up empty enough times.
     - **Found == 0 and `dry_sweeps` ≥ `min_dry_sweeps`** → proceed to the **verifier**.

   **Verifier subagent** (separate context, maker ≠ checker): dispatch it **with the verifier role's model** (`node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" role verifier` → `{model,effort}`); hand it the absolute worktree path; it must `cd` there and RUN each executable done-condition from spec.md itself (subagents do NOT inherit cwd), write `verify/<n>.md`, and report per condition.
   - **All non-human conditions pass →** first **account for the oracle**: run `… oracle-diff <name>`; for each changed/added oracle (test) file, open it and justify the change in `verify/oracle.md` (a relaxed assertion that hides a real failure is a REJECT, not an account), then `… oracle-ack <name>`. Then certify: `… status-set <name> '{"verifier_certified":true,"done":true,"last_verdict":"pass"}'`. (The gate still won't release until `dry_sweeps ≥ min_dry_sweeps` **and** the oracle ack matches the current diff — a test edited after the ack forces a re-verify.) **If `level` is L3, the loop must also deliver before it can finish:** once `done` is set, run `… deliver <name>` (pushes `seeks/<name>` and opens a PR; degrades to push-only/local if `gh`/remote are absent). The gate will not release `done` until `delivered` is true.
   - **Any fails →** for each unmet condition: `… backlog-add <name> "<remediation>"` and `… condition-reject <name> <condition-id>` (atomic; auto-sets needs_human at the threshold). Set `last_verdict` (e.g. `"REJECT (typecheck)"`). `human-required` condition → `… status-set <name> '{"needs_human":true}'`.
4. **Second-to-last action:** `… progress-tick <name>` (recomputes open_items/no_progress/items_closed). Do ≥1 real tool action each pass (you always do).
5. **LAST action — STOP. One pass per turn.** After `progress-tick`, end your turn: print a one-line recap and nothing more. **Do NOT begin the next pass yourself.** The Stop hook re-invokes you for the next pass, or releases you when the loop is done / needs-human / stuck / at `max_iters`. This is mandatory — ending your turn is what advances `stop_fires` so the hook-owned `max_iters` backstop and the stuck guard can actually fire, and what lets state survive compaction between passes. Always stop after exactly one pass (one backlog item, OR one verifier round). **Do NOT disarm a terminal loop yourself** — the gate already *allows* the stop and prints the `✅ done` / `⏸ needs-human` banner; a disarmed loop is invisible to the hook (so no terminal banner shows) **and** self-disarm would let a maker bypass the `min_dry_sweeps` gate. Teardown is the user's call via `/seeks:stop` or `/seeks:harvest`.

## Verifier subagent (maker ≠ checker)
Fresh context; runs checks in the worktree; cites evidence; rejects on ambiguity; the ONLY writer of `verifier_certified`. A loop with **no executable condition** (subjective / `human_required`) can never be certified `done` by the gate — converge the mechanics, write findings/summary, then set `needs_human`. Do NOT set `done`.

## Never
Never hand-write status.json/hook-state.json. Never let the maker self-certify. Never edit denylist paths.

**Hard-enforced — the PreToolUse hook denies these deterministically (you'll get a tool error; adapt, don't retry):** editing denylist paths (`**/.env`, `**/secrets/**`, `.git/**`); editing outside the worktree; hand-writing `status.json`/`hook-state.json` (use the CLI); at L1, any source edit or `git commit`; `git push` / `git merge` / `git rebase` at **every** level (delivery is automated via `seeks deliver` at L3 — the agent never pushes/merges directly). Oracle/test edits are NOT blocked — they're accounted for at verify (above).
