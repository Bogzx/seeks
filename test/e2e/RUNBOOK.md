# seeks — end-to-end RUNBOOK (oracle goal)

Manual/live proof that the whole engine converges on a real, executable oracle. The fixture in `fixture/` is a tiny ESM repo whose `npm test` **fails** on one unimplemented function (`src/add.mjs`). The loop's job: implement `add` until `npm test` exits 0, verifier-certify, and halt.

> Status: **deferred — run later** (per build decision). P1–P4 (Task 0) and Steps 2–5 below need the plugin installed in a live Claude Code session.

## Prereqs
- `node` and `git` on PATH (hooks shell out to both).
- Install the `seeks` plugin locally (so `${CLAUDE_PLUGIN_ROOT}` resolves and hooks/commands load), then restart the session.
- The fixture is a **separate** git repo. Initialize it as its own checkout for the run:
  - `cd test/e2e/fixture && git init -q && git add -A && git commit -qm "fixture: failing add"`.

## Step 1 — Build/verify the fixture
- `cd test/e2e/fixture && npm test` → **must FAIL** (assert: `add is not implemented`). This is the oracle's red state.

## Step 2 — New + start the loop
- In the fixture checkout: `/seeks:new e2e`
  - Goal: "implement `add(a,b)` so `npm test` passes."
  - Executable done-condition: `id=tests`, command `npm test`, expected exit `0`.
- `/seeks:start e2e`.

## Step 3 — Observe the happy path
- A banner prints each pass: `▸ e2e · pass N · …`.
- The maker edits `src/add.mjs` to implement `add`.
- On an empty backlog the **verifier subagent** `cd`s into the worktree and runs `npm test` itself (does not trust the maker).
- On green → `status.json` gets `verifier_certified:true, done:true`; the Stop gate releases with `✅ done`.
- **Confirm `stop_fires > 8`** survives (progress-reset is working) if the loop took more than 8 passes.

## Step 4 — Failure path (escalation + hard backstop)
- Add an impossible done-condition (e.g. `id=impossible`, command `node -e "process.exit(1)"`).
- Confirm `condition-reject impossible` increments and **escalates to `needs_human`** at `condition_reject_threshold` (3) — *before* `max_iters`.
- Separately, kill the per-pass `progress-tick` mid-run and confirm the **hook backstop** still halts at `max_iters` (`⛔ halt: max-iters (50)`) — proving safety does not depend on the agent ticking.

## Step 5 — Resume path
- After a `needs_human` pause, fix the condition, then `/seeks:start e2e` again.
- Confirm it **resumes** (sticky guards `needs_human`/`no_progress_count` reset by `/seeks:start`) rather than immediately re-halting.

## Step 6 — Record
- Capture the banners, the verifier report (`.seeks/run/e2e/verify/`), and the final `status.json` here, then commit.

## Results (fill in on first live run)
- [ ] Step 1 — fixture red confirmed
- [ ] Step 2 — loop created + started
- [ ] Step 3 — converged to `✅ done`; `stop_fires` observed = ___
- [ ] Step 4 — `needs_human` at reject threshold; `max_iters` backstop with ticks disabled
- [ ] Step 5 — clean resume after fix
