import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
// Every relative link in the docs points at a file that exists and, with a #fragment, at a heading
// that exists. The README links into GUARANTEES.md and back, so a renamed heading on either
// side would otherwise break silently.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOCS = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'GUARANTEES.md', 'examples/add/README.md', 'bench/README.md']
  .filter(f => fs.existsSync(path.join(ROOT, f)));
// GitHub's heading anchor: lowercase, drop everything but letters, digits, spaces, '-' and '_', one '-' per space.
export const slug = (h) => h.replace(/`/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
const anchors = (file) => new Set(fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').split('\n')
  .filter(l => /^#{1,6} /.test(l)).map(l => slug(l.replace(/^#+ /, '').trim())));
function links(src){
  const body = src.replace(/```[\s\S]*?```/g, '');
  return [...body.matchAll(/\]\(([^)\s]+)\)|(?:src|href)="([^"]+)"/g)].map(m => m[1] ?? m[2])
    .filter(u => !/^(?:[a-z]+:|\/\/)/i.test(u));
}
test('the heading slug matches GitHub for the anchors the docs use', () => {
  assert.equal(slug('What the guardrails cover — and what they don\'t'), 'what-the-guardrails-cover--and-what-they-dont');
  assert.equal(slug('`--container`: keep the rest of your machine out of reach'), '--container-keep-the-rest-of-your-machine-out-of-reach');
  assert.equal(slug('Headless: `seeks run`'), 'headless-seeks-run');
});
for (const doc of DOCS) test(`every relative link in ${doc} resolves`, () => {
  const file = path.join(ROOT, doc);
  for (const link of links(fs.readFileSync(file, 'utf8'))){
    const [p, frag] = link.split('#');
    const target = p ? path.resolve(path.dirname(file), decodeURIComponent(p)) : file;
    assert.ok(fs.existsSync(target), `${doc}: ${link} → no such file`);
    if (frag && target.endsWith('.md')) assert.ok(anchors(target).has(frag), `${doc}: ${link} → no heading #${frag} in ${path.relative(ROOT, target)}`);
  }
});
