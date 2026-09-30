#!/usr/bin/env node
// A stand-in for `docker` for the `seeks run --container` tests. `run` behaves like a container as
// far as seeks can tell: the process sees ONLY the -e environment (plus PATH, and FAKE_* test seams),
// no host HOME, and its -w workdir must be one of the -v mounts. `kill <name>` kills that "container".
// Every invocation is appended to FAKE_DOCKER_LOG as JSON.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawn } from 'node:child_process';
const [sub, ...rest] = process.argv.slice(2);
const state = process.env.FAKE_DOCKER_STATE || os.tmpdir();
const log = (o) => { if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(o) + '\n'); };
if (sub === 'kill'){
  log({ sub, name: rest[0] });
  try { process.kill(Number(fs.readFileSync(path.join(state, `${rest[0]}.pid`), 'utf8')), 'SIGKILL'); } catch {}
  process.exit(0);
}
if (sub !== 'run'){ process.stderr.write(`fake-docker: unsupported ${sub}\n`); process.exit(125); }
const VAL = new Set(['--name','--label','--user','--network','--tmpfs','-w','-v','-e']);
const o = { flags: [], mounts: [], env: [] }; let i = 0;
for (; i < rest.length; i++){
  const t = rest[i];
  if (!t.startsWith('-')) break;
  if (VAL.has(t)){ const v = rest[++i]; if (t === '-v') o.mounts.push(v); else if (t === '-e') o.env.push(v); else o[t.replace(/^-+/, '')] = v; }
  else o.flags.push(t);
}
const image = rest[i], cmd = rest.slice(i + 1);
log({ sub, ...o, image, cmd });
const env = { PATH: process.env.PATH };
for (const e of o.env){ const eq = e.indexOf('='); if (eq > 0) env[e.slice(0, eq)] = e.slice(eq + 1); else if (process.env[e] != null) env[e] = process.env[e]; }
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('FAKE_')) env[k] = v;
const mounted = o.mounts.map(m => m.split(':')[0]);
if (!mounted.some(m => o.w === m || o.w.startsWith(m + '/'))){ process.stderr.write(`fake-docker: workdir ${o.w} is not mounted\n`); process.exit(125); }
const [bin, ...args] = cmd;
const child = bin === 'claude' && process.env.FAKE_DOCKER_CLAUDE
  ? spawn(process.execPath, [process.env.FAKE_DOCKER_CLAUDE, ...args], { cwd: o.w, env, stdio: 'inherit' })
  : spawn(bin, args, { cwd: o.w, env, stdio: 'inherit' });
if (o.name) fs.writeFileSync(path.join(state, `${o.name}.pid`), String(child.pid));
child.on('exit', (c, sig) => process.exit(c ?? (sig ? 137 : 1)));
