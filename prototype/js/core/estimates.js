// Estimates: built pre-filled from the enquiry, its site report and the masters; edited in the team lead's tabs; revised
// as Rev 2, 3… under the same number (prices change only here). Repair estimates are built here; AMC and General
// Servicing estimates (kind "AMC") in amc-estimates.js. Calculations live in costing.js.
import * as store from './store.js';
import * as auth from './auth.js';
import { findSite, zones, productName, withCompany } from './lookups.js';
import { summarize, summarizeAmc, shutterLabour, hourlyRate, otRate, round2 } from './costing.js';
import { cancelTasksFor } from './workflow.js';
import { amcPrefill, amcProblems, describe } from './amc-estimates.js';
import { cleanLines, lineText as enquiryLineText } from './enquiries.js';

const rid = () => store.uid('r_');
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// The site report keeps one line per item; the estimate and quotation hold them on one line ("1. …; 2. …").
const oneLine = s => String(s || '').split(/\n+/).map(x => x.trim()).filter(Boolean).join('; ');
export const DEFAULTS = { costingLevel: 'JOB', sharedCosts: 'SPREAD', overheadPct: 20, marginBasis: 'MARKUP', marginPct: 20, quoteValidityDays: 7, defaultPaymentTerm: 'IMMEDIATE' };
export const txDefaults = () => ({ ...DEFAULTS, ...(auth.company()?.txDefaults || {}) });

export function companyTax() {
  const c = auth.company();
  if (!c?.chargesTax) return { taxCode: '', taxRate: 0, taxLabel: c?.taxLabel || 'Tax' };
  const t = store.findOne('taxes', x => x.code === c.defaultTaxCode && x.status !== 'Inactive');
  return { taxCode: t?.code || '', taxRate: Number(t?.rate) || 0, taxLabel: c.taxLabel };
}

// Repair rates from the Labour master: Standard Team (1+1) and Additional Worker.
function repairRates() {
  const rows = store.list('labour', l => l.rateSet === 'Repair' && l.status !== 'Inactive');
  const pick = code => rows.find(l => l.code === code) || rows[0];
  const row = l => { const h = hourlyRate(l?.monthly, l?.days, l?.hours); return { labourId: l?.id || '', trade: l?.name || '', skill: l?.skill || '', rate: h, otRate: otRate(h, l?.otMultiplier) }; };
  return { team: row(pick('LAB-R1')), extra: row(pick('LAB-R2')) };
}

const findItem = (id, name) => store.get('items', id) || store.findOne('items', i => i.name.toLowerCase() === String(name || '').trim().toLowerCase());
const equipmentByCode = code => store.findOne('equipment', e => e.code === code && e.status !== 'Inactive');

// Line text: the site report's action needed, else the fault: "RS-1 Front shop: replace the motor (parts: 1 × Motor 400 kg single phase)"
function lineText(s, mats) {
  const parts = mats.map(m => `${m.qty} × ${m.name}`).join(', ');
  return `${s.tag} ${s.location}: ${s.action || s.fault || 'repair'}${parts ? ` (parts: ${parts})` : ''}`;
}

// Everything an estimate needs, pre-filled. rep may be null (repair without inspection).
export function prefill(enq, rep) {
  const { site } = findSite(enq.siteId);
  const d = txDefaults();
  const rates = repairRates();
  const sizes = store.list('sizes');
  const zone = store.get('zones', rep?.s3?.zoneId || enq.zoneId);
  const ot = !!(rep?.s3?.afterHours || rep?.s3?.weekend);
  const days = Number(rep?.s3?.days) || 1;

  // A repair enquiry made from failed checklist items (AMC visit or GS job) brings its shutters and parts.
  const fromFails = !rep && (enq.failures || []).length ? failedShutters(enq, site) : null;
  const shutters = (fromFails?.shutters || rep?.shutters || []).map(s => {
    const size = sizes.find(z => z.code === s.sizeCode);
    return { key: s.key, tag: s.tag, location: s.location, productId: s.productId, typeName: productName(s.productId), width: s.width, height: s.height, unit: s.unit,
      qty: 1, fault: s.finding || '', action: s.action || '', sizeCode: s.sizeCode, ...shutterLabour(size, 1) };
  });

  // With no report, each enquiry product line becomes a line; a line naming a part or material brings its row.
  const enqLines = rep || fromFails ? [] : cleanLines(enq.lines).map(l => ({ ...l, key: rid() }));
  // Materials: the site report's section 5 (or the enquiry lines that name a part or material).
  const srcRows = fromFails ? fromFails.rows : rep ? rep.s5.rows : enqLines.filter(l => l.itemRef.startsWith('itm:')).map(l => ({ itemId: l.itemRef.slice(4), name: l.itemName, qty: l.qty, unit: l.unit, remarks: l.description, lineKey: l.key }));
  const one = shutters.length === 1 ? shutters[0].key : '';
  const materials = srcRows.filter(r => r.name).map(r => {
    const it = findItem(r.itemId, r.name);
    return { key: rid(), itemId: it?.id || '', name: it?.name || r.name, spec: r.spec || it?.spec || '', unit: r.unit || it?.unit || '', qty: Number(r.qty) || 1,
      wastage: Number(it?.wastage) || 0, rate: Number(it?.rate) || 0, leadDays: Number(it?.leadDays) || 0, placeholder: !!it?.placeholders?.includes('rate'), noRate: !it,
      lineKey: r.lineKey || (shutters.some(s => s.key === r.shutterKey) ? r.shutterKey : one), remarks: r.remarks || '' };
  });

  // Lines: one per shutter, plus one per part not fitted to a single shutter ("2 × Tension spring: worn"), so a part
  // is never counted as a shared cost. With no report: one per enquiry product line. qty / unit show on the quotation.
  // partKey: the material a part line is about, so a change to its qty or unit in the Materials tab follows it.
  const partLines = shutters.length || rep || fromFails ? materials.filter(m => !m.lineKey).map(m => {
    m.lineKey = m.key;
    return { key: m.key, tag: '', qty: m.qty, unit: m.unit || 'Nos', partKey: m.key, description: enquiryLineText({ itemName: m.name, qty: m.qty, unit: m.unit, description: m.remarks }) };
  }) : [];
  const lines = shutters.length || partLines.length
    ? [...shutters.map(s => ({ key: s.key, tag: s.tag, qty: 1, unit: 'Nos', description: lineText(s, materials.filter(m => m.lineKey === s.key)) })), ...partLines]
    : enqLines.map(l => ({ key: l.key, tag: '', qty: l.qty || 1, unit: l.unit || 'Nos', partKey: materials.find(m => m.lineKey === l.key)?.key || '', description: enquiryLineText(l) }));

  // Labour: one row per shutter for the team, plus one for extra workers (L / XL). Overtime or weekend → OT column.
  const labour = [];
  shutters.forEach(s => {
    const hrs = (h, r) => (ot ? { hrs: 0, otHrs: h } : { hrs: h, otHrs: 0 });
    if (s.teamHrs) labour.push({ key: rid(), ...rates.team, team: 1, ...hrs(s.teamHrs), lineKey: s.key, forTag: s.tag });
    if (s.extraWorkers && s.extraHrs) labour.push({ key: rid(), ...rates.extra, team: s.extraWorkers, ...hrs(s.extraHrs), lineKey: s.key, forTag: s.tag });
  });

  // Transport: the site's zone; No. of Hrs = trips (site report days) × the zone's round trip; Repair rate.
  const transport = zone ? [{ key: rid(), zoneId: zone.id, zoneLabel: `Zone ${zone.code} · ${zone.name}`, distance: zone.distance || '', vehicle: zone.vehicle || '',
    trips: days, roundTrip: Number(zone.roundTripHours) || 0, hrs: round2(days * (Number(zone.roundTripHours) || 0)), rate: Number(zone.repairRate) || 0, lineKey: '' }] : [];

  // Equipment: the ticks in site report section 4; nothing is charged when the customer provides it.
  const equipment = [];
  const s4 = rep?.s4 || {};
  const byCustomer = s4.providedBy === 'Customer';
  [['ladder', 'EQ-05', 1], ['scaffolding', 'EQ-03', Number(s4.scaffoldSets) || 1], ['scissor', 'EQ-01', Number(s4.scissorNos) || 1], ['boom', 'EQ-04', 1]].forEach(([flag, code, qty]) => {
    const e = s4[flag] && equipmentByCode(code);
    if (e) equipment.push({ key: rid(), equipmentId: e.id, name: e.name, ownership: e.ownership, basis: e.basis, qty, duration: days, rate: byCustomer ? 0 : Number(e.rate) || 0, byCustomer, lineKey: '' });
  });

  const contactNo = [enq.mobile, enq.email].filter(Boolean).join(' / ');
  return {
    enquiryId: enq.id, reportId: rep?.id || '', customerId: enq.customerId, siteId: enq.siteId,
    header: { customer: enq.customerName, contact: enq.contactName, phone: enq.mobile || contactNo, site: enq.siteName, address: [site?.address, site?.blockUnit].filter(Boolean).join(', '),
      date: today(), preparedBy: store.currentActor(), findings: oneLine(String(rep?.s2?.findings || '').replace(/^\s*\d+\.\s+/gm, '')) || enq.description, description: oneLine(rep?.s2?.description) || enq.description },
    costingLevel: d.costingLevel, sharedCosts: d.sharedCosts, sharedLabel: zone ? `Transport & mobilisation (Zone ${zone.code})` : 'Transport & mobilisation',
    overheads: [{ key: rid(), name: 'Overheads', basis: 'PCT', value: d.overheadPct }], marginBasis: d.marginBasis, marginPct: d.marginPct,
    ...companyTax(), shutters, lines, labour, transport, materials, equipment, afterHours: ot,
    svrManHours: rep ? (Number(rep.s3.persons) || 0) * (Number(rep.s3.days) || 0) * (Number(rep.s3.hoursPerDay) || 0) : 0,
  };
}

// Failed items grouped by shutter: the register entry gives type and size; the notes become the fault; parts the
// technician picked become material rows of that shutter.
function failedShutters(enq, site) {
  // A fault found again (later visit) is the same work: one entry per shutter and item.
  const unique = [...enq.failures.reduce((m, f) => {
    const k = `${f.shutterId}|${f.code}`, first = m.get(k);
    return m.set(k, first ? { ...first, itemId: first.itemId || f.itemId, qty: first.itemId ? first.qty : f.qty } : f);
  }, new Map()).values()];
  const byShutter = new Map();
  unique.forEach(f => { if (!byShutter.has(f.shutterId)) byShutter.set(f.shutterId, []); byShutter.get(f.shutterId).push(f); });
  const shutters = [...byShutter.entries()].map(([id, fs]) => {
    const r = (site?.shutters || []).find(x => x.id === id) || fs[0].shutter || {};
    return { key: id, shutterId: id, tag: r.tag || fs[0].tag, location: r.location || fs[0].location, productId: r.productId, width: r.width, height: r.height, unit: r.unit, sizeCode: r.sizeCode,
      finding: fs.map(f => `${f.label}${f.note ? `: ${f.note}` : ''}`).join('; ') };
  });
  const rows = unique.filter(f => f.itemId).map(f => ({ itemId: f.itemId, name: store.get('items', f.itemId)?.name || '', qty: f.qty || 1, shutterKey: f.shutterId }));
  return { shutters, rows };
}

// A part line ("2 × Tension spring: worn") follows its material when the Materials tab changes its qty, unit or item:
// the line's qty and unit, and the count at the start of its text.
export function syncPartLine(est, materialKey) {
  const m = est.materials.find(x => x.key === materialKey);
  const l = m && est.lines.find(x => x.partKey === m.key);
  if (!l) return;
  const count = (q, u) => (u && u !== 'Nos' ? `${q} ${u} ` : `${q} × `);
  const was = count(l.qty || 1, l.unit);
  // Text rewritten by hand (no count at the start) is left alone; the quotation then shows it as one lot.
  const rest = l.description.startsWith(was) ? l.description.slice(was.length) : null;
  Object.assign(l, { qty: Number(m.qty) || 1, unit: m.unit || 'Nos' });
  if (rest !== null) l.description = `${count(l.qty, l.unit)}${m.name}${rest.includes(':') ? rest.slice(rest.indexOf(':')) : ''}`;
}

export const latestReport = enq => {
  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const rep = insp?.reportId ? store.get('siteReports', insp.reportId) : null;
  return rep?.status === 'Submitted' ? rep : null;
};
// "Quote the rest" (core/later-work.js): the first enquiry's site report, cut down to the products and parts left for later.
export const laterReport = enq => {
  const l = enq?.laterOf;
  const rep = l?.reportId ? store.get('siteReports', l.reportId) : null;
  if (!rep) return null;
  const keys = l.shutterKeys || [];
  const shutters = rep.shutters.filter(s => keys.includes(s.key));
  // Its findings are those of the later products only; the description comes from the new enquiry's lines.
  const findings = shutters.map(s => `${s.tag} ${productName(s.productId)}: ${s.finding}`).join('\n');
  return { ...rep, shutters, s2: { ...rep.s2, findings, description: '' },
    s5: { ...rep.s5, rows: [...rep.s5.rows.filter(r => r.shutterKey && keys.includes(r.shutterKey)), ...(l.parts || []).map(p => ({ spec: '', ...p, shutterKey: '' }))] } };
};

// The current (latest) estimate revision of an enquiry.
export const currentEstimate = enqId => store.list('estimates', e => e.enquiryId === enqId && e.status !== 'Superseded').sort((a, b) => b.rev - a.rev)[0] || null;
export const revisions = no => store.list('estimates', e => e.no === no).sort((a, b) => a.rev - b.rev);

// "Create estimate" is offered on an inspected repair enquiry (or one waiting for an estimate) with none yet.
// AMC and General Servicing enquiries get it in BOQ study or after their (optional) site report.
export const canCreateFor = enq => (enq.type === 'REPAIR' ? ['Inspected', 'Waiting for estimate'] : ['BOQ study', 'Inspected']).includes(enq.status)
  && !currentEstimate(enq.id) && auth.can('estimation', 'create');

export function createEstimate(enqId, opts = {}) {
  const enq = store.get('enquiries', enqId);
  const existing = currentEstimate(enqId);
  if (existing) return existing;
  const no = store.nextNumber('EST');
  const data = enq.type === 'REPAIR' ? prefill(enq, latestReport(enq) || laterReport(enq)) : amcPrefill(enq, opts);
  const est = store.insert('estimates', { no, rev: 1, ...data, quotationId: '', prevId: '', returnNote: null },
    { status: 'Draft', note: `${no} Rev 1 pre-filled from ${enq.no}` });
  store.setStatus('enquiries', enqId, 'Estimating', `${no} Rev 1`);
  return est;
}

export const canEdit = est => est.status === 'Draft' && auth.can('estimation', 'edit');
// Saves only the estimate's content, and only while it is a draft: a late autosave from the page can never undo
// "Create quotation" (status, quotation link) or edit a quoted revision.
const CONTENT = ['header', 'costingLevel', 'sharedCosts', 'sharedLabel', 'overheads', 'marginBasis', 'marginPct', 'shutters', 'lines', 'labour', 'transport', 'materials', 'equipment',
  'periodMonths', 'billing', 'matrix', 'sites'];
export function saveEstimate(id, patch) {
  const cur = store.get('estimates', id);
  if (!cur || cur.status !== 'Draft') return cur;
  const p = {};
  CONTENT.forEach(k => { if (k in patch) p[k] = patch[k]; });
  return store.update('estimates', id, p, false);
}
// The enquiry's live quotation revision (not superseded).
const liveQuotation = enqId => store.list('quotations', q => q.enquiryId === enqId && q.status !== 'Superseded').sort((a, b) => b.rev - a.rev)[0] || null;
export const CLOSED_QUOTE = ['Accepted', 'Rejected'];
// Revise is offered while the live quotation is still open (not accepted or rejected).
export const canRevise = est => {
  const q = liveQuotation(est.enquiryId);
  return est.status === 'Quoted' && auth.can('estimation', 'edit') && !!q && !CLOSED_QUOTE.includes(q.status);
};
export const estimateSummary = est => (est.kind === 'AMC' ? summarizeAmc(est, zones()) : summarize(est, zones()));

// Revise: Rev n+1 as a new draft; the old revision is kept (Superseded). without: line keys to drop
// (partial acceptance), with their rows; shared costs are then spread over the remaining lines.
export function reviseEstimate(id, { without = [], note = '' } = {}) {
  const cur = store.get('estimates', id);
  const live = liveQuotation(cur.enquiryId);
  if (live && CLOSED_QUOTE.includes(live.status)) return null;
  const copy = structuredClone(cur);
  ['id', 'tenantId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'status', 'statusHistory'].forEach(k => delete copy[k]);
  if (without.length && copy.kind === 'AMC') {
    // AMC Line costing has one line per site: drop the sites the customer did not accept.
    copy.sites = copy.sites.filter(x => !without.includes(x.key));
    ['equipment', 'materials'].forEach(k => { copy[k] = copy[k].filter(r => !without.includes(r.siteKey)); });
    copy.transport = copy.transport.filter(t => copy.sites.some(x => x.zoneId === t.zoneId));
    const auto = cur.header.description === describe(cur);
    copy.header = { ...copy.header, site: copy.sites.map(x => x.name).join(', '), description: auto ? describe(copy) : copy.header.description };
  } else if (without.length) {
    const drop = r => without.includes(r.lineKey);
    copy.lines = copy.lines.filter(l => !without.includes(l.key));
    copy.shutters = copy.shutters.filter(s => !without.includes(s.key));
    ['labour', 'materials', 'transport', 'equipment'].forEach(k => { copy[k] = copy[k].filter(r => !drop(r)); });
    copy.header = { ...copy.header, description: copy.lines.map(l => l.description).join('; ') };
  }
  // The Approver's comment travels only when the live quotation was returned.
  const returnNote = !without.length && live?.status === 'Returned' ? cur.returnNote : null;
  const next = store.insert('estimates', { ...copy, rev: cur.rev + 1, prevId: cur.id, quotationId: '', returnNote, header: { ...copy.header, date: today() } },
    { status: 'Draft', note: `${cur.no} Rev ${cur.rev + 1}${note ? ` · ${note}` : ''}` });
  store.setStatus('estimates', cur.id, 'Superseded', `Revised as Rev ${cur.rev + 1}`);
  // The open quotation is replaced by the coming revision: it can no longer be approved, sent or accepted.
  if (live && live.status !== 'Superseded') {
    cancelTasksFor('quotation', live.id, `Estimate revised as Rev ${cur.rev + 1}`);
    store.setStatus('quotations', live.id, 'Superseded', `Estimate revised as Rev ${cur.rev + 1}`);
  }
  store.setStatus('enquiries', cur.enquiryId, 'Estimating', `${cur.no} Rev ${cur.rev + 1}`);
  return next;
}

// Problems that stop "Create quotation".
export function estimateProblems(est) {
  if (est.kind === 'AMC') return amcProblems(est);
  const s = estimateSummary(est);
  const p = [];
  if (!s.direct) p.push('The estimate has no cost yet.');
  if (est.materials.some(m => m.noRate && !m.rate)) p.push('A material has no rate (not in the Material/Item master).');
  if (est.costingLevel === 'LINE' && !est.lines.length) p.push('Line costing needs at least one line.');
  if (!String(est.header.description || '').trim()) p.push('Enter the description (Summary tab).');
  return p;
}

export const textWithCompany = text => withCompany(text, auth.company());
