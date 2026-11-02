// AMC and General Servicing estimates (the team lead's AMC estimator: Labour_Matrix, Shutters, Transport, Equipment,
// Overhead & Margin, Summary), pre-filled from the enquiry, each site's shutter register and the masters.
// The calculations are in costing.js (summarizeAmc); this file builds, checks and revises the estimate's data.
import * as store from './store.js';
import * as auth from './auth.js';
import { findSite, zones } from './lookups.js';
import { hourlyRate, amcSiteRow, summarizeAmc } from './costing.js';
import { companyTax, latestReport } from './estimates.js';

const rid = () => store.uid('r_');
const num = v => Number(v) || 0;
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Defaults from the AMC Excel (overheads 10 %, markup 20 %); Transaction Setup can change them per company (Part B).
export const AMC_DEFAULTS = { costingLevel: 'JOB', sharedCosts: 'SPREAD', overheadPct: 10, marginBasis: 'MARKUP', marginPct: 20, visitsPerYear: 4,
  billing: 'MONTHLY', periodMonths: 12, renewalDays: 60, liftHeightM: 4 };
export const amcDefaults = () => ({ ...AMC_DEFAULTS, ...(auth.company()?.txDefaults?.amc || {}) });

// Labour_Matrix from the masters: the AMC rate set of the Labour master and the AMC hours of the Shutter Size master.
export function amcMatrix() {
  const rows = store.list('labour', l => l.rateSet === 'AMC' && l.status !== 'Inactive');
  const pick = code => rows.find(l => l.code === code) || rows[0];
  const rate = l => ({ labourId: l?.id || '', name: l?.name || '', monthly: num(l?.monthly), days: l?.days || 26, hours: l?.hours || 8, rate: hourlyRate(l?.monthly, l?.days, l?.hours) });
  const limits = s => (s.maxWidth == null ? 'larger' : `≤ ${s.maxWidth} m W × ≤ ${s.maxHeight} m H`);
  const sizes = store.list('sizes', s => s.status !== 'Inactive').sort((a, b) => a.order - b.order)
    .map(s => ({ code: s.code, name: s.name, limits: limits(s), teamHrs: num(s.amcTeamHrs), extraWorkers: num(s.amcExtraWorkers), extraHrs: num(s.amcExtraHrs) }));
  return { team: rate(pick('LAB-A1')), extra: rate(pick('LAB-A2')), sizes };
}

const covered = site => (site?.shutters || []).filter(s => s.status !== 'Inactive');
export const countBySize = list => list.reduce((c, s) => ({ ...c, [s.sizeCode]: (c[s.sizeCode] || 0) + 1 }), {});
const zoneOf = id => store.get('zones', id);

// One Shutters-tab row for a customer site: every active shutter of its register is covered (untick to leave one out);
// a site with no register gets typed counts.
export function siteEntry(site, visits, shutterIds = null) {
  const list = covered(site).filter(s => !shutterIds || shutterIds.includes(s.id));
  const typed = !covered(site).length;
  return { key: site.id, siteId: site.id, name: site.name, zoneId: site.zoneId || '', visits: num(visits), typed, shutterIds: list.map(s => s.id), counts: typed ? {} : countBySize(list) };
}

// A Transport row for every zone the sites use: the zone's round trip and AMC rate from the Transport master.
function transportRows(sites, keep = []) {
  const ids = [...new Set(sites.map(s => s.zoneId).filter(Boolean))];
  return ids.map(id => keep.find(t => t.zoneId === id) || (z => ({ key: rid(), zoneId: z.id, zoneLabel: `Zone ${z.code} · ${z.name}`, distance: z.distance || '', vehicle: z.vehicle || '',
    hrs: num(z.roundTripHours), rate: num(z.amcRate), placeholder: (z.placeholders || []).some(p => ['amcRate', 'roundTripHours'].includes(p)) }))(zoneOf(id))).filter(Boolean);
}

// A Scissor Lift for each site with a covered shutter taller than the lift height (1 lift-day per visit).
function liftRows(sites, rep) {
  const lift = store.findOne('equipment', e => e.code === 'EQ-01' && e.status !== 'Inactive');
  if (!lift) return [];
  const { liftHeightM } = amcDefaults();
  return sites.map(s => {
    const { site } = findSite(s.siteId);
    const tall = covered(site).filter(sh => s.shutterIds.includes(sh.id) && num(sh.heightM) > liftHeightM).sort((a, b) => b.heightM - a.heightM)[0];
    const fromReport = rep && rep.siteId === s.siteId && rep.s4?.scissor;
    if (!tall && !fromReport) return null;
    return { key: rid(), equipmentId: lift.id, name: lift.name, ownership: lift.ownership, basis: lift.basis, qty: num(rep?.s4?.scissorNos) || 1, duration: 1, siteKey: s.key, rate: num(lift.rate),
      reason: tall ? `${tall.tag} is ${Math.round(tall.heightM * 10) / 10} m high` : 'ticked in the site report' };
  }).filter(Boolean);
}

export function describe(est) {
  const shutters = (est.sites || []).reduce((t, s) => t + amcSiteRow(s, est.matrix).shutters, 0);
  const where = (est.sites || []).map(s => s.name).join(', ');
  if (est.jobType === 'GS') return `General servicing of ${shutters} shutter${shutters === 1 ? '' : 's'} at ${where}`;
  const v = [...new Set((est.sites || []).map(s => num(s.visits)))];
  return `Annual maintenance contract: ${shutters} shutter${shutters === 1 ? '' : 's'} at ${where}, ${v.join(' / ')} visit${v.length === 1 && v[0] === 1 ? '' : 's'} a year, ${est.periodMonths} months`;
}

// Everything an AMC / GS estimate needs, pre-filled. from: an AMC contract being renewed (same sites, shutters, visits).
export function amcPrefill(enq, { from } = {}) {
  const d = amcDefaults();
  const gs = enq.type === 'GS';
  const rep = latestReport(enq);
  const { site } = findSite(enq.siteId);
  const sites = from ? from.sites.map(s => siteEntry(findSite(s.siteId).site || { id: s.siteId, name: s.name, zoneId: s.zoneId }, s.visits, s.shutters.map(x => x.shutterId)))
    : [siteEntry(site, gs ? 1 : d.visitsPerYear, rep?.shutters?.length ? rep.shutters.map(x => x.shutterId) : null)];
  const est = {
    kind: 'AMC', jobType: enq.type, enquiryId: enq.id, reportId: rep?.id || '', customerId: enq.customerId, siteId: enq.siteId,
    header: { customer: enq.customerName, contact: enq.contactName, phone: enq.mobile || enq.email, site: sites.map(s => s.name).join(', '),
      address: [site?.address, site?.blockUnit].filter(Boolean).join(', '), date: today(), preparedBy: store.currentActor(), findings: rep?.s2?.findings || enq.description, description: '' },
    periodMonths: gs ? 0 : (from?.periodMonths || d.periodMonths), billing: gs ? 'ONCE' : (from?.billing || d.billing),
    costingLevel: d.costingLevel, sharedCosts: d.sharedCosts, overheads: [{ key: rid(), name: 'Overheads', basis: 'PCT', value: d.overheadPct }],
    marginBasis: d.marginBasis, marginPct: d.marginPct, ...companyTax(),
    matrix: amcMatrix(), sites, transport: transportRows(sites), equipment: liftRows(sites, rep), materials: [], lines: [],
  };
  est.header.description = describe(est);
  return est;
}

// "+ Add a site of this customer" on the estimate: another site of the same customer, with its zone's transport row.
export function addSiteTo(est, siteId) {
  if (est.sites.some(s => s.siteId === siteId)) return est;
  const { site } = findSite(siteId);
  if (!site) return est;
  const entry = siteEntry(site, est.jobType === 'GS' ? 1 : amcDefaults().visitsPerYear);
  const sites = [...est.sites, entry];
  return { ...est, sites, transport: transportRows(sites, est.transport), equipment: [...est.equipment, ...liftRows([entry])] };
}
export function removeSiteFrom(est, key) {
  const sites = est.sites.filter(s => s.key !== key);
  return { ...est, sites, transport: transportRows(sites, est.transport), equipment: est.equipment.filter(r => r.siteKey !== key), materials: est.materials.filter(r => r.siteKey !== key) };
}
// Tick or untick shutters of a site's register; the counts by size follow.
export function setCovered(est, key, shutterIds) {
  const sites = est.sites.map(s => {
    if (s.key !== key) return s;
    const { site } = findSite(s.siteId);
    return { ...s, shutterIds, counts: countBySize(covered(site).filter(sh => shutterIds.includes(sh.id))) };
  });
  return { ...est, sites };
}
export const otherSites = est => (store.get('customers', est.customerId)?.sites || []).filter(s => !est.sites.some(x => x.siteId === s.id));
export const isRenewal = est => !!store.get('enquiries', est.enquiryId)?.renewsContractId;

// Problems that stop "Create quotation".
export function amcProblems(est) {
  const s = summarizeAmc(est, zones());
  const p = [];
  if (!s.metrics.shutters) p.push('No shutters are covered yet (Shutters tab).');
  est.sites.forEach(x => { if (!num(x.visits)) p.push(`${x.name}: enter the visits per year.`); });
  est.sites.forEach(x => { if (x.zoneId && !est.transport.some(t => t.zoneId === x.zoneId)) p.push(`${x.name}: its zone has no Transport row.`); });
  if (!s.direct) p.push('The estimate has no cost yet.');
  if (!String(est.header.description || '').trim()) p.push('Enter the description (Summary tab).');
  return p;
}

// What the system checks before the Approver looks at an AMC / GS quotation (flow step 5: customer, site, items, price, GST).
export function amcChecks(q, est, add) {
  const enq = store.get('enquiries', q.enquiryId);
  add(q.customerId === enq.customerId, `Customer and contact match ${enq.no}`);
  est.sites.forEach(x => {
    const r = amcSiteRow(x, est.matrix);
    if (x.typed) add(false, `${x.name}: ${r.shutters} shutters typed from the BOQ (no shutter register yet; it is made when the contract starts)`);
    else { const all = covered(findSite(x.siteId).site).length; add(true, `${x.name}: ${r.shutters} of ${all} shutters in the register covered, ${x.visits} visit${x.visits === 1 ? '' : 's'} a year`); }
  });
  est.transport.filter(t => t.placeholder).forEach(t => add(false, `${t.zoneLabel}: AMC rate ${num(t.rate).toFixed(2)} / travel ${num(t.hrs)} h per trip is a placeholder`));
  const s = summarizeAmc(est, zones());
  if (est.billing !== 'ONCE') add(true, `${s.plan.length} invoice${s.plan.length > 1 ? 's' : ''} in the billing plan; ${q.taxLabel || 'tax'} worked out on each invoice`);
}
