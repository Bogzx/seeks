#!/usr/bin/env node
// A stand-in for `claude -p` for the `seeks run` tests: no model, no network, no cost. It behaves
// like a headless Claude Code session whose Stop hook is seeks' REAL stop-gate: each "turn" does
// what FAKE_CLAUDE_MODE says a maker would do, then fires hooks/stop-gate.mjs exactly as Claude
// Code does (stdin {cwd, session_id}) and keeps going while the hook blocks.
//   done   certify on the first pass (the conditions are green) → the gate releases done
//   red    certify every pass (the conditions are red) → rejects escalate to needs-human
//   idle   never certify → the gate halts at max_iters
//   hang   never yield (the runner's wall-clock backstop must kill it)
//   crash  exit 7 after one pass, before any release
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync, execFileSync } from 'node:child_process';
const argv = process.argv.slice(2);
const arg = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
const mode = process.env.FAKE_CLAUDE_MODE || 'done';
const pluginDir = arg('--plugin-dir'); const prompt = arg('-p') || '';
const name = (/seeks loop "([^"]+)"/.exec(prompt) || [])[1];
if (process.env.FAKE_CLAUDE_LOG) fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, cwd: process.cwd(),
  block_cap: process.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? null, strict: process.env.SEEKS_STRICT_BASH ?? null }));
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
emit({ type: 'system', subtype: 'init', cwd: process.cwd() });
if (!pluginDir || !name){ emit({ type: 'result', is_error: true, result: 'fake-claude: missing --plugin-dir or loop name' }); process.exit(2); }
const seeks = (...a) => execFileSync(process.execPath, [path.join(pluginDir, 'bin', 'seeks.mjs'), ...a], { encoding: 'utf8' });
if (mode === 'hang'){ setInterval(() => {}, 1 << 30); }
else {
  let pass = 0;
  for (; pass < 200; pass++){
    if ((mode === 'done' && pass === 0) || mode === 'red') seeks('certify', name);
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: `pass ${pass + 1} (${mode})` }] } });
    if (mode === 'crash') process.exit(7);
    const r = spawnSync(process.execPath, [path.join(pluginDir, 'hooks', 'stop-gate.mjs')],
      { input: JSON.stringify({ cwd: process.cwd(), session_id: 'fake' }), encoding: 'utf8' });
    const out = r.stdout.trim() ? JSON.parse(r.stdout) : {};
    emit({ type: 'system', subtype: 'hook_response', hook_event: 'Stop', systemMessage: out.systemMessage ?? null });
    if (out.decision !== 'block') break;
  }
  emit({ type: 'result', is_error: false, num_turns: pass + 1, total_cost_usd: 0 });
}
