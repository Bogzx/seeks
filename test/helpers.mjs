import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
export function makeTempRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seeks-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}
export function seeksRun(repo, name) { return path.join(repo, '.seeks', 'run', name); }
export function makeRun(repo, name, status) {
  const rd = seeksRun(repo, name); fs.mkdirSync(rd, { recursive: true });
  fs.writeFileSync(path.join(rd, 'status.json'), JSON.stringify(status, null, 2));
  return rd;
}
