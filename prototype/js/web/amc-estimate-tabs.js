// The AMC estimate's Excel tabs (team lead's AMC estimator) as tables: Summary, Labour_Matrix, Shutters, Transport,
// Equipment, Materials (optional) and Overhead & Margin. Same columns and formulas as the Excel; every pre-filled value
// stays editable. Cells carry data-p, the path of the value they edit (e.g. "sites.0.visits").
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, fmtNum, placeholderTag } from '../core/ui.js';
import { items, vsOptions } from '../core/lookups.js';
import { amcSiteRow, matrixCost, materialRow, hourlyRate } from '../core/costing.js';
import { amcDefaults } from '../core/amc-estimates.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pc = v => `${(v * 100).toFixed(1)} %`;
const num = v => Number(v) || 0;
const rid = () => store.uid('r_');

export const AMC_TABS = [['summary', 'Summary'], ['matrix', 'Labour_Matrix'], ['shutters', 'Shutters'], ['transport', 'Transport'], ['equipment', 'Equipment'], ['materials', 'Materials'], ['overhead', 'Overhead & Margin']];

function inp(ctx, path, v, { type = 'number', w = 64, step = 'any' } = {}) {
  if (!ctx.editable) return type === 'number' ? fmtNum(v, 2) : v;
  return html`<input type="${type}" ${type === 'number' ? html`step="${step}"` : ''} data-p="${path}" value="${v ?? ''}" style="width:${w}px">`;
}
function sel(ctx, path, v, options) {
  if (!ctx.editable) return options.find(o => String(o.value) === String(v))?.label ?? '';
  return html`<select data-p="${path}">${options.map(o => html`<option value="${o.value}" ${String(o.value) === String(v) ? 'selected' : ''}>${o.label}</option>`)}</select>`;
}
const del = (ctx, kind, i) => (ctx.editable ? html`<td><button type="button" class="btn link small" data-del="${kind}|${i}" title="Remove this row">✕</button></td>` : '');
const delHead = ctx => (ctx.editable ? html`<th></th>` : '');
const addBtn = (ctx, kind, label) => (ctx.editable ? html`<button type="button" class="add-dashed" data-add="${kind}" style="margin-top:6px">+ ${label}</button>` : '');
const siteOptions = est => [{ value: '', label: 'All sites' }, ...est.sites.map(s => ({ value: s.key, label: s.name }))];
const visitsOf = (est, key) => (key ? num(est.sites.find(s => s.key === key)?.visits) : est.sites.reduce((t, s) => t + num(s.visits), 0));

function summaryTab(est, ctx, s) {
  const cur = auth.company().currency;
  const head = (label, v, p, cls = '') => html`<tr class="${cls}"><td>${label}</td><td class="num">${m2(v)}</td><td class="num">${p == null ? '' : pc(p)}</td></tr>`;
  const desc = ctx.editable ? html`<textarea data-p="header.description" rows="2" style="width:100%;border:0;border-bottom:1px solid #C9C7BE;border-radius:0;min-height:40px">${est.header.description}</textarea>` : est.header.description;
  const lines = est.costingLevel === 'LINE'
    ? html`<table class="tbl"><thead><tr><th style="width:30px">#</th><th>Line (one per site)</th><th class="num">Direct cost</th><th class="num">Price</th></tr></thead><tbody>
        ${s.lines.map((l, i) => html`<tr><td>${i + 1}</td><td class="wrap">${l.isShared ? html`<b>${l.description}</b>` : l.description}</td><td class="num">${m2(l.direct + (l.shared || 0))}</td><td class="num"><b>${m2(l.rounded)}</b></td></tr>`)}
        <tr class="sum"><td></td><td></td><td class="num">${m2(s.direct)}</td><td class="num"><b>${m2(s.subtotal)}</b></td></tr></tbody></table>`
    : html`<table class="tbl"><thead><tr><th style="width:30px">S#</th><th>Description</th></tr></thead><tbody><tr><td>1</td><td class="wrap">${desc}</td></tr></tbody></table>`;
  const plan = s.plan;
  return html`${lines}
    <div class="split" style="margin-top:12px">
      <table class="tbl cost-tbl"><thead><tr><th>Cost Head</th><th class="num">Amount (${cur})</th><th class="num" style="white-space:normal">% of Selling Price</th></tr></thead><tbody>
        ${head('Labour', s.heads.labour, s.pct.labour)}${head('Transport', s.heads.transport, s.pct.transport)}${head('Equipment', s.heads.equipment, s.pct.equipment)}
        ${s.heads.materials ? head('Materials', s.heads.materials, s.pct.materials) : ''}
        ${head('DIRECT COST', s.direct, s.pct.direct, 'sum')}${head('Overhead', s.overhead, s.pct.overhead)}${head('COST BEFORE MARGIN', s.cbm, s.pct.cbm, 'sum')}
        ${head('Margin', s.margin, s.pct.margin)}${head('SELLING PRICE', s.subtotal, s.sell ? 1 : 0, 'sum')}
        ${head(`${est.taxLabel || 'Tax'} ${fmtNum(est.taxRate)} %${plan.length > 1 ? ` (on the ${plan.length} invoices)` : ''}`, s.tax, null)}${head('TOTAL QUOTE', s.total, null, 'grand')}
      </tbody></table>
      <div>
        <h3 style="margin:0 0 6px">${est.jobType === 'GS' ? 'Servicing metrics' : 'AMC Metrics (per contract year)'}</h3>
        <table class="tbl"><tbody>
          <tr><td>Total shutters ${est.jobType === 'GS' ? 'to service' : 'under contract'}</td><td class="num"><b>${s.metrics.shutters}</b></td></tr>
          <tr><td>Total site visits ${est.jobType === 'GS' ? '' : 'per year'}</td><td class="num"><b>${s.metrics.visits}</b></td></tr>
          ${est.jobType === 'GS' ? '' : html`<tr><td>Selling price per shutter per year</td><td class="num"><b>${m2(s.metrics.perShutterYear)}</b></td></tr>
            <tr><td>Total quote per month (÷ 12)</td><td class="num"><b>${m2(s.metrics.perMonth)}</b></td></tr><tr><td class="muted">Per month before ${est.taxLabel || 'tax'}</td><td class="num">${m2(s.metrics.perMonthEx)}</td></tr>`}
        </tbody></table>
        ${plan.length > 1 ? html`<h3 style="margin:12px 0 6px">Billing plan</h3><table class="tbl"><tbody>
          <tr><td>${vsOptions('BILLING').find(o => o.value === est.billing)?.label || est.billing}, in advance</td><td class="num">${plan.length - 1} × ${m2(plan[0].amount)}</td></tr>
          <tr><td class="muted">Last instalment</td><td class="num">${m2(plan[plan.length - 1].amount)}</td></tr>
          <tr><td class="muted">${est.taxLabel || 'Tax'} on each invoice</td><td class="num">${m2(plan[0].tax)}</td></tr></tbody></table>` : ''}
      </div>
    </div>
    <h3 style="margin:12px 0 6px">Zone wise</h3>
    <table class="tbl"><thead><tr><th>Zone (from Transport)</th><th class="num">No. of Shutters</th><th class="num">Site Visits per Year</th><th class="num">Transport Cost</th><th class="num">% of Transport</th></tr></thead><tbody>
      ${s.zoneTable.map(z => html`<tr><td><span class="zone-chip">${z.code}</span> ${z.name}</td><td class="num">${z.shutters}</td><td class="num">${z.visits}</td><td class="num">${m2(z.cost)}</td><td class="num">${pc(z.pct)}</td></tr>`)}
      <tr><td>Other / unassigned zones</td><td class="num">${s.zoneOther.shutters}</td><td class="num">${s.zoneOther.visits}</td><td class="num">${m2(s.zoneOther.cost)}</td><td class="num">${pc(s.zoneOther.pct)}</td></tr>
      <tr class="sum"><td><b>TOTAL</b></td><td class="num"><b>${s.metrics.shutters}</b></td><td class="num"><b>${s.metrics.visits}</b></td><td class="num"><b>${m2(s.heads.transport)}</b></td><td class="num"><b>${s.heads.transport ? '100.0 %' : '0.0 %'}</b></td></tr>
    </tbody></table>`;
}

function matrixTab(est, ctx) {
  const m = est.matrix;
  const rate = (k, label) => html`<tr><td>${label}</td><td class="num">${inp(ctx, `matrix.${k}.monthly`, m[k].monthly, { w: 80 })}</td><td class="num">${inp(ctx, `matrix.${k}.days`, m[k].days, { w: 50 })}</td>
    <td class="num">${inp(ctx, `matrix.${k}.hours`, m[k].hours, { w: 50 })}</td><td class="num">${m2(m[k].rate)}</td></tr>`;
  return html`<h3 style="margin:0 0 6px">1. Labour Rate Card <span class="muted small" style="font-weight:400">from the Labour master (AMC set)</span></h3>
    <table class="tbl edit"><thead><tr><th>Team</th><th class="num">Monthly Cost</th><th class="num">Days per Month</th><th class="num">Hrs per Day</th><th class="num">Rate per Hr</th></tr></thead><tbody>
      ${rate('team', 'Standard Team (1+1)')}${rate('extra', 'Additional Worker')}</tbody></table>
    <h3 style="margin:12px 0 6px">2. Labour Matrix (per shutter, per visit) <span class="muted small" style="font-weight:400">from the Shutter Size master</span></h3>
    <table class="tbl edit"><thead><tr><th>Size Category</th><th>Shutter Size (W × H)</th><th class="num">Std Team Hrs per Shutter</th><th class="num">Additional Workers</th><th class="num">Addl. Worker Hrs (each)</th><th class="num">Labour Cost per Shutter per Visit</th></tr></thead><tbody>
      ${m.sizes.map((z, i) => html`<tr><td>${z.code} – ${z.name}</td><td>${z.limits}</td><td class="num">${inp(ctx, `matrix.sizes.${i}.teamHrs`, z.teamHrs, { w: 56 })}</td>
        <td class="num">${inp(ctx, `matrix.sizes.${i}.extraWorkers`, z.extraWorkers, { w: 50, step: 1 })}</td><td class="num">${inp(ctx, `matrix.sizes.${i}.extraHrs`, z.extraHrs, { w: 56 })}</td>
        <td class="num">${m2(matrixCost(z, m.team.rate, m.extra.rate))}</td></tr>`)}</tbody></table>
    <p class="mini-note">Cost per shutter = team hrs × team rate + additional workers × their hrs × additional worker rate, as in the Excel.</p>`;
}

function shuttersTab(est, ctx, s, more) {
  const gs = est.jobType === 'GS';
  const sizes = est.matrix.sizes;
  const tot = code => est.sites.reduce((t, x) => t + num(x.counts?.[code]), 0);
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Site / Location</th><th>Zone</th><th class="num">Visits ${gs ? '' : 'per Year'}</th>${sizes.map(z => html`<th class="num">${z.code}</th>`)}
      <th class="num">Total Shutters</th><th class="num">Std Team Hrs per Visit</th><th class="num">Days on site</th><th class="num">Labour Cost per Visit</th><th class="num">${gs ? 'Labour Cost' : 'Annual Labour Cost'}</th>${ctx.editable && est.sites.length > 1 ? html`<th></th>` : ''}</tr></thead><tbody>
    ${est.sites.map((x, i) => { const r = amcSiteRow(x, est.matrix); return html`<tr><td>${i + 1}</td>
      <td>${x.name}${x.typed ? html` ${placeholderTag('typed from BOQ')}` : html`<br><button type="button" class="btn link small" data-cover="${x.key}" style="padding:0">${x.shutterIds.length} covered ▾</button>`}</td>
      <td><span class="zone-chip">${store.get('zones', x.zoneId)?.code || '—'}</span></td>
      <td class="num">${gs ? 1 : inp(ctx, `sites.${i}.visits`, x.visits, { w: 46, step: 1 })}</td>
      ${sizes.map(z => html`<td class="num">${x.typed ? inp(ctx, `sites.${i}.counts.${z.code}`, x.counts?.[z.code] || 0, { w: 46, step: 1 }) : num(x.counts?.[z.code])}</td>`)}
      <td class="num"><b>${r.shutters}</b></td><td class="num">${fmtNum(r.hrsVisit)}</td><td class="num">${r.days}</td><td class="num">${m2(r.perVisit)}</td><td class="num">${m2(r.annual)}</td>
      ${ctx.editable && est.sites.length > 1 ? html`<td><button type="button" class="btn link small" data-rmsite="${x.key}" title="Remove this site">✕</button></td>` : ''}</tr>`; })}
    <tr class="sum"><td></td><td><b>TOTAL</b></td><td></td><td class="num">${s.metrics.visits}</td>${sizes.map(z => html`<td class="num">${tot(z.code)}</td>`)}<td class="num"><b>${s.metrics.shutters}</b></td>
      <td></td><td></td><td></td><td class="num"><b>${m2(s.heads.labour)}</b></td>${ctx.editable && est.sites.length > 1 ? html`<td></td>` : ''}</tr>
  </tbody></table>
  ${ctx.editable && !gs && more ? html`<button type="button" class="add-dashed" data-addsite="1" style="margin-top:6px">+ Add a site of this customer (${more} more)</button>` : ''}
  ${s.sites.filter(x => x.days > 1).map(x => html`<div class="note warn small" style="margin-top:8px">${est.sites.find(y => y.key === x.key).name}: ${fmtNum(x.hrsVisit)} team-hours = ${x.days} days on site per visit. The price counts one trip per visit, as the Excel does; the calendar books ${x.days} days.</div>`)}
  <p class="mini-note">Counts come from each site's shutter register; click "covered" to leave a shutter out. A site with no register gets typed counts; the contract adds them to the register.</p>`;
}

function transportTab(est, ctx) {
  const visits = id => est.sites.filter(x => x.zoneId === id).reduce((t, x) => t + num(x.visits), 0);
  const total = est.transport.reduce((t, r) => t + visits(r.zoneId) * num(r.hrs) * num(r.rate), 0);
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Zone</th><th>Distance Range / Area</th><th>Vehicle Type</th><th class="num">Site Visits per Year (auto)</th><th class="num">Travel Hrs per Visit (round trip)</th><th class="num">Rate per Hr</th><th class="num">Total Transport Cost</th></tr></thead><tbody>
    ${est.transport.map((r, i) => html`<tr><td>${i + 1}</td><td>${r.zoneLabel}${r.placeholder ? html` ${placeholderTag()}` : ''}</td><td>${r.distance}</td><td>${r.vehicle}</td><td class="num">${visits(r.zoneId)}</td>
      <td class="num">${inp(ctx, `transport.${i}.hrs`, r.hrs, { w: 56 })}</td><td class="num">${inp(ctx, `transport.${i}.rate`, r.rate, { w: 64 })}</td><td class="num">${m2(visits(r.zoneId) * num(r.hrs) * num(r.rate))}</td></tr>`)}
    <tr class="sum"><td></td><td><b>TOTAL</b></td><td></td><td></td><td class="num">${est.sites.reduce((t, x) => t + num(x.visits), 0)}</td><td></td><td></td><td class="num"><b>${m2(total)}</b></td></tr>
  </tbody></table><p class="mini-note">One row per zone the sites are in. Visits come from the Shutters tab; travel hours and the AMC rate from the Transport master. Cost = visits × travel hrs × rate.</p>`;
}

function equipmentTab(est, ctx) {
  const opts = [{ value: '', label: '—' }, ...store.list('equipment', e => e.status !== 'Inactive').map(e => ({ value: e.id, label: e.name }))];
  const amount = r => num(r.qty) * num(r.duration) * visitsOf(est, r.siteKey) * num(r.rate);
  return html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Equipment</th><th>For site</th><th>Ownership</th><th>Rate Basis</th><th class="num">Qty</th><th class="num">Duration per Visit</th><th class="num">Visits per Year</th><th class="num">Rate per Unit</th><th class="num">Amount</th>${delHead(ctx)}</tr></thead><tbody>
    ${est.equipment.length ? html`${est.equipment.map((r, i) => html`<tr><td>${i + 1}</td><td>${sel(ctx, `equipment.${i}.equipmentId`, r.equipmentId, opts)}${r.reason ? html`<br><span class="muted small">${r.reason}</span>` : ''}</td>
      <td>${sel(ctx, `equipment.${i}.siteKey`, r.siteKey, siteOptions(est))}</td><td>${r.ownership}</td><td>${r.basis}</td><td class="num">${inp(ctx, `equipment.${i}.qty`, r.qty, { w: 44, step: 1 })}</td>
      <td class="num">${inp(ctx, `equipment.${i}.duration`, r.duration, { w: 50 })}</td><td class="num">${visitsOf(est, r.siteKey)}</td><td class="num">${inp(ctx, `equipment.${i}.rate`, r.rate, { w: 64 })}</td><td class="num">${m2(amount(r))}</td>${del(ctx, 'equipment', i)}</tr>`)}`
      : html`<tr><td colspan="11" class="empty">No equipment. A scissor lift is added by itself for a site with a shutter taller than ${fmtNum(amcDefaults().liftHeightM)} m.</td></tr>`}
    <tr class="sum"><td></td><td><b>TOTAL</b></td><td colspan="7"></td><td class="num"><b>${m2(est.equipment.reduce((t, r) => t + amount(r), 0))}</b></td>${delHead(ctx)}</tr>
  </tbody></table>${addBtn(ctx, 'equipment', 'Add equipment')}<p class="mini-note">Amount = Qty × Duration per visit × Visits per year × Rate, as in the Excel. Visits come from the chosen site.</p>`;
}

function materialsTab(est, ctx) {
  const opts = [{ value: '', label: '— pick from the master —' }, ...items().map(it => ({ value: it.id, label: it.name }))];
  const row = r => materialRow({ ...r, qty: num(r.qty) * visitsOf(est, r.siteKey) });
  return html`${est.materials.length ? html`<table class="tbl edit"><thead><tr><th>Sl</th><th>Product</th><th>For site</th><th>Unit</th><th class="num">Qty per Visit</th><th class="num">Wastage %</th><th class="num">Visits</th><th class="num">Total Qty</th><th class="num">Rate per Unit</th><th class="num">Amount</th>${delHead(ctx)}</tr></thead><tbody>
      ${est.materials.map((r, i) => html`<tr><td>${i + 1}</td><td>${sel(ctx, `materials.${i}.itemId`, r.itemId, opts)}</td><td>${sel(ctx, `materials.${i}.siteKey`, r.siteKey, siteOptions(est))}</td><td>${r.unit}</td>
        <td class="num">${inp(ctx, `materials.${i}.qty`, r.qty, { w: 50 })}</td><td class="num">${inp(ctx, `materials.${i}.wastage`, r.wastage, { w: 46 })}</td><td class="num">${visitsOf(est, r.siteKey)}</td>
        <td class="num">${fmtNum(row(r).totalQty)}</td><td class="num">${inp(ctx, `materials.${i}.rate`, r.rate, { w: 64 })}</td><td class="num">${m2(row(r).amount)}</td>${del(ctx, 'materials', i)}</tr>`)}
      <tr class="sum"><td></td><td><b>TOTAL</b></td><td colspan="7"></td><td class="num"><b>${m2(est.materials.reduce((t, r) => t + row(r).amount, 0))}</b></td>${delHead(ctx)}</tr></tbody></table>`
    : html`<div class="muted" style="padding:10px 0">No materials. The AMC Excel has none; add consumables per visit only if the price includes them.</div>`}
    ${addBtn(ctx, 'materials', 'Add material')}`;
}

function overheadTab(est, ctx, s) {
  const basis = vsOptions('OVERHEAD_BASIS');
  return html`<table class="tbl"><tbody><tr class="sum"><td>Total Direct Cost (Labour + Transport + Equipment${s.heads.materials ? ' + Materials' : ''})</td><td class="num" style="width:140px">${m2(s.direct)}</td></tr></tbody></table>
    <table class="tbl edit" style="margin-top:10px"><thead><tr><th>Overhead Item</th><th>Basis</th><th class="num">Value (% or amount)</th><th class="num">Amount</th>${delHead(ctx)}</tr></thead><tbody>
      ${est.overheads.map((o, i) => html`<tr><td>${ctx.editable ? html`<input type="text" data-p="overheads.${i}.name" value="${o.name}" style="width:180px">` : o.name}</td><td>${sel(ctx, `overheads.${i}.basis`, o.basis, basis)}</td>
        <td class="num">${inp(ctx, `overheads.${i}.value`, o.value, { w: 70 })}</td><td class="num">${m2(o.basis === 'FIXED' ? num(o.value) : (s.direct * num(o.value)) / 100)}</td>${del(ctx, 'overheads', i)}</tr>`)}
      <tr class="sum"><td><b>TOTAL OVERHEAD</b></td><td></td><td></td><td class="num"><b>${m2(s.overhead)}</b></td>${delHead(ctx)}</tr></tbody></table>${addBtn(ctx, 'overheads', 'Add overhead item')}
    <table class="tbl" style="margin-top:10px"><tbody>
      <tr><td>Cost before Margin (Direct + Overhead)</td><td class="num">${m2(s.cbm)}</td></tr>
      <tr><td>Margin basis · Margin %</td><td class="num">${vsOptions('MARGIN_BASIS').find(b => b.value === est.marginBasis)?.label || est.marginBasis} · ${fmtNum(est.marginPct)} %</td></tr>
      <tr><td>Margin Amount</td><td class="num">${m2(s.margin)}</td></tr><tr class="sum"><td>Selling Price</td><td class="num">${m2(s.subtotal)}</td></tr>
      <tr><td>${est.taxLabel || 'Tax'} ${fmtNum(est.taxRate)} %${s.plan.length > 1 ? ` (sum of the ${s.plan.length} invoices)` : ''}</td><td class="num">${m2(s.tax)}</td></tr>
      <tr class="sum"><td><b>TOTAL QUOTE</b></td><td class="num"><b>${m2(s.total)}</b></td></tr></tbody></table>`;
}

export function amcTabHtml(tab, est, ctx, s, more = 0) {
  return ({ summary: summaryTab, matrix: matrixTab, shutters: shuttersTab, transport: transportTab, equipment: equipmentTab, materials: materialsTab, overhead: overheadTab }[tab] || summaryTab)(est, ctx, s, more);
}

// A new row for a table; materials and equipment start from the first master entry.
export function newAmcRow(kind, est) {
  if (kind === 'overheads') return { key: rid(), name: 'Overhead item', basis: 'PCT', value: 0 };
  if (kind === 'equipment') { const e = store.list('equipment', x => x.status !== 'Inactive')[0]; return { key: rid(), equipmentId: e?.id || '', name: e?.name || '', ownership: e?.ownership || '', basis: e?.basis || '', qty: 1, duration: 1, siteKey: est.sites[0]?.key || '', rate: num(e?.rate) }; }
  const it = items().find(i => i.category === 'Consumable') || items()[0];
  return { key: rid(), itemId: it?.id || '', name: it?.name || '', spec: it?.spec || '', unit: it?.unit || '', qty: 1, wastage: num(it?.wastage), rate: num(it?.rate), siteKey: '' };
}

// After a value changed: follow-on values (hourly rate from a monthly cost, master data of a picked item).
export function applyAmcChange(est, path) {
  const [k, i, f] = path.split('.');
  if (k === 'matrix' && ['team', 'extra'].includes(i)) { const r = est.matrix[i]; r.rate = hourlyRate(r.monthly, r.days, r.hours); }
  if (k === 'equipment' && f === 'equipmentId') { const e = store.get('equipment', est.equipment[i].equipmentId); if (e) Object.assign(est.equipment[i], { name: e.name, ownership: e.ownership, basis: e.basis, rate: num(e.rate), reason: '' }); }
  if (k === 'materials' && f === 'itemId') { const it = store.get('items', est.materials[i].itemId); if (it) Object.assign(est.materials[i], { name: it.name, spec: it.spec || '', unit: it.unit, rate: num(it.rate), wastage: num(it.wastage) }); }
}

// Set a value by its path ("sites.0.counts.S"); numbers stay numbers.
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, key) => (o[key] ??= {}), obj);
  target[last] = value;
}
