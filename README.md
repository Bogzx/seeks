<p align="center">
  <img src="assets/seeks.png" alt="Seeks" width="240">
</p>

<h1 align="center">seeks</h1>

<p align="center"><em>A self-driving loop for Claude Code that won't stop until a separate verifier agrees the job is done.</em></p>



<!-- I'm Mr. Seeks! Look at me! A Seeks is summoned for one goal, seeks it, certifies it, and poofs. 🔵 -->

---

> **Pre-alpha.** The engine works (all three end states proven, 60/60 tests, one overnight run on a 349-file codebase) but it's young. Try it, break it, tell me what went wrong.

## The problem

Ask Claude Code to "fix all the failing tests" and it fixes a few, then asks if it should keep going. Wrap it in `while true; do claude; done` and now it never stops: it grinds past done, gets stuck burning quota, or declares victory on a goal it never finished, because the thing doing the work is also grading it.

seeks puts a separate verifier in the middle. You give it a goal with done-conditions you can run (`npm test` exits 0, `mypy` clean). When the maker thinks it's finished, a verifier with its own fresh context re-runs every condition before the loop can stop. Works best when "done" is something a command can settle; for taste calls it converges the mechanics and asks you to judge.

## Three ways a loop ends

| Give it | Ends in | Because |
|---|---|---|
| a solvable task | ✅ **done** | the maker fixes it and the verifier certifies it green |
| an impossible task | ⏸ **needs-human** | the verifier keeps rejecting until it tags you in |
| a task that never converges | ⛔ **max-iters / stuck** | a hook-owned counter hits its budget, or nothing improves for N passes |

No fourth outcome where it wanders off. The verifier can't be talked into a yes, and the cap lives in a hook the agent can't touch.

## Requirements

Node ≥18 and git, both on the **hook's** `PATH`. Install Node **system-wide, not via nvm/fnm/asdf**: version managers only reach interactive shells, but hooks run in a non-interactive subprocess that then can't find `node`, and every stop fails with `Stop hook error: … node not found`. Already on nvm? Symlink it (`sudo ln -s "$(command -v node)" /usr/local/bin/node`), pin `PATH` in `~/.claude/settings.json`, or launch `claude` from a shell where `node -v` works. `/seeks:doctor` checks this and prints the fix.

## Quick start

```
/plugin marketplace add Bogzx/seeks
/plugin install seeks@seeks
```

Then `/reload-plugins` (or restart). Hacking locally? `claude --plugin-dir "/path/to/seeks"`.

```
/seeks:new fix the flaky auth tests    # interviews you for done-conditions, scaffolds the loop
/seeks:start                           # arms it and drives until it hits an end state
/seeks:harvest                         # shows the branch diff so you can review and merge
```

Each pass prints one line: `▸ fix-auth-tests · pass 3 · items 9→7 · edited session.ts · continuing`.

## Commands

| Command | What it does |
|---|---|
| `/seeks:new <goal>` | plain-English goal to an auto-named loop; interviews, scaffolds |
| `/seeks:start [name]` | arm, enter the worktree, drive. No name runs your most recent loop |
| `/seeks:status [name]` | loop state, level, backlog counts |
| `/seeks:add <name> <task…>` | append a backlog task |
| `/seeks:stop <name>` | disarm so the session can end |
| `/seeks:harvest [name]` | finished loops with their branch diffs |
| `/seeks:delete <name>` | tear down worktree, branch, run state |
| `/seeks:doctor` | health and regression check |

## Levels: what it can touch

Set in the loop's `spec.md`; `/seeks:new` asks which you want.

| Level | What it does | Pushes or merges? |
|---|---|---|
| **L1** | report only: reads, reasons, writes findings | no |
| **L2** *(default)* | edits and commits on an isolated `seeks/<name>` branch | never |
| **L3** | autonomous: on done, pushes `seeks/<name>` and opens a PR | pushes + PRs; **never merges** |

By default (L1/L2) seeks never pushes and never merges. **L3** will push `seeks/<name>` and open a PR for you — but it **never merges**; `main` only moves when you click merge. Every edit lands on `seeks/<name>` in a throwaway worktree.

## Models: which agents do the work

Set per role in `.seeks/config.json`. Defaults:

| Role | Model | Effort |
|---|---|---|
| intake · analyzer · maker | opus | high |
| verifier | opus | max |
| triage | sonnet | low |

The verifier runs hardest because it owns the certify decision; triage stays cheap on sonnet. Override any role to fit your budget.

## How it works

A dumb hook and a smart agent.

The hook is a fast Node `Stop` hook. When the session tries to end, it finds the loop, bumps its own counter, and decides block or allow. A block forces another turn (you'll see a `Stop hook error` line; that's the mechanism, not a bug).

The agent does one pass per turn: take the next backlog item, edit, commit, or run the verifier if the backlog is empty. Then it ends its turn and lets the hook drive the next one. One pass per turn is load-bearing: the counter only ticks on a yield, so it's what makes the `max_iters` cap real and lets a loop survive a context compaction.

The maker never certifies its own work. A verifier subagent spins up in a clean context, runs every condition itself, and diffs the tree to check the maker didn't edit the oracle to force a green.

## Layout

```
seeks/
├── .claude-plugin/   plugin.json + marketplace.json
├── hooks/            stop-gate.mjs · session-restore.mjs · lib/*.mjs
├── bin/seeks.mjs     name-based, atomic state CLI
├── skills/loop/      the per-pass protocol (/seeks:loop)
├── commands/         the 8 /seeks:* commands
├── test/             60 unit tests + a headless e2e harness
└── docs/             DESIGN · PLAN · FINDINGS
```

Only `spec.md` and `config.json` are committed; runtime progress under `.seeks/run/` stays gitignored.

---

<details>
<summary>🔵</summary>

> *I'm Mr. Seeks! **Look at me!***
>
> A Seeks is summoned for **one** goal. It seeks. It verifies. When the oracle goes green, *poof*, it ceases to exist. **Caaan do!**
>
> ```
> node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" --iam
> ```

</details>
