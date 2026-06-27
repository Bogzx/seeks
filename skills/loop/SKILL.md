---
name: loop
description: Per-pass discipline for an active seeks loop. Drive state ONLY through bin/seeks.mjs (which self-resolves .seeks via git). Never hand-write status.json.
---

# seeks — per-pass protocol

State for loop `<name>` lives in the PRIMARY checkout's `.seeks/run/<name>/`. You are usually inside the loop's worktree; **always mutate state through the CLI, which resolves the control plane via git** — never write `.seeks/...` by relative path yourself:
`node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" <subcommand> <name> ...`  (run via the Bash tool).

## Every pass
1. **Orient** — read `.seeks/run/<name>/{state.md,backlog.md,context.md}` and `.seeks/loops/<name>/spec.md` (resolve `.seeks` with `git rev-parse --path-format=absolute --git-common-dir` if needed).
2. **Backlog has `- [ ]` items** → do the SINGLE next one (respect `level`: L1 = no edits, findings to state.md; L2 = edit + commit on `seeks/<name>`). Mark it `- [x]`; record:
   `… status-set <name> '{"last_change":"<what you did>"}'`; append one line to `log.md`; commit `seeks(<name>): pass N — <summary>` (L2+).
3. **Backlog EMPTY (claim of done)** → dispatch a **verifier subagent** (separate context). Hand it the absolute worktree path; it must `cd` there and RUN each executable done-condition from spec.md itself (subagents do NOT inherit cwd), write `verify/<n>.md`, and report per condition.
   - **All non-human conditions pass →** `… status-set <name> '{"verifier_certified":true,"done":true,"last_verdict":"pass"}'`.
   - **Any fails →** for each unmet condition: `… backlog-add <name> "<remediation>"` and `… condition-reject <name> <condition-id>` (atomic; auto-sets needs_human at the threshold). Set `last_verdict` (e.g. `"REJECT (typecheck)"`). `human-required` condition → `… status-set <name> '{"needs_human":true}'`.
4. **Always, as the LAST action:** `… progress-tick <name>` (recomputes open_items/no_progress/items_closed). The iteration count + hard backstop are the hook's, so a missed tick degrades signals but cannot make the loop unkillable. Do ≥1 real tool action each pass (you always do).

## Verifier subagent (maker ≠ checker)
Fresh context; runs checks in the worktree; cites evidence; rejects on ambiguity; the ONLY writer of `verifier_certified`.

## Never
Never hand-write status.json/hook-state.json. Never let the maker self-certify. Never edit denylist paths.
