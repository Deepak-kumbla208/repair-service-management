// Phone: the Site Viewing Report in 7 steps (one per section of the team lead's form), saved as you type.
// Step 1 holds section 1, pre-filled from the enquiry; the products are in step 2 (Job scope).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, debounce, field, readForm, openModal, toast, fmtDateTime, pill } from '../core/ui.js';
import { saveReport, submitReport, tidyReport } from '../core/inspections.js';
import { hydrateImages } from '../core/media.js';
import { bindMics } from '../core/capture.js';
import { STEPS_2_TO_7 } from './site-report-steps.js';
import { svrSheetHtml } from '../web/print-svr.js';
import { openDocSheet } from './shell.js';

const S1 = [
  ['customer', 'Company / Customer'], ['site', 'Site / Project'], ['address', 'Full Address'], ['blockUnit', 'Block / Level / Unit'],
  ['viewedBy', 'Viewed By'], ['viewDate', 'Date of Viewing', 'date'], ['contactPerson', 'Contact Person'], ['contactNo', 'Contact No. / Email'],
  ['timeIn', 'Time In', 'time'], ['timeOut', 'Time Out', 'time'],
];

const step1 = {
  title: 'General details',
  render: rep => html`
    <div class="grid g2">${S1.map(([k, label, type]) => field({ name: `s1_${k}`, label, type: type || 'text', value: rep.s1[k], cls: ['address', 'customer'].includes(k) ? 'spanall' : '' }))}
      ${field({ name: 'refNo', label: 'Report / Ref. No.', value: rep.no, readonly: true })}</div>`,
  read(body, rep) {
    const d = readForm(body);
    const s1 = { ...rep.s1 };
    S1.forEach(([k]) => { s1[k] = d[`s1_${k}`] ?? s1[k]; });
    return { s1 };
  },
};

// Shared with the web editor (web/report-view.js), so the phone and the office fill the same report.
export const STEPS = [step1, ...STEPS_2_TO_7];

// The report as it prints, on the phone: after it is submitted (My jobs → Done → View report) and at any time before.
export function mReportView(page, id) {
  const rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  page.setTitle(rep ? rep.no : 'Site viewing report', insp ? `m/job/${insp.id}` : 'm/jobs');
  if (!rep || !auth.seesInspection(insp)) { page.body.innerHTML = '<div class="empty">Report not found.</div>'; return; }
  page.body.innerHTML = String(html`<div class="row" style="margin-bottom:8px">${pill(rep.status)}<span class="small muted grow">${rep.submittedAt ? `${rep.paper ? 'Received on paper' : 'Submitted'} ${fmtDateTime(rep.submittedAt)}` : 'Not submitted yet'}</span>
    <button type="button" class="btn small" id="zoom">Zoom</button></div><div class="m-a4">${svrSheetHtml(rep, auth.company())}</div>`);
  hydrateImages(page.body);
  $('#zoom', page.body).onclick = e => { const a4 = $('.m-a4', page.body); a4.classList.toggle('big'); e.target.textContent = a4.classList.contains('big') ? 'Fit to screen' : 'Zoom'; };
  page.setFoot(html`<a class="btn" href="#/m/jobs">My jobs</a>${insp ? html`<a class="btn primary" href="#/m/job/${insp.id}">Back to the job</a>` : ''}`);
}

export function mReport(page, id, stepStr) {
  let rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  if (!rep || !auth.seesInspection(insp)) { page.setTitle('Site viewing report', 'm/jobs'); page.body.innerHTML = '<div class="empty">Report not found.</div>'; return; }
  page.setTitle(`${rep.no}`, `m/job/${insp.id}`);
  if (rep.status === 'Submitted') return mReportView(page, id);
  if (!auth.can('inspection', 'edit', 'mobile')) { page.body.innerHTML = '<div class="empty">Only the technician fills in the report.</div>'; return; }
  rep = tidyReport(id);

  const n = Math.min(7, Math.max(1, parseInt(stepStr, 10) || 1));
  const step = STEPS[n - 1];
  const ctx = {
    save(patch) { Object.assign(rep, patch); saveReport(rep.id, patch); },
    repaint() { paint(); },
    preview() { openDocSheet(`Preview · ${rep.no}`, svrSheetHtml(rep, auth.company())); },
  };
  const flush = async () => {
    ctx.save(step.read(page.body, rep));
    if (step.leave) ctx.save(await step.leave(page.body, rep));
  };

  function paint() {
    page.body.innerHTML = String(html`
      <div class="m-step-head"><b>${n}. ${step.title}</b><span>${n} of 7</span></div>
      <div class="steps">${STEPS.map((s, i) => html`<a href="#/m/report/${rep.id}/${i + 1}" data-jump="${i + 1}" class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}" title="${i + 1}. ${s.title}"></a>`)}</div>
      <form id="stepForm" onsubmit="return false">${step.render(rep)}</form>`);
    const form = $('#stepForm', page.body);
    step.bind?.(form, rep, ctx);
    bindMics(form);
    hydrateImages(form);
    const autosave = debounce(() => ctx.save(step.read(form, rep)), 400);
    form.addEventListener('input', autosave);
    form.addEventListener('change', () => ctx.save(step.read(form, rep)));
    $$('[data-jump]', page.body).forEach(a => a.addEventListener('click', async e => { e.preventDefault(); await flush(); go(`m/report/${rep.id}/${a.dataset.jump}`); }));
  }
  paint();

  const foot = page.setFoot(html`<button class="btn" id="prev">${n > 1 ? '← Back' : '← Job'}</button>
    ${n < 7 ? html`<button class="btn primary" id="next">Next: ${STEPS[n].title}</button>` : html`<button class="btn primary" id="submit">Submit report</button>`}`);
  $('#prev', foot).onclick = async () => { await flush(); go(n > 1 ? `m/report/${rep.id}/${n - 1}` : `m/job/${insp.id}`); };
  $('#next', foot)?.addEventListener('click', async () => { await flush(); go(`m/report/${rep.id}/${n + 1}`); page.body.scrollTop = 0; });
  $('#submit', foot)?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    await flush();
    const problems = submitReport(rep.id);
    if (problems.length) {
      btn.disabled = false;
      btn.textContent = 'Submit report';
      openModal({ title: 'Not ready to submit', body: html`<ul>${problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] });
      return;
    }
    toast(`${rep.no} submitted · the office can see it now`);
    go(`m/job/${insp.id}`);
  });
}
