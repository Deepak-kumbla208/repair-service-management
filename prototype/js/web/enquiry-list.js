// Sales Enquiry: the live Enquiry Register (all 26 columns in the team lead's order), with count tiles,
// a page search and filters. Two screen-only columns (Status, Zone) come first and are shaded.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, on, go, debounce, fmtDate, fmtTime, fmtDuration, pill, tiles, emptyRow } from '../core/ui.js';
import { vsLabel, vsOptions, zones, zoneCode } from '../core/lookups.js';
import { laterColumns, inspectionClock, isToday, ENQ_STATUSES } from '../core/enquiries.js';
import { pageHead } from './shell.js';
import { channelText } from './enquiry-view.js';

export const REGISTER_COLUMNS = ['Enquiry No', 'Enquiry Date', 'Enquiry Time', 'Customer Name', 'Contact Person', 'Mobile', 'Email', 'Site Location',
  'Enquiry Status', 'Enquiry Channel', 'Type', 'Enquiry Description', 'Priority', 'Recorded By', 'Remarks', 'Site Inspection',
  'Quotation Date', 'Quotation Status', 'Quotation Value', 'Job Status', 'Work Completion Status', 'Work Completion Date',
  'Invoice Date', 'Invoice No', 'Invoice Value', 'Payment Received'];

export function registerRow(e) {
  const l = laterColumns(e);
  return [e.no, fmtDate(e.receivedAt), fmtTime(e.receivedAt), e.customerName, e.contactName, e.mobile, e.email, e.siteName,
    vsLabel('ENQ_STATUS', e.enquiryStatus), channelText(e), vsLabel('ENQ_TYPE', e.type), e.description,
    vsLabel('PRIORITY', e.priority), auth.userName(e.recordedBy), e.remarks, vsLabel('YES_NO', e.siteInspection),
    l.quotationDate, l.quotationStatus, l.quotationValue, l.jobStatus, l.workCompletion, l.workCompletionDate,
    l.invoiceDate, l.invoiceNo, l.invoiceValue, l.paymentReceived];
}

const OPEN_INSPECTION = ['Waiting for inspection', 'Inspection assigned', 'Report in progress'];

// Count tiles shared with the dashboard. Each tile is also a filter.
export function enquiryTiles(list, company) {
  const now = Date.now();
  const target = company.inspectionTargetHours || 2;
  const clock = e => inspectionClock(e, company, now);
  const waiting = list.filter(e => OPEN_INSPECTION.includes(e.status));
  const oldest = waiting.reduce((m, e) => Math.max(m, now - new Date(e.receivedAt).getTime()), 0);
  const defs = [
    { key: 'today', label: 'New today', sub: 'received since 00:00', test: e => isToday(e.receivedAt) },
    { key: 'waiting', label: 'Waiting for inspection', sub: waiting.length ? `oldest ${fmtDuration(oldest)}` : 'none open', tone: 'warn', test: e => OPEN_INSPECTION.includes(e.status) },
    { key: 'over', label: `Over ${target} h target`, sub: 'inspection not done in time', tone: 'bad', test: e => { const c = clock(e); return c && !c.done && c.state === 'bad'; } },
    { key: 'boq', label: 'BOQ study', sub: 'AMC and servicing', test: e => e.status === 'BOQ study' },
    { key: 'inspected', label: 'Inspected, to estimate', sub: 'report received', test: e => ['Inspected', 'Waiting for estimate'].includes(e.status) },
  ];
  return defs.map(d => ({ ...d, count: list.filter(d.test).length }));
}

const KEY = 'rsmEnqFilters';
const loadState = () => { try { return { tile: '', q: '', type: '', zone: '', status: '', priority: '', period: '', ...JSON.parse(sessionStorage.getItem(KEY)) }; } catch { return { tile: '', q: '' }; } };
const saveState = s => sessionStorage.setItem(KEY, JSON.stringify(s));
export const setEnquiryTile = tile => saveState({ ...loadState(), tile });

function periodTest(period, iso) {
  if (!period) return true;
  const days = { today: 0, d7: 7, d30: 30 }[period];
  if (days === 0) return isToday(iso);
  return Date.now() - new Date(iso).getTime() <= days * 86400000;
}

export function renderEnquiryList(el) {
  const company = auth.company();
  const state = loadState();
  const canCreate = auth.can('enquiry', 'create');

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Transactions › Sales Enquiry', title: 'Enquiry register', sub: 'Live register: the later columns fill in from the linked documents.',
      actions: html`<div class="row">
        <button class="btn" id="csv" title="All 26 register columns">⇩ Export CSV</button>
        ${canCreate ? html`<button class="btn" id="paste">✉ Paste email</button><a class="btn primary" href="#/enquiries/new">+ New enquiry</a>` : ''}
      </div>` })}
    <div id="tiles"></div>
    <div class="filters">
      <input type="search" class="search" id="q" placeholder="Search enquiries: no, customer, contact, mobile, email, site, description" value="${state.q}">
      <select id="type" title="Type"><option value="">All types</option>${vsOptions('ENQ_TYPE').map(o => html`<option value="${o.value}" ${o.value === state.type ? 'selected' : ''}>${o.label}</option>`)}</select>
      <select id="zone" title="Zone"><option value="">All zones</option>${zones().map(z => html`<option value="${z.id}" ${z.id === state.zone ? 'selected' : ''}>Zone ${z.code} · ${z.name}</option>`)}</select>
      <select id="status" title="Status"><option value="">All statuses</option>${ENQ_STATUSES.map(s => html`<option ${s === state.status ? 'selected' : ''}>${s}</option>`)}</select>
      <select id="priority" title="Priority"><option value="">All priorities</option>${vsOptions('PRIORITY').map(o => html`<option value="${o.value}" ${o.value === state.priority ? 'selected' : ''}>${o.label}</option>`)}</select>
      <select id="period" title="Date"><option value="">Any date</option><option value="today">Today</option><option value="d7">Last 7 days</option><option value="d30">Last 30 days</option></select>
      <button class="btn link" id="clear">Clear</button>
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th class="screen" title="Screen only, not a register column">Status</th><th class="screen" title="Screen only, from the site">Zone</th>
      ${REGISTER_COLUMNS.map(c => html`<th>${c}</th>`)}
    </tr></thead><tbody id="rows"></tbody></table></div>
    <div class="list-foot"><span id="count"></span><span>Shaded columns are screen helpers; the export has exactly the 26 register columns.</span></div>
  </div>`);
  $('#period', el).value = state.period || '';

  const all = () => store.list('enquiries').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  let shown = [];

  function paint() {
    const list = all();
    const tileList = enquiryTiles(list, company);
    $('#tiles', el).innerHTML = String(tiles(tileList, state.tile));
    const tile = tileList.find(t => t.key === state.tile);
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    shown = list.filter(e => (!tile || tile.test(e))
      && (!state.type || e.type === state.type) && (!state.zone || e.zoneId === state.zone)
      && (!state.status || e.status === state.status) && (!state.priority || e.priority === state.priority)
      && periodTest(state.period, e.receivedAt)
      && terms.every(t => [e.no, e.customerName, e.contactName, e.mobile, e.email, e.siteName, e.description, e.remarks].join(' ').toLowerCase().includes(t)));
    $('#rows', el).innerHTML = String(shown.length ? html`${shown.map(e => {
      const r = registerRow(e);
      return html`<tr class="click" data-id="${e.id}"><td>${pill(e.status)}</td><td><span class="zone-chip">${zoneCode(e.zoneId)}</span></td>
        ${r.map((v, i) => i === 11 || i === 14 ? html`<td class="clip" title="${v}">${v}</td>` : html`<td class="${i === 0 ? 'lnk' : ''}">${v}</td>`)}</tr>`;
    })}` : emptyRow(REGISTER_COLUMNS.length + 2, list.length ? 'No enquiries match the search and filters.' : 'No enquiries yet.'));
    $('#count', el).textContent = `${shown.length} of ${list.length} enquiries${tile ? ` · filtered by "${tile.label}"` : ''}`;
    saveState(state);
  }

  on(el, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => go(`enquiries/${tr.dataset.id}`));
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  ['type', 'zone', 'status', 'priority', 'period'].forEach(k => $(`#${k}`, el).addEventListener('change', e => { state[k] = e.target.value; paint(); }));
  $('#clear', el).onclick = () => {
    Object.assign(state, { tile: '', q: '', type: '', zone: '', status: '', priority: '', period: '' });
    $$('select', el).forEach(s => { s.value = ''; });
    $('#q', el).value = '';
    paint();
  };
  $('#paste', el)?.addEventListener('click', () => { sessionStorage.setItem('rsmOpenPaste', '1'); go('enquiries/new'); });
  $('#csv', el).onclick = () => exportCsv(shown);
  paint();
}

function exportCsv(rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [REGISTER_COLUMNS.map(cell).join(','), ...rows.map(e => registerRow(e).map(cell).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  a.download = `enquiry-register-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
