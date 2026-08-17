---
description: Health + regression check for seeks.
---
Report:

0) **installed build** — `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" --version`. Quote it in any bug report (`/seeks:export` bundles it too); `preflight` also returns it as `seeks_version`.

0b) **enforcement is actually running** — `preflight` returns `strict_bash` (is `SEEKS_STRICT_BASH` on for this session?) and `strict_bash_allow` (the active Bash allowlist); report both. Then, for the most recent loop, run `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" why <name> --crashes`. **The hooks are fail-open** — a crashed hook allows everything silently — so a non-empty crash list is the single most important thing on this report. Print the errors verbatim and treat it as a bug worth `/seeks:export`. An empty decision log for a loop that has been running means the hooks never fired at all (check step 1).

1) **`node` + `git` on PATH** — run `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" preflight` (it also flags the common **version-manager-node** trap that `node -v` here would hide), plus `node -v` and `git --version`. If `preflight` returns `ok:false` (or either is missing), the Stop hook can't run (every stop fails with `Stop hook error: … node not found`) — surface the `hint` and **offer to apply the fix** (symlink node onto a system PATH, or add `"env":{"PATH":…}` to `~/.claude/settings.json` with consent), then re-run `preflight`. Otherwise print this remedy verbatim:
   - Install Node **≥18 system-wide, not via nvm/fnm/asdf** (version managers only put `node` on *interactive* shells; hooks run non-interactive).
   - Quick fixes: `sudo ln -s "$(command -v node)" /usr/local/bin/node`; **or** add `"env": { "PATH": "/your/node/bin:/usr/bin:/bin" }` to `~/.claude/settings.json`; **or** launch `claude` from a shell where `node -v` works.
   - **Caveat:** this command's shell ≠ the hook's shell, so `node` showing up *here* doesn't prove hooks can see it — if stops still error with "node not found", apply a fix above regardless.

2) **orphaned worktrees/branches** under `.claude/worktrees/` vs `.seeks/loops/`.

3) **regression probe** — for each loop, read `hook-state.json` `stop_fires`; if a loop's history shows it repeatedly halting near ~8 fires *despite* making progress (the signal that the platform's progress-reset broke), advise the user to add `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0` to their `settings.json` `env`. Note: a plugin cannot self-set this.

4) **usage tier** — print `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" tier-get` (the active tier + its per-role models and caps, or `none` if unset). Change it with `node … tier-set <light|balanced|all-out>` (or edit `~/.claude/seeks.json`). New loops scaffold from the tier; existing loops keep their `config.json`.
