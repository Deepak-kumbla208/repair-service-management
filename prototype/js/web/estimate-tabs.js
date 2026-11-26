// The estimate's Excel tabs as editable tables (same columns and formulas as the team lead's Repair estimator):
// Products to repair, Labour, Transport, Materials, Equipment, Overhead & Margin. Every pre-filled value stays
// editable. "For" (which line a row belongs to) shows only with Line costing; a row with no line is a shared cost.
// This is the Excel view: the column names are the workbook's own. Every input carries a label for screen readers
// (the column and the row), and the part of a Materials row is picked in a type-to-search box.
import { syncPartLine, syncProductLabour, setLineQty } from '../core/estimates.js';
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, fmtNum } from '../core/ui.js';
import { pickerHtml } from './picker.js';
import { zones, vsOptions } from '../core/lookups.js';
import { labourRow, materialRow, transportRow, equipmentRow, fixedRow, hourlyRate, otRate, round2 } from '../core/costing.js';
import { productOf, repairLabour, costingOf, sizeText, sizesOf } from '../core/products.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rid = () => store.uid('r_');

// The column each input sits under, read out with its row ("Hrs, row 2").
const COLS = {
  shutters: { qty: 'Qty', sizeCode: 'Size', fault: 'Fault Reported' }, fixed: { qty: 'Qty', price: 'Price' }, lines: { description: 'Line' },
  labour: { labourId: 'Trade / Role', lineKey: 'For', team: 'Team', hrs: 'Hrs', otHrs: 'OT Hours' },
  transport: { zoneId: 'Zone', lineKey: 'For', trips: 'Trips', hrs: 'No. of Hrs', rate: 'Fixed Charge per Hr' },
  materials: { itemId: 'Product', lineKey: 'For', qty: 'Quantity', wastage: 'Wastage %', rate: 'Rate per Unit' },
  equipment: { equipmentId: 'Equipment', lineKey: 'For', qty: 'Qty', duration: 'Duration (days / hrs)', rate: 'Rate per Unit' },
  overheads: { name: 'Overhead Item', basis: 'Basis', value: 'Value (% or amount)' },
};
export const cellLabel = (t, i, f) => `${COLS[t]?.[f] || f}, row ${i + 1}`;

// One editable cell: data-t (tab), data-i (row), data-f (field).
function inp(ctx, t, i, f, v, { type = 'number', step = 'any', w = 70, list } = {}) {
  if (!ctx.editable) return type === 'number' ? fmtNum(v, 2) : v;
  return html`<input type="${type}" ${type === 'number' ? html`step="${step}"` : ''} data-t="${t}" data-i="${i}" data-f="${f}" value="${v ?? ''}" aria-label="${cellLabel(t, i, f)}" style="width:${w}px" ${list ? html`list="${list}"` : ''}>`;
}
function sel(ctx, t, i, f, v, options, label) {
  if (!ctx.editable) return label ?? options.find(o => String(o.value) === String(v))?.label ?? '';
  return html`<select data-t="${t}" data-i="${i}" data-f="${f}" aria-label="${cellLabel(t, i, f)}">${options.map(o => html`<option value="${o.value}" ${String(o.value) === String(v) ? 'selected' : ''}>${o.label}</option>`)}</select>`;
}
const lineOptions = est => [{ value: '', label: 'Shared (whole job)' }, ...est.lines.map(l => ({ value: l.key, label: l.tag || l.description.slice(0, 18) }))];
const forCell = (ctx, est, t, i, r) => (est.costingLevel === 'LINE' ? html`<td>${sel(ctx, t, i, 'lineKey', r.lineKey || '', lineOptions(est))}</td>` : '');
const forHead = est => (est.costingLevel === 'LINE' ? html`<th>For</th>` : '');
const del = (ctx, t, i) => (ctx.editable ? html`<td><button type="button" class="btn link small" data-del="${t}" data-i="${i}" title="Remove this row">✕</button></td>` : '');
const delHead = ctx => (ctx.editable ? html`<th></th>` : '');
const addBtn = (ctx, t, label) => (ctx.editable ? html`<button type="button" class="add-dashed" data-add="${t}" style="margin-top:6px">+ ${label}</button>` : '');
const total = (cols, value, before = 0) => html`<tr class="sum"><td colspan="${before}"><b>TOTAL</b></td>${value}${cols ? html`<td colspan="${cols}"></td>` : ''}</tr>`;

// Products to repair: each product's hours come from its product (Product master): the size's repair hours (Product
// Size) for a product costed by size, or its standard hours × qty. Fixed-price products follow in their own table.
function shuttersTab(est, ctx) {
  const labourFor = key => est.labour.filter(r => r.lineKey === key).reduce((t, r) => t + labourRow(r).total, 0);
  const fixed = est.fixed || [];
  // A product with a size set: its size from the site report; with no report, picked here (the hours follow it).
  const size = (s, i) => {
    const p = productOf(s.productId);
    if (costingOf(p) !== 'SIZE') return html`<span class="muted">no size</span>`;
    const measured = s.width || s.measure;
    if (measured || !ctx.editable) return sizeText(s, { none: '' }) || html`<span class="muted">not sized</span>`;
    return html`<select data-t="shutters" data-i="${i}" data-f="sizeCode" aria-label="${cellLabel('shutters', i, 'sizeCode')}" class="${s.sizeCode ? '' : 'invalid'}" title="Pick the size: the hours follow it"><option value="">Pick size</option>${sizesOf(p).map(z => html`<option value="${z.code}" ${z.code === s.sizeCode ? 'selected' : ''}>${z.code} – ${z.name}</option>`)}</select>`;
  };
  const products = est.shutters.length ? html`<table class="tbl"><thead><tr><th>Tag / Location</th><th>Product</th><th class="num">Qty</th><th>Unit</th><th>Size</th><th>Fault Reported</th><th class="num">Team hrs</th><th class="num">Extra workers × hrs</th><th class="num">Labour Amount</th></tr></thead><tbody>
    ${est.shutters.map((s, i) => html`<tr><td><b>${s.tag || ''}</b> ${s.location}</td><td>${s.typeName}</td>
      <td class="num">${inp(ctx, 'shutters', i, 'qty', s.qty, { w: 56 })}</td><td>${s.uom || 'Nos'}</td><td>${size(s, i)}</td><td class="wrap">${inp(ctx, 'shutters', i, 'fault', s.fault, { type: 'text', w: 210 })}</td>
      <td class="num">${fmtNum(s.teamHrs)}</td><td class="num">${s.extraWorkers ? `${s.extraWorkers} × ${fmtNum(s.extraHrs)}` : '—'}</td><td class="num">${m2(labourFor(s.key))}</td></tr>`)}
  </tbody></table><p class="mini-note">From the site report's Job scope, or from the enquiry's lines when there was no job assessment (pick each size there). Hours: by size, the Product Size master's repair hours × qty; with no size, the product's standard hours × qty. They fill the Labour tab, so labour is counted once.</p>`
    : fixed.length ? '' : html`<div class="muted">No products: the enquiry and the site report name none. Add labour rows in the Labour tab.</div>`;
  const fixedTable = fixed.length ? html`<h3 style="margin:14px 0 6px">Fixed-price products</h3><table class="tbl"><thead><tr><th>Product</th><th class="num">Qty</th><th>Unit</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>
    ${fixed.map((f, i) => html`<tr><td>${f.name}</td><td class="num">${inp(ctx, 'fixed', i, 'qty', f.qty, { w: 56 })}</td><td>${f.unit}</td><td class="num">${inp(ctx, 'fixed', i, 'price', f.price, { w: 86 })}</td><td class="num">${m2(fixedRow(f))}</td></tr>`)}
  </tbody></table><p class="mini-note">Prices from the Product master. They go to the quotation as they are: no overhead or markup is added, and no shared cost is spread onto them.</p>` : '';
  return html`${products}${fixedTable}`;
}

function labourTab(est, ctx) {
  const trades = store.list('labour', l => l.rateSet === 'Repair' && l.status !== 'Inactive').map(l => ({ value: l.id, label: l.name }));
  const sum = est.labour.reduce((t, r) => { const x = labourRow(r); return { hrs: t.hrs + (Number(r.hrs) || 0) + (Number(r.otHrs) || 0), basic: t.basic + x.basic, ot: t.ot + x.ot, total: t.total + x.total }; }, { hrs: 0, basic: 0, ot: 0, total: 0 });
  const teamHrs = est.labour.filter(r => r.team === 1 && !/additional/i.test(r.trade)).reduce((t, r) => t + (Number(r.hrs) || 0) + (Number(r.otHrs) || 0), 0);
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Trade / Role</th>${forHead(est)}<th>Skill Level</th><th class="num">Team</th><th class="num">Hrs</th><th class="num">Rate per Hr</th><th class="num">Basic Cost</th><th class="num">OT Hours</th><th class="num">OT Rate</th><th class="num">OT Cost</th><th class="num">Total Labour Cost</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.labour.map((r, i) => { const x = labourRow(r); return html`<tr><td>${i + 1}</td><td><div class="cell-tag">${sel(ctx, 'labour', i, 'labourId', r.labourId, trades, r.trade)}${r.forTag && est.costingLevel !== 'LINE' ? html`<span class="muted small">${r.forTag}</span>` : ''}</div></td>${forCell(ctx, est, 'labour', i, r)}
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
  ${!est.transport.length && (est.shutters.length || est.materials.length) ? html`<p class="note" style="margin-top:8px">No transport yet: the site has no zone. Set the zone on the customer's site, or add a trip here.</p>` : ''}
  <p class="mini-note">The site's zone with its Repair rate. No. of Hrs = trips × the zone's travel hours per trip ("Trips" is a screen helper).</p>`;
}

function materialsTab(est, ctx) {
  // The part is picked in a type-to-search box (the page gives it the parts and materials of the master).
  const part = (r, i) => (ctx.editable
    ? pickerHtml({ attrs: `data-t="materials" data-i="${i}" data-f="itemId"`, value: r.itemId, label: r.name, placeholder: 'Type to search parts', ariaLabel: cellLabel('materials', i, 'itemId') })
    : r.name);
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Product</th>${forHead(est)}<th>Specification / Grade</th><th>Unit</th><th class="num">Quantity</th><th class="num">Wastage %</th><th class="num">Total Qty</th><th class="num">Rate per Unit</th><th class="num">Amount</th><th>Lead Time Spares</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.materials.map((r, i) => { const x = materialRow(r); return html`<tr><td>${i + 1}</td><td><div class="cell-tag">${part(r, i)}${!r.itemId && r.name ? html`<span class="tag">Not in the price list</span>` : ''}</div></td>${forCell(ctx, est, 'materials', i, r)}
      <td>${r.spec}</td><td>${r.unit}</td><td class="num">${inp(ctx, 'materials', i, 'qty', r.qty, { w: 56 })}</td><td class="num">${inp(ctx, 'materials', i, 'wastage', r.wastage, { w: 50 })}</td><td class="num">${fmtNum(x.totalQty)}</td>
      <td class="num"><div class="cell-stack">${inp(ctx, 'materials', i, 'rate', r.rate, { w: 76 })}${r.placeholder ? html`<span class="tag">Rate to confirm</span>` : ''}</div></td><td class="num">${m2(x.amount)}</td><td>${r.leadDays ? `${r.leadDays} days` : 'in stock'}</td>${del(ctx, 'materials', i)}</tr>`; })}
    ${total(ctx.editable ? 2 : 1, html`<td class="num"><b>${m2(est.materials.reduce((t, r) => t + materialRow(r).amount, 0))}</b></td>`, est.costingLevel === 'LINE' ? 9 : 8)}
  </tbody></table>${addBtn(ctx, 'materials', 'Add material')}
  <p class="mini-note">From site report section 5, matched to the Material/Item master (spec, unit, rate, wastage, lead time).</p>`;
}

function equipmentTab(est, ctx) {
  const opts = [{ value: '', label: '—' }, ...store.list('equipment', e => e.status !== 'Inactive').map(e => ({ value: e.id, label: e.name }))];
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Equipment</th>${forHead(est)}<th>Ownership</th><th>Rate Basis</th><th class="num">Qty</th><th class="num">Duration (days / hrs)</th><th class="num">Rate per Unit</th><th class="num">Amount</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.equipment.length ? html`${est.equipment.map((r, i) => html`<tr><td>${i + 1}</td><td><div class="cell-tag">${sel(ctx, 'equipment', i, 'equipmentId', r.equipmentId, opts, r.name)}${r.byCustomer ? html`<span class="muted small">provided by customer</span>` : ''}</div></td>${forCell(ctx, est, 'equipment', i, r)}
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

// Summary: the description (Job costing) or the priced lines (Line costing), the cost heads and transport by zone.
// Without the "See markup" right: overhead is one line, and margin and the percentages are not shown.
function summaryTab(est, ctx, s) {
  const sees = auth.seesMarkup();
  const pc = v => `${(v * 100).toFixed(1)} %`;
  const desc = ctx.editable
    ? html`<textarea data-h="description" rows="2" aria-label="Description" style="border:0;border-bottom:1px solid #C9C7BE;border-radius:0;min-height:40px">${est.header.description}</textarea>`
    : est.header.description;
  const lines = est.costingLevel === 'LINE' ? html`<table class="tbl"><thead><tr><th style="width:30px">#</th><th>Line</th><th class="num">${est.sharedCosts === 'SPREAD' ? 'Direct cost incl. shared' : 'Direct cost'}</th><th class="num">Price</th></tr></thead><tbody>
      ${s.lines.map((l, i) => { const at = est.lines.findIndex(x => x.key === l.key); return html`<tr><td>${i + 1}</td><td class="wrap">${l.isShared ? html`<b>${est.sharedLabel}</b>` : ctx.editable ? html`<input type="text" data-t="lines" data-i="${at}" data-f="description" value="${l.description}" aria-label="${cellLabel('lines', i, 'description')}" style="width:100%">` : l.description}</td>
        <td class="num">${m2(l.direct + (l.shared || 0))}</td><td class="num"><b>${m2(l.rounded)}</b></td></tr>`; })}
      <tr class="sum"><td></td><td>${est.sharedCosts === 'SPREAD' ? html`<span class="muted">Shared costs spread by each line's direct cost</span>` : ''}</td><td class="num">${m2(s.direct)}</td><td class="num"><b>${m2(s.subtotal)}</b></td></tr>
    </tbody></table><p class="mini-note">Line costing: one priced row per line on the quotation. Any rounding cent sits on the biggest line, so the total equals Job costing.</p>`
    : html`<table class="tbl"><thead><tr><th style="width:30px">S#</th><th>Description</th><th class="num" style="width:50px">Qty</th></tr></thead><tbody><tr><td>1</td><td class="wrap">${desc}</td><td class="num">1</td></tr></tbody></table>
      <p class="mini-note">Job costing: the quotation shows one price for the whole job.</p>`;
  const head = (label, v, p, cls = '') => html`<tr class="${cls}"><td>${label}</td><td class="num">${m2(v)}</td>${sees ? html`<td class="num">${p == null ? '' : pc(p)}</td>` : ''}</tr>`;
  return html`${lines}
    <div class="split" style="margin-top:12px">
      <table class="tbl cost-tbl"><thead><tr><th>Cost Head</th><th class="num">Amount (${auth.company().currency})</th>${sees ? html`<th class="num" style="white-space:normal">% of Selling Price</th>` : ''}</tr></thead><tbody>
        ${head('Labour', s.heads.labour, s.pct.labour)}${head('Transport', s.heads.transport, s.pct.transport)}${head('Materials', s.heads.materials, s.pct.materials)}${head('Equipment', s.heads.equipment, s.pct.equipment)}
        ${head('DIRECT COST', s.direct, s.pct.direct, 'sum')}${head('Overhead', s.overhead, s.pct.overhead)}${sees ? head('COST BEFORE MARGIN', s.cbm, s.pct.cbm, 'sum') : ''}
        ${sees ? head('Margin', s.margin, s.pct.margin) : ''}${s.fixed ? head('Fixed-price products (as priced)', s.fixed, s.sell ? s.fixed / s.sell : 0) : ''}${head('SELLING PRICE', s.subtotal, s.sell ? 1 : 0, 'sum')}${head(`${est.taxLabel || 'Tax'} ${fmtNum(est.taxRate)} %`, s.tax, null)}${head('TOTAL QUOTE', s.total, null, 'grand')}
      </tbody></table>
      <div><h3 style="margin:0 0 6px">Transport – zone wise</h3>
        <table class="tbl"><thead><tr><th>Zone</th><th class="num">Cost</th><th class="num">% of Transport</th></tr></thead><tbody>
          ${s.transportByZone.map(z => html`<tr><td>${z.label}</td><td class="num">${m2(z.cost)}</td><td class="num">${s.heads.transport ? pc(z.cost / s.heads.transport) : '0.0 %'}</td></tr>`)}
          <tr><td>Other / unassigned</td><td class="num">${m2(s.transportOther)}</td><td class="num">${s.heads.transport ? pc(s.transportOther / s.heads.transport) : '0.0 %'}</td></tr>
          <tr class="sum"><td><b>TOTAL TRANSPORT</b></td><td class="num"><b>${m2(s.heads.transport)}</b></td><td class="num"><b>${s.heads.transport ? '100.0 %' : '0.0 %'}</b></td></tr>
        </tbody></table></div>
    </div>`;
}

export const TABS = [
  ['summary', 'Summary'], ['shutters', 'Products to repair'], ['labour', 'Labour'], ['transport', 'Transport'],
  ['materials', 'Materials'], ['equipment', 'Equipment'], ['overheads', 'Overhead & Margin'],
];
// A tab's title; the counts follow the rows as they are added and removed.
export const tabLabel = (k, label, est) => (k === 'shutters' ? `${label} (${est.shutters.length + (est.fixed || []).length})` : k === 'materials' ? `${label} (${est.materials.length})` : label);
export function tabHtml(key, est, ctx, s) {
  return { summary: summaryTab, shutters: shuttersTab, labour: labourTab, transport: transportTab, materials: materialsTab, equipment: equipmentTab, overheads: overheadTab }[key]?.(est, ctx, s) || '';
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
  // A fixed-price product's qty is its line's qty on the quotation.
  if (t === 'fixed' && f === 'qty') { const l = est.lines.find(x => x.key === r.lineKey); if (l) setLineQty(l, r.qty); }
  // A product's qty or size: its hours again, and the Labour tab follows (rows made when a size is first picked, removed
  // when there are no hours left).
  if (t === 'shutters' && (f === 'qty' || f === 'sizeCode')) {
    Object.assign(r, repairLabour(productOf(r.productId), r.sizeCode, r.qty));
    const line = est.lines.find(x => x.key === r.key);
    if (line && (r.notKept || r.fromLine)) setLineQty(line, r.qty);
    syncProductLabour(est, r);
  }
}
