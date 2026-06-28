# seeks — end-to-end RUNBOOK

Two ways to prove the engine end-to-end:
- **Automated headless harness** (`driver.mjs` + `scenarios.mjs` + `run.mjs`) — drives a real `claude -p` child session per scenario and asserts the terminal state. **This is the primary path** (closes the F11 live-coverage gap). See **"Headless harness"** below.
- **Manual live runbook** (the numbered steps further down) — drive the `fixture/` repo by hand in an interactive Claude Code session.

---

## Headless harness (`npm run e2e`)

Each scenario builds a throwaway git fixture in a temp dir, scaffolds an **armed** seeks loop on a `seeks/<name>` worktree, then spawns `claude -p --plugin-dir <seeks> --output-format stream-json …` (cwd = the worktree). The Stop hook drives the loop; `run.mjs` stream-parses the banners + final status and asserts the scenario's terminal + invariants.

### Prerequisites
- `node` + `git` on PATH (hooks shell out to both).
- `claude` logged in (or `ANTHROPIC_API_KEY` set) — the child session uses your credentials. On Windows, if `claude` isn't directly spawnable, set `SEEKS_E2E_CLAUDE_BIN` to its full path.
- **`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`** — `run.mjs` sets this in the child env automatically; without it the loop dies at ~8 Stop blocks.
- For the C# overnight target: `dotnet` SDK on PATH.

### Run
```
node test/e2e/run.mjs <scenario>          # DRY-RUN: build fixture + print the planned command, no spawn (free)
SEEKS_E2E=1 npm run e2e <scenario>        # REAL: drive a claude -p child and assert (costs credits)
```
Optional env: `SEEKS_E2E_MODEL` (default `sonnet`), `SEEKS_E2E_CLAUDE_BIN` (default `claude`). Cost is fenced per scenario with `--max-budget-usd` + `--max-turns` in `scenarios.mjs`.

### Scenarios
| Scenario | Tier | Expected terminal | Proves |
|---|---|---|---|
| `done` | deterministic-ish | `✅ done` | solvable → certify after dry sweeps |
| `dry-sweep` | deterministic-ish | `✅ done` | keeps sweeping (`dry_sweeps≥2`) — does NOT stop after one fix (proves B) |
| `needs-human` | best-effort | `⏸ needs-human` | impossible oracle → escalate at reject threshold |
| `max-iters` | best-effort | `⛔ halt: max-iters` | never-green + low cap → hook backstop |
| `stuck` | best-effort | `⛔ halt: stuck` | unclosable item, no reseed → stuck (closes F11) |

LLM runs are non-deterministic: invariants assert **outcomes**, and a divergent or oracle-cheating run surfaces as a FAIL with the actual state — never a silent pass. `done`/`dry-sweep` are the reliable B-proof; the three adversarial scenarios close F11 coverage on a best-effort live basis.

### Overnight real-repo demo
Scaffold a `fix-all-bugs` loop on **a real Python repo** (`ruff` + `mypy` + `pytest` oracle, `min_dry_sweeps:2`, large `max_iters`) on a `seeks/` branch and drive it headless overnight; capture banners + final status. seeks never auto-merges — review the `seeks/fix-all-bugs` branch by hand.

---

## Manual live runbook (oracle goal)

Manual/live proof that the whole engine converges on a real, executable oracle. The fixture in `fixture/` is a tiny ESM repo whose `npm test` **fails** on one unimplemented function (`src/add.mjs`). The loop's job: implement `add` until `npm test` exits 0, verifier-certify, and halt.

> Status: **superseded by the headless harness above for automated proof**; these steps remain for hands-on interactive validation.

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
