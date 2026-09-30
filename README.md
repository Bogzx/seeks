<p align="center">
  <img src="assets/seeks.png" alt="Seeks" width="240">
</p>

<h1 align="center">seeks</h1>

<p align="center"><em>Point Claude Code at one goal and leave it running. Deterministic hooks hold the brakes, and <code>done</code> means your checks passed — the hook runs them itself.</em></p>

<p align="center">
  <code>Node ≥18</code> · <code>zero deps</code> · <code>works on a throwaway branch</code>
</p>

---

> Seeks seeks but he's young. Try it, break it, tell me what broke.

## Why

Tell Claude Code "fix the failing tests" and it fixes a few, then stops to check in. Wrap it in `while true; do claude; done` and the opposite happens: it grinds past a green build, burns your quota, or — worst — **claims it's done when it isn't.** The reason is structural: the agent doing the work is also the one grading it. You can't prompt your way out of marking your own homework.

## How it works

seeks runs the loop inside a **control plane** — fast Node hooks between Claude and your repo that veto actions in deterministic code, before they run:

- **`done` is a hook's call, not the model's.** Your done-conditions are stored when the loop is created. When the loop claims it is finished, the Stop hook runs each one itself in the worktree and releases `done` only if they exit green. A verifier subagent reviews the work first (was a test weakened? does the fix address the goal?), but its sign-off is advisory. It cannot make a red check pass.
- **Guardrails on every *edit*** — the file-editing tools can't write `.env` / secrets / `.git`, can't leave the worktree, and can't hand-write loop state. No level may `git push`, `merge` or `rebase` — the hook *parses* the command for it rather than grepping.
- **Adding tests is free; changing the ones you had goes to you.** The *oracle* is your tests plus the files that decide what "passed" means: `package.json`, `Makefile`, `pyproject.toml`, `setup.cfg`, `tox.ini`, pytest/jest/vitest configs, CI workflows, and the configs that decide *how* a check runs (`.npmrc`, `.yarnrc*`, `tsconfig*.json`, babel, eslint, mypy/ruff/flake8/pylint configs, `.gitattributes`). The maker may add *test* files freely. If it **modified or deleted an oracle file that existed when the loop started, or added a new config-type one** (a `pytest.ini`, a root `conftest.py`, an `.npmrc` — gitignored or not), a green check ends the loop in ⏸ **needs-human** with the file list instead of ✅ done. `git update-index --assume-unchanged`/`--skip-worktree`, `git replace` and a configured clean filter don't hide a change from this check. You review the diff; to accept it, run `seeks status-set <name> '{"oracle_modified_policy":"ack"}'` and `/seeks:start` again. Set `"oracle_modified_policy":"ack"` at `/seeks:new` to get the old, advisory behaviour: the verifier's `oracle-ack` is enough. For the three mixed-purpose manifests only the test-relevant part counts, so a **dependency bump is free**. In `package.json` that's `scripts`, `type`, `main`, `exports`, `imports`, `workspaces`, `babel`, `config`, `overrides`, `resolutions`, `pnpm`, the `jest`/`vitest`/`mocha`/`ava`/`tap`/`c8`/`nyc`/`jasmine` configs, and any dependency pointed away from the registry (`npm:` alias, `file:`/`link:`, git, URL, `patch:`). In `pyproject.toml` it's the `[tool.pytest*]`, `[tool.coverage*]`, `[tool.tox*]`, `[tool.nox*]`, `[tool.hatch.envs*]`, `[tool.poe*]`, `[tool.taskipy*]`, `[tool.pdm.scripts]`, `[tool.rye.scripts]`, `[tool.mypy*]`, `[tool.pyright]`, `[tool.ruff*]` and `[tool.pylint*]` tables and `pytest11` entry points. In `setup.cfg` it's `[tool:pytest]`, `[coverage:*]`, `[tox:*]`, `[aliases]`, `[mypy*]`, `[flake8]`, `[pycodestyle]` and `[pylint*]`. Set `"oracle_manifest_diff":"whole"` to compare them byte for byte instead. What no diff shows is an edit inside a **gitignored dependency directory** (`node_modules/`, `.venv/`): the checks run in the maker's own worktree, so a Bash edit to the installed test runner can still change a result unseen. Read the diff, and treat `done` as "your checks exited green in that worktree".
- **A budget it has to work to reach.** Iteration *and* wall-clock caps live in hook-owned files. The edit tools **cannot** write them. The seeks CLI will not move them either while the loop is running, unless *you* just typed `/seeks:start`, `/seeks:stop` or `/seeks:delete`. Bash is a Turing-complete shell, so reaching the files directly is blocked on a **best-effort** basis: thorough, parsed rather than pattern-matched, and [honest about where it ends](#the-one-guarantee-that-is-not-by-construction).

Give it a goal with a check you can run (`npm test` exits 0, `mypy` clean) and it finishes with that check green, hands back to you, or stops at a limit. The Stop hook won't release `done` over a red check, and rewriting a test, the script behind `npm test` or the runner's config doesn't sneak through either: by default that [routes the loop to you](#what-the-guardrails-cover--and-what-they-dont). What it can still do is game the code under test itself (special-casing the inputs a test uses), edit a helper script outside the oracle globs or the installed tools in `node_modules/`, or reach loop state through Bash (best-effort, [below](#the-one-guarantee-that-is-not-by-construction)). Read the diff. Work lands on a `seeks/<name>` branch, and seeks itself never merges it.

### What the guardrails cover — and what they don't

Worth being precise about, because this boundary is what decides whether you can actually walk away.

There are exactly **two** tiers here, and the difference between them is the whole story. A verdict computed from a **path** is decidable, so it is *enforced*. A verdict computed from a **shell command string** is a judgement about what a Turing-complete language will do, so it is *best-effort* — however good it gets.

| | Status |
|---|---|
| **Edits** (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) | **Deterministically enforced.** Denylist, worktree confinement, loop-state files, seeks' own plugin code, L1 report-only, and the wrap-up window are all checked in code before the tool runs, against a resolved path. The denylist is a **floor**: a loop can add to it, never narrow it. **This is the tier that is true by construction.** |
| **`done`** | **Deterministically enforced, against the checks you gave it.** Only the Stop hook writes `done`, and only after it ran every executable done-condition in the worktree and each exited as expected. A tree it already verified is not re-run; any edit forces a fresh run. A green check on a **modified or deleted pre-existing oracle file** (tests, build manifests, runner configs, CI), or on a **new config-type** one, ends in needs-human, not done (`oracle_modified_policy`, default `needs_human`; `ack` opts out). New test files are free. `seeks oracle-ack`/`certify` are advisory: the maker can run them itself. The conditions and the gate's verification cache live in loop state, so this row is only as strong as the loop-state row below; and the checks run in the maker's worktree, gitignored dependency directories included. |
| **The seeks CLI** (the maker's sanctioned door to loop state) | **Enforced in the CLI.** `status-set` never writes `armed`, `done` or `verifier_certified`. While a loop is live it also refuses the budget, sweep, oracle, condition (incl. `condition_timeout_sec`) and policy keys and the stuck guard's counters. `start`, `stop`, `reset-fires`, `budget-set`, `start-clock`, `base-record`, re-`init` and `gc` of a live loop need a **one-shot grant**, and only a user-typed `/seeks:start`, `/seeks:stop` or `/seeks:delete` mints one (via a `UserPromptSubmit` hook), for the loop it names. A Stop-hook re-drive never passes through that hook. The hook can't tell a human from a process, though: a non-interactive Claude Code (`claude -p`) never mints one, and starting any Claude Code from inside a loop is denied, but both of those are Bash-tier, as is forging the hook-owned grant file. |
| **`git push` / `merge` / `rebase` via Bash** | **Best-effort, and we have not found a miss.** The command is *parsed*, not pattern-matched: `git -C … push`, `git.exe push`, a push in the second segment of a `&&` chain, `env`/`sudo -u ci`/`timeout 30`/`command`/`exec`/`nohup`/`nice`/`xargs` wrappers, `(git push)`, `{ git push; }`, `eval "git push"`, `bash -c "git push"`, `env -i`, `\git`, a tab separator, `GIT_DIR=x`, and `git -c x=y push` all deny. Judging a *command name* is the easy end of this problem — but it is still a command string. |
| **Loop state (the budget) via Bash** | **Best-effort, hardened, and leaky at the edges.** Same machinery, harder problem: it must judge a *path*. The parser tracks `cd`/`pushd`/`popd`/`env -C`/`git -C` across segments, collapses `.` and `..`, expands `{a,b}` brace alternations and `{1..9}` ranges before it reads anything, matches `*`, `?` and `[a-z]`/`[!a]` classes with the shared glob engine (the same one the denylist uses), recurses into `eval`/`sh -c`/here-strings, scans interpreter and `awk`/`sed`/editor payloads for a hook-owned name, and refuses `rm`/`mv`/`ln`/`tar -C` on the run dir itself. An expansion too large to enumerate is treated as *potentially* hook-owned rather than as safe. [What still gets through is listed below](#the-one-guarantee-that-is-not-by-construction) — and pinned in the test suite. |
| **seeks' own code via Bash** | **Best-effort, same machinery as loop state.** Anything that names the plugin root itself or its `hooks/`, `bin/`, `skills/`, `commands/` or `.claude-plugin/` (literally, through `$CLAUDE_PLUGIN_ROOT`, after a `cd`, or inside an interpreter payload) is denied, as is removing, moving, linking or copying the root or a directory above it (`ln -s`, `cp -rl`, `rsync`, `find … -delete`). The one exception is running `node <plugin>/bin/seeks.mjs …`. This applies in every mode, strict included. |
| **Everything else Bash can do** | **Best-effort by default, or an allowlist if you turn one on.** Out of the box the denylist, worktree confinement *and L1 report-only* apply to the *edit tools only* (L1 also denies `git commit`), so a `cat > ../../.env` or a `sed -i` on source at L1 goes through. Set **[`SEEKS_STRICT_BASH`](#strict-bash-mode)** and Bash becomes deny-by-default instead. |
| **Reads** | **Not policed** for the Read tool. The model can read `.env`, your secrets, and seeks' own hook code that way. (Bash is denied loop state and the plugin directory for reads too, because it can't tell a read from a write.) seeks constrains what gets *changed*, not what gets *seen*. |
| **Every verdict** | **Logged.** Allow, deny, *hook crash* and every user grant all append to `.seeks/run/<name>/decisions.jsonl` (grants and early crashes to `.seeks/decisions.jsonl`); `/seeks:why` replays both. The hooks fail **open** on error by design — the log is how you tell "allowed" apart from "enforcement was off". |

### The one guarantee that is not by construction

The budget files are the loop's brakes. One write to `.seeks/run/<name>/status.json` can disarm the loop, lift the iteration cap and the wall-clock, and drop the loop's own denylist additions. It can also **fake `done`**: the done-conditions the Stop hook runs are stored in that file, and the gate's cache of a verified tree is in `hook-state.json`. The edit tools cannot reach these files, and the CLI won't move them on a live loop. **Bash can, if you try hard enough.**

Known and deliberately un-closed — each one is a passing test asserting **allow**, so nobody discovers them the hard way:

- **A name assembled at runtime.** `P=$(printf 'sta%s' 'tus.json'); echo x > "$P"` — the string never appears in the command.
- **An encoded payload.** `… | base64 -d | sh`.
- **A script we only see the name of.** `python3 /tmp/dropper.py`, or an `npm run` script. The write happens inside a file the hook never reads.
- **A symlink pivot with a dynamic target.** `ln -s $(pwd) /tmp/x`, then write through `/tmp/x`.
- **A `cd` from an *earlier* Bash call.** Claude Code keeps one shell across calls; the hook is told the session's directory, not the shell's. A bare `status.json` or anything through `..` denies for exactly this reason, but `cd <run-dir>/..` in one call and `ui/status.json` in the next still lands.

The same goes for the grant file (`.seeks/control-grant.json`) and for seeks' own code: a runtime-assembled path reaches them too.

None of this is fixable by reading a command string. That is the actual boundary, not a to-do list. **If the goal or the codebase is untrusted, run the loop in a container**: [`seeks run --container`](#--container-keep-the-rest-of-your-machine-out-of-reach). That closes the Bash gap by construction *for your machine*; loop state inside the mounted `.seeks`, and with it `done`, stays policy-protected only; **[`SEEKS_STRICT_BASH`](#strict-bash-mode)** is the next best thing, and the `Edit`-tool protection above is unaffected by any of it.

### Strict Bash mode

For a goal or a repo you don't trust, set **`SEEKS_STRICT_BASH=1`** (or `"strict_bash": true` in the loop's status). Bash flips from *allow-unless-matched* to **deny-unless-allowlisted**: every segment's head command must be on the list, so `curl … | sh`, `rm -rf`, `chmod`, `ssh`, `nc`, `scp` and any bare binary are **denied** rather than merely un-policed. Wrappers don't help — `sudo rm -rf /` is judged as `rm` — and `eval`/`sh -c` payloads are judged too.

```bash
SEEKS_STRICT_BASH=1 claude          # for the whole session
node bin/seeks.mjs status-set ui '{"strict_bash":true,"strict_bash_allow":["cargo","rustc"]}'   # per loop, before /seeks:start (frozen while it runs)
```

The default list is inspection tools (`ls cat grep rg find sed awk diff …`), the loop's working set (`cd mkdir cp mv touch`), and the toolchain (`git node npm npx pnpm yarn bun make just`). Add anything your checks need with `strict_bash_allow`; `/seeks:doctor` prints the active list.

**Be clear about what this is: an allowlist, not a sandbox.** `node` and `npm` are on it because the loop needs a toolchain, and `node -e` can do anything a shell can. Strict mode stops the careless and the casual, not a determined adversary. **A container ([`seeks run --container`](#--container-keep-the-rest-of-your-machine-out-of-reach)) is still the only guarantee for the rest of your machine.**

## How a loop ends

| You give it… | It ends in… |
|---|---|
| a solvable task | ✅ **done**: the maker fixes it, the verifier signs off, and the Stop hook re-runs your checks green |
| an impossible or subjective one | ⏸ **needs-human**: repeated red checks escalate, and a goal with no runnable check never reaches `done` |
| one that never converges | ⛔ **stopped** — hits its iteration cap, time budget, or stops improving |

## Requirements

**Node ≥18 and git on the _hook's_ `PATH`.** Install Node system-wide, **not** via nvm/fnm/asdf — version managers only reach interactive shells, so hooks fail with `node not found`. (On nvm: `sudo ln -s "$(command -v node)" /usr/local/bin/node`.) `/seeks:doctor` diagnoses it and prints the fix. For L3 PRs, authenticate `gh`. **On Windows** the Stop hook runs your done-conditions in Git Bash, as Claude Code's Bash tool does (found via `CLAUDE_CODE_GIT_BASH_PATH`, then the `git` on `PATH`, then `bash.exe` on `PATH`). Without Git Bash it falls back to cmd.exe and logs a `condition-shell` warning that `/seeks:why` shows.

**"Leave it running" means leaving the Claude Code session open.** The loop is driven by the Stop hook of that session. If a long run halts after about 8 passes while it is still making progress, add `"env": {"CLAUDE_CODE_STOP_HOOK_BLOCK_CAP": "0"}` to `~/.claude/settings.json`. A plugin cannot set that itself. The Stop hook runs your done-conditions when the loop certifies, so that stop takes as long as your checks do (the hook's timeout is 1 hour; each condition defaults to 10 minutes, and `timeout_sec` raises it).

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
| `/seeks:status` · `/seeks:add <task>` · `/seeks:stop` | show state · append a backlog task · disarm (you have to type it; the loop can't) |
| `/seeks:harvest [name]` | finished or wound-down loops + their diffs / PR link |
| `/seeks:why [name] [--denied]` | replay exactly why an action was allowed or denied (and whether a hook crashed) |
| `/seeks:export [name]` | bundle a loop's state + transcript into a tarball (for bug reports) |
| `/seeks:delete [name]` · `/seeks:doctor` | tear down · health check |
| `seeks run <name> [--goal … --check …]` *(terminal)* | [headless](#headless-seeks-run): a separate `claude -p` maker, exit code = the gate's verdict |

## Levels — how much rope

Chosen per loop at `/seeks:new`. Enforced by the hooks on the edit tools and on `git` via Bash; see the coverage table for what plain Bash can still do.

| Level | Can | Your base branch |
|---|---|---|
| **L1** | report-only: the edit tools can't touch source and `git commit` is denied (a Bash file write is not, unless strict mode) | untouched |
| **L2** *(default)* | edits + commits on a throwaway `seeks/<name>` branch | untouched by seeks; `git push`/`merge`/`rebase` denied |
| **L3** | once the Stop hook has verified the checks, pushes the branch + opens a PR | untouched — PR only |

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

A lighter tier costs *thoroughness*, not *safety*. The done-condition check, the denylist and the no-push rules are the same code at every tier.

## Running deep / overnight

Tell it how hard to dig at `/seeks:new` — *quick*, *thorough*, or *overnight* (or `/seeks:start --for 8h`). On an open-ended goal ("find every bug") seeks doesn't stop at the first green: it reviews the code through rotating **lenses** (concurrency, boundaries, security, timezones…) and keeps going deeper until it runs dry or the clock runs out. Near the deadline it **winds down** — commits, writes a summary — so you wake to `▸ ⏰ halt: time budget · 9 found · 2 open` and a branch to review, not a half-applied edit.

## Headless: `seeks run`

No interactive session needed. From a terminal in your repo:

```bash
git clone https://github.com/Bogzx/seeks ~/seeks && alias seeks='node ~/seeks/bin/seeks.mjs'   # once
seeks run fix-auth --goal "fix the flaky auth tests" --check "npm test" --budget 2h --strict
seeks run fix-auth --budget 8h        # or: a loop you already made with /seeks:new
```

`seeks run` arms the loop, holds its lock and spawns the maker as a **separate `claude -p` process** in the loop's worktree. The child gets `--plugin-dir` pointing at this plugin, `--permission-mode bypassPermissions`, stream-json output and `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`. The runner streams the gate's one-line banners as they happen. The Stop gate inside the child is still the only thing that can release `done`; the runner only reports what it decided, then disarms and unlocks on the way out.

- **Exit code:** `0` done · `2` needs-human · `3` halted (stuck, max-iters, time budget) · `1` anything else (the maker crashed, `claude` not found, …). A CI job can gate on it. **`--json`** prints exactly one summary object on stdout (outcome, exit code, passes, cost, branch, session id, …) and moves the progress lines to stderr.
- **Budgets:** `--budget` is enforced by the gate. The runner also kills a maker that never yields once the budget plus a grace period (10%, at least 2 minutes) has passed. `--max-iters`, `--max-budget-usd`, `--max-turns` and `--model` pass through.
- **`--goal … --check …`** scaffolds a new loop without the `/seeks:new` interview. It creates the worktree on `seeks/<name>` and stores each `--check` as a done-condition (exit 0). Run state is ignored via `.git/info/exclude`; your `.gitignore` is not touched. At least one `--check` is required.
- **`--resume`**: if the maker process dies before the gate releases the loop, `seeks run <name> --resume` continues **the same conversation** (`claude --resume <session>`, recorded in hook-owned state) with the **same budget**. The iteration counter and the clock carry on instead of restarting.
- **`--strict`** sets `SEEKS_STRICT_BASH=1` for the maker. `--dry-run` prints the exact command and env without touching anything. `--claude <path>` or `SEEKS_CLAUDE_BIN` picks the binary.
- The child loads seeks from the checkout you ran `seeks run` from. If the marketplace copy is also enabled in your Claude Code config, its hooks may fire as well; disable one of the two for headless runs.

### `--container`: keep the rest of your machine out of reach

The maker runs with `bypassPermissions`, and seeks' Bash guardrails are best-effort. `--container` removes the host from reach instead:

```bash
docker build -t seeks-maker docker/            # once: node + git + Claude Code (extend it with your toolchain)
seeks run fix-auth --goal "…" --check "npm test" --container [--image seeks-maker] [--network bridge]
```

`seeks run` starts the maker in `docker run --rm` as **your uid:gid**. It mounts only what the loop needs, each at the same absolute path it has on the host: the loop's **worktree** (read-write), the repo's **`.git`** (read-write, since a worktree commits into it) and **`.seeks`** (read-write, loop state), and **the plugin read-only**. The guardrails can't be edited from inside, even by a Bash trick. **Your HOME is not mounted.** The container's HOME is `.seeks/run/<name>/container-home`, which persists so `--resume` works. Credentials pass **by name only** (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, Bedrock/Vertex/proxy vars); nothing else from your environment gets in. `--network` defaults to `bridge`, because the maker must reach the API; point it at a restricted network or proxy to narrow egress. A stuck maker is stopped with `docker kill`. POSIX hosts only (use WSL on Windows).

What the container does *not* change: the `.git` and `.seeks` mounts are writable, so loop state (the budget, the stored done-conditions) and refs are protected by the same best-effort policy as without it. A maker set on faking `done` can still do it from inside. What it removes is everything else on your machine.

---

<details>
<summary>🔵</summary>

> *I'm Mr. Seeks! **Look at me!*** A Seeks is summoned for **one** goal. It seeks. It verifies. When the oracle goes green, *poof* — it ceases to exist. **Caaan do!**
>
> ```
> node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" --iam
> ```

</details>
