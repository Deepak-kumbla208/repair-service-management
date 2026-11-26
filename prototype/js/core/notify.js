// The bell (UX audit, finding 4): a real list of what happened that this person should know about, newest first:
// a site report came in, a quotation was approved or returned, a technician asks to leave or has left, a payment was
// collected on site, and the approvals waiting for an approver. What arrived since the list was last opened is "new".
import * as store from './store.js';
import * as auth from './auth.js';
import { myTasks } from './workflow.js';
import { empName } from './lookups.js';

const KEY = 'rsmSeen';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
// When this user last looked at a place ('bell', 'home' …); '' if never.
export const seenAt = what => read()[store.currentActor()]?.[what] || '';
export function markSeen(what, at = new Date().toISOString()) {
  const all = read(), u = store.currentActor();
  if (!u) return;
  all[u] = { ...(all[u] || {}), [what]: at };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
}
// The time a record reached its current status.
export const sinceOf = r => r?.statusHistory?.[r.statusHistory.length - 1]?.at || r?.updatedAt || r?.createdAt || '';

export function notifications(days = 5) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const me = store.currentActor();
  const out = [];
  const add = (menu, at, by, title, sub, route, kind = 'info') => { if (at && at >= since && by !== me && auth.can(menu)) out.push({ at, title, sub, route, kind }); };
  const short = name => String(name || '').replace(/ Pte Ltd| LLC/g, '');

  myTasks().forEach(t => out.push({ at: t.createdAt, kind: 'task', route: `tasks/${t.id}`, sub: `${t.docNo} · ${short(t.customer)}`,
    title: t.kind === 'leaveSite' ? t.title : t.kind === 'renewal' || t.kind === 'laterWork' ? t.title : t.docType === 'job' ? `Payment term to approve for ${t.docNo}` : `Quotation ${t.docNo} waits for your approval` }));

  if (auth.can('estimation', 'create')) store.list('siteReports', r => r.status === 'Submitted').forEach(r => {
    const e = store.get('enquiries', r.enquiryId);
    if (e) add('enquiry', r.submittedAt, r.updatedBy, `Site report received: ${r.no}`, `${e.no} · ${short(e.customerName)} · ready for the estimate`, `enquiries/${e.id}`, 'report');
  });
  if (auth.can('quotation', 'edit')) store.list('quotations', q => q.status !== 'Superseded').forEach(q => {
    const last = (q.approvals || [])[(q.approvals || []).length - 1];
    if (q.status === 'Approved' && last) add('quotation', last.at, last.by, `Quotation approved: ${q.no} Rev ${q.rev}`, `${short(q.customer)} · ready to send`, `quotations/${q.id}`, 'ok');
    if (q.status === 'Returned' && q.returnNote) add('quotation', q.returnNote.at, q.returnNote.by, `Quotation returned: ${q.no} Rev ${q.rev}`, `${short(q.customer)} · ${q.returnNote.comment || 'see the comment'}`, `quotations/${q.id}`, 'warn');
  });
  if (auth.can('job', 'edit') && auth.scope('job') !== 'own') store.list('jobs', j => j.status !== 'Cancelled').forEach(j => {
    const l = j.leaveSite;
    if (l?.auto && l.confirmedAt) add('job', l.confirmedAt, j.updatedBy === me ? '' : j.updatedBy, `${empName(j.technicianId)} left ${j.site}`, `${j.no} · every check passed, so the app gave the OK`, `jobs/${j.id}`, 'ok');
    else if (j.workDone?.signedAt && !j.workDone.noVisit && !l?.requestedAt) add('job', j.workDone.signedAt, '', `Work done and signed: ${j.no}`, `${short(j.customer)} · ${empName(j.technicianId)}`, `jobs/${j.id}`, 'ok');
  });
  if (auth.can('payment')) store.list('payments', p => p.via === 'phone').forEach(p => {
    const inv = store.get('invoices', p.invoiceId);
    if (inv) add('payment', p.createdAt, p.createdBy, `Payment collected on site: ${p.no}`, `${inv.no} · ${short(inv.customer)} · ${Number(p.amount).toFixed(2)}`, `invoices/${inv.id}`, 'ok');
  });
  // Before the list was ever opened, only the last few hours count as new (not days of history).
  const seen = seenAt('bell') || new Date(Date.now() - 6 * 3600000).toISOString();
  return out.sort((a, b) => b.at.localeCompare(a.at)).map(n => ({ ...n, unread: n.at > seen }));
}
// The number on the bell: what is new since the list was last opened, plus anything still waiting for a decision.
export function bellCount() {
  const list = notifications();
  return list.filter(n => n.unread || n.kind === 'task').length;
}
