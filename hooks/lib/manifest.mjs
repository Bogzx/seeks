// Which PART of a build manifest is oracle. A whole-file compare sent every dependency bump to a
// human; what can actually fake a green is narrower: what `npm test` runs (scripts), how the test
// runner is configured, and how modules resolve. So for the three mixed-purpose manifests the
// oracle is a canonical VIEW of just those parts, and a change outside it (dependencies, metadata,
// version) is free. Everything else matched by the oracle globs is compared whole.
// Pure, no I/O. Status key `oracle_manifest_diff`: 'keys' (default) | 'whole' (compare whole files).

// package.json: what runs the tests, configures the runner, or decides what an import resolves to.
export const PACKAGE_JSON_ORACLE_KEYS = ['scripts','type','main','exports','imports','workspaces',
  'jest','vitest','mocha','ava','tap','c8','nyc','jasmine'];
// pyproject.toml tables (and dotted keys under them) that configure tests/coverage/test envs/task runners.
export const PYPROJECT_ORACLE_TABLES = ['tool.pytest','tool.coverage','tool.tox','tool.nox','tool.hatch.envs','tool.poe','tool.taskipy'];
// setup.cfg sections: pytest, coverage, tox, and the `setup.py test` alias.
const SETUP_CFG_ORACLE = (s) => s === 'tool:pytest' || s === 'pytest' || s.startsWith('coverage:') || s.startsWith('tox:') || s === 'aliases';

const base = (f) => String(f).split('/').pop().toLowerCase();
export function manifestKind(file){
  const b = base(file);
  return b === 'package.json' ? 'package.json' : b === 'pyproject.toml' ? 'pyproject.toml' : b === 'setup.cfg' ? 'setup.cfg' : null;
}
const canonical = (v) => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const UNPARSEABLE = (text) => `\u0000unparseable\u0000${text}`;   // can't read it → every byte counts

function packageJsonView(text){
  let j; try { j = JSON.parse(text); } catch { return UNPARSEABLE(text); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return UNPARSEABLE(text);
  return JSON.stringify(canonical(Object.fromEntries(PACKAGE_JSON_ORACLE_KEYS.filter(k => k in j).map(k => [k, j[k]]))));
}
// A TOML line walker, not a parser: it only has to decide which lines belong to an oracle table,
// and follow a value across lines (multi-line arrays/inline tables, triple-quoted strings) so a
// continuation is attributed to the key that opened it.
const unquote = (s) => s.replace(/["'\s]/g, '');
function tomlView(text){
  const rel = (p) => PYPROJECT_ORACLE_TABLES.some(t => p === t || p.startsWith(`${t}.`));
  const out = []; let table = '', depth = 0, triple = null, carry = false;
  for (const raw of String(text).split(/\r?\n/)){
    const line = raw.trim();
    if (triple || depth > 0){                                       // inside a value that started on an earlier line
      if (carry) out.push(line);
      ({ depth, triple } = scan(line, depth, triple)); continue;
    }
    if (!line || line.startsWith('#')) continue;
    const h = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (h){ table = unquote(h[1]); if (rel(table)) out.push(`[${table}]`); continue; }
    const key = /^([^=]+?)\s*=/.exec(line); const full = key ? (table ? `${table}.${unquote(key[1])}` : unquote(key[1])) : table;
    carry = rel(table) || rel(full);
    if (carry) out.push(line);
    ({ depth, triple } = scan(key ? line.slice(line.indexOf('=') + 1) : line, 0, null));
  }
  return out.join('\n');
}
function scan(s, depth, triple){                                    // bracket depth + open triple-quote, outside strings
  for (let i = 0; i < s.length; i++){
    const t3 = s.slice(i, i + 3);
    if (triple){ if (t3 === triple){ triple = null; i += 2; } continue; }
    if (t3 === '"""' || t3 === "'''"){ triple = t3; i += 2; continue; }
    const c = s[i];
    if (c === '#') break;
    if (c === '"' || c === "'"){ const j = s.indexOf(c, i + 1); if (j === -1) break; i = j; continue; }
    if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') depth = Math.max(0, depth - 1);
  }
  return { depth, triple };
}
function setupCfgView(text){
  const out = []; let sec = '';
  for (const raw of String(text).split(/\r?\n/)){
    const line = raw.trimEnd(); const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) continue;
    const h = /^\[([^\]]+)\]$/.exec(t);
    if (h){ sec = h[1].trim().toLowerCase(); if (SETUP_CFG_ORACLE(sec)) out.push(`[${sec}]`); continue; }
    if (SETUP_CFG_ORACLE(sec)) out.push(line);
  }
  return out.join('\n');
}
export function oracleView(file, text){
  const k = manifestKind(file);
  return k === 'package.json' ? packageJsonView(text) : k === 'pyproject.toml' ? tomlView(text) : k === 'setup.cfg' ? setupCfgView(text) : String(text);
}
// Did the ORACLE part of this file change? mode 'whole' compares bytes.
export function oracleChanged(file, before, after, mode = 'keys'){
  if (mode === 'whole' || !manifestKind(file)) return before !== after;
  return oracleView(file, before) !== oracleView(file, after);
}
