// Repair jobs: created when the customer accepts the quotation; scheduled on the board (flow step 7: parts,
// manpower, date; the invoice is raised at scheduling when payment is immediate); done on the phone (step 8:
// photos, Work Done & Customer Feedback form, payment, the office's OK before leaving the site). General Servicing jobs
// (type "GS", one-off servicing without a contract) use the same board and invoice rules; on the phone they follow
// the AMC visit steps (core/visits.js). AMC visits are part of every technician's bookings.
import * as store from './store.js';
import * as auth from './auth.js';
import { findSite, technicians, empName } from './lookups.js';
import { openTask, closeTask, cancelTasksFor, startApproval, levelsFor, openLevel, registerFacts } from './workflow.js';
import { createInvoice, invoiceForJob, paymentsFor, syncDueDate, balanceOf } from './billing.js';
import { ux } from './ux.js';
import { vsLabel } from './lookups.js';
import { round2, amcSiteRow } from './costing.js';
import { snapshot, registerCounts } from './contracts.js';
import { workWeek, isWorkday, nextWorkday } from './setup.js';
import { fmtDate } from './ui.js';
import { rowText } from './enquiries.js';
import { groupsOf, missingGroups } from './products.js';

// The working day comes from Company Setup (default 08:30–17:30, Monday–Saturday).
export const dayStart = () => workWeek().start;
export const dayEnd = () => workWeek().end;
export { isWorkday, nextWorkday };
export const INSPECTION_HOURS = 2;               // a job assessment blocks 2 hours on the board
export const OPEN_JOB = ['To schedule', 'Scheduled', 'On the way', 'On site'];
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (iso, ds) => !!iso && dstr(new Date(iso)) === ds;
const hoursOf = iso => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
export const toIso = (ds, hours) => { const d = new Date(`${ds}T00:00`); d.setMinutes(Math.round(hours * 60)); return d.toISOString(); };
export const fmtHour = h => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;
const ceilHalf = h => Math.ceil(h * 2) / 2;

export const seesJob = j => auth.scope('job') !== 'own' || j.technicianId === auth.user()?.employeeId;
// A job longer than a working day runs over the next working days, as an AMC visit does: each day books its share of
// the work hours plus the round trip. Its days: the site report's days (the estimate's trips), or more when the hours
// do not fit (12.25 h work + 2 h travel = 2 days of 8.5 h).
const dayLength = () => dayEnd() - dayStart() - 0.5;
const fitDays = (work, travel) => { for (let n = 1; n < 30; n++) if (ceilHalf(work / n + travel) <= dayLength() + 0.01) return n; return 30; };
export const jobDays = j => Math.max(Number(j.days) || 1, fitDays(Number(j.workHours) || 0, Number(j.travelHours) || 0));
// The hours the job books on each of its days.
export const jobDuration = j => Math.min(ceilHalf((Number(j.workHours) || 0) / jobDays(j) + (Number(j.travelHours) || 0)), dayLength());
export function workingDays(ds, n) {
  const out = [];
  let d = new Date(`${ds}T00:00`);
  if (!isWorkday(d)) d = nextWorkday(d);
  while (out.length < n) { out.push(dstr(d)); d = nextWorkday(d); }
  return out;
}

const crewOf = (extra, teams = 1) => ({ team: teams, extra,
  label: `${teams > 1 ? `${teams} teams of 1+1` : 'Team 1+1'}${extra ? ` + ${extra} extra worker${extra > 1 ? 's' : ''}` : ''}` });
const EMPTY_RUN = { technicianId: '', helperIds: [], start: null, end: null, invoiceId: '', steps: {}, photosBefore: [], photosAfter: [], workDone: null, leaveSite: null };

// A repair job's details from the accepted quotation (nothing saved): lines, crew, hours and parts from the estimate.
function repairFields(q) {
  const est = store.get('estimates', q.estimateId);
  const enq = store.get('enquiries', q.enquiryId);
  const { site } = findSite(q.siteId);
  const zone = store.get('zones', site?.zoneId || enq.zoneId);
  // Accepted in part (core/later-work.js): only the "Now" lines, their labour and parts; shared rows (transport) stay.
  const inJob = key => !q.split || !key || q.split.keys.includes(key);
  const labour = est.labour.filter(r => inJob(r.lineKey));
  // Every team row counts (a row whose Team was changed from 1 too): its hours are the time the teams work.
  const teamRows = labour.filter(r => Number(r.team) > 0 && !/additional/i.test(r.trade));
  const teams = Math.max(1, ...teamRows.map(r => Number(r.team) || 1));
  const trips = Math.max(1, ...est.transport.filter(t => inJob(t.lineKey)).map(t => Number(t.trips) || 1));
  const extra = Math.max(0, ...labour.filter(r => /additional/i.test(r.trade)).map(r => Number(r.team) || 0));
  // The quotation's wording; a row that shows its own qty ("Tension spring: worn · 2 Nos") gets the count back.
  const lines = q.costingLevel === 'LINE' ? (q.split?.rows || q.rows).filter(r => !r.isShared).map(r => ({ key: r.lineKey, description: rowText(r) }))
    : est.lines.map(l => ({ key: l.key, description: l.description }));
  // Only fixed-price products (a submission, a design): no site visit; the office marks the work done.
  const taken = est.lines.filter(l => inJob(l.key));
  const noVisit = taken.length > 0 && taken.every(l => (est.fixed || []).some(f => f.lineKey === l.key));
  return {
    type: 'REPAIR', enquiryId: q.enquiryId, enquiryNo: q.enquiryNo, quotationId: q.id, quotationNo: `${q.no} Rev ${q.rev}`, estimateId: est.id,
    customerId: q.customerId, customer: q.customer, contact: q.contact, phone: q.phone, siteId: q.siteId, site: q.site, address: q.address, zoneId: zone?.id || '',
    tags: est.shutters.filter(s => inJob(s.key) && s.tag).map(s => s.tag), subject: q.split ? lines.map(l => l.description).join('; ') : q.description, lines,
    groups: groupsOf(est.shutters.filter(s => inJob(s.key)).map(s => s.productId)), noVisit,
    crew: crewOf(extra, teams), days: trips,
    workHours: round2(teamRows.reduce((t, r) => t + (Number(r.hrs) || 0) + (Number(r.otHrs) || 0), 0)), travelHours: Number(zone?.roundTripHours) || 0,
    parts: est.materials.filter(m => inJob(m.lineKey)).map(m => ({ key: m.key, itemId: m.itemId, name: m.name, qty: m.qty, unit: m.unit, leadDays: m.leadDays, ready: !m.leadDays })),
    paymentTerm: q.paymentTerm, termApproved: q.paymentTerm === 'IMMEDIATE' || !!q.termApproved, total: q.split?.total ?? q.total,
  };
}

// Create the job from the accepted quotation.
export function createJobFromQuotation(q) {
  const no = store.nextNumber('JOB');
  return store.insert('jobs', { no, ...repairFields(q), ...EMPTY_RUN }, { status: 'To schedule', note: `${no} created from ${q.no} Rev ${q.rev}` });
}

// A General Servicing job's details (one site, one visit, no contract): the covered products, their AMC servicing
// hours, crew and travel from the estimate.
function gsFields(q, shutters) {
  const est = store.get('estimates', q.estimateId);
  const enq = store.get('enquiries', q.enquiryId);
  const s = est.sites[0];
  const { site } = findSite(s.siteId);
  const zone = store.get('zones', s.zoneId || enq.zoneId);
  const r = amcSiteRow(s, est.matrix);
  const extra = Math.max(0, ...est.matrix.sizes.filter(z => Number(s.counts?.[z.key || z.code]) > 0).map(z => Number(z.extraWorkers) || 0));
  const lines = q.costingLevel === 'LINE' ? q.rows.filter(x => !x.isShared).map(x => ({ key: x.lineKey, description: x.description })) : [{ key: 'gs', description: q.description }];
  return {
    type: 'GS', enquiryId: q.enquiryId, enquiryNo: q.enquiryNo, quotationId: q.id, quotationNo: `${q.no} Rev ${q.rev}`, estimateId: est.id,
    customerId: q.customerId, customer: q.customer, contact: q.contact, phone: q.phone, siteId: s.siteId, site: s.name, address: [site?.address, site?.blockUnit].filter(Boolean).join(', '), zoneId: zone?.id || '',
    tags: shutters.map(x => x.tag), subject: q.description, lines, shutters, checklist: {}, safeIsolation: false,
    crew: crewOf(extra), workHours: round2(r.hrsVisit), travelHours: Number(zone?.roundTripHours) || 0,
    parts: (est.materials || []).map(m => ({ key: m.key, itemId: m.itemId, name: m.name, qty: m.qty, unit: m.unit, leadDays: m.leadDays || 0, ready: !m.leadDays })),
    paymentTerm: q.paymentTerm, termApproved: q.paymentTerm === 'IMMEDIATE' || !!q.termApproved, total: q.total,
  };
}

export function createGsJob(q) {
  const s = store.get('estimates', q.estimateId).sites[0];
  // Typed counts (no shutter register yet) are added to the register now, so the check list has its shutters.
  const shutters = snapshot(s.siteId, s.typed ? registerCounts(q.customerId, s.siteId, s.counts, `general servicing ${q.no}`) : s.shutterIds || []);
  const no = store.nextNumber('JOB');
  return store.insert('jobs', { no, ...gsFields(q, shutters), ...EMPTY_RUN }, { status: 'To schedule', note: `${no} (general servicing) created from ${q.no} Rev ${q.rev}` });
}

// The job a quotation would make, before it exists (Record acceptance's "Assign technician now"): hours, crew, parts,
// zone and term, with the "Now" items of a split and the payment term chosen in the popup. Nothing is saved.
export function jobDraft(q, { split = null, paymentTerm = q.paymentTerm } = {}) {
  const src = { ...q, split, paymentTerm, termApproved: paymentTerm === q.paymentTerm && !!q.termApproved };
  return { id: '', ...EMPTY_RUN, ...(q.type === 'GS' ? gsFields(src, []) : repairFields(src)) };
}
// A non-immediate term that an approval rule stops before scheduling (changed at acceptance; rule JOB_TERM).
export const termBlocks = job => job.paymentTerm !== 'IMMEDIATE' && !job.termApproved && levelsFor('job', job).length > 0;

// ---------- Parts and the earliest date (flow step 7: confirm spare parts availability) ----------
export function setPartReady(jobId, key, ready) {
  const j = store.get('jobs', jobId);
  store.update('jobs', jobId, { parts: j.parts.map(p => (p.key === key ? { ...p, ready } : p)) }, `${j.parts.find(p => p.key === key)?.name}: ${ready ? 'in stock' : 'to order'}`);
}
// Earliest date: today (same-day repairs) when every part is in stock, else today + the longest lead time.
// Days off (Company Setup's working week) are skipped.
export function earliestDate(job, from = new Date()) {
  const lead = Math.max(0, ...job.parts.filter(p => !p.ready).map(p => Number(p.leadDays) || 0));
  const base = new Date(from); base.setHours(0, 0, 0, 0);
  if (lead) base.setDate(base.getDate() + lead);
  return dstr(isWorkday(base) ? base : nextWorkday(base));
}
export const partsReadyBy = (job, ds) => earliestDate(job) <= ds;

// ---------- The board: what each technician already has on a day ----------
export function bookings(techId, ds, exceptJobId = '') {
  const jobs = store.list('jobs', j => j.technicianId === techId && j.id !== exceptJobId && j.start && j.status !== 'Cancelled'
    && (j.blocks?.length ? j.blocks.some(b => b.date === ds) : sameDay(j.start, ds)))
    .flatMap(j => (j.blocks?.length ? j.blocks.filter(b => b.date === ds).map((b, i) => ({ from: b.from, to: b.to, day: j.blocks.indexOf(b) + 1, of: j.blocks.length })) : [{ from: hoursOf(j.start), to: hoursOf(j.end) }])
      .map(b => ({ kind: 'job', id: j.id, no: b.of > 1 ? `${j.no} (day ${b.day} of ${b.of})` : j.no, title: j.customer, zoneId: j.zoneId, from: b.from, to: b.to, status: j.status })));
  const insp = store.list('inspections', i => i.technicianId === techId && i.visitAt && sameDay(i.visitAt, ds) && i.status !== 'Cancelled')
    .map(i => { const e = store.get('enquiries', i.enquiryId); return { kind: 'inspection', id: i.id, no: e?.no || '', title: e?.customerName || '', zoneId: i.zoneId, from: hoursOf(i.visitAt), to: hoursOf(i.visitAt) + INSPECTION_HOURS, status: i.status }; });
  const amc = store.list('amcVisits', v => v.technicianId === techId && v.id !== exceptJobId && v.status !== 'Cancelled' && (v.blocks || []).some(b => b.date === ds))
    .flatMap(v => v.blocks.filter(b => b.date === ds).map(b => ({ kind: 'amc', id: v.id, no: `${v.contractNo} visit ${v.n}`, title: v.customer, zoneId: v.zoneId, from: b.from, to: b.to, status: v.status })));
  return [...jobs, ...insp, ...amc].sort((a, b) => a.from - b.from);
}
// First free start time on a day for a block of `hours`, or null. Today starts no earlier than now.
const earliestStart = ds => Math.max(dayStart() + 0.5, ds === dstr(new Date()) ? ceilHalf(hoursOf(new Date().toISOString())) : 0);
export function freeStart(techId, ds, hours, exceptJobId = '') {
  let t = earliestStart(ds); // 09:00, or now
  for (const b of bookings(techId, ds, exceptJobId)) {
    if (b.from >= t + hours) break;
    t = Math.max(t, b.to);
  }
  return t + hours <= dayEnd() + 0.01 ? t : null;
}
const clashOn = (techId, ds, from, hours, exceptJobId) => bookings(techId, ds, exceptJobId).find(b => b.from < from + hours - 0.01 && b.to > from + 0.01);
// The job's days from ds, and the hours booked on each: the first day from its start, the next days from the start of the day.
export const jobBlocks = (job, ds, start, hours = jobDuration(job)) => workingDays(ds, jobDays(job)).map((x, j) => { const from = j ? dayStart() + 0.5 : start; return { date: x, from, to: from + hours }; });
// First free start on ds for the whole job (every one of its days free), or null.
export function freeJobStart(techId, ds, job, hours = jobDuration(job)) {
  const start = freeStart(techId, ds, hours, job.id);
  if (start == null || !isWorkday(new Date(`${ds}T00:00`))) return null;
  return jobBlocks(job, ds, start, hours).slice(1).every(b => !clashOn(techId, b.date, b.from, hours, job.id)) ? start : null;
}
// Suggest a technician (one who works on the job's product groups, then zone first, then free time) and the first day
// the parts are ready.
export function suggestSlot(job, days = 14) {
  const hours = jobDuration(job);
  const techs = technicians().map(t => ({ t, rank: (missingGroups(t, job.groups || []).length ? 3 : 0) + (t.mainZoneId === job.zoneId ? 0 : (t.extraZoneIds || []).includes(job.zoneId) ? 1 : 2) })).sort((a, b) => a.rank - b.rank);
  let d = new Date(`${earliestDate(job)}T00:00`);
  for (let i = 0; i < days; i++, d = nextWorkday(d)) {
    for (const { t } of techs) {
      const start = freeJobStart(t.id, dstr(d), job, hours);
      if (start != null) return { technicianId: t.id, date: dstr(d), start, end: start + hours, hours, days: jobDays(job) };
    }
  }
  return null;
}
// One technician's first free slot for the job (from the day the parts are ready), or null within `days` working days.
export function firstFree(job, techId, days = 14) {
  const hours = jobDuration(job);
  let d = new Date(`${earliestDate(job)}T00:00`);
  for (let i = 0; i < days; i++, d = nextWorkday(d)) {
    const start = freeJobStart(techId, dstr(d), job, hours);
    if (start != null) return { technicianId: techId, date: dstr(d), start, end: start + hours, hours, days: jobDays(job) };
  }
  return null;
}
export const helpers = () => store.list('employees', e => e.type === 'Helper' && e.status !== 'Inactive');
export const defaultHelper = techId => { const t = store.get('employees', techId); return helpers().find(h => h.mainZoneId === t?.mainZoneId) || helpers()[0] || null; };

export function scheduleProblems(job, slot) {
  const p = [];
  if (store.heldByOther('jobs', job.id)) p.push(`The technician's phone is offline with changes to this job; wait until it is back online.`);
  if (!job.termApproved) p.push(job.termNote ? 'The Approver returned the payment term: change it or ask again.' : 'The payment term is not immediate: the Approver must approve it first.');
  if (!slot.technicianId) p.push('Pick a technician.');
  if (slot.date < dstr(new Date())) p.push('Pick today or a later date.');
  else if (slot.start != null && slot.start < earliestStart(slot.date) - 0.01) p.push('That start time has already passed.');
  if (!partsReadyBy(job, slot.date)) p.push(`Parts are not ready before ${earliestDate(job)}. Tick "In stock" or pick a later date.`);
  if (slot.technicianId && slot.date && slot.start != null && slot.hours) {
    const blocks = jobBlocks(job, slot.date, slot.start, slot.hours);
    if (blocks[0].date !== slot.date) p.push(`${fmtDate(slot.date)} is not a working day.`);
    blocks.forEach((b, i) => {
      const clash = clashOn(slot.technicianId, b.date, b.from, slot.hours, job.id);
      const what = clash?.kind === 'job' ? clash.no : clash?.kind === 'amc' ? `AMC visit ${clash.no}` : 'a job assessment';
      if (clash) p.push(`${empName(slot.technicianId)} already has ${what} ${fmtHour(clash.from)}–${fmtHour(clash.to)} ${i ? `on ${fmtDate(b.date)} (day ${i + 1} of the job)` : 'that day'}.`);
    });
  }
  return p;
}

// Schedule (or move) the job. With immediate payment the invoice is raised now, so the technician can collect.
export function scheduleJob(jobId, { technicianId, helperIds = [], date, start, hours, via = '' }) {
  const job = store.get('jobs', jobId);
  const problems = scheduleProblems(job, { technicianId, date, start, hours });
  if (problems.length) return { problems };
  const first = job.status === 'To schedule';
  const blocks = jobBlocks(job, date, start, hours);
  const last = blocks[blocks.length - 1];
  store.update('jobs', jobId, { technicianId, helperIds, blocks, start: toIso(date, start), end: toIso(last.date, last.to) },
    `${first ? 'Scheduled' : 'Moved'}${via ? ` ${via}` : ''}: ${empName(technicianId)}, ${fmtDate(date)} ${fmtHour(start)}–${fmtHour(start + hours)}${blocks.length > 1 ? ` (${blocks.length} days)` : ''}`);
  if (first) store.setStatus('jobs', jobId, 'Scheduled', empName(technicianId));
  let invoice = invoiceForJob(jobId);
  if (job.paymentTerm === 'IMMEDIATE' && !invoice) invoice = createInvoice(jobId, { post: true, note: 'raised at scheduling (payment immediate)' });
  else syncDueDate(jobId); // a moved job moves an immediate invoice's due date with it
  return { problems: [], invoice };
}

// What the approval rules can test on a job (a payment term changed at acceptance; preset rule JOB_TERM).
registerFacts('job', j => {
  const q = store.get('quotations', j.quotationId);
  return { subtotal: q?.subtotal ?? null, total: j.total ?? q?.total, jobType: j.type === 'GS' ? 'GS' : 'REPAIR',
    newCustomer: !store.list('enquiries', e => e.customerId === j.customerId && e.id !== j.enquiryId && e.stage === 'Won').length };
});
// The payment-term approval runs through the rules (docType "job"); with no matching rule the term is approved.
function askTermApproval(j, title) {
  const { task } = startApproval('job', j, { docNo: j.no, title, customer: j.customer, amount: j.total, submittedBy: store.currentActor() });
  if (!task) store.update('jobs', j.id, { termApproved: true, termNote: '' }, 'Payment term: no approval rule applies');
  return task;
}
export const openTermTask = j => askTermApproval(j, `Payment term for ${j.no}`);

export function approveJobTerm(taskId, decision, comment) {
  const t = closeTask(taskId, decision, comment);
  if (!t) return;
  if (decision !== 'approve') { store.update('jobs', t.docId, { termNote: comment }, `Payment term returned: ${comment}`); return; }
  const j = store.get('jobs', t.docId);
  const next = levelsFor('job', j).find(l => l.level > t.level);
  if (next) { openLevel('job', j, next, { docNo: j.no, title: t.title, customer: j.customer, amount: j.total, submittedBy: t.submittedBy }); return; }
  store.update('jobs', t.docId, { termApproved: true, termNote: '' }, `Payment term approved${comment ? `: ${comment}` : ''}`);
}

// After the Approver returns a term: change it (Immediate needs no approval) or ask again with the same term.
export function changeJobTerm(jobId, term) {
  const j = store.get('jobs', jobId);
  const immediate = term === 'IMMEDIATE';
  store.update('jobs', jobId, { paymentTerm: term, termApproved: immediate, termNote: '' }, immediate ? 'Payment term changed to Immediate' : `Payment term ${term} sent to the Approver again`);
  if (!immediate) askTermApproval(store.get('jobs', jobId), `Payment term for ${j.no} (asked again)`);
}

// Cancelling a job cancels its invoice (the number is kept), closes its open tasks and marks the enquiry Lost.
// Refused once a payment is recorded (no refunds in the prototype). Returns an error text or ''.
export function cancelJob(jobId, reason) {
  const j = store.get('jobs', jobId);
  if (store.heldByOther('jobs', jobId)) return `The technician's phone is offline with changes to this job; wait until it is back online.`;
  const paid = invoiceForJob(jobId);
  if (paid && paymentsFor(paid.id).length) return `${paid.no} already has a payment, so the job cannot be cancelled.`;
  store.setStatus('jobs', jobId, 'Cancelled', reason);
  const inv = invoiceForJob(jobId);
  if (inv && inv.status !== 'Cancelled') store.setStatus('invoices', inv.id, 'Cancelled', `Job cancelled: ${reason}`);
  cancelTasksFor('job', jobId, 'Job cancelled');
  store.update('enquiries', j.enquiryId, { stage: 'Lost' }, false);
  store.setStatus('enquiries', j.enquiryId, 'Lost', `${j.no} cancelled: ${reason}`);
  return '';
}

// ---------- On the phone ----------
export const saveJob = (id, patch) => store.update('jobs', id, patch, false);
const nowIso = () => new Date().toISOString();
const hhmm = iso => fmtHour(hoursOf(iso));

export function onMyWay(jobId) {
  const j = store.get('jobs', jobId);
  store.update('jobs', jobId, { steps: { ...j.steps, onMyWayAt: nowIso() } }, 'Technician on the way');
  store.setStatus('jobs', jobId, 'On the way');
}
// Undo of an "On my way" tapped a moment ago (UX audit, finding 3): the job waits as scheduled again.
export function undoOnMyWay(jobId) {
  const j = store.get('jobs', jobId);
  if (j?.status !== 'On the way') return false;
  const steps = { ...j.steps };
  delete steps.onMyWayAt;
  store.update('jobs', jobId, { steps }, 'Undo: not on the way yet');
  store.setStatus('jobs', jobId, 'Scheduled', 'Undo');
  return true;
}
// unanswered: the phone starts every "Works done" line with no status picked (finding 17).
export function checkIn(jobId, { unanswered = false } = {}) {
  const j = store.get('jobs', jobId);
  const at = nowIso();
  const wd = j.workDone || workDoneFor(j, { unanswered });
  store.update('jobs', jobId, { steps: { ...j.steps, checkInAt: at }, workDone: { ...wd, s1: { ...wd.s1, timeIn: hhmm(at) } } }, 'Checked in on site');
  store.setStatus('jobs', jobId, 'On site');
}
// Undo of a check-in tapped a moment ago, while the form is not signed (finding 17): Time In is cleared.
export function undoCheckIn(jobId) {
  const j = store.get('jobs', jobId);
  if (j?.status !== 'On site' || j.workDone?.signedAt) return false;
  const steps = { ...j.steps };
  delete steps.checkInAt;
  store.update('jobs', jobId, { steps, workDone: j.workDone ? { ...j.workDone, s1: { ...j.workDone.s1, timeIn: '' } } : null }, 'Undo: not checked in yet');
  store.setStatus('jobs', jobId, 'On the way', 'Undo');
  return true;
}

// The Work Done & Customer Feedback form, pre-filled: section 1 from the job, section 2 one row per line,
// section 4 names from the technician's record and the customer contact. Each line starts as "Done"; with
// unanswered (the phone) it starts with no status, and signing asks for it.
export function workDoneFor(j, { unanswered = false } = {}) {
  const tech = store.get('employees', j.technicianId);
  const enq = store.get('enquiries', j.enquiryId);
  const contact = store.get('customers', j.customerId)?.contacts?.find(c => c.id === enq?.contactId);
  return {
    s1: { project: j.site, refNo: j.no, customer: j.customer, date: dstr(new Date()), location: [j.address, j.tags.join(', ')].filter(Boolean).join(' · '), subject: j.subject, timeIn: '', timeOut: '' },
    rows: j.lines.map(l => ({ key: l.key, description: l.description, status: unanswered ? '' : 'DONE', remark: '' })),
    partsUsed: j.parts.map(p => ({ key: p.key, name: p.name, qty: p.qty, unit: p.unit, used: true })),
    ratings: { punctuality: 0, quality: 0, staff: 0, overall: 0 }, comments: '',
    tech: { name: tech?.name || '', designation: tech?.designation || '', date: dstr(new Date()), signatureId: null },
    cust: { name: contact?.name || j.contact, designation: contact?.designation || '', date: dstr(new Date()), signatureId: null, stampId: null },
    signedAt: null,
  };
}

// What is missing before the form can be signed, each with the phone step that holds it: [{ key, step, text }].
export function workDoneIssues(j) {
  const w = j.workDone, p = [];
  if (!j.steps?.checkInAt) p.push({ key: 'checkin', step: '', text: 'Check in first.' });
  if (!w) return p.length ? p : [{ key: 'form', step: 'works', text: 'Fill in the Work Done form.' }];
  const open = w.rows.filter(r => !r.status).length;
  if (open) p.push({ key: 'rows', step: 'works', text: `Choose Done, Partly done or Not done for ${open === 1 ? '1 line' : `${open} lines`} of the works done.` });
  if (Object.values(w.ratings).some(v => !v)) p.push({ key: 'ratings', step: 'feedback', text: 'The customer has not rated all 4 categories.' });
  if (!w.tech.signatureId) p.push({ key: 'techSign', step: 'signoff', text: 'The technician must sign (checked by).' });
  if (!w.cust.signatureId) p.push({ key: 'custSign', step: 'signoff', text: 'The customer must sign.' });
  return p;
}
export const workDoneProblems = j => workDoneIssues(j).map(i => i.text);

// Signing completes the work; with a non-immediate term the draft invoice is made now for the office.
export function completeWorkDone(jobId) {
  const j = store.get('jobs', jobId);
  const problems = workDoneProblems(j);
  if (problems.length) return problems;
  store.update('jobs', jobId, { workDone: { ...j.workDone, signedAt: nowIso() } }, 'Work Done form signed by the customer');
  store.setStatus('jobs', jobId, 'Work done');
  store.setStatus('enquiries', j.enquiryId, 'Completed', j.no);
  if (!invoiceForJob(jobId)) createInvoice(jobId, { post: false, note: 'draft made when the Work Done form was signed' });
  return [];
}

// A job of fixed-price products only (a submission, a design) has no site visit: the office marks the work done, and
// the draft invoice is made as when a Work Done form is signed.
export function markDoneNoVisit(jobId, note = '') {
  const j = store.get('jobs', jobId);
  if (!j?.noVisit || j.status !== 'To schedule') return ['Only a job with no site visit, not yet scheduled, can be marked done here.'];
  const w = workDoneFor(j);
  store.update('jobs', jobId, { workDone: { ...w, comments: note, noVisit: true, signedAt: nowIso(), markedBy: store.currentActor() } }, `Work marked done by the office (no site visit)${note ? `: ${note}` : ''}`);
  store.setStatus('jobs', jobId, 'Work done', 'No site visit');
  store.setStatus('enquiries', j.enquiryId, 'Completed', j.no);
  if (!invoiceForJob(jobId)) createInvoice(jobId, { post: false, note: 'draft made when the work was marked done' });
  return [];
}

// Leave site (flow step 8): the technician asks; the Operations Executive confirms (web or phone).
// Who may confirm: the Operations Executive (job edit on all data) or Admin, not the Approver or Management.
export const canConfirmLeave = () => auth.role()?.code === 'ADMIN' || (auth.can('job', 'edit') && auth.scope('job') !== 'own');

// What the office looked at before saying "OK to leave": the form is signed, there is an after photo, and money due
// on the spot has been collected. Each check: { key, ok, text }.
export function leaveChecks(j) {
  const w = j.workDone, inv = invoiceForJob(j.id);
  const after = (j.photosAfter || []).length, before = (j.photosBefore || []).length;
  const owes = !!inv && inv.status === 'Posted' && balanceOf(inv) > 0 && j.paymentTerm === 'IMMEDIATE';
  const cur = auth.company()?.currency || '';
  return [
    { key: 'signed', ok: !!w?.signedAt, text: w?.signedAt ? `Work Done form signed by ${w.cust.name}` : 'Work Done form not signed yet' },
    { key: 'photos', ok: after > 0, text: `${after} after photo${after === 1 ? '' : 's'}, ${before} before` },
    { key: 'payment', ok: !owes, text: inv?.status === 'Posted' ? (balanceOf(inv) <= 0 ? `${inv.no} paid in full` : j.paymentTerm === 'IMMEDIATE' ? `${inv.no}: ${cur} ${balanceOf(inv).toFixed(2)} not collected yet` : `${inv.no}: due in ${vsLabel('PAYMENT_TERMS', j.paymentTerm)}`) : 'Invoice goes out from the office' },
  ];
}
// Returns 'auto' (the app gave the OK: every check passed and the company's working style allows it), 'asked' (a
// task was opened for the office) or '' (not ready). After a "Not yet" from the office the technician can ask again.
export function requestLeave(jobId, { auto = ux().autoLeave } = {}) {
  const j = store.get('jobs', jobId);
  if (!j.workDone?.signedAt) return '';
  if (j.leaveSite?.confirmedAt) return 'auto';
  const failed = leaveChecks(j).filter(c => !c.ok);
  if (j.leaveSite?.requestedAt && !j.leaveSite.declinedAt) {
    // Still waiting for the office, and every check passes now: the app gives the OK and closes the office's task.
    if (!auto || failed.length) return 'asked';
    if (j.leaveSite.taskId) closeTask(j.leaveSite.taskId, 'approve', 'Every check passes: OK given by the app');
    store.update('jobs', jobId, { leaveSite: { ...j.leaveSite, confirmedAt: nowIso(), confirmedBy: null, auto: true } }, 'Leave site: every check passes now, so the app gave the OK');
    return 'auto';
  }
  if (auto && !failed.length) {
    const at = nowIso();
    store.update('jobs', jobId, { leaveSite: { requestedAt: at, taskId: null, confirmedAt: at, confirmedBy: null, auto: true } }, 'Leave site: every check passed, so the app gave the OK');
    return 'auto';
  }
  const task = openTask({ kind: 'leaveSite', docType: 'job', docId: j.id, docNo: j.no, title: `${empName(j.technicianId)} asks to leave ${j.site}`, customer: j.customer, amount: null, level: 1, roleCode: 'OPS', roleName: 'Operations Executive', rules: [], failed: failed.map(c => c.text) });
  store.update('jobs', jobId, { leaveSite: { requestedAt: nowIso(), taskId: task.id, confirmedAt: null, confirmedBy: null } }, 'Leave-site request sent to the office');
  return 'asked';
}
export function confirmLeave(taskId, comment = '') {
  const t = closeTask(taskId, 'approve', comment);
  if (!t) return;
  const j = store.get('jobs', t.docId);
  store.update('jobs', j.id, { leaveSite: { ...j.leaveSite, confirmedAt: t.doneAt, confirmedBy: store.currentActor(), declinedAt: null, declineReason: '' } }, `Leave site confirmed${comment ? `: ${comment}` : ''}`);
}
// "Not yet" from the office, with the reason the technician sees on the phone (UX audit, finding 17).
export function declineLeave(taskId, reason) {
  const t = closeTask(taskId, 'return', reason);
  if (!t) return;
  const j = store.get('jobs', t.docId);
  store.update('jobs', j.id, { leaveSite: { ...j.leaveSite, taskId: null, declinedAt: t.doneAt, declinedBy: store.currentActor(), declineReason: reason } }, `Leave site: not yet (${reason})`);
}
// Undo of an OK given a moment ago, while the technician has not checked out (finding 17).
export function undoConfirmLeave(jobId) {
  const j = store.get('jobs', jobId);
  if (!j?.leaveSite?.confirmedAt || j.steps?.checkOutAt) return false;
  const task = openTask({ kind: 'leaveSite', docType: 'job', docId: j.id, docNo: j.no, title: `${empName(j.technicianId)} asks to leave ${j.site}`, customer: j.customer, amount: null, level: 1, roleCode: 'OPS', roleName: 'Operations Executive', rules: [], failed: leaveChecks(j).filter(c => !c.ok).map(c => c.text) });
  store.update('jobs', jobId, { leaveSite: { requestedAt: j.leaveSite.requestedAt, taskId: task.id, confirmedAt: null, confirmedBy: null } }, 'Leave-site OK taken back');
  return true;
}
export function checkOut(jobId) {
  const j = store.get('jobs', jobId);
  if (!j.leaveSite?.confirmedAt || j.steps?.checkOutAt) return;
  const at = nowIso();
  store.update('jobs', jobId, { steps: { ...j.steps, checkOutAt: at }, workDone: { ...j.workDone, s1: { ...j.workDone.s1, timeOut: hhmm(at) } } }, 'Checked out');
}

// Register "Work Completion Status" from the job.
export function workCompletion(j) {
  if (!j || j.status === 'Cancelled') return '';
  if (j.workDone?.signedAt) return 'COMPLETED';
  return ['On the way', 'On site'].includes(j.status) ? 'IN_PROGRESS' : 'NOT_STARTED';
}
export const jobForEnquiry = enqId => store.list('jobs', j => j.enquiryId === enqId && j.status !== 'Cancelled')[0] || null;
