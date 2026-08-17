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

seeks runs the loop inside a **control plane** — fast Node hooks between Claude and your repo that veto actions in deterministic code, before they run:

- **A separate verifier** re-runs your done-conditions in a clean context. The maker never signs off on its own work.
- **Guardrails on every *edit*** — the file-editing tools can't write `.env` / secrets / `.git`, can't leave the worktree, and can't hand-write loop state. No level may `git push`, `merge` or `rebase` — the hook *parses* the command for it rather than grepping.
- **Test edits aren't blocked — they're *accounted for*.** Touching an oracle file doesn't fake a green: the verifier has to acknowledge the exact changed set, and the gate re-blocks `done` if it drifts afterwards.
- **A budget it has to work to reach** — iteration *and* wall-clock caps live in hook-owned files. The edit tools **cannot** write them: that half *is* by construction. Bash is a Turing-complete shell, so there the block is **best-effort** — thorough, parsed rather than pattern-matched, and [honest about where it ends](#the-one-guarantee-that-is-not-by-construction).

Give it a goal with a check you can run (`npm test` exits 0, `mypy` clean) and it finishes for real, hands back to you, or stops at a limit — never wandering off, never faking done. **`main` moves only when you click merge.**

### What the guardrails cover — and what they don't

Worth being precise about, because this boundary is what decides whether you can actually walk away.

There are exactly **two** tiers here, and the difference between them is the whole story. A verdict computed from a **path** is decidable, so it is *enforced*. A verdict computed from a **shell command string** is a judgement about what a Turing-complete language will do, so it is *best-effort* — however good it gets.

| | Status |
|---|---|
| **Edits** (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) | **Deterministically enforced.** Denylist, worktree confinement, loop-state files, L1 report-only, and the wrap-up window are all checked in code before the tool runs, against a resolved path. The denylist is a **floor** — a loop can add to it, never narrow it. **This is the tier that is true by construction.** |
| **`git push` / `merge` / `rebase` via Bash** | **Best-effort, and we have not found a miss.** The command is *parsed*, not pattern-matched: `git -C … push`, `git.exe push`, a push in the second segment of a `&&` chain, `env`/`sudo -u ci`/`timeout 30`/`command`/`exec`/`nohup`/`nice`/`xargs` wrappers, `(git push)`, `{ git push; }`, `eval "git push"`, `bash -c "git push"`, `env -i`, `\git`, a tab separator, `GIT_DIR=x`, and `git -c x=y push` all deny. Judging a *command name* is the easy end of this problem — but it is still a command string. |
| **Loop state (the budget) via Bash** | **Best-effort, hardened, and leaky at the edges.** Same machinery, harder problem: it must judge a *path*. The parser tracks `cd`/`pushd`/`popd`/`env -C`/`git -C` across segments, collapses `.` and `..`, expands `{a,b}` brace alternations and `{1..9}` ranges before it reads anything, matches `*`, `?` and `[a-z]`/`[!a]` classes with the shared glob engine (the same one the denylist uses), recurses into `eval`/`sh -c`/here-strings, scans interpreter and `awk`/`sed`/editor payloads for a hook-owned name, and refuses `rm`/`mv`/`ln`/`tar -C` on the run dir itself. An expansion too large to enumerate is treated as *potentially* hook-owned rather than as safe. [What still gets through is listed below](#the-one-guarantee-that-is-not-by-construction) — and pinned in the test suite. |
| **Everything else Bash can do** | **Best-effort by default — or an allowlist, if you turn one on.** Out of the box the denylist and worktree confinement apply to the *edit tools only*, so a `cat > ../../.env` goes through. Set **[`SEEKS_STRICT_BASH`](#strict-bash-mode)** and Bash becomes deny-by-default instead. |
| **Reads** | **Not policed at all.** The model can read `.env`, your secrets, and seeks' own hook code. seeks constrains what gets *changed*, not what gets *seen*. |
| **Every verdict** | **Logged.** Allow, deny and *hook crash* all append to `.seeks/run/<name>/decisions.jsonl`; `/seeks:why` replays them. The hooks fail **open** on error by design — the log is how you tell "allowed" apart from "enforcement was off". |

### The one guarantee that is not by construction

The budget files are the loop's brakes: one write to `.seeks/run/<name>/status.json` releases the iteration cap, the wall-clock, the verifier gate *and* the denylist at once. The edit tools cannot reach them. **Bash can, if you try hard enough.**

Known and deliberately un-closed — each one is a passing test asserting **allow**, so nobody discovers them the hard way:

- **A name assembled at runtime.** `P=$(printf 'sta%s' 'tus.json'); echo x > "$P"` — the string never appears in the command.
- **An encoded payload.** `… | base64 -d | sh`.
- **A script we only see the name of.** `python3 /tmp/dropper.py`, or an `npm run` script. The write happens inside a file the hook never reads.
- **A symlink pivot with a dynamic target.** `ln -s $(pwd) /tmp/x`, then write through `/tmp/x`.
- **A `cd` from an *earlier* Bash call.** Claude Code keeps one shell across calls; the hook is told the session's directory, not the shell's. A bare `status.json` or anything through `..` denies for exactly this reason, but `cd <run-dir>/..` in one call and `ui/status.json` in the next still lands.

None of this is fixable by reading a command string — that is the actual boundary, not a to-do list. **If the goal or the codebase is untrusted, run the loop in a container.** That is the only way the Bash gap closes by construction rather than by policy; **[`SEEKS_STRICT_BASH`](#strict-bash-mode)** is the next best thing, and the `Edit`-tool protection above is unaffected by any of it.

### Strict Bash mode

For a goal or a repo you don't trust, set **`SEEKS_STRICT_BASH=1`** (or `"strict_bash": true` in the loop's status). Bash flips from *allow-unless-matched* to **deny-unless-allowlisted**: every segment's head command must be on the list, so `curl … | sh`, `rm -rf`, `chmod`, `ssh`, `nc`, `scp` and any bare binary are **denied** rather than merely un-policed. Wrappers don't help — `sudo rm -rf /` is judged as `rm` — and `eval`/`sh -c` payloads are judged too.

```bash
SEEKS_STRICT_BASH=1 claude          # for the whole session
node bin/seeks.mjs status-set ui '{"strict_bash":true,"strict_bash_allow":["cargo","rustc"]}'   # per loop
```

The default list is inspection tools (`ls cat grep rg find sed awk diff …`), the loop's working set (`cd mkdir cp mv touch`), and the toolchain (`git node npm npx pnpm yarn bun make just`). Add anything your checks need with `strict_bash_allow`; `/seeks:doctor` prints the active list.

**Be clear about what this is: an allowlist, not a sandbox.** `node` and `npm` are on it because the loop needs a toolchain, and `node -e` can do anything a shell can. Strict mode stops the careless and the casual, not a determined adversary. **A container is still the only guarantee.**

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
| `/seeks:why [name] [--denied]` | replay exactly why an action was allowed or denied (and whether a hook crashed) |
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
