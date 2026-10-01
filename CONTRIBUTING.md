# Contributing to seeks

Thanks for looking. seeks is young — bug reports are worth more than features right now.

## The shape of the project

**Zero runtime dependencies, and it stays that way.** Node ≥18 stdlib only. A PR that adds a dependency needs to argue why the stdlib can't do it.

```
bin/seeks.mjs        the CLI — the ONLY sanctioned way to write loop state
bin/run.mjs          `seeks run`: the headless driver (bin/lib/driver.mjs holds its pure helpers)
hooks/*.mjs          the four hook entrypoints (PreToolUse, Stop, SessionStart, UserPromptSubmit)
hooks/lib/*.mjs      pure, testable modules — no I/O in the deciding functions
commands/*.md        the /seeks:* slash commands
skills/loop/SKILL.md the loop discipline the maker/verifier follow
test/*.test.mjs      node:test, one file per module
test/e2e/            spawns real `claude -p` children — not run in CI (exhaustive.mjs is the model-free exception, and is)
test/fixtures/fake-claude.mjs   a model-free stand-in for `claude -p` that drives the REAL stop hook; test/run.test.mjs puts it on PATH
test/fixtures/fake-docker.mjs   a stand-in for `docker run`/`kill` (only -e env reaches the "container") for the --container tests
docker/Dockerfile    the maker image for `seeks run --container`
bench/               the benchmark harness (tasks, runner, results table) — needs credits, never run in CI
examples/demo.mjs    the README's model-free demo: a scripted maker against the real hooks; CI runs it
examples/add/        the smallest real goal (the demo's project, and the copy-paste first run)
GUARANTEES.md        the coverage table: what is enforced, what is best-effort, what is deliberately open
CHANGELOG.md         one section per released version
```

## Rules that are not negotiable

1. **The deciding code is pure.** `decidePreTool` and `decide` (the gate) take plain data and return a verdict. No filesystem, no clock, no env — the hook entrypoint gathers those and passes them in. This is what makes the guardrails testable, and it's why every policy test is a one-liner.
2. **One predicate, every call site.** If a rule is enforced in two places, it is *one exported function* consumed twice. `isHookOwnedFile` is checked by both the edit-tool branch and the Bash branch precisely so they cannot drift apart. Duplicating a regex is how a guardrail silently half-disappears.
3. **State writes are atomic** — write to `<file>.tmp.<pid>`, then `rename`. Never write a state file in place. (Append-only logs may use `appendFileSync`.)
4. **Hooks fail open, but never fail silent.** A hook error must never block a tool call or trap a session — so every entrypoint has a top-level `catch`. That `catch` must record a `hook-crash` to the decision log. "Allowed" and "enforcement was off" must never look the same from outside.
5. **Don't claim a guarantee the code doesn't enforce.** The coverage table in GUARANTEES.md (and its summary in the README) is a contract. If you widen or narrow what's enforced, that table changes in the same PR. Overclaiming security is treated as a bug of the same severity as the gap itself.

## Writing a guardrail fix

**Write the failing test first, and show it failing.** Every guardrail hole in this repo was closed by first adding an assertion that reproduced it. A PR that closes a hole without a test that fails on the parent commit will be asked for one.

Pair every deny test with an allow test. A guardrail that also blocks legitimate work is a bug — `test/policy.test.mjs` keeps "these must be denied" and "these must still be allowed" side by side for exactly that reason.

Give the deny a stable `rule` id. That id is what lands in `decisions.jsonl` and what `/seeks:why` explains, so it's user-visible API — don't rename one casually.

## Running things

```bash
npm test          # the full suite — fast, hermetic, no network, no claude (scripts/test.mjs lists test/*.test.mjs; Node <21 can't glob)
node test/e2e/exhaustive.mjs   # deterministic end-to-end through the real hooks + CLI; free
npm run sync-docs # regenerate doc copies of code values (the default denylist in commands/new.md + SKILL.md); a test fails on drift
npm run e2e       # spawns real `claude -p` children; costs tokens; not run in CI
```

CI runs `npm test`, the demo and the deterministic e2e on Node 18/20/22/24 on Linux, Node 20 on Windows, Node 22 on macOS, and Node 18 on Debian 11 (git 2.30). The oldest Node leg tracks `engines.node` (a test pins the two together), and actions are pinned by commit SHA. The Windows and macOS legs exist because `hooks/lib/paths.mjs` and `hooks/lib/glob.mjs` fold case there; the Debian leg because git < 2.31 lacks flags newer gits have. If you touch path, glob or git handling, those are the legs that matter.

## Commits and PRs

- Conventional-ish subjects (`fix(policy):`, `feat:`, `docs:`, `chore(ci):`).
- The body says **what was wrong**, cites `file:line`, and says how it's now proven. Look at `git log` — the bar is a paragraph, not a sentence.
- Never commit a credential, and never commit anything under `.seeks/run/` or `.claude/worktrees/`.

## Releasing

Claude Code keys an installed plugin on the `version` in `.claude-plugin/plugin.json`: commits pushed under an unchanged version never reach anyone who already installed it. So:

1. A PR that changes `hooks/`, `bin/`, `skills/`, `commands/` or `plugin.json` bumps the version in `plugin.json` **and** `package.json` (a test keeps them equal) and adds a `## x.y.z` section to `CHANGELOG.md` (a test checks it exists). The `version-bump` workflow (`scripts/check-version-bump.mjs`) fails the PR otherwise; label it `no-version-bump` for a change that needs no release.
2. So every such merge to `main` reaches installed users with its own version (a patch bump is enough). Tags mark the versions you announce; not every bump needs one.
3. After the merge, tag and publish from `main`:
   ```bash
   git tag -a v0.2.0 -m "seeks 0.2.0" origin/main && git push origin v0.2.0
   gh release create v0.2.0 --title "seeks 0.2.0" --notes "See CHANGELOG.md#020--2026-10-01"
   ```

## Reporting a bug

Use the issue template and attach **`/seeks:export`** output — it bundles the run state, the decision log and the raw transcript, which is usually enough to diagnose without a back-and-forth. If a guardrail behaved unexpectedly, `/seeks:why <name> --denied` is the fastest single thing you can paste.

Security-relevant findings: see [SECURITY.md](SECURITY.md).
