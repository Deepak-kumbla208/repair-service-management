// Repair jobs: created when the customer accepts the quotation; scheduled on the board (flow step 7: parts,
// manpower, date; the invoice is raised at scheduling when payment is immediate); done on the phone (step 8:
// photos, Work Done & Customer Feedback form, payment, the office's OK before leaving the site).
import * as store from './store.js';
import * as auth from './auth.js';
import { findSite, technicians, empName } from './lookups.js';
import { openTask, closeTask } from './workflow.js';
import { createInvoice, invoiceForJob } from './billing.js';
import { round2 } from './costing.js';

const DAY_START = 8.5, DAY_END = 17.5;          // working day 08:30–17:30
export const INSPECTION_HOURS = 2;               // a site inspection blocks 2 hours on the board
export const OPEN_JOB = ['To schedule', 'Scheduled', 'On the way', 'On site'];
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (iso, ds) => !!iso && dstr(new Date(iso)) === ds;
const hoursOf = iso => { const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
export const toIso = (ds, hours) => { const d = new Date(`${ds}T00:00`); d.setMinutes(Math.round(hours * 60)); return d.toISOString(); };
export const fmtHour = h => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;
const ceilHalf = h => Math.ceil(h * 2) / 2;

export const seesJob = j => auth.scope('job') !== 'own' || j.technicianId === auth.user()?.employeeId;
export const jobDuration = j => ceilHalf((Number(j.workHours) || 0) + (Number(j.travelHours) || 0));

// Create the job from the accepted quotation: lines, crew, hours and parts come from the estimate.
export function createJobFromQuotation(q) {
  const est = store.get('estimates', q.estimateId);
  const enq = store.get('enquiries', q.enquiryId);
  const { site } = findSite(q.siteId);
  const zone = store.get('zones', site?.zoneId || enq.zoneId);
  const teamRows = est.labour.filter(r => r.team === 1 && !/additional/i.test(r.trade));
  const extra = Math.max(0, ...est.labour.filter(r => /additional/i.test(r.trade)).map(r => Number(r.team) || 0));
  const lines = q.costingLevel === 'LINE' ? q.rows.filter(r => !r.isShared).map(r => ({ key: r.lineKey, description: r.description }))
    : est.lines.map(l => ({ key: l.key, description: l.description }));
  const no = store.nextNumber('JOB');
  const job = store.insert('jobs', {
    no, type: 'REPAIR', enquiryId: q.enquiryId, enquiryNo: q.enquiryNo, quotationId: q.id, quotationNo: `${q.no} Rev ${q.rev}`, estimateId: est.id,
    customerId: q.customerId, customer: q.customer, contact: q.contact, phone: q.phone, siteId: q.siteId, site: q.site, address: q.address, zoneId: zone?.id || '',
    tags: est.shutters.map(s => s.tag), subject: q.description, lines,
    crew: { team: 1, extra, label: `Team 1+1${extra ? ` + ${extra} extra worker${extra > 1 ? 's' : ''}` : ''}` },
    workHours: round2(teamRows.reduce((t, r) => t + (Number(r.hrs) || 0) + (Number(r.otHrs) || 0), 0)), travelHours: Number(zone?.roundTripHours) || 0,
    parts: est.materials.map(m => ({ key: m.key, itemId: m.itemId, name: m.name, qty: m.qty, unit: m.unit, leadDays: m.leadDays, ready: !m.leadDays })),
    paymentTerm: q.paymentTerm, termApproved: q.paymentTerm === 'IMMEDIATE' || !!q.termApproved, total: q.total,
    technicianId: '', helperIds: [], start: null, end: null, invoiceId: '', steps: {}, photosBefore: [], photosAfter: [], workDone: null, leaveSite: null,
  }, { status: 'To schedule', note: `${no} created from ${q.no} Rev ${q.rev}` });
  return job;
}

// ---------- Parts and the earliest date (flow step 7: confirm spare parts availability) ----------
export function setPartReady(jobId, key, ready) {
  const j = store.get('jobs', jobId);
  store.update('jobs', jobId, { parts: j.parts.map(p => (p.key === key ? { ...p, ready } : p)) }, `${j.parts.find(p => p.key === key)?.name}: ${ready ? 'in stock' : 'to order'}`);
}
export function nextWorkday(d) { const x = new Date(d); do { x.setDate(x.getDate() + 1); } while (x.getDay() === 0); return x; }
// Earliest date: the next working day, or later when a part still has to be ordered (today + its lead days).
export function earliestDate(job, from = new Date()) {
  const lead = Math.max(0, ...job.parts.filter(p => !p.ready).map(p => Number(p.leadDays) || 0));
  let d = nextWorkday(from);
  if (lead) { const r = new Date(from); r.setDate(r.getDate() + lead); if (r > d) d = r.getDay() === 0 ? nextWorkday(r) : r; }
  return dstr(d);
}
export const partsReadyBy = (job, ds) => earliestDate(job) <= ds;

// ---------- The board: what each technician already has on a day ----------
export function bookings(techId, ds, exceptJobId = '') {
  const jobs = store.list('jobs', j => j.technicianId === techId && j.id !== exceptJobId && j.start && sameDay(j.start, ds) && j.status !== 'Cancelled')
    .map(j => ({ kind: 'job', id: j.id, no: j.no, title: j.customer, zoneId: j.zoneId, from: hoursOf(j.start), to: hoursOf(j.end), status: j.status }));
  const insp = store.list('inspections', i => i.technicianId === techId && i.visitAt && sameDay(i.visitAt, ds) && i.status !== 'Cancelled')
    .map(i => { const e = store.get('enquiries', i.enquiryId); return { kind: 'inspection', id: i.id, no: e?.no || '', title: e?.customerName || '', zoneId: i.zoneId, from: hoursOf(i.visitAt), to: hoursOf(i.visitAt) + INSPECTION_HOURS, status: i.status }; });
  return [...jobs, ...insp].sort((a, b) => a.from - b.from);
}
// First free start time on a day for a block of `hours`, or null.
export function freeStart(techId, ds, hours, exceptJobId = '') {
  let t = DAY_START + 0.5; // 09:00
  for (const b of bookings(techId, ds, exceptJobId)) {
    if (b.from >= t + hours) break;
    t = Math.max(t, b.to);
  }
  return t + hours <= DAY_END + 0.01 ? t : null;
}
// Suggest a technician (zone first, then free time) and the first day the parts are ready.
export function suggestSlot(job, days = 14) {
  const hours = jobDuration(job);
  const techs = technicians().map(t => ({ t, rank: t.mainZoneId === job.zoneId ? 0 : (t.extraZoneIds || []).includes(job.zoneId) ? 1 : 2 })).sort((a, b) => a.rank - b.rank);
  let d = new Date(`${earliestDate(job)}T00:00`);
  for (let i = 0; i < days; i++, d = nextWorkday(d)) {
    for (const { t } of techs) {
      const start = freeStart(t.id, dstr(d), hours, job.id);
      if (start != null) return { technicianId: t.id, date: dstr(d), start, end: start + hours, hours };
    }
  }
  return null;
}
export const helpers = () => store.list('employees', e => e.type === 'Helper' && e.status !== 'Inactive');
export const defaultHelper = techId => { const t = store.get('employees', techId); return helpers().find(h => h.mainZoneId === t?.mainZoneId) || helpers()[0] || null; };

export function scheduleProblems(job, slot) {
  const p = [];
  if (!job.termApproved) p.push('The payment term is not immediate: the Approver must approve it first.');
  if (!slot.technicianId) p.push('Pick a technician.');
  if (!partsReadyBy(job, slot.date)) p.push(`Parts are not ready before ${earliestDate(job)}. Tick "In stock" or pick a later date.`);
  return p;
}

// Schedule (or move) the job. With immediate payment the invoice is raised now, so the technician can collect.
export function scheduleJob(jobId, { technicianId, helperIds = [], date, start, hours }) {
  const job = store.get('jobs', jobId);
  const problems = scheduleProblems(job, { technicianId, date });
  if (problems.length) return { problems };
  const first = job.status === 'To schedule';
  store.update('jobs', jobId, { technicianId, helperIds, start: toIso(date, start), end: toIso(date, start + hours) },
    `${first ? 'Scheduled' : 'Moved'}: ${empName(technicianId)}, ${date} ${fmtHour(start)}–${fmtHour(start + hours)}`);
  if (first) store.setStatus('jobs', jobId, 'Scheduled', empName(technicianId));
  let invoice = invoiceForJob(jobId);
  if (job.paymentTerm === 'IMMEDIATE' && !invoice) invoice = createInvoice(jobId, { post: true, note: 'raised at scheduling (payment immediate)' });
  return { problems: [], invoice };
}

export function approveJobTerm(taskId, decision, comment) {
  const t = closeTask(taskId, decision, comment);
  if (decision === 'approve') store.update('jobs', t.docId, { termApproved: true }, `Payment term approved${comment ? `: ${comment}` : ''}`);
  else store.update('jobs', t.docId, { termNote: comment }, `Payment term returned: ${comment}`);
}

export function cancelJob(jobId, reason) {
  store.setStatus('jobs', jobId, 'Cancelled', reason);
  const inv = invoiceForJob(jobId);
  if (inv && inv.status !== 'Cancelled') store.setStatus('invoices', inv.id, 'Cancelled', `Job cancelled: ${reason}`);
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
export function checkIn(jobId) {
  const j = store.get('jobs', jobId);
  const at = nowIso();
  const wd = j.workDone || workDoneFor(j);
  store.update('jobs', jobId, { steps: { ...j.steps, checkInAt: at }, workDone: { ...wd, s1: { ...wd.s1, timeIn: hhmm(at) } } }, 'Checked in on site');
  store.setStatus('jobs', jobId, 'On site');
}

// The Work Done & Customer Feedback form, pre-filled: section 1 from the job, section 2 one row per line,
// section 4 names from the technician's record and the customer contact.
export function workDoneFor(j) {
  const tech = store.get('employees', j.technicianId);
  const enq = store.get('enquiries', j.enquiryId);
  const contact = store.get('customers', j.customerId)?.contacts?.find(c => c.id === enq?.contactId);
  return {
    s1: { project: j.site, refNo: j.no, customer: j.customer, date: dstr(new Date()), location: [j.address, j.tags.join(', ')].filter(Boolean).join(' · '), subject: j.subject, timeIn: '', timeOut: '' },
    rows: j.lines.map(l => ({ key: l.key, description: l.description, status: 'DONE', remark: '' })),
    partsUsed: j.parts.map(p => ({ key: p.key, name: p.name, qty: p.qty, unit: p.unit, used: true })),
    ratings: { punctuality: 0, quality: 0, staff: 0, overall: 0 }, comments: '',
    tech: { name: tech?.name || '', designation: tech?.designation || '', date: dstr(new Date()), signatureId: null },
    cust: { name: contact?.name || j.contact, designation: contact?.designation || '', date: dstr(new Date()), signatureId: null, stampId: null },
    signedAt: null,
  };
}

export function workDoneProblems(j) {
  const w = j.workDone, p = [];
  if (!j.steps?.checkInAt) p.push('Check in first.');
  if (!w) return p.length ? p : ['Fill in the Work Done form.'];
  if (Object.values(w.ratings).some(v => !v)) p.push('The customer has not rated all 4 categories.');
  if (!w.tech.signatureId) p.push('The technician must sign (checked by).');
  if (!w.cust.signatureId) p.push('The customer must sign.');
  return p;
}

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

// Leave site (flow step 8): the technician asks; the Operations Executive confirms (web or phone).
export function requestLeave(jobId) {
  const j = store.get('jobs', jobId);
  if (j.leaveSite?.requestedAt && !j.leaveSite.confirmedAt) return;
  const task = openTask({ kind: 'leaveSite', docType: 'job', docId: j.id, docNo: j.no, title: `${empName(j.technicianId)} asks to leave ${j.site}`, customer: j.customer, amount: null, level: 1, roleCode: 'OPS', roleName: 'Operations Executive', rules: [] });
  store.update('jobs', jobId, { leaveSite: { requestedAt: nowIso(), taskId: task.id, confirmedAt: null, confirmedBy: null } }, 'Leave-site request sent to the office');
}
export function confirmLeave(taskId, comment = '') {
  const t = closeTask(taskId, 'approve', comment);
  const j = store.get('jobs', t.docId);
  store.update('jobs', j.id, { leaveSite: { ...j.leaveSite, confirmedAt: t.doneAt, confirmedBy: store.currentActor() } }, `Leave site confirmed${comment ? `: ${comment}` : ''}`);
}
export function checkOut(jobId) {
  const j = store.get('jobs', jobId);
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
