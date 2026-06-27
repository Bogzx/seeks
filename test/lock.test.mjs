import { test } from 'node:test'; import assert from 'node:assert/strict';
import { makeTempRepo, seeksRun } from './helpers.mjs'; import fs from 'node:fs';
import { acquire, release, isHeld } from '../hooks/lib/lock.mjs';
const TTL = 600000;
const mk = () => { const rd = seeksRun(makeTempRepo(),'x'); fs.mkdirSync(rd,{recursive:true}); return rd; };
test('acquire empty → ok and held', () => { const rd=mk(); assert.equal(acquire(rd,1000,TTL).ok,true); assert.equal(isHeld(rd,1500,TTL),true); });
test('fresh holder blocks acquire', () => { const rd=mk(); acquire(rd,1000,TTL); assert.equal(acquire(rd,1005,TTL).ok,false); });
test('stale holder is reclaimable', () => { const rd=mk(); acquire(rd,0,TTL); assert.equal(acquire(rd,TTL+1,TTL).ok,true); });
