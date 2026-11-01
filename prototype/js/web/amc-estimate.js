// AMC / General Servicing estimate page ("E2" layout): customer, contract and costing on the left in line style, the
// AMC Excel's tabs on the right. Pre-filled from each site's shutter register and the masters; changes save as you
// type. "Create quotation" makes the quotation (or its next revision) from this revision.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, on, debounce, fmtNum, pill, toast, openModal, chipGroup, readForm } from '../core/ui.js';
import { vsOptions, zoneLabel, productName, findSite } from '../core/lookups.js';
import { estimateSummary, canEdit, saveEstimate, reviseEstimate, estimateProblems, revisions, canRevise as mayRevise } from '../core/estimates.js';
import { describe, addSiteTo, removeSiteFrom, setCovered, otherSites, isRenewal } from '../core/amc-estimates.js';
import { createFromEstimate } from '../core/quotations.js';
import { AMC_TABS, amcTabHtml, newAmcRow, applyAmcChange, setPath } from './amc-estimate-tabs.js';
import { openWorkflow } from './enquiry-view.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TAB_KEY = 'rsmAmcEstTab';
const VISITS = [1, 2, 3, 4, 6, 12].map(n => ({ value: n, label: String(n) }));
const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;

function kpiHtml(est, s, cur) {
  if (est.jobType === 'GS') {
    return html`<div class="kpi"><div><b>${m2(s.total)}</b><span>Total quote (${cur}) incl. ${est.taxLabel || 'tax'}</span></div><div><b>${s.metrics.shutters}</b><span>Shutters · ${fmtNum(s.metrics.teamHrs)} team-hours</span></div>
      <div><b>${fmtNum(s.markupPct, 1)} %</b><span>Markup on cost · ${fmtNum(s.marginOnPricePct, 1)} % on price</span></div></div>`;
  }
  return html`<div class="kpi k4"><div><b>${m2(s.total)}</b><span>Total quote (${cur}) incl. ${est.taxLabel || 'tax'}</span></div><div><b>${m2(s.metrics.perShutterYear)}</b><span>Per shutter per year</span></div>
    <div><b>${m2(s.metrics.perMonth)}</b><span>Per month · ${m2(s.metrics.perMonthEx)} before ${est.taxLabel || 'tax'}</span></div><div><b>${fmtNum(s.markupPct, 1)} %</b><span>Markup on cost · ${fmtNum(s.marginOnPricePct, 1)} % on price</span></div></div>`;
}

export function renderAmcEstimate(el, id) {
  const saved = store.get('estimates', id);
  const est = structuredClone(saved);
  const enq = store.get('enquiries', est.enquiryId);
  const q = est.quotationId ? store.get('quotations', est.quotationId) : null;
  const ctx = { editable: canEdit(est) };
  const cur = auth.company().currency;
  const revs = revisions(est.no);
  const newer = revs.find(r => r.rev > est.rev);
  const canRevise = !newer && mayRevise(est);
  const gs = est.jobType === 'GS';
  let tab = sessionStorage.getItem(TAB_KEY) || 'summary';

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/estimates">Estimation</a> › <a href="#/enquiries/${enq.id}">${enq.no}</a></div>
      <h1>${est.no} · Rev ${est.rev} · ${est.header.customer} ${pill(est.status)}</h1>
      <div class="page-meta">${gs ? 'General Servicing' : 'AMC'}${isRenewal(est) ? ` · renewal of ${store.get('contracts', enq.renewsContractId)?.no}` : ''} · from ${est.reportId ? 'the site report' : `the BOQ on ${enq.no}`} · prepared by <b>${auth.userName(est.header.preparedBy)}</b>${ctx.editable ? ' · changes save as you type' : ''}</div></div>
      <div class="row"><button class="btn soft" id="wf">⇶ Workflow</button>
        ${q ? html`<a class="btn" href="#/quotations/${q.id}">Open ${q.no} Rev ${q.rev}</a>` : ''}
        ${canRevise ? html`<button class="btn" id="revise">Revise estimate</button>` : ''}
        ${ctx.editable && !q ? html`<button class="btn primary" id="mkq">Create quotation${est.rev > 1 ? ' revision' : ''} →</button>` : ''}</div>
    </div>
    ${newer ? html`<div class="note warn" style="margin-bottom:10px">This revision was replaced by <a href="#/estimates/${newer.id}">Rev ${newer.rev}</a>.</div>` : ''}
    ${est.returnNote && !newer && (est.status === 'Draft' || q?.status === 'Returned') ? html`<div class="note bad" style="margin-bottom:10px;display:flex;gap:10px;align-items:center">
      <span class="grow"><b>Returned by ${auth.userName(est.returnNote.by)}</b> (quotation Rev ${est.returnNote.rev}): ${est.returnNote.comment}</span>
      ${canRevise ? html`<button class="btn small" id="revise2">Revise estimate</button>` : ''}</div>` : ''}
    <div class="e2">
      <div class="props form-lines" id="props"></div>
      <div class="e2-main"><div class="card"><div id="kpi"></div>
        <div class="etabs" id="tabs">${AMC_TABS.map(([k, label]) => html`<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${label}</button>`)}</div>
        <div id="tab"></div></div></div>
    </div>
  </div>`);

  const sameVisits = () => { const v = [...new Set(est.sites.map(s => Number(s.visits)))]; return v.length === 1 ? v[0] : ''; };
  const paintProps = () => {
    $('#props', el).innerHTML = String(html`
      <div class="form-sec">Customer</div>
      ${row('Customer Name', est.header.customer)}${row('Contact Person', [est.header.contact, est.header.phone].filter(Boolean).join(' · '))}
      <div class="form-sec">${gs ? 'Servicing' : 'Contract'}</div>
      ${row('Type', `${gs ? 'General Servicing' : 'AMC'} (from the enquiry)`)}
      ${gs ? row('Visits', 'One visit, no contract') : html`
        ${ctx.editable ? html`<div class="field"><label>Period (months)</label><input type="number" step="1" data-h="periodMonths" value="${est.periodMonths}"></div>` : row('Period', `${est.periodMonths} months`)}
        <div class="field"><label>Visits per year</label>${chipGroup('visitsAll', VISITS, sameVisits(), !ctx.editable)}${sameVisits() === '' ? html`<div class="sub">Different per site (Shutters tab)</div>` : ''}</div>
        <div class="field"><label>Billing</label>${chipGroup('billing', vsOptions('BILLING'), est.billing, !ctx.editable)}</div>`}
      <div class="form-sec">Sites</div>
      ${est.sites.map((x, i) => row(`Site ${i + 1}`, html`${x.name} · <span class="zone-chip">${zoneLabel(x.zoneId).split(' ')[0] || '—'}</span> · ${x.typed ? 'typed counts' : `${x.shutterIds.length} shutters`}`))}
      <div class="form-sec">Costing</div>
      <div class="field"><label>Costing Level</label>${chipGroup('costingLevel', vsOptions('COSTING_LEVEL').map(o => (o.value === 'LINE' ? { ...o, label: 'Line (per site)' } : o)), est.costingLevel, !ctx.editable)}</div>
      ${row('Overheads', est.overheads.map(o => (o.basis === 'FIXED' ? `${m2(o.value)} fixed` : `${fmtNum(o.value)} % of direct cost`)).join(' + '))}
      <div class="field"><label>Margin basis</label>${chipGroup('marginBasis', vsOptions('MARGIN_BASIS'), est.marginBasis, !ctx.editable)}</div>
      ${ctx.editable ? html`<div class="field"><label>Margin %</label><input type="number" step="any" data-h="marginPct" value="${est.marginPct}"></div>` : row('Margin %', `${fmtNum(est.marginPct)} %`)}
      ${row('Tax', est.taxCode ? `${est.taxCode} · ${est.taxLabel} ${fmtNum(est.taxRate)} %` : 'No tax charged')}
      <div class="form-sec">Revisions</div>
      ${revs.map(r => { const rq = r.quotationId ? store.get('quotations', r.quotationId) : null; return row(`Rev ${r.rev}`, html`${r.id === est.id ? html`<b>this one</b>` : html`<a href="#/estimates/${r.id}">open</a>`} · ${r.status}${rq ? ` · ${rq.no} Rev ${rq.rev} ${rq.status}` : ''}`); })}`);
  };
  const paintKpi = () => { $('#kpi', el).innerHTML = String(kpiHtml(est, estimateSummary(est), cur)); };
  const paint = () => {
    const s = estimateSummary(est);
    $('#kpi', el).innerHTML = String(kpiHtml(est, s, cur));
    $('#tab', el).innerHTML = String(html`<div class="tab-scroll">${amcTabHtml(tab, est, ctx, s, otherSites(est).length)}</div>`);
  };
  const persist = debounce(() => saveEstimate(est.id, est), 250);
  // The description follows the sites and visits until someone writes their own.
  const change = fn => { const auto = describe(est); fn(); if (est.header.description === auto) est.header.description = describe(est); persist(); };
  const read = t => (t.type === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value);

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.p && t.tagName !== 'SELECT') { change(() => setPath(est, t.dataset.p, read(t))); paintKpi(); }
    else if (t.dataset.h) { change(() => { est[t.dataset.h] = read(t); }); paintKpi(); }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.p) { change(() => { setPath(est, t.dataset.p, read(t)); applyAmcChange(est, t.dataset.p); }); paint(); }
    else if (t.dataset.h) { paint(); paintProps(); }
    else if (t.name === 'visitsAll') { change(() => est.sites.forEach(x => { x.visits = Number(t.value); })); paintProps(); paint(); }
    else if (['billing', 'costingLevel', 'marginBasis'].includes(t.name)) { change(() => { est[t.name] = t.value; }); paintProps(); paint(); }
  });
  on(el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; sessionStorage.setItem(TAB_KEY, tab); $$('[data-tab]', el).forEach(x => x.classList.toggle('on', x === b)); paint(); });
  on(el, 'click', '[data-add]', (e, b) => { change(() => est[b.dataset.add].push(newAmcRow(b.dataset.add, est))); paint(); });
  on(el, 'click', '[data-del]', (e, b) => { const [k, i] = b.dataset.del.split('|'); change(() => est[k].splice(+i, 1)); paint(); });
  on(el, 'click', '[data-rmsite]', (e, b) => { change(() => Object.assign(est, removeSiteFrom(est, b.dataset.rmsite))); paintProps(); paint(); });
  on(el, 'click', '[data-addsite]', () => addSiteDialog());
  on(el, 'click', '[data-cover]', (e, b) => coverDialog(b.dataset.cover));

  function addSiteDialog() {
    const list = otherSites(est);
    openModal({
      title: 'Add a site of this customer',
      body: html`<div class="form-lines">${list.map(x => html`<label class="check" style="display:flex;margin:5px 0"><input type="checkbox" name="s_${x.id}"> ${x.name} · Zone ${zoneLabel(x.zoneId) || '—'} · ${(x.shutters || []).length} shutters</label>`)}</div>`,
      actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: b => { const d = readForm(b); change(() => list.filter(x => d[`s_${x.id}`]).forEach(x => Object.assign(est, addSiteTo(est, x.id)))); paintProps(); paint(); } }],
    });
  }
  function coverDialog(key) {
    const x = est.sites.find(s => s.key === key);
    const { site } = findSite(x.siteId);
    const list = (site?.shutters || []).filter(s => s.status !== 'Inactive');
    openModal({
      title: `Covered shutters at ${x.name}`,
      body: html`<div class="form-lines">${list.map(sh => html`<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" name="c_${sh.id}" ${x.shutterIds.includes(sh.id) ? 'checked' : ''} ${ctx.editable ? '' : 'disabled'}>
        <b style="margin:0 6px">${sh.tag}</b> ${sh.location} · ${productName(sh.productId)} · ${sh.sizeCode}${sh.fireRated ? ' · fire-rated' : ''}</label>`)}</div>`,
      actions: ctx.editable ? [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: b => { const d = readForm(b); change(() => Object.assign(est, setCovered(est, key, list.filter(sh => d[`c_${sh.id}`]).map(sh => sh.id)))); paintProps(); paint(); } }] : [{ label: 'Close' }],
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
