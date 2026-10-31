// Estimate page ("E2" layout): the header on the left in line style (customer, estimate, Costing Level, Shared
// Costs, margin), the team lead's tabs on the right. Pre-filled from the site report and the masters; changes save
// as you type. "Create quotation" makes the quotation (or its next revision) from this revision.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, on, debounce, fmtNum, pill, toast, openModal, chipGroup } from '../core/ui.js';
import { vsOptions, zoneLabel } from '../core/lookups.js';
import { estimateSummary, canEdit, saveEstimate, reviseEstimate, estimateProblems, revisions } from '../core/estimates.js';
import { createFromEstimate } from '../core/quotations.js';
import { TABS, tabHtml, newRow, applyChange } from './estimate-tabs.js';
import { openWorkflow } from './enquiry-view.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pc = v => `${(v * 100).toFixed(1)} %`;
const TAB_KEY = 'rsmEstTab';
const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;

function summaryTab(est, ctx, s) {
  const desc = ctx.editable
    ? html`<textarea data-h="description" rows="2" style="border:0;border-bottom:1px solid #C9C7BE;border-radius:0;min-height:40px">${est.header.description}</textarea>`
    : est.header.description;
  const lines = est.costingLevel === 'LINE' ? html`<table class="tbl"><thead><tr><th style="width:30px">#</th><th>Line</th><th class="num">${est.sharedCosts === 'SPREAD' ? 'Direct cost incl. shared' : 'Direct cost'}</th><th class="num">Price</th></tr></thead><tbody>
      ${s.lines.map((l, i) => html`<tr><td>${i + 1}</td><td class="wrap">${l.isShared ? html`<b>${est.sharedLabel}</b>` : ctx.editable ? html`<input type="text" data-t="lines" data-i="${est.lines.findIndex(x => x.key === l.key)}" data-f="description" value="${l.description}" style="width:100%">` : l.description}</td>
        <td class="num">${m2(l.direct + (l.shared || 0))}</td><td class="num"><b>${m2(l.rounded)}</b></td></tr>`)}
      <tr class="sum"><td></td><td>${est.sharedCosts === 'SPREAD' ? html`<span class="muted">Shared costs spread by each line's direct cost</span>` : ''}</td><td class="num">${m2(s.direct)}</td><td class="num"><b>${m2(s.subtotal)}</b></td></tr>
    </tbody></table><p class="mini-note">Line costing: one priced row per line on the quotation. Any rounding cent sits on the biggest line, so the total equals Job costing.</p>`
    : html`<table class="tbl"><thead><tr><th style="width:30px">S#</th><th>Description</th><th class="num" style="width:50px">Qty</th></tr></thead><tbody><tr><td>1</td><td class="wrap">${desc}</td><td class="num">1</td></tr></tbody></table>
      <p class="mini-note">Job costing: the quotation shows one price for the whole job.</p>`;
  const head = (label, v, p, cls = '') => html`<tr class="${cls}"><td>${label}</td><td class="num">${m2(v)}</td><td class="num">${p == null ? '' : pc(p)}</td></tr>`;
  return html`${lines}
    <div class="split" style="margin-top:12px">
      <table class="tbl cost-tbl"><thead><tr><th>Cost Head</th><th class="num">Amount (${auth.company().currency})</th><th class="num" style="white-space:normal">% of Selling Price</th></tr></thead><tbody>
        ${head('Labour', s.heads.labour, s.pct.labour)}${head('Transport', s.heads.transport, s.pct.transport)}${head('Materials', s.heads.materials, s.pct.materials)}${head('Equipment', s.heads.equipment, s.pct.equipment)}
        ${head('DIRECT COST', s.direct, s.pct.direct, 'sum')}${head('Overhead', s.overhead, s.pct.overhead)}${head('COST BEFORE MARGIN', s.cbm, s.pct.cbm, 'sum')}
        ${head('Margin', s.margin, s.pct.margin)}${head('SELLING PRICE', s.subtotal, s.sell ? 1 : 0, 'sum')}${head(`${est.taxLabel || 'Tax'} ${fmtNum(est.taxRate)} %`, s.tax, null)}${head('TOTAL QUOTE', s.total, null, 'grand')}
      </tbody></table>
      <div><h3 style="margin:0 0 6px">Transport – zone wise</h3>
        <table class="tbl"><thead><tr><th>Zone</th><th class="num">Cost</th><th class="num">% of Transport</th></tr></thead><tbody>
          ${s.transportByZone.map(z => html`<tr><td>${z.label}</td><td class="num">${m2(z.cost)}</td><td class="num">${s.heads.transport ? pc(z.cost / s.heads.transport) : '0.0 %'}</td></tr>`)}
          <tr><td>Other / unassigned</td><td class="num">${m2(s.transportOther)}</td><td class="num">${s.heads.transport ? pc(s.transportOther / s.heads.transport) : '0.0 %'}</td></tr>
          <tr class="sum"><td><b>TOTAL TRANSPORT</b></td><td class="num"><b>${m2(s.heads.transport)}</b></td><td class="num"><b>${s.heads.transport ? '100.0 %' : '0.0 %'}</b></td></tr>
        </tbody></table></div>
    </div>`;
}

const kpiHtml = (s, cur) => html`<div class="kpi"><div><b>${m2(s.total)}</b><span>Total quote (${cur})</span></div><div><b>${fmtNum(s.markupPct, 1)} %</b><span>Markup on cost</span></div><div><b>${fmtNum(s.marginOnPricePct, 1)} %</b><span>Margin on price</span></div></div>`;

export function renderEstimate(el, id) {
  const saved = store.get('estimates', id);
  if (!saved) { el.innerHTML = '<div class="page"><div class="empty">Estimate not found.</div></div>'; return; }
  const est = structuredClone(saved);
  const enq = store.get('enquiries', est.enquiryId);
  const q = est.quotationId ? store.get('quotations', est.quotationId) : null;
  const ctx = { editable: canEdit(est) };
  const cur = auth.company().currency;
  const revs = revisions(est.no);
  const newer = revs.find(r => r.rev > est.rev);
  let tab = sessionStorage.getItem(TAB_KEY) || 'summary';
  const canRevise = est.status === 'Quoted' && !newer && auth.can('estimation', 'edit') && q && !['Accepted', 'Rejected'].includes(q.status);
  const rep = est.reportId ? store.get('siteReports', est.reportId) : null;

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/estimates">Estimation</a> › <a href="#/enquiries/${enq.id}">${enq.no}</a></div>
      <h1>${est.no} · Rev ${est.rev} · ${est.header.customer} ${pill(est.status)}</h1>
      <div class="page-meta">Repair${rep ? html` · from <a href="#/reports/${rep.id}">${rep.no}</a>` : ' · no site report'} · prepared by <b>${auth.userName(est.header.preparedBy)}</b>${ctx.editable ? ' · changes save as you type' : ''}</div></div>
      <div class="row"><button class="btn soft" id="wf">⇶ Workflow</button>
        ${q ? html`<a class="btn" href="#/quotations/${q.id}">Open ${q.no} Rev ${q.rev}</a>` : ''}
        ${canRevise ? html`<button class="btn" id="revise">Revise estimate</button>` : ''}
        ${ctx.editable && !q ? html`<button class="btn primary" id="mkq">Create quotation${est.rev > 1 ? ' revision' : ''} →</button>` : ''}</div>
    </div>
    ${newer ? html`<div class="note warn" style="margin-bottom:10px">This revision was replaced by <a href="#/estimates/${newer.id}">Rev ${newer.rev}</a>.</div>` : ''}
    ${est.returnNote && !newer && (est.status === 'Draft' || q?.status === 'Returned') ? html`<div class="note bad" style="margin-bottom:10px;display:flex;gap:10px;align-items:center">
      <span class="grow"><b>Returned by ${auth.userName(est.returnNote.by)}</b> (quotation Rev ${est.returnNote.rev}): ${est.returnNote.comment}</span>
      ${canRevise ? html`<button class="btn small" id="revise2">Revise estimate</button>` : est.status === 'Draft' ? html`<span class="small">Change the prices below, then create the quotation revision.</span>` : ''}</div>` : ''}
    <div class="e2">
      <div class="props form-lines" id="props"></div>
      <div class="e2-main"><div class="card">
        <div id="kpi"></div>
        <div class="etabs" id="tabs">${TABS.map(([k, label]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${label}${k === 'shutters' || k === 'materials' ? ` (${est[k].length})` : ''}</button>`)}</div>
        <div id="tab"></div>
      </div></div>
    </div>
  </div>`);

  const paintProps = () => {
    $('#props', el).innerHTML = String(html`
      <div class="form-sec">Customer</div>
      ${row('Customer Name', est.header.customer)}${row('Contact Person', est.header.contact)}${row('Phone No', est.header.phone)}
      ${row('Site Location', html`${est.header.site}${enq.zoneId ? html` · <span class="zone-chip">${zoneLabel(enq.zoneId).split(' ')[0]}</span>` : ''}`)}
      <div class="form-sec">Estimate</div>
      ${row('Quotation Ref No', `${est.no} · Rev ${est.rev}`)}
      ${ctx.editable ? html`<div class="field"><label>Date</label><input type="date" data-h="date" value="${est.header.date}"></div>
        <div class="field"><label>Findings</label><input type="text" data-h="findings" value="${est.header.findings}"></div>` : html`${row('Date', est.header.date)}${row('Findings', est.header.findings)}`}
      <div class="form-sec">Costing</div>
      <div class="field"><label>Costing Level</label>${chipGroup('costingLevel', vsOptions('COSTING_LEVEL'), est.costingLevel, !ctx.editable)}</div>
      ${est.costingLevel === 'LINE' ? html`<div class="field"><label>Shared Costs</label>${chipGroup('sharedCosts', vsOptions('SHARED_COSTS'), est.sharedCosts, !ctx.editable)}</div>` : ''}
      ${row('Overheads', est.overheads.map(o => (o.basis === 'FIXED' ? `${m2(o.value)} fixed` : `${fmtNum(o.value)} % of direct cost`)).join(' + '))}
      <div class="field"><label>Margin basis</label>${chipGroup('marginBasis', vsOptions('MARGIN_BASIS'), est.marginBasis, !ctx.editable)}</div>
      ${ctx.editable ? html`<div class="field"><label>Margin %</label><input type="number" step="any" data-h="marginPct" value="${est.marginPct}"></div>` : row('Margin %', `${fmtNum(est.marginPct)} %`)}
      ${row('Tax', est.taxCode ? `${est.taxCode} · ${est.taxLabel} ${fmtNum(est.taxRate)} %` : 'No tax charged')}
      <div class="form-sec">Revisions</div>
      ${revs.map(r => { const rq = r.quotationId ? store.get('quotations', r.quotationId) : null; return row(`Rev ${r.rev}`, html`${r.id === est.id ? html`<b>this one</b>` : html`<a href="#/estimates/${r.id}">open</a>`} · ${r.status}${rq ? ` · ${rq.no} Rev ${rq.rev} ${rq.status}` : ''}${r.returnNote && r.rev === r.returnNote.rev ? ` · returned: ${r.returnNote.comment}` : ''}`); })}`);
  };

  const paint = () => {
    const s = estimateSummary(est);
    $('#kpi', el).innerHTML = String(kpiHtml(s, cur));
    $('#tab', el).innerHTML = String(tab === 'summary' ? summaryTab(est, ctx, s) : html`<div class="tab-scroll">${tabHtml(tab, est, ctx, s)}</div>`);
  };
  const persist = debounce(() => saveEstimate(est.id, est), 250);
  const save = () => { persist(); };

  // Edits: header fields (data-h), table cells (data-t / data-i / data-f), chips (costing, shared costs, margin basis).
  const read = t => (t.type === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value);
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.h) { if (t.dataset.h === 'marginPct') est.marginPct = read(t); else est.header[t.dataset.h] = read(t); save(); $('#kpi', el).innerHTML = String(kpiHtml(estimateSummary(est), cur)); }
    else if (t.dataset.t && t.tagName !== 'SELECT') { est[t.dataset.t][+t.dataset.i][t.dataset.f] = read(t); save(); $('#kpi', el).innerHTML = String(kpiHtml(estimateSummary(est), cur)); }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.t) { est[t.dataset.t][+t.dataset.i][t.dataset.f] = read(t); applyChange(est, t.dataset.t, +t.dataset.i, t.dataset.f); save(); paint(); }
    else if (t.dataset.h === 'marginPct') paint();
    else if (['costingLevel', 'sharedCosts', 'marginBasis'].includes(t.name)) { est[t.name] = t.value; save(); paintProps(); paint(); }
  });
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; sessionStorage.setItem(TAB_KEY, tab); $$('[data-tab]', el).forEach(x => x.classList.toggle('on', x === b)); paint(); });
  on(el, 'click', '[data-add]', (e, b) => { est[b.dataset.add].push(newRow(b.dataset.add, est)); save(); paint(); });
  on(el, 'click', '[data-del]', (e, b) => { est[b.dataset.del].splice(+b.dataset.i, 1); save(); paint(); });

  $('#wf', el).onclick = () => openWorkflow(enq);
  $('#mkq', el)?.addEventListener('click', () => {
    saveEstimate(est.id, est);
    const problems = estimateProblems(est);
    if (problems.length) { openModal({ title: 'Not ready for a quotation', body: html`<ul>${problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] }); return; }
    const nq = createFromEstimate(est.id);
    toast(`${nq.no} Rev ${nq.rev} created from ${est.no} Rev ${est.rev}`);
    go(`quotations/${nq.id}`);
  });
  const revise = () => {
    const next = reviseEstimate(est.id);
    toast(`${est.no} Rev ${next.rev} created. Change the prices, then create the quotation revision.`);
    go(`estimates/${next.id}`);
  };
  $('#revise', el)?.addEventListener('click', revise);
  $('#revise2', el)?.addEventListener('click', revise);
  paintProps();
  paint();
}
