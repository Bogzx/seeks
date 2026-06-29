// Wall-clock budget helpers. Pure; no I/O. A loop's deadline = started_at + time_budget_sec.
const UNIT = { s: 1, m: 60, h: 3600, d: 86400 };
export function parseDuration(s){
  if (s == null || s === '') return null;
  if (typeof s === 'number') return Number.isFinite(s) ? Math.round(s) : null;
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*([smhd])?$/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * UNIT[(m[2] || 's').toLowerCase()]);
}
export function deadlineMs(status){
  const s = status || {};
  if (!s.started_at || !s.time_budget_sec) return null;
  return s.started_at + s.time_budget_sec * 1000;
}
export function pastDeadline(status, now){
  const d = deadlineMs(status);
  return d != null && now >= d;
}
export function windDownNear(status, now){
  const d = deadlineMs(status); if (d == null) return false;
  const windowMs = Math.max(30, Math.round((status.time_budget_sec || 0) * 0.15)) * 1000;
  return now >= d - windowMs && now < d;
}
