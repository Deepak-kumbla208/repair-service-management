// Phone: My jobs (the technician's own job assessments, repair jobs, General Servicing jobs and maintenance visits)
// by state, "Now", "Next" and "Done", with search; the one card used for every kind of work; and the site
// assessment's page. A card opens its job when tapped; its button either does what it says or is called "Open".
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, go, debounce, pill, fmtDate, fmtTime, toast, icon, holdTap } from '../core/ui.js';
import { zoneLabel, findSite, empName, productName } from '../core/lookups.js';
import { sizeText } from '../core/products.js';
import { isToday, cleanLines, inspectionClock } from '../core/enquiries.js';
import { startReport, reportDraft } from '../core/inspections.js';
import { svrSheetHtml } from '../web/print-svr.js';
import { openDocSheet, undoToast, show } from './shell.js';
import { getUrl } from '../core/media.js';
import { seesJob } from '../core/jobs.js';
import { startTravel, undoTravel } from '../core/visits.js';
import { isNewWork, markSeen, newMark, whenText, targetText, visitWord, callBtn, directionsBtn, lastStepKey } from './parts.js';

const DONE = 'Report submitted';
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
// Work to do today: under way, planned for today or earlier, or waiting with no visit time yet.
const dueNow = (stage, at) => stage === 'now' || (stage === 'next' && (!at || new Date(at) <= endOfToday()));

// The products the customer named, e.g. "2 × Rolling shutter, 1 × Lock set".
export const productsText = e => cleanLines(e.lines).filter(l => l.itemRef).map(l => `${l.qty} × ${l.itemName}`).join(', ');

// My work: job assessments, scheduled jobs and maintenance visits assigned to me, each with its state:
// 'now' (on the way, on site, report in progress, waiting to leave), 'next' (assigned or scheduled, not started), 'done'.
export function myWork() {
  const me = auth.user()?.employeeId;
  const insp = store.list('inspections', i => i.status !== 'Cancelled' && auth.seesInspection(i) && i.technicianId)
    .map(i => ({ i, e: store.get('enquiries', i.enquiryId), r: i.reportId ? store.get('siteReports', i.reportId) : null }))
    .filter(x => x.e)
    .map(({ i, e, r }) => {
      const stage = i.status === DONE ? 'done' : i.status === 'Report in progress' ? 'now' : 'next';
      return { id: i.id, coll: 'inspections', route: `m/job/${i.id}`, at: i.visitAt, stage, type: ['Job assessment', 'amber'], customer: e.customerName, site: e.siteName, zoneId: e.zoneId,
        ref: e.no, extra: productsText(e), status: i.status, phone: e.mobile, isNew: stage === 'next' && isNewWork(i.id, i.visitAt, i.assignedAt),
        target: stage !== 'done' && !i.visitAt ? targetText(inspectionClock(e, auth.company())) : '', view: stage === 'done' && r ? `m/report/${r.id}/view` : '',
        text: [e.no, e.customerName, e.siteName, r?.no, 'job assessment'] };
    });
  const service = (coll, d, kind) => {
    const done = !!d.steps?.checkOutAt || ['Completed & documented', 'Closed', 'Checked & filed'].includes(d.status);
    const stage = done ? 'done' : d.status === 'Scheduled' ? 'next' : 'now';
    return { id: d.id, coll, route: `m/${kind}/${d.id}`, at: d.start, stage, customer: d.customer, site: d.site, zoneId: d.zoneId, status: d.status, phone: d.phone,
      isNew: stage === 'next' && isNewWork(d.id, d.start), canStart: d.status === 'Scheduled' && d.technicianId === me && auth.can(coll === 'jobs' ? 'job' : 'amcExecution', 'edit', 'mobile') };
  };
  const jobs = !auth.can('job', 'view', 'mobile') ? [] : store.list('jobs', j => seesJob(j) && j.technicianId && j.start && j.status !== 'Cancelled')
    .map(j => ({ ...service('jobs', j, j.type === 'GS' ? 'gjob' : 'rjob'), type: j.type === 'GS' ? ['General servicing', 'purple'] : ['Repair job', 'blue'], ref: j.no,
      extra: [j.type === 'GS' ? `${(j.shutters || []).length} products` : (j.tags || []).join(', '), j.contact].filter(Boolean).join(' · '),
      text: [j.no, j.customer, j.site, j.quotationNo, j.type === 'GS' ? 'general servicing' : 'repair job'] }));
  const visits = !auth.can('amcExecution', 'view', 'mobile') ? [] : store.list('amcVisits', v => v.technicianId && v.technicianId === me && v.start && v.status !== 'Cancelled')
    .map(v => ({ ...service('amcVisits', v, 'visit'), type: [`${visitWord()} ${v.n} of ${v.of}`, 'green'], ref: v.contractNo, days: v.days,
      extra: [`${(v.shutters || []).length} products`, v.contact].filter(Boolean).join(' · '), text: [v.contractNo, v.customer, v.site, v.reportNo, 'amc maintenance visit'] }));
  return [...insp, ...jobs, ...visits].map(x => ({ ...x, done: x.stage === 'done', due: dueNow(x.stage, x.at), card: () => workCard(x) }))
    .sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}

// One card for every kind of work. The customer's name is the link that opens the job, stretched over the whole card;
// the button is "On my way" only for work planned for today (it really sets the status), otherwise "Open".
export function workCard(x) {
  const startNow = x.canStart && isToday(x.at);
  return html`<div class="job-card ${x.isNew ? 'is-new' : ''} ${x.done ? 'done' : ''}" data-card="${x.id}">
    <div class="row top"><span class="row wrap grow"><span class="pill ${x.type[1]}">${x.type[0]}</span>${x.isNew ? newMark() : ''}</span><span class="when">${whenText(x.at)}</span></div>
    <div class="strong" style="margin-top:6px"><a class="card-link" href="#/${x.route}">${x.customer}</a></div>
    <div class="muted">${x.site}${x.zoneId ? ` · Zone ${zoneLabel(x.zoneId)}` : ''}</div>
    <div class="muted">${[x.ref, x.extra].filter(Boolean).join(' · ')}</div>
    <div class="row wrap" style="margin-top:6px">${pill(x.status)}${x.days > 1 ? html`<span class="small muted">${x.days} days</span>` : ''}${x.target ? html`<span class="small strong">${x.target}</span>` : ''}</div>
    <div class="actions">${callBtn(x.phone)}
      ${x.view ? html`<a class="btn primary" href="#/${x.view}" style="flex:2">${icon('eye', 18)} View report</a>`
        : startNow ? html`<button type="button" class="btn primary" data-omw="${x.coll}|${x.id}" style="flex:2">On my way</button>`
          : html`<a class="btn ${x.done ? '' : 'primary'}" href="#/${x.route}" style="flex:2">Open</a>`}</div>
  </div>`;
}
// "On my way" on a card: the status is set here, with Undo; the card is drawn again and its buttons rest a moment.
export function bindCards(root, repaint) {
  on(root, 'click', '[data-omw]', (e, b) => {
    e.preventDefault();
    if (!holdTap(b)) return;
    const [coll, id] = b.dataset.omw.split('|');
    startTravel(coll, id);
    const rest = () => root.querySelectorAll(`[data-card="${id}"] .actions .btn`).forEach(x => holdTap(x));
    repaint(); rest();
    undoToast('On the way · the office can see it', () => { undoTravel(coll, id); if (root.isConnected) { repaint(); rest(); } else show(location.hash.replace(/^#\/?/, '')); });
  });
}

// Start or continue the report for a job, on the first step that needs the technician (step 1 is filled in from the
// enquiry); a report under way opens where it was left; a submitted one opens on the summary.
export function openReport(inspId) {
  const i = store.get('inspections', inspId);
  if (!i.technicianId) { toast('A technician must be assigned first', 'bad'); return; }
  const rep = startReport(inspId);
  const s1 = rep.s1 || {};
  const first = s1.customer && s1.site && s1.viewedBy && s1.viewDate ? 2 : 1;
  go(`m/report/${rep.id}/${rep.status === 'Submitted' ? 7 : Number(sessionStorage.getItem(lastStepKey(rep.id))) || first}`);
}

// The tab and search last used on My jobs, kept per user while the app is open.
export const jobsKey = () => `rsmMobJobs.${auth.user()?.id || ''}`;
const TABS = [['now', 'Now', 'Nothing under way. Work you have started shows here.'], ['next', 'Next', 'Nothing waiting. New jobs appear here when the office assigns them.'], ['done', 'Done', 'Nothing finished yet.']];
export function mJobs(page) {
  page.setTitle('My jobs');
  const state = { tab: '', q: '', ...JSON.parse(sessionStorage.getItem(jobsKey()) || '{}') };
  let first = true;
  page.body.innerHTML = String(html`<input type="search" class="m-search" id="q" aria-label="Search my jobs" placeholder="Search: customer, site, number" value="${state.q}">
    <div class="m-tabs3" id="tabs" role="tablist" aria-label="My jobs by state"></div><div id="list" role="tabpanel"></div>`);
  function paint() {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = myWork().filter(x => terms.every(t => x.text.join(' ').toLowerCase().includes(t)));
    const of = k => all.filter(x => x.stage === k);
    // One tab is always selected: the one kept, else "Now" when something is under way, else "Next".
    if (!TABS.some(([k]) => k === state.tab) || (first && state.tab !== 'done' && !of(state.tab).length)) state.tab = of('now').length ? 'now' : 'next';
    first = false;
    if (terms.length && !of(state.tab).length) state.tab = TABS.find(([k]) => of(k).length)?.[0] || state.tab;
    $('#tabs', page.body).innerHTML = String(html`${TABS.map(([k, label]) => html`<button type="button" role="tab" data-tab="${k}" aria-selected="${k === state.tab ? 'true' : 'false'}"><b>${of(k).length}</b>${label}</button>`)}`);
    const shown = state.tab === 'done' ? of('done').reverse() : of(state.tab).sort((a, b) => Number(b.isNew) - Number(a.isNew));
    $('#list', page.body).innerHTML = String(shown.length ? html`${shown.map(x => x.card())}` : html`<div class="empty">${terms.length ? 'No job matches the search.' : TABS.find(([k]) => k === state.tab)[2]}</div>`);
    sessionStorage.setItem(jobsKey(), JSON.stringify(state));
  }
  on(page.body, 'click', '[data-tab]', (e, b) => { state.tab = b.dataset.tab; paint(); });
  $('#q', page.body).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  bindCards(page.body, paint);
  paint();
}

// The steps of a job assessment on the phone, the current one highlighted:
// preview the form → start → fill in → the customer signs → submit → view the report.
function inspectionSteps(r) {
  const started = !!r, submitted = r?.status === 'Submitted';
  const signed = !!r && (!!r.s7.custSignatureId || !!r.s7.custAbsent);
  const state = (done, now) => (done ? 'done' : now ? 'now' : '');
  return [
    ['Preview the form', 'Filled in from the enquiry · if you wish', state(started, !started)],
    ['Start assessment', started ? `Time In ${r.s1.timeIn || '—'}` : 'Opens the report and sets Time In', state(started, false)],
    ['Fill in the report', 'What you found, photos and materials', state(submitted, started && !submitted)],
    ['Customer signs', 'After seeing the preview', state(submitted || signed, false)],
    ['Submit', 'The office sees it at once', state(submitted, false)],
    ['View the report', 'Any time after', state(false, submitted)],
  ];
}

export function mJob(page, id) {
  const i = store.get('inspections', id);
  page.setTitle('Job assessment', 'm/jobs');
  if (!i || !auth.seesInspection(i)) { page.body.innerHTML = '<div class="empty">Job not found.</div>'; return; }
  const e = store.get('enquiries', i.enquiryId);
  const r = i.reportId ? store.get('siteReports', i.reportId) : null;
  const { site } = findSite(e.siteId);
  const canWork = auth.can('inspection', 'edit', 'mobile') && i.technicianId;
  const submitted = r?.status === 'Submitted';
  const address = [site?.address || e.siteName, site?.blockUnit].filter(Boolean).join(' ');
  page.setTitle([e.customerName, e.siteName].filter(Boolean).join(' · '), 'm/jobs', `${e.no} · Job assessment`);
  if (i.technicianId === auth.user()?.employeeId) markSeen(i.id, i.visitAt);
  const target = !submitted && !i.visitAt ? targetText(inspectionClock(e, auth.company())) : '';
  page.body.innerHTML = String(html`
    ${submitted ? html`<div class="m-ok">✓<b>Report submitted</b>${r.no} · ${fmtDate(r.submittedAt)} ${fmtTime(r.submittedAt)} · the office can see it now</div>` : ''}
    <div class="m-card">
      <div class="row top"><span class="row wrap grow"><span class="pill amber">Job assessment</span>${pill(i.status)}</span><b>${whenText(i.visitAt)}</b></div>
      ${target ? html`<div class="strong" style="margin-top:6px">${target}</div>` : ''}
      <div style="margin-top:8px">${address}${site?.access ? html`<br><span class="small">Access: ${site.access}</span>` : ''}</div>
      <div class="muted small">Zone ${zoneLabel(e.zoneId)} · ${[e.contactName, e.mobile].filter(Boolean).join(' ')}</div>
      <div class="m-acts">${callBtn(e.mobile)}${directionsBtn(address)}</div>
    </div>
    <div class="m-section">Steps</div>
    <div class="m-card"><ol class="m-steps">${inspectionSteps(r).map(([t, sub, st], n) => html`<li class="${st}"><span class="n">${st === 'done' ? '✓' : n + 1}</span><div><b>${t}</b><span class="s">${sub}</span></div></li>`)}</ol></div>
    <div class="m-section">What the customer needs</div>
    ${cleanLines(e.lines).map(l => html`<div class="m-line">${l.itemName ? html`<b>${l.qty} ${l.unit && l.unit !== 'Nos' ? l.unit : '×'} ${l.itemName}</b><br>` : ''}<span class="${l.itemName ? 'small muted' : ''}">${l.description}</span></div>`)}
    <div class="m-section">Visit</div>
    <div class="m-card small">${whenText(i.visitAt)} · confirmed by ${i.confirmedBy || '—'} · ${empName(i.technicianId)}${i.notes ? html`<br>${i.notes}` : ''}</div>
    <div class="m-section">Customer products at this site</div>
    ${site?.shutters?.length ? html`${site.shutters.map(s => html`<div class="m-card small"><b>${s.tag}</b> ${s.location} · ${productName(s.productId)}${s.sizeCode ? ` · ${sizeText(s)}` : ''}${s.motor ? ` · ${s.motor}` : ''}</div>`)}` : html`<div class="muted small">None recorded yet; the report adds them from Job scope.</div>`}
    ${(e.attachments || []).length ? html`<div class="m-section">Attachments</div>${e.attachments.map(a => html`<div class="m-card small"><a class="btn link" href="#" data-open="${a.id}">${a.name}</a></div>`)}` : ''}
  `);
  // Preview: the saved report, or before the start the pre-filled form built in memory (nothing saved, no Time In).
  const preview = () => openDocSheet(r ? `Preview · ${r.no}` : 'Preview · Site Viewing Report',
    svrSheetHtml(r || { no: 'given when you start', ...reportDraft(i.id) }, auth.company()),
    { actions: [{ label: 'Close' }, ...(canWork && !submitted ? [{ label: r ? 'Continue report' : 'Start assessment', kind: 'primary', onClick: () => openReport(i.id) }] : [])] });
  if (submitted) page.setFoot(html`<a class="btn" href="#/m/jobs">My jobs</a><a class="btn primary" href="#/m/report/${r.id}/view">${icon('eye', 18)} View report</a>`);
  else if (canWork) {
    const foot = page.setFoot(html`<button class="btn" id="pv">${icon('eye', 18)} Preview</button><button class="btn primary" id="go">${r ? 'Continue the report' : html`${icon('play', 16)} Start assessment`}</button>`);
    $('#pv', foot).onclick = preview;
    $('#go', foot).onclick = () => openReport(i.id);
  }
  page.body.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', async ev => { ev.preventDefault(); const u = await getUrl(a.dataset.open); if (u) window.open(u, '_blank'); }));
}
