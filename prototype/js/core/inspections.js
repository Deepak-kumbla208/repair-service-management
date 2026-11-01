// Site inspection rules: technicians by zone, assignment with a confirmed visit time,
// and the Site Viewing Report (SVR) from start to submission.
import * as store from './store.js';
import { technicians, empName, findSite } from './lookups.js';
import { makeShutter, addShutters } from './customers.js';
import { cleanLines, lineText } from './enquiries.js';

const sameDay = (a, b) => !!a && !!b && new Date(a).toDateString() === new Date(b).toDateString();
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Technicians for a zone first (main zone, then extra zones), each with their visits on that day.
export function techniciansFor(zoneId, visitIso) {
  return technicians().map(t => ({
    tech: t,
    match: t.mainZoneId === zoneId ? 'main' : (t.extraZoneIds || []).includes(zoneId) ? 'extra' : '',
    visits: store.list('inspections', i => i.technicianId === t.id && sameDay(i.visitAt, visitIso) && !['Cancelled', 'Report submitted'].includes(i.status)).length,
  })).sort((a, b) => (a.match ? (a.match === 'main' ? 0 : 1) : 2) - (b.match ? (b.match === 'main' ? 0 : 1) : 2) || a.visits - b.visits);
}

export function assignTechnician(inspId, { technicianId, visitAt, confirmedBy, notes }) {
  const insp = store.get('inspections', inspId);
  const name = empName(technicianId);
  const again = insp.technicianId && insp.technicianId !== technicianId;
  store.update('inspections', inspId, { technicianId, visitAt, confirmedBy, notes, assignedAt: new Date().toISOString(), assignedBy: store.currentActor() },
    `${again ? 'Re-assigned' : 'Assigned'} ${name}; visit confirmed with customer by ${confirmedBy || 'phone'}`);
  if (insp.status === 'To assign') store.setStatus('inspections', inspId, 'Assigned', name);
  const enq = store.get('enquiries', insp.enquiryId);
  if (['Waiting for inspection', 'Inspection assigned'].includes(enq.status)) store.setStatus('enquiries', enq.id, 'Inspection assigned', name);
}

// Product lines that name a part or material become rows of section 5 (Materials / spare parts).
function materialRows(enq) {
  return cleanLines(enq.lines).filter(l => l.itemRef.startsWith('itm:')).map(l => {
    const it = store.get('items', l.itemRef.slice(4));
    return { name: l.itemName, spec: it?.spec || '', qty: l.qty || 1, unit: l.unit || it?.unit || '', remarks: l.description || '', itemId: it?.id || null, shutterKey: '' };
  });
}
// Customer Complaint / Findings: one line per enquiry line, numbered when there are several.
function findingsFrom(enq) {
  const lines = cleanLines(enq.lines).map(lineText);
  if (!lines.length) return enq.description || '';
  return lines.length === 1 ? lines[0] : lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
}
// "What the customer asked for" (screen only): each enquiry line, ticked by the technician once checked on site.
const askedFrom = enq => cleanLines(enq.lines).map((l, i) => ({ n: i + 1, text: lineText(l), done: false, note: '' }));
// Shutters a line names by their tag (e.g. "RS-1 and RS-2 very noisy") are ticked already, with that line as the fault.
function namedShutters(enq, site) {
  const out = [];
  cleanLines(enq.lines).forEach(l => {
    const text = `${l.itemName} ${l.description}`;
    (site?.shutters || []).filter(s => s.status !== 'Inactive' && !out.some(x => x.shutterId === s.id)).forEach(s => {
      const tag = s.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![A-Za-z0-9-])${tag}(?![A-Za-z0-9])`, 'i').test(text)) {
        out.push({ key: s.id, shutterId: s.id, tag: s.tag, location: s.location, productId: s.productId, width: s.width, height: s.height, unit: s.unit, sizeCode: s.sizeCode, motor: s.motor, finding: l.description || '' });
      }
    });
  });
  return out;
}
const pad2 = n => String(n).padStart(2, '0');
const localDate = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

// The technician opening a report started by the office marks it "in progress" and sets Time In.
function markOnSite(insp, rep) {
  if (insp.status !== 'Assigned') return;
  if (!rep.s1.timeIn) store.update('siteReports', rep.id, { s1: { ...rep.s1, timeIn: nowTime() } }, false);
  store.setStatus('inspections', insp.id, 'Report in progress', rep.no);
  store.setStatus('enquiries', insp.enquiryId, 'Report in progress', rep.no);
}

// The report pre-filled from the enquiry, its product lines, the customer, the site and the assignment, not saved:
// the phone's "Preview form" shows it before the visit starts (no number, no Time In).
export function reportDraft(inspId, { fromOffice = true } = {}) {
  const insp = store.get('inspections', inspId);
  const enq = store.get('enquiries', insp.enquiryId);
  const { site } = findSite(enq.siteId);
  const tech = store.get('employees', insp.technicianId);
  return {
    inspectionId: inspId, enquiryId: enq.id, technicianId: insp.technicianId, customerId: enq.customerId, siteId: enq.siteId,
    s1: { customer: enq.customerName, site: site?.name || enq.siteName, address: site?.address || '', blockUnit: site?.blockUnit || '', viewedBy: tech?.name || '',
      viewDate: insp.visitAt ? localDate(insp.visitAt) : today(), contactPerson: enq.contactName, contactNo: [enq.mobile, enq.email].filter(Boolean).join(' / '),
      timeIn: fromOffice ? '' : nowTime(), timeOut: '' },
    shutters: namedShutters(enq, site), asked: askedFrom(enq),
    s2: { supplyInstall: false, repair: enq.type === 'REPAIR', replace: false, motor: false, dismantle: false, servicing: enq.type !== 'REPAIR', other: '', description: '', findings: findingsFrom(enq) },
    s3: { zoneId: enq.zoneId, persons: 2, days: 1, hoursPerDay: null, remarks: '', normal: true, afterHours: false, weekend: false, phased: false },
    s4: { ladder: false, scaffolding: false, scaffoldSets: '', scissor: false, scissorNos: '', boom: false, hoist: false, welding: false, grinding: false, powerTools: false, other: '', maxHeight: null, providedBy: '', rentalDuration: '', others: '' },
    s5: { rows: materialRows(enq), consumables: '' },
    s6: { normalAccess: true, restricted: false, permit: false, safetyDocs: false, protection: false, barricade: false, remarks: '' },
    photos: [],
    // Sign-off: the technician (Viewed by) and the customer (Acknowledged by), or the reason the customer could not sign.
    s7: { name: tech?.name || '', designation: tech?.designation || '', signatureId: null, date: today(),
      custName: enq.contactName || '', custDesignation: '', custSignatureId: null, custAbsent: false, custAbsentReason: '' },
  };
}

// Start (or reopen) the report. fromOffice: opened on the web before the visit, so statuses and Time In are left alone.
export function startReport(inspId, { fromOffice = false } = {}) {
  const insp = store.get('inspections', inspId);
  if (insp.reportId) {
    const existing = store.get('siteReports', insp.reportId);
    if (!fromOffice) markOnSite(insp, existing);
    return store.get('siteReports', insp.reportId);
  }
  const enq = store.get('enquiries', insp.enquiryId);
  const no = store.nextNumber('SVR');
  const rep = store.insert('siteReports', { no, ...reportDraft(inspId, { fromOffice }) },
    { status: 'Draft', note: `${no} ${fromOffice ? 'pre-filled by the office' : 'started'} for ${enq.no}` });
  store.update('inspections', inspId, { reportId: rep.id }, false);
  if (!fromOffice) {
    store.setStatus('inspections', inspId, 'Report in progress', no);
    store.setStatus('enquiries', enq.id, 'Report in progress', no);
  }
  return store.get('siteReports', rep.id);
}

// Draft saves are silent (no audit line for every keystroke).
export const saveReport = (id, patch) => store.update('siteReports', id, patch, false);

// paper: the office marks a report filled in on paper as received, so no on-screen signature is needed.
export function reportProblems(rep, { paper = false } = {}) {
  const p = [];
  // Each message names the section and the field to fill, the same words on the web and the phone.
  if (!rep.shutters.length && !rep.s2.description) p.push('Tick at least one shutter under “Shutters at this site” (section 1 General details), or write the “Job Scope / Description of Work” (section 2 Job scope).');
  if (!rep.s7.name) p.push('Enter the name under “Viewed by” (section 7 Sign-off).');
  if (!paper && !rep.s7.signatureId) p.push('Sign under “Viewed by” (section 7 Sign-off).');
  const left = (rep.asked || []).filter(a => !a.done).length;
  if (!paper && left) p.push(`Tick each line under “What the customer asked for” once you have checked it on site (section 2 Job scope): ${left} of ${rep.asked.length} not ticked yet.`);
  const s7 = rep.s7;
  if (!paper && s7.custAbsent && !s7.custAbsentReason) p.push('Give the reason under “Customer not available to sign” (section 7 Sign-off).');
  if (!paper && !s7.custAbsent && !(s7.custSignatureId && s7.custName)) p.push('Let the customer sign under “Acknowledged by” with their name (section 7 Sign-off), or tick “Customer not available to sign” and give the reason.');
  return p;
}

// Submit: new shutters join the site's shutter register; the inspection and enquiry move on.
export function submitReport(id, { paper = false } = {}) {
  const rep = store.get('siteReports', id);
  const problems = reportProblems(rep, { paper });
  if (problems.length) return problems;
  const fresh = rep.shutters.filter(s => s.isNew);
  let shutters = rep.shutters;
  if (fresh.length) {
    const made = fresh.map(s => ({ key: s.key, sh: makeShutter(s, `${rep.no}`) }));
    addShutters(rep.customerId, rep.siteId, made.map(m => m.sh), `${made.length} new shutter(s) added to the register from ${rep.no}`);
    shutters = rep.shutters.map(s => { const m = made.find(x => x.key === s.key); return m ? { ...s, isNew: false, shutterId: m.sh.id, sizeCode: m.sh.sizeCode } : s; });
  }
  store.update('siteReports', id, { shutters, paper, submittedAt: new Date().toISOString(), s1: { ...rep.s1, timeOut: rep.s1.timeOut || (paper ? '' : nowTime()) } },
    paper ? `${rep.no} received on paper and entered by the office` : `${rep.no} submitted`);
  store.setStatus('siteReports', id, 'Submitted');
  store.setStatus('inspections', rep.inspectionId, 'Report submitted', rep.no);
  store.setStatus('enquiries', rep.enquiryId, 'Inspected', rep.no);
  return [];
}
