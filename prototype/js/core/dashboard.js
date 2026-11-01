// Dashboard figures (Stretch 3 Part B), kept apart from the screens. Definitions (Part B plan check, problem 25):
// revenue = posted invoices before tax, by invoice date (cancelled ones left out); conversion = quotations accepted ÷
// quotations decided (accepted, rejected or expired) in the period; money owed = balance of posted invoices; zone = the
// zone of the document's enquiry site; rating = the overall rating on Work Done forms and AMC / GS sign-offs.
import * as store from './store.js';
import * as auth from './auth.js';
import { openInvoices } from './billing.js';
import { daysLeft, todayStr, addMonths, addDays } from './contracts.js';
import { isOverdue, visitDate, DONE_VISIT } from './visits.js';
import { estimateSummary } from './estimates.js';
import { myTasks } from './workflow.js';
import { fmtDate } from './ui.js';

const ym = ds => String(ds || '').slice(0, 7);
const zoneOf = enquiryId => store.get('enquiries', enquiryId)?.zoneId || '';
const DONE_JOB = ['Work done', 'Completed & documented', 'Closed'];
export const STAGES = ['New', 'Inspection', 'Quoted', 'Won', 'Lost'];

// The months of a period, oldest first ('month' shows the last 6 months with this month highlighted).
export function periodMonths(period) {
  const n = period === '12m' ? 12 : 6;
  const first = addMonths(`${ym(todayStr())}-01`, -(n - 1));
  return Array.from({ length: n }, (_, i) => ym(addMonths(first, i)));
}
export const periodStart = period => (period === 'month' ? `${ym(todayStr())}-01` : `${periodMonths(period)[0]}-01`);
const inPeriod = (ds, period) => !!ds && String(ds).slice(0, 10) >= periodStart(period) && String(ds).slice(0, 10) <= todayStr();

const postedInvoices = (zone = '') => store.list('invoices', i => !!i.no && i.status !== 'Cancelled' && (!zone || zoneOf(i.enquiryId) === zone));
export function revenueByMonth(period, zone = '') {
  const months = periodMonths(period), sums = Object.fromEntries(months.map(m => [m, 0]));
  postedInvoices(zone).forEach(i => { const m = ym(i.date); if (m in sums) sums[m] += Number(i.subtotal) || 0; });
  return months.map(m => ({ month: m, amount: Math.round(sums[m] * 100) / 100 }));
}
export const revenue = (period, zone = '') => Math.round(postedInvoices(zone).filter(i => inPeriod(i.date, period)).reduce((t, i) => t + (Number(i.subtotal) || 0), 0) * 100) / 100;

// Quotations decided in the period: the date of their last status (accepted, rejected or expired).
export function conversion(period, zone = '') {
  const decided = store.list('quotations', q => ['Accepted', 'Rejected', 'Expired'].includes(q.status) && (!zone || zoneOf(q.enquiryId) === zone))
    .filter(q => inPeriod((q.statusHistory || []).slice(-1)[0]?.at, period));
  const won = decided.filter(q => q.status === 'Accepted').length;
  return { won, decided: decided.length, pct: decided.length ? Math.round((won / decided.length) * 100) : null };
}

export function owed(zone = '') {
  const open = openInvoices().filter(o => !zone || zoneOf(o.inv.enquiryId) === zone);
  const buckets = { '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0 };
  open.forEach(o => { buckets[o.bucket] += o.balance; });
  return { total: open.reduce((t, o) => t + o.balance, 0), overdue: open.filter(o => o.dueIn < 0).reduce((t, o) => t + o.balance, 0), count: open.length,
    overdueCount: open.filter(o => o.dueIn < 0).length, buckets };
}

export const amcEnding = (zone = '') => store.list('contracts', c => c.status === 'Active' && daysLeft(c) <= 60 && (!zone || zoneOf(c.enquiryId) === zone)).sort((a, b) => a.end.localeCompare(b.end));
export const visitsOverdue = (zone = '') => store.list('amcVisits', v => isOverdue(v) && (!zone || v.zoneId === zone));

// Overall ratings from signed Work Done forms (repair and GS) and AMC sign-offs.
function ratingRows(period, zone = '') {
  const jobs = store.list('jobs', j => j.workDone?.signedAt && j.workDone?.ratings?.overall && inPeriod(j.workDone.signedAt, period) && (!zone || j.zoneId === zone))
    .map(j => ({ tech: j.technicianId, overall: j.workDone.ratings.overall }));
  const visits = store.list('amcVisits', v => v.signoff?.signedAt && v.signoff?.ratings?.overall && inPeriod(v.signoff.signedAt, period) && (!zone || v.zoneId === zone))
    .map(v => ({ tech: v.technicianId, overall: v.signoff.ratings.overall }));
  return [...jobs, ...visits];
}
const avg = rows => (rows.length ? Math.round((rows.reduce((t, r) => t + r.overall, 0) / rows.length) * 10) / 10 : null);
export const rating = (period, zone = '') => { const rows = ratingRows(period, zone); return { avg: avg(rows), count: rows.length }; };
export function ratingsByTech(period, zone = '') {
  const rows = ratingRows(period, zone);
  return store.list('employees', e => e.type === 'Technician').map(e => { const mine = rows.filter(r => r.tech === e.id); return { id: e.id, name: e.name, avg: avg(mine), count: mine.length }; });
}

export function stages(period, zone = '') {
  const enq = store.list('enquiries', e => inPeriod(e.receivedAt, period) && (!zone || e.zoneId === zone));
  return STAGES.map(s => ({ stage: s, count: enq.filter(e => (e.stage || 'New') === s).length }));
}

// By zone: enquiries received, jobs done, revenue, transport cost of the jobs done (from their estimates), AMC visits.
export function byZone(period) {
  const t = todayStr();
  const rows = store.list('zones', z => z.status !== 'Inactive').sort((a, b) => a.code.localeCompare(b.code)).map(z => {
    const jobs = store.list('jobs', j => j.zoneId === z.id && DONE_JOB.includes(j.status) && inPeriod(j.workDone?.signedAt || j.end, period));
    const transport = jobs.reduce((sum, j) => {
      const q = store.get('quotations', j.quotationId), est = q && store.get('estimates', q.estimateId);
      return sum + (est ? estimateSummary(est).heads?.transport || 0 : 0);
    }, 0);
    const due = store.list('amcVisits', v => v.zoneId === z.id && v.status !== 'Cancelled' && visitDate(v) >= periodStart(period) && visitDate(v) <= t);
    return { zone: z, enquiries: store.list('enquiries', e => e.zoneId === z.id && inPeriod(e.receivedAt, period)).length, jobsDone: jobs.length, revenue: revenue(period, z.id),
      transport: Math.round(transport * 100) / 100, visitsDue: due.length, visitsDone: due.filter(v => DONE_VISIT.includes(v.status)).length, visitsLate: due.filter(isOverdue).length };
  });
  // Documents whose site has no zone yet, so the rows add up to the headline figures.
  const zoneIds = rows.map(x => x.zone.id);
  const none = { zone: { id: '', code: '—', name: 'No zone yet' }, enquiries: store.list('enquiries', e => !zoneIds.includes(e.zoneId) && inPeriod(e.receivedAt, period)).length,
    jobsDone: store.list('jobs', j => !zoneIds.includes(j.zoneId) && DONE_JOB.includes(j.status) && inPeriod(j.workDone?.signedAt || j.end, period)).length,
    revenue: Math.round(postedInvoices().filter(i => !zoneIds.includes(zoneOf(i.enquiryId)) && inPeriod(i.date, period)).reduce((t, i) => t + (Number(i.subtotal) || 0), 0) * 100) / 100,
    transport: 0, visitsDue: 0, visitsDone: 0, visitsLate: 0 };
  return none.enquiries || none.jobsDone || none.revenue ? [...rows, none] : rows;
}

// ---------- Operations Executive: the next actions, most urgent first ----------
// rank: 0 overdue, 1 someone waits now, 2 today's work, 3 the rest. Each item opens its document or list.
export function nextActions() {
  const t = todayStr(), out = [];
  const add = (menu, rank, what, doc, customer, when, route, button, at = '') => { if (auth.can(menu)) out.push({ rank, what, doc, customer, when, route, button, at }); };
  openInvoices().filter(o => o.dueIn < 0).forEach(o => add('payment', 0, 'Invoice not paid', o.inv.no, o.inv.customer, `${-o.dueIn} days late · ${o.balance.toFixed(2)}`, `invoices/${o.inv.id}`, 'Log follow-up', o.inv.dueDate));
  store.list('amcVisits', isOverdue).forEach(v => add('amcScheduling', 0, 'AMC visit not done', `${v.contractNo} · ${v.n} of ${v.of}`, v.customer, `since ${fmtDate(visitDate(v))}`, 'amc-scheduling', 'Assign', visitDate(v)));
  myTasks().filter(x => x.kind === 'leaveSite').forEach(x => add('job', 1, 'Technician asks to leave', x.docNo, x.customer, 'waiting', `tasks/${x.id}`, 'OK to leave', x.createdAt));
  myTasks().filter(x => x.kind === 'renewal').forEach(x => add('amcContract', 2, 'Renew contract', x.docNo, x.customer, x.title.replace(/^.*\((.*)\)$/, '$1'), `tasks/${x.id}`, 'Renew', x.createdAt));
  store.list('quotations', q => q.status === 'Sent' && q.validUntil && q.validUntil <= addDays(t, 2)).forEach(q => add('quotation', 1, 'Quotation expires soon', q.no, q.customer, `valid until ${fmtDate(q.validUntil)}`, `quotations/${q.id}`, 'Chase', q.validUntil));
  store.list('quotations', q => q.status === 'Approved').forEach(q => add('quotation', 2, 'Quotation to send', `${q.no} Rev ${q.rev}`, q.customer, `total ${Number(q.total).toFixed(2)}`, `quotations/${q.id}`, 'Send', q.approvedAt || q.updatedAt));
  store.list('quotations', q => q.status === 'Returned').forEach(q => add('quotation', 2, 'Quotation returned', `${q.no} Rev ${q.rev}`, q.customer, q.returnNote?.comment || 'by the Approver', `quotations/${q.id}`, 'Revise', q.updatedAt));
  store.list('jobs', j => j.status === 'To schedule').forEach(j => add('job', 2, 'Job to schedule', j.no, j.customer, j.termApproved || j.paymentTerm === 'IMMEDIATE' ? 'PO received' : 'waiting for the term approval', 'jobs', 'Schedule', j.createdAt));
  store.list('contracts', c => c.status === 'Draft').forEach(c => add('amcContract', 2, 'Contract to activate', c.no, c.customer, 'PO received', `contracts/${c.id}`, 'Activate', c.createdAt));
  store.list('enquiries', e => ['Inspected', 'BOQ study', 'Waiting for estimate'].includes(e.status)).forEach(e => add('estimation', 3, 'Estimate to make', e.no, e.customerName, e.status === 'Inspected' ? 'report received' : e.status.toLowerCase(), `enquiries/${e.id}`, 'Create estimate', e.receivedAt));
  store.list('inspections', i => i.status === 'To assign').forEach(i => { const e = store.get('enquiries', i.enquiryId); add('inspection', 1, 'Inspection to assign', e?.no || '', e?.customerName || '', 'no technician yet', `inspections/${i.id}`, 'Assign', i.createdAt); });
  const drafts = store.list('invoices', i => i.status === 'Draft');
  if (drafts.length) add('invoice', 3, 'Invoices to post', `${drafts.length} draft${drafts.length > 1 ? 's' : ''}`, [...new Set(drafts.map(i => i.customer))].slice(0, 2).join(', '), `${drafts.filter(i => i.contractId).length} AMC instalment(s)`, 'invoices', 'Post', '');
  store.list('amcVisits', v => v.status === 'Done').forEach(v => add('amcExecution', 3, 'Service report to file', `${v.contractNo} · ${v.n} of ${v.of}`, v.customer, 'signed by the customer', `amc-visits/${v.id}`, 'Check & file', v.updatedAt));
  return out.sort((a, b) => a.rank - b.rank || String(a.at).localeCompare(String(b.at)));
}

// ---------- Approver: tasks and time to decide ----------
export function approverStats() {
  const r = auth.role();
  const mine = store.list('tasks', x => x.kind === 'approval' && (r?.code === 'ADMIN' || x.roleCode === r?.code));
  const since = addDays(todayStr(), -90);
  const decided = mine.filter(x => x.doneAt && x.doneAt.slice(0, 10) >= since);
  const hours = decided.map(x => (new Date(x.doneAt) - new Date(x.createdAt)) / 3600000).sort((a, b) => a - b);
  const median = hours.length ? (hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) : null;
  const waiting = myTasks().filter(x => x.kind === 'approval');
  const higher = store.list('tasks', x => x.kind === 'approval' && x.status === 'Open' && x.roleCode !== r?.code && x.level > 1);
  return { waiting, decided: decided.length, returned: decided.filter(x => x.status === 'Returned').length, median, higher };
}
