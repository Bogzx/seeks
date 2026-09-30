// Cross-platform `node --test` over test/*.test.mjs. Neither route through the shell works
// everywhere: cmd.exe never expands a glob, and a QUOTED glob is only expanded by node's own
// test runner from Node 21 on — so on the Node 18/20 legs of CI `"test/*.test.mjs"` was a
// literal filename ("Could not find …/test/*.test.mjs"). List the files here instead.
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('../test/', import.meta.url));
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join(dir, f));
if (!files.length){ process.stderr.write(`no test files in ${dir}\n`); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
