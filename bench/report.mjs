#!/usr/bin/env node
// Render the results table from one or more bench/run.mjs JSONL files.
//   node bench/report.mjs bench/results/*.jsonl
import fs from 'node:fs';
import { renderTable } from './lib.mjs';
const files = process.argv.slice(2);
if (!files.length){ console.error('usage: node bench/report.mjs <results.jsonl>…'); process.exit(2); }
const rows = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
console.log(renderTable(rows));
