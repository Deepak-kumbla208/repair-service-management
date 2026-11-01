// Stage samples: one repair enquiry at every stage of the money side, so each step can be tried without first doing
// all the steps before it. Each sample is a short story run through the real rules (core/), so numbers, statuses,
// tasks and the register are consistent. After each step its dates are moved back ("phase"), so the stories look
// like they happened over the last weeks. Runs after the base sample data on first load and on "Reset demo data".
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { saveBlob } from '../core/media.js';
import { findSite } from '../core/lookups.js';
import { saveNewEnquiry } from '../core/enquiries.js';
import { startReport, saveReport, submitReport } from '../core/inspections.js';
import { createEstimate, saveEstimate } from '../core/estimates.js';
import { createFromEstimate, saveWording, submitForCheck, decideQuotation, markSent, accept, reject } from '../core/quotations.js';
import { openTaskFor } from '../core/workflow.js';
import { setPartReady, earliestDate, freeStart, jobDuration, nextWorkday, scheduleJob, defaultHelper, onMyWay, checkIn, saveJob, completeWorkDone, requestLeave, confirmLeave, checkOut } from '../core/jobs.js';
import { invoiceForJob, postInvoice, recordPayment, addFollowUp } from '../core/billing.js';
import { markDocumented } from '../core/closure.js';
import { buildAmcSamples } from './seed-demo-flow-amc.js';

const COLLS = ['enquiries', 'inspections', 'siteReports', 'estimates', 'quotations', 'jobs', 'invoices', 'payments', 'followUps', 'tasks', 'audit', 'customers', 'contracts', 'amcVisits'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function when(days, at) { const d = new Date(); d.setDate(d.getDate() + days); if (at) { const [h, m] = at.split(':').map(Number); d.setHours(h, m, 0, 0); } return d; }

// ---------- Moving a step's dates back ----------
function shift(v, mark, today, ms, days) {
  if (typeof v === 'string') {
    if (ISO.test(v) && v >= mark) return new Date(new Date(v).getTime() + ms).toISOString();
    if (DAY.test(v) && v >= today) { const d = new Date(`${v}T00:00`); d.setDate(d.getDate() + days); return dstr(d); }
    return v;
  }
  if (Array.isArray(v)) return v.map(x => shift(x, mark, today, ms, days));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x, mark, today, ms, days)]));
  return v;
}
// Run fn, then move what it created or changed to "days" from today at "at" (HH:MM), or "hoursAgo" back from now.
function phase({ days = 0, at = null, hoursAgo = 0 }, fn) {
  const now = new Date();
  const mark = now.toISOString(), today = dstr(now);
  const snap = Object.fromEntries(COLLS.map(c => [c, new Map(store.all(c).map(r => [r.id, JSON.stringify(r)]))]));
  const out = fn();
  const ms = hoursAgo ? -hoursAgo * 3600000 : at ? when(days, at).getTime() - now.getTime() : days * 86400000;
  const dd = hoursAgo ? 0 : days;
  if (!ms) return out;
  COLLS.forEach(c => {
    let changed = false;
    const rows = store.all(c).map(r => {
      const before = snap[c].get(r.id);
      if (before === JSON.stringify(r)) return r;
      changed = true;
      if (!before) return shift(r, mark, today, ms, dd);
      const old = JSON.parse(before);
      return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, JSON.stringify(v) === JSON.stringify(old[k]) ? v : shift(v, mark, today, ms, dd)]));
    });
    if (changed) store.writeSeed({ [c]: rows });
  });
  return out;
}
// Write fields without touching "updated" (used to place planned times exactly).
function setRaw(coll, id, patch) {
  store.writeSeed({ [coll]: store.all(coll).map(r => (r.id === id ? { ...r, ...patch } : r)) });
}

// ---------- Pictures (signatures, stamps, photos) ----------
async function picture(w, h, draw, type, kind) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const blob = await new Promise(r => c.toBlob(r, type, 0.8));
  return (await saveBlob(blob, { name: `${kind}.${type === 'image/png' ? 'png' : 'jpg'}`, kind })).id;
}
export const signature = n => picture(300, 90, g => {
  g.strokeStyle = '#042C53'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(14, 62);
  for (let i = 0; i < 6; i++) g.quadraticCurveTo(36 + i * 44, i % 2 ? 14 + n * 4 : 80 - n * 3, 58 + i * 44, 52);
  g.stroke();
}, 'image/png', 'signature');
export const stamp = name => picture(200, 200, g => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 200); g.strokeStyle = '#2B5BA8'; g.lineWidth = 6; g.beginPath(); g.arc(100, 100, 88, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#2B5BA8'; g.font = 'bold 17px sans-serif'; g.textAlign = 'center';
  name.toUpperCase().replace(' PTE LTD', '').split(' ').slice(0, 3).forEach((w, i) => g.fillText(w, 100, 84 + i * 22));
}, 'image/jpeg', 'photo');
export const photo = (label, color) => picture(480, 360, g => { g.fillStyle = color; g.fillRect(0, 0, 480, 360); g.fillStyle = 'rgba(255,255,255,.9)'; g.font = 'bold 30px sans-serif'; g.fillText(label, 30, 190); }, 'image/jpeg', 'photo');

// ---------- Story steps (each runs the real rules) ----------
let T = '';
// The Gulf company has only an Admin, who then does every step.
const userOf = login => (T === 'co_gdd' ? 'usr_co_gdd_gadmin' : `usr_${T}_${login}`);
const as = login => store.setContext({ tenantId: T, userId: userOf(login) });
const cust = code => store.findOne('customers', c => c.code === code);
const item = code => store.findOne('items', i => i.code === code);
const techLogin = { emp_co_dsh_3: 'techA', emp_co_dsh_4: 'techB' };

function newEnquiry(code, tech, text, priority = 'MEDIUM') {
  as('ops');
  const c = cust(code), con = c.contacts[0];
  return saveNewEnquiry({ receivedAt: new Date().toISOString(), channel: 'CALL', channelOther: '', type: 'REPAIR', enquiryStatus: priority === 'HIGH' ? 'HOT' : 'WARM', priority, siteInspection: 'YES',
    recordedBy: userOf('ops'), remarks: '', attachments: [], customerId: c.id, contactId: con.id, contactName: con.name, mobile: con.mobile, email: con.email, siteId: c.sites[0].id,
    lines: [{ itemRef: '', itemName: '', qty: null, description: text }] }, { assign: { technicianId: tech, visitAt: new Date(Date.now() + 3600000).toISOString(), confirmedBy: 'Phone' } });
}
// The technician's site report: picks [[tag, fault]], mats [[item code, qty, tag]], s3 / s4 overrides.
function fileReport(enq, tech, { picks, mats = [], desc, s3 = {}, s4 = {} }, sigId) {
  as(techLogin[tech] || 'gadmin');
  const e = store.get('enquiries', enq.id);
  const { site } = findSite(e.siteId);
  const rep = startReport(e.inspectionId);
  const sh = tag => site.shutters.find(s => s.tag === tag);
  const shutters = picks.map(([tag, finding]) => { const s = sh(tag); return { key: s.id, shutterId: s.id, tag: s.tag, location: s.location, productId: s.productId, width: s.width, height: s.height, unit: s.unit, sizeCode: s.sizeCode, motor: s.motor, finding }; });
  const rows = mats.map(([code, qty, tag]) => { const it = item(code); return { name: it.name, spec: it.spec || '', qty, unit: it.unit, remarks: '', itemId: it.id, shutterKey: sh(tag)?.id || '' }; });
  saveReport(rep.id, {
    s1: { ...rep.s1, timeIn: '10:10', timeOut: '10:55' }, shutters, s5: { rows, consumables: '' }, s3: { ...rep.s3, hoursPerDay: 6, ...s3 }, s4: { ...rep.s4, ...s4 },
    s2: { ...rep.s2, replace: rows.length > 0, description: desc, findings: picks.map(([t, f]) => `${t} ${f}`).join('; ') }, s7: { ...rep.s7, signatureId: sigId },
  });
  submitReport(rep.id);
}
function makeQuote(enq, { line = false, term } = {}) {
  as('ops');
  const est = createEstimate(enq.id);
  if (line) saveEstimate(est.id, { costingLevel: 'LINE' });
  const q = createFromEstimate(est.id);
  if (term) saveWording(q.id, { paymentTerm: term });
  submitForCheck(q.id);
  return q;
}
const decide = (q, login = 'approver', how = 'approve', note = '') => { as(login); decideQuotation(openTaskFor('quotation', q.id).id, how, note); };
const send = q => { as('ops'); markSent(q.id, 'Email'); };
function win(q, po, term) {
  as('ops');
  const r = accept(q.id, { method: 'PO', poNo: po, poDate: dstr(new Date()), contact: store.get('quotations', q.id).contact, attachments: [], paymentTerm: term });
  return r.job;
}
// Schedule with the given technician on the first free day; then place it exactly at "days" from today, 09:00.
function book(job, tech, { partsReady = true, days, at = '09:00' } = {}) {
  as('ops');
  if (partsReady) store.get('jobs', job.id).parts.forEach(p => setPartReady(job.id, p.key, true));
  const j = store.get('jobs', job.id), hours = jobDuration(j);
  let d = new Date(`${earliestDate(j)}T00:00`), start = null;
  for (let i = 0; i < 20 && start == null; i++) { start = freeStart(tech, dstr(d), hours, j.id); if (start == null) d = nextWorkday(d); }
  scheduleJob(j.id, { technicianId: tech, helperIds: [defaultHelper(tech)?.id].filter(Boolean), date: dstr(d), start, hours });
  return { hours, place: days == null ? null : () => {
    const s = when(days, at), e = new Date(s.getTime() + hours * 3600000);
    setRaw('jobs', job.id, { start: s.toISOString(), end: e.toISOString() });
    const inv = invoiceForJob(job.id);
    if (inv?.status === 'Posted' && inv.paymentTerm === 'IMMEDIATE') setRaw('invoices', inv.id, { dueDate: dstr(s) });
  } };
}
// The visit on the phone: on my way, check in, work done and signed, payment, leave request, office OK, check out.
async function visit(job, tech, days, { rows = {}, ratings = [5, 5, 5, 5], comments = '', pay = null, confirm = true, checkout = true, now = false } = {}) {
  const media = { before: await photo('Before', '#7E93A8'), after: await photo('After', '#5E8A5A'), t: await signature(1), c: await signature(2), stamp: await stamp(job.customer) };
  const at = (hhmmText, hoursAgo) => (now ? { hoursAgo } : { days, at: hhmmText });
  const tl = techLogin[tech] || 'gadmin';
  phase(at('08:40', 3.6), () => { as(tl); onMyWay(job.id); });
  phase(at('09:05', 3.2), () => { as(tl); checkIn(job.id); saveJob(job.id, { photosBefore: [media.before] }); });
  phase(at('12:20', 0.4), () => {
    as(tl);
    const w = structuredClone(store.get('jobs', job.id).workDone);
    Object.entries(rows).forEach(([i, [st, remark]]) => Object.assign(w.rows[i], { status: st, remark }));
    const [p, q, s, o] = ratings;
    Object.assign(w, { ratings: { punctuality: p, quality: q, staff: s, overall: o }, comments, worksAt: new Date().toISOString() });
    w.tech.signatureId = media.t; w.cust.signatureId = media.c; w.cust.stampId = media.stamp;
    saveJob(job.id, { workDone: w, photosAfter: [media.after] });
    completeWorkDone(job.id);
    if (pay) { const inv = invoiceForJob(job.id); recordPayment({ invoiceId: inv.id, amount: inv.total, method: pay[0], reference: pay[1], via: 'phone' }); }
    requestLeave(job.id);
  });
  if (confirm) phase(at('12:28', 0.2), () => { as('ops'); confirmLeave(openTaskFor('job', job.id, 'leaveSite').id); });
  if (checkout) phase(at('12:32', 0.1), () => { as(tl); checkOut(job.id); });
  const j = store.get('jobs', job.id);
  setRaw('jobs', job.id, { workDone: { ...j.workDone, s1: { ...j.workDone.s1, timeIn: hhmm(j.steps.checkInAt), timeOut: j.steps.checkOutAt ? hhmm(j.steps.checkOutAt) : '' } } });
}

// ---------- The stories (oldest first, so the numbers run in date order) ----------
async function demoShutters() {
  T = 'co_dsh';
  const A = 'emp_co_dsh_3', B = 'emp_co_dsh_4';
  const sig = () => signature(3);
  let e, q, job, b;

  // 1. Invoice overdue and part paid, with a follow-up (Demo Retail, 15 days). Job documented, waiting for payment.
  e = phase({ days: -50, at: '09:30' }, () => newEnquiry('CUS-0003', B, 'Shop-front shutter guide rail hit by a trolley; shutter rubs.'));
  const s1 = await sig();
  phase({ days: -50, at: '11:30' }, () => fileReport(e, B, { picks: [['RS-1', 'Guide rail bent, shutter rubs']], mats: [['ITM-005', 3, 'RS-1'], ['ITM-001', 6, 'RS-1']], desc: 'Replace the bent guide rail on RS-1.' }, s1));
  q = phase({ days: -49, at: '10:00' }, () => makeQuote(e));
  phase({ days: -49, at: '14:00' }, () => decide(q));
  phase({ days: -49, at: '15:00' }, () => send(q));
  job = phase({ days: -47, at: '11:00' }, () => win(q, 'DR-PO-0412'));
  b = phase({ days: -45, at: '16:00' }, () => book(job, B, { days: -43 })); b.place();
  await visit(job, B, -43, { ratings: [5, 4, 5, 4], comments: 'Fixed quickly.' });
  phase({ days: -42, at: '10:00' }, () => { as('ops'); postInvoice(invoiceForJob(job.id).id); markDocumented(job.id); });
  phase({ days: -20, at: '15:00' }, () => { as('ops'); recordPayment({ invoiceId: invoiceForJob(job.id).id, amount: 150, method: 'CHEQUE', reference: 'CHQ 104233' }); });
  phase({ days: -6, at: '10:30' }, () => { as('ops'); addFollowUp(invoiceForJob(job.id).id, { method: 'Call', note: 'Accounts promised the balance this week', nextDate: dstr(when(3)) }); });

  // 2. Invoice due in 2 days (ABC Industries, 30 days), not documented yet.
  e = phase({ days: -34, at: '09:15' }, () => newEnquiry('CUS-0002', A, 'Loading bay 5 shutter drops when opened halfway.'));
  const s2 = await sig();
  phase({ days: -34, at: '11:00' }, () => fileReport(e, A, { picks: [['W-05', 'Springs tired, door drops']], mats: [['ITM-004', 2, 'W-05']], desc: 'Replace both springs on W-05.' }, s2));
  q = phase({ days: -33, at: '10:00' }, () => makeQuote(e));
  phase({ days: -33, at: '11:30' }, () => decide(q));
  phase({ days: -33, at: '12:00' }, () => send(q));
  job = phase({ days: -31, at: '09:30' }, () => win(q, 'ABC-PO-2210'));
  b = phase({ days: -30, at: '10:00' }, () => book(job, A, { days: -29 })); b.place();
  await visit(job, A, -29, { comments: 'Good job.' });
  phase({ days: -28, at: '09:00' }, () => { as('ops'); postInvoice(invoiceForJob(job.id).id); });

  // 3. Closed: the whole story, paid on site (Demo Cafe, immediate).
  e = phase({ days: -21, at: '08:50' }, () => newEnquiry('CUS-0006', B, 'Shop-front lock jammed, cannot open the cafe.', 'HIGH'));
  const s3 = await sig();
  phase({ days: -21, at: '10:20' }, () => fileReport(e, B, { picks: [['TP-1', 'Lock jammed']], mats: [['ITM-006', 1, 'TP-1']], desc: 'Replace the lock set on TP-1.' }, s3));
  q = phase({ days: -21, at: '11:00' }, () => makeQuote(e));
  phase({ days: -21, at: '11:40' }, () => decide(q));
  phase({ days: -21, at: '12:00' }, () => send(q));
  job = phase({ days: -20, at: '09:00' }, () => win(q, 'Signed quotation'));
  b = phase({ days: -20, at: '09:30' }, () => book(job, B, { days: -14 })); b.place();
  await visit(job, B, -14, { pay: ['PAYNOW', 'PayNow ref 7731 0021'], ratings: [5, 5, 5, 5], comments: 'Very professional.' });
  phase({ days: -13, at: '10:00' }, () => { as('ops'); markDocumented(job.id); });

  // 4. Work done, draft invoice to post; one line partly done (Island Demo Chemicals, Line costing, 15 days).
  e = phase({ days: -14, at: '09:40' }, () => newEnquiry('CUS-0005', B, 'Store room shutter jammed; workshop motorised shutter dead.'));
  const s4 = await sig();
  phase({ days: -14, at: '13:00' }, () => fileReport(e, B, { picks: [['JI-1', 'Jammed, guide rail bent'], ['JI-3', 'Motor burnt out']], mats: [['ITM-005', 6, 'JI-1'], ['ITM-002', 1, 'JI-3'], ['ITM-010', 1, 'JI-3']], desc: 'Straighten or replace the JI-1 guide rail; replace the JI-3 motor and remote.', s3: { days: 1, persons: 2 } }, s4));
  q = phase({ days: -12, at: '10:00' }, () => makeQuote(e, { line: true }));
  phase({ days: -12, at: '15:00' }, () => decide(q));
  phase({ days: -12, at: '16:00' }, () => send(q));
  job = phase({ days: -10, at: '10:00' }, () => win(q, 'IDC-PO-5531'));
  b = phase({ days: -9, at: '11:00' }, () => book(job, B, { days: -7 })); b.place();
  await visit(job, B, -7, { rows: { 1: ['PARTLY', 'Motor fitted; remote control not paired yet'] }, ratings: [4, 4, 5, 4], comments: 'Please come back to pair the remote.' });

  // 5. Rejected: the customer chose another vendor (Changi Demo Logistics).
  e = phase({ days: -12, at: '14:00' }, () => newEnquiry('CUS-0004', A, 'Office back door shutter noisy and stiff.'));
  const s5 = await sig();
  phase({ days: -11, at: '10:30' }, () => fileReport(e, A, { picks: [['CG-3', 'Noisy and stiff, needs servicing']], mats: [['ITM-009', 2, 'CG-3']], desc: 'Clean, lubricate and adjust CG-3.' }, s5));
  q = phase({ days: -10, at: '10:00' }, () => makeQuote(e));
  phase({ days: -10, at: '11:00' }, () => decide(q));
  phase({ days: -10, at: '11:30' }, () => send(q));
  phase({ days: -6, at: '16:00' }, () => { as('ops'); reject(q.id, 'Customer chose another vendor'); });

  // 6. Sent, waiting for the customer; expires in 2 days (Demo Retail, 15 days).
  e = phase({ days: -7, at: '09:00' }, () => newEnquiry('CUS-0003', B, 'Shop-front lock broken and bottom bar bent.'));
  const s6 = await sig();
  phase({ days: -7, at: '11:15' }, () => fileReport(e, B, { picks: [['RS-1', 'Lock broken, bottom bar bent']], mats: [['ITM-006', 1, 'RS-1'], ['ITM-007', 4.2, 'RS-1']], desc: 'Replace the lock set and the bottom bar on RS-1.' }, s6));
  q = phase({ days: -6, at: '10:00' }, () => makeQuote(e));
  phase({ days: -5, at: '09:30' }, () => decide(q));
  phase({ days: -5, at: '10:00' }, () => send(q));

  // 7. Job to schedule; the motor is on order (ABC Industries, 30 days approved at the counter-check).
  e = phase({ days: -6, at: '10:00' }, () => newEnquiry('CUS-0002', A, 'Loading bay 12 motorised shutter does not respond.', 'HIGH'));
  const s7 = await sig();
  phase({ days: -6, at: '14:00' }, () => fileReport(e, A, { picks: [['W-12', 'Motor does not respond']], mats: [['ITM-003', 1, 'W-12']], desc: 'Replace the 400 kg single phase motor on W-12.' }, s7));
  q = phase({ days: -4, at: '10:00' }, () => makeQuote(e));
  phase({ days: -4, at: '11:00' }, () => decide(q));
  phase({ days: -4, at: '11:30' }, () => send(q));
  phase({ days: -1, at: '15:00' }, () => win(q, 'ABC-PO-2291'));

  // 8. On site now: Technician B has finished and is waiting for the office's OK to leave (Demo Cafe, paid on site).
  e = phase({ days: -4, at: '09:20' }, () => newEnquiry('CUS-0006', B, 'Side entrance collapsible gate very stiff.'));
  const s8 = await sig();
  phase({ days: -4, at: '11:00' }, () => fileReport(e, B, { picks: [['TP-2', 'Gate stiff, rollers dry']], mats: [['ITM-009', 1, 'TP-2']], desc: 'Clean and lubricate the TP-2 gate rollers.' }, s8));
  q = phase({ days: -3, at: '10:00' }, () => makeQuote(e));
  phase({ days: -3, at: '10:30' }, () => decide(q));
  phase({ days: -3, at: '11:00' }, () => send(q));
  job = phase({ days: -2, at: '09:00' }, () => win(q, 'Signed quotation'));
  phase({ hoursAgo: 5 }, () => book(job, B));
  const st = new Date(Date.now() - 3.5 * 3600000);
  setRaw('jobs', job.id, { start: st.toISOString(), end: new Date(st.getTime() + jobDuration(store.get('jobs', job.id)) * 3600000).toISOString() });
  setRaw('invoices', invoiceForJob(job.id).id, { dueDate: dstr(st) });
  await visit(job, B, 0, { now: true, pay: ['CASH', 'Cash received'], confirm: false, checkout: false, comments: 'Gate runs smoothly now.' });

  // 9. Level 2: a big quotation the Approver has approved, now waiting for Management (Island Demo Chemicals).
  e = phase({ days: -3, at: '09:00' }, () => newEnquiry('CUS-0005', B, 'Fire exit shutter slats badly corroded; replace the curtain.'));
  const s9 = await sig();
  phase({ days: -3, at: '14:00' }, () => fileReport(e, B, { picks: [['JI-2', 'Slats corroded, curtain to replace']], mats: [['ITM-008', 120, 'JI-2'], ['ITM-007', 8, 'JI-2']], desc: 'Replace the JI-2 curtain slats and bottom bar; scissor lift for 2 days.', s3: { persons: 3, days: 2 }, s4: { scissor: true, scissorNos: 1, maxHeight: 6, providedBy: 'Contractor' } }, s9));
  q = phase({ days: -1, at: '10:00' }, () => makeQuote(e));
  phase({ days: -1, at: '16:00' }, () => decide(q));

  // 10. Approved, ready to send (ABC Industries, 30 days: the counter-check approved the term too).
  e = phase({ days: -3, at: '11:00' }, () => newEnquiry('CUS-0002', A, 'Loading bays 7 and 8: shutters drop, one lock broken.'));
  const s10 = await sig();
  phase({ days: -3, at: '15:00' }, () => fileReport(e, A, { picks: [['W-07', 'Springs tired, lock broken'], ['W-08', 'Springs tired']], mats: [['ITM-004', 2, 'W-07'], ['ITM-006', 1, 'W-07'], ['ITM-004', 2, 'W-08']], desc: 'Replace the springs on W-07 and W-08 and the W-07 lock.' }, s10));
  q = phase({ days: -1, at: '11:00' }, () => makeQuote(e, { line: true }));
  phase({ hoursAgo: 3 }, () => decide(q));

  // 11. Scheduled for Technician A, invoice raised at scheduling (ABC Industries; the customer asked to pay on completion).
  e = phase({ days: -3, at: '13:00' }, () => newEnquiry('CUS-0002', A, 'Loading bay 2 shutter noisy.'));
  const s11 = await sig();
  phase({ days: -2, at: '10:00' }, () => fileReport(e, A, { picks: [['W-02', 'Noisy, needs adjusting']], mats: [['ITM-009', 1, 'W-02']], desc: 'Adjust and lubricate W-02.' }, s11));
  q = phase({ days: -2, at: '14:00' }, () => makeQuote(e));
  phase({ days: -2, at: '15:00' }, () => decide(q));
  phase({ days: -2, at: '15:30' }, () => send(q));
  job = phase({ hoursAgo: 4 }, () => win(q, 'ABC-PO-2302', 'IMMEDIATE'));
  book(job, A);

  // 12. Waiting for the Approver's counter-check (Demo Cafe, immediate).
  e = phase({ days: -2, at: '16:30' }, () => newEnquiry('CUS-0006', B, 'Shop-front shutter very heavy to lift.'));
  const s12 = await sig();
  phase({ days: -1, at: '10:00' }, () => fileReport(e, B, { picks: [['TP-1', 'Spring broken, very heavy']], mats: [['ITM-004', 2, 'TP-1'], ['ITM-009', 1, 'TP-1']], desc: 'Replace both springs on TP-1 and lubricate.' }, s12));
  q = phase({ hoursAgo: 2 }, () => makeQuote(e));

  // 13. Estimate being prepared (Changi Demo Logistics, Line costing).
  e = phase({ days: -1, at: '09:10' }, () => newEnquiry('CUS-0004', A, 'Loading bay doors: bay 1 drops, bay 2 motor overheats.', 'HIGH'));
  const s13 = await sig();
  phase({ days: -1, at: '13:30' }, () => fileReport(e, A, { picks: [['CG-1', 'Lift cable snapped, door drops'], ['CG-2', 'Motor overheats and stops']], mats: [['ITM-005', 4, 'CG-1'], ['ITM-002', 1, 'CG-2']], desc: 'Replace the CG-1 guide rails and the CG-2 motor.', s3: { persons: 3 }, s4: { scissor: true, scissorNos: 1, maxHeight: 5, providedBy: 'Contractor' } }, s13));
  phase({ hoursAgo: 1 }, () => { as('ops'); const est = createEstimate(e.id); saveEstimate(est.id, { costingLevel: 'LINE' }); });
}

// Gulf Demo Doors: one quotation waiting for the counter-check (the company's Admin sees it in the task bell).
async function gulf() {
  T = 'co_gdd';
  const sig = await signature(4);
  const e = phase({ days: -1, at: '10:00' }, () => newEnquiry('CUS-0001', 'emp_co_gdd_1', 'Gate 2 motorised shutter makes a loud noise and stops halfway.', 'HIGH'));
  phase({ days: -1, at: '13:00' }, () => fileReport(e, 'emp_co_gdd_1', { picks: [['D-2', 'Motor bearing worn, loud noise']], mats: [['ITM-002', 1, 'D-2']], desc: 'Replace the D-2 motor.' }, sig));
  phase({ hoursAgo: 2 }, () => makeQuote(e));
}

export async function buildDemoFlow() {
  store.holdWrites(true);
  try {
    auth.login('usr_co_dsh_ops', 'web');
    await demoShutters();
    auth.login('usr_co_gdd_gadmin', 'web');
    await gulf();
    await buildAmcSamples();
  } finally {
    auth.logout();
    store.holdWrites(false);
  }
}
