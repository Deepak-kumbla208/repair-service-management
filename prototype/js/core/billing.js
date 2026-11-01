// Invoices and payments (recorded only, no gateway). An invoice is drafted from the accepted quotation and gets its
// number only when posted, so the series has no gaps; a cancelled invoice keeps its number. Payments may be partial;
// the job closes itself once it is documented and fully paid (core/closure.js). AMC contracts are invoiced from their
// billing plan only (one invoice per line, never from visits) and close by their own rule (core/contracts.js).
import * as store from './store.js';
import * as auth from './auth.js';
import { termTexts, letterhead } from './setup.js';
import { taxTotals, termDays, round2, ageBucket } from './costing.js';
import { maybeClose } from './closure.js';
import { maybeCloseContract } from './contracts.js';

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
export const addDays = (ds, n) => { const d = new Date(`${ds}T00:00`); d.setDate(d.getDate() + Number(n || 0)); return dstr(d); };
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00`) - new Date(`${a}T00:00`)) / 86400000);

export const invoiceForJob = jobId => store.list('invoices', i => i.jobId === jobId && i.status !== 'Cancelled')[0] || null;

// Due date: immediate payment is due on the visit day (an invoice raised at scheduling is not overdue before the
// visit); other terms count their days from the invoice date.
function dueFor(job, term, date) {
  if (term === 'IMMEDIATE' && job?.start) { const ds = dstr(new Date(job.start)); return ds > date ? ds : date; }
  return addDays(date, termDays(term));
}
export function syncDueDate(jobId) {
  const inv = invoiceForJob(jobId);
  if (inv?.status === 'Posted' && inv.paymentTerm === 'IMMEDIATE') store.update('invoices', inv.id, { dueDate: dueFor(store.get('jobs', jobId), inv.paymentTerm, inv.date) }, false);
}
// "Create invoice" is offered when the job has no live invoice (e.g. after a cancelled one) and is done or scheduled.
export const canRaiseInvoice = job => !!job && job.status !== 'Cancelled' && !invoiceForJob(job.id)
  && (!!job.workDone?.signedAt || (job.paymentTerm === 'IMMEDIATE' && !!job.start)) && auth.can('invoice', 'create');

// The invoice terms chosen in Transaction Setup, in their order.
const invoiceTerms = () => termTexts('Invoice');

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
    poNo: q.acceptance?.poNo || '', date, paymentTerm: job.paymentTerm, dueDate: dueFor(job, job.paymentTerm, date),
    costingLevel: q.costingLevel, description: q.description, findings: q.findings, rows, flagNote,
    subtotal: q.subtotal, taxLabel: q.taxLabel, taxRate: q.taxRate, tax: q.tax, total: q.total, terms: invoiceTerms(), preparedBy: store.currentActor(),
  }, { status: 'Draft', note: `Invoice for ${job.no} ${note}`.trim() });
  store.update('jobs', jobId, { invoiceId: inv.id }, false);
  return post ? postInvoice(inv.id) : inv;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = ds => { const d = new Date(`${ds}T00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

// The invoice of one AMC billing-plan line. The line keeps its invoice, so it is never billed twice; a cancelled
// invoice frees the line and the daily check drafts a corrected one.
export function createContractInvoice(contractId, lineKey, { post = false } = {}) {
  const c = store.get('contracts', contractId);
  const line = c?.billingPlan.find(l => l.key === lineKey);
  if (!line || line.status === 'Cancelled') return null;
  const live = line.invoiceId ? store.get('invoices', line.invoiceId) : null;
  if (live && live.status !== 'Cancelled') return live;
  const customer = store.get('customers', c.customerId);
  const date = today();
  const description = `Annual maintenance contract ${c.no} · instalment ${line.n} of ${line.of} · ${dmy(line.from)} – ${dmy(line.to)}`;
  const inv = store.insert('invoices', {
    no: '', jobId: '', jobNo: c.no, contractId: c.id, contractNo: c.no, instalment: { key: line.key, n: line.n, of: line.of, from: line.from, to: line.to },
    quotationId: c.quotationId, quotationNo: c.quotationNo, enquiryId: c.enquiryId, customerId: c.customerId, customer: c.customer, billingAddress: customer?.address || c.billingAddress,
    contact: c.contact, phone: c.phone, site: c.sites.map(s => s.name).join(', '), siteAddress: c.sites[0]?.address || '', poNo: c.po?.no || '', date, paymentTerm: c.paymentTerm,
    dueDate: addDays(date, termDays(c.paymentTerm)), costingLevel: 'JOB', description, findings: '', flagNote: '',
    rows: [{ lineKey: line.key, description, qty: 1, unit: 'Nos', rate: line.amount, amount: line.amount }],
    subtotal: line.amount, taxLabel: c.taxLabel, taxRate: c.taxRate, tax: line.tax, total: line.total, terms: invoiceTerms(), preparedBy: store.currentActor(),
  }, { status: 'Draft', note: `${c.no} instalment ${line.n} of ${line.of} (bill date ${line.billDate})` });
  store.update('contracts', c.id, { billingPlan: c.billingPlan.map(l => (l.key === line.key ? { ...l, invoiceId: inv.id, status: 'Invoiced' } : l)) }, `Instalment ${line.n} of ${line.of} drafted`);
  return post ? postInvoice(inv.id) : inv;
}
// "Post all due": every draft instalment invoice of a contract.
export function postContractDrafts(contractId) {
  return store.list('invoices', i => i.contractId === contractId && i.status === 'Draft').map(i => postInvoice(i.id));
}

// Contract invoices follow the plan exactly, so their lines are not edited.
export const canEditInvoice = inv => inv.status === 'Draft' && auth.can('invoice', 'edit');
export const canEditRows = inv => canEditInvoice(inv) && !inv.contractId;

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
  // A posted invoice keeps the letterhead it was issued with.
  store.update('invoices', id, { no, date, dueDate: dueFor(inv.jobId ? store.get('jobs', inv.jobId) : null, inv.paymentTerm, date), postedAt: new Date().toISOString(), postedBy: store.currentActor(), letterhead: letterhead() }, `Posted as ${no}`);
  store.setStatus('invoices', id, 'Posted', no);
  return store.get('invoices', id);
}

// A cancelled invoice keeps its number; the job is unlinked so a corrected invoice can be raised. Refused once paid.
export function cancelInvoice(id, reason) {
  const inv = store.get('invoices', id);
  if (paymentsFor(id).length) return `${inv.no} has a payment and cannot be cancelled.`;
  store.setStatus('invoices', id, 'Cancelled', reason);
  const job = inv.jobId ? store.get('jobs', inv.jobId) : null;
  if (job?.invoiceId === id) store.update('jobs', job.id, { invoiceId: '' }, false);
  const c = inv.contractId ? store.get('contracts', inv.contractId) : null;
  // The line is invoiced again (the daily check drafts a corrected invoice), unless the contract was terminated before
  // its period started; then the line is dropped.
  const drop = l => c.status === 'Terminated' && l.from > (c.terminatedOn || '');
  if (c) store.update('contracts', c.id, { billingPlan: c.billingPlan.map(l => (l.invoiceId === id ? { ...l, invoiceId: '', status: drop(l) ? 'Cancelled' : 'Scheduled' } : l)) },
    `${inv.no} cancelled: instalment ${inv.instalment.n} ${c.status === 'Terminated' && drop(c.billingPlan.find(l => l.invoiceId === id)) ? 'dropped (after the termination)' : 'to invoice again'}`);
  if (c) maybeCloseContract(c.id);
  return '';
}

// A draft line marked not fully done may be lowered to match the actual work (with the reason kept).
export function setRowAmount(invId, index, amount, reason) {
  const inv = store.get('invoices', invId);
  if (inv.status !== 'Draft') return;
  const old = inv.rows[index];
  const rows = inv.rows.map((r, i) => (i === index ? { ...r, rate: round2(amount), amount: round2(amount), note: reason } : r));
  store.update('invoices', invId, { rows, ...taxTotals(rows.reduce((t, r) => t + r.amount, 0), inv.taxRate) }, `Line "${old.description.slice(0, 40)}" changed from ${old.amount.toFixed(2)} to ${round2(amount).toFixed(2)}: ${reason}`);
}

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
  if (inv.contractId) maybeCloseContract(inv.contractId);
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
