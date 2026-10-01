# examples/add

The smallest possible seeks goal: `src/add.mjs` throws `not implemented`, and `test/add.test.mjs` says what it should do. The done-condition is `npm test` exits 0.

## 1. Free: watch the hooks decide (no model)

From the root of a seeks clone:

```bash
node examples/demo.mjs
```

It runs two loops on a temp copy of this directory with a scripted maker, against the real hooks. See the [README](../../README.md#see-it-in-60-seconds-no-model-no-tokens) for what each step shows.

## 2. Headless, with a real model

This spends tokens: one small task, on the model your Claude Code is set up with. Run it on a copy, never inside the seeks repo:

```bash
git clone https://github.com/Bogzx/seeks ~/seeks            # once
cp -r ~/seeks/examples/add /tmp/seeks-add && cd /tmp/seeks-add
git init -q && git add -A && git commit -qm "add() is not implemented yet"
node ~/seeks/bin/seeks.mjs run fix-add --goal "implement add() in src/add.mjs so npm test passes" --check "npm test" --budget 15m --strict
echo "exit $?"
```

`seeks run` creates the worktree `.claude/worktrees/fix-add` on a `seeks/fix-add` branch, stores `npm test` as the done-condition, and starts a separate `claude -p` maker there. It prints one banner line per pass. How it can end:

| Exit | Banner | Meaning |
|---|---|---|
| `0` | `✅ done` | the Stop hook ran `npm test` itself and it passed; the fix is a commit on `seeks/fix-add` |
| `2` | `⏸ needs-human` | for example, the maker edited `test/add.test.mjs` instead of `src/add.mjs`: the check is green, but a pre-existing test changed |
| `3` | a halt (`⏰`, `⛔`) | the 15-minute budget or the iteration cap ran out, or the loop stopped making progress |

Then look at what it did: `git -C /tmp/seeks-add log --oneline seeks/fix-add` and `git -C /tmp/seeks-add diff main...seeks/fix-add` (your default branch may be `master`). `node ~/seeks/bin/seeks.mjs why fix-add` replays every allow/deny. Add `--dry-run` to the `run` line to see the exact `claude` command and environment without starting anything.

## 3. Interactive

With the plugin installed (`/plugin marketplace add Bogzx/seeks`, `/plugin install seeks@seeks`), open Claude Code in the copy and type:

```
/seeks:new implement add() in src/add.mjs so npm test passes
/seeks:start
```

`/seeks:new` reads `package.json` and should propose `npm test` as the done-condition; confirm it, pick a level (L2 is the default) and a budget.
