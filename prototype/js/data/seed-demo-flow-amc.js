// Stage samples for AMC and General Servicing: one at every step, so each can be tried without doing the steps before
// it. Each story runs the real rules (core/) at a past moment ("at": the clock is moved back while the step runs), so
// dates, numbers, visits, instalments, tasks and the register are what the rules would have made. Runs after the
// Stretch 2 samples, on first load and on "Reset demo data".
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { saveNewEnquiry } from '../core/enquiries.js';
import { createEstimate, saveEstimate } from '../core/estimates.js';
import { addSiteTo, describe } from '../core/amc-estimates.js';
import { createFromEstimate, submitForCheck, decideQuotation, markSent, accept } from '../core/quotations.js';
import { openTaskFor } from '../core/workflow.js';
import { activateContract, refreshAmc, visitsOf, addMonths, addDays, todayStr } from '../core/contracts.js';
import { postInvoice, recordPayment } from '../core/billing.js';
import { scheduleVisit, confirmVisitDate, startTravel, arrive, saveSvc, allPass, setItem, finishService, leaveSite, fileVisit, workingDays } from '../core/visits.js';
import { freeStart, nextWorkday, scheduleJob, jobDuration, defaultHelper } from '../core/jobs.js';
import { signature, stamp, photo } from './seed-demo-flow.js';

let T = '';
const as = login => store.setContext({ tenantId: T, userId: T === 'co_gdd' ? 'usr_co_gdd_gadmin' : `usr_${T}_${login}` });
const cust = code => store.findOne('customers', c => c.code === code);
const TECH = { A: 'emp_co_dsh_3', B: 'emp_co_dsh_4' };
const LOGIN = { emp_co_dsh_3: 'techA', emp_co_dsh_4: 'techB' };

// Run fn as if it were that moment: every "now" in the rules (dates, numbers, history) reads the moved clock.
function at(when, fn) {
  const Real = Date, off = when.getTime() - Real.now();
  class Moved extends Real { constructor(...a) { super(...(a.length ? a : [Real.now() + off])); } static now() { return Real.now() + off; } }
  globalThis.Date = Moved;
  try { return fn(); } finally { globalThis.Date = Real; }
}
const on = (ds, hhmm = '09:00') => new Date(`${ds}T${hhmm}:00`);
const ago = (days, hhmm = '10:00') => on(addDays(todayStr(), -days), hhmm);

// ---------- Story steps ----------
function enquiry(code, type, text, siteIdx = 0) {
  as('ops');
  const c = cust(code), con = c.contacts[0];
  return saveNewEnquiry({ receivedAt: new Date().toISOString(), channel: 'EMAIL', channelOther: '', type, enquiryStatus: 'WARM', priority: 'MEDIUM', siteInspection: 'NO',
    recordedBy: `usr_${T}_${T === 'co_gdd' ? 'gadmin' : 'ops'}`, remarks: '', attachments: [], customerId: c.id, contactId: con.id, contactName: con.name, mobile: con.mobile, email: con.email,
    siteId: c.sites[siteIdx].id, lines: [{ itemRef: '', itemName: '', qty: null, description: text }] });
}
// The estimate with its sites' visits and the billing plan; extra: more sites of the customer (site indexes).
function estimate(enq, { visits, billing, extra = [] } = {}) {
  as('ops');
  let est = createEstimate(enq.id);
  const c = store.get('customers', est.customerId);
  extra.forEach(i => { est = addSiteTo(est, c.sites[i].id); });
  const draft = { ...est, sites: est.sites.map(s => ({ ...s, visits: visits ?? s.visits })), billing: billing ?? est.billing };
  draft.header = { ...draft.header, description: describe(draft) };
  saveEstimate(est.id, draft);
  return store.get('estimates', est.id);
}
function quote(est) { as('ops'); const q = createFromEstimate(est.id); submitForCheck(q.id); return store.get('quotations', q.id); }
function approveAll(q) {
  for (let t = openTaskFor('quotation', q.id); t; t = openTaskFor('quotation', q.id)) { as(t.roleCode === 'MGT' ? 'mgmt' : 'approver'); decideQuotation(t.id, 'approve', ''); }
  return store.get('quotations', q.id);
}
const send = q => { as('ops'); markSent(q.id, 'Email'); };
const win = (q, po) => { as('ops'); return accept(q.id, { method: 'PO', poNo: po, poDate: todayStr(), contact: q.contact, attachments: [] }); };

// Book a visit for the zone's technician on its planned date (or the next free working day), 09:00 if free.
function book(v, tech, date = v.plannedDate, via = 'Phone') {
  as('ops');
  for (const ds of workingDays(date, 6)) {
    const start = freeStart(tech, ds, Math.min(8.5, (v.workHours / (v.days || 1)) + v.travelHours), v.id);
    if (start == null) continue;
    const r = scheduleVisit(v.id, { technicianId: tech, helperIds: [defaultHelper(tech)?.id].filter(Boolean), date: ds, start, via });
    if (!r.problems.length) return ds;
  }
  console.warn('Sample visit could not be booked', v.reportNo);
  return null;
}
// The technician's visit on the phone: all pass, except the given failures [[tag, item code, note, part code]].
function serve(coll, id, pics, fails = []) {
  const d = store.get(coll, id);
  as(LOGIN[d.technicianId]);
  startTravel(coll, id); arrive(coll, id);
  saveSvc(coll, id, { safeIsolation: true });
  d.shutters.forEach(sh => {
    fails.filter(f => f[0] === sh.tag).forEach(([, code, note, part]) => setItem(coll, id, sh.shutterId, code,
      { r: 'F', note, photoId: pics.fail, itemId: part ? store.findOne('items', i => i.code === part)?.id || '' : '', qty: part ? 2 : 1 }));
    allPass(coll, id, sh.shutterId);
  });
  const key = coll === 'jobs' ? 'workDone' : 'signoff';
  const s = store.get(coll, id)[key];
  saveSvc(coll, id, { [key]: { ...s, ratings: { punctuality: 5, quality: 5, staff: 5, overall: 4 + (fails.length ? 0 : 1) }, tech: { ...s.tech, signatureId: pics.tech }, cust: { ...s.cust, signatureId: pics.cust, stampId: pics.stamp } } });
  const r = finishService(coll, id);
  if (r.problems?.length) console.warn('Sample sign-off refused', r.problems);
  leaveSite(coll, id);
}
// Each instalment on its bill date: drafted (daily check), posted; paid "paidAfter" days later.
function bill(c, lineNo, paidAfter, method = 'BANK') {
  const line = store.get('contracts', c.id).billingPlan.find(l => l.n === lineNo);
  at(on(line.billDate, '08:30'), () => { as('ops'); refreshAmc(); const l = store.get('contracts', c.id).billingPlan.find(x => x.n === lineNo); if (l.invoiceId) postInvoice(l.invoiceId); });
  if (paidAfter == null) return;
  at(on(addDays(line.billDate, paidAfter), '11:00'), () => {
    as('ops');
    const inv = store.get('invoices', store.get('contracts', c.id).billingPlan.find(l => l.n === lineNo).invoiceId);
    recordPayment({ invoiceId: inv.id, amount: inv.total, method, reference: `${method === 'PAYNOW' ? 'PN' : 'TT'} ${inv.no}` });
  });
}
// A contract from enquiry to activation, ending with start = the given date.
function contract(code, { start, visits, billing, extra = [], po, text }) {
  const enq = at(on(addDays(start, -25)), () => enquiry(code, 'AMC', text));
  const q = at(on(addDays(start, -23)), () => quote(estimate(enq, { visits, billing, extra })));
  at(on(addDays(start, -22), '15:00'), () => { approveAll(q); send(q); });
  const r = at(on(addDays(start, -15)), () => win(q, po));
  at(on(addDays(start, -14)), () => { as('ops'); activateContract(r.contract.id, { start }); });
  return store.get('contracts', r.contract.id);
}
// Visits 1…n of a site done on their planned dates (booked 4 days before, filed 2 days after).
function doVisits(c, siteKey, tech, upTo, pics, failsOn = {}) {
  visitsOf(c.id).filter(v => v.siteKey === siteKey && v.n <= upTo).forEach(v => {
    const ds = at(on(addDays(v.plannedDate, -4)), () => book(v, tech));
    if (!ds) return;
    at(on(ds, '09:05'), () => serve('amcVisits', v.id, pics, failsOn[v.n] || []));
    at(on(addDays(ds, 2), '10:00'), () => { as('ops'); fileVisit(v.id); });
  });
}

async function demoShuttersAmc() {
  T = 'co_dsh';
  const pics = { tech: await signature(2), cust: await signature(5), stamp: await stamp('Customer stamp'), fail: await photo('Failed item', '#8A5A44') };
  const t = todayStr();

  // 2. AMC estimate being prepared (Changi Demo Logistics, monthly billing).
  const e2 = at(ago(1, '10:20'), () => enquiry('CUS-0004', 'AMC', 'AMC for the three loading-bay doors; please quote quarterly visits.'));
  at(ago(0, '08:40'), () => estimate(e2, { visits: 4, billing: 'MONTHLY' }));

  // 3. AMC quotation waiting for the counter-check (Demo Retail, 15-day term).
  const e3 = at(ago(3, '14:00'), () => enquiry('CUS-0003', 'AMC', 'Yearly maintenance for the shop-front shutter.'));
  at(ago(1, '11:00'), () => quote(estimate(e3, { visits: 4, billing: 'MONTHLY' })));

  // 4. AMC quotation sent, waiting for the PO (Demo Bakery, immediate, quarterly).
  const e4 = at(ago(6, '09:30'), () => enquiry('CUS-0007', 'AMC', 'Maintenance contract for the bakery front and back shutters.'));
  const q4 = at(ago(5, '10:00'), () => quote(estimate(e4, { visits: 2, billing: 'QUARTERLY' })));
  at(ago(4, '15:00'), () => { approveAll(q4); send(q4); });

  // 5. PO received: the contract is a draft to activate (Demo Food Factory, quarterly).
  const e5 = at(ago(12, '09:00'), () => enquiry('CUS-0008', 'AMC', 'AMC for the two loading bays, cold room and dry store.'));
  const q5 = at(ago(10, '10:00'), () => quote(estimate(e5, { visits: 4, billing: 'QUARTERLY' })));
  at(ago(9, '15:00'), () => { approveAll(q5); send(q5); });
  at(ago(2, '16:00'), () => win(q5, 'DFF-PO-5512'));

  // 6. Active for 3 months: monthly visits at two sites (Zones C and B), visit 4 to confirm, instalment 4 drafted today.
  const s6 = addMonths(t, -3);
  const c6 = contract('CUS-0009', { start: s6, visits: 12, billing: 'MONTHLY', extra: [1], po: 'MDM-PO-0918', text: 'Monthly maintenance for the mall and the Changi outlet shutters.' });
  doVisits(c6, c6.sites[0].key, TECH.B, 3, pics);
  doVisits(c6, c6.sites[1].key, TECH.A, 3, pics);
  [1, 2, 3].forEach(n => bill(c6, n, 25));
  const v6 = visitsOf(c6.id).find(v => v.siteKey === c6.sites[1].key && v.n === 4);
  at(ago(1, '15:00'), () => { as('ops'); confirmVisitDate(v6.id, { date: addDays(v6.plannedDate, 2), via: 'WhatsApp' }); });

  // 7. Active, quarterly: visit 1 found worn springs (repair enquiry waiting for an estimate); visit 2 booked for the
  // next working day at the customer's request; instalment 2 drafted today.
  const s7 = addMonths(t, -3);
  const c7 = contract('CUS-0005', { start: s7, visits: 4, billing: 'QUARTERLY', po: 'IDC-PO-2207', text: 'Quarterly maintenance of the plant shutters (JI-2 is a fire shutter).' });
  doVisits(c7, c7.sites[0].key, TECH.B, 1, pics, { 1: [['JI-2', 'SPRINGS', 'Springs worn; curtain drops fast', 'ITM-004']] });
  bill(c7, 1, 13, 'PAYNOW');
  const v7 = visitsOf(c7.id).find(v => v.n === 2);
  const next = nextDay();
  at(ago(2, '16:00'), () => book(v7, TECH.B, next, 'WhatsApp'));

  // 8. Ends in 43 days: the renewal reminder is due; visit 4 was moved by the customer and is now overdue.
  const s8 = addDays(addMonths(t, -12), 43);
  const c8 = contract('CUS-0001', { start: s8, visits: 4, billing: 'HALF', po: 'KMS-PO-1187', text: 'Quarterly servicing of the two shop shutters.' });
  doVisits(c8, c8.sites[0].key, TECH.A, 3, pics);
  [[1, 3], [2, 5]].forEach(([n, d]) => bill(c8, n, d, 'PAYNOW'));
  const v8 = visitsOf(c8.id).find(v => v.n === 4);
  at(on(addDays(v8.plannedDate, -3)), () => { as('ops'); confirmVisitDate(v8.id, { date: addDays(v8.plannedDate, 21), via: 'Phone' }); });

  // 9. General Servicing walkthrough: BOQ study (Demo Cafe, immediate payment).
  at(ago(1, '15:30'), () => enquiry('CUS-0006', 'GS', 'General servicing of both shutters before the festive season.'));

  // 10. GS job scheduled for Technician A (Changi Demo Logistics, 30-day term).
  const e10 = at(ago(6, '11:00'), () => enquiry('CUS-0004', 'GS', 'One-off servicing of the three bay doors.'));
  const q10 = at(ago(5, '10:00'), () => quote(estimate(e10)));
  at(ago(4, '14:00'), () => { approveAll(q10); send(q10); });
  const j10 = at(ago(2, '10:00'), () => win(q10, 'CDL-PO-3301').job);
  at(ago(1, '16:00'), () => {
    as('ops');
    const j = store.get('jobs', j10.id), hours = jobDuration(j);
    const date = workingDays(next, 5).find(ds => freeStart(TECH.A, ds, hours, j.id) != null);
    scheduleJob(j.id, { technicianId: TECH.A, helperIds: [defaultHelper(TECH.A)?.id].filter(Boolean), date, start: freeStart(TECH.A, date, hours, j.id), hours });
  });

  // 11. GS job done: draft invoice to post; one failed item became a repair enquiry (Demo Retail, 15 days).
  const e11 = at(ago(20, '09:00'), () => enquiry('CUS-0003', 'GS', 'Please service the shop-front shutter; it is getting noisy.'));
  const q11 = at(ago(19, '10:00'), () => quote(estimate(e11)));
  at(ago(18, '14:00'), () => { approveAll(q11); send(q11); });
  const j11 = at(ago(16, '10:00'), () => win(q11, 'DR-PO-0077').job);
  const d11 = addDays(t, -8);
  at(ago(10, '15:00'), () => { as('ops'); const j = store.get('jobs', j11.id), hours = jobDuration(j); scheduleJob(j.id, { technicianId: TECH.B, helperIds: [], date: d11, start: freeStart(TECH.B, d11, hours, j.id) ?? 9, hours }); });
  at(on(d11, '09:05'), () => serve('jobs', j11.id, pics, [['RS-1', 'GUIDES', 'Left guide rail bent at the bottom', 'ITM-005']]));

  at(new Date(), () => { as('ops'); refreshAmc(); });
}
const nextDay = () => { const d = nextWorkday(new Date(`${todayStr()}T00:00`)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Gulf Demo Doors: an AMC estimate in AED with VAT 5 %.
function gulfAmc() {
  T = 'co_gdd';
  const e = at(ago(1, '10:00'), () => enquiry('CUS-0001', 'AMC', 'AMC for both warehouse gates.'));
  at(ago(0, '08:30'), () => estimate(e, { visits: 4, billing: 'QUARTERLY' }));
}

// The logged-in company decides tax and defaults (Company Setup), so each company's stories run under its own login.
export async function buildAmcSamples() {
  auth.login('usr_co_dsh_ops', 'web');
  await demoShuttersAmc();
  auth.login('usr_co_gdd_gadmin', 'web');
  gulfAmc();
}
