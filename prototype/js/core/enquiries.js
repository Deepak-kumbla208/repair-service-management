// Enquiry rules: numbering, first status by type, item lines (the Enquiry Description), the site-inspection
// hand-off (optionally with the technician chosen on the enquiry), the register's automatic columns and
// the 1–2 hour inspection target.
import * as store from './store.js';
import { quickCreate, addSite } from './customers.js';
import { assignTechnician } from './inspections.js';
import { contractFor, contractProgress, invoicesOf } from './contracts.js';

export const ENQ_STATUSES = ['Waiting for inspection', 'Inspection assigned', 'Report in progress', 'Inspected', 'BOQ study', 'Waiting for estimate',
  'Estimating', 'Quotation in check', 'Quotation approved', 'Quoted', 'Won', 'Contract active', 'Completed', 'Closed', 'Lost', 'Cancelled'];

// Enquiry Type decides the next step: Repair goes to site inspection; AMC and General Servicing go to BOQ study
// (site inspection optional, decided by the "Site Inspection" Yes / No column).
function firstStatus(type, needsInspection) {
  if (needsInspection) return 'Waiting for inspection';
  return type === 'REPAIR' ? 'Waiting for estimate' : 'BOQ study';
}

// Item lines are the Enquiry Description: "2 × Tension spring: RS-2 jammed; Check the back door".
// lines: [{ itemRef, itemName, qty, description }]; a line may have no item.
export const cleanLines = lines => (lines || []).filter(l => l.itemRef || (l.description || '').trim())
  .map(l => ({ itemRef: l.itemRef || '', itemName: l.itemName || '', qty: l.itemRef ? (Number(l.qty) || 1) : null, description: (l.description || '').trim() }));

export function composeDescription(lines) {
  return cleanLines(lines).map(l => {
    const item = l.itemName ? `${l.qty || 1} × ${l.itemName}` : '';
    return [item, l.description].filter(Boolean).join(': ');
  }).join('; ');
}

function openInspection(enq) {
  const insp = store.insert('inspections', { enquiryId: enq.id, zoneId: enq.zoneId, technicianId: '', visitAt: null, confirmedBy: '', notes: '' },
    { status: 'To assign', note: `Site inspection opened for ${enq.no}` });
  store.update('enquiries', enq.id, { inspectionId: insp.id }, false);
  return insp;
}

// A technician chosen on the enquiry assigns the inspection straight away (visit time optional).
function applyAssignment(enq, assign) {
  if (!assign?.technicianId || !enq.inspectionId) return;
  const insp = store.get('inspections', enq.inspectionId);
  if (!['To assign', 'Assigned'].includes(insp.status)) return;
  if (insp.technicianId === assign.technicianId && insp.visitAt === assign.visitAt && insp.confirmedBy === assign.confirmedBy) return;
  assignTechnician(insp.id, { technicianId: assign.technicianId, visitAt: assign.visitAt || null, confirmedBy: assign.confirmedBy || '', notes: insp.notes || '' });
}

function resolveSite(customer, data, newSite) {
  if (newSite) return addSite(customer.id, newSite);
  return (store.get('customers', customer.id).sites || []).find(s => s.id === data.siteId);
}

// data: register fields + lines; newCustomer / newSite: quick-created from the form; assign: technician chosen on the form.
export function saveNewEnquiry(data, { newCustomer, newSite, assign } = {}) {
  let customer, site, contactId = data.contactId;
  if (newCustomer) {
    const r = quickCreate({ ...newCustomer, site: newSite });
    customer = r.customer; site = r.site; contactId = r.contact.id;
  } else {
    customer = store.get('customers', data.customerId);
    site = resolveSite(customer, data, newSite);
  }
  const needsInspection = data.siteInspection === 'YES';
  const no = store.nextNumber('ENQ', data.receivedAt);
  const lines = cleanLines(data.lines);
  const enq = store.insert('enquiries', {
    ...data, lines, description: composeDescription(lines), no, contactId, customerId: customer.id, customerName: customer.name,
    siteId: site.id, siteName: site.name, zoneId: site.zoneId || '', recordedBy: data.recordedBy || store.currentActor(),
    stage: needsInspection ? 'Inspection' : 'New', inspectionId: null,
  }, { status: firstStatus(data.type, needsInspection), note: `${no} registered` });
  if (needsInspection) {
    openInspection(enq);
    applyAssignment(store.get('enquiries', enq.id), assign);
  }
  return store.get('enquiries', enq.id);
}

export function saveEnquiryChanges(id, data, { newSite, assign } = {}) {
  const enq = store.get('enquiries', id);
  const customer = store.get('customers', enq.customerId);
  const site = resolveSite(customer, data, newSite) || customer.sites.find(s => s.id === enq.siteId);
  const lines = cleanLines(data.lines);
  store.update('enquiries', id, { ...data, lines, description: composeDescription(lines), customerId: enq.customerId, siteId: site.id, siteName: site.name, zoneId: site.zoneId || '' }, `Edited ${enq.no}`);

  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const open = insp && insp.status !== 'Cancelled';
  if (data.siteInspection === 'YES' && !open) {
    openInspection(store.get('enquiries', id));
    store.setStatus('enquiries', id, 'Waiting for inspection', 'Site inspection added');
  } else if (data.siteInspection !== 'YES' && open && insp.status === 'To assign') {
    store.setStatus('inspections', insp.id, 'Cancelled', 'Site inspection not needed');
    store.setStatus('enquiries', id, firstStatus(data.type, false), 'Site inspection not needed');
  } else if (open && insp.zoneId !== (site.zoneId || '')) {
    store.update('inspections', insp.id, { zoneId: site.zoneId || '' }, false);
  }
  if (data.siteInspection === 'YES') applyAssignment(store.get('enquiries', id), assign);
  return store.get('enquiries', id);
}

// Register columns 17–26, filled from the linked documents (PLAN.md "How the register's status columns are filled"):
// Quotation Status "Quoted" once a revision is sent; Job Status Pending (quoted) / Confirmed (accepted) / Cancelled;
// Work Completion from the job; Payment Received from the invoice balance. Values are after tax.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = n => (n == null || n === '' ? '' : Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = iso => { if (!iso) return ''; const d = new Date(iso.length === 10 ? `${iso}T00:00` : iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const label = (set, code) => store.findOne('valueSets', v => v.code === set)?.values.find(v => v.code === code)?.label || code || '';

export function laterColumns(e) {
  const qs = store.list('quotations', q => q.enquiryId === e.id).sort((a, b) => b.rev - a.rev);
  const q = qs.find(x => x.status !== 'Superseded') || qs[0];
  const sent = qs.find(x => x.sentAt);
  if (e.type === 'AMC') return amcColumns(e, q, sent);
  const job = store.list('jobs', j => j.enquiryId === e.id)[0];
  const inv = store.list('invoices', i => i.enquiryId === e.id && i.status === 'Posted')[0];
  const paid = inv ? store.list('payments', p => p.invoiceId === inv.id).reduce((t, p) => t + Number(p.amount || 0), 0) : 0;
  let jobStatus = '';
  if (job?.status === 'Cancelled' || q?.status === 'Rejected') jobStatus = 'CANCELLED';
  else if (job) jobStatus = 'CONFIRMED';
  else if (sent) jobStatus = 'PENDING';
  const wc = !job || job.status === 'Cancelled' ? '' : job.workDone?.signedAt ? 'COMPLETED' : ['On the way', 'On site'].includes(job.status) ? 'IN_PROGRESS' : 'NOT_STARTED';
  return {
    quotationDate: sent ? day(sent.sentAt) : '', quotationStatus: label('QUOT_STATUS', sent ? 'QUOTED' : 'NOT_QUOTED'), quotationValue: sent ? money(sent.total) : '',
    jobStatus: label('JOB_STATUS', jobStatus), workCompletion: label('WORK_COMPLETION', wc), workCompletionDate: day(job?.workDone?.signedAt),
    invoiceDate: inv ? day(inv.date) : '', invoiceNo: inv?.no || '', invoiceValue: inv ? money(inv.total) : '',
    paymentReceived: inv ? label('PAYMENT_RECEIVED', paid <= 0 ? 'NOT_PAID' : paid + 0.004 >= inv.total ? 'PAID' : 'PARTLY') : '',
  };
}

// An AMC row: Job Status Confirmed once the contract exists; Work Completion follows the visits; the invoice columns
// show the latest posted instalment and the value invoiced so far; Payment Received is over all instalments.
function amcColumns(e, q, sent) {
  const c = contractFor(e.id);
  const p = c && c.status !== 'Draft' ? contractProgress(c) : null;
  const posted = c ? invoicesOf(c).filter(i => i.status === 'Posted').sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [];
  const last = posted[0];
  const jobStatus = q?.status === 'Rejected' || (!c && store.list('contracts', x => x.enquiryId === e.id).length) ? 'CANCELLED' : c ? 'CONFIRMED' : sent ? 'PENDING' : '';
  const wc = !p ? '' : p.done >= p.visits ? 'COMPLETED' : p.done ? 'IN_PROGRESS' : 'NOT_STARTED';
  return {
    quotationDate: sent ? day(sent.sentAt) : '', quotationStatus: label('QUOT_STATUS', sent ? 'QUOTED' : 'NOT_QUOTED'), quotationValue: sent ? money(sent.total) : '',
    jobStatus: label('JOB_STATUS', jobStatus), workCompletion: label('WORK_COMPLETION', wc), workCompletionDate: wc === 'COMPLETED' ? day(p.lastDone) : '',
    invoiceDate: last ? day(last.date) : '', invoiceNo: last ? `${last.no}${posted.length > 1 ? ` (${posted.length} of ${p.lines})` : ''}` : '', invoiceValue: posted.length ? money(p.invoiced) : '',
    paymentReceived: posted.length ? label('PAYMENT_RECEIVED', p.paid <= 0.004 ? 'NOT_PAID' : p.balance <= 0.004 ? 'PAID' : 'PARTLY') : '',
  };
}

// Inspection clock: flow step 3 says the site inspection should be done within 1–2 hours of the call.
// state: ok (under half the target) | warn | bad (over target); done = report submitted.
export function inspectionClock(enq, company, now = Date.now()) {
  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  if (!insp || insp.status === 'Cancelled') return null;
  const target = (company?.inspectionTargetHours || 2) * 3600000;
  const start = new Date(enq.receivedAt).getTime();
  const report = insp.reportId ? store.get('siteReports', insp.reportId) : null;
  if (report?.status === 'Submitted') {
    const took = new Date(report.submittedAt).getTime() - start;
    return { done: true, took, target, state: took <= target ? 'ok' : 'bad' };
  }
  const elapsed = now - start;
  return { done: false, elapsed, target, left: target - elapsed, state: elapsed > target ? 'bad' : elapsed > target / 2 ? 'warn' : 'ok' };
}

export const isToday = (iso, now = new Date()) => !!iso && new Date(iso).toDateString() === now.toDateString();
