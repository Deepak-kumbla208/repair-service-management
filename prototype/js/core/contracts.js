// AMC contracts. Accepting an AMC quotation creates the contract as a Draft (menu sheet: "created once the customer PO
// is approved"). "Activate" needs only the acceptance and a start date (flow step 6: a signed contract document is
// optional) and creates the year's visit plan and billing plan. Invoices come only from the billing plan, never from
// visits. A daily check drafts invoices on their bill dates, opens a "Renew" task before the end, and ends and closes
// contracts. Renew makes a new AMC enquiry with an estimate pre-filled from the contract.
import * as store from './store.js';
import * as auth from './auth.js';
import { findSite, productName } from './lookups.js';
import { amcSiteRow } from './costing.js';
import { amcDefaults } from './amc-estimates.js';
import { createEstimate } from './estimates.js';
import { saveNewEnquiry } from './enquiries.js';
import { makeShutter, nextShutterTag, addShutters } from './customers.js';
import { openTask, closeTask, cancelTasksFor } from './workflow.js';
import { createContractInvoice, balanceOf } from './billing.js';
import { fmtDate } from './ui.js';

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => dstr(new Date());
export const addDays = (ds, n) => { const d = new Date(`${ds}T00:00`); d.setDate(d.getDate() + n); return dstr(d); };
// Calendar months (31 Jan + 1 month = 28 / 29 Feb).
export function addMonths(ds, n) {
  const d = new Date(`${ds}T00:00`), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return dstr(d);
}
export const firstOfNextMonth = () => { const d = new Date(); return dstr(new Date(d.getFullYear(), d.getMonth() + 1, 1)); };
export const contractEnd = (start, months) => addDays(addMonths(start, months), -1);
const offSunday = ds => (new Date(`${ds}T00:00`).getDay() === 0 ? addDays(ds, 1) : ds);
// Start of period k of n in a contract year (months when they divide evenly, else days).
const periodStart = (start, months, n, k) => (months % n === 0 ? addMonths(start, (months / n) * k) : addDays(start, Math.round((k * 365 * months) / (12 * n))));

export const LIVE = ['Active'];
export const ENDED = ['Expired', 'Renewed', 'Terminated'];
// Visits can still be booked after the end (a visit the contract still owes); invoices are still drafted for due lines.
export const BOOKABLE = ['Active', 'Expired', 'Renewed'];
const BILLED = ['Active', ...ENDED];
export const contractFor = enqId => store.list('contracts', c => c.enquiryId === enqId && c.status !== 'Cancelled')[0] || null;
export const visitsOf = id => store.list('amcVisits', v => v.contractId === id).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.n - b.n);
export const invoicesOf = c => (c.billingPlan || []).map(l => (l.invoiceId ? store.get('invoices', l.invoiceId) : null)).filter(Boolean);

// The covered shutters of a site, copied from its register (type, size, height, motor, fire-rated).
export function snapshot(siteId, ids) {
  const { site } = findSite(siteId);
  return (site?.shutters || []).filter(s => ids.includes(s.id)).map(s => {
    const prd = store.get('products', s.productId);
    return { shutterId: s.id, tag: s.tag, location: s.location, productId: s.productId, typeName: productName(s.productId), sizeCode: s.sizeCode, heightM: s.heightM,
      motorised: prd?.code === 'MR' || !!s.motor, fireRated: !!s.fireRated };
  });
}

// Created when the customer accepts the AMC quotation (core/quotations.js accept).
export function createContractFromQuotation(q) {
  const est = store.get('estimates', q.estimateId);
  const enq = store.get('enquiries', q.enquiryId);
  const customer = store.get('customers', q.customerId);
  const old = enq.renewsContractId ? store.get('contracts', enq.renewsContractId) : null;
  const start = old ? addDays(old.end, 1) : firstOfNextMonth();
  const sites = est.sites.map(s => {
    const { site } = findSite(s.siteId);
    const r = amcSiteRow(s, est.matrix);
    return { key: s.key, siteId: s.siteId, name: s.name, address: [site?.address, site?.blockUnit].filter(Boolean).join(', '), access: site?.access || '', zoneId: s.zoneId,
      visits: s.visits, counts: s.counts, typed: !!s.typed, teamHrs: r.hrsVisit, days: r.days, shutters: s.typed ? [] : snapshot(s.siteId, s.shutterIds) };
  });
  const no = store.nextNumber('AMC');
  const c = store.insert('contracts', {
    no, enquiryId: enq.id, enquiryNo: enq.no, quotationId: q.id, quotationNo: `${q.no} Rev ${q.rev}`, estimateId: est.id, customerId: q.customerId, customer: q.customer,
    contactId: enq.contactId, contact: q.contact, phone: q.phone, email: enq.email || '', billingAddress: customer?.address || q.address, sites,
    periodMonths: est.periodMonths, start, end: contractEnd(start, est.periodMonths), billing: est.billing, plan: q.amc?.plan || [],
    value: q.subtotal, taxLabel: q.taxLabel, taxRate: q.taxRate, tax: q.tax, total: q.total, paymentTerm: q.paymentTerm,
    po: { method: q.acceptance?.method || '', no: q.acceptance?.poNo || '', date: q.acceptance?.poDate || '', attachments: q.acceptance?.attachments || [] }, signedDoc: null,
    billingPlan: [], renewal: { reminderDate: '', taskId: '', enquiryId: '', renewedById: '' }, renewsId: old?.id || '', renewsNo: old?.no || '',
  }, { status: 'Draft', note: `${no} created from ${q.no} Rev ${q.rev}${q.acceptance?.poNo ? ` (PO ${q.acceptance.poNo})` : ''}` });
  return c;
}

export const canEditContract = c => c.status === 'Draft' && auth.can('amcContract', 'edit');
export function saveContract(id, patch) {
  const c = store.get('contracts', id);
  if (c.status !== 'Draft') return c;
  const next = { ...patch };
  if (patch.start) next.end = contractEnd(patch.start, c.periodMonths);
  return store.update('contracts', id, next, false);
}

export function activateProblems(c, start = c.start) {
  const p = [];
  if (c.status !== 'Draft') p.push('Only a draft contract can be activated.');
  if (!start) p.push('Enter the start date.');
  const old = c.renewsId ? store.get('contracts', c.renewsId) : null;
  if (old && start <= old.end) p.push(`It renews ${old.no}, which runs until ${old.end}: start after that.`);
  return p;
}

// Visit dates: about two weeks into each period, off Sundays (question 9 to the team lead).
export function plannedDates(start, months, n) {
  return Array.from({ length: n }, (_, k) => offSunday(addDays(periodStart(start, months, n, k), 14)));
}
export function billingLines(c, start) {
  const n = c.plan.length || 1;
  return c.plan.map((p, k) => {
    const from = periodStart(start, c.periodMonths, n, k);
    const to = k === n - 1 ? contractEnd(start, c.periodMonths) : addDays(periodStart(start, c.periodMonths, n, k + 1), -1);
    return { key: store.uid('bl_'), n: p.n, of: p.of, from, to, billDate: from, amount: p.amount, tax: p.tax, total: p.total, invoiceId: '', status: 'Scheduled' };
  });
}

// Shutters typed as counts (no register yet) get register entries: "SH-1 … location to confirm". Returns their ids.
// Used when an AMC contract is activated and when a General Servicing job is created.
export function registerCounts(customerId, siteId, counts, source) {
  const sizes = store.list('sizes');
  const rolling = store.findOne('products', p => p.code === 'RS') || store.list('products')[0];
  const { site } = findSite(siteId);
  const made = [];
  Object.entries(counts || {}).forEach(([code, n]) => {
    const z = sizes.find(x => x.code === code);
    for (let i = 0; i < n; i++) {
      const tag = nextShutterTag({ shutters: [...(site?.shutters || []), ...made] }, 'SH-');
      made.push(makeShutter({ tag, location: 'to confirm', productId: rolling?.id, width: z?.maxWidth ?? 8, height: z?.maxHeight ?? 6, unit: 'm' }, source));
    }
  });
  if (made.length) addShutters(customerId, siteId, made, `${made.length} shutter(s) added from ${source} (location to confirm)`);
  return made.map(m => m.id);
}
const registerTyped = c => c.sites.map(s => (s.typed ? { ...s, typed: false, shutters: snapshot(s.siteId, registerCounts(c.customerId, s.siteId, s.counts, `AMC contract ${c.no}`)) } : s));

// Activate: the visit plan (N visits per site) and the billing plan for the whole year, all at once.
export function activateContract(id, { start } = {}) {
  const c = store.get('contracts', id);
  const s = start || c.start;
  const problems = activateProblems(c, s);
  if (problems.length) return problems;
  const sites = registerTyped(c);
  const end = contractEnd(s, c.periodMonths);
  const billingPlan = billingLines(c, s);
  const reminderDate = addDays(end, -amcDefaults().renewalDays);
  store.update('contracts', id, { start: s, end, sites, billingPlan, renewal: { ...c.renewal, reminderDate }, activatedAt: new Date().toISOString(), activatedBy: store.currentActor() },
    `Activated: ${s} – ${end}, ${sites.reduce((t, x) => t + x.visits, 0)} visits, ${billingPlan.length} billing line${billingPlan.length > 1 ? 's' : ''}`);
  sites.forEach(site => plannedDates(s, c.periodMonths, site.visits).forEach((plannedDate, k) => {
    const zone = store.get('zones', site.zoneId);
    store.insert('amcVisits', {
      contractId: id, contractNo: c.no, enquiryId: c.enquiryId, customerId: c.customerId, customer: c.customer, contact: c.contact, phone: c.phone,
      siteKey: site.key, siteId: site.siteId, site: site.name, address: site.address, access: site.access, zoneId: site.zoneId, n: k + 1, of: site.visits,
      plannedDate, confirmedDate: '', confirmedVia: '', technicianId: '', helperIds: [], start: null, end: null, blocks: [],
      workHours: site.teamHrs, days: site.days, travelHours: Number(zone?.roundTripHours) || 0, shutters: site.shutters,
      checklist: {}, safeIsolation: false, photosBefore: [], photosAfter: [], steps: {}, signoff: null, reportNo: `${c.no}-V${k + 1}${c.sites.length > 1 ? `-S${c.sites.indexOf(site) + 1}` : ''}`, failures: [],
    }, { status: 'Planned', note: `${c.no} visit ${k + 1} of ${site.visits} at ${site.name}` });
  }));
  store.setStatus('contracts', id, 'Active', `${s} – ${end}`);
  store.setStatus('enquiries', c.enquiryId, 'Contract active', `${c.no} active`);
  if (c.renewsId) {
    const old = store.get('contracts', c.renewsId);
    store.update('contracts', old.id, { renewal: { ...old.renewal, renewedById: id, renewedByNo: c.no } }, `Renewed by ${c.no}`);
  }
  refreshAmc();
  return [];
}

// Cancel a draft (the enquiry is lost), or end an active contract early: visits not started and billing lines not
// invoiced are cancelled, and so are draft invoices for periods after today; posted invoices stay.
export function cancelContract(id, reason) {
  const c = store.get('contracts', id);
  if (c.status === 'Draft') {
    store.setStatus('contracts', id, 'Cancelled', reason);
    store.update('enquiries', c.enquiryId, { stage: 'Lost' }, false);
    store.setStatus('enquiries', c.enquiryId, 'Lost', `${c.no} cancelled: ${reason}`);
    return;
  }
  if (c.status !== 'Active') return;
  const t = todayStr();
  visitsOf(id).filter(v => ['Planned', 'Confirmed', 'Scheduled'].includes(v.status)).forEach(v => store.setStatus('amcVisits', v.id, 'Cancelled', `${c.no} terminated`));
  const billingPlan = c.billingPlan.map(l => {
    const inv = l.invoiceId ? store.get('invoices', l.invoiceId) : null;
    if (!inv) return { ...l, status: 'Cancelled' };
    if (inv.status === 'Draft' && l.from > t) { store.setStatus('invoices', inv.id, 'Cancelled', `${c.no} terminated`); return { ...l, status: 'Cancelled' }; }
    return l;
  });
  store.update('contracts', id, { billingPlan, terminatedAt: new Date().toISOString(), terminatedOn: t }, `Terminated: ${reason}`);
  cancelTasksFor('contract', id, 'Contract terminated');
  store.setStatus('contracts', id, 'Terminated', reason);
  maybeCloseContract(id);
}

// Renew: a new AMC enquiry ("Renewal of …") with an estimate pre-filled from this contract at today's master rates.
// It then goes through the quotation and the counter-check like any AMC; its contract starts the day after this one ends.
export function renewContract(id) {
  const c = store.get('contracts', id);
  if (liveRenewal(c)) return { enquiry: store.get('enquiries', c.renewal.enquiryId), estimate: store.list('estimates', e => e.enquiryId === c.renewal.enquiryId).sort((a, b) => b.rev - a.rev)[0] };
  const enq0 = store.get('enquiries', c.enquiryId);
  const enq = saveNewEnquiry({
    receivedAt: new Date().toISOString(), channel: 'OTHER', channelOther: `Renewal of ${c.no}`, type: 'AMC', enquiryStatus: 'WARM', priority: 'MEDIUM', siteInspection: 'NO',
    recordedBy: store.currentActor(), remarks: '', attachments: [], customerId: c.customerId, contactId: c.contactId, contactName: c.contact, mobile: c.phone, email: c.email,
    siteId: c.sites[0].siteId, lines: [{ itemRef: '', itemName: '', qty: null, description: `Renewal of ${c.no} (${c.sites.map(s => s.name).join(', ')}), ends ${fmtDate(c.end)}` }],
  });
  store.update('enquiries', enq.id, { renewsContractId: c.id, zoneId: enq0?.zoneId || enq.zoneId }, false);
  const est = createEstimate(enq.id, { from: c });
  if (c.renewal?.taskId) closeTask(c.renewal.taskId, 'approve', `Renewal started: ${enq.no}`);
  store.update('contracts', id, { renewal: { ...c.renewal, enquiryId: enq.id, taskId: c.renewal?.taskId || '' } }, `Renewal started: ${enq.no}, ${est.no}`);
  return { enquiry: store.get('enquiries', enq.id), estimate: est };
}

// A renewal enquiry that was lost (quotation rejected, renewal contract cancelled) counts as no renewal: Renew works
// again and the reminder comes back.
export const liveRenewal = c => { const e = c.renewal?.enquiryId ? store.get('enquiries', c.renewal.enquiryId) : null; return e && !['Lost', 'Cancelled'].includes(e.status) ? e : null; };

// The customer does not renew: the reminder task closes and does not come back.
export function declineRenewal(id, note = '') {
  const c = store.get('contracts', id);
  if (c.renewal?.taskId) closeTask(c.renewal.taskId, 'return', note || 'Customer is not renewing');
  store.update('contracts', id, { renewal: { ...c.renewal, declined: true } }, `Not renewing${note ? `: ${note}` : ''}`);
}

// Closed = ended, every visit filed (or cancelled) and every billing line invoiced and paid (or cancelled).
export function maybeCloseContract(id) {
  const c = id && store.get('contracts', id);
  if (!c || !ENDED.includes(c.status)) return false;
  if (visitsOf(id).some(v => !['Checked & filed', 'Cancelled'].includes(v.status))) return false;
  const lines = c.billingPlan.filter(l => l.status !== 'Cancelled');
  if (lines.some(l => { const inv = l.invoiceId && store.get('invoices', l.invoiceId); return !inv || inv.status !== 'Posted' || balanceOf(inv) > 0; })) return false;
  store.update('contracts', id, { closedAt: new Date().toISOString() }, false);
  cancelTasksFor('contract', id, 'Contract closed');
  store.setStatus('contracts', id, 'Closed', 'All visits filed and every invoice paid');
  store.setStatus('enquiries', c.enquiryId, 'Closed', `${c.no} closed`);
  return true;
}

// The daily check (run when screens open): invoices due today, the renewal task, the end of the contract year.
export function refreshAmc() {
  if (!store.currentTenant()) return;
  const t = todayStr();
  store.list('contracts', c => BILLED.includes(c.status)).forEach(c => {
    c.billingPlan.filter(l => l.status === 'Scheduled' && !l.invoiceId && l.billDate <= t).forEach(l => createContractInvoice(c.id, l.key));
    if (!LIVE.includes(c.status)) { maybeCloseContract(c.id); return; }
    let cur = store.get('contracts', c.id);
    if (cur.renewal.enquiryId && !liveRenewal(cur)) {
      store.update('contracts', c.id, { renewal: { ...cur.renewal, enquiryId: '', taskId: '' } }, 'Renewal lost: the reminder comes back');
      cur = store.get('contracts', c.id);
    }
    if (cur.renewal.reminderDate && t >= cur.renewal.reminderDate && !cur.renewal.taskId && !cur.renewal.enquiryId && !cur.renewal.renewedById && !cur.renewal.declined) {
      const task = openTask({ kind: 'renewal', docType: 'contract', docId: c.id, docNo: c.no, title: `Renew ${c.no} (ends ${fmtDate(cur.end)})`, customer: c.customer, amount: c.total,
        level: 1, roleCode: 'OPS', roleName: store.findOne('roles', r => r.code === 'OPS')?.name || 'Operations Executive', rules: [] });
      store.update('contracts', c.id, { renewal: { ...cur.renewal, taskId: task.id } }, `Renewal reminder: ends ${fmtDate(cur.end)}`);
    }
    if (t > cur.end) {
      store.setStatus('contracts', c.id, cur.renewal.renewedById ? 'Renewed' : 'Expired', `Ended ${cur.end}`);
      maybeCloseContract(c.id);
    }
  });
}

// Small read helpers for screens and the register.
export function contractProgress(c) {
  const visits = visitsOf(c.id).filter(v => v.status !== 'Cancelled');
  const done = visits.filter(v => ['Done', 'Checked & filed'].includes(v.status));
  const invs = invoicesOf(c).filter(i => i.status === 'Posted');
  const paid = invs.reduce((t, i) => t + (i.total - balanceOf(i)), 0);
  return { visits: visits.length, done: done.length, next: visits.find(v => !['Done', 'Checked & filed'].includes(v.status)) || null,
    posted: invs.length, lines: c.billingPlan.filter(l => l.status !== 'Cancelled').length, invoiced: invs.reduce((t, i) => t + i.total, 0), paid, balance: invs.reduce((t, i) => t + balanceOf(i), 0),
    lastDone: done.map(v => v.signoff?.signedAt).filter(Boolean).sort().pop() || '' };
}
export const daysLeft = c => Math.round((new Date(`${c.end}T00:00`) - new Date(`${todayStr()}T00:00`)) / 86400000);
