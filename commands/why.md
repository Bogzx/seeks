---
description: Replay why seeks allowed or denied an action — the loop's decision log.
argument-hint: "[loop-name] [--denied] [--crashes] [--last N]"
---
Run shell via the Bash tool. This is **read-only** — it never edits loop state.

Every PreToolUse verdict, every Stop-gate verdict and every hook **crash** is appended to `.seeks/run/<name>/decisions.jsonl`. That file is hook-owned (the edit tools and Bash are both denied at that path) — this command is the sanctioned way to read it.

1. **Pick the loop (`<name>`).** `$0` if it looks like a loop name, else `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" latest`. If none, say there are no loops and STOP.
2. **Replay.** `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" why <name>` — pass through any of the user's flags:
   - `--denied` — only the denials (the usual question: *"why did that get blocked?"*)
   - `--crashes` — only hook crashes. **Check this first when the guardrails seem not to be firing:** the hooks are fail-open by design, so a crashed hook allows everything silently. A non-empty list here means enforcement was off for those calls.
   - `--last N` (default 20), `--tool Bash|Edit|Write`, `--rule <id>`, `--hook pre-tool|stop-gate`, `--json`
3. **Explain the verdict in plain language**, keyed on the `rule` id — don't just paste the log:

   | rule | what it means | what to do instead |
   |---|---|---|
   | `git-push` | push/merge/rebase is denied at every level | delivery is `seeks deliver` at L3; otherwise the human merges |
   | `l1-commit` / `l1-edit` | the loop is **L1 = report-only** | write findings under `.seeks/run/<name>/`; ask the user to re-run at L2 to change code |
   | `hook-owned` | the command touched `status.json` / `hook-state.json` / `decisions.jsonl` | use `seeks status-get` / `status-set` / `why` |
   | `denylist` | the path matched the secret/`.git` denylist | that file is out of bounds; if it's a false positive the user can rename it or widen `denylist` in the loop's status |
   | `outside-worktree` | the edit left the loop's worktree | work inside the worktree only |
   | `strict-bash` | `SEEKS_STRICT_BASH` is on and the command's head wasn't allowlisted | use an allowlisted tool, or the user adds it via `strict_bash_allow` |
   | `wrap-up` | the time budget is spent | only the seeks CLI, `git add`/`commit` and run-dir writes remain — write `summary.md` and end the turn |
   | `stop:*` | the Stop gate released the loop (`done`, `max_iters`, `time-budget`, `stuck`, `needs_human`) | that is why the loop ended |
   | `hook-crash` | **a hook threw and failed open** — enforcement was NOT applied for that call | surface the error verbatim and suggest `/seeks:doctor`, then `/seeks:export` for a bug report |

4. If the user asked about one specific action, quote the matching line(s) and answer the actual question. If nothing matches, say so plainly rather than guessing — an empty log means the hooks never ran for that loop (check `/seeks:doctor`).
