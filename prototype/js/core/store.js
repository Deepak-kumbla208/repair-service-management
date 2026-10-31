// Records in localStorage (one key per collection). Every company-owned record carries tenantId,
// and every read here is limited to the logged-in company, so screens cannot leak another company's data.
// Bump the version when the sample data changes, so browsers re-seed (v2: no personal names; v3: enquiry item lines;
// v4: Stretch 2 sample data, approval rules, helpers, invoice terms).
const PREFIX = 'rsm.v4.';
const cache = new Map();
let tenant = null;
let actor = null;

export function setContext({ tenantId = null, userId = null } = {}) { tenant = tenantId; actor = userId; }
export const currentTenant = () => tenant;
export const currentActor = () => actor;

function load(coll) {
  if (!cache.has(coll)) {
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(PREFIX + coll) || '[]'); } catch { rows = []; }
    cache.set(coll, rows);
  }
  return cache.get(coll);
}

function persist(coll) {
  try {
    localStorage.setItem(PREFIX + coll, JSON.stringify(load(coll)));
  } catch (e) {
    alert('Browser storage is full. Use "Reset demo data" to start again.');
    throw e;
  }
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => new Date().toISOString();
const label = r => r.no || r.code || r.name || r.id;

// Platform-level read across all companies (used only by the login screen and company list).
export const all = coll => load(coll);

export function list(coll, pred) {
  const rows = load(coll).filter(r => r.tenantId === tenant);
  return pred ? rows.filter(pred) : rows;
}
export const get = (coll, id) => load(coll).find(r => r.id === id && r.tenantId === tenant) || null;
export const findOne = (coll, pred) => list(coll).find(pred) || null;

export function insert(coll, data, { status, note, silent } = {}) {
  const t = now();
  const rec = { id: uid(coll.slice(0, 3) + '_'), tenantId: tenant, ...data, createdAt: t, createdBy: actor, updatedAt: t, updatedBy: actor };
  if (status) {
    rec.status = status;
    rec.statusHistory = [{ status, at: t, by: actor, note: note || '' }];
  }
  load(coll).push(rec);
  persist(coll);
  if (!silent) audit('create', coll, rec.id, note || `Created ${label(rec)}`);
  return rec;
}

// summary === false skips the audit entry (for silent draft saves).
export function update(coll, id, patch, summary) {
  const rec = get(coll, id);
  if (!rec) throw new Error(`${coll} ${id} not found`);
  Object.assign(rec, patch, { updatedAt: now(), updatedBy: actor });
  persist(coll);
  if (summary !== false) audit('update', coll, id, summary || `Updated ${label(rec)}`);
  return rec;
}

export function setStatus(coll, id, status, note = '') {
  const rec = get(coll, id);
  if (!rec || rec.status === status) return rec;
  const t = now();
  rec.statusHistory = [...(rec.statusHistory || []), { status, at: t, by: actor, note }];
  rec.status = status;
  rec.updatedAt = t;
  rec.updatedBy = actor;
  persist(coll);
  audit('status', coll, id, `Status: ${status}${note ? ` (${note})` : ''}`);
  return rec;
}

export function audit(action, coll, recordId, summary) {
  load('audit').push({ id: uid('aud_'), tenantId: tenant, at: now(), userId: actor, action, coll, recordId, summary });
  persist('audit');
}
export const auditFor = (coll, id) => list('audit', a => a.coll === coll && a.recordId === id);

// Number series, e.g. ENQ-2026-0001: per company, document type and year.
function seriesFor(docType) {
  const s = findOne('series', x => x.docType === docType);
  if (!s) throw new Error(`No number series for ${docType}`);
  return s;
}
const formatNo = (s, year, n) => `${s.prefix}-${year}-${String(n).padStart(s.padding, '0')}`;

export function nextNumber(docType, date = new Date()) {
  const s = seriesFor(docType);
  const year = new Date(date).getFullYear();
  const n = (s.lastByYear[year] || 0) + 1;
  s.lastByYear[year] = n;
  persist('series');
  return formatNo(s, year, n);
}
export function peekNumber(docType, date = new Date()) {
  const s = seriesFor(docType);
  const year = new Date(date).getFullYear();
  return formatNo(s, year, (s.lastByYear[year] || 0) + 1);
}

// Session (kept under the same prefix, so a reset also logs out)
export const readSession = () => { try { return JSON.parse(localStorage.getItem(PREFIX + 'session')); } catch { return null; } };
export const writeSession = s => (s ? localStorage.setItem(PREFIX + 'session', JSON.stringify(s)) : localStorage.removeItem(PREFIX + 'session'));

// Seeding and reset
export const isSeeded = () => localStorage.getItem(PREFIX + 'seeded') === '1';
export function writeSeed(collections) {
  for (const [coll, rows] of Object.entries(collections)) {
    cache.set(coll, rows);
    persist(coll);
  }
  localStorage.setItem(PREFIX + 'seeded', '1');
}
export function clearAll() {
  Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
  cache.clear();
}

// Remove data left by earlier versions of the sample data.
export function dropOldVersions() {
  Object.keys(localStorage).filter(k => /^rsm\.v\d+\./.test(k) && !k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
}
