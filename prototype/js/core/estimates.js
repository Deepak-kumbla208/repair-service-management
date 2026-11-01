// Repair estimates: built pre-filled from the enquiry, its site report and the masters; edited in the team lead's
// tabs; revised as Rev 2, 3… under the same number (prices change only here). Calculations live in costing.js.
import * as store from './store.js';
import * as auth from './auth.js';
import { findSite, zones, productName, withCompany } from './lookups.js';
import { summarize, shutterLabour, hourlyRate, otRate, round2 } from './costing.js';
import { cancelTasksFor } from './workflow.js';

const rid = () => store.uid('r_');
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const DEFAULTS = { costingLevel: 'JOB', sharedCosts: 'SPREAD', overheadPct: 20, marginBasis: 'MARKUP', marginPct: 20, quoteValidityDays: 7 };
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

// Line text: "RS-1 Front shop: motor not working (parts: 1 × Motor 400 kg single phase)"
function lineText(s, mats) {
  const parts = mats.map(m => `${m.qty} × ${m.name}`).join(', ');
  return `${s.tag} ${s.location}: ${s.fault || 'repair'}${parts ? ` (parts: ${parts})` : ''}`;
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

  const shutters = (rep?.shutters || []).map(s => {
    const product = store.get('products', s.productId);
    const size = sizes.find(z => z.code === s.sizeCode);
    return { key: s.key, tag: s.tag, location: s.location, productId: s.productId, typeName: productName(s.productId), width: s.width, height: s.height, unit: s.unit,
      qty: 1, fault: s.finding || '', sizeCode: s.sizeCode, factor: Number(product?.factor) || 1, ...shutterLabour(size, product?.factor, 1) };
  });

  // With no report, each enquiry item line becomes a line; a line naming a material brings its material row.
  const enqLines = rep ? [] : (enq.lines || []).map(l => ({ ...l, key: rid() }));
  // Materials: the site report's section 5 (or the enquiry item lines that name a material).
  const srcRows = rep ? rep.s5.rows : enqLines.filter(l => l.itemRef?.startsWith('itm:')).map(l => ({ itemId: l.itemRef.slice(4), name: l.itemName, qty: l.qty, remarks: l.description, lineKey: l.key }));
  const one = shutters.length === 1 ? shutters[0].key : '';
  const materials = srcRows.filter(r => r.name).map(r => {
    const it = findItem(r.itemId, r.name);
    return { key: rid(), itemId: it?.id || '', name: it?.name || r.name, spec: r.spec || it?.spec || '', unit: r.unit || it?.unit || '', qty: Number(r.qty) || 1,
      wastage: Number(it?.wastage) || 0, rate: Number(it?.rate) || 0, leadDays: Number(it?.leadDays) || 0, placeholder: !!it?.placeholders?.includes('rate'), noRate: !it,
      lineKey: r.lineKey || (shutters.some(s => s.key === r.shutterKey) ? r.shutterKey : one) };
  });

  // Lines: one per shutter (with no report, one per enquiry item line).
  const lines = shutters.length
    ? shutters.map(s => ({ key: s.key, tag: s.tag, description: lineText(s, materials.filter(m => m.lineKey === s.key)) }))
    : enqLines.map(l => ({ key: l.key, tag: '', description: [l.itemName && `${l.qty || 1} × ${l.itemName}`, l.description].filter(Boolean).join(': ') }));

  // Labour: one row per shutter for the team, plus one for extra workers (L / XL). After hours → OT column.
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
      date: today(), preparedBy: store.currentActor(), findings: rep?.s2?.findings || enq.description, description: rep?.s2?.description || enq.description },
    costingLevel: d.costingLevel, sharedCosts: d.sharedCosts, sharedLabel: zone ? `Transport & mobilisation (Zone ${zone.code})` : 'Transport & mobilisation',
    overheads: [{ key: rid(), name: 'Overheads', basis: 'PCT', value: d.overheadPct }], marginBasis: d.marginBasis, marginPct: d.marginPct,
    ...companyTax(), shutters, lines, labour, transport, materials, equipment, afterHours: ot,
    svrManHours: rep ? (Number(rep.s3.persons) || 0) * (Number(rep.s3.days) || 0) * (Number(rep.s3.hoursPerDay) || 0) : 0,
  };
}

export const latestReport = enq => {
  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const rep = insp?.reportId ? store.get('siteReports', insp.reportId) : null;
  return rep?.status === 'Submitted' ? rep : null;
};

// The current (latest) estimate revision of an enquiry.
export const currentEstimate = enqId => store.list('estimates', e => e.enquiryId === enqId && e.status !== 'Superseded').sort((a, b) => b.rev - a.rev)[0] || null;
export const revisions = no => store.list('estimates', e => e.no === no).sort((a, b) => a.rev - b.rev);

// "Create estimate" is offered on an inspected repair enquiry (or one waiting for an estimate) with none yet.
export const canCreateFor = enq => enq.type === 'REPAIR' && ['Inspected', 'Waiting for estimate'].includes(enq.status) && !currentEstimate(enq.id) && auth.can('estimation', 'create');

export function createEstimate(enqId) {
  const enq = store.get('enquiries', enqId);
  const existing = currentEstimate(enqId);
  if (existing) return existing;
  const no = store.nextNumber('EST');
  const est = store.insert('estimates', { no, rev: 1, ...prefill(enq, latestReport(enq)), quotationId: '', prevId: '', returnNote: null },
    { status: 'Draft', note: `${no} Rev 1 pre-filled from ${enq.no}` });
  store.setStatus('enquiries', enqId, 'Estimating', `${no} Rev 1`);
  return est;
}

export const canEdit = est => est.status === 'Draft' && auth.can('estimation', 'edit');
// Saves only the estimate's content, and only while it is a draft: a late autosave from the page can never undo
// "Create quotation" (status, quotation link) or edit a quoted revision.
const CONTENT = ['header', 'costingLevel', 'sharedCosts', 'sharedLabel', 'overheads', 'marginBasis', 'marginPct', 'shutters', 'lines', 'labour', 'transport', 'materials', 'equipment'];
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
export const estimateSummary = est => summarize(est, zones());

// Revise: Rev n+1 as a new draft; the old revision is kept (Superseded). without: line keys to drop
// (partial acceptance), with their rows; shared costs are then spread over the remaining lines.
export function reviseEstimate(id, { without = [], note = '' } = {}) {
  const cur = store.get('estimates', id);
  const live = liveQuotation(cur.enquiryId);
  if (live && CLOSED_QUOTE.includes(live.status)) return null;
  const copy = structuredClone(cur);
  ['id', 'tenantId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'status', 'statusHistory'].forEach(k => delete copy[k]);
  if (without.length) {
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
  const s = estimateSummary(est);
  const p = [];
  if (!s.direct) p.push('The estimate has no cost yet.');
  if (est.materials.some(m => m.noRate && !m.rate)) p.push('A material has no rate (not in the Material/Item master).');
  if (est.costingLevel === 'LINE' && !est.lines.length) p.push('Line costing needs at least one line.');
  if (!String(est.header.description || '').trim()) p.push('Enter the description (Summary tab).');
  return p;
}

export const textWithCompany = text => withCompany(text, auth.company());
