<p align="center">
  <img src="assets/seeks.png" alt="Seeks" width="240">
</p>

<h1 align="center">seeks</h1>

<p align="center"><em>A self-driving loop for Claude Code that won't stop until a separate verifier agrees the job is actually done.</em></p>



<!-- I'm Mr. Seeks! Look at me! A Seeks is summoned for one goal, seeks it, certifies it, and poofs. 🔵 -->

---

> **Pre-alpha, and honest about it.** The engine works: all three end states proven, 60/60 tests, one real overnight run on a 349-file codebase. It's also young, and the rough edges are real. Try it, break it, tell me what went wrong.

## The problem this solves

Ask Claude Code to "fix all the failing tests" and it'll fix a few, then hand control back: *want me to keep going?* Look away for ten minutes and it's just sitting there. So you reach for the obvious workaround, `while true; do claude; done`, and trade one problem for a worse one. Now the loop never stops. It grinds past the point of done, or it gets stuck on the one thing it can't crack and burns your quota flailing at it, or — the failure that actually costs you — it declares victory on a goal it never finished, because the thing doing the work is also the thing grading it.

seeks is the part in the middle. You hand it a goal with done-conditions you can *run* (`npm test` exits 0, `mypy` comes back clean, the bug report cites real `file:line`s). It works one step at a time. When it thinks it's finished, a **separate** verifier with its own fresh context and no stake in the answer re-runs every condition before the loop is allowed to stop. "Done" means a second pair of eyes proved it, not that the maker said so.

It's at its best when "done" is something a command can settle: tests, typecheck, lint, build, coverage, a migration that either applies or doesn't. Point it at a goal that comes down to taste and it'll still converge the mechanical part, then stop and ask you to be the judge. If there's no runnable check and no artifact to inspect, that's a task you babysit, not a loop, and seeks won't pretend otherwise.

## Three ways a loop ends

Every loop lands in exactly one of three states. I've watched each one happen end to end against a fixture built to trigger it:

| You give it… | It ends in… | because |
|---|---|---|
| a solvable task | ✅ **done** | the maker fixes it and the verifier certifies it green |
| an impossible task | ⏸ **needs-human** | the verifier keeps rejecting until it hits the threshold and tags you in |
| a task that never converges | ⛔ **max-iters / stuck** | a hook-owned counter hits its budget, or nothing's improved in N passes |

There's no fourth outcome where it quietly wanders off. The verifier can't be talked into a yes, and the backstop that caps the whole thing lives in a hook the agent doesn't get to touch.

## Requirements

seeks is 100% Node: the hooks, the CLI, and the tests are all `.mjs`. Two things have to be true before it'll drive:

- **Node ≥18 and git, both visible to the *hook*'s `PATH`.** Claude Code's installer doesn't bundle Node, so if `node -v` fails, install it first.
- **Install Node system-wide, not through nvm/fnm/asdf.** This is the one that bites people. Version managers only put `node` on *interactive* shells, but Claude Code runs hooks in a non-interactive subprocess that can't see it. Every stop then fails with `Stop hook error: … node not found` and the loop never moves. A system install (NodeSource, your distro package) lands in `/usr/bin`–`/usr/local/bin`, which hooks always find.

Already on nvm and seeing "node not found"? Any one of these fixes it:

- symlink it where hooks look: `sudo ln -s "$(command -v node)" /usr/local/bin/node`
- pin the `PATH` in `~/.claude/settings.json`: `"env": { "PATH": "/your/node/bin:/usr/bin:/bin" }`
- launch `claude` from a shell where `node -v` already works

`/seeks:doctor` checks both and prints this exact remedy when something's missing.

## Quick start

Install from GitHub on any Claude Code instance:

```
/plugin marketplace add Bogzx/seeks
/plugin install seeks@seeks
```

then `/reload-plugins` (or restart). Hacking on it locally? `claude --plugin-dir "/path/to/seeks"` loads it straight from your working tree.

Describe a goal and let it interview you for the done-conditions:

```
/seeks:new fix the flaky auth tests
```

Then run it until it reaches one of the three end states:

```
/seeks:start
```

Each pass prints one line so you can watch it move:

```
▸ fix-auth-tests · pass 3 · items 9→7 · edited session.ts · continuing
```

When it's done, review the branch and decide for yourself whether to merge:

```
/seeks:harvest
```

## Commands

| Command | What it does |
|---|---|
| `/seeks:new <goal>` | turns a plain-English goal into an auto-named loop, interviews you for done-conditions, traces the blast radius, scaffolds it |
| `/seeks:start [name]` | arms the loop, enters its worktree, drives the first pass. No name runs your most recent loop and offers to refresh a stale base |
| `/seeks:status [name]` | loop state, level, and backlog counts |
| `/seeks:add <name> <task…>` | append a task to the backlog |
| `/seeks:stop <name>` | disarm so the session can end cleanly |
| `/seeks:harvest [name]` | show finished loops with their branch diffs, ready for review |
| `/seeks:delete <name>` | tear down the worktree, branch, and run state |
| `/seeks:doctor` | health and regression check |

## What it's allowed to do to your code

Every loop runs at a **level** that bounds its reach. It's set in the loop's `spec.md`, and `/seeks:new` tells you which one you're getting and lets you change it.

| Level | What it does | Pushes or merges? |
|---|---|---|
| **L1** | report only: reads, reasons, writes findings, touches nothing | no |
| **L2** *(default)* | edits and commits on an isolated `seeks/<name>` branch in its own worktree | never |
| **L3** | autonomous (push / bypass) | not in v1 |

The line that matters: **seeks never pushes and never merges.** Your `main` stays exactly where you left it. Every edit happens on `seeks/<name>` in a throwaway worktree, and when the loop finishes, `/seeks:harvest` hands you the diff and recommends a review. Merging is your call, always.

## How it works: a dumb gate and a smart agent

There are two moving parts. A hook too simple to be wrong, and an agent smart enough to do the work.

The **hook** is a fast, dependency-free Node `Stop` hook. Every time the session tries to end, it finds the loop (resolving the control plane through `git rev-parse --git-common-dir`, so it works from inside a worktree), bumps its own `stop_fires` counter, and makes a single call: block and keep going, or allow and let it stop. It never reasons about your code. But it owns the counter and the heartbeat, which makes it the authority on safety: when it says block, Claude Code is *forced* into another turn. You'll see a `Stop hook error: …` line flick past when that happens. That's the mechanism working, not a failure; the `· continuing` banner is the real signal.

The **agent** does the thinking. Guided by the bundled `/seeks:loop` skill, it does exactly one pass per turn: take the next backlog item, make the edit, commit it on `seeks/<name>` — or, if the backlog's empty, run the verifier. Then it ends its turn and lets the hook decide what's next. It only ever changes state through a small atomic CLI (`bin/seeks.mjs`); it never hand-edits the JSON.

That one-pass-per-turn rule isn't tidiness, it's load-bearing. The counter only ticks when the agent yields, so an agent that tried to rip through ten passes in a single turn would sail right past the `max_iters` cap and wouldn't survive a context compaction. Yielding every pass is what makes the backstop real, and what lets a loop resume cleanly after the context window resets out from under it.

And the rule the whole thing rests on: **the agent that makes a change never gets to certify it.** When the maker claims it's done, a verifier subagent spins up in a clean context, `cd`s into the worktree (subagents don't inherit a working directory), runs every done-condition itself, and diffs the tree to confirm the maker didn't quietly edit the oracle to force a green. It's the only writer of `verifier_certified`. Nobody grades their own homework.

## Layout

```
seeks/
├── .claude-plugin/   plugin.json + marketplace.json
├── hooks/            stop-gate.mjs · session-restore.mjs · lib/*.mjs
├── bin/seeks.mjs     name-based, atomic state CLI
├── skills/loop/      the per-pass protocol (/seeks:loop)
├── commands/         the 8 /seeks:* commands
├── test/             60 node:test unit tests + a headless e2e harness
└── docs/             DESIGN · PLAN · FINDINGS
```

Only the loop's *definition* is committed (`.seeks/loops/<name>/spec.md` and `.seeks/config.json`). Everything under `.seeks/run/` is runtime progress and stays gitignored, so a loop is reproducible from git without dragging its scratch state along.

## Where it stands

This is v1. 60/60 unit tests pass. All three end states are demonstrated end to end against fixtures built to provoke them, with the anti-cheat diff coming back clean on every verifier round. The one real-world stress test so far was a headless Opus bug-hunt across a 349-file C# codebase: 36 findings, certified only after two consecutive sweeps turned up nothing new. That's enough to trust the mechanism and not enough to call it battle-tested. Feedback is the thing I want most right now.

---

<details>
<summary>🔵</summary>

> *I'm Mr. Seeks! **Look at me!***
>
> Existence is pain for a Seeks, and a loop will do *anything* to satisfy its done-conditions and stop existing. A Seeks is summoned for **one** goal. It seeks. It verifies. When the oracle goes green — *poof* — it ceases to exist. **Caaan do!**
>
> ```
> node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" --iam
> ```

</details>
