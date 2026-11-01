// Records in localStorage (one key per collection). Every company-owned record carries tenantId,
// and every read here is limited to the logged-in company, so screens cannot leak another company's data.
// Bump the version when the sample data changes, so browsers re-seed (v2: no personal names; v3: enquiry item lines;
// v4: Stretch 2 sample data, approval rules, helpers, invoice terms; v5: stage samples and three more customers;
// v6: Stretch 3 Part A: AMC and General Servicing data, check list, AMC terms, three more customers, AMC stage samples;
// v7: Stretch 3 Part B: company settings, terms per document, role dashboards, the job approval rule, 12 months of history).
const PREFIX = 'rsm.v7.';
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

// While building the sample data, writes are held in memory and saved once at the end (much faster).
let holding = false;
const dirty = new Set();
export function holdWrites(on) {
  holding = on;
  if (!on) { dirty.forEach(c => persist(c)); dirty.clear(); }
}

function persist(coll) {
  if (holding) { dirty.add(coll); return; }
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

// ---------- A phone working offline (Stretch 3 Part B) ----------
// While a phone is offline, its user's writes stay visible to that user, but everyone else reads the records as they
// were before (a copy kept at the first change) and does not see the records the phone created, until the phone is back
// online. Numbers given offline are temporary (T-1, T-2 …) and become real numbers on sync. The prototype has one
// browser, so this is how the office "does not have" the phone's changes yet.
const OFF_KEY = PREFIX + 'offline';
let off = null;
try { off = JSON.parse(localStorage.getItem(OFF_KEY) || 'null'); } catch { off = null; }
const saveOff = () => (off ? localStorage.setItem(OFF_KEY, JSON.stringify(off)) : localStorage.removeItem(OFF_KEY));
const holderActs = () => !!off && !off.syncing && actor === off.userId && tenant === off.tenantId;
const othersRead = () => !!off && tenant === off.tenantId && actor !== off.userId;
// Remember a record's state before the phone's first change (null: the phone created it).
function hold(coll, id, rec) {
  const b = (off.bases[coll] ||= {});
  if (!(id in b)) { b[id] = rec ? JSON.parse(JSON.stringify(rec)) : null; saveOff(); }
}
const viewOf = (coll, r) => { const b = off.bases[coll]; return b && r.id in b ? b[r.id] : r; };
export const offlineState = () => off;
export function goOffline(userId) { off = { userId, tenantId: tenant, since: new Date().toISOString(), bases: {}, temps: [], n: 0 }; saveOff(); }
// Back online: give the temporary numbers real ones and let everyone see the phone's changes.
export function goOnline() {
  if (!off) return [];
  const touched = Object.keys(off.bases);
  off.syncing = true;
  const done = off.temps.map(t => ({ temp: t.temp, real: nextNumber(t.docType) }));
  const map = Object.fromEntries(done.map(d => [d.temp, d.real]));
  // Whole tokens only, so T-1 does not touch T-10 or text such as "UNIT-1A".
  const swap = v => (typeof v === 'string' ? v.replace(/\bT-\d+\b/g, m => map[m] || m)
    : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
  if (done.length) touched.forEach(c => { const ids = off.bases[c]; cache.set(c, load(c).map(r => (r.id in ids ? swap(r) : r))); });
  off = null; saveOff();
  touched.forEach(persist);
  return done;
}

export function list(coll, pred) {
  let rows = load(coll).filter(r => r.tenantId === tenant);
  if (othersRead() && off.bases[coll]) rows = rows.map(r => viewOf(coll, r)).filter(Boolean);
  return pred ? rows.filter(pred) : rows;
}
const raw = (coll, id) => load(coll).find(r => r.id === id && r.tenantId === tenant) || null;
// A record an offline phone has changed but not sent yet (the office must not act on it until the phone is back).
export const heldByOther = (coll, id) => othersRead() && !!off.bases[coll]?.[id];
const officeCopy = (coll, id, rec) => (othersRead() && off.bases[coll]?.[id] ? off.bases[coll][id] : rec);
export const get = (coll, id) => { const r = raw(coll, id); return r && othersRead() && off.bases[coll] ? viewOf(coll, r) : r; };
export const findOne = (coll, pred) => list(coll).find(pred) || null;
// An office change to a record the phone also changed shows to both (the copy the office reads changes too).
function mirror(coll, id, fn) { const b = off?.bases[coll]; if (b && b[id] && !holderActs()) { fn(b[id]); saveOff(); } }

export function insert(coll, data, { status, note, silent } = {}) {
  const t = now();
  const rec = { id: uid(coll.slice(0, 3) + '_'), tenantId: tenant, ...data, createdAt: t, createdBy: actor, updatedAt: t, updatedBy: actor };
  if (status) {
    rec.status = status;
    rec.statusHistory = [{ status, at: t, by: actor, note: note || '' }];
  }
  if (holderActs()) hold(coll, rec.id, null);
  load(coll).push(rec);
  persist(coll);
  if (!silent) audit('create', coll, rec.id, note || `Created ${label(rec)}`);
  return rec;
}

// summary === false skips the audit entry (for silent draft saves).
export function update(coll, id, patch, summary) {
  const rec = raw(coll, id);
  if (!rec) throw new Error(`${coll} ${id} not found`);
  if (holderActs()) hold(coll, id, rec);
  mirror(coll, id, b => Object.assign(b, patch));
  Object.assign(rec, patch, { updatedAt: now(), updatedBy: actor });
  persist(coll);
  if (summary !== false) audit('update', coll, id, summary || `Updated ${label(rec)}`);
  return officeCopy(coll, id, rec);
}

// Delete a record (used for menu-access rows set to None); audited.
export function remove(coll, id, summary) {
  const rows = load(coll), i = rows.findIndex(r => r.id === id && r.tenantId === tenant);
  if (i < 0) return;
  if (holderActs()) hold(coll, id, rows[i]);
  const [rec] = rows.splice(i, 1);
  persist(coll);
  audit('delete', coll, id, summary || `Removed ${label(rec)}`);
}

export function setStatus(coll, id, status, note = '') {
  const rec = raw(coll, id);
  if (!rec || officeCopy(coll, id, rec).status === status) return rec && officeCopy(coll, id, rec);
  const t = now();
  if (holderActs()) hold(coll, id, rec);
  mirror(coll, id, b => { b.statusHistory = [...(b.statusHistory || []), { status, at: t, by: actor, note }]; b.status = status; });
  rec.statusHistory = [...(rec.statusHistory || []), { status, at: t, by: actor, note }];
  rec.status = status;
  rec.updatedAt = t;
  rec.updatedBy = actor;
  persist(coll);
  audit('status', coll, id, `Status: ${status}${note ? ` (${note})` : ''}`);
  return officeCopy(coll, id, rec);
}

export function audit(action, coll, recordId, summary) {
  const a = { id: uid('aud_'), tenantId: tenant, at: now(), userId: actor, action, coll, recordId, summary };
  if (holderActs()) hold('audit', a.id, null);
  load('audit').push(a);
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
  if (holderActs()) { const temp = `T-${++off.n}`; off.temps.push({ temp, docType }); saveOff(); return temp; }
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
// Transaction Setup: prefix and digits can change; the next number can only go up, so no number is used twice.
export function setSeries(docType, { prefix, padding, next }, date = new Date()) {
  const s = seriesFor(docType);
  const year = new Date(date).getFullYear(), last = s.lastByYear[year] || 0;
  if (next != null && !Number.isInteger(Number(next))) return 'The next number is a whole number.';
  if (next != null && Number(next) <= last) return `The next number must be ${last + 1} or more (${last} is already used this year).`;
  if (!/^[A-Z0-9]{1,6}$/.test(prefix || '')) return 'The prefix is 1 to 6 capital letters or digits.';
  const twin = list('series').find(x => x.id !== s.id && x.prefix === prefix);
  if (twin) return `The prefix ${prefix} is already used by ${twin.name}.`;
  const before = formatNo(s, year, last + 1);
  s.prefix = prefix; s.padding = Number(padding) || 4;
  if (next != null) s.lastByYear[year] = Number(next) - 1;
  persist('series');
  const after = formatNo(s, year, (s.lastByYear[year] || 0) + 1);
  if (before !== after) audit('update', 'series', s.id, `${s.name}: next number ${before} → ${after}`);
  return '';
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
  off = null;
}

// Remove data left by earlier versions of the sample data.
export function dropOldVersions() {
  Object.keys(localStorage).filter(k => /^rsm\.v\d+\./.test(k) && !k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
}
