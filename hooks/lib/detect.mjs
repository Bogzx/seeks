// Runtime preflight helper (pure; no I/O). The CLI probes the env and hands the results
// here, so the logic stays testable. NOTE: deliberately NO language/test-tool detection —
// the intake LLM reads the repo and proposes done-conditions (any language, no hardcoded list).

// preflightAssess({nodeExec, gitOk}) — is the runtime safe for seeks' hooks? The #1 install
// failure is a version-manager node (nvm/fnm/asdf/volta): present in interactive shells but
// NOT in the non-interactive subprocess hooks run in → "Stop hook error: node not found".
const VM_RE = /[\\/](\.nvm|\.fnm|\.asdf|\.volta)[\\/]|[\\/](fnm|nvm)[\\/]/i;
export function preflightAssess({ nodeExec = '', gitOk = true } = {}) {
  const vmManaged = VM_RE.test(String(nodeExec));
  let hint = '';
  if (!gitOk) hint = 'git not found on PATH — install git so the hooks (and CLI) can shell out to it.';
  else if (vmManaged) hint = `node runs from a version manager (${nodeExec}); hooks run non-interactive and may not find it (the "Stop hook error: node not found" failure). Fix: symlink it onto a system PATH — sudo ln -s "$(command -v node)" /usr/local/bin/node — or add "env":{"PATH":"…"} to ~/.claude/settings.json.`;
  return { ok: gitOk && !vmManaged, vmManaged, gitOk, nodeExec, hint };
}
