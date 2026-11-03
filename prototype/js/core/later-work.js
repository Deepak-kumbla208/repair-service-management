// Some items now, the rest later (user, 3 Nov 2026; mockup mockups/split-acceptance.html). At "Record acceptance" of a
// repair quotation in Line costing, each line is Now, Later or Not wanted. The "Now" lines become the job at the prices
// the customer agreed (no new revision, no second approval); the shared line (transport) goes with them. "Later" lines
// wait on the enquiry with a follow-up date from their priority; the daily check raises a reminder in My tasks, and
// "Quote the rest" makes a linked enquiry whose estimate is pre-filled from the same site report (no second visit).
import * as store from './store.js';
import { productName, vsOptions } from './lookups.js';
import { openTask, closeTask } from './workflow.js';
import { taxTotals, round2 } from './costing.js';
import { saveNewEnquiry, rowText } from './enquiries.js';
import { createEstimate, currentEstimate } from './estimates.js';
import { fmtDate } from './ui.js';

const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (ds, n) => { const d = new Date(`${ds}T00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Follow-up days by the site report's priority (user's choice): Urgent 1 week, Normal 2 weeks, Can wait 4 weeks.
export const LATER_DAYS = { URGENT: 7, NORMAL: 14, LATER: 28 };
export const followUpFor = priorities => addDays(todayStr(), Math.min(...priorities.map(p => LATER_DAYS[p] ?? 14)));
// Why a line is not wanted (Value Set Master "Not Wanted Reason"; the built-in list serves data saved before it existed).
const REASONS = [{ value: 'PRICE', label: 'Price too high' }, { value: 'OTHER_CO', label: 'Another company' }, { value: 'NOT_NEEDED', label: 'Not needed' }, { value: 'OTHER', label: 'Other' }];
export const notWantedReasons = () => { const o = vsOptions('NOT_WANTED_REASON'); return o.length ? o : REASONS; };
export const reasonLabel = code => notWantedReasons().find(o => o.value === code)?.label || code || '';

// One line of a quotation as later work: the product (or part) with its fault, action and priority from the site report.
export function lineInfo(q, lineKey) {
  const est = store.get('estimates', q.estimateId);
  const rep = est?.reportId ? store.get('siteReports', est.reportId) : null;
  const sh = est?.shutters.find(s => s.key === lineKey);
  const found = rep?.shutters.find(s => s.key === lineKey);
  const m = sh ? null : est?.materials.find(x => x.lineKey === lineKey);
  return { shutterKey: sh?.key || '', tag: sh?.tag || '', productId: sh?.productId || '', location: sh?.location || '', sizeCode: sh?.sizeCode || '',
    fault: found?.finding || sh?.fault || '', action: found?.action || '', priority: found?.priority || 'NORMAL',
    part: m ? { itemId: m.itemId, name: m.name, qty: m.qty, unit: m.unit, remarks: m.remarks || '' } : null };
}

// The part of a quotation the customer takes now: its "Now" lines and the shared line, tax worked out on their subtotal.
export function splitOf(q, decisions) {
  const rows = q.rows.filter(r => r.isShared || decisions[r.lineKey] === 'NOW');
  const t = taxTotals(round2(rows.reduce((s, r) => s + r.amount, 0)), q.taxRate);
  return { rows, keys: rows.map(r => r.lineKey), subtotal: t.subtotal, tax: t.tax, total: t.total };
}

// Called when a quotation is accepted in part: the "Later" and "Not wanted" lines are kept on the enquiry.
export function recordLater(q, { decisions, reasons = {}, followUp = '' }) {
  const est = store.get('estimates', q.estimateId);
  const enq = store.get('enquiries', q.enquiryId);
  const item = r => ({ lineKey: r.lineKey, description: rowText(r), amount: r.amount, ...lineInfo(q, r.lineKey) });
  const later = q.rows.filter(r => decisions[r.lineKey] === 'LATER').map(item);
  const no = q.rows.filter(r => decisions[r.lineKey] === 'NO').map(r => ({ ...item(r), reason: reasons[r.lineKey] || '', at: todayStr(), quotationNo: `${q.no} Rev ${q.rev}` }));
  const patch = {};
  if (later.length) {
    patch.laterWork = { status: 'Open', quotationId: q.id, quotationNo: `${q.no} Rev ${q.rev}`, reportId: est?.reportId || '', since: todayStr(),
      followUp: followUp || followUpFor(later.map(i => i.priority)), items: later, taskId: '', enquiryId: '' };
  }
  if (no.length) patch.notWanted = [...(enq.notWanted || []), ...no];
  if (!later.length && !no.length) return;
  const said = [later.length ? `${later.length} item(s) for later, follow up ${fmtDate(patch.laterWork.followUp)}` : '', no.length ? `${no.length} item(s) not wanted` : ''].filter(Boolean).join('; ');
  store.update('enquiries', enq.id, patch, `${q.no} Rev ${q.rev} accepted in part: ${said}`);
}

export const laterTotal = lw => round2((lw?.items || []).reduce((t, i) => t + i.amount, 0));
export const openLater = e => (e?.laterWork?.status === 'Open' ? e.laterWork : null);

// The daily check (run when screens open): a follow-up reminder for the office once the date has come.
export function refreshLaterWork() {
  if (!store.currentTenant()) return;
  const t = todayStr();
  store.list('enquiries', e => openLater(e) && !e.laterWork.taskId && e.laterWork.followUp <= t).forEach(e => {
    const lw = e.laterWork;
    const task = openTask({ kind: 'laterWork', docType: 'enquiry', docId: e.id, docNo: `${e.no} · Later work`, title: `Follow up: ${lw.items.length} item${lw.items.length > 1 ? 's' : ''} waiting since ${fmtDate(lw.since)}`,
      customer: e.customerName, amount: laterTotal(lw), level: 1, roleCode: 'OPS', roleName: store.findOne('roles', r => r.code === 'OPS')?.name || 'Operations Executive', rules: [] });
    store.update('enquiries', e.id, { laterWork: { ...lw, taskId: task.id } }, `Follow-up reminder: ${lw.items.length} item(s) for later`);
  });
}

// Remind again on another date (the open reminder closes; a new one comes on that date).
export function remindLater(enqId, date, note = '') {
  const lw = openLater(store.get('enquiries', enqId));
  if (!lw || !date) return;
  if (lw.taskId) closeTask(lw.taskId, 'approve', `Remind again on ${fmtDate(date)}${note ? `: ${note}` : ''}`);
  store.update('enquiries', enqId, { laterWork: { ...lw, followUp: date, taskId: '' } }, `Later work: follow up on ${fmtDate(date)}${note ? ` (${note})` : ''}`);
}

// The customer does not want the later items after all.
export function dropLaterWork(enqId, reason = 'NOT_NEEDED', note = '') {
  const e = store.get('enquiries', enqId);
  const lw = openLater(e);
  if (!lw) return;
  if (lw.taskId) closeTask(lw.taskId, 'return', note || reasonLabel(reason));
  const no = lw.items.map(i => ({ ...i, reason, at: todayStr(), quotationNo: lw.quotationNo }));
  store.update('enquiries', enqId, { laterWork: { ...lw, status: 'Not wanted', taskId: '' }, notWanted: [...(e.notWanted || []), ...no] },
    `Later work not wanted: ${reasonLabel(reason)}${note ? ` (${note})` : ''}`);
}

// "Quote the rest": a new repair enquiry linked to this one, no site inspection; its estimate takes the products, faults
// and parts from the same site report at today's rates, with its own transport for the second visit.
export function quoteLaterWork(enqId) {
  const e = store.get('enquiries', enqId);
  const lw = e?.laterWork;
  if (!lw) return null;
  const done = lw.enquiryId && store.get('enquiries', lw.enquiryId);
  if (done && !['Lost', 'Cancelled'].includes(done.status)) return { enquiry: done, estimate: currentEstimate(done.id) || createEstimate(done.id) };
  if (lw.status !== 'Open') return null;
  const lines = lw.items.map(i => (i.part ? { itemRef: i.part.itemId ? `itm:${i.part.itemId}` : '', itemName: i.part.name, qty: i.part.qty, unit: i.part.unit, description: i.part.remarks }
    : i.productId ? { itemRef: `prd:${i.productId}`, itemName: productName(i.productId), qty: 1, unit: 'Nos', description: `${i.tag} ${i.location}: ${i.action || i.fault}`.trim() }
      : { itemRef: '', itemName: '', qty: null, description: i.description }));
  const enq = saveNewEnquiry({
    receivedAt: new Date().toISOString(), channel: 'OTHER', channelOther: `Later work from ${e.no}`, type: 'REPAIR', enquiryStatus: 'WARM', priority: 'MEDIUM', siteInspection: 'NO',
    recordedBy: store.currentActor(), remarks: '', attachments: [], customerId: e.customerId, contactId: e.contactId, contactName: e.contactName, mobile: e.mobile, email: e.email, siteId: e.siteId, lines,
  });
  store.update('enquiries', enq.id, { laterOf: { enquiryId: e.id, enquiryNo: e.no, reportId: lw.reportId, shutterKeys: lw.items.filter(i => i.shutterKey).map(i => i.shutterKey),
    parts: lw.items.filter(i => i.part).map(i => i.part) } }, false);
  const est = createEstimate(enq.id);
  if (lw.taskId) closeTask(lw.taskId, 'approve', `Quoted: ${enq.no}`);
  store.update('enquiries', e.id, { laterWork: { ...lw, status: 'Quoted', enquiryId: enq.id, taskId: '' } }, `Later work quoted: ${enq.no}, ${est.no}`);
  return { enquiry: store.get('enquiries', enq.id), estimate: est };
}
