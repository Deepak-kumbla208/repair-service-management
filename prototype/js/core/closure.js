// Job closure: the review of every linked document (flow step 9 "Completed & documented") and the automatic
// "Closed" once the invoice is fully paid (step 12) — whichever of the two comes last closes the job.
import * as store from './store.js';
import { labourRow, materialRow } from './costing.js';
import { balanceOf, paymentsFor } from './billing.js';

export const docInvoice = job => (job.invoiceId ? store.get('invoices', job.invoiceId) : null);

// Each linked document with a tick; route opens it on the web.
export function checklist(job) {
  const enq = store.get('enquiries', job.enquiryId);
  const insp = enq?.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const rep = insp?.reportId ? store.get('siteReports', insp.reportId) : null;
  const est = store.get('estimates', job.estimateId);
  const q = store.get('quotations', job.quotationId);
  const inv = docInvoice(job);
  const pays = inv ? paymentsFor(inv.id) : [];
  const w = job.workDone || {};
  const item = (label, ok, doc, route, optional = false) => ({ label, ok: !!ok, doc: doc || '', route, optional });
  return [
    item('Enquiry', enq, enq?.no, `enquiries/${enq?.id}`),
    item('Site viewing report', rep?.status === 'Submitted', rep?.no, rep ? `reports/${rep.id}` : '', enq?.siteInspection !== 'YES'),
    item('Estimate', est, est && `${est.no} Rev ${est.rev}`, est ? `estimates/${est.id}` : ''),
    item('Quotation accepted', q?.status === 'Accepted', q && `${q.no} Rev ${q.rev}${q.acceptance?.poNo ? ` · PO ${q.acceptance.poNo}` : ''}`, q ? `quotations/${q.id}` : ''),
    item('Job scheduled', job.start, job.no, `jobs/${job.id}`),
    item('Work Done form signed by the customer', w.signedAt, w.signedAt ? 'Both signatures' : '', `jobs/${job.id}/workdone`),
    item('Company stamp photo', w.cust?.stampId, '', `jobs/${job.id}`, true),
    item('Before and after photos', job.photosBefore?.length && job.photosAfter?.length, `${job.photosBefore?.length || 0} before · ${job.photosAfter?.length || 0} after`, `jobs/${job.id}`, true),
    item('Invoice posted', inv?.status === 'Posted', inv?.no, inv ? `invoices/${inv.id}` : ''),
    item('Payment received in full', inv?.status === 'Posted' && balanceOf(inv) <= 0, pays.map(p => p.no).join(', '), inv ? `invoices/${inv.id}` : '', true),
  ];
}

// Estimated vs actual: hours on site, labour, parts, and the margin left.
export function estimatedVsActual(job) {
  const est = store.get('estimates', job.estimateId);
  const q = store.get('quotations', job.quotationId);
  if (!est) return null;
  const persons = 2 + (job.crew?.extra || 0);
  const teamRate = est.labour[0]?.rate || 0;
  const estHours = Number(job.workHours) || 0;
  const s = job.steps || {};
  const actHours = s.checkInAt && s.checkOutAt ? Math.max(0, (new Date(s.checkOutAt) - new Date(s.checkInAt)) / 3600000) : null;
  const estLabour = est.labour.reduce((t, r) => t + labourRow(r).total, 0);
  const actLabour = actHours == null ? null : actHours * teamRate;
  const rateOf = key => est.materials.find(m => m.key === key);
  const estParts = est.materials.reduce((t, m) => t + materialRow(m).amount, 0);
  const used = job.workDone?.partsUsed || [];
  const actParts = used.length ? used.filter(p => p.used).reduce((t, p) => { const m = rateOf(p.key); return t + (m ? materialRow({ ...m, qty: p.qty }).amount : 0); }, 0) : null;
  const other = est.transport.reduce((t, r) => t + r.hrs * r.rate, 0) + est.equipment.reduce((t, r) => t + r.qty * r.duration * r.rate, 0);
  const estDirect = estLabour + estParts + other;
  const actDirect = (actLabour ?? estLabour) + (actParts ?? estParts) + other;
  const sell = q?.subtotal || 0;
  return {
    persons, rows: [
      { label: 'Team hours on site', est: estHours, act: actHours, hours: true },
      { label: 'Labour cost', est: estLabour, act: actLabour },
      { label: 'Parts', est: estParts, act: actParts },
      { label: 'Transport and equipment', est: other, act: other },
      { label: 'Direct cost', est: estDirect, act: actDirect, strong: true },
      { label: 'Left after direct cost (selling price − direct cost)', est: sell - estDirect, act: sell - actDirect, strong: true },
    ],
  };
}

export const closureProblems = job => checklist(job).filter(i => !i.ok && !i.optional).map(i => `${i.label} is missing.`);

export function markDocumented(jobId) {
  const job = store.get('jobs', jobId);
  const problems = closureProblems(job).filter(p => !p.startsWith('Payment'));
  if (problems.length) return problems;
  store.update('jobs', jobId, { documentedAt: new Date().toISOString(), documentedBy: store.currentActor() }, 'Quotation, invoice, report and photos filed');
  store.setStatus('jobs', jobId, 'Completed & documented');
  maybeClose(jobId);
  return [];
}

// Closed = documented and the invoice fully paid, in either order.
export function maybeClose(jobId) {
  const job = jobId && store.get('jobs', jobId);
  if (!job || job.status !== 'Completed & documented') return false;
  const inv = docInvoice(job);
  if (!inv || inv.status !== 'Posted' || balanceOf(inv) > 0) return false;
  store.update('jobs', jobId, { closedAt: new Date().toISOString() }, false);
  store.setStatus('jobs', jobId, 'Closed', `Paid in full · ${inv.no}`);
  store.setStatus('enquiries', job.enquiryId, 'Closed', `${job.no} closed`);
  return true;
}
