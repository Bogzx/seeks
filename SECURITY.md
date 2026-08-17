# Security policy

## What seeks does and does not promise

seeks is a **control plane**, not a sandbox. Read the coverage table in the [README](README.md#what-the-guardrails-cover--and-what-they-dont) before relying on it — it is deliberately explicit about the boundary.

In short:

- **Edits are deterministically enforced.** Denylist (a floor a loop can extend but not narrow), worktree confinement, hook-owned loop state, L1 report-only, wrap-up window. This is the only tier that holds *by construction*.
- **Everything judged from a Bash command string is best-effort — including the budget.** `git push`/`merge`/`rebase` and any touch of `status.json` are *parsed* for, not pattern-matched, through `cd` tracking, `..` collapsing, glob expansion, `eval`/`sh -c` recursion and interpreter-payload scanning. It is thorough and it is not a proof. [The README lists what still gets through](README.md#the-one-guarantee-that-is-not-by-construction), and each of those is a passing test asserting *allow*.
- **Everything else Bash can do is best-effort by default.** `SEEKS_STRICT_BASH=1` turns Bash into a deny-by-default allowlist, which is much stronger — but it is still an allowlist, not a sandbox: `node -e` is on it, and a shell is Turing-complete.
- **Reads are not policed at all.** The model can read `.env` and your secrets.
- **Runtime-assembled paths and encoded payloads are explicitly out of scope.** A name built by `$(…)`, a `base64 -d | sh`, or a write performed inside a script the hook only sees the *filename* of are documented non-goals — not oversights.

**If the goal or the codebase is untrusted, run the loop in a container.** That is the only guarantee that holds by construction rather than by policy.

## Reporting a vulnerability

Please report privately via [GitHub's private vulnerability reporting](https://github.com/Bogzx/seeks/security/advisories/new) rather than a public issue.

Include:

- what the guardrail claims (quote the README or `SKILL.md` line — an overclaim in the docs *is* a valid report on its own),
- the exact command or tool input that gets past it,
- the `rule` from `/seeks:why <name> --denied`, if one fired,
- `/seeks:export` output if you can share it.

I'll acknowledge within a week. Since this is a solo project, expect a fix or a documented scope change rather than a formal advisory timeline.

## What counts

**In scope** — anything that lets a loop do what the README says it cannot: reach `status.json` / `hook-state.json` / `decisions.jsonl`, push/merge/rebase, edit a denylisted path or escape the worktree via the edit tools, defeat the iteration or wall-clock cap, or certify `done` without the verifier's oracle acknowledgement. Also in scope: **any claim in the docs that the code does not enforce.**

**Out of scope** — the documented gaps above (unpoliced Bash without strict mode, unpoliced reads, a runtime-assembled path, an encoded payload, a write inside a script the hook only sees the name of, a `cd` carried over from an earlier Bash call, `node -e` under strict mode). Those are known, stated, and pinned as passing `allow` tests. If you can show one is *worse than documented* — or find a **plainly-spelled** command that reaches loop state — that is in scope and worth reporting.
