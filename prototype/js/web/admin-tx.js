// Transaction Setup (Admin Setup): one page per transaction type, each with only the settings it uses: the number
// series, the defaults (values from the Value Set Master), the terms called by code from the Terms master in print
// order (meeting note), and the approvals: the same rules as the Authorization Workflow Master ("merging").
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, on, go, toast, chipGroup } from '../core/ui.js';
import { vsOptions, withCompany } from '../core/lookups.js';
import { termCodes, saveTermCodes, saveTxDefaults, saveCompany, TERM_DOCS } from '../core/setup.js';
import { describeRule } from '../core/workflow.js';
import { amcDefaults } from '../core/amc-estimates.js';
import { txDefaults } from '../core/estimates.js';
import { pageHead } from './shell.js';
import { changesCard } from './admin-company.js';
import { render } from '../app.js';

const TAB_KEY = 'rsmTxSetup';
const TYPES = [
  { key: 'ENQ', label: 'Sales Enquiry', series: 'ENQ' },
  { key: 'SVR', label: 'Site viewing report', series: 'SVR' },
  { key: 'EST', label: 'Estimate · Repair', series: 'EST' },
  { key: 'AMCEST', label: 'Estimate · AMC / GS', note: 'AMC and General Servicing estimates share the estimate numbers.' },
  { key: 'QT', label: 'Sales Quotation', series: 'QT', terms: ['Quotation', 'AMC'], rules: 'quotation' },
  { key: 'JOB', label: 'Job', series: 'JOB', rules: 'job' },
  { key: 'AMC', label: 'AMC contract', series: 'AMC' },
  { key: 'INV', label: 'Invoice', series: 'INV', terms: ['Invoice'], note: 'The number is given when the invoice is posted, without gaps.' },
  { key: 'RCPT', label: 'Receipt', series: 'RCPT' },
];

const num = (name, label, value, { hint = '', suffix = '', step = '1', ro = false } = {}) => html`<div class="field"><label for="t-${name}">${label}</label>
  <div class="ro"><input type="number" id="t-${name}" name="${name}" value="${value ?? ''}" step="${step}" min="0" style="width:90px" ${ro ? 'readonly' : ''}>${suffix ? html` ${suffix}` : ''}</div>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
const chips = (name, label, options, value, ro, hint = '') => html`<div class="field"><label>${label}</label>${chipGroup(name, options, value, ro)}${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;

function defaultsFields(type, ro) {
  const c = auth.company();
  if (type.key === 'ENQ') return html`<div class="form-sec">Site inspection</div>${num('inspectionTargetHours', 'Target', c.inspectionTargetHours ?? 2, { suffix: 'hours from the call', hint: 'The "Over 2 h target" tile and the clocks use it', ro })}`;
  if (type.key === 'EST' || type.key === 'AMCEST') {
    const d = type.key === 'EST' ? txDefaults() : amcDefaults();
    return html`<div class="form-sec">Defaults for new estimates</div>
      ${chips('costingLevel', 'Costing Level', vsOptions('COSTING_LEVEL'), d.costingLevel, ro)}
      ${type.key === 'EST' ? chips('sharedCosts', 'Shared Costs', vsOptions('SHARED_COSTS'), d.sharedCosts, ro, 'Used with Line costing') : ''}
      ${num('overheadPct', 'Overheads', d.overheadPct, { suffix: '% of direct cost', ro, step: '0.5' })}
      ${chips('marginBasis', 'Margin basis', vsOptions('MARGIN_BASIS'), d.marginBasis, ro)}
      ${num('marginPct', 'Margin', d.marginPct, { suffix: '%', ro, step: '0.5' })}
      ${type.key === 'AMCEST' ? html`${chips('visitsPerYear', 'Visits a year', [1, 2, 3, 4, 6, 12].map(v => ({ value: v, label: String(v) })), d.visitsPerYear, ro)}
        ${chips('billing', 'Billing', vsOptions('BILLING'), d.billing, ro, 'Instalments, in advance')}
        ${num('periodMonths', 'Contract', d.periodMonths, { suffix: 'months', ro })}
        ${num('liftHeightM', 'Scissor lift above', d.liftHeightM, { suffix: 'm shutter height', ro, step: '0.5' })}` : ''}`;
  }
  if (type.key === 'QT') {
    const d = txDefaults();
    return html`<div class="form-sec">Defaults</div>
      ${num('quoteValidityDays', 'Valid for', d.quoteValidityDays, { suffix: 'days from the date of issue', hint: '{validity} in a term becomes this number', ro })}
      <div class="field"><label for="t-pt">Payment term</label><select id="t-pt" name="defaultPaymentTerm" ${ro ? 'disabled' : ''}>${vsOptions('PAYMENT_TERMS').map(o => html`<option value="${o.value}" ${o.value === d.defaultPaymentTerm ? 'selected' : ''}>${o.label}</option>`)}</select>
        <div class="hint">When the customer has no term of its own (Value Set "Payment Terms")</div></div>`;
  }
  if (type.key === 'AMC') return html`<div class="form-sec">Renewal</div>${num('renewalDays', 'Reminder', amcDefaults().renewalDays, { suffix: 'days before the end', hint: 'A "Renew" task for the Operations Executive', ro })}`;
  return '';
}

function seriesFields(type, ro) {
  const s = store.findOne('series', x => x.docType === type.series);
  if (!s) return '';
  const year = new Date().getFullYear(), last = s.lastByYear[year] || 0;
  return html`<div class="form-sec">Numbering</div>
    <div class="field"><label for="t-prefix">Prefix</label><input type="text" id="t-prefix" name="prefix" value="${s.prefix}" maxlength="6" ${ro ? 'readonly' : ''}></div>
    ${chips('padding', 'Digits', [3, 4, 5].map(v => ({ value: v, label: String(v) })), s.padding, ro)}
    <div class="field"><label>Year in the number</label><div class="ro">Yes · restarts each January</div></div>
    ${num('next', 'Next number', last + 1, { hint: `Can only go up (last used this year: ${last})`, ro })}
    <div class="field"><label>Next one will be</label><div class="ro"><b id="nextNo"></b>${type.key === 'QT' ? ' · revisions add "Rev 2", "Rev 3"' : ''}</div></div>`;
}

function termsCard(docType, codes, ro) {
  const c = auth.company();
  const all = store.list('terms', t => t.docType === docType && t.status !== 'Inactive');
  const left = all.filter(t => !codes.includes(t.code));
  return html`<div class="card"><div class="card-head"><h2>Terms on ${docType === 'AMC' ? 'AMC quotations' : docType === 'Quotation' ? 'repair and GS quotations' : 'invoices'}</h2>
      ${!ro && left.length ? html`<select class="small" data-add="${docType}"><option value="">+ Add a term from the Terms master</option>${left.map(t => html`<option value="${t.code}">${t.code} · ${t.title}</option>`)}</select>` : ''}</div>
    <table class="tbl"><thead><tr><th class="num">Order</th><th>Code</th><th>Term</th><th></th></tr></thead><tbody>
      ${codes.map((code, i) => { const t = all.find(x => x.code === code); return html`<tr><td class="num">${i + 1}</td><td>${code}</td><td class="wrap">${t ? withCompany(t.text, c) : html`<span class="muted">not in the Terms master</span>`}</td>
        <td style="white-space:nowrap">${ro ? '' : html`<button class="btn small link" data-up="${docType}|${i}" ${i ? '' : 'disabled'}>↑</button><button class="btn small link" data-down="${docType}|${i}" ${i < codes.length - 1 ? '' : 'disabled'}>↓</button><button class="btn small link" data-rm="${docType}|${i}">✕</button>`}</td></tr>`; })}
    </tbody></table></div>`;
}

function rulesCard(docType) {
  const rules = store.list('approvalRules', r => r.docType === docType).sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
  const roleName = code => store.findOne('roles', r => r.code === code)?.name || code;
  return html`<div class="card"><div class="card-head"><h2>Approvals</h2><a href="#/admin/authWorkflow">Open the Authorization Workflow Master</a></div>
    <table class="tbl"><thead><tr><th>Rule</th><th>When</th><th class="num">Level</th><th>Approver</th><th>Active</th></tr></thead><tbody>
      ${rules.map(r => html`<tr class="click" data-rule="${r.id}"><td>${r.code}</td><td>${describeRule(r)}</td><td class="num">${r.level}</td><td>${roleName(r.roleCode)}</td><td>${r.active ? '✓' : 'off'}</td></tr>`)}
    </tbody></table><p class="mini-note">The same rules as the Authorization Workflow Master: click one to edit it there. Open tasks keep their levels.</p></div>`;
}

export function renderTxSetup(el) {
  const ro = !auth.can('transactionSetup', 'edit');
  const key = TYPES.some(t => t.key === sessionStorage.getItem(TAB_KEY)) ? sessionStorage.getItem(TAB_KEY) : 'QT';
  const type = TYPES.find(t => t.key === key);
  const terms = Object.fromEntries((type.terms || []).map(d => [d, [...termCodes(d)]]));
  const c = auth.company();
  const audit = [
    ...(type.series ? store.list('audit', a => a.coll === 'series' && a.recordId === store.findOne('series', x => x.docType === type.series)?.id) : []),
    ...store.auditFor('companies', c.id).filter(a => (type.terms || []).some(d => a.summary.startsWith(TERM_DOCS[d])) || (['AMCEST', 'AMC'].includes(type.key) && a.summary.startsWith('AMC / GS defaults'))
      || (['EST', 'QT'].includes(type.key) && a.summary.startsWith('Defaults:')) || (type.key === 'ENQ' && a.summary.startsWith('Inspection target'))),
    ...(type.rules ? store.list('audit', a => a.coll === 'approvalRules' && store.get('approvalRules', a.recordId)?.docType === type.rules) : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Admin Setup › Transaction Setup', title: type.label, sub: `${c.name} · applies to the next document${type.note ? ` · ${type.note}` : ''}`, actions: ro ? '' : html`<button class="btn primary" id="save">Save</button>` })}
    <div class="etabs">${TYPES.map(t => html`<button data-tab="${t.key}" class="${t.key === key ? 'on' : ''}">${t.label}</button>`)}</div>
    <div class="e2">
      <form class="props form-lines" id="tf" onsubmit="return false">${seriesFields(type, ro)}${defaultsFields(type, ro)}
        ${!type.series && !defaultsFields(type, ro) ? html`<div class="muted small" style="padding:10px 0">Nothing to set here.</div>` : ''}</form>
      <div class="e2-main">
        <div id="terms">${Object.entries(terms).map(([d, codes]) => termsCard(d, codes, ro))}</div>
        ${type.rules ? rulesCard(type.rules) : ''}
        ${changesCard(audit)}
      </div>
    </div></div>`);

  const form = $('#tf', el);
  const s = type.series ? store.findOne('series', x => x.docType === type.series) : null;
  const year = new Date().getFullYear();
  const showNext = () => {
    if (!s) return;
    const p = ($('[name=prefix]', form).value || '').toUpperCase(), d = Number($('[name=padding]:checked', form)?.value || s.padding), n = Number($('[name=next]', form).value || 0);
    $('#nextNo', el).textContent = `${p}-${year}-${String(n).padStart(d, '0')}`;
  };
  showNext();
  form.addEventListener('input', showNext);
  const paintTerms = () => { $('#terms', el).innerHTML = String(html`${Object.entries(terms).map(([d, codes]) => termsCard(d, codes, ro))}`); };
  on(el, 'click', '[data-tab]', (e, b) => { sessionStorage.setItem(TAB_KEY, b.dataset.tab); render(); });
  on(el, 'click', '[data-up],[data-down],[data-rm]', (e, b) => {
    const [d, i] = (b.dataset.up || b.dataset.down || b.dataset.rm).split('|'), k = Number(i), list = terms[d];
    if (b.dataset.up) [list[k - 1], list[k]] = [list[k], list[k - 1]];
    else if (b.dataset.down) [list[k + 1], list[k]] = [list[k], list[k + 1]];
    else list.splice(k, 1);
    paintTerms();
  });
  el.addEventListener('change', e => { const sel = e.target.closest('[data-add]'); if (sel?.value) { terms[sel.dataset.add].push(sel.value); paintTerms(); } });
  on(el, 'click', '[data-rule]', (e, tr) => { sessionStorage.setItem('rsmRuleSel', tr.dataset.rule); go('admin/authWorkflow'); });
  $('#save', el)?.addEventListener('click', () => {
    const f = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, v]));
    if (s) {
      const err = store.setSeries(type.series, { prefix: String(f.prefix || '').toUpperCase(), padding: Number(f.padding), next: Number(f.next) });
      if (err) { toast(err, 'bad'); return; }
    }
    const n = k => (f[k] === '' || f[k] == null ? undefined : Number(f[k]));
    if (type.key === 'ENQ') { const err = saveCompany({ inspectionTargetHours: n('inspectionTargetHours') || 2 }); if (err) { toast(err, 'bad'); return; } }
    const pick = keys => Object.fromEntries(keys.filter(k => f[k] != null && f[k] !== '').map(k => [k, ['overheadPct', 'marginPct', 'quoteValidityDays', 'visitsPerYear', 'periodMonths', 'liftHeightM', 'renewalDays'].includes(k) ? Number(f[k]) : f[k]]));
    if (type.key === 'EST') saveTxDefaults(pick(['costingLevel', 'sharedCosts', 'overheadPct', 'marginBasis', 'marginPct']));
    if (type.key === 'QT') saveTxDefaults(pick(['quoteValidityDays', 'defaultPaymentTerm']));
    if (type.key === 'AMCEST') saveTxDefaults(pick(['costingLevel', 'overheadPct', 'marginBasis', 'marginPct', 'visitsPerYear', 'billing', 'periodMonths', 'liftHeightM']), 'amc');
    if (type.key === 'AMC') saveTxDefaults(pick(['renewalDays']), 'amc');
    Object.entries(terms).forEach(([d, codes]) => saveTermCodes(d, codes));
    toast(`${type.label}: saved`); render();
  });
}
