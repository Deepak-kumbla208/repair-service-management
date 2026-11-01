// Sales quotations: created from the latest estimate revision (prices come only from the estimate), counter-checked
// by the Approver before they can be sent, sent, accepted (which creates the job) or rejected, and revised as
// Rev 2, 3… under the same number. A quotation expires by itself after its validity days.
import * as store from './store.js';
import * as auth from './auth.js';
import { findSite, withCompany } from './lookups.js';
import { estimateSummary, reviseEstimate, txDefaults, companyTax } from './estimates.js';
import { startApproval, levelsFor, openLevel, closeTask, cancelTasksFor } from './workflow.js';
import { createJobFromQuotation, openTermTask } from './jobs.js';

const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayIso = () => isoDate(new Date());
export function addDays(dateStr, days) { const d = new Date(`${dateStr}T00:00`); d.setDate(d.getDate() + Number(days || 0)); return isoDate(d); }

export const EDITABLE = ['Draft', 'Returned'];
export const OPEN = ['Draft', 'Submitted', 'Returned', 'Approved', 'Sent'];

function quoteTerms() {
  const company = auth.company();
  const terms = store.list('terms', t => t.docType === 'Quotation' && t.isDefault && t.status !== 'Inactive').sort((a, b) => a.order - b.order);
  const validity = terms.find(t => t.validityDays)?.validityDays || txDefaults().quoteValidityDays;
  return { texts: terms.map(t => withCompany(t.text, company)), validity };
}

// Priced rows: Job costing = one row for the whole job; Line costing = one row per line (+ the shared line).
export function rowsFromEstimate(est) {
  const s = estimateSummary(est);
  if (est.costingLevel === 'LINE') return { s, rows: s.lines.map(l => ({ lineKey: l.key, description: l.description, qty: 1, unit: 'Nos', rate: l.rounded, amount: l.rounded, isShared: !!l.isShared })) };
  return { s, rows: [{ lineKey: '', description: est.header.description, qty: 1, unit: 'Nos', rate: s.subtotal, amount: s.subtotal }] };
}

export const quotationsOf = no => store.list('quotations', q => q.no === no).sort((a, b) => a.rev - b.rev);
export const currentQuotation = enqId => store.list('quotations', q => q.enquiryId === enqId && q.status !== 'Superseded').sort((a, b) => b.rev - a.rev)[0] || null;
// The newest revision whatever its status (gives the number and the next revision).
export const lastQuotation = enqId => store.list('quotations', q => q.enquiryId === enqId).sort((a, b) => b.rev - a.rev)[0] || null;
const CLOSED = ['Accepted', 'Rejected'];

// Create the quotation (or its next revision) from an estimate revision. Returns null when the enquiry's
// quotation is already accepted or rejected (an accepted quotation is never replaced).
export function createFromEstimate(estId) {
  const est = store.get('estimates', estId);
  if (est.quotationId) return store.get('quotations', est.quotationId);
  const enq = store.get('enquiries', est.enquiryId);
  const prev = lastQuotation(est.enquiryId);
  if (prev && CLOSED.includes(prev.status)) return null;
  const customer = store.get('customers', est.customerId);
  const { site } = findSite(est.siteId);
  const { texts, validity } = quoteTerms();
  const { s, rows } = rowsFromEstimate(est);
  const date = todayIso();
  const prevEst = prev ? store.get('estimates', prev.estimateId) : null;
  const sameLines = prevEst && prevEst.lines.map(l => l.key).join() === est.lines.map(l => l.key).join();
  const no = prev?.no || store.nextNumber('QT');
  const rev = prev ? prev.rev + 1 : 1;
  const q = store.insert('quotations', {
    no, rev, estimateId: est.id, estimateNo: `${est.no} Rev ${est.rev}`, enquiryId: est.enquiryId, enquiryNo: enq.no, customerId: est.customerId, siteId: est.siteId,
    customer: est.header.customer, contact: est.header.contact, phone: est.header.phone, site: est.header.site, address: [site?.address, site?.blockUnit].filter(Boolean).join(', '),
    date, validDays: validity, validUntil: addDays(date, validity), paymentTerm: prev?.paymentTerm || customer?.paymentTerm || 'IMMEDIATE',
    costingLevel: est.costingLevel, rows, subtotal: s.subtotal, taxLabel: est.taxLabel, taxRate: est.taxRate, tax: s.tax, total: s.total,
    description: sameLines && prev ? prev.description : est.header.description, findings: sameLines && prev ? prev.findings : est.header.findings,
    terms: prev ? prev.terms : texts, preparedBy: store.currentActor(), prevId: prev?.id || '', termApproved: false, approvals: [], jobId: '',
  }, { status: 'Draft', note: `${no} Rev ${rev} from ${est.no} Rev ${est.rev}` });
  if (prev) supersede(prev, `Revised as Rev ${rev}`);
  store.update('estimates', est.id, { quotationId: q.id }, false);
  store.setStatus('estimates', est.id, 'Quoted', `${no} Rev ${rev}`);
  return q;
}

function supersede(q, note) {
  cancelTasksFor('quotation', q.id, note);
  store.setStatus('quotations', q.id, 'Superseded', note);
}

// Wording-only revision (prices unchanged): a new revision with the same rows, back to the counter-check.
export function reviseWording(id) {
  const cur = store.get('quotations', id);
  if (CLOSED.includes(cur.status) || cur.status === 'Superseded') return cur;
  const copy = structuredClone(cur);
  ['id', 'tenantId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'status', 'statusHistory', 'sentAt', 'sentVia', 'acceptance'].forEach(k => delete copy[k]);
  const date = todayIso();
  const q = store.insert('quotations', { ...copy, rev: cur.rev + 1, prevId: cur.id, date, validUntil: addDays(date, cur.validDays), termApproved: false, approvals: [], returnNote: null },
    { status: 'Draft', note: `${cur.no} Rev ${cur.rev + 1} (wording)` });
  supersede(cur, `Revised as Rev ${cur.rev + 1}`);
  store.update('estimates', cur.estimateId, { quotationId: q.id }, false);
  return q;
}

export const canEdit = q => EDITABLE.includes(q.status) && auth.can('quotation', 'edit');
export function saveWording(id, patch) {
  const q = store.get('quotations', id);
  if (!EDITABLE.includes(q.status)) return q;
  const next = { ...patch };
  if (patch.date) next.validUntil = addDays(patch.date, q.validDays);
  return store.update('quotations', id, next, false);
}

const info = q => ({ docNo: `${q.no} Rev ${q.rev}`, title: `Counter-check ${q.no} Rev ${q.rev}`, customer: q.customer, amount: q.total });

// Submit for the counter-check: the approval rules decide the levels (flow step 5).
export function submitForCheck(id) {
  const q = store.get('quotations', id);
  if (!EDITABLE.includes(q.status)) return q;
  store.update('quotations', id, { submittedAt: new Date().toISOString(), submittedBy: store.currentActor(), returnNote: null }, `${q.no} Rev ${q.rev} submitted for the counter-check`);
  const { task } = startApproval('quotation', q, info(q));
  if (!task) return approveFinal(q.id);
  store.setStatus('quotations', id, 'Submitted', `Waiting for ${task.roleName}`);
  store.setStatus('enquiries', q.enquiryId, 'Quotation in check', `${q.no} Rev ${q.rev}`);
  return store.get('quotations', id);
}

function approveFinal(id) {
  const q = store.get('quotations', id);
  store.update('quotations', id, { termApproved: q.paymentTerm !== 'IMMEDIATE', approvedAt: new Date().toISOString() }, false);
  store.setStatus('quotations', id, 'Approved', 'Counter-checked; ready to send');
  store.setStatus('enquiries', q.enquiryId, 'Quotation approved', `${q.no} Rev ${q.rev} ready to send`);
  return store.get('quotations', id);
}

// The Approver's decision on a quotation task: approve moves to the next level or finishes; return goes back to
// the Operations Executive with the comment (shown on the quotation and the estimate).
export function decideQuotation(taskId, decision, comment = '') {
  const t = closeTask(taskId, decision, comment);
  if (!t) return null;
  const q = store.get('quotations', t.docId);
  if (q.status !== 'Submitted') return q;
  const entry = { level: t.level, role: t.roleName, by: store.currentActor(), at: t.doneAt, decision, comment };
  store.update('quotations', q.id, { approvals: [...(q.approvals || []), entry] }, `${decision === 'return' ? 'Returned' : 'Approved'} at level ${t.level}${comment ? `: ${comment}` : ''}`);
  if (decision === 'return') {
    const note = { by: store.currentActor(), at: t.doneAt, comment, rev: q.rev };
    store.update('quotations', q.id, { returnNote: note }, false);
    store.update('estimates', q.estimateId, { returnNote: note }, false);
    store.setStatus('quotations', q.id, 'Returned', comment);
    store.setStatus('enquiries', q.enquiryId, 'Estimating', `${q.no} Rev ${q.rev} returned`);
    return store.get('quotations', q.id);
  }
  const next = levelsFor('quotation', q).find(l => l.level > t.level);
  if (next) { openLevel('quotation', q, next, info(q)); return store.get('quotations', q.id); }
  return approveFinal(q.id);
}

// Send is locked until the counter-check is done (flow step 5: no quote goes out unchecked).
export const canSend = q => ['Approved', 'Sent'].includes(q.status) && auth.can('quotation', 'edit');
export function markSent(id, via) {
  const q = store.get('quotations', id);
  if (!['Approved', 'Sent'].includes(q.status)) return q;
  // The first send is the date of issue: the validity days count from it, not from the draft date.
  const issue = q.sentAt ? {} : { date: todayIso(), validUntil: addDays(todayIso(), q.validDays) };
  store.update('quotations', id, { ...issue, sentAt: new Date().toISOString(), sentVia: via, sentBy: store.currentActor() }, `${q.no} Rev ${q.rev} sent by ${via}`);
  store.setStatus('quotations', id, 'Sent', via);
  store.update('enquiries', q.enquiryId, { stage: 'Quoted' }, false);
  store.setStatus('enquiries', q.enquiryId, 'Quoted', `${q.no} Rev ${q.rev}`);
  return store.get('quotations', id);
}

// Accept (flow step 6). lineKeys: the accepted lines (Line costing); fewer than all = partial acceptance, which
// revises the estimate without the other lines and returns the next quotation revision for the counter-check.
export function accept(id, { method, poNo, poDate, contact, attachments = [], paymentTerm, lineKeys }) {
  const q = store.get('quotations', id);
  if (q.status !== 'Sent') return { error: 'Only a counter-checked quotation that was sent can be accepted.', quotation: q };
  const priced = q.rows.filter(r => r.lineKey && !r.isShared).map(r => r.lineKey);
  const rejected = lineKeys ? priced.filter(k => !lineKeys.includes(k)) : [];
  if (rejected.length && rejected.length < priced.length) {
    const est = reviseEstimate(q.estimateId, { without: rejected, note: `customer accepted ${priced.length - rejected.length} of ${priced.length} lines` });
    const next = createFromEstimate(est.id);
    store.update('quotations', next.id, { partialFrom: `${q.no} Rev ${q.rev}`, paymentTerm: paymentTerm || q.paymentTerm }, `Partial acceptance of ${q.no} Rev ${q.rev}`);
    return { partial: true, quotation: store.get('quotations', next.id) };
  }
  const termChanged = paymentTerm && paymentTerm !== q.paymentTerm;
  store.update('quotations', id, {
    acceptance: { at: new Date().toISOString(), by: store.currentActor(), method, poNo, poDate, contact, attachments },
    ...(termChanged ? { paymentTerm, termApproved: false } : {}),
  }, `${q.no} Rev ${q.rev} accepted by ${method}${poNo ? ` (PO ${poNo})` : ''}`);
  store.setStatus('quotations', id, 'Accepted', poNo ? `PO ${poNo}` : method);
  store.update('enquiries', q.enquiryId, { stage: 'Won' }, false);
  store.setStatus('enquiries', q.enquiryId, 'Won', `${q.no} Rev ${q.rev} accepted`);
  const job = createJobFromQuotation(store.get('quotations', id));
  store.update('quotations', id, { jobId: job.id }, false);
  // A term changed at acceptance needs its own approval before scheduling (flow step 6).
  if (job.paymentTerm !== 'IMMEDIATE' && !job.termApproved) openTermTask(job);
  return { partial: false, quotation: store.get('quotations', id), job };
}

export function reject(id, reason) {
  const q = store.get('quotations', id);
  store.setStatus('quotations', id, 'Rejected', reason);
  store.update('enquiries', q.enquiryId, { stage: 'Lost' }, false);
  store.setStatus('enquiries', q.enquiryId, 'Lost', reason || 'Quotation rejected');
}

// Sent quotations past their valid-until date turn "Expired"; Revise renews them with a new date.
export function refreshExpiry() {
  const t = todayIso();
  store.list('quotations', q => q.status === 'Sent' && q.validUntil < t)
    .forEach(q => store.setStatus('quotations', q.id, 'Expired', `Valid until ${q.validUntil}`));
}

// What the system checks before the Approver looks (flow step 5: customer, site, items, price, GST).
// tone: ok | warn
export function autoChecks(q) {
  const est = store.get('estimates', q.estimateId);
  const enq = store.get('enquiries', q.enquiryId);
  const rep = est?.reportId ? store.get('siteReports', est.reportId) : null;
  const out = [];
  const add = (ok, text) => out.push({ tone: ok ? 'ok' : 'warn', text });
  add(q.customerId === enq.customerId && q.siteId === enq.siteId, `Customer, contact and site match ${enq.no}`);
  if (rep) {
    const tags = rep.shutters.map(s => s.tag).sort().join(', ');
    add(est.shutters.map(s => s.tag).sort().join(', ') === tags, `Shutters match the site report ${rep.no} (${tags || 'none'})`);
    const names = rep.s5.rows.filter(r => r.name).map(r => r.name.toLowerCase());
    const hit = est.materials.filter(m => names.includes(m.name.toLowerCase())).length;
    add(hit === names.length, `Materials match the site report (${hit} of ${names.length})`);
  } else add(false, 'No site report: lines were taken from the enquiry');
  add(Math.abs(estimateSummary(est).subtotal - q.subtotal) < 0.005, `Prices match ${q.estimateNo}`);
  const tax = companyTax();
  add(q.taxRate === tax.taxRate, q.taxRate ? `${q.taxLabel} ${q.taxRate} % from the Tax master (${tax.taxCode})` : 'No tax charged (Company Setup)');
  const termCount = store.list('terms', t => t.docType === 'Quotation' && t.isDefault && t.status !== 'Inactive').length;
  add(q.terms.length >= termCount, `All ${termCount} quotation terms included`);
  const ph = est.materials.filter(m => m.placeholder || m.noRate);
  if (ph.length) add(false, `${ph.length} placeholder rate${ph.length > 1 ? 's' : ''}: ${ph.map(m => `${m.name} (${Number(m.rate).toFixed(2)})`).join(', ')}`);
  add(q.paymentTerm === 'IMMEDIATE', q.paymentTerm === 'IMMEDIATE' ? 'Payment term Immediate: no extra approval needed' : 'Payment term is not immediate: approving also approves the term');
  return out;
}
