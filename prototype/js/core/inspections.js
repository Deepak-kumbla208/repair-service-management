// Site inspection rules: technicians by zone, assignment with a confirmed visit time,
// and the Site Viewing Report (SVR) from start to submission.
import * as store from './store.js';
import { technicians, empName, findSite, productName, vsOptions, vsDefault } from './lookups.js';
import { makeShutter, addShutters } from './customers.js';
import { cleanLines, lineText } from './enquiries.js';
import { productOf, isPhysical, keeps, setOfProduct, sizeText, tagMaker as productTags, unitOfProduct, groupsOf, missingGroups } from './products.js';
export { groupsOf };

const sameDay = (a, b) => !!a && !!b && new Date(a).toDateString() === new Date(b).toDateString();
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Technicians for a zone first (main zone, then extra zones), each with their visits on that day. groups: the product
// groups of the work (Product master); a technician who works on all of them comes first, then the zone order.
export function techniciansFor(zoneId, visitIso, groups = []) {
  return technicians().map(t => ({
    tech: t,
    match: t.mainZoneId === zoneId ? 'main' : (t.extraZoneIds || []).includes(zoneId) ? 'extra' : '',
    missing: missingGroups(t, groups),
    visits: store.list('inspections', i => i.technicianId === t.id && sameDay(i.visitAt, visitIso) && !['Cancelled', 'Report submitted'].includes(i.status)).length,
  })).sort((a, b) => (a.missing.length ? 1 : 0) - (b.missing.length ? 1 : 0)
    || (a.match ? (a.match === 'main' ? 0 : 1) : 2) - (b.match ? (b.match === 'main' ? 0 : 1) : 2) || a.visits - b.visits);
}
// The product groups an enquiry's lines need; a fixed-price product (a submission) needs none.
export const enquiryGroups = enq => groupsOf(cleanLines(enq?.lines).filter(l => l.itemRef.startsWith('prd:')).map(l => l.itemRef.slice(4)));

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
// How reports saved before findings per product pre-filled Customer Complaint / Findings: one line per enquiry line.
function findingsFrom(enq) {
  const lines = cleanLines(enq.lines).map(lineText);
  if (!lines.length) return enq.description || '';
  return lines.length === 1 ? lines[0] : lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
}
// The customer's products a line names by their tag (e.g. "RS-1 and RS-2 very noisy").
function namedIn(l, site, taken) {
  const text = `${l.itemName} ${l.description}`;
  return (site?.shutters || []).filter(s => s.status !== 'Inactive' && !taken.has(s.id)).filter(s => {
    const tag = s.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9-])${tag}(?![A-Za-z0-9])`, 'i').test(text);
  });
}
// Job scope, "Products and findings": one row per enquiry line, ticked once checked on site; printed as Customer Complaint / Findings.
// A line about a product worked on at the site (Product master), or naming a recorded product by tag, is a product row:
// product, qty (in its unit), location and size if the product has a size set, or linkIds = the customer's products
// already recorded at the site. The technician adds more product rows on site (added: true). A fixed-price product (a
// submission) stays a plain line. The report's products come from these rows (reportShutters).
export const isProductRow = r => !!(r.productId || r.linkIds?.length);
function askedFrom(enq, site) {
  const taken = new Set();
  return cleanLines(enq.lines).map((l, i) => {
    const row = { key: store.uid('ask_'), n: i + 1, text: lineText(l), desc: l.description || '', done: false, note: '' };
    const named = namedIn(l, site, taken);
    named.forEach(s => taken.add(s.id));
    const picked = l.itemRef.startsWith('prd:') ? l.itemRef.slice(4) : '';
    const productId = picked ? (isPhysical(productOf(picked)) ? picked : '') : named[0]?.productId || '';
    if (!productId) return row;
    return { ...row, productId, qty: Math.max(l.qty || 1, named.length), uom: (picked && l.unit) || unitOfProduct(productOf(productId)), location: '', sizeCode: '', width: null, height: null, unit: 'm', measure: null, linkIds: named.map(s => s.id) };
  });
}
export const newProductRow = (rows, productId) => ({ key: store.uid('ask_'), n: rows.length + 1, text: `1 × ${productName(productId)}`, desc: '', done: true, note: '', added: true,
  productId, qty: 1, uom: unitOfProduct(productOf(productId)), location: '', sizeCode: '', width: null, height: null, unit: 'm', measure: null, linkIds: [] });
// Findings (user, 2 Nov 2026): each product, and each line with no product, has its fault found, the action needed and a
// priority (Value Set Master "Finding Priority"; the built-in list serves data saved before that list existed). They are
// kept on the row by product key (r.found); rows saved before keep their note as the fault.
const PRIORITY_LIST = [{ value: 'URGENT', label: 'Urgent' }, { value: 'NORMAL', label: 'Normal' }, { value: 'LATER', label: 'Can wait' }];
export const priorityOptions = () => { const o = vsOptions('FINDING_PRIORITY'); return o.length ? o : PRIORITY_LIST; };
export const priorityLabel = code => priorityOptions().find(o => o.value === code)?.label || '';
const defaultPriority = () => vsDefault('FINDING_PRIORITY') || 'NORMAL';
export function findingOf(r, key) {
  const f = r.found?.[key] || {};
  return { fault: f.fault ?? r.note ?? '', action: f.action || '', priority: f.priority || defaultPriority() };
}

// The report's products from its product rows: the linked customer products, then one new customer product for each of
// the rest of the qty (same location and size), tagged by product (RS-4, BP-1). A product that is not kept as a
// customer product (tape by the metre) stays one entry with its qty and unit, untagged. They fill the location on the
// printed form and become the estimate lines.
export function reportShutters(rep, rows = rep.asked) {
  const { site } = findSite(rep.siteId);
  const reg = site?.shutters || [];
  const nextTag = productTags(site);
  const out = [];
  (rows || []).filter(isProductRow).forEach(r => {
    const found = key => { const f = findingOf(r, key); return { finding: f.fault || r.desc || '', action: f.action, priority: f.priority, rowKey: r.key }; };
    const p = productOf(r.productId);
    const size = { width: r.width ?? null, height: r.height ?? null, unit: r.unit || 'm', measure: r.measure ?? null, sizeCode: r.sizeCode || '' };
    if (p && !keeps(p)) {
      const key = `${r.key}_0`;
      out.push({ key, shutterId: null, isNew: false, notKept: true, tag: '', location: r.location || '', productId: r.productId, qty: Number(r.qty) || 1, uom: r.uom || unitOfProduct(p), ...size, motor: '', ...found(key) });
      return;
    }
    const linked = (r.linkIds || []).map(id => reg.find(s => s.id === id)).filter(s => s && !out.some(o => o.shutterId === s.id));
    linked.forEach(s => out.push({ key: s.id, shutterId: s.id, tag: s.tag, location: s.location, productId: s.productId, width: s.width, height: s.height, unit: s.unit,
      measure: s.measure ?? null, sizeCode: s.sizeCode, motor: s.motor, ...found(s.id) }));
    for (let i = linked.length; i < Math.ceil(Number(r.qty) || 1); i++) {
      const key = `${r.key}_${i}`;
      out.push({ key, shutterId: null, isNew: true, tag: nextTag(r.productId), location: r.location || '', productId: r.productId, ...size, motor: '', ...found(key) });
    }
  });
  return out;
}
// The Size column of the findings table: the size and its measure, or the quantity of a work-only product ("15 m").
const sizeCell = s => (s.notKept && !s.sizeCode ? `${s.qty} ${s.uom || ''}`.trim() : sizeText(s, { none: '' }));

// Customer Complaint / Findings as printed: one row per product (shutter), and one per line with no product.
export function findingRows(rep, rows = rep.asked, shutters = rep.shutters) {
  return (rows || []).flatMap(r => isProductRow(r)
    ? (shutters || []).filter(s => s.rowKey === r.key).map(s => ({ key: s.key, tag: s.tag, product: productName(s.productId), location: s.location, size: sizeCell(s),
      complaint: r.desc, ...findingOf(r, s.key) }))
    : [{ key: r.key, tag: '', product: '', location: '', size: '', complaint: r.text, ...findingOf(r, r.key) }]);
}
// The same findings as one text (s2.findings): the estimate's and the quotation's Findings. Reports saved before the
// table print this text in the old single box.
export function findingsText(rows, other = '') {
  const lines = rows.map(f => {
    const who = [f.tag, f.product].filter(Boolean).join(' ');
    const what = f.fault || (who ? f.complaint : '');
    const urgent = f.priority === 'URGENT' ? ` (${priorityLabel('URGENT').toLowerCase()})` : '';
    return who ? `${who}${what ? `: ${what}` : ''}${urgent}` : `${f.complaint}${f.fault ? `: ${f.fault}` : ''}${urgent}`;
  }).filter(Boolean);
  if (other) lines.push(other);
  return lines.length === 1 ? lines[0] : lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
}
export const perProduct = rep => rep.s2?.otherFindings !== undefined;
// Other findings (anything not about one product). A report saved before keeps its findings text here if it was changed
// from the enquiry pre-fill.
export function otherFindings(rep) {
  if (perProduct(rep)) return rep.s2.otherFindings;
  const enq = store.get('enquiries', rep.enquiryId);
  return enq && rep.s2.findings === findingsFrom(enq) ? '' : rep.s2.findings || '';
}

// Reports saved before the products moved to Job scope: rows get keys, and a shutter no row covers becomes a row of its
// own; materials keep pointing at the same shutters. Pure; tidyReport saves it.
export function jobScope(rep) {
  let changed = false;
  const asked = (rep.asked || []).map(r => { if (!r.key) changed = true; return { ...r, key: r.key || store.uid('ask_') }; });
  const moved = {};
  (rep.shutters || []).filter(s => !s.rowKey).forEach(s => {
    changed = true;
    const owner = s.shutterId && asked.find(r => (r.linkIds || []).includes(s.shutterId));
    if (owner) { if (!owner.note && owner.linkIds.length === 1) owner.note = s.finding || ''; return; }
    const row = { ...newProductRow(asked, s.productId), text: `${s.tag} ${s.location}`.trim(), note: s.finding || '', linkIds: s.shutterId ? [s.shutterId] : [] };
    if (!s.shutterId) Object.assign(row, { location: s.location, sizeCode: s.sizeCode, width: s.width ?? null, height: s.height ?? null, unit: s.unit || 'm', measure: s.measure ?? null });
    asked.push(row);
    moved[s.key] = s.shutterId || `${row.key}_0`;
  });
  if (!changed) return { asked: rep.asked || [], shutters: rep.shutters, s5: rep.s5, changed };
  const s5 = { ...rep.s5, rows: rep.s5.rows.map(r => ({ ...r, shutterKey: moved[r.shutterKey] || r.shutterKey })) };
  return { asked, shutters: reportShutters(rep, asked), s5, changed };
}
export function tidyReport(id) {
  const js = jobScope(store.get('siteReports', id));
  if (js.changed) store.update('siteReports', id, { asked: js.asked, shutters: js.shutters, s5: js.s5 }, false);
  return store.get('siteReports', id);
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
  const asked = askedFrom(enq, site);
  const shutters = reportShutters({ siteId: enq.siteId }, asked);
  return {
    inspectionId: inspId, enquiryId: enq.id, technicianId: insp.technicianId, customerId: enq.customerId, siteId: enq.siteId,
    s1: { customer: enq.customerName, site: site?.name || enq.siteName, address: site?.address || '', blockUnit: site?.blockUnit || '', viewedBy: tech?.name || '',
      viewDate: insp.visitAt ? localDate(insp.visitAt) : today(), contactPerson: enq.contactName, contactNo: [enq.mobile, enq.email].filter(Boolean).join(' / '),
      timeIn: fromOffice ? '' : nowTime(), timeOut: '' },
    asked, shutters,
    s2: { supplyInstall: false, repair: enq.type === 'REPAIR', replace: false, motor: false, dismantle: false, servicing: enq.type !== 'REPAIR', other: '', description: '',
      findings: findingsText(findingRows({}, asked, shutters)), otherFindings: '' },
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
  if (!rep.shutters.length && !rep.s2.description) p.push('Add at least one product under “Products and findings” (section 2 Job scope, “+ Add product”), or write the “Job Scope / Description of Work” (section 2 Job scope).');
  // A new product needs its location, and its size when its product has a size set (a pump by its kW).
  (rep.asked || []).filter(r => isProductRow(r) && (Number(r.qty) || 1) > (r.linkIds || []).length).forEach(r => {
    const sized = !!setOfProduct(productOf(r.productId));
    if (!r.location || (sized && !r.sizeCode)) p.push(`Enter the location${sized ? ' and the size' : ''} of line ${r.n} (${productName(r.productId) || 'product'}) under “Products and findings” (section 2 Job scope).`);
  });
  if (!rep.s7.name) p.push('Enter the name under “Viewed by” (section 7 Sign-off).');
  if (!paper && !rep.s7.signatureId) p.push('Sign under “Viewed by” (section 7 Sign-off).');
  const asks = (rep.asked || []).filter(a => !a.added); // rows added on site are not asked by the customer
  const left = asks.filter(a => !a.done).length;
  if (!paper && left) p.push(`Tick each line under “Products and findings” once you have checked it on site (section 2 Job scope): ${left} of ${asks.length} not ticked yet.`);
  const s7 = rep.s7;
  if (!paper && s7.custAbsent && !s7.custAbsentReason) p.push('Give the reason under “Customer not available to sign” (section 7 Sign-off).');
  if (!paper && !s7.custAbsent && !(s7.custSignatureId && s7.custName)) p.push('Let the customer sign under “Acknowledged by” with their name (section 7 Sign-off), or tick “Customer not available to sign” and give the reason.');
  return p;
}

// Submit: new products are recorded as the customer's products at the site and their rows link them from now on (a
// work-only product, not kept, is not recorded); the inspection and enquiry move on.
export function submitReport(id, { paper = false } = {}) {
  const rep = store.get('siteReports', id);
  const problems = reportProblems(rep, { paper });
  if (problems.length) return problems;
  const fresh = rep.shutters.filter(s => s.isNew);
  let { shutters, asked = [], s5 } = rep;
  if (fresh.length) {
    const made = fresh.map(s => ({ key: s.key, rowKey: s.rowKey, sh: makeShutter(s, `${rep.no}`) }));
    addShutters(rep.customerId, rep.siteId, made.map(m => m.sh), `${made.length} new customer product(s) recorded from ${rep.no}`);
    const idOf = key => made.find(m => m.key === key)?.sh.id;
    shutters = rep.shutters.map(s => { const m = made.find(x => x.key === s.key); return m ? { ...s, key: m.sh.id, isNew: false, shutterId: m.sh.id, sizeCode: m.sh.sizeCode } : s; });
    asked = asked.map(r => ({ ...r, linkIds: [...(r.linkIds || []), ...made.filter(m => m.rowKey === r.key).map(m => m.sh.id)],
      ...(r.found ? { found: Object.fromEntries(Object.entries(r.found).map(([k, f]) => [idOf(k) || k, f])) } : {}) }));
    s5 = { ...s5, rows: s5.rows.map(r => ({ ...r, shutterKey: idOf(r.shutterKey) || r.shutterKey })) };
  }
  store.update('siteReports', id, { shutters, asked, s5, paper, submittedAt: new Date().toISOString(), s1: { ...rep.s1, timeOut: rep.s1.timeOut || (paper ? '' : nowTime()) } },
    paper ? `${rep.no} received on paper and entered by the office` : `${rep.no} submitted`);
  store.setStatus('siteReports', id, 'Submitted');
  store.setStatus('inspections', rep.inspectionId, 'Report submitted', rep.no);
  store.setStatus('enquiries', rep.enquiryId, 'Inspected', rep.no);
  return [];
}
