// Repair estimate page, stacked: customer and estimate details in a header that folds to one line, then the Costing
// settings and the cost sheet in the team lead's Excel tabs (estimate-tabs.js), then the revisions. The Excel tabs
// are the only view of an estimate (user, 26 Nov 2026; the simple view built for the UX audit's finding 6 is gone).
// Pre-filled from the site report and the masters; changes save as you type. "Create quotation" makes the quotation
// (or its next revision) from this revision. AMC and General Servicing estimates open the AMC page (amc-estimate.js).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, on, debounce, fmtNum, pill, toast, openModal, foldHeader } from '../core/ui.js';
import { vsOptions, zoneLabel } from '../core/lookups.js';
import { estimateSummary, canEdit, saveEstimate, reviseEstimate, estimateProblems, revisions, canRevise as mayRevise } from '../core/estimates.js';
import { createFromEstimate } from '../core/quotations.js';
import { TABS, tabHtml, tabLabel, newRow, applyChange } from './estimate-tabs.js';
import { m2, partGroups, redraw, segGroup, costFacts, openMarkupBox } from './estimate-view.js';
import { bindPickers } from './picker.js';
import { openWorkflow } from './enquiry-view.js';
import { renderAmcEstimate } from './amc-estimate.js';
import { trailHtml } from './doc-trail.js';

const TAB_KEY = 'rsmEstTab';
const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
const cell = (t, i, f) => `[data-t="${t}"][data-i="${i}"][data-f="${f}"]`;
const FIRST = { labour: 'labourId', transport: 'zoneId', materials: 'itemId', equipment: 'equipmentId', overheads: 'name' };

const kpiHtml = (s, cur, sees) => html`<div class="kpi"><div><b>${m2(s.total)}</b><span>Total quote (${cur})</span></div>${sees ? html`<div><b>${fmtNum(s.markupPct, 1)} %</b><span>Markup on cost</span></div><div><b>${fmtNum(s.marginOnPricePct, 1)} %</b><span>Margin on price</span></div>`
  : html`<div><b>${m2(s.subtotal)}</b><span>Selling price before tax</span></div>`}</div>`;

export function renderEstimate(el, id) {
  const saved = store.get('estimates', id);
  if (!saved) { el.innerHTML = '<div class="page"><div class="empty">Estimate not found.</div></div>'; return; }
  if (saved.kind === 'AMC') return renderAmcEstimate(el, id);
  const est = structuredClone(saved);
  const enq = store.get('enquiries', est.enquiryId);
  const q = est.quotationId ? store.get('quotations', est.quotationId) : null;
  const ctx = { editable: canEdit(est) };
  const cur = auth.company().currency;
  // Overhead and markup are set by the Admin; the Overhead & Margin tab and the margin fields follow the role's rights.
  const sees = auth.seesMarkup(), mayPrice = ctx.editable && auth.changesMarkup();
  const tabs = TABS.filter(([k]) => k !== 'overheads' || sees);
  const revs = revisions(est.no);
  const newer = revs.find(r => r.rev > est.rev);
  let tab = sessionStorage.getItem(TAB_KEY) || 'summary';
  if (!tabs.some(([k]) => k === tab)) tab = 'summary';
  const canRevise = !newer && mayRevise(est);
  const rep = est.reportId ? store.get('siteReports', est.reportId) : null;

  el.innerHTML = String(html`<div class="page">
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
    ${trailHtml(enq.id, est.id)}
    <div class="stack">
      ${foldHeader({ id: `est-${est.id}`, title: 'Customer & estimate details', open: false,
        summary: [est.header.customer, est.header.contact, est.header.phone, est.header.site, `${est.no} Rev ${est.rev}`, est.header.date].filter(Boolean).join(' · '),
        body: html`<div class="fold-cols form-lines">
          <div><div class="form-sec">Customer</div>
          ${row('Customer Name', est.header.customer)}${row('Contact Person', est.header.contact)}${row('Phone No', est.header.phone)}
          ${row('Site Location', html`${est.header.site}${enq.zoneId ? html` · <span class="zone-chip">${zoneLabel(enq.zoneId).split(' ')[0]}</span>` : ''}`)}</div>
          <div><div class="form-sec">Estimate</div>
          ${row('Estimate No', `${est.no} · Rev ${est.rev}`)}
          ${ctx.editable ? html`<div class="field"><label for="est-date">Date</label><input type="date" id="est-date" data-h="date" value="${est.header.date}"></div>
            <div class="field"><label for="est-findings">Findings</label><textarea id="est-findings" data-h="findings" rows="2">${est.header.findings}</textarea></div>` : html`${row('Date', est.header.date)}${row('Findings', est.header.findings)}`}</div>
        </div>` })}
      <div class="card est-costing" role="group" aria-labelledby="costH-${est.id}"><h2 id="costH-${est.id}">Costing</h2><div class="est-props" id="props"></div></div>
      <div class="card"><div class="card-head"><h2>Cost sheet</h2></div>
        <div id="kpi"></div>
        <div class="etabs" id="tabs">${tabs.map(([k, label]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${tabLabel(k, label, est)}</button>`)}</div>
        <div id="tab"></div>
      </div>
      <div class="card"><div class="card-head"><h2>Revisions</h2></div><div class="form-lines fcols">
        ${revs.map(r => { const rq = r.quotationId ? store.get('quotations', r.quotationId) : null; return row(`Rev ${r.rev}`, html`${r.id === est.id ? html`<b>this one</b>` : html`<a href="#/estimates/${r.id}">open</a>`} · ${r.status}${rq ? ` · ${rq.no} Rev ${rq.rev} ${rq.status}` : ''}${r.returnNote && r.rev === r.returnNote.rev ? ` · returned: ${r.returnNote.comment}` : ''}`); })}</div></div>
    </div>
  </div>`);

  // Costing on one row (user's choice A, 26 Nov 2026): the two switches, then the figures set by the Admin. Shared Costs
  // shows only for Line costing; overheads and the markup only with "See markup"; Change only with "Change markup".
  let mkClose = null;
  const paintProps = () => {
    const box = $('#props', el);
    if (!box) return;
    box.innerHTML = String(html`
      <span class="cs-item"><span class="cs-l">Costing Level</span>${segGroup('costingLevel', vsOptions('COSTING_LEVEL'), est.costingLevel, !ctx.editable, 'Costing Level')}</span>
      ${est.costingLevel === 'LINE' ? html`<span class="cs-item"><span class="cs-l">Shared Costs</span>${segGroup('sharedCosts', vsOptions('SHARED_COSTS'), est.sharedCosts, !ctx.editable, 'Shared Costs')}</span>` : ''}
      ${costFacts(est, { sees, change: mayPrice, open: !!mkClose })}`);
  };
  const openMarkup = btn => {
    mkClose = openMarkupBox(el, est, btn, back => { mkClose = null; paintProps(); if (back) $('#mkChange', el)?.focus(); });
    paintProps();
  };
  on(el, 'click', '#mkChange', (e, b) => { if (mkClose) mkClose(true); else openMarkup(b); });

  // ---------- Drawing ----------
  const paint = () => {
    const s = estimateSummary(est);
    $('#kpi', el).innerHTML = String(kpiHtml(s, cur, sees));
    $$('[data-tab]', el).forEach(b => { b.textContent = tabLabel(b.dataset.tab, tabs.find(([k]) => k === b.dataset.tab)[1], est); });
    $('#tab', el).innerHTML = String(html`<div class="tab-scroll">${tabHtml(tab, est, tab === 'overheads' ? { ...ctx, editable: mayPrice } : ctx, s)}</div>`);
  };
  // Redraw without the page jumping or the cursor getting lost; after a change the cursor first reaches where it is going.
  const refresh = (opts = {}) => redraw(el, paint, { box: () => $('#tab', el), ...opts });
  let due = 0;
  const later = () => { clearTimeout(due); due = setTimeout(() => refresh(), 0); };
  const persist = debounce(() => saveEstimate(est.id, est), 250);
  const live = () => { $('#kpi', el).innerHTML = String(kpiHtml(estimateSummary(est), cur, sees)); };

  // "(parts: 2 × Tension spring)" at the end of a line's text follows the line's parts while the text still ends the
  // way the estimate wrote it (a text rewritten by hand is left alone), so nothing is typed twice.
  const partsText = key => { const m = est.materials.filter(x => x.lineKey === key && x.name); return m.length ? ` (parts: ${m.map(x => `${x.qty} × ${x.name}`).join(', ')})` : ''; };
  const withParts = fn => {
    const was = new Map(est.lines.filter(l => !l.partKey).map(l => [l.key, partsText(l.key)]));
    fn();
    est.lines.forEach(l => {
      const old = was.get(l.key), now = was.has(l.key) ? partsText(l.key) : old;
      if (old === now) return;
      const text = String(l.description || '');
      if (old && text.endsWith(old)) l.description = text.slice(0, -old.length) + now;
      else if (!old && text && !text.includes('(parts:')) l.description = text + now;
    });
  };

  // ---------- Rows: add (the cursor goes to the new row), remove (with Undo) ----------
  const addRow = t => {
    est[t].push(newRow(t, est)); persist();
    refresh({ focus: { sel: cell(t, est[t].length - 1, FIRST[t]), scroll: true } });
  };
  const removeRow = (t, i) => {
    let gone;
    withParts(() => { [gone] = est[t].splice(i, 1); });
    persist(); refresh();
    toast(`${gone.name || gone.trade || gone.zoneLabel || 'The row'} removed from the estimate`, '', { undo: () => { withParts(() => est[t].splice(Math.min(i, est[t].length), 0, gone)); persist(); refresh(); } });
  };

  // ---------- Edits: header fields (data-h), cells (data-t / data-i / data-f), chips (costing, shared costs, margin basis) ----------
  const read = t => (t.type === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value);
  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.h) { if (t.dataset.h === 'marginPct') { est.marginPct = read(t); paintProps(); } else est.header[t.dataset.h] = read(t); persist(); live(); }
    else if (t.dataset.t && t.tagName !== 'SELECT' && t.type !== 'hidden') {
      const set = () => { est[t.dataset.t][+t.dataset.i][t.dataset.f] = read(t); };
      if (t.dataset.t === 'materials') withParts(set); else set();
      persist(); live();
    }
  });
  el.addEventListener('change', e => {
    const t = e.target, d = t.dataset;
    if (!t.isConnected) return;
    if (d.t) {
      const i = +d.i, part = d.t === 'materials' && d.f === 'itemId';
      // An emptied part box changes nothing (the row is removed with its ✕); a picked part sends the cursor to its quantity.
      if (part && !t.value) { refresh(); return; }
      const set = () => { est[d.t][i][d.f] = read(t); applyChange(est, d.t, i, d.f); };
      if (d.t === 'materials') withParts(set); else set();
      persist();
      if (part) refresh({ focus: { sel: cell('materials', i, 'qty') } }); else later();
    }
    else if (d.h === 'marginPct') later();
    else if (['costingLevel', 'sharedCosts', 'marginBasis'].includes(t.name)) { est[t.name] = t.value; persist(); paintProps(); refresh(); }
  });
  // Enter in the last quantity box of the Materials tab: a new row, with the cursor in its type-to-search box.
  el.addEventListener('keydown', e => {
    const t = e.target;
    if (e.key !== 'Enter' || !ctx.editable || !t.matches?.('input[data-t="materials"][data-f="qty"]')) return;
    const all = $$('input[data-t="materials"][data-f="qty"]', t.closest('table'));
    if (all[all.length - 1] !== t) return;
    e.preventDefault();
    withParts(() => { est.materials[+t.dataset.i].qty = read(t); applyChange(est, 'materials', +t.dataset.i, 'qty'); });
    persist();
    addRow('materials');
  });
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; sessionStorage.setItem(TAB_KEY, tab); $$('[data-tab]', el).forEach(x => x.classList.toggle('on', x === b)); refresh(); });
  on(el, 'click', '[data-add]', (e, b) => addRow(b.dataset.add));
  on(el, 'click', '[data-del]', (e, b) => removeRow(b.dataset.del, +b.dataset.i));
  bindPickers(el, () => partGroups(est.materials.map(m => m.itemId)));

  $('#wf', el).onclick = () => openWorkflow(enq);
  $('#mkq', el)?.addEventListener('click', () => {
    saveEstimate(est.id, est);
    const problems = estimateProblems(est);
    if (problems.length) { openModal({ title: 'Not ready for a quotation', body: html`<ul>${problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] }); return; }
    const nq = createFromEstimate(est.id);
    if (!nq) { toast('The quotation of this enquiry is already accepted or rejected', 'bad'); return; }
    toast(`${nq.no} Rev ${nq.rev} created from ${est.no} Rev ${est.rev}`);
    go(`quotations/${nq.id}`);
  });
  const revise = () => {
    const next = reviseEstimate(est.id);
    if (!next) { toast('The quotation is already accepted or rejected', 'bad'); return; }
    toast(`${est.no} Rev ${next.rev} created. Change the prices, then create the quotation revision.`);
    go(`estimates/${next.id}`);
  };
  $('#revise', el)?.addEventListener('click', revise);
  $('#revise2', el)?.addEventListener('click', revise);
  paintProps();
  paint();
}
