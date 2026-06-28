<p align="center">
  <img src="assets/seeks.png" alt="Seeks" width="240">
</p>

<h1 align="center">seeks</h1>

<p align="center"><em>Self-running, verifier-gated loops for Claude Code.</em><br>
The loop <strong>seeks</strong> its done-conditions — and doesn't stop until a separate verifier says they're met (or a hook-owned backstop halts it).</p>

<p align="center">
  <code>Node ≥18</code> · <code>zero runtime deps</code> · <code>git worktrees</code> · <code>60/60 tests</code>
</p>

<!-- Existence is pain to a Seeks. It seeks its done-conditions, certifies, and *poofs*. 🔵 -->

---
## DICLAIMER: WORK IN PROGRESS - PRE ALPHA TEST - VERY EARLY BUILD - GIVE FEEDBACK

## What is it?

`seeks` turns a long, goal-directed task into a **self-driving loop**. You describe a goal with **measurable, executable done-conditions**; a tiny **Stop hook** keeps the session grinding — pass after pass, surviving context compaction — until an **independent verifier** certifies the goal is met, or a safety backstop halts it.

It composes the primitives Claude Code already ships (the Stop hook, subagents, native worktrees) into a one-install plugin with **durable, git-trackable loop definitions** and a *"don't stop until provably done"* engine.

**Best for goals with an executable oracle** — tests green, typecheck/lint/build pass, coverage up, migrations/codemods/refactors. Partial fit for taste-driven work via artifact-judged conditions + human checkpoints.

## How a loop ends — three terminal states (all proven end-to-end)

| Input | Terminal | How |
|---|---|---|
| solvable task | ✅ **done** | maker fixes it → verifier certifies green |
| impossible task | ⏸ **needs-human** | verifier rejects until `condition_rejects` hits its threshold |
| never-converging | ⛔ **max-iters** | the hook's `stop_fires` reaches the iteration budget |

## Requirements

`seeks` is 100% Node — the hooks, the CLI, and the tests are all `.mjs`. Before installing:

- **Node ≥ 18** and **git**, both on the **hook** `PATH`. Claude Code's installer does **not** bundle Node, so if `node -v` fails, install it first.
- **Install Node *system-wide*, not via nvm/fnm/asdf.** Version managers only add `node` to *interactive* shells; Claude Code runs hooks in a *non-interactive* subprocess that then can't find it — every stop fails with **`Stop hook error: … node not found`** and the loop never drives. System installs (NodeSource / your distro package) land in `/usr/bin`–`/usr/local/bin`, which hooks always see.

Already on nvm/fnm and hitting "node not found"? Any one of these fixes it:
- symlink where hooks look: `sudo ln -s "$(command -v node)" /usr/local/bin/node`
- pin `PATH` in `~/.claude/settings.json` → `"env": { "PATH": "/your/node/bin:/usr/bin:/bin" }`
- launch `claude` from a shell where `node -v` already works

`/seeks:doctor` checks `node`/`git` and prints this exact remedy.

## Quick start

**1. Install** — from GitHub, on any Claude Code instance:
```
/plugin marketplace add Bogzx/seeks
/plugin install seeks@seeks
```
then `/reload-plugins` (or restart). *Hacking on it locally? `claude --plugin-dir "/path/to/seeks"` loads it straight from your working tree instead.*

**2. Create a loop** — interview for the goal + executable done-conditions:
```
/seeks:new my-loop
```

**3. Run it** until done / needs-human / stuck / max-iters:
```
/seeks:start my-loop
```
Each pass prints a banner: `▸ my-loop · pass 3 · items 9→7 · edited Button.tsx · continuing`.

**4. Review & integrate** (never auto-merges):
```
/seeks:harvest my-loop
```

## Commands

| Command | What it does |
|---|---|
| `/seeks:new <goal>` | plain-English goal → **auto-named** loop; interview for done-conditions, analyze, scaffold |
| `/seeks:start [name]` | arm + enter the worktree + drive the loop (no name = the **most-recent** loop; refreshes a stale base) |
| `/seeks:status [name]` | show loop state, **level**, + backlog counts |
| `/seeks:add <name> <task…>` | append a backlog item |
| `/seeks:stop <name>` | disarm so the session can end cleanly |
| `/seeks:harvest [name]` | list finished loops with branch diffs for review |
| `/seeks:delete <name>` | tear down worktree + branch + run state |
| `/seeks:doctor` | health / regression check |

## What it does to your code — *levels*

Every loop runs at a **level** that bounds what it may do (set in `spec.md` frontmatter; `/seeks:new` tells you which and lets you choose):

| Level | What it does to your code | Pushes / merges? |
|---|---|---|
| **L1** | **report only** — reads and reports findings, makes **no edits** | no |
| **L2** *(default)* | **edits + commits** on an isolated `seeks/<name>` branch in its own worktree | **never** |
| **L3** | autonomous (push / bypass) | *not in v1* |

**seeks never pushes or merges for you.** Your `main` is untouched — all work happens on `seeks/<name>`. When a loop finishes, `/seeks:harvest` shows you the diff and *recommends* review; **you** decide whether to merge.

## How it works — *dumb gate, smart agent*

- **The hook is dumb but safety-authoritative.** A fast, zero-dep Node `Stop` hook resolves the loop via `git rev-parse --git-common-dir`, owns a monotonic `stop_fires` counter + heartbeat in `hook-state.json`, decides **block vs allow**, and prints the banner. A `decision:block` **hard-forces** the next turn.
- **The agent is smart.** Guided by the bundled `/seeks:loop` skill, it does **one pass per turn** — make an edit (and commit on `seeks/<name>`), *or* run the verifier — then ends its turn so the hook re-drives it. It mutates semantic state only through the tested, atomic `bin/seeks.mjs` CLI; it never hand-writes JSON.
- **Maker ≠ checker.** When the backlog empties, a **separate verifier subagent** `cd`s into the worktree, runs each done-condition itself, and is the *only* writer of `verifier_certified`. It runs a `git diff` **anti-cheat** so the maker can't edit the oracle to force green.

> **One pass per turn is load-bearing**, not a style choice: the `max_iters` backstop counts *turn-ends*, so the loop must yield each pass for the cap (and compaction-survival) to work.

## Layout

```
seeks/
├── .claude-plugin/   plugin.json + marketplace.json
├── hooks/            stop-gate.mjs · session-restore.mjs · lib/*.mjs
├── bin/seeks.mjs     name-based, atomic state CLI
├── skills/loop/      per-pass protocol (/seeks:loop)
├── commands/         the 8 /seeks:* commands
├── test/             60 node:test unit tests + headless e2e harness
└── docs/             DESIGN · PLAN · FINDINGS
```

Only the **definition** is git-tracked (`.seeks/loops/<name>/spec.md`, `.seeks/config.json`); runtime progress under `.seeks/run/` is gitignored.

## Status

**v1.** 60/60 unit tests; all three terminal states demonstrated end-to-end against deliberately-built fixtures, with anti-cheat clean across every verifier round, plus a real headless opus bug-hunt on a 349-file C# codebase (36 findings, certified via two dry sweeps).

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
