// AMC visits (Planned → Confirmed → Scheduled → On the way → On site → Done → Checked & filed) and the service steps
// shared by AMC visits and General Servicing jobs: safe isolation, the Inspection Check List per covered shutter
// (Pass / Fail / N/A; items that do not fit the shutter's type are N/A by themselves), the customer's sign-off on the
// checklist (flow step 8), and the failed items, which become one repair enquiry per visit (or join an open one).
import * as store from './store.js';
import * as auth from './auth.js';
import { technicians, valueSet } from './lookups.js';
import { freeStart, nextWorkday, defaultHelper, bookings, fmtHour, toIso, DAY_START, DAY_END, onMyWay, checkIn } from './jobs.js';
import { createInvoice, invoiceForJob } from './billing.js';
import { saveNewEnquiry } from './enquiries.js';
import { todayStr, maybeCloseContract, BOOKABLE } from './contracts.js';
import { fmtDate } from './ui.js';

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowIso = () => new Date().toISOString();
const hhmm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ceilHalf = h => Math.ceil(h * 2) / 2;

// ---------- Scheduling ----------
export const OPEN_VISIT = ['Planned', 'Confirmed', 'Scheduled'];
export const DONE_VISIT = ['Done', 'Checked & filed'];
export const visitDate = v => v.blocks?.[0]?.date || v.confirmedDate || v.plannedDate;
export const isOverdue = v => OPEN_VISIT.includes(v.status) && visitDate(v) < todayStr();
export const seesVisit = v => auth.scope('amcExecution') !== 'own' || v.technicianId === auth.user()?.employeeId;
// Hours a visit blocks on each of its days: its team-hours spread over its days plus the round trip (at most a working day).
export const perDayHours = v => Math.min(ceilHalf((Number(v.workHours) || 0) / (v.days || 1) + (Number(v.travelHours) || 0)), DAY_END - DAY_START - 0.5);
export function workingDays(ds, n) {
  const out = [];
  let d = new Date(`${ds}T00:00`);
  if (d.getDay() === 0) d = nextWorkday(d);
  while (out.length < n) { out.push(dstr(d)); d = nextWorkday(d); }
  return out;
}

// Suggest a technician (the site's zone first, then free time) and a start that is free on every day of the visit.
// A date the customer already agreed is kept; otherwise the planned date (or today, when it has passed) onwards.
export function suggestVisit(v, span = 21) {
  const hours = perDayHours(v);
  const techs = technicians().map(t => ({ t, rank: t.mainZoneId === v.zoneId ? 0 : (t.extraZoneIds || []).includes(v.zoneId) ? 1 : 2 })).sort((a, b) => a.rank - b.rank);
  const t0 = todayStr();
  const fixed = v.confirmedDate && v.confirmedDate >= t0;
  let ds = fixed ? v.confirmedDate : v.plannedDate < t0 ? t0 : v.plannedDate;
  for (let i = 0; i < (fixed ? 1 : span); i++) {
    const days = workingDays(ds, v.days || 1);
    for (const { t } of techs) {
      const starts = days.map(x => freeStart(t.id, x, hours, v.id));
      if (starts.every(s => s != null)) return { technicianId: t.id, helperIds: [defaultHelper(t.id)?.id].filter(Boolean), date: days[0], start: starts[0], hours, days: days.length };
    }
    ds = dstr(nextWorkday(new Date(`${ds}T00:00`)));
  }
  return null;
}

export function scheduleVisitProblems(v, slot) {
  const p = [];
  const c = store.get('contracts', v.contractId);
  if (!BOOKABLE.includes(c?.status)) p.push('The contract is not active.');
  if (!OPEN_VISIT.includes(v.status)) p.push('This visit has already started.');
  if (!slot.technicianId) p.push('Pick a technician.');
  if (!slot.date || slot.date < todayStr()) p.push('Pick today or a later date.');
  else if (slot.date === todayStr() && slot.start != null && slot.start < new Date().getHours() + new Date().getMinutes() / 60) p.push('That start time has already passed.');
  if (slot.technicianId && slot.date && slot.start != null) {
    const hours = perDayHours(v);
    workingDays(slot.date, v.days || 1).forEach((ds, j) => {
      const from = j ? DAY_START + 0.5 : slot.start;
      const clash = bookings(slot.technicianId, ds, v.id).find(b => b.from < from + hours - 0.01 && b.to > from + 0.01);
      if (clash) p.push(`${ds}: the technician already has ${clash.no || clash.kind} ${fmtHour(clash.from)}–${fmtHour(clash.to)}.`);
    });
  }
  return p;
}

// A visit that will not happen (customer cancelled, contract ended): it no longer blocks the contract's closure.
export function cancelVisit(id, reason) {
  const v = store.get('amcVisits', id);
  if (!OPEN_VISIT.includes(v.status)) return v;
  store.update('amcVisits', id, { blocks: [], cancelReason: reason }, false);
  store.setStatus('amcVisits', id, 'Cancelled', reason);
  maybeCloseContract(v.contractId);
  return store.get('amcVisits', id);
}

// Customer agreed a date (Planned → Confirmed).
export function confirmVisitDate(id, { date, via }) {
  const v = store.get('amcVisits', id);
  if (!['Planned', 'Confirmed'].includes(v.status) || !date) return v;
  store.update('amcVisits', id, { confirmedDate: date, confirmedVia: via || '' }, `Visit ${v.n} of ${v.of}: ${fmtDate(date)} agreed with the customer${via ? ` (${via})` : ''}`);
  store.setStatus('amcVisits', id, 'Confirmed', `${fmtDate(date)}${via ? ` · ${via}` : ''}`);
  return store.get('amcVisits', id);
}

// Book the technician (→ Scheduled); a planned visit is confirmed in the same step. A visit longer than a day books
// the next working days too.
export function scheduleVisit(id, { technicianId, helperIds = [], date, start, via = '' }) {
  const v = store.get('amcVisits', id);
  const problems = scheduleVisitProblems(v, { technicianId, date, start });
  if (problems.length) return { problems };
  if (v.status === 'Planned' || v.confirmedDate !== date) confirmVisitDate(id, { date, via: via || v.confirmedVia });
  const hours = perDayHours(v);
  const blocks = workingDays(date, v.days || 1).map((ds, j) => { const from = j ? DAY_START + 0.5 : start; return { date: ds, from, to: from + hours }; });
  const last = blocks[blocks.length - 1];
  const first = v.status !== 'Scheduled';
  store.update('amcVisits', id, { technicianId, helperIds, blocks, start: toIso(date, start), end: toIso(last.date, last.to) },
    `${first ? 'Scheduled' : 'Moved'}: ${store.get('employees', technicianId)?.name}, ${fmtDate(date)} ${fmtHour(start)}${blocks.length > 1 ? ` (${blocks.length} days)` : ''}`);
  store.setStatus('amcVisits', id, 'Scheduled', store.get('employees', technicianId)?.name);
  return { problems: [] };
}

// ---------- The service steps (coll: 'amcVisits' for an AMC visit, 'jobs' for a General Servicing job) ----------
export const svcDoc = (coll, id) => store.get(coll, id);
export const signOf = (coll, d) => (coll === 'jobs' ? d.workDone : d.signoff);
export const saveSvc = (coll, id, patch) => store.update(coll, id, patch, false);
const signKey = coll => (coll === 'jobs' ? 'workDone' : 'signoff');

export function startTravel(coll, id) {
  if (coll === 'jobs') return onMyWay(id);
  const v = store.get(coll, id);
  store.update(coll, id, { steps: { ...v.steps, onMyWayAt: nowIso() } }, 'Technician on the way');
  store.setStatus(coll, id, 'On the way');
}
export function arrive(coll, id) {
  if (coll === 'jobs') return checkIn(id);
  const v = store.get(coll, id);
  const at = nowIso();
  const tech = store.get('employees', v.technicianId);
  const enq = store.get('enquiries', v.enquiryId);
  const con = store.get('customers', v.customerId)?.contacts?.find(c => c.id === enq?.contactId) || store.get('customers', v.customerId)?.contacts?.[0];
  const signoff = v.signoff || { ratings: { punctuality: 0, quality: 0, staff: 0, overall: 0 }, comments: '', signedAt: null, timeIn: '', timeOut: '',
    tech: { name: tech?.name || '', designation: tech?.designation || '', date: dstr(new Date()), signatureId: null },
    cust: { name: con?.name || v.contact, designation: con?.designation || '', date: dstr(new Date()), signatureId: null, stampId: null } };
  store.update(coll, id, { steps: { ...v.steps, checkInAt: at }, signoff: { ...signoff, timeIn: hhmm(at) } }, 'Checked in on site');
  store.setStatus(coll, id, 'On site');
}

// The Inspection Check List (Value Set Master "AMC Inspection Check List"; draft until the team lead sends the real one).
export const checkItems = () => (valueSet('AMC_CHECKLIST')?.values || []).filter(v => v.active).sort((a, b) => a.order - b.order)
  .map(v => ({ code: v.code, label: v.label, hint: v.hint || '', applies: v.applies || 'ALL' }));
export const appliesTo = (it, sh) => it.applies === 'ALL' || (it.applies === 'MOTOR' && sh.motorised) || (it.applies === 'FIRE' && sh.fireRated);

export function shutterState(d, sh) {
  const saved = d.checklist?.[sh.shutterId] || {};
  const items = checkItems().map(it => ({ ...it, on: appliesTo(it, sh), ...(saved.items?.[it.code] || {}) }));
  const live = items.filter(i => i.on);
  return { items, unsafe: !!saved.unsafe, total: live.length, answered: live.filter(i => i.r).length, fails: live.filter(i => i.r === 'F').length, off: items.length - live.length };
}
function patchShutter(coll, id, shutterId, fn) {
  const d = store.get(coll, id);
  const cur = d.checklist?.[shutterId] || { items: {}, unsafe: false };
  saveSvc(coll, id, { checklist: { ...(d.checklist || {}), [shutterId]: fn(structuredClone(cur)) } });
}
export const setItem = (coll, id, shutterId, code, patch) => patchShutter(coll, id, shutterId, c => ({ ...c, items: { ...c.items, [code]: { ...(c.items[code] || {}), ...patch } } }));
export const setUnsafe = (coll, id, shutterId, on) => patchShutter(coll, id, shutterId, c => ({ ...c, unsafe: !!on }));
export function allPass(coll, id, shutterId) {
  const d = store.get(coll, id);
  const sh = d.shutters.find(s => s.shutterId === shutterId);
  patchShutter(coll, id, shutterId, c => {
    checkItems().filter(it => appliesTo(it, sh) && !c.items[it.code]?.r).forEach(it => { c.items[it.code] = { r: 'P' }; });
    return c;
  });
}

export function failuresOf(d) {
  return (d.shutters || []).flatMap(sh => {
    const st = shutterState(d, sh);
    return st.items.filter(i => i.on && i.r === 'F').map(i => ({ shutterId: sh.shutterId, tag: sh.tag, location: sh.location, code: i.code, label: i.label, note: i.note || '',
      photoId: i.photoId || null, itemId: i.itemId || '', qty: Number(i.qty) || 1, unsafe: st.unsafe }));
  });
}

export function signoffProblems(coll, d) {
  const p = [];
  const s = signOf(coll, d);
  if (!d.steps?.checkInAt) p.push('Check in first.');
  if (!(d.shutters || []).length) p.push('No shutters to check: add them to the site\'s shutter register first.');
  if (!d.safeIsolation) p.push('Tick "Safe isolation done" before the checklist.');
  (d.shutters || []).forEach(sh => { const st = shutterState(d, sh); if (st.answered < st.total) p.push(`${sh.tag}: ${st.total - st.answered} item(s) not checked yet.`); });
  failuresOf(d).forEach(f => { if (!f.note.trim() || !f.photoId) p.push(`${f.tag} ${f.label}: a failed item needs a photo and a note.`); });
  if (!s || Object.values(s.ratings).some(v => !v)) p.push('The customer has not rated all 4 categories.');
  if (!s?.tech?.signatureId) p.push('The technician must sign (checked by).');
  if (!s?.cust?.signatureId) p.push('The customer must sign the checklist.');
  return p;
}

// Finish: the customer has signed the checklist. A GS job then follows the repair rules (draft invoice when not raised
// yet); an AMC visit raises nothing (it is billed by the plan). Failed items become a repair enquiry.
export function finishService(coll, id) {
  const d = store.get(coll, id);
  if (signOf(coll, d)?.signedAt) return { problems: [], repair: null };
  const problems = signoffProblems(coll, d);
  if (problems.length) return { problems };
  const at = nowIso();
  const failures = failuresOf(d);
  if (coll === 'jobs') {
    store.update('jobs', id, { failures, workDone: { ...d.workDone, rows: d.workDone.rows.map(r => ({ ...r, status: 'DONE' })), signedAt: at } }, 'Inspection check list signed by the customer');
    store.setStatus('jobs', id, 'Work done');
    store.setStatus('enquiries', d.enquiryId, 'Completed', d.no);
    if (!invoiceForJob(id)) createInvoice(id, { post: false, note: 'draft made when the check list was signed' });
  } else {
    store.update(coll, id, { failures, signoff: { ...d.signoff, signedAt: at } }, `Check list signed by the customer: ${failures.length ? `${failures.length} failed item(s)` : 'all pass'}`);
    store.setStatus(coll, id, 'Done', d.reportNo);
  }
  const repair = raiseRepair(coll, store.get(coll, id));
  return { problems: [], repair };
}

export function leaveSite(coll, id) {
  const d = store.get(coll, id);
  const s = signOf(coll, d);
  if (!s?.signedAt || d.steps?.checkOutAt) return;
  const at = nowIso();
  store.update(coll, id, { steps: { ...d.steps, checkOutAt: at }, [signKey(coll)]: { ...s, ...(coll === 'jobs' ? { s1: { ...s.s1, timeOut: hhmm(at) } } : { timeOut: hhmm(at) }) } }, 'Checked out');
}

// The office files a done visit (flow step 9: "office checks and updates job status").
export function fileVisit(id) {
  const v = store.get('amcVisits', id);
  if (v.status !== 'Done') return v;
  store.update('amcVisits', id, { filedAt: nowIso(), filedBy: store.currentActor() }, `${v.reportNo} checked and filed`);
  store.setStatus('amcVisits', id, 'Checked & filed');
  maybeCloseContract(v.contractId);
  return store.get('amcVisits', id);
}

// ---------- Failed items → repair enquiry ----------
// One repair enquiry per visit with all its failed items. A failure already in an open repair enquiry of the same
// site (same shutter and item) is added to that enquiry instead, so nothing is reported twice. A repair whose work is
// done ("Completed") no longer counts: a fault that comes back after it makes a new enquiry.
const OPEN_ENQ = e => e.type === 'REPAIR' && !['Completed', 'Closed', 'Lost', 'Cancelled'].includes(e.status);
export const openRepairFor = (siteId, shutterId, code) => store.findOne('enquiries', e => OPEN_ENQ(e) && e.siteId === siteId && (e.failures || []).some(f => f.shutterId === shutterId && f.code === code));
export function raiseRepair(coll, d) {
  if (d.repairEnquiryId || d.repairAddedTo?.length) return { created: d.repairEnquiryId ? store.get('enquiries', d.repairEnquiryId) : null, addedTo: d.repairAddedTo || [] };
  const fails = failuresOf(d);
  if (!fails.length) return null;
  const ref = coll === 'jobs' ? `General servicing ${d.no}` : `AMC visit ${d.reportNo}`;
  const added = new Map(), fresh = [];
  fails.forEach(f => {
    const hit = openRepairFor(d.siteId, f.shutterId, f.code);
    if (hit) { if (!added.has(hit.id)) added.set(hit.id, []); added.get(hit.id).push(f); } else fresh.push(f);
  });
  const photo = f => (f.photoId ? [{ id: f.photoId, name: `${f.tag} ${f.label}.jpg`, size: 0, kind: 'photo' }] : []);
  added.forEach((fs, enqId) => {
    const e = store.get('enquiries', enqId);
    store.update('enquiries', enqId, { failures: [...e.failures, ...fs.map(f => ({ ...f, from: ref, again: true }))], attachments: [...(e.attachments || []), ...fs.flatMap(photo)] },
      `Found again on ${ref}: ${fs.map(f => `${f.tag} ${f.label}`).join(', ')}`);
  });
  let created = null;
  if (fresh.length) {
    const c = store.get('customers', d.customerId);
    const enq0 = store.get('enquiries', d.enquiryId);
    const con = c?.contacts?.find(x => x.id === enq0?.contactId) || c?.contacts?.[0];
    const unsafe = fresh.some(f => f.unsafe);
    created = saveNewEnquiry({
      receivedAt: nowIso(), channel: 'OTHER', channelOther: ref, type: 'REPAIR', enquiryStatus: 'HOT', priority: 'HIGH', siteInspection: 'NO', recordedBy: store.currentActor(),
      remarks: unsafe ? 'A shutter was taken out of service as unsafe.' : '', attachments: fresh.flatMap(photo), customerId: d.customerId, contactId: con?.id || '', contactName: con?.name || d.contact,
      mobile: con?.mobile || d.phone, email: con?.email || '', siteId: d.siteId,
      lines: fresh.map(f => ({ itemRef: f.itemId ? `itm:${f.itemId}` : '', itemName: f.itemId ? store.get('items', f.itemId)?.name || '' : '', qty: f.itemId ? f.qty : null, description: `${f.tag} ${f.location}: ${f.label}${f.note ? ` – ${f.note}` : ''}` })),
    });
    store.update('enquiries', created.id, { failures: fresh.map(f => ({ ...f, from: ref })), fromService: { coll, id: d.id, no: coll === 'jobs' ? d.no : d.reportNo } }, false);
  }
  markUnsafe(d, fails.filter(f => f.unsafe));
  store.update(coll, d.id, { repairEnquiryId: created?.id || '', repairAddedTo: [...added.keys()] },
    [created && `Repair enquiry ${created.no} created`, added.size && `added to ${[...added.keys()].map(k => store.get('enquiries', k).no).join(', ')}`].filter(Boolean).join('; '));
  return { created: created && store.get('enquiries', created.id), addedTo: [...added.keys()] };
}

// "Unsafe – taken out of service": the shutter is marked in the site's register.
function markUnsafe(d, fails) {
  if (!fails.length) return;
  const c = store.get('customers', d.customerId);
  const ids = new Set(fails.map(f => f.shutterId));
  const sites = c.sites.map(s => (s.id !== d.siteId ? s : { ...s, shutters: s.shutters.map(sh => (ids.has(sh.id) ? { ...sh, outOfService: true } : sh)) }));
  store.update('customers', c.id, { sites }, `Out of service: ${fails.map(f => f.tag).join(', ')}`);
}
