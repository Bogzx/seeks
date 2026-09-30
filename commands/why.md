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
   | `hook-owned` | the command touched `status.json` / `hook-state.json` / `decisions.jsonl` / `control-grant.json` | use `seeks status-get` / `status-set` / `why` |
   | `plugin-dir` | the command touched seeks' own code (the plugin root, `hooks/`, `bin/`, `skills/`, `commands/`, `.claude-plugin/`) | only `node <plugin>/bin/seeks.mjs …` may run; the guardrails are not editable from inside a loop |
   | `grant:*` | the user typed `/seeks:start`, `/seeks:stop` or `/seeks:delete`, which allows one change to the brakes of the loop it names | nothing — this is the audit trail |
   | `grant-refused:*` | a `/seeks:*` control command arrived from a non-interactive Claude Code (`claude -p`, the SDK), so no grant was minted | type it in an interactive session; if nobody did, a process tried to unlock the loop |
   | `condition-shell` (warn) | Windows only: no Git Bash was found, so the Stop hook ran the done-conditions in cmd.exe, where bash syntax fails | install Git for Windows or set `CLAUDE_CODE_GIT_BASH_PATH` |
   | `nested-claude` | the loop tried to start another Claude Code (its prompt would pass for the user's) | drive the loop with the seeks CLI; `/seeks:*` commands are the user's |
   | `denylist` | the path matched the secret/`.git` denylist | that file is out of bounds; if it's a false positive the user can rename it or widen `denylist` in the loop's status |
   | `outside-worktree` | the edit left the loop's worktree | work inside the worktree only |
   | `strict-bash` | `SEEKS_STRICT_BASH` is on and the command's head wasn't allowlisted | use an allowlisted tool, or the user adds it via `strict_bash_allow` |
   | `wrap-up` | the time budget is spent | only the seeks CLI, `git add`/`commit` and run-dir writes remain — write `summary.md` and end the turn |
   | `stop:*` | the Stop gate released the loop (`done`, `max_iters`, `time-budget`, `stuck`, `needs_human`) | that is why the loop ended |
   | `continue` with `conditions` | the gate ran the done-conditions itself; a row with `ok:false` is why a certified loop kept going | fix the failing condition; the verifier re-certifies with `seeks certify` |
   | `hook-crash` | **a hook threw and failed open** — enforcement was NOT applied for that call | surface the error verbatim and suggest `/seeks:doctor`, then `/seeks:export` for a bug report |

4. If the user asked about one specific action, quote the matching line(s) and answer the actual question. If nothing matches, say so plainly rather than guessing — an empty log means the hooks never ran for that loop (check `/seeks:doctor`).
