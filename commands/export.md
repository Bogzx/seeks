---
description: Bundle a loop's run-state + this session's transcript into a tarball for the seeks developer.
argument-hint: "[loop-name]"
---
Run shell via the Bash tool. This packages everything needed to analyze a loop offline — the seeks run-state **plus the raw Claude Code session transcript(s)** — into one tarball. It reads and copies only; it never edits loop state.

1. **Pick the loop (`<name>`).** `$0` if given, else `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" latest`. If none, tell the user there are no loops and STOP.
2. **Locate the run-state.** Resolve `.seeks` (parent of `git rev-parse --path-format=absolute --git-common-dir`). Collect the loop's run dir `.seeks/run/<name>/` (`status.json`, `log.md`, `backlog.md`, `state.md`, `summary.md`, `context.md`, `hook-state.json`, `verify/`) and its recipe `.seeks/loops/<name>/spec.md`.
3. **Locate the session transcript(s).** Read the session id from `.seeks/run/<name>/hook-state.json` (`session_id`). Find the main transcript: `find "$HOME/.claude/projects" -name "<session_id>.jsonl"`. Its directory also holds the subagent transcripts (`agent-*.jsonl`) — include them best-effort (a shared project dir may also contain other sessions' agents; over-inclusion is fine for debugging). If no transcript is found (session id absent / transcript pruned / a resumed session), continue with run-state only and say so plainly.
4. **Bundle** into `seeks-export-<name>.tar.gz` (repo root, or `$HOME` if the repo tree is read-only), layout: `seeks-export-<name>/seeks-run-state/…`, `…/seeks-spec.md`, `…/main-conversation.jsonl`, `…/subagents/agent-*.jsonl`. Use `tar -czf`. **Never** include `.env`, secrets, or the runtime db.
5. Tell the user the tarball path + size, and that the raw `.jsonl` is the untruncated record (it captures pre-compaction turns the visible transcript may have summarized). Offer to also render a readable `CONVERSATION.md` from the main jsonl if they want a human-friendly view.
