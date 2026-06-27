import { test } from 'node:test'; import assert from 'node:assert/strict';
import { makeTempRepo, seeksRun } from './helpers.mjs'; import fs from 'node:fs';
import { readStatus, writeStatusAtomic } from '../hooks/lib/status.mjs';
test('null when missing', () => { assert.equal(readStatus(seeksRun(makeTempRepo(),'x')), null); });
test('round-trip', () => {
  const rd = seeksRun(makeTempRepo(),'x'); fs.mkdirSync(rd,{recursive:true});
  writeStatusAtomic(rd, { loop:'x', open_items:3 });
  assert.deepEqual(readStatus(rd), { loop:'x', open_items:3 });
});
