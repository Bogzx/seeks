---
description: List finished + wound-down seeks loops with summary + branch diff for review.
argument-hint: "[loop-name]"
---
Run shell via the Bash tool. Let each loop's `BASE` = its `base_ref` from `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" status-get <name>` (fallback: `.seeks/config.json` `base_ref`).

**Which loops to surface** — for `$0`, or across every dir under `.seeks/run/`: a loop qualifies if its status `done` is **true** OR its branch has real work not yet on the base — `git rev-list --count "<BASE>..seeks/<name>"` > 0 (a **wound-down / halted** loop that hit its time budget or iteration cap with committed fixes but never certified — exactly the work that would otherwise be stranded).

**For each qualifying loop**, show: `summary.md` (if present), `git log --oneline <BASE>..seeks/<name>`, `git diff --stat <BASE>...seeks/<name>`, and the end state from `status-get` (`done`, `last_change`, and the halt reason if any).

**Delivery** (never auto-merge; the merge is always the user's):
- **L3, `done`, `delivered:true`** → surface `delivery_mode` + `pr_url` — the PR is already open; link it.
- **L3 with real commits but not delivered** (wound-down / halted) → offer to open the PR now: `node "${CLAUDE_PLUGIN_ROOT}/bin/seeks.mjs" deliver <name>` (pushes `seeks/<name>` + opens a PR; degrades to push-only/local if `gh`/remote are absent). **Ask first**, then run it if they say yes.
- **L2 with real commits** → recommend review of the branch; offer to push it or open a PR manually if they want.

Recommend review. NEVER merge to the base branch.
