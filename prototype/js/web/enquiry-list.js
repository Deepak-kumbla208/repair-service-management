// Enquiries: two views of the same list, with count tiles, a page search and filters.
//   Work view (the default; UX audit, finding 5): where each job stands, what the customer needs, the next step, how
//   long it has waited, its value and who has it. Headings sort the list.
//   Register: the team lead's Enquiry Register, all 26 columns in his order (two screen-only columns, Status and
//   Zone, come first and are shaded). Export CSV always gives exactly the 26 register columns.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, on, go, debounce, fmtDate, fmtTime, fmtDuration, pill, tiles, emptyRow, icon, statusText } from '../core/ui.js';
import { vsLabel, vsOptions, zones, zoneCode, empName } from '../core/lookups.js';
import { laterColumns, inspectionClock, isToday, ENQ_STATUSES } from '../core/enquiries.js';
import { currentStage, stageLabel, stageStatus } from '../core/flow.js';
import { sinceOf } from '../core/notify.js';
import { pageHead } from './shell.js';
import { channelText } from './enquiry-view.js';
import { sortHead, sortRows, nextSort } from './sortable.js';

export const REGISTER_COLUMNS = ['Enquiry No', 'Enquiry Date', 'Enquiry Time', 'Customer Name', 'Contact Person', 'Mobile', 'Email', 'Site Location',
  'Enquiry Status', 'Enquiry Channel', 'Type', 'Enquiry Description', 'Priority', 'Recorded By', 'Remarks', 'Job Assessment',
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

const OPEN_INSPECTION = ['Waiting for assessment', 'Assessment assigned', 'Report in progress'];

// Count tiles shared with the dashboard. Each tile is also a filter.
export function enquiryTiles(list, company) {
  const now = Date.now();
  const target = company.inspectionTargetHours || 2;
  const clock = e => inspectionClock(e, company, now);
  const waiting = list.filter(e => OPEN_INSPECTION.includes(e.status));
  const oldest = waiting.reduce((m, e) => Math.max(m, now - new Date(e.receivedAt).getTime()), 0);
  const defs = [
    { key: 'today', label: 'New today', sub: 'received since 00:00', test: e => isToday(e.receivedAt) },
    { key: 'waiting', label: 'Waiting for assessment', sub: waiting.length ? `oldest ${fmtDuration(oldest)}` : 'none open', tone: 'warn', test: e => OPEN_INSPECTION.includes(e.status) },
    { key: 'over', label: `Over ${target} h target`, sub: 'assessment not done in time', tone: 'bad', test: e => { const c = clock(e); return c && !c.done && c.state === 'bad'; } },
    { key: 'boq', label: 'Reviewing the customer\'s list', sub: 'maintenance and servicing (BOQ)', test: e => e.status === 'BOQ study' },
    { key: 'inspected', label: 'To estimate', sub: 'site report received', test: e => ['Assessed', 'Waiting for estimate'].includes(e.status) },
  ];
  return defs.map(d => ({ ...d, count: list.filter(d.test).length }));
}

const KEY = 'rsmEnqFilters';
const BLANK = { tile: '', q: '', type: '', zone: '', status: '', priority: '', period: '', stage: '' };
const loadState = () => { try { return { ...BLANK, view: 'work', sort: '', dir: 'asc', ...JSON.parse(sessionStorage.getItem(KEY)) }; } catch { return { ...BLANK, view: 'work', sort: '', dir: 'asc' }; } };
const saveState = s => sessionStorage.setItem(KEY, JSON.stringify(s));
export const setEnquiryTile = tile => saveState({ ...loadState(), tile });
// Open the list with only these filters (the dashboard's stage bars and zone figures use it).
export const setEnquiryFilters = f => saveState({ ...loadState(), ...BLANK, ...f });

function periodTest(period, iso) {
  if (!period) return true;
  const days = { today: 0, d7: 7, d30: 30 }[period];
  if (days === 0) return isToday(iso);
  return Date.now() - new Date(iso).getTime() <= days * 86400000;
}

// ---------- Work view: one row = one job, where it stands and what comes next ----------
const STAGE_TONE = { enquiry: '', inspection: 'amber', estimation: 'purple', quotation: 'blue', job: 'blue', amcContract: 'blue', amcVisits: 'blue', invoice: 'amber', payment: 'amber', closure: 'green', contractClosure: 'green' };
function workRow(e) {
  const stage = currentStage(e);
  const insp = e.inspectionId ? store.get('inspections', e.inspectionId) : null;
  const job = store.list('jobs', j => j.enquiryId === e.id && j.status !== 'Cancelled')[0];
  const l = laterColumns(e);
  const closed = ['Closed', 'Cancelled', 'Lost'].includes(e.status);
  return {
    e, since: sinceOf(e), value: l.quotationValue, who: job?.technicianId ? empName(job.technicianId) : insp?.technicianId && !job ? empName(insp.technicianId) : auth.userName(e.recordedBy),
    stageName: e.status === 'Cancelled' ? 'Cancelled' : stage ? stageLabel(stage) : closed ? 'Closed' : 'Done', stageKey: stage?.key || '', tone: e.status === 'Cancelled' ? 'red' : stage ? STAGE_TONE[stage.key] : 'green',
    next: e.status === 'Cancelled' ? '' : stage ? (stageStatus(stage) || stageLabel(stage)) : 'Nothing more to do',
  };
}
const WORK_COLS = [
  ['Enquiry', 'no', r => r.e.no], ['Stage', 'stage', r => r.stageName], ['Customer and site', 'cust', r => `${r.e.customerName} ${r.e.siteName}`], ['What they need', 'need', r => r.e.description],
  ['Next step', 'next', r => r.next], ['Waiting since', 'since', r => r.since], ['Value', 'value', r => (r.value ? Number(String(r.value).replace(/,/g, '')) : ''), 'num'], ['With', 'who', r => r.who],
];

export function renderEnquiryList(el) {
  const company = auth.company();
  const state = loadState();
  const canCreate = auth.can('enquiry', 'create');

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Transactions › Sales Enquiry', title: 'Enquiry register', sub: 'One row per job: where it stands and what comes next. The Register view has the 26 register columns.',
      actions: html`<div class="row">
        <div class="seg" role="group" aria-label="View of the list"><button id="vWork" class="${state.view === 'work' ? 'on' : ''}" aria-pressed="${state.view === 'work'}">Work view</button><button id="vReg" class="${state.view === 'register' ? 'on' : ''}" aria-pressed="${state.view === 'register'}">Register</button></div>
        <button class="btn" id="csv" title="All 26 register columns of the rows shown">⇩ Export CSV</button>
        ${canCreate ? html`<button class="btn" id="paste">${icon('mail', 15)} Paste email</button><a class="btn primary" href="#/enquiries/new">+ New enquiry</a>` : ''}
      </div>` })}
    <div id="tiles"></div>
    <div class="filters">
      <input type="search" class="search" id="q" aria-label="Search enquiries" placeholder="Search enquiries: no, customer, contact, mobile, email, site, description" value="${state.q}">
      <select id="type" aria-label="Type"><option value="">All types</option>${vsOptions('ENQ_TYPE').map(o => html`<option value="${o.value}" ${o.value === state.type ? 'selected' : ''}>${o.label}</option>`)}</select>
      <select id="zone" aria-label="Zone"><option value="">All zones</option>${zones().map(z => html`<option value="${z.id}" ${z.id === state.zone ? 'selected' : ''}>Zone ${z.code} · ${z.name}</option>`)}</select>
      <select id="status" aria-label="Status"><option value="">All statuses</option>${ENQ_STATUSES.map(s => html`<option value="${s}" ${s === state.status ? 'selected' : ''}>${statusText(s)}</option>`)}</select>
      <select id="priority" aria-label="Priority"><option value="">All priorities</option>${vsOptions('PRIORITY').map(o => html`<option value="${o.value}" ${o.value === state.priority ? 'selected' : ''}>${o.label}</option>`)}</select>
      <select id="period" aria-label="Date received"><option value="">Any date</option><option value="today">Today</option><option value="d7">Last 7 days</option><option value="d30">Last 30 days</option></select>
      ${state.stage ? html`<span class="pill blue">Stage: ${state.stage} <button class="btn link small" id="noStage" title="Remove this filter" aria-label="Remove the stage filter">✕</button></span>` : ''}
      <button class="btn link" id="clear">Clear</button>
    </div>
    <div class="tbl-wrap"><table class="tbl ${state.view === 'work' ? 'work' : ''}"><thead id="head"></thead><tbody id="rows"></tbody></table></div>
    <div class="list-foot"><span id="count"></span><span id="footNote"></span></div>
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
      && periodTest(state.period, e.receivedAt) && (!state.stage || (e.stage || 'New') === state.stage)
      && terms.every(t => [e.no, e.customerName, e.contactName, e.mobile, e.email, e.siteName, e.description, e.remarks].join(' ').toLowerCase().includes(t)));
    const none = n => emptyRow(n, list.length ? 'No enquiries match the search and filters.' : 'No enquiries yet.');
    if (state.view === 'work') {
      const col = WORK_COLS.find(c => c[1] === state.sort);
      const rows = sortRows(shown.map(workRow), col?.[2], state.dir);
      shown = rows.map(r => r.e);
      $('#head', el).innerHTML = String(html`<tr>${WORK_COLS.map(([label, key, , cls]) => sortHead(label, key, state, cls || ''))}</tr>`);
      $('#rows', el).innerHTML = String(rows.length ? html`${rows.map(r => html`<tr class="click" data-id="${r.e.id}">
        <td class="nowrap"><a class="rowlink" href="#/enquiries/${r.e.id}">${r.e.no}</a><div class="small muted">${vsLabel('ENQ_TYPE', r.e.type)} · ${fmtDate(r.e.receivedAt)}</div></td>
        <td class="nowrap">${pill(r.stageName, r.tone)}${r.e.priority === 'HIGH' ? html`<div class="small" style="color:var(--red);font-weight:600">High priority</div>` : ''}</td>
        <td><b>${r.e.customerName.replace(/ Pte Ltd| LLC/g, '')}</b><div class="small muted">${r.e.siteName}${r.e.zoneId ? ` · Zone ${zoneCode(r.e.zoneId)}` : ''}</div></td>
        <td title="${r.e.description}"><div class="need">${r.e.description}</div></td>
        <td>${r.next}<div class="small muted">${statusText(r.e.status)}</div></td>
        <td class="nowrap">${r.next === 'Nothing more to do' || !r.since ? html`<span class="muted">–</span>` : `${fmtDuration(Date.now() - new Date(r.since))}`}</td>
        <td class="num">${r.value || html`<span class="muted">–</span>`}</td>
        <td>${r.who}</td></tr>`)}` : none(WORK_COLS.length));
      $('#footNote', el).textContent = 'Click a heading to sort. "Register" shows the 26 register columns; Export CSV always gives those 26.';
    } else {
      const idx = state.sort.startsWith('r') ? Number(state.sort.slice(1)) : -1;
      const rows = sortRows(shown.map(e => ({ e, r: registerRow(e) })), idx >= 0 ? x => (idx <= 2 ? x.e.receivedAt : x.r[idx]) : null, state.dir);
      shown = rows.map(x => x.e);
      $('#head', el).innerHTML = String(html`<tr><th class="screen" title="Screen only, not a register column">Status</th><th class="screen" title="Screen only, from the site">Zone</th>
        ${REGISTER_COLUMNS.map((c, i) => sortHead(c, `r${i}`, state))}</tr>`);
      $('#rows', el).innerHTML = String(rows.length ? html`${rows.map(({ e, r }) => html`<tr class="click" data-id="${e.id}"><td class="nowrap">${pill(e.status)}</td><td><span class="zone-chip">${zoneCode(e.zoneId)}</span></td>
        ${r.map((v, i) => i === 11 || i === 14 ? html`<td class="clip nowrap" title="${v}">${v}</td>` : i === 0 ? html`<td class="nowrap"><a class="rowlink" href="#/enquiries/${e.id}">${v}</a></td>` : html`<td class="nowrap">${v}</td>`)}</tr>`)}` : none(REGISTER_COLUMNS.length + 2));
      $('#footNote', el).textContent = 'Shaded columns are screen helpers; the export has exactly the 26 register columns.';
    }
    $('#count', el).textContent = `${shown.length} of ${list.length} enquiries${tile ? ` · filtered by "${tile.label}"` : ''}`;
    saveState(state);
  }

  on(el, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => { if (!e.target.closest('a')) go(`enquiries/${tr.dataset.id}`); });
  on(el, 'click', 'th[data-sort]', (e, th) => { nextSort(state, th.dataset.sort); paint(); $(`th[data-sort="${th.dataset.sort}"] button`, el)?.focus(); });
  const setView = v => { Object.assign(state, { view: v, sort: '', dir: 'asc' }); saveState(state); renderEnquiryList(el); };
  $('#vWork', el).onclick = () => setView('work');
  $('#vReg', el).onclick = () => setView('register');
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  ['type', 'zone', 'status', 'priority', 'period'].forEach(k => $(`#${k}`, el).addEventListener('change', e => { state[k] = e.target.value; paint(); }));
  $('#noStage', el)?.addEventListener('click', e => { state.stage = ''; e.target.closest('.pill').remove(); paint(); });
  $('#clear', el).onclick = () => {
    Object.assign(state, BLANK);
    $('#noStage', el)?.closest('.pill')?.remove();
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
