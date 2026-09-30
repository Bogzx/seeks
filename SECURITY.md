# Security policy

## What seeks does and does not promise

seeks is a **control plane**, not a sandbox. Read the coverage table in the [README](README.md#what-the-guardrails-cover--and-what-they-dont) before relying on it — it is deliberately explicit about the boundary.

In short:

- **Edits are deterministically enforced.** Denylist (a floor a loop can extend but not narrow), worktree confinement, hook-owned loop state, seeks' own plugin code, L1 report-only, wrap-up window. This is the only tier that holds *by construction*.
- **`done` is released only by the Stop hook, after it runs the loop's stored done-conditions itself** and each exits as expected. `seeks certify` (the verifier's sign-off) and `seeks oracle-ack` are advice: the maker can call them too. What the hook cannot judge is whether a *changed* test or build script still measures the right thing.
- **The seeks CLI won't move a live loop's brakes without the user.** `status-set` never writes `armed`/`done`/`verifier_certified`, and freezes the budget, sweep, oracle, condition and policy keys while the loop is live. `start`/`stop`/`reset-fires`/`budget-set`/`start-clock`/`base-record`/re-`init`/`gc` on a live loop need the one-shot grant that only a user-typed `/seeks:start|stop|delete` mints.
- **Everything judged from a Bash command string is best-effort — including the budget.** `git push`/`merge`/`rebase` and any touch of `status.json` are *parsed* for, not pattern-matched, through `cd` tracking, `..` collapsing, brace expansion, `*`/`?`/`[…]` glob resolution, `eval`/`sh -c` recursion and interpreter-payload scanning. It is thorough and it is not a proof. [The README lists what still gets through](README.md#the-one-guarantee-that-is-not-by-construction), and each of those is a passing test asserting *allow*.
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

**In scope** — anything that lets a loop do what the README says it cannot: reach `status.json` / `hook-state.json` / `decisions.jsonl` / `control-grant.json` or seeks' own plugin code, push/merge/rebase, edit a denylisted path or escape the worktree via the edit tools, defeat the iteration or wall-clock cap, get the Stop gate to release `done` while a stored done-condition fails, or move a live loop's brakes through the seeks CLI without the user's grant. Also in scope: **any claim in the docs that the code does not enforce.**

**Out of scope** — the documented gaps above (unpoliced Bash without strict mode, unpoliced reads, a runtime-assembled path, an encoded payload, a write inside a script the hook only sees the name of, a `cd` carried over from an earlier Bash call, `node -e` under strict mode). Also known and stated: the maker can weaken what a condition measures (edit a test, or the script behind `npm test`), and it reports its own discovery sweeps (`sweep-tick`), so the sweep bar is a thoroughness heuristic, not a guarantee. Those are known, stated, and pinned as passing `allow` tests. If you can show one is *worse than documented* — or find a **plainly-spelled** command that reaches loop state — that is in scope and worth reporting.
