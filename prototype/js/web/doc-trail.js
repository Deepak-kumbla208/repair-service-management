// "Linked documents": one line under a document's title with every document of its enquiry in flow order, each a
// link (the current one in bold), so you can walk up or down the chain in one click: receipt → invoice → job or
// contract → quotation → estimate → site report → enquiry, and back.
import * as store from '../core/store.js';
import { html } from '../core/ui.js';

const latest = (coll, enqId) => {
  const all = store.list(coll, r => r.enquiryId === enqId).sort((a, b) => (b.rev || 0) - (a.rev || 0));
  return all.find(r => r.status !== 'Superseded') || all[0] || null;
};

export function trailHtml(enqId, currentId = '') {
  const enq = store.get('enquiries', enqId);
  if (!enq) return '';
  const items = [];
  const add = (label, route, id) => items.push({ label, route, id });
  if (enq.fromService) add(`From ${enq.fromService.no}`, enq.fromService.coll === 'jobs' ? `jobs/${enq.fromService.id}` : `amc-visits/${enq.fromService.id}`, enq.fromService.id);
  add(enq.no, `enquiries/${enq.id}`, enq.id);
  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const rep = insp?.reportId ? store.get('siteReports', insp.reportId) : null;
  if (rep) add(rep.no, `reports/${rep.id}`, rep.id);
  const est = latest('estimates', enq.id);
  if (est) add(`${est.no} Rev ${est.rev}`, `estimates/${est.id}`, est.id);
  const q = latest('quotations', enq.id);
  if (q) add(`${q.no} Rev ${q.rev}`, `quotations/${q.id}`, q.id);
  const job = store.list('jobs', j => j.enquiryId === enq.id).sort((a, b) => (a.status === 'Cancelled') - (b.status === 'Cancelled'))[0];
  if (job) add(job.no, `jobs/${job.id}`, job.id);
  const contract = store.list('contracts', c => c.enquiryId === enq.id).sort((a, b) => (a.status === 'Cancelled') - (b.status === 'Cancelled'))[0];
  if (contract) add(contract.no, `contracts/${contract.id}`, contract.id);
  const invoices = store.list('invoices', i => i.enquiryId === enq.id && i.status !== 'Cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shown = invoices.length > 3 ? invoices.slice(-2) : invoices;
  if (invoices.length > shown.length) add(`${invoices.length - shown.length} earlier invoices`, `contracts/${contract?.id}`, '');
  shown.forEach(i => add(i.no || 'Draft invoice', `invoices/${i.id}`, i.id));
  const receipts = store.list('payments', p => invoices.some(i => i.id === p.invoiceId)).sort((a, b) => a.date.localeCompare(b.date));
  receipts.slice(-3).forEach(p => add(p.no, `invoices/${p.invoiceId}`, p.id));
  if (job && ['Completed & documented', 'Closed'].includes(job.status)) add(job.status === 'Closed' ? 'Closed' : 'Documented', `closure/${job.id}`, `closure_${job.id}`);
  if (contract?.status === 'Closed') add('Closed', `contracts/${contract.id}`, '');
  return html`<div class="trail"><span class="muted">Linked documents</span>${items.map((it, i) => html`${i ? html`<span class="sep">›</span>` : ''}${it.id && it.id === currentId
    ? html`<b>${it.label}</b>` : html`<a href="#/${it.route}">${it.label}</a>`}`)}</div>`;
}
