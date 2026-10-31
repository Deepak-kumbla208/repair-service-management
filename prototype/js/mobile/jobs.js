// Phone: My jobs (the technician's own site inspections and repair jobs), with search and tiles, and the inspection details.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, go, debounce, tiles, pill, fmtDate, fmtTime, toast } from '../core/ui.js';
import { zoneLabel, findSite, empName } from '../core/lookups.js';
import { isToday } from '../core/enquiries.js';
import { startReport } from '../core/inspections.js';
import { getUrl } from '../core/media.js';
import { seesJob } from '../core/jobs.js';
import { repairCard } from './repair-job.js';

const DONE = 'Report submitted';

// My work: site inspections and scheduled repair jobs assigned to me, by visit time.
export function myWork() {
  const insp = store.list('inspections', i => i.status !== 'Cancelled' && auth.seesInspection(i) && i.technicianId)
    .map(i => ({ i, e: store.get('enquiries', i.enquiryId), r: i.reportId ? store.get('siteReports', i.reportId) : null }))
    .filter(x => x.e)
    .map(x => ({ at: x.i.visitAt, done: x.i.status === DONE, text: [x.e.no, x.e.customerName, x.e.siteName, x.r?.no, 'site inspection'], card: () => jobCard(x) }));
  const jobs = !auth.can('job', 'view', 'mobile') ? [] : store.list('jobs', j => seesJob(j) && j.technicianId && j.start && j.status !== 'Cancelled')
    .map(j => ({ at: j.start, done: !!j.steps?.checkOutAt || ['Completed & documented', 'Closed'].includes(j.status), text: [j.no, j.customer, j.site, j.quotationNo, 'repair job'], card: () => repairCard(j) }));
  return [...insp, ...jobs].sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}

function when(iso) {
  if (!iso) return 'Visit not set';
  const d = new Date(iso), t = new Date();
  const tomorrow = new Date(t); tomorrow.setDate(t.getDate() + 1);
  const day = isToday(iso) ? 'Today' : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : fmtDate(iso);
  return `${day} ${fmtTime(iso)}`;
}

export function jobCard(x) {
  const done = x.i.status === DONE;
  const action = done ? 'View report' : x.r ? 'Continue report' : 'Start report';
  return html`<div class="job-card" style="${done ? 'opacity:.65;box-shadow:none' : ''}">
    <div class="row"><span class="pill amber">Site inspection</span><span class="grow"></span><b>${when(x.i.visitAt)}</b></div>
    <div class="strong" style="margin-top:6px">${x.e.customerName}</div>
    <div class="muted">${x.e.siteName} · Zone ${zoneLabel(x.e.zoneId)}</div>
    <div class="muted">${x.e.no} · ${x.e.contactName} · ${x.e.mobile}</div>
    <div class="row" style="margin-top:4px">${pill(x.i.status)}${x.r ? html`<span class="small muted">${x.r.no}</span>` : ''}</div>
    <div class="actions">${x.e.mobile ? html`<a class="btn" href="tel:${x.e.mobile.replace(/\s/g, '')}">☎ Call</a>` : ''}
      <a class="btn" href="#/m/job/${x.i.id}">Details</a>
      <button class="btn primary" data-start="${x.i.id}" style="flex:2">${action}</button></div>
  </div>`;
}

// Start or continue the report for a job; done reports open on the summary.
export function openReport(inspId) {
  const i = store.get('inspections', inspId);
  if (!i.technicianId) { toast('A technician must be assigned first', 'bad'); return; }
  const rep = startReport(inspId);
  go(`m/report/${rep.id}/${rep.status === 'Submitted' ? 7 : 1}`);
}

const KEY = 'rsmMobJobs';
export function mJobs(page) {
  page.setTitle('My jobs');
  const state = { tile: 'today', q: '', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') };
  page.body.innerHTML = String(html`<input type="search" class="m-search" id="q" placeholder="Search my jobs: customer, site, enquiry no" value="${state.q}"><div id="tiles"></div><div id="list"></div>`);
  function paint() {
    const all = myWork();
    const defs = [
      { key: 'today', label: 'Today', test: x => isToday(x.at) && !x.done },
      { key: 'upcoming', label: 'Upcoming', test: x => !x.done && !isToday(x.at) },
      { key: 'done', label: 'Done', test: x => x.done },
    ].map(d => ({ ...d, count: all.filter(d.test).length }));
    $('#tiles', page.body).innerHTML = String(tiles(defs, state.tile, 'm-tiles'));
    const tile = defs.find(d => d.key === state.tile);
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(x => (!tile || tile.test(x)) && terms.every(t => x.text.join(' ').toLowerCase().includes(t)));
    $('#list', page.body).innerHTML = String(shown.length ? html`${shown.map(x => x.card())}` : html`<div class="empty">${all.length ? 'No jobs here. Try another tile.' : 'No jobs assigned to you yet.'}</div>`);
    sessionStorage.setItem(KEY, JSON.stringify(state));
  }
  on(page.body, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  on(page.body, 'click', '[data-start]', (e, b) => openReport(b.dataset.start));
  $('#q', page.body).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}

export function mJob(page, id) {
  const i = store.get('inspections', id);
  page.setTitle('Site inspection', 'm/jobs');
  if (!i || !auth.seesInspection(i)) { page.body.innerHTML = '<div class="empty">Job not found.</div>'; return; }
  const e = store.get('enquiries', i.enquiryId);
  const r = i.reportId ? store.get('siteReports', i.reportId) : null;
  const { site } = findSite(e.siteId);
  const canWork = auth.can('inspection', 'edit', 'mobile') && i.technicianId;
  page.body.innerHTML = String(html`
    <div class="row"><span class="pill amber">Site inspection</span>${pill(i.status)}<span class="grow"></span><b>${when(i.visitAt)}</b></div>
    <h2 style="margin:8px 0 2px">${e.customerName}</h2><div class="muted">${e.no} · ${e.siteName}</div>
    <div class="m-card" style="margin-top:10px"><div class="k muted small">Address</div>${site?.address || e.siteName} ${site?.blockUnit || ''}<br>
      <span class="pill blue" style="margin-top:4px">Zone ${zoneLabel(e.zoneId)}</span>${site?.access ? html`<div class="small" style="margin-top:4px">Access: ${site.access}</div>` : ''}</div>
    <div class="m-card"><div class="k muted small">Contact</div>${e.contactName}<br>${e.mobile ? html`<a href="tel:${e.mobile.replace(/\s/g, '')}">☎ ${e.mobile}</a>` : ''} ${e.email}</div>
    <div class="m-card"><div class="k muted small">What the customer said</div>${e.description}</div>
    <div class="m-card"><div class="k muted small">Visit confirmed with the customer</div>${when(i.visitAt)} · by ${i.confirmedBy || '—'} · technician ${empName(i.technicianId)}${i.notes ? html`<br><span class="small">${i.notes}</span>` : ''}</div>
    <div class="m-section">Shutters at this site</div>
    ${site?.shutters?.length ? html`${site.shutters.map(s => html`<div class="m-card small"><b>${s.tag}</b> ${s.location} · size ${s.sizeCode}${s.motor ? ` · motor ${s.motor}` : ''}</div>`)}` : html`<div class="muted small">None recorded yet. Add them in the report.</div>`}
    ${(e.attachments || []).length ? html`<div class="m-section">Attachments</div>${e.attachments.map(a => html`<div class="m-card small">📎 <a href="#" data-open="${a.id}">${a.name}</a></div>`)}` : ''}
  `);
  if (canWork) page.setFoot(html`<button class="btn primary" id="go">${r?.status === 'Submitted' ? `View ${r.no}` : r ? `Continue ${r.no}` : 'Start site viewing report'}</button>`).querySelector('#go').onclick = () => openReport(i.id);
  page.body.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', async ev => { ev.preventDefault(); const u = await getUrl(a.dataset.open); if (u) window.open(u, '_blank'); }));
}
