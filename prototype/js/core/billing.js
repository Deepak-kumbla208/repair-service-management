// Invoices and payments (recorded only, no gateway). An invoice is drafted from the accepted quotation and gets its
// number only when posted, so the series has no gaps; a cancelled invoice keeps its number. Payments may be partial;
// the job closes itself once it is documented and fully paid (core/closure.js).
import * as store from './store.js';
import * as auth from './auth.js';
import { withCompany } from './lookups.js';
import { taxTotals, termDays, round2, ageBucket } from './costing.js';
import { maybeClose } from './closure.js';

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
export const addDays = (ds, n) => { const d = new Date(`${ds}T00:00`); d.setDate(d.getDate() + Number(n || 0)); return dstr(d); };
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00`) - new Date(`${a}T00:00`)) / 86400000);

export const invoiceForJob = jobId => store.list('invoices', i => i.jobId === jobId && i.status !== 'Cancelled')[0] || null;

function invoiceTerms() {
  const company = auth.company();
  return store.list('terms', t => t.docType === 'Invoice' && t.isDefault && t.status !== 'Inactive').sort((a, b) => a.order - b.order).map(t => withCompany(t.text, company));
}

// Draft (or post) the invoice of a job from its accepted quotation. Lines marked "Not done" on the Work Done form
// are flagged so the office can remove them before posting (flow step 10: approved quotation and actual work).
export function createInvoice(jobId, { post = false, note = '' } = {}) {
  const job = store.get('jobs', jobId);
  const q = store.get('quotations', job.quotationId);
  const customer = store.get('customers', job.customerId);
  const notDone = (job.workDone?.rows || []).filter(r => r.status !== 'DONE');
  const rows = q.rows.map(r => ({ ...r, flag: notDone.find(n => n.key === r.lineKey) ? 'Marked not fully done on the Work Done form' : '' }));
  const flagNote = q.costingLevel === 'JOB' && notDone.length ? `Work Done form: ${notDone.map(n => `"${n.description}" ${n.status === 'PARTLY' ? 'partly done' : 'not done'}`).join('; ')}` : '';
  const date = today();
  const inv = store.insert('invoices', {
    no: '', jobId, jobNo: job.no, quotationId: q.id, quotationNo: `${q.no} Rev ${q.rev}`, enquiryId: job.enquiryId, customerId: job.customerId,
    customer: job.customer, billingAddress: customer?.address || job.address, contact: job.contact, phone: job.phone, site: job.site, siteAddress: job.address,
    poNo: q.acceptance?.poNo || '', date, paymentTerm: job.paymentTerm, dueDate: addDays(date, termDays(job.paymentTerm)),
    costingLevel: q.costingLevel, description: q.description, findings: q.findings, rows, flagNote,
    subtotal: q.subtotal, taxLabel: q.taxLabel, taxRate: q.taxRate, tax: q.tax, total: q.total, terms: invoiceTerms(), preparedBy: store.currentActor(),
  }, { status: 'Draft', note: `Invoice for ${job.no} ${note}`.trim() });
  store.update('jobs', jobId, { invoiceId: inv.id }, false);
  return post ? postInvoice(inv.id) : inv;
}

export const canEditInvoice = inv => inv.status === 'Draft' && auth.can('invoice', 'edit');

export function removeRow(invId, index) {
  const inv = store.get('invoices', invId);
  const rows = inv.rows.filter((_, i) => i !== index);
  store.update('invoices', invId, { rows, ...taxTotals(rows.reduce((t, r) => t + r.amount, 0), inv.taxRate) }, `Removed line "${inv.rows[index].description}"`);
}

// Posting gives the next invoice number (gapless) and fixes the date and due date.
export function postInvoice(id) {
  const inv = store.get('invoices', id);
  if (inv.status !== 'Draft') return inv;
  const date = today();
  const no = store.nextNumber('INV');
  store.update('invoices', id, { no, date, dueDate: addDays(date, termDays(inv.paymentTerm)), postedAt: new Date().toISOString(), postedBy: store.currentActor() }, `Posted as ${no}`);
  store.setStatus('invoices', id, 'Posted', no);
  return store.get('invoices', id);
}

export function cancelInvoice(id, reason) { store.setStatus('invoices', id, 'Cancelled', reason); }

// ---------- Payments ----------
export const paymentsFor = invId => store.list('payments', p => p.invoiceId === invId).sort((a, b) => a.date.localeCompare(b.date));
export const paidAmount = inv => round2(paymentsFor(inv.id).reduce((t, p) => t + Number(p.amount || 0), 0));
export const balanceOf = inv => (inv.status === 'Posted' ? round2(inv.total - paidAmount(inv)) : 0);
export function paymentStatus(inv) {
  if (!inv || inv.status !== 'Posted') return '';
  const paid = paidAmount(inv);
  return paid <= 0 ? 'NOT_PAID' : paid + 0.004 >= inv.total ? 'PAID' : 'PARTLY';
}

export function paymentProblems(inv, amount) {
  const p = [];
  if (!inv || inv.status !== 'Posted') p.push('The invoice must be posted first.');
  else if (!(Number(amount) > 0)) p.push('Enter the amount received.');
  else if (Number(amount) > balanceOf(inv) + 0.004) p.push(`The amount is more than the balance (${balanceOf(inv).toFixed(2)}).`);
  return p;
}

// via: 'web' | 'phone' (collected on site by the technician)
export function recordPayment({ invoiceId, amount, method, reference = '', date = today(), proofId = null, via = 'web' }) {
  const inv = store.get('invoices', invoiceId);
  const problems = paymentProblems(inv, amount);
  if (problems.length) return { problems };
  const no = store.nextNumber('RCPT');
  const pay = store.insert('payments', { no, invoiceId, invoiceNo: inv.no, jobId: inv.jobId, customerId: inv.customerId, customer: inv.customer, date, amount: round2(amount), method, reference, proofId, via },
    { note: `${no}: ${round2(amount).toFixed(2)} for ${inv.no}${via === 'phone' ? ' (collected on site)' : ''}` });
  maybeClose(inv.jobId);
  return { problems: [], payment: pay };
}

export function addFollowUp(invoiceId, { method, note, nextDate }) {
  return store.insert('followUps', { invoiceId, at: new Date().toISOString(), by: store.currentActor(), method, note, nextDate: nextDate || '' }, { silent: true });
}
export const followUpsFor = invId => store.list('followUps', f => f.invoiceId === invId).sort((a, b) => b.at.localeCompare(a.at));

// Open (posted, unpaid) invoices with days to due and the ageing bucket by invoice date.
export function openInvoices() {
  const t = today();
  return store.list('invoices', i => i.status === 'Posted' && balanceOf(i) > 0).map(i => ({
    inv: i, balance: balanceOf(i), dueIn: daysBetween(t, i.dueDate), age: daysBetween(i.date, t), bucket: ageBucket(daysBetween(i.date, t)),
  }));
}
