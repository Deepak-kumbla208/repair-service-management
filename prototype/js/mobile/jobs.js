// Phone: My jobs (the technician's own site inspections, repair jobs, General Servicing jobs and AMC visits), with search
// and tiles, and the inspection details.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, go, debounce, tiles, pill, fmtDate, fmtTime, toast, icon } from '../core/ui.js';
import { zoneLabel, findSite, empName } from '../core/lookups.js';
import { isToday, cleanLines } from '../core/enquiries.js';
import { startReport, reportDraft } from '../core/inspections.js';
import { svrSheetHtml } from '../web/print-svr.js';
import { openDocSheet } from './shell.js';
import { getUrl } from '../core/media.js';
import { seesJob } from '../core/jobs.js';
import { repairCard } from './repair-job.js';
import { serviceCard } from './service.js';

const DONE = 'Report submitted';

// My work: site inspections, scheduled jobs and AMC visits assigned to me, by visit time.
export function myWork() {
  const insp = store.list('inspections', i => i.status !== 'Cancelled' && auth.seesInspection(i) && i.technicianId)
    .map(i => ({ i, e: store.get('enquiries', i.enquiryId), r: i.reportId ? store.get('siteReports', i.reportId) : null }))
    .filter(x => x.e)
    .map(x => ({ at: x.i.visitAt, done: x.i.status === DONE, text: [x.e.no, x.e.customerName, x.e.siteName, x.r?.no, 'site inspection'], card: () => jobCard(x) }));
  const jobs = !auth.can('job', 'view', 'mobile') ? [] : store.list('jobs', j => seesJob(j) && j.technicianId && j.start && j.status !== 'Cancelled')
    .map(j => ({ at: j.start, done: !!j.steps?.checkOutAt || ['Completed & documented', 'Closed'].includes(j.status), text: [j.no, j.customer, j.site, j.quotationNo, j.type === 'GS' ? 'general servicing' : 'repair job'],
      card: () => (j.type === 'GS' ? serviceCard('gjob', j) : repairCard(j)) }));
  const visits = !auth.can('amcExecution', 'view', 'mobile') ? [] : store.list('amcVisits', v => v.technicianId && v.technicianId === auth.user()?.employeeId && v.start && v.status !== 'Cancelled')
    .map(v => ({ at: v.start, done: !!v.steps?.checkOutAt || v.status === 'Checked & filed', text: [v.contractNo, v.customer, v.site, v.reportNo, 'amc visit'], card: () => serviceCard('visit', v) }));
  return [...insp, ...jobs, ...visits].sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}

function when(iso) {
  if (!iso) return 'Visit not set';
  const d = new Date(iso), t = new Date();
  const tomorrow = new Date(t); tomorrow.setDate(t.getDate() + 1);
  const day = isToday(iso) ? 'Today' : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : fmtDate(iso);
  return `${day} ${fmtTime(iso)}`;
}

// The products the customer named, e.g. "2 × Rolling shutter, 1 × Lock set".
export const productsText = e => cleanLines(e.lines).filter(l => l.itemRef).map(l => `${l.qty} × ${l.itemName}`).join(', ');

export function jobCard(x) {
  const done = x.i.status === DONE;
  const products = productsText(x.e);
  return html`<div class="job-card" style="${done ? 'opacity:.75' : ''}">
    <div class="row"><span class="pill amber">Site inspection</span>${pill(x.i.status)}<span class="grow"></span><b>${when(x.i.visitAt)}</b></div>
    <div class="strong" style="margin-top:6px">${x.e.customerName}</div>
    <div class="muted small">${x.e.siteName} · Zone ${zoneLabel(x.e.zoneId)} · ${x.e.no}</div>
    ${products ? html`<div class="small" style="margin-top:3px">${products}</div>` : ''}
    <div class="m-acts">${x.e.mobile ? html`<a class="btn" href="tel:${x.e.mobile.replace(/\s/g, '')}">${icon('call', 15)} Call</a>` : ''}
      ${done && x.r ? html`<a class="btn primary" href="#/m/report/${x.r.id}/view">${icon('eye', 15)} View report</a>` : html`<a class="btn primary" href="#/m/job/${x.i.id}">Open job</a>`}</div>
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
  $('#q', page.body).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}

// The steps of a site inspection on the phone, the current one highlighted:
// preview the form → start → fill in → the customer signs → submit → view the report.
function inspectionSteps(r) {
  const started = !!r, submitted = r?.status === 'Submitted';
  const signed = !!r && (!!r.s7.custSignatureId || !!r.s7.custAbsent);
  const state = (done, now) => (done ? 'done' : now ? 'now' : '');
  return [
    ['Preview the form', 'Pre-filled from the enquiry · optional', state(started, !started)],
    ['Start inspection', started ? `Time In ${r.s1.timeIn || '—'}` : 'Opens the 7 sections and sets Time In', state(started, false)],
    ['Fill in the report', '7 sections, photos and materials', state(submitted, started && !submitted)],
    ['Customer signs', 'After seeing the preview (section 7)', state(submitted || signed, false)],
    ['Submit', 'The office sees it at once', state(submitted, false)],
    ['View the report', 'Any time after', state(false, submitted)],
  ];
}

export function mJob(page, id) {
  const i = store.get('inspections', id);
  page.setTitle('Site inspection', 'm/jobs');
  if (!i || !auth.seesInspection(i)) { page.body.innerHTML = '<div class="empty">Job not found.</div>'; return; }
  const e = store.get('enquiries', i.enquiryId);
  const r = i.reportId ? store.get('siteReports', i.reportId) : null;
  const { site } = findSite(e.siteId);
  const canWork = auth.can('inspection', 'edit', 'mobile') && i.technicianId;
  const submitted = r?.status === 'Submitted';
  const address = [site?.address || e.siteName, site?.blockUnit].filter(Boolean).join(' ');
  page.body.innerHTML = String(html`
    ${submitted ? html`<div class="m-ok">✓<b>Report submitted</b>${r.no} · ${fmtDate(r.submittedAt)} ${fmtTime(r.submittedAt)} · the office can see it now</div>` : ''}
    <div class="m-card">
      <div class="row"><span class="pill amber">Site inspection</span>${pill(i.status)}<span class="grow"></span><b>${when(i.visitAt)}</b></div>
      <div class="strong" style="margin-top:6px;font-size:16px">${e.customerName}</div>
      <div class="muted small">${e.no} · ${e.siteName} · Zone ${zoneLabel(e.zoneId)}</div>
      <div class="small" style="margin-top:4px">${address}${site?.access ? html`<br>Access: ${site.access}` : ''}</div>
      <div class="m-acts">${e.mobile ? html`<a class="btn" href="tel:${e.mobile.replace(/\s/g, '')}">${icon('call', 15)} ${e.contactName}</a>` : ''}
        <a class="btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" rel="noopener">${icon('pin', 15)} Directions</a></div>
    </div>
    <div class="m-section">Steps</div>
    <div class="m-card"><ol class="m-steps">${inspectionSteps(r).map(([t, sub, st], n) => html`<li class="${st}"><span class="n">${st === 'done' ? '✓' : n + 1}</span><div><b>${t}</b><span class="s">${sub}</span></div></li>`)}</ol></div>
    <div class="m-section">What the customer needs</div>
    ${cleanLines(e.lines).map(l => html`<div class="m-line">${l.itemName ? html`<b>${l.qty} ${l.unit && l.unit !== 'Nos' ? l.unit : '×'} ${l.itemName}</b><br>` : ''}<span class="${l.itemName ? 'small muted' : ''}">${l.description}</span></div>`)}
    <div class="m-section">Visit</div>
    <div class="m-card small">${when(i.visitAt)} · confirmed by ${i.confirmedBy || '—'} · ${empName(i.technicianId)}${i.notes ? html`<br>${i.notes}` : ''}</div>
    <div class="m-section">Customer products at this site</div>
    ${site?.shutters?.length ? html`${site.shutters.map(s => html`<div class="m-card small"><b>${s.tag}</b> ${s.location} · size ${s.sizeCode}${s.motor ? ` · motor ${s.motor}` : ''}</div>`)}` : html`<div class="muted small">None recorded yet; the report adds them from Job scope.</div>`}
    ${(e.attachments || []).length ? html`<div class="m-section">Attachments</div>${e.attachments.map(a => html`<div class="m-card small"><a href="#" data-open="${a.id}">${a.name}</a></div>`)}` : ''}
  `);
  // Preview: the saved report, or before the start the pre-filled form built in memory (nothing saved, no Time In).
  const preview = () => openDocSheet(r ? `Preview · ${r.no}` : 'Preview · Site Viewing Report',
    svrSheetHtml(r || { no: 'given when you start', ...reportDraft(i.id) }, auth.company()),
    { actions: [{ label: 'Close' }, ...(canWork && !submitted ? [{ label: r ? 'Continue report' : 'Start inspection', kind: 'primary', onClick: () => openReport(i.id) }] : [])] });
  if (submitted) page.setFoot(html`<a class="btn" href="#/m/jobs">My jobs</a><a class="btn primary" href="#/m/report/${r.id}/view">${icon('eye', 15)} View report</a>`);
  else if (canWork) {
    const foot = page.setFoot(html`<button class="btn" id="pv">${icon('eye', 15)} ${r ? 'Preview' : 'Preview form'}</button><button class="btn primary" id="go">${r ? `Continue ${r.no}` : html`${icon('play', 14)} Start inspection`}</button>`);
    $('#pv', foot).onclick = preview;
    $('#go', foot).onclick = () => openReport(i.id);
  }
  page.body.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', async ev => { ev.preventDefault(); const u = await getUrl(a.dataset.open); if (u) window.open(u, '_blank'); }));
}
