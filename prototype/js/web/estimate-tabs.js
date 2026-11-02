// The estimate's Excel tabs as editable tables (same columns and formulas as the team lead's Repair estimator):
// Shutters to repair, Labour, Transport, Materials, Equipment, Overhead & Margin. Every pre-filled value stays
// editable. "For" (which line a row belongs to) shows only with Line costing; a row with no line is a shared cost.
import { syncPartLine } from '../core/estimates.js';
import * as store from '../core/store.js';
import { html, fmtNum } from '../core/ui.js';
import { zones, items, vsOptions } from '../core/lookups.js';
import { labourRow, materialRow, transportRow, equipmentRow, shutterLabour, hourlyRate, otRate, round2 } from '../core/costing.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rid = () => store.uid('r_');

// One editable cell: data-t (tab), data-i (row), data-f (field).
function inp(ctx, t, i, f, v, { type = 'number', step = 'any', w = 70, list } = {}) {
  if (!ctx.editable) return type === 'number' ? fmtNum(v, 2) : v;
  return html`<input type="${type}" ${type === 'number' ? html`step="${step}"` : ''} data-t="${t}" data-i="${i}" data-f="${f}" value="${v ?? ''}" style="width:${w}px" ${list ? html`list="${list}"` : ''}>`;
}
function sel(ctx, t, i, f, v, options, label) {
  if (!ctx.editable) return label ?? options.find(o => String(o.value) === String(v))?.label ?? '';
  return html`<select data-t="${t}" data-i="${i}" data-f="${f}">${options.map(o => html`<option value="${o.value}" ${String(o.value) === String(v) ? 'selected' : ''}>${o.label}</option>`)}</select>`;
}
const lineOptions = est => [{ value: '', label: 'Shared (whole job)' }, ...est.lines.map(l => ({ value: l.key, label: l.tag || l.description.slice(0, 18) }))];
const forCell = (ctx, est, t, i, r) => (est.costingLevel === 'LINE' ? html`<td>${sel(ctx, t, i, 'lineKey', r.lineKey || '', lineOptions(est))}</td>` : '');
const forHead = est => (est.costingLevel === 'LINE' ? html`<th>For</th>` : '');
const del = (ctx, t, i) => (ctx.editable ? html`<td><button type="button" class="btn link small" data-del="${t}" data-i="${i}" title="Remove this row">✕</button></td>` : '');
const delHead = ctx => (ctx.editable ? html`<th></th>` : '');
const addBtn = (ctx, t, label) => (ctx.editable ? html`<button type="button" class="add-dashed" data-add="${t}" style="margin-top:6px">+ ${label}</button>` : '');
const total = (cols, value, before = 0) => html`<tr class="sum"><td colspan="${before}"><b>TOTAL</b></td>${value}${cols ? html`<td colspan="${cols}"></td>` : ''}</tr>`;

function shuttersTab(est, ctx) {
  const labourFor = key => est.labour.filter(r => r.lineKey === key).reduce((t, r) => t + labourRow(r).total, 0);
  if (!est.shutters.length) return html`<div class="muted">No products in a site report's Job scope. Add labour rows in the Labour tab.</div>`;
  const dim = (v, u) => (v == null || v === '' ? '—' : `${fmtNum(v)} ${u}`); // a size tapped on site has no width or height
  return html`<table class="tbl"><thead><tr><th>Location / Label</th><th>Type</th><th>Width</th><th>Height</th><th class="num">Qty</th><th>Fault Reported</th><th>Size Class</th><th class="num">Team hrs</th><th class="num">Extra workers × hrs</th><th class="num">Labour Amount</th></tr></thead><tbody>
    ${est.shutters.map((s, i) => html`<tr><td><b>${s.tag}</b> ${s.location}</td><td>${s.typeName}</td><td>${dim(s.width, s.unit)}</td><td>${dim(s.height, s.unit)}</td>
      <td class="num">${inp(ctx, 'shutters', i, 'qty', s.qty, { w: 50, step: 1 })}</td><td class="wrap">${inp(ctx, 'shutters', i, 'fault', s.fault, { type: 'text', w: 210 })}</td><td>${s.sizeCode}</td>
      <td class="num">${fmtNum(s.teamHrs)}</td><td class="num">${s.extraWorkers ? `${s.extraWorkers} × ${fmtNum(s.extraHrs)}` : '—'}</td><td class="num">${m2(labourFor(s.key))}</td></tr>`)}
  </tbody></table><p class="mini-note">From the products in the site report's Job scope. Hours = the Shutter Size master's repair hours × qty; they fill the Labour tab, so labour is counted once.</p>`;
}

function labourTab(est, ctx) {
  const trades = store.list('labour', l => l.rateSet === 'Repair' && l.status !== 'Inactive').map(l => ({ value: l.id, label: l.name }));
  const sum = est.labour.reduce((t, r) => { const x = labourRow(r); return { hrs: t.hrs + (Number(r.hrs) || 0) + (Number(r.otHrs) || 0), basic: t.basic + x.basic, ot: t.ot + x.ot, total: t.total + x.total }; }, { hrs: 0, basic: 0, ot: 0, total: 0 });
  const teamHrs = est.labour.filter(r => r.team === 1 && !/additional/i.test(r.trade)).reduce((t, r) => t + (Number(r.hrs) || 0) + (Number(r.otHrs) || 0), 0);
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Trade / Role</th>${forHead(est)}<th>Skill Level</th><th class="num">Team</th><th class="num">Hrs</th><th class="num">Rate per Hr</th><th class="num">Basic Cost</th><th class="num">OT Hours</th><th class="num">OT Rate</th><th class="num">OT Cost</th><th class="num">Total Labour Cost</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.labour.map((r, i) => { const x = labourRow(r); return html`<tr><td>${i + 1}</td><td>${sel(ctx, 'labour', i, 'labourId', r.labourId, trades, r.trade)}${r.forTag && est.costingLevel !== 'LINE' ? html` <span class="muted small">${r.forTag}</span>` : ''}</td>${forCell(ctx, est, 'labour', i, r)}
      <td>${r.skill}</td><td class="num">${inp(ctx, 'labour', i, 'team', r.team, { w: 46, step: 1 })}</td><td class="num">${inp(ctx, 'labour', i, 'hrs', r.hrs, { w: 56 })}</td><td class="num">${m2(r.rate)}</td><td class="num">${m2(x.basic)}</td>
      <td class="num">${inp(ctx, 'labour', i, 'otHrs', r.otHrs, { w: 56 })}</td><td class="num">${m2(r.otRate)}</td><td class="num">${m2(x.ot)}</td><td class="num">${m2(x.total)}</td>${del(ctx, 'labour', i)}</tr>`; })}
    <tr class="sum"><td></td><td><b>TOTAL</b></td>${est.costingLevel === 'LINE' ? html`<td></td>` : ''}<td></td><td></td><td class="num">${fmtNum(sum.hrs)}</td><td></td><td class="num">${m2(sum.basic)}</td><td></td><td></td><td class="num">${m2(sum.ot)}</td><td class="num"><b>${m2(sum.total)}</b></td>${delHead(ctx)}</tr>
  </tbody></table>${addBtn(ctx, 'labour', 'Add labour row')}
  ${est.svrManHours ? html`<p class="mini-note">Check: ${fmtNum(teamHrs)} team-hours = ${fmtNum(teamHrs * 2)} man-hours for a team of 2; the site report says ${fmtNum(est.svrManHours)} man-hours.${est.afterHours ? ' The site report says overtime (after 5:30 pm) or weekend, so the hours are in the OT column (1.5 ×).' : ''}</p>` : ''}`;
}

function transportTab(est, ctx) {
  const zs = [{ value: '', label: '—' }, ...zones().map(z => ({ value: z.id, label: `Zone ${z.code} · ${z.name}` }))];
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Zone</th>${forHead(est)}<th>Distance Range</th><th>Vehicle Type</th><th class="num">Trips</th><th class="num">No. of Hrs</th><th class="num">Fixed Charge per Hr</th><th class="num">Total Transport Cost</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.transport.map((r, i) => html`<tr><td>${i + 1}</td><td>${sel(ctx, 'transport', i, 'zoneId', r.zoneId, zs, r.zoneLabel)}</td>${forCell(ctx, est, 'transport', i, r)}<td>${r.distance}</td><td>${r.vehicle}</td>
      <td class="num">${inp(ctx, 'transport', i, 'trips', r.trips, { w: 50, step: 1 })}</td><td class="num">${inp(ctx, 'transport', i, 'hrs', r.hrs, { w: 56 })}</td><td class="num">${inp(ctx, 'transport', i, 'rate', r.rate, { w: 70 })}</td><td class="num">${m2(transportRow(r))}</td>${del(ctx, 'transport', i)}</tr>`)}
    ${total(ctx.editable ? 1 : 0, html`<td class="num"><b>${m2(est.transport.reduce((t, r) => t + transportRow(r), 0))}</b></td>`, est.costingLevel === 'LINE' ? 8 : 7)}
  </tbody></table>${addBtn(ctx, 'transport', 'Add a trip or zone')}
  <p class="mini-note">The site's zone with its Repair rate. No. of Hrs = trips × the zone's travel hours per trip ("Trips" is a screen helper).</p>`;
}

function materialsTab(est, ctx) {
  const opts = [{ value: '', label: '— pick from the master —' }, ...items().map(it => ({ value: it.id, label: it.name }))];
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Product</th>${forHead(est)}<th>Specification / Grade</th><th>Unit</th><th class="num">Quantity</th><th class="num">Wastage %</th><th class="num">Total Qty</th><th class="num">Rate per Unit</th><th class="num">Amount</th><th>Lead Time Spares</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.materials.map((r, i) => { const x = materialRow(r); return html`<tr><td>${i + 1}</td><td>${sel(ctx, 'materials', i, 'itemId', r.itemId, opts, r.name)}${!r.itemId ? html` <span class="tag">${r.name || 'new item'}</span>` : ''}</td>${forCell(ctx, est, 'materials', i, r)}
      <td>${r.spec}</td><td>${r.unit}</td><td class="num">${inp(ctx, 'materials', i, 'qty', r.qty, { w: 56 })}</td><td class="num">${inp(ctx, 'materials', i, 'wastage', r.wastage, { w: 50 })}</td><td class="num">${fmtNum(x.totalQty)}</td>
      <td class="num">${inp(ctx, 'materials', i, 'rate', r.rate, { w: 76 })}${r.placeholder ? html` <span class="tag">placeholder</span>` : ''}</td><td class="num">${m2(x.amount)}</td><td>${r.leadDays ? `${r.leadDays} days` : 'in stock'}</td>${del(ctx, 'materials', i)}</tr>`; })}
    ${total(ctx.editable ? 2 : 1, html`<td class="num"><b>${m2(est.materials.reduce((t, r) => t + materialRow(r).amount, 0))}</b></td>`, est.costingLevel === 'LINE' ? 9 : 8)}
  </tbody></table>${addBtn(ctx, 'materials', 'Add material')}
  <p class="mini-note">From site report section 5, matched to the Material/Item master (spec, unit, rate, wastage, lead time).</p>`;
}

function equipmentTab(est, ctx) {
  const opts = [{ value: '', label: '—' }, ...store.list('equipment', e => e.status !== 'Inactive').map(e => ({ value: e.id, label: e.name }))];
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Equipment</th>${forHead(est)}<th>Ownership</th><th>Rate Basis</th><th class="num">Qty</th><th class="num">Duration (days / hrs)</th><th class="num">Rate per Unit</th><th class="num">Amount</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.equipment.length ? html`${est.equipment.map((r, i) => html`<tr><td>${i + 1}</td><td>${sel(ctx, 'equipment', i, 'equipmentId', r.equipmentId, opts, r.name)}${r.byCustomer ? html` <span class="muted small">provided by customer</span>` : ''}</td>${forCell(ctx, est, 'equipment', i, r)}
      <td>${r.ownership}</td><td>${r.basis}</td><td class="num">${inp(ctx, 'equipment', i, 'qty', r.qty, { w: 50, step: 1 })}</td><td class="num">${inp(ctx, 'equipment', i, 'duration', r.duration, { w: 56 })}</td><td class="num">${inp(ctx, 'equipment', i, 'rate', r.rate, { w: 70 })}</td><td class="num">${m2(equipmentRow(r))}</td>${del(ctx, 'equipment', i)}</tr>`)}`
      : html`<tr><td colspan="9" class="empty">No equipment ticked in the site report.</td></tr>`}
    ${total(ctx.editable ? 1 : 0, html`<td class="num"><b>${m2(est.equipment.reduce((t, r) => t + equipmentRow(r), 0))}</b></td>`, est.costingLevel === 'LINE' ? 8 : 7)}
  </tbody></table>${addBtn(ctx, 'equipment', 'Add equipment')}`;
}

function overheadTab(est, ctx, s) {
  const bases = vsOptions('OVERHEAD_BASIS');
  return html`<table class="tbl edit cost-tbl" style="max-width:760px"><tbody>
    <tr class="sum"><td colspan="3">Total Direct Cost (Labour + Transport + Materials + Equipment)</td><td class="num">${m2(s.direct)}</td>${delHead(ctx)}</tr>
    <tr><th>Overhead Item</th><th>Basis</th><th class="num">Value (% or amount)</th><th class="num">Amount</th>${delHead(ctx)}</tr>
    ${est.overheads.map((r, i) => html`<tr><td>${inp(ctx, 'overheads', i, 'name', r.name, { type: 'text', w: 180 })}</td><td>${sel(ctx, 'overheads', i, 'basis', r.basis, bases)}</td><td class="num">${inp(ctx, 'overheads', i, 'value', r.value, { w: 76 })}</td>
      <td class="num">${m2(r.basis === 'FIXED' ? Number(r.value) || 0 : s.direct * (Number(r.value) || 0) / 100)}</td>${del(ctx, 'overheads', i)}</tr>`)}
    <tr class="sum"><td colspan="3">TOTAL OVERHEAD</td><td class="num">${m2(s.overhead)}</td>${delHead(ctx)}</tr>
    <tr><td colspan="3">Cost before Margin (Direct + Overhead)</td><td class="num">${m2(s.cbm)}</td>${delHead(ctx)}</tr>
    <tr><td colspan="3">Margin (${est.marginBasis === 'MARGIN' ? 'margin on price' : 'markup on cost'} ${fmtNum(est.marginPct)} %)</td><td class="num">${m2(s.margin)}</td>${delHead(ctx)}</tr>
    <tr class="sum"><td colspan="3">Selling Price</td><td class="num">${m2(s.subtotal)}</td>${delHead(ctx)}</tr>
    <tr><td colspan="3">${est.taxLabel || 'Tax'} ${fmtNum(est.taxRate)} % (Tax master)</td><td class="num">${m2(s.tax)}</td>${delHead(ctx)}</tr>
    <tr class="grand"><td colspan="3">TOTAL QUOTE</td><td class="num">${m2(s.total)}</td>${delHead(ctx)}</tr>
  </tbody></table>${addBtn(ctx, 'overheads', 'Add overhead row')}
  <p class="mini-note">A % overhead is applied to each line's cost; a fixed amount is a shared cost (spread into the lines or shown in the shared line).</p>`;
}

export const TABS = [
  ['summary', 'Summary'], ['shutters', 'Shutters to repair'], ['labour', 'Labour'], ['transport', 'Transport'],
  ['materials', 'Materials'], ['equipment', 'Equipment'], ['overheads', 'Overhead & Margin'],
];
export function tabHtml(key, est, ctx, s) {
  return { shutters: shuttersTab, labour: labourTab, transport: transportTab, materials: materialsTab, equipment: equipmentTab, overheads: overheadTab }[key]?.(est, ctx, s) || '';
}

// Default rows for "+ Add …"
export function newRow(t, est) {
  const team = store.list('labour', l => l.rateSet === 'Repair' && l.status !== 'Inactive')[0];
  const z = store.get('zones', est.transport[0]?.zoneId) || zones()[0];
  const h = hourlyRate(team?.monthly, team?.days, team?.hours);
  return {
    labour: { key: rid(), labourId: team?.id || '', trade: team?.name || '', skill: team?.skill || '', team: 1, hrs: 1, rate: h, otHrs: 0, otRate: otRate(h, team?.otMultiplier), lineKey: est.lines[0]?.key || '' },
    transport: { key: rid(), zoneId: z?.id || '', zoneLabel: z ? `Zone ${z.code} · ${z.name}` : '', distance: z?.distance || '', vehicle: z?.vehicle || '', trips: 1, roundTrip: Number(z?.roundTripHours) || 0, hrs: Number(z?.roundTripHours) || 0, rate: Number(z?.repairRate) || 0, lineKey: '' },
    materials: { key: rid(), itemId: '', name: '', spec: '', unit: '', qty: 1, wastage: 0, rate: 0, leadDays: 0, lineKey: est.lines.length === 1 ? est.lines[0].key : '' },
    equipment: { key: rid(), equipmentId: '', name: '', ownership: '', basis: '', qty: 1, duration: 1, rate: 0, lineKey: '' },
    overheads: { key: rid(), name: 'Overheads', basis: 'FIXED', value: 0 },
  }[t];
}

// After a select or a helper field changes, fill the dependent cells from the masters.
export function applyChange(est, t, i, f) {
  const r = est[t][i];
  if (t === 'labour' && f === 'labourId') {
    const l = store.get('labour', r.labourId);
    const h = hourlyRate(l?.monthly, l?.days, l?.hours);
    Object.assign(r, { trade: l?.name || '', skill: l?.skill || '', rate: h, otRate: otRate(h, l?.otMultiplier) });
  }
  if (t === 'transport' && (f === 'zoneId' || f === 'trips')) {
    const z = store.get('zones', r.zoneId);
    if (f === 'zoneId') Object.assign(r, { zoneLabel: z ? `Zone ${z.code} · ${z.name}` : '', distance: z?.distance || '', vehicle: z?.vehicle || '', roundTrip: Number(z?.roundTripHours) || 0, rate: Number(z?.repairRate) || 0 });
    r.hrs = round2((Number(r.trips) || 0) * (Number(r.roundTrip) || 0));
  }
  if (t === 'materials' && f === 'itemId') {
    const it = store.get('items', r.itemId);
    if (it) Object.assign(r, { name: it.name, spec: it.spec || '', unit: it.unit, rate: Number(it.rate) || 0, wastage: Number(it.wastage) || 0, leadDays: Number(it.leadDays) || 0, placeholder: !!it.placeholders?.includes('rate'), noRate: false });
  }
  if (t === 'materials' && ['itemId', 'qty', 'unit'].includes(f)) syncPartLine(est, r.key);
  if (t === 'equipment' && f === 'equipmentId') {
    const e = store.get('equipment', r.equipmentId);
    if (e) Object.assign(r, { name: e.name, ownership: e.ownership, basis: e.basis, rate: Number(e.rate) || 0 });
  }
  if (t === 'shutters' && f === 'qty') {
    const size = store.list('sizes').find(z => z.code === r.sizeCode);
    Object.assign(r, shutterLabour(size, r.qty));
    est.labour.filter(x => x.lineKey === r.key).forEach(x => {
      const extra = /additional/i.test(x.trade);
      const h = extra ? r.extraHrs : r.teamHrs;
      if (Number(x.otHrs) && !Number(x.hrs)) x.otHrs = h; else x.hrs = h;
    });
  }
}
