<p align="center">
  <img src="assets/seeks.png" alt="Seeks" width="240">
</p>

<h1 align="center">seeks</h1>

<p align="center"><em>Point Claude Code at one goal and walk away. A control plane it can't bypass keeps it honest — a separate verifier decides when it's really done.</em></p>

<p align="center">
  <code>Node ≥18</code> · <code>zero deps</code> · <code>never touches main</code>
</p>

---

> Seeks seeks but he's young. Try it, break it, tell me what broke.

## Why

Tell Claude Code "fix the failing tests" and it fixes a few, then stops to check in. Wrap it in `while true; do claude; done` and the opposite happens: it grinds past a green build, burns your quota, or — worst — **claims it's done when it isn't.** The reason is structural: the agent doing the work is also the one grading it. You can't prompt your way out of marking your own homework.

## How it works

seeks runs the loop inside a **control plane** — fast Node hooks between Claude and your repo that can veto any action, in code the model can't read or edit:

- **A separate verifier** re-runs your done-conditions in a clean context. The maker never signs off on its own work.
- **Guardrails on every action** — can't touch `.env` / `.git`, can't leave the worktree, can't relax a test to fake green, can't push or merge.
- **A budget it can't reach** — iteration *and* wall-clock caps live in hook-owned files. "Loop forever" is impossible by construction.

Give it a goal with a check you can run (`npm test` exits 0, `mypy` clean) and it finishes for real, hands back to you, or stops at a limit — never wandering off, never faking done. **`main` moves only when you click merge.**

## How a loop ends

| You give it… | It ends in… |
|---|---|
| a solvable task | ✅ **done** — the maker fixes it, the verifier certifies it green |
| an impossible or subjective one | ⏸ **needs-human** — the verifier won't be talked into a yes |
| one that never converges | ⛔ **stopped** — hits its iteration cap, time budget, or stops improving |

## Requirements

**Node ≥18 and git on the _hook's_ `PATH`.** Install Node system-wide, **not** via nvm/fnm/asdf — version managers only reach interactive shells, so hooks fail with `node not found`. (On nvm: `sudo ln -s "$(command -v node)" /usr/local/bin/node`.) `/seeks:doctor` diagnoses it and prints the fix. For L3 PRs, authenticate `gh`.

## Quick start

```
/plugin marketplace add Bogzx/seeks
/plugin install seeks@seeks
```

Then `/reload-plugins` or restart. (Hacking on it locally? `claude --plugin-dir "/path/to/seeks"`.)

```
/seeks:new fix the flaky auth tests   # interviews for done-conditions + a budget, scaffolds the loop
/seeks:start                          # drives until it hits an end state
/seeks:harvest                        # review the branch diff (and the PR, at L3)
```

Each pass prints one line:

```
▸ fix-auth-tests · pass 3 · items 9→7 · edited session.ts · ⏰ 2h left · continuing
```

## Commands

| Command | Does |
|---|---|
| `/seeks:new <goal>` | plain-English goal → an auto-named loop (interviews, picks a level + budget) |
| `/seeks:start [name] [--for 8h]` | arm + drive — the most-recent loop if no name |
| `/seeks:status` · `/seeks:add <task>` · `/seeks:stop` | show state · append a backlog task · disarm |
| `/seeks:harvest [name]` | finished or wound-down loops + their diffs / PR link |
| `/seeks:export [name]` | bundle a loop's state + transcript into a tarball (for bug reports) |
| `/seeks:delete [name]` · `/seeks:doctor` | tear down · health check |

## Levels — how much rope

Hook-enforced, not a polite request. Chosen per loop at `/seeks:new`.

| Level | Can | Your base branch |
|---|---|---|
| **L1** | report-only: reads and writes findings — *can't* edit or commit | untouched |
| **L2** *(default)* | edits + commits on a throwaway `seeks/<name>` branch | untouched |
| **L3** | on done, pushes the branch + opens a PR | untouched — PR only |

## Tiers — which agents, how hard

Seeks runs several agents per loop. A **tier** sets which model each one uses and how deep it digs. Pick once (stored in `~/.claude/seeks.json`), or override per loop at `/seeks:new`; `/seeks:doctor` shows the active one.

| | Light | Balanced *(default)* | All-out |
|---|---|---|---|
| **Maker** — writes the fix | sonnet | opus | opus |
| **Verifier** — independent done-check | sonnet | opus | opus · max effort |
| **Bug-hunter** — discovery sweeps | haiku | sonnet | opus |
| **Analyzer / intake** — scopes + interviews | sonnet | sonnet | opus |
| **Max iterations** — task / open-ended | 30 / 80 | 50 / 200 | 80 / 400 |
| **Dry sweeps before done** | 1 | 2 | 3 |

A lighter tier costs *thoroughness*, never *safety* — the verifier gate, denylist, and no-merge rules are deterministic at every tier.

## Running deep / overnight

Tell it how hard to dig at `/seeks:new` — *quick*, *thorough*, or *overnight* (or `/seeks:start --for 8h`). On an open-ended goal ("find every bug") seeks doesn't stop at the first green: it reviews the code through rotating **lenses** (concurrency, boundaries, security, timezones…) and keeps going deeper until it runs dry or the clock runs out. Near the deadline it **winds down** — commits, writes a summary — so you wake to `▸ ⏰ halt: time budget · 9 found · 2 open` and a branch to review, not a half-applied edit.

---

<details>
<summary>🔵</summary>

> *I'm Mr. Seeks! **Look at me!*** A Seeks is summoned for **one** goal. It seeks. It verifies. When the oracle goes green, *poof* — it ceases to exist. **Caaan do!**
>
> ```
> node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" --iam
> ```

</details>
