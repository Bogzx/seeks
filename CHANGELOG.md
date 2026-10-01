# Changelog

Claude Code updates an installed plugin only when the `version` in `.claude-plugin/plugin.json` changes. Every release bumps it; `scripts/check-version-bump.mjs` fails a PR that changes the hooks, CLI, skill or commands without a bump (see [CONTRIBUTING](CONTRIBUTING.md#releasing)).

## 0.2.0 — 2026-10-01

**If `/plugin` shows seeks 0.1.0, update:** `claude plugin marketplace update seeks`, then `claude plugin update seeks@seeks`, then restart Claude Code. The version string stayed `0.1.0` from 2026-08-17 to this release, so `claude plugin update` reported "already at the latest version" and installs never received the changes below. That includes the fix for a maker that could mark its own loop `done` (#24).

### Security and correctness
- **The Stop hook runs the done-conditions itself before it releases `done`.** The CLI no longer writes `done` for the maker, so a `status-set` of `done` or a certify over a red check no longer releases a loop, and a loop without a runnable condition can't reach `done`. A running loop's brakes (armed, budgets, sweep, oracle and policy keys) move through the CLI only with a one-shot grant that a user-typed `/seeks:start`, `/seeks:stop` or `/seeks:delete` mints. The stored conditions and the gate's cache still live in loop state, which Bash can reach on a best-effort basis, so this holds only as far as that does ([GUARANTEES.md](GUARANTEES.md#the-one-guarantee-that-is-not-by-construction)). (#24)
- **The oracle covers more than tests.** Build manifests, runner configs and CI files are oracle files, with only the test-relevant part of `package.json` / `pyproject.toml` / `setup.cfg` counted. Changing or deleting a pre-existing one ends in needs-human (`oracle_modified_policy`, default `needs_human`). Edits hidden with assume-unchanged, skip-worktree, `git replace`, a clean filter or fsmonitor are detected, on every git version. (#24, #25)
- **seeks' own code and the grant file are protected** from the edit tools and, best-effort, from Bash, including symlink, hard-link, `git -C` and `find -delete` pivots. Starting another Claude Code from inside a loop is denied, best-effort. (#24)
- **The denylist floor covers the secrets people have:** `.env.*`, `*.pem`, SSH keys, `.npmrc`, `.aws/`, `.ssh/`, a submodule's `.git`. A loop can extend the floor, never narrow it. (#22)
- **`git push` / `merge` / `rebase` are parsed, not grepped**, through wrappers, subshells, `eval` and `sh -c`. The wrap-up window is no longer a substring escape hatch. (#22)
- **git older than 2.31 works.** On Ubuntu 20.04 and Debian 11, `rev-parse --path-format=absolute` was echoed back, so no hook found its loop and every tool call was allowed. On the same gits the clean-filter tamper check was off. (#25)
- **An oracle check that fails no longer reads as "nothing changed".** A filter driver marked `required` with no command made `git diff` fail, and the stop hook released `done` over a relaxed test. Such drivers are now overridden too, and with a base commit any git failure in the oracle check ends the loop in needs-human, under either oracle policy. (#25)
- **`seeks run` from inside a loop is denied** like any nested Claude Code (best-effort, like every Bash rule), including through the npm `seeks` shim and package runners (`npx -p seeks seeks run`, `npm exec`, git URLs). **Denylist matches fold case on macOS** as on Windows, so `.ENV` is caught like `.env`; containment checks keep exact case there. (#25, and this release for the npm and `npx` spellings)
- Done-conditions run without an inherited `NODE_TEST_CONTEXT`, under which a nested `node --test` exits 0 on failing tests. On Windows they run in Git Bash, not cmd.exe. (#24)

### Added
- `seeks run`: a headless driver with a separate `claude -p` maker, and `--container`, `--json`, `--resume`. The exit code is the gate's verdict. (#24)
- A decision log for every allow, deny and hook crash, replayed by `/seeks:why`; user grants are logged too since #24. `SEEKS_STRICT_BASH` turns Bash into an allowlist. (#22, #24)
- `node examples/demo.mjs`: a model-free demo through the real hooks, run in CI; `examples/add`; a comparison with `/goal` and `/ralph-loop`; and the full contract in [GUARANTEES.md](GUARANTEES.md). (#26)
- `seeks seeks-dir`; `git_version` in `seeks preflight`. (#25)
- The CLI installs as `seeks` with npm (`npm install -g github:Bogzx/seeks`). Plugin and marketplace manifests carry author, repository, category and tags. (this release)
- A benchmark harness with tampering and overfit traps. It has not been run against a real model yet. (#24)

### Changed
- New config-type oracle files (`pytest.ini`, root `conftest.py`, `.npmrc`, …) and edits to lint or type-checker configs now end in needs-human. Set `"oracle_modified_policy":"ack"` per loop for the old advisory behaviour. (#24)
- Loops created before 2026-06-29 without structured `conditions` fail closed (needs-human) instead of trusting the verifier. (#24)
- CI: Node 18, 20, 22 and 24 on Linux, Node 20 on Windows, Node 22 on macOS, and Debian 11 (git 2.30). Actions are pinned by SHA. (#22–#26)

## 0.1.0 — 2026-06-27 to 2026-09-30 (never tagged)

The first public version: the plugin's hooks, CLI, `/seeks:loop` skill and `/seeks:*` commands. It had goal-first `/seeks:new` with done-condition detection, levels L1–L3 (L3 pushes a branch and opens a PR, never merges), usage tiers, open-ended sweeps with rotating lenses and an exhaustive mode, wall-clock budgets with a wind-down, and `/seeks:doctor`. (#2–#21)

The `version` field was added on 2026-08-17 and was not changed again until 0.2.0.
