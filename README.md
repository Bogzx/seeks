<p align="center">
  <img src="assets/seeks.png" alt="Seeks" width="240">
</p>

<h1 align="center">seeks</h1>

<p align="center"><em>Point Claude Code at one goal and walk away. seeks drives it — and a control plane it can't talk its way past keeps it honest until a separate verifier agrees it's actually done.</em></p>

<p align="center">
  <code>Node ≥18</code> · <code>zero runtime deps</code> · <code>your main is untouchable</code> · <code>103/103 tests</code>
</p>

<!-- I'm Mr. Seeks! Look at me! A Seeks is summoned for one goal, seeks it, certifies it, and poofs. 🔵 -->

---

> **Pre-alpha.** The engine is proven — every end state exercised live, 103 unit tests, each scenario driven by a real headless `claude`, plus an overnight run on a real 349-file codebase — but it's young. Try it, break it, tell me what broke.

## The problem

You ask Claude Code to "fix the failing tests." It fixes a couple, then stops to check in. Reasonable — so you wrap it in `while true; do claude; done` and let it run. Now you've got the opposite problem: it doesn't know when to quit. It grinds past a green build, burns your quota re-solving a goal it already met, or — the bad one — announces victory on something it never actually finished.

None of that is the model slacking. It's structural: **the agent doing the work is also the one deciding the work is done.** Ask anyone to grade their own homework and you'll get an A.

So the fix can't be a better prompt. It has to be something *outside* the agent — rules it runs inside but cannot override.

## What seeks does about it

seeks wraps the loop in a small **control plane**: fast Node hooks that sit between Claude and the world. Not instructions it might drift past — actual code that, when the agent reaches for something it shouldn't, hands back a flat *no*.

- **A separate verifier.** When the maker thinks it's finished, a verifier with its own clean context re-runs every done-condition itself and diffs the tree. The maker never signs off on its own work.
- **A guard rail on every action.** Before any edit or shell command runs, a hook checks it: no touching `.env` / secrets / `.git`, no wandering outside its worktree, no quietly relaxing a test to fake a green, no hand-editing its own progress file. The decision is plain code — the model can't argue with it, can't see it to game it, and can't edit it.
- **A budget it can't reach.** The iteration counter lives in a file only the hook writes. "Loop forever" isn't a risk you mitigate; it's impossible by construction.

You hand it a goal with checks you can actually run (`npm test` exits 0, `mypy` clean), and it does one of three things — finishes for real, tags you in, or stops at a cap. It never wanders off, and it never fakes done. Works best when "done" is something a command can settle; for taste calls it converges the mechanics and asks you to judge.

## Three ways a loop ends

| Give it | Ends in | Because |
|---|---|---|
| a solvable task | ✅ **done** | the maker fixes it and the verifier certifies it green |
| an impossible task | ⏸ **needs-human** | the verifier keeps rejecting until it tags you in |
| a task that never converges | ⛔ **max-iters / stuck** | a hook-owned counter hits its budget, or nothing improves for N passes |

No fourth outcome where it quietly drifts off. The verifier can't be sweet-talked into a yes, and the cap lives where the agent can't touch it.

## Quick start

```
/plugin marketplace add Bogzx/seeks
/plugin install seeks@seeks
```

Then `/reload-plugins` (or restart). Hacking locally? `claude --plugin-dir "/path/to/seeks"`.

```
/seeks:new fix the flaky auth tests    # interviews you for done-conditions, scaffolds the loop
/seeks:start                           # arms it and drives until it hits an end state
/seeks:harvest                         # shows the branch diff (and the PR, at L3) to review and merge
```

Each pass prints one line: `▸ fix-auth-tests · pass 3 · items 9→7 · edited session.ts · continuing`.

## Commands

| Command | What it does |
|---|---|
| `/seeks:new <goal>` | plain-English goal → an auto-named loop; interviews, scaffolds, picks a level |
| `/seeks:start [name]` | arm, enter the worktree, drive. No name runs your most recent loop |
| `/seeks:status [name]` | loop state, level, backlog counts |
| `/seeks:add <name> <task…>` | append a backlog task |
| `/seeks:stop <name>` | disarm so the session can end |
| `/seeks:harvest [name]` | finished loops with their branch diffs (and PR link at L3) |
| `/seeks:delete <name>` | tear down worktree, branch, run state |
| `/seeks:doctor` | health and regression check |

## Levels: how much rope it gets

You pick a level at `/seeks:new`. It isn't a polite request — the guard-rail hook enforces it deterministically.

| Level | What it can do | Your base branch |
|---|---|---|
| **L1** | report-only: reads, reasons, writes findings — *cannot* edit source or commit | untouched |
| **L2** *(default)* | edits and commits on a throwaway `seeks/<name>` branch | untouched |
| **L3** | autonomous: on done, pushes `seeks/<name>` and opens a PR for you | untouched — PR only |

**seeks never merges to your base branch.** L2 keeps every change on an isolated `seeks/<name>` worktree. L3 will push that branch and open a PR — and degrades gracefully to push-only, or just a local branch, if `gh` or a remote isn't available — but it **never** merges. `main` moves only when you click the button.

## The oracle can't be gamed

For "make it green" goals, the obvious cheat is to loosen the test. seeks shuts that down without getting in your way: the verifier must **account for every test it touched** before it's allowed to certify, and that accounting is pinned by a content hash — change a test *after* you've accounted for it and the certification is void, forcing a fresh check. Edit and add tests freely while you build features; you just can't *silently* move the goalposts to manufacture a pass.

## Usage tiers: how hard the agents work

The first time you run `/seeks:new`, seeks asks once which tier fits your plan — and remembers it in `~/.claude/seeks.json`. A tier sets the per-role models *and* the iteration budget; every new loop is scaffolded from it (override per-loop, or change it anytime — `/seeks:doctor` shows the current one).

| Role | Light | Balanced *(default)* | All-out |
|---|---|---|---|
| maker · intake | sonnet | opus · sonnet | opus |
| analyzer | sonnet | sonnet | opus |
| verifier | sonnet | opus | opus · max effort |
| triage / sweeps | haiku | sonnet | opus |
| iteration cap | low | medium | high (+ deeper sweeps) |

**Light** stretches a tight plan (all-sonnet, low caps); **Balanced** puts opus where it counts — the maker and the verifier — and sonnet elsewhere; **All-out** goes opus across the board for overnight, quality-first runs. The verifier runs hardest because it owns the certify decision. A lighter tier costs you *thoroughness*, never *safety* — the oracle gate, denylist, and no-merge rules are deterministic at every tier. (The maker is your own session, so its model is a nudge; the dispatched subagents — analyzer, verifier, sweeps — use the tier's models exactly.)

## How it works

A dumb control plane and a smart agent — and the dumbness is the point.

**Three hooks, all plain Node, all deterministic:**

- a **Stop** hook *gates* the loop — each time the session tries to end, it bumps its own counter and decides *block* (force one more pass) or *allow* (the loop is done / needs-human / stuck / at the cap). A block prints a `Stop hook error` line; that's the mechanism, not a bug.
- a **PreToolUse** hook is the *guard rail* — it inspects every edit and command before it runs and denies anything the level or denylist forbids (and routes all delivery through the CLI, so the agent can't push or merge on its own).
- a **SessionStart** hook *restores* the loop's goal and live state after a context compaction or a resume, so long runs don't lose the thread.

**The maker** does exactly one pass per turn — take the next backlog item, edit, commit, or (when the backlog is empty) run the verifier — then ends its turn and lets the hook drive the next one. One pass per turn is load-bearing: the counter only ticks on a yield, so it's what makes the `max_iters` cap real, lets the stuck-guard fire, and lets a loop survive being compacted halfway through.

**The verifier** never trusts the maker. It spins up in a clean context, `cd`s into the worktree, runs every executable done-condition itself, and diffs the tree to confirm the maker didn't edit the oracle to force a green. It's the only thing allowed to write "certified."

For open-ended goals ("fix *all* the bugs"), the maker doesn't stop at the first green: it does creative read-through **sweeps** — a fresh review lens each pass (concurrency, error-handling, boundaries, …) — and can't certify until two consecutive sweeps turn up nothing new.

## Requirements

Node ≥18 and git, both on the **hook's** `PATH`. Install Node **system-wide, not via nvm/fnm/asdf**: version managers only reach interactive shells, but hooks run in a non-interactive subprocess that then can't find `node`, and every stop fails with `Stop hook error: … node not found`. Already on nvm? Symlink it (`sudo ln -s "$(command -v node)" /usr/local/bin/node`), pin `PATH` in `~/.claude/settings.json`, or launch `claude` from a shell where `node -v` works. `/seeks:doctor` checks this and prints the fix.

For **L3** PRs you'll also want the `gh` CLI authenticated against a GitHub remote — without it, L3 simply degrades to pushing the branch (or keeping it local) and tells you to open the PR yourself.

## Layout

```
seeks/
├── .claude-plugin/   plugin.json + marketplace.json
├── hooks/            stop-gate · pre-tool · session-restore · lib/{gate,policy,oracle,deliver,glob,…}
├── bin/seeks.mjs     name-based, atomic-state CLI (status, sweeps, oracle-diff/ack, deliver)
├── skills/loop/      the per-pass protocol (/seeks:loop)
├── commands/         the 8 /seeks:* commands
└── test/             103 unit tests + a headless e2e harness driven by a real claude -p
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
