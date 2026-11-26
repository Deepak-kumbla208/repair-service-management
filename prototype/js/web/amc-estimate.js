// AMC / General Servicing estimate page, stacked: customer and sites in a header that folds to one line, then the
// contract and costing settings and the cost sheet in the AMC Excel's tabs (amc-estimate-tabs.js), then the
// revisions. The Excel tabs are the only view of an estimate (user, 26 Nov 2026; the simple view built for the UX
// audit's finding 6 is gone). Pre-filled from each site's customer products and the masters; changes save as you
// type. "Create quotation" makes the quotation (or its next revision) from this revision.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, on, debounce, fmtNum, pill, toast, openModal, readForm, foldHeader } from '../core/ui.js';
import { vsOptions, zoneLabel, productName, findSite } from '../core/lookups.js';
import { sizeText } from '../core/products.js';
import { estimateSummary, canEdit, saveEstimate, reviseEstimate, estimateProblems, revisions, canRevise as mayRevise } from '../core/estimates.js';
import { describe, addSiteTo, removeSiteFrom, setCovered, otherSites, isRenewal, keyedMatrix } from '../core/amc-estimates.js';
import { createFromEstimate } from '../core/quotations.js';
import { AMC_TABS, amcTabHtml, newAmcRow, applyAmcChange, setPath } from './amc-estimate-tabs.js';
import { m2, partGroups, redraw, segGroup, costFacts, openMarkupBox } from './estimate-view.js';
import { bindPickers } from './picker.js';
import { openWorkflow } from './enquiry-view.js';
import { trailHtml } from './doc-trail.js';

const TAB_KEY = 'rsmAmcEstTab';
const VISITS = [1, 2, 3, 4, 6, 12].map(n => ({ value: n, label: String(n) }));
const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;

function kpiHtml(est, s, cur, sees) {
  const mk = sees ? html`<div><b>${fmtNum(s.markupPct, 1)} %</b><span>Markup on cost · ${fmtNum(s.marginOnPricePct, 1)} % on price</span></div>` : '';
  if (est.jobType === 'GS') {
    return html`<div class="kpi"><div><b>${m2(s.total)}</b><span>Total quote (${cur}) incl. ${est.taxLabel || 'tax'}</span></div><div><b>${s.metrics.shutters}</b><span>Products · ${fmtNum(s.metrics.teamHrs)} team-hours</span></div>${mk}</div>`;
  }
  return html`<div class="kpi ${sees ? 'k4' : ''}"><div><b>${m2(s.total)}</b><span>Total quote (${cur}) incl. ${est.taxLabel || 'tax'}</span></div><div><b>${m2(s.metrics.perShutterYear)}</b><span>Per product per year</span></div>
    <div><b>${m2(s.metrics.perMonth)}</b><span>Per month · ${m2(s.metrics.perMonthEx)} before ${est.taxLabel || 'tax'}</span></div>${mk}</div>`;
}

export function renderAmcEstimate(el, id) {
  const saved = store.get('estimates', id);
  const est = keyedMatrix(structuredClone(saved)); // a matrix saved before size sets reads with today's keys
  const enq = store.get('enquiries', est.enquiryId);
  const q = est.quotationId ? store.get('quotations', est.quotationId) : null;
  const ctx = { editable: canEdit(est) };
  const cur = auth.company().currency;
  // Overhead and markup are set by the Admin; the Overhead & Margin tab and the margin fields follow the role's rights.
  const sees = auth.seesMarkup(), mayPrice = ctx.editable && auth.changesMarkup();
  const tabs = AMC_TABS.filter(([k]) => k !== 'overhead' || sees);
  const revs = revisions(est.no);
  const newer = revs.find(r => r.rev > est.rev);
  const canRevise = !newer && mayRevise(est);
  const gs = est.jobType === 'GS';
  let tab = sessionStorage.getItem(TAB_KEY) || 'summary';
  if (!tabs.some(([k]) => k === tab)) tab = 'summary';

  el.innerHTML = String(html`<div class="page">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/estimates">Estimation</a> › <a href="#/enquiries/${enq.id}">${enq.no}</a></div>
      <h1>${est.no} · Rev ${est.rev} · ${est.header.customer} ${pill(est.status)}</h1>
      <div class="page-meta">${gs ? 'General Servicing' : 'AMC'}${isRenewal(est) ? ` · renewal of ${store.get('contracts', enq.renewsContractId)?.no}` : ''} · from ${est.reportId ? 'the site report' : `the customer's list (BOQ) on ${enq.no}`} · prepared by <b>${auth.userName(est.header.preparedBy)}</b>${ctx.editable ? ' · changes save as you type' : ''}</div></div>
      <div class="row"><button class="btn soft" id="wf">⇶ Workflow</button>
        ${q ? html`<a class="btn" href="#/quotations/${q.id}">Open ${q.no} Rev ${q.rev}</a>` : ''}
        ${canRevise ? html`<button class="btn" id="revise">Revise estimate</button>` : ''}
        ${ctx.editable && !q ? html`<button class="btn primary" id="mkq">Create quotation${est.rev > 1 ? ' revision' : ''} →</button>` : ''}</div>
    </div>
    ${newer ? html`<div class="note warn" style="margin-bottom:10px">This revision was replaced by <a href="#/estimates/${newer.id}">Rev ${newer.rev}</a>.</div>` : ''}
    ${est.returnNote && !newer && (est.status === 'Draft' || q?.status === 'Returned') ? html`<div class="note bad" style="margin-bottom:10px;display:flex;gap:10px;align-items:center">
      <span class="grow"><b>Returned by ${auth.userName(est.returnNote.by)}</b> (quotation Rev ${est.returnNote.rev}): ${est.returnNote.comment}</span>
      ${canRevise ? html`<button class="btn small" id="revise2">Revise estimate</button>` : ''}</div>` : ''}
    ${trailHtml(enq.id, est.id)}
    <div class="stack">
      ${foldHeader({ id: `est-${est.id}`, title: 'Customer & sites', open: false,
        summary: [est.header.customer, est.header.contact, est.header.phone, `${est.sites.length} site(s)`, `${est.no} Rev ${est.rev}`].filter(Boolean).join(' · '),
        body: html`<div class="fold-cols form-lines">
          <div><div class="form-sec">Customer</div>${row('Customer Name', est.header.customer)}${row('Contact Person', [est.header.contact, est.header.phone].filter(Boolean).join(' · '))}</div>
          <div><div class="form-sec">Sites</div><div id="sitesBox"></div></div>
        </div>` })}
      <div class="card est-costing" role="group" aria-labelledby="costH-${est.id}"><h2 id="costH-${est.id}">${gs ? 'Servicing' : 'Contract'} and costing</h2><div class="est-props two" id="props"></div></div>
      <div class="card"><div class="card-head"><h2>Cost sheet</h2></div><div id="kpi"></div>
        <div class="etabs" id="tabs">${tabs.map(([k, label]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${label}</button>`)}</div>
        <div id="tab"></div></div>
      <div class="card"><div class="card-head"><h2>Revisions</h2></div><div class="form-lines fcols">
        ${revs.map(r => { const rq = r.quotationId ? store.get('quotations', r.quotationId) : null; return row(`Rev ${r.rev}`, html`${r.id === est.id ? html`<b>this one</b>` : html`<a href="#/estimates/${r.id}">open</a>`} · ${r.status}${rq ? ` · ${rq.no} Rev ${rq.rev} ${rq.status}` : ''}`); })}</div></div>
    </div>
  </div>`);

  const sameVisits = () => { const v = [...new Set(est.sites.map(s => Number(s.visits)))]; return v.length === 1 ? v[0] : ''; };
  // Sites change from the Products to service tab (add, remove, covered products), so the header's list is repainted too.
  const paintSites = () => {
    $('#sitesBox', el).innerHTML = String(html`${est.sites.map((x, i) => row(`Site ${i + 1}`, html`${x.name} · <span class="zone-chip">${zoneLabel(x.zoneId).split(' ')[0] || '—'}</span> · ${x.typed ? 'typed counts' : `${x.shutterIds.length} product${x.shutterIds.length === 1 ? '' : 's'}`}`))}`);
  };
  // Contract and costing in two short rows (the one-row Costing card, user's choice A, 26 Nov 2026): the contract's own
  // settings first (period, visits per year, billing), then the costing switch and the figures set by the Admin.
  let mkClose = null;
  const paintProps = () => {
    paintSites();
    const box = $('#props', el);
    if (!box) return;
    const same = sameVisits();
    box.innerHTML = String(html`
      <div class="cs-line">
        <span class="cs-fact">Type <b>${gs ? 'General Servicing' : 'AMC'}</b> from the enquiry</span>
        ${gs ? html`<span class="cs-fact"><b>One visit</b>, no contract</span>` : html`
          <span class="cs-item">${ctx.editable ? html`<label class="cs-l" for="amc-period">Period</label><input type="number" step="1" min="1" id="amc-period" data-h="periodMonths" value="${est.periodMonths}"><span class="cs-l">months</span>`
            : html`<span class="cs-l">Period</span><b>${est.periodMonths} months</b>`}</span>
          <span class="cs-item"><span class="cs-l">Visits per year</span>${segGroup('visitsAll', VISITS, same, !ctx.editable, 'Visits per year')}${same === '' ? html`<span class="cs-l">different per site (Products to service tab)</span>` : ''}</span>
          <span class="cs-item"><span class="cs-l">Billing</span>${segGroup('billing', vsOptions('BILLING'), est.billing, !ctx.editable, 'Billing')}</span>`}
      </div>
      <div class="cs-line">
        <span class="cs-item"><span class="cs-l">Costing Level</span>${segGroup('costingLevel', vsOptions('COSTING_LEVEL').map(o => (o.value === 'LINE' ? { ...o, label: 'Line (per site)' } : o)), est.costingLevel, !ctx.editable, 'Costing Level')}</span>
        ${costFacts(est, { sees, change: mayPrice, open: !!mkClose })}
      </div>`);
  };
  const openMarkup = btn => {
    mkClose = openMarkupBox(el, est, btn, back => { mkClose = null; paintProps(); if (back) $('#mkChange', el)?.focus(); });
    paintProps();
  };
  on(el, 'click', '#mkChange', (e, b) => { if (mkClose) mkClose(true); else openMarkup(b); });

  // ---------- Drawing ----------
  const live = () => { $('#kpi', el).innerHTML = String(kpiHtml(est, estimateSummary(est), cur, sees)); };
  const paint = () => {
    const s = estimateSummary(est);
    $('#kpi', el).innerHTML = String(kpiHtml(est, s, cur, sees));
    $('#tab', el).innerHTML = String(html`<div class="tab-scroll">${amcTabHtml(tab, est, tab === 'overhead' ? { ...ctx, editable: mayPrice } : ctx, s, otherSites(est).length)}</div>`);
  };
  // Redraw without the page jumping or the cursor getting lost; after a change the cursor first reaches where it is going.
  const refresh = (opts = {}) => redraw(el, paint, { box: () => $('#tab', el), ...opts });
  let due = 0;
  const later = (props = false) => { clearTimeout(due); due = setTimeout(() => { if (props) redraw(el, paintProps); refresh(); }, 0); };
  const persist = debounce(() => saveEstimate(est.id, est), 250);
  // The description follows the sites and visits until someone writes their own.
  const change = fn => { const auto = describe(est); fn(); if (est.header.description === auto) est.header.description = describe(est); persist(); };
  const read = t => (t.type === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value);

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.p && t.tagName !== 'SELECT' && t.type !== 'hidden') { change(() => setPath(est, t.dataset.p, read(t))); live(); }
    else if (t.dataset.h) { change(() => { est[t.dataset.h] = read(t); }); live(); if (t.dataset.h === 'marginPct') paintProps(); }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (!t.isConnected) return;
    if (t.dataset.p) {
      const part = /^materials\.\d+\.itemId$/.test(t.dataset.p);
      // An emptied material box changes nothing (the row is removed with its ✕); a picked one sends the cursor to its quantity.
      if (part && !t.value) { refresh(); return; }
      change(() => { setPath(est, t.dataset.p, read(t)); applyAmcChange(est, t.dataset.p); });
      if (part) refresh({ focus: { sel: `[data-p="${t.dataset.p.replace('itemId', 'qty')}"]` } }); else later(t.dataset.p.startsWith('sites.'));
    }
    else if (t.dataset.h) later(true);
    else if (t.name === 'visitsAll') { change(() => est.sites.forEach(x => { x.visits = Number(t.value); })); redraw(el, paintProps); refresh(); }
    else if (['billing', 'costingLevel', 'marginBasis'].includes(t.name)) { change(() => { est[t.name] = t.value; }); redraw(el, paintProps); refresh(); }
  });
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; sessionStorage.setItem(TAB_KEY, tab); $$('[data-tab]', el).forEach(x => x.classList.toggle('on', x === b)); refresh(); });
  on(el, 'click', '[data-add]', (e, b) => { const k = b.dataset.add; change(() => est[k].push(newAmcRow(k, est)));
    refresh({ focus: { sel: `[data-p="${k}.${est[k].length - 1}.${{ materials: 'itemId', equipment: 'equipmentId', overheads: 'name' }[k]}"]`, scroll: true } }); });
  on(el, 'click', '[data-del]', (e, b) => {
    const [k, i] = b.dataset.del.split('|');
    let gone; change(() => { [gone] = est[k].splice(+i, 1); }); refresh();
    toast(`${gone.name || 'The row'} removed from the estimate`, '', { undo: () => { change(() => est[k].splice(Math.min(+i, est[k].length), 0, gone)); refresh(); } });
  });
  on(el, 'click', '[data-rmsite]', (e, b) => { change(() => Object.assign(est, removeSiteFrom(est, b.dataset.rmsite))); paintProps(); refresh(); });
  on(el, 'click', '[data-addsite]', () => addSiteDialog());
  on(el, 'click', '[data-cover]', (e, b) => coverDialog(b.dataset.cover));
  bindPickers(el, () => partGroups(est.materials.map(m => m.itemId)));

  function addSiteDialog() {
    const list = otherSites(est);
    openModal({
      title: 'Add a site of this customer',
      body: html`<div class="form-lines">${list.map(x => html`<label class="check" style="display:flex;margin:5px 0"><input type="checkbox" name="s_${x.id}"> ${x.name} · Zone ${zoneLabel(x.zoneId) || '—'} · ${(x.shutters || []).length} products</label>`)}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: b => { const d = readForm(b); change(() => list.filter(x => d[`s_${x.id}`]).forEach(x => Object.assign(est, addSiteTo(est, x.id)))); paintProps(); refresh(); } }],
    });
  }
  function coverDialog(key) {
    const x = est.sites.find(s => s.key === key);
    const { site } = findSite(x.siteId);
    const list = (site?.shutters || []).filter(s => s.status !== 'Inactive');
    openModal({
      title: `Covered products at ${x.name}`,
      body: html`<div class="form-lines">${list.map(sh => html`<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" name="c_${sh.id}" ${x.shutterIds.includes(sh.id) ? 'checked' : ''} ${ctx.editable ? '' : 'disabled'}>
        <b style="margin:0 6px">${sh.tag}</b> ${sh.location} · ${productName(sh.productId)}${sh.sizeCode ? ` · ${sizeText(sh)}` : ''}${sh.fireRated ? ' · fire-rated' : ''}</label>`)}</div>`,
      actions: ctx.editable ? [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: b => { const d = readForm(b); change(() => Object.assign(est, setCovered(est, key, list.filter(sh => d[`c_${sh.id}`]).map(sh => sh.id)))); paintProps(); refresh(); } }] : [{ label: 'Close' }],
    });
  }

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
  const revise = () => { const next = reviseEstimate(est.id); if (!next) { toast('The quotation is already accepted or rejected', 'bad'); return; } toast(`${est.no} Rev ${next.rev} created`); go(`estimates/${next.id}`); };
  $('#revise', el)?.addEventListener('click', revise);
  $('#revise2', el)?.addEventListener('click', revise);
  paintProps();
  paint();
}
