---
description: List finished seeks loops with summary + branch diff for review.
argument-hint: "[loop-name]"
---
Let `BASE` = `.seeks/config.json` `base_ref`. For each loop whose status `done` is true (or `$0`): show `summary.md`, `git log --oneline $BASE..seeks/<name>`, `git diff --stat $BASE...seeks/<name>`. Recommend review/merge. NEVER auto-merge. For an **L3** loop, also surface its delivery from `status-get` — `delivery_mode` and `pr_url` (the PR is already open; link it) instead of recommending a manual push.
