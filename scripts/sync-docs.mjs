// Doc copies of values whose source of truth is code. The default denylist is spelled out in
// commands/new.md (the config.json the intake writes) and in the loop skill (what the maker is
// told is off limits); both are generated from policy.mjs::DEFAULT_DENYLIST here.
//   node scripts/sync-docs.mjs          rewrite the copies
//   node scripts/sync-docs.mjs --check  exit 1 if any copy drifted (test/docs.test.mjs runs this)
import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
import { DEFAULT_DENYLIST } from '../hooks/lib/policy.mjs';
const root = new URL('../', import.meta.url);
export const TARGETS = [
  { file: 'commands/new.md', re: /("denylist":)(\[[^\]]*\])/, render: () => JSON.stringify(DEFAULT_DENYLIST) },
  { file: 'skills/loop/SKILL.md', re: /(editing denylist paths \()((?:`[^`]+`(?:, )?)+)(?= — a floor)/,
    render: () => DEFAULT_DENYLIST.map(g => `\`${g}\``).join(', ') },
];
// → [{ file, ok, found, want }]; a target whose anchor vanished is drift too (ok:false, found:null).
export function checkDocs(){
  return TARGETS.map(t => {
    const src = fs.readFileSync(new URL(t.file, root), 'utf8'); const m = t.re.exec(src); const want = t.render();
    return { file: t.file, ok: !!m && m[2] === want, found: m ? m[2] : null, want };
  });
}
export function syncDocs(){
  for (const t of TARGETS){
    const f = new URL(t.file, root); const src = fs.readFileSync(f, 'utf8');
    if (!t.re.test(src)) throw new Error(`${t.file}: anchor for the generated denylist not found`);
    fs.writeFileSync(f, src.replace(t.re, (_, pre) => pre + t.render()));
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])){
  if (process.argv.includes('--check')){
    const bad = checkDocs().filter(r => !r.ok);
    for (const r of bad) process.stderr.write(`${r.file}: denylist drifted from DEFAULT_DENYLIST\n  found: ${r.found}\n  want:  ${r.want}\n`);
    process.exit(bad.length ? 1 : 0);
  }
  syncDocs(); process.stdout.write('docs synced\n');
}
