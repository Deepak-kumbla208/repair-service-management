// Site Inspection (web): the list with tiles and search, assigning a technician by zone with a visit time
// confirmed with the customer, the countdown against the 1–2 hour target, and the returned report.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, on, go, debounce, field, readForm, markInvalid, toast, fmtDateTime, fmtDuration, pill, tiles, emptyRow, dateInput, joinDateTime, foldHeader } from '../core/ui.js';
import { linesTable } from './enquiry-parts.js';
import { zones, zoneLabel, zoneCode, empName, technicians, findSite } from '../core/lookups.js';
import { inspectionClock, isToday } from '../core/enquiries.js';
import { techniciansFor, assignTechnician, startReport } from '../core/inspections.js';
import { pageHead } from './shell.js';

// Countdown text + bar for the "within 2 hours of the call" target.
export function clockHtml(c) {
  if (!c) return '';
  const h = Math.round(c.target / 3600000);
  if (c.done) return html`<span class="cd ${c.state}">Done in ${fmtDuration(c.took)} · ${c.state === 'ok' ? 'within' : 'over'} the ${h} h target</span>`;
  const pct = Math.min(100, (c.elapsed / c.target) * 100);
  const colour = { ok: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)' }[c.state];
  return html`<span class="cd ${c.state}">${fmtDuration(c.elapsed)} since the call · ${c.left > 0 ? `${fmtDuration(c.left)} left` : `over by ${fmtDuration(-c.left)}`}</span>
    <div class="cd-bar"><span style="width:${pct}%;background:${colour}"></span></div>`;
}

const STATUSES = ['To assign', 'Assigned', 'Report in progress', 'Report submitted'];
const KEY = 'rsmInspFilters';
const loadState = () => { try { return { tile: '', q: '', zone: '', tech: '', status: '', ...JSON.parse(sessionStorage.getItem(KEY)) }; } catch { return { tile: '', q: '' }; } };

function rows() {
  return store.list('inspections').filter(i => i.status !== 'Cancelled' && auth.seesInspection(i))
    .map(i => ({ i, e: store.get('enquiries', i.enquiryId), r: i.reportId ? store.get('siteReports', i.reportId) : null }))
    .filter(x => x.e)
    .sort((a, b) => b.e.receivedAt.localeCompare(a.e.receivedAt));
}

export function renderInspectionList(el) {
  const company = auth.company();
  const state = loadState();
  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Transactions › Site Inspection', title: 'Site inspections', sub: `Assign a technician by zone and confirm the visit time. Target: inspection within ${company.inspectionTargetHours || 2} hours of the call.` })}
    <div id="tiles"></div>
    <div class="filters">
      <input type="search" class="search" id="q" placeholder="Search inspections: enquiry no, customer, site, technician, report no" value="${state.q}">
      <select id="zone"><option value="">All zones</option>${zones().map(z => html`<option value="${z.id}" ${z.id === state.zone ? 'selected' : ''}>Zone ${z.code} · ${z.name}</option>`)}</select>
      <select id="tech"><option value="">All technicians</option>${technicians().map(t => html`<option value="${t.id}" ${t.id === state.tech ? 'selected' : ''}>${t.name}</option>`)}</select>
      <select id="status"><option value="">All statuses</option>${STATUSES.map(s => html`<option ${s === state.status ? 'selected' : ''}>${s}</option>`)}</select>
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Enquiry No</th><th>Customer</th><th>Site</th><th>Zone</th><th>Received</th><th>Since the call</th><th>Technician</th><th>Visit (confirmed)</th><th>Status</th><th>Site report</th></tr></thead>
    <tbody id="rows"></tbody></table></div><div class="list-foot"><span id="count"></span></div>
  </div>`);

  function paint() {
    const now = Date.now();
    const all = rows();
    const clock = x => inspectionClock(x.e, company, now);
    const defs = [
      { key: 'assign', label: 'To assign', sub: 'no technician yet', tone: 'warn', test: x => x.i.status === 'To assign' },
      { key: 'today', label: 'Visits today', sub: 'confirmed for today', test: x => isToday(x.i.visitAt) },
      { key: 'over', label: `Over ${company.inspectionTargetHours || 2} h target`, sub: 'report not in yet', tone: 'bad', test: x => { const c = clock(x); return c && !c.done && c.state === 'bad'; } },
      { key: 'progress', label: 'Report in progress', sub: 'technician on site', test: x => x.i.status === 'Report in progress' },
      { key: 'received', label: 'Reports received', sub: 'ready for estimation', test: x => x.i.status === 'Report submitted' },
    ].map(d => ({ ...d, count: all.filter(d.test).length }));
    $('#tiles', el).innerHTML = String(tiles(defs, state.tile));
    const tile = defs.find(d => d.key === state.tile);
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(x => (!tile || tile.test(x)) && (!state.zone || x.i.zoneId === state.zone) && (!state.tech || x.i.technicianId === state.tech)
      && (!state.status || x.i.status === state.status)
      && terms.every(t => [x.e.no, x.e.customerName, x.e.siteName, empName(x.i.technicianId), x.r?.no].join(' ').toLowerCase().includes(t)));
    $('#rows', el).innerHTML = String(shown.length ? html`${shown.map(x => html`<tr class="click" data-id="${x.i.id}">
      <td class="lnk">${x.e.no}</td><td>${x.e.customerName}</td><td>${x.e.siteName}</td><td><span class="zone-chip">${zoneCode(x.i.zoneId)}</span></td>
      <td>${fmtDateTime(x.e.receivedAt)}</td><td style="min-width:200px">${clockHtml(clock(x))}</td><td>${empName(x.i.technicianId) || html`<span class="muted">—</span>`}</td>
      <td>${fmtDateTime(x.i.visitAt)}</td><td>${pill(x.i.status)}</td><td>${x.r ? html`${x.r.no} ${pill(x.r.status)}` : ''}</td></tr>`)}`
      : emptyRow(10, all.length ? 'No inspections match the search and filters.' : 'No site inspections yet.'));
    $('#count', el).textContent = `${shown.length} of ${all.length} inspections`;
    sessionStorage.setItem(KEY, JSON.stringify(state));
  }
  on(el, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => go(`inspections/${tr.dataset.id}`));
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  ['zone', 'tech', 'status'].forEach(k => $(`#${k}`, el).addEventListener('change', e => { state[k] = e.target.value; paint(); }));
  paint();
}

function nextHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export function renderInspection(el, id) {
  const i = store.get('inspections', id);
  if (!i || !auth.seesInspection(i)) { el.innerHTML = '<div class="page"><div class="empty">Site inspection not found.</div></div>'; return; }
  const e = store.get('enquiries', i.enquiryId);
  const r = i.reportId ? store.get('siteReports', i.reportId) : null;
  const { site } = findSite(e.siteId);
  const company = auth.company();
  const canAssign = auth.can('inspection', 'edit') && ['To assign', 'Assigned'].includes(i.status);
  const canEditReport = auth.can('inspection', 'edit', 'web');
  const visit = i.visitAt ? new Date(i.visitAt) : nextHour();
  let chosen = i.technicianId;

  const tags = site?.shutters?.length ? html`${site.shutters.map(s => html`<span class="pill" style="margin:0 4px 4px 0">${s.tag} ${s.location} · ${s.sizeCode}</span>`)}` : html`<span class="muted">None recorded yet</span>`;
  const ro = (k, v) => html`<div class="field"><div class="field-label">${k}</div><div class="ro">${v || html`<span class="muted">—</span>`}</div></div>`;
  el.innerHTML = String(html`<div class="page stack" style="max-width:1400px">
    ${pageHead({
      crumb: html`<a href="#/inspections">Site Inspection</a> › ${e.no}`,
      title: html`Site inspection · ${e.customerName} ${pill(i.status)}`,
      sub: `${e.siteName} · Zone ${zoneLabel(i.zoneId)} · received ${fmtDateTime(e.receivedAt)}`,
      actions: html`<div class="row"><a class="btn" href="#/enquiries/${e.id}">Open ${e.no}</a>
        ${r?.status === 'Submitted' ? html`<a class="btn" href="#/reports/${r.id}">View report</a>` : ''}</div>`,
    })}
    ${foldHeader({ id: `ins-${i.id}`, title: 'Enquiry & customer details', summary: [e.no, e.customerName, e.contactName, e.mobile, e.siteName, `Zone ${zoneLabel(i.zoneId)}`].filter(Boolean).join(' · '),
      body: html`<div class="fold-cols form-lines">
        <div><div class="form-sec">Enquiry</div>${ro('Enquiry No', html`<a href="#/enquiries/${e.id}">${e.no}</a>`)}${ro('Received', fmtDateTime(e.receivedAt))}</div>
        <div><div class="form-sec">Customer</div>${ro('Customer', e.customerName)}${ro('Contact Person', e.contactName)}${ro('Mobile', e.mobile)}</div>
        <div><div class="form-sec">Site</div>${ro('Site', `${site?.address || e.siteName} ${site?.blockUnit || ''}`)}${ro('Zone', zoneLabel(i.zoneId))}${ro('Customer products', tags)}</div>
      </div>` })}
    <div class="card"><div class="card-head"><h2>What the customer reported</h2></div>${linesTable(e.lines)}</div>
    <div class="card"><div class="field-label">Target: inspection within ${company.inspectionTargetHours || 2} hours of the call</div>${clockHtml(inspectionClock(e, company))}
      <div id="assignCard" style="margin-top:10px"></div></div>
    <div class="card"><div class="card-head"><h2>Site viewing report</h2>${r ? pill(r.status) : ''}</div>
      ${r ? html`<div class="kv six"><div><div class="k">Report No</div>${r.no}</div><div><div class="k">Technician</div>${empName(r.technicianId)}</div>
        <div><div class="k">Time in / out</div>${r.s1.timeIn || '—'} / ${r.s1.timeOut || '—'}</div><div><div class="k">Products</div>${r.shutters.length}</div>
        <div><div class="k">Photos</div>${r.photos.length}</div><div><div class="k">${r.paper ? 'Received (paper)' : 'Submitted'}</div>${fmtDateTime(r.submittedAt) || '—'}</div></div>
        <div class="row" style="margin-top:10px"><a class="btn primary" href="#/reports/${r.id}">${canEditReport ? 'Open the report' : 'View report'}</a>
          ${auth.can('inspection', 'print') ? html`<a class="btn" href="#/reports/${r.id}/print">⎙ Print preview</a>` : ''}</div>`
      : i.technicianId && canEditReport
        ? html`<p class="muted">Opens pre-filled from ${e.no} and its product lines. The office can edit and print it now (for example for a paper visit); the technician continues the same report on the phone.</p>
          <button class="btn primary" id="startReport">Open the site viewing report</button>`
        : html`<p class="muted">${i.technicianId ? 'The technician fills in the report on the phone (My jobs).' : 'Assign a technician first; the report then opens pre-filled.'}</p>`}
    </div>
  </div>`);

  $('#startReport', el)?.addEventListener('click', () => go(`reports/${startReport(i.id, { fromOffice: true }).id}`));

  function paintAssign() {
    const box = $('#assignCard', el);
    if (!canAssign) {
      box.innerHTML = String(html`<div class="card-head"><h2>Technician</h2></div><div class="kv two"><div><div class="k">Technician</div>${empName(i.technicianId) || '—'}</div>
        <div><div class="k">Visit (confirmed)</div>${fmtDateTime(i.visitAt) || '—'}</div><div><div class="k">Confirmed by</div>${i.confirmedBy || '—'}</div><div><div class="k">Notes</div>${i.notes || '—'}</div></div>`);
      return;
    }
    const keep = (n, d) => $(`[name="${n}"]`, box)?.value ?? d;
    const date = keep('visitDate', dateInput(visit)), time = keep('visitTime', `${String(visit.getHours()).padStart(2, '0')}:${String(visit.getMinutes()).padStart(2, '0')}`);
    const list = techniciansFor(i.zoneId, joinDateTime(date, time));
    const card = x => html`<label class="shutter ${chosen === x.tech.id ? 'on' : ''}"><input type="radio" name="tech" value="${x.tech.id}" ${chosen === x.tech.id ? 'checked' : ''}>
      <span class="grow"><b>${x.tech.name}</b> <span class="muted small">${x.tech.code}</span><br><span class="small muted">Main zone ${zoneLabel(x.tech.mainZoneId)}${(x.tech.extraZoneIds || []).length ? ` · also ${x.tech.extraZoneIds.map(zoneCode).join(', ')}` : ''}${x.tech.skills ? ` · ${x.tech.skills}` : ''}</span></span>
      <span class="small ${x.visits ? '' : 'muted'}">${x.visits} visit(s) that day</span></label>`;
    const inZone = list.filter(x => x.match), others = list.filter(x => !x.match);
    box.innerHTML = String(html`<div class="card-head"><h2>${i.technicianId ? 'Change technician' : 'Assign technician'}</h2><span class="pill blue">Zone ${zoneLabel(i.zoneId)}</span></div>
      <div class="form-lines fcols">
        ${field({ name: 'visitDate', label: 'Visit date', type: 'date', value: date, required: true })}
        ${field({ name: 'visitTime', label: 'Visit time', type: 'time', value: time, required: true })}
        ${field({ name: 'confirmedBy', label: 'Confirmed with customer by', type: 'select', options: ['Call', 'WhatsApp', 'Email', 'SMS'], value: i.confirmedBy || 'Call', required: true })}
      </div>
      <div class="m-section">Technicians for zone ${zoneCode(i.zoneId)}</div>
      ${inZone.length ? html`${inZone.map(card)}` : html`<div class="muted small">No technician covers this zone.</div>`}
      ${others.length ? html`<div class="m-section">Other technicians</div>${others.map(card)}` : ''}
      <div style="margin-top:8px">${field({ name: 'notes', label: 'Notes', value: keep('notes', i.notes || '') })}</div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="saveAssign">Save assignment</button></div>`);
    $$('[name="visitDate"], [name="visitTime"]', box).forEach(x => x.addEventListener('change', paintAssign));
    $$('[name="tech"]', box).forEach(x => x.addEventListener('change', () => { chosen = x.value; paintAssign(); }));
    $('#saveAssign', box).onclick = () => {
      const d = readForm(box);
      if (!markInvalid(box, ['visitDate', 'visitTime', 'confirmedBy'].filter(n => !d[n]))) return;
      if (!chosen) { toast('Choose a technician', 'bad'); return; }
      const visitAt = joinDateTime(d.visitDate, d.visitTime);
      assignTechnician(i.id, { technicianId: chosen, visitAt, confirmedBy: d.confirmedBy, notes: d.notes });
      toast(`${empName(chosen)} assigned · visit ${fmtDateTime(visitAt)}`);
      renderInspection(el, id);
    };
  }
  paintAssign();
}
