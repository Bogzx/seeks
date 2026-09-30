import { test } from 'node:test'; import assert from 'node:assert/strict';
import { checkDocs } from '../scripts/sync-docs.mjs';
// The denylist floor lives in policy.mjs; commands/new.md and the loop skill carry copies for the
// intake and the maker to read. They used to drift (new.md shipped 3 of the 12 entries).
test('every doc copy of the default denylist matches DEFAULT_DENYLIST (fix: npm run sync-docs)', () => {
  for (const r of checkDocs()) assert.ok(r.ok, `${r.file} drifted — run \`npm run sync-docs\`\n  found: ${r.found}\n  want:  ${r.want}`);
});
