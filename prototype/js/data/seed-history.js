// Sample history for the dashboards (Stretch 3 Part B): about 30 finished jobs over the past 12 months, across the
// four zones and both technicians: repairs and General Servicing, some quotations lost, the latest invoices not yet
// paid. Each step runs the real rules at its past moment (the moved clock of the AMC samples), so numbers, statuses,
// ratings, invoices and payments are what the rules would have made. It runs after the stage samples, so these
// documents get the next numbers of their year (not in date order) and the known sample numbers stay the same.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { openTaskFor } from '../core/workflow.js';
import { decideQuotation, reject } from '../core/quotations.js';
import { onMyWay, checkIn, saveJob, completeWorkDone, requestLeave, confirmLeave, checkOut, jobDuration, freeStart, scheduleJob, defaultHelper } from '../core/jobs.js';
import { invoiceForJob, postInvoice, recordPayment, balanceOf } from '../core/billing.js';
import { markDocumented } from '../core/closure.js';
import { todayStr, addDays } from '../core/contracts.js';
import { workingDays } from '../core/visits.js';
import { termDays } from '../core/costing.js';
import { as, useTenant, newEnquiry, fileReport, makeQuote, send, win, book, signature, stamp, photo } from './seed-demo-flow.js';
import { at, useAmcTenant, enquiry, estimate, quote, serve } from './seed-demo-flow-amc.js';

const A = 'emp_co_dsh_3', B = 'emp_co_dsh_4';
const LOGIN = { [A]: 'techA', [B]: 'techB' };
const on = (ds, hhmm = '09:00') => new Date(`${ds}T${hhmm}:00`);
const day = n => addDays(todayStr(), -n);

// [customer, technician, shutter, fault, [item, qty], what to do]
const REPAIRS = [
  ['CUS-0001', A, 'RS-2', 'Springs worn, door heavy', ['ITM-004', 2], 'Replace both springs on RS-2.'],
  ['CUS-0002', A, 'W-03', 'Guide rail bent by a forklift', ['ITM-005', 3], 'Replace the bent guide rail on W-03.'],
  ['CUS-0003', B, 'RS-1', 'Lock jammed, shutter cannot be locked', ['ITM-006', 1], 'Replace the lock set on RS-1.'],
  ['CUS-0004', A, 'CG-1', 'Slats dented at the bottom', ['ITM-008', 4], 'Replace the dented slats on CG-1.'],
  ['CUS-0005', B, 'JI-1', 'Springs tired, door drops', ['ITM-004', 2], 'Replace both springs on JI-1.'],
  ['CUS-0006', B, 'TP-1', 'Remote control not working', ['ITM-010', 1], 'Replace the remote control of TP-1.'],
  ['CUS-0007', A, 'BK-1', 'Guide rail loose', ['ITM-005', 2], 'Refix and replace the guide rail on BK-1.'],
  ['CUS-0009', B, 'MB-1', 'Bottom bar bent', ['ITM-007', 3], 'Replace the bottom bar on MB-1.'],
  ['CUS-0002', A, 'W-08', 'Bottom bar damaged', ['ITM-007', 3], 'Replace the bottom bar on W-08.'],
  ['CUS-0001', A, 'RS-1', 'Motor hums but does not lift', ['ITM-003', 1], 'Replace the RS-1 motor (400 kg single phase).'],
];
// General Servicing: [customer, technician]
const SERVICES = [['CUS-0006', B], ['CUS-0008', A], ['CUS-0004', A], ['CUS-0003', B]];

let pics = null;
const RATINGS = [[5, 5, 5, 5], [5, 4, 5, 4], [4, 4, 5, 4], [5, 5, 4, 5], [5, 5, 5, 4]];

// Pay an invoice "after" days after its date, if that day has come.
function payLater(jobId, after, k) {
  const inv = invoiceForJob(jobId);
  if (!inv?.no || balanceOf(inv) <= 0) return;
  const d = addDays(inv.date, after);
  if (d >= todayStr()) return;
  at(on(d, '11:00'), () => { as('ops'); recordPayment({ invoiceId: inv.id, amount: balanceOf(inv), method: k % 2 ? 'BANK' : 'CHEQUE', reference: `${k % 2 ? 'TT' : 'CHQ'} ${inv.no}` }); });
}
// Post the invoice the day after the visit and file the job (it closes itself once paid).
function postAndFile(jobId, ds) {
  at(on(addDays(ds, 1), '10:00'), () => { as('ops'); const inv = invoiceForJob(jobId); if (inv?.status === 'Draft') postInvoice(inv.id); markDocumented(jobId); });
}

function repairStory(k, startDay, lost) {
  const [code, tech, tag, fault, [item, qty], desc] = REPAIRS[k % REPAIRS.length];
  const d0 = day(startDay);
  const e = at(on(d0, '09:20'), () => newEnquiry(code, tech, `${tag}: ${fault.toLowerCase()}.`));
  at(on(d0, '13:10'), () => fileReport(e, tech, { picks: [[tag, fault]], mats: [[item, qty, tag]], desc }, pics.tech, pics.cust));
  const q = at(on(addDays(d0, 1), '10:00'), () => makeQuote(e));
  at(on(addDays(d0, 1), '14:00'), () => { for (let t = openTaskFor('quotation', q.id); t; t = openTaskFor('quotation', q.id)) { as(t.roleCode === 'MGT' ? 'mgmt' : 'approver'); decideQuotation(t.id, 'approve', ''); } });
  at(on(addDays(d0, 1), '15:00'), () => send(store.get('quotations', q.id)));
  if (lost) { at(on(addDays(d0, 5), '10:00'), () => { as('ops'); reject(q.id, 'Customer chose another contractor'); }); return; }
  const job = at(on(addDays(d0, 3), '11:00'), () => win(store.get('quotations', q.id), `PO-H${String(k + 1).padStart(3, '0')}`));
  if (!job) return;
  at(on(addDays(d0, 4), '09:30'), () => book(job, tech));
  const ds = store.get('jobs', job.id).start?.slice(0, 10);
  if (!ds || ds >= todayStr()) return;
  const tl = LOGIN[tech];
  at(on(ds, '08:40'), () => { as(tl); onMyWay(job.id); });
  at(on(ds, '09:05'), () => { as(tl); checkIn(job.id); saveJob(job.id, { photosBefore: [pics.before] }); });
  at(on(ds, '12:20'), () => {
    as(tl);
    const w = structuredClone(store.get('jobs', job.id).workDone);
    const [p, qy, s, o] = RATINGS[k % RATINGS.length];
    Object.assign(w, { ratings: { punctuality: p, quality: qy, staff: s, overall: o }, comments: '', worksAt: new Date().toISOString() });
    w.tech.signatureId = pics.tech; w.cust.signatureId = pics.cust; w.cust.stampId = pics.stamp;
    saveJob(job.id, { workDone: w, photosAfter: [pics.after] });
    completeWorkDone(job.id);
    const inv = invoiceForJob(job.id);
    if (inv?.status === 'Posted' && inv.paymentTerm === 'IMMEDIATE') recordPayment({ invoiceId: inv.id, amount: inv.total, method: 'PAYNOW', reference: `PayNow ${inv.no}`, via: 'phone' });
    requestLeave(job.id);
  });
  at(on(ds, '12:30'), () => { as('ops'); const t = openTaskFor('job', job.id, 'leaveSite'); if (t) confirmLeave(t.id); });
  at(on(ds, '12:35'), () => { as(tl); checkOut(job.id); });
  postAndFile(job.id, ds);
  const j = store.get('jobs', job.id);
  payLater(job.id, termDays(j.paymentTerm) + (k % 3) * 4, k);
}

function serviceStory(k, startDay) {
  const [code, tech] = SERVICES[k % SERVICES.length];
  const d0 = day(startDay);
  const e = at(on(d0, '10:00'), () => enquiry(code, 'GS', 'One-off servicing of the shutters.'));
  const q = at(on(addDays(d0, 1), '10:00'), () => quote(estimate(e)));
  at(on(addDays(d0, 1), '14:00'), () => { for (let t = openTaskFor('quotation', q.id); t; t = openTaskFor('quotation', q.id)) { as(t.roleCode === 'MGT' ? 'mgmt' : 'approver'); decideQuotation(t.id, 'approve', ''); } send(store.get('quotations', q.id)); });
  const job = at(on(addDays(d0, 3), '11:00'), () => win(store.get('quotations', q.id), `PO-S${String(k + 1).padStart(3, '0')}`));
  if (!job) return;
  let ds = null;
  at(on(addDays(d0, 4), '09:30'), () => {
    as('ops');
    const j = store.get('jobs', job.id), hours = jobDuration(j);
    ds = workingDays(addDays(d0, 6), 6).find(x => freeStart(tech, x, hours, j.id) != null);
    if (ds) scheduleJob(j.id, { technicianId: tech, helperIds: [defaultHelper(tech)?.id].filter(Boolean), date: ds, start: freeStart(tech, ds, hours, j.id), hours });
  });
  if (!ds || ds >= todayStr()) return;
  at(on(ds, '09:05'), () => {
    serve('jobs', job.id, pics);
    const inv = invoiceForJob(job.id);
    if (inv?.status === 'Posted' && inv.paymentTerm === 'IMMEDIATE') { as(LOGIN[tech]); recordPayment({ invoiceId: inv.id, amount: inv.total, method: 'PAYNOW', reference: `PayNow ${inv.no}`, via: 'phone' }); }
  });
  postAndFile(job.id, ds);
  payLater(job.id, termDays(store.get('jobs', job.id).paymentTerm) + 3, k);
}

export async function buildHistory() {
  // Log in to Demo Shutters: tax, letterhead, terms and the working week come from the logged-in company.
  auth.login('usr_co_dsh_ops', 'web');
  useTenant('co_dsh'); useAmcTenant('co_dsh');
  pics = { tech: await signature(5), cust: await signature(6), stamp: await stamp('Customer'), before: await photo('Before', '#7E93A8'), after: await photo('After', '#5E8A5A'), fail: await photo('Fault', '#A86A5E') };
  // Oldest first, about one story every 11 days from 330 to 25 days ago; every sixth quotation is lost;
  // every fourth story is a General Servicing job.
  for (let k = 0, d = 330; d >= 25; k++, d -= 11) {
    try {
      if (k % 4 === 3) serviceStory(Math.floor(k / 4), d);
      else repairStory(k, d, k % 6 === 5);
    } catch (e) { console.warn('History story', k, 'stopped:', e.message); }
  }
}
