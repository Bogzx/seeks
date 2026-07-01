<p align="center">
  <img src="assets/seeks.png" alt="Seeks" width="240">
</p>

<h1 align="center">seeks</h1>

<p align="center"><em>Point Claude Code at one goal and walk away. seeks drives it — and a control plane it can't talk its way past keeps it honest until a separate verifier agrees it's really done.</em></p>

<p align="center">
  <code>Node ≥18</code> · <code>zero deps</code> · <code>never touches your main</code> · <code>137 tests</code>
</p>

<!-- I'm Mr. Seeks! Look at me! A Seeks is summoned for one goal, seeks it, certifies it, and poofs. 🔵 -->

---

> **Pre-alpha** — the engine is proven (every end state exercised live + on a real codebase) but young. Try it, break it, tell me what broke.

## The problem

You tell Claude Code "fix the failing tests." It fixes a couple and stops to check in. So you wrap it in `while true; do claude; done` — and now it won't quit: it grinds past a green build, burns your quota, or worst, **announces victory on something it never finished.** That's structural, not the model slacking: *the agent doing the work is also the one deciding it's done.* You can't prompt your way out of grading your own homework.

## What seeks does

It wraps the loop in a small **control plane** — fast Node hooks between Claude and the world that hand back a flat *no*, in code the model can't see or edit:

- **A separate verifier** re-runs your done-conditions in a clean context. The maker never signs off on its own work.
- **A guard rail on every action** — no touching `.env` / `.git`, no leaving the worktree, no relaxing a test to fake green, no pushing or merging.
- **A budget it can't reach** — an iteration *and* wall-clock cap in files only the hook writes. "Loop forever" is impossible by construction.

Give it a goal with a check you can run (`npm test` exits 0, `mypy` clean) and it finishes for real, tags you in, or stops at a limit — never wandering off, never faking done.

## How a loop ends

| Give it | Ends in |
|---|---|
| a solvable task | ✅ **done** — the maker fixes it, the verifier certifies it green |
| an impossible / subjective one | ⏸ **needs-human** — the verifier won't be talked into a yes |
| one that never converges | ⛔ **stopped** — hits its iteration cap, time budget, or stops improving |

## Quick start

```
/plugin marketplace add Bogzx/seeks
/plugin install seeks@seeks
```

Then `/reload-plugins` (or restart). Hacking locally? `claude --plugin-dir "/path/to/seeks"`.

```
/seeks:new fix the flaky auth tests   # interviews you for done-conditions + a budget, scaffolds the loop
/seeks:start                          # drives until it hits an end state
/seeks:harvest                        # review the branch diff (and the PR, at L3)
```

Each pass prints one line: `▸ fix-auth-tests · pass 3 · items 9→7 · edited session.ts · ⏰ 2h left · continuing`.

## Commands

| Command | Does |
|---|---|
| `/seeks:new <goal>` | plain-English goal → an auto-named loop (interviews, picks a level + budget) |
| `/seeks:start [name] [--for 8h]` | arm + drive — the most-recent loop if no name |
| `/seeks:status` · `/seeks:add <task>` · `/seeks:stop` | state · append a backlog task · disarm |
| `/seeks:harvest [name]` | finished **and wound-down** loops + their diffs / PR link (offers to deliver a halted branch) |
| `/seeks:export [name]` | bundle a loop's run-state + session transcript into a tarball (for bug reports) |
| `/seeks:delete [name]` · `/seeks:doctor` | tear down · health check |

## Levels — how much rope (hook-enforced, not a polite request)

| Level | Can | Your base branch |
|---|---|---|
| **L1** | report-only: reads + writes findings, *can't* edit or commit | untouched |
| **L2** *(default)* | edits + commits on a throwaway `seeks/<name>` branch | untouched |
| **L3** | on done, pushes the branch + opens a PR | untouched — PR only |

**seeks never merges to your base.** `main` moves only when you click the button.

## Run it overnight

Tell it how hard to dig at `/seeks:new` — *quick*, *thorough*, or *overnight* (or `/seeks:start --for 8h`). On an open-ended goal ("find every bug"), seeks doesn't stop at the first green: it reviews the code through a rotating catalog of **lenses** (concurrency, boundaries, security, timezones, …) and keeps **going deeper** (logic → dataflow → adversarial) until it runs dry or the clock runs out. As the deadline nears it **winds down** — commits, writes a summary — so you wake up to `▸ ⏰ halt: time budget · 9 found · 2 open` and a branch to review, not a half-applied edit.

## Tiers — how hard the agents work

Pick once (remembered in `~/.claude/seeks.json`): **Light** (all-sonnet, low caps), **Balanced** *(default — opus on the maker + verifier, sonnet elsewhere)*, or **All-out** (opus everywhere, deeper sweeps). A lighter tier costs you *thoroughness*, never *safety* — the verifier gate, denylist, and no-merge rules are deterministic at every tier. `/seeks:doctor` shows the active one.

## The guarantees (deterministic, not prompted)

- **Never fakes done** — a separate verifier certifies; the maker can't self-certify, and a goal with no runnable check escalates to you rather than reporting a green.
- **Can't game the oracle** — relax a test after it's been accounted for and the certification voids. (The content hash pins post-account drift on test files; the verifier's judgment owns the rest, and `oracle_globs_present: 0` flags when there's nothing to pin.)
- **Never merges, never runs away** — no push/merge at any level; bounded by an iteration cap *and* a wall-clock budget the agent can't reach.

## Requirements

Node ≥18 + git on the **hook's** `PATH`. Install Node **system-wide, not via nvm/fnm/asdf** — version managers only reach interactive shells, so hooks fail with `Stop hook error: … node not found`. On nvm? `sudo ln -s "$(command -v node)" /usr/local/bin/node`, pin `PATH` in `~/.claude/settings.json`, or launch `claude` from a shell where `node -v` works (`/seeks:doctor` checks this and prints the fix). For **L3** PRs, authenticate `gh` — without it, L3 degrades to push-only or a local branch.

---

<details>
<summary>🔵</summary>

> *I'm Mr. Seeks! **Look at me!*** A Seeks is summoned for **one** goal. It seeks. It verifies. When the oracle goes green, *poof* — it ceases to exist. **Caaan do!**
>
> ```
> node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" --iam
> ```

</details>
