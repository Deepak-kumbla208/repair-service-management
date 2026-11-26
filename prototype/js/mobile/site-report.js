// Phone: the Site Viewing Report in 7 steps (one per section of the team lead's form), saved as you type.
// Step 1 holds section 1, filled in from the enquiry: the phone shows it as a closed summary with "Edit" and starts
// the report on step 2 (Job scope), where the products are. A step is green in the step bar only when it holds what
// it needs; "Submit" marks what is missing in red and lists it, each line a link to its step and field.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, debounce, field, readForm, toast, fmtDateTime, pill, icon } from '../core/ui.js';
import { saveReport, submitReport, tidyReport, reportIssues } from '../core/inspections.js';
import { hydrateImages } from '../core/media.js';
import { bindMics } from '../core/capture.js';
import { STEPS_2_TO_7 } from './site-report-steps.js';
import { svrSheetHtml } from '../web/print-svr.js';
import { openDocSheet } from './shell.js';
import { stepBar, problemsBox, showAt, setJump, takeJump, lastStepKey } from './parts.js';

const S1 = [
  ['customer', 'Company / Customer'], ['site', 'Site / Project'], ['address', 'Full Address'], ['blockUnit', 'Block / Level / Unit'],
  ['viewedBy', 'Viewed By'], ['viewDate', 'Date of Viewing', 'date'], ['contactPerson', 'Contact Person'], ['contactNo', 'Contact No. / Email'],
  ['timeIn', 'Time In', 'time'], ['timeOut', 'Time Out', 'time'],
];
const dmy = iso => (iso ? iso.split('-').reverse().join('/') : '');

const step1 = {
  title: 'General details', short: 'Details',
  // opt.phone without opt.edit: the closed summary (nothing to type: it comes from the enquiry); "Edit" opens the fields.
  render: (rep, opt = {}) => (opt.phone && !opt.edit ? html`<div class="m-card">
      <div class="row" style="margin-bottom:8px"><b class="grow">Filled in from the enquiry</b><button type="button" class="btn small" id="edit1">${icon('edit', 16)} Edit</button></div>
      <div class="m-sum">${[['Customer', rep.s1.customer], ['Site', rep.s1.site], ['Address', [rep.s1.address, rep.s1.blockUnit].filter(Boolean).join(', ')], ['Contact', [rep.s1.contactPerson, rep.s1.contactNo].filter(Boolean).join(' · ')],
        ['Viewed by', rep.s1.viewedBy], ['Date', dmy(rep.s1.viewDate)], ['Time In / Out', `${rep.s1.timeIn || '—'} / ${rep.s1.timeOut || 'set when you submit'}`], ['Report no.', rep.no]]
        .map(([k, v]) => html`<span class="k">${k}</span><span class="v">${v || '—'}</span>`)}</div></div>
      <p class="m-info">Nothing to do here unless a detail is wrong.</p>`
    : html`<div class="grid g2">${S1.map(([k, label, type]) => field({ name: `s1_${k}`, label, type: type || 'text', value: rep.s1[k], cls: opt.phone || ['address', 'customer'].includes(k) ? 'spanall' : '' }))}
      ${field({ name: 'refNo', label: 'Report / Ref. No.', value: rep.no, readonly: true, cls: opt.phone ? 'spanall' : '' })}</div>`),
  read(body, rep) {
    const d = readForm(body);
    const s1 = { ...rep.s1 };
    S1.forEach(([k]) => { s1[k] = d[`s1_${k}`] ?? s1[k]; });
    return { s1 };
  },
};

// Shared with the web editor (web/report-view.js), so the phone and the office fill the same report.
export const STEPS = [step1, ...STEPS_2_TO_7];

const titleOf = rep => [rep.s1?.customer, rep.s1?.site].filter(Boolean).join(' · ') || 'Site viewing report';

// The report as it prints, on the phone: after it is submitted (My jobs → Done → View report) and at any time before.
export function mReportView(page, id) {
  const rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  page.setTitle(rep ? titleOf(rep) : 'Site viewing report', insp ? `m/job/${insp.id}` : 'm/jobs', rep ? `${rep.no} · Site viewing report` : '');
  if (!rep || !auth.seesInspection(insp)) { page.body.innerHTML = '<div class="empty">Report not found.</div>'; return; }
  page.body.innerHTML = String(html`<div class="row" style="margin-bottom:8px">${pill(rep.status)}<span class="small muted grow">${rep.submittedAt ? `${rep.paper ? 'Received on paper' : 'Submitted'} ${fmtDateTime(rep.submittedAt)}` : 'Not submitted yet'}</span>
    <button type="button" class="btn small" id="zoom">Zoom</button></div><div class="m-a4">${svrSheetHtml(rep, auth.company())}</div>`);
  hydrateImages(page.body);
  $('#zoom', page.body).onclick = e => { const a4 = $('.m-a4', page.body); a4.classList.toggle('big'); e.target.textContent = a4.classList.contains('big') ? 'Fit to screen' : 'Zoom'; };
  page.setFoot(html`<a class="btn" href="#/m/jobs">My jobs</a>${insp ? html`<a class="btn primary" href="#/m/job/${insp.id}">Back to the job</a>` : ''}`);
}

// Kept for this report while the technician works on it: the steps already passed, and whether "Submit" was tried.
const mem = (id, name) => `rsmRep${name}.${id}`;
const passedOf = id => new Set(JSON.parse(sessionStorage.getItem(mem(id, 'Passed')) || '[]'));
const checking = id => sessionStorage.getItem(mem(id, 'Check')) === '1';

export function mReport(page, id, stepStr) {
  let rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  if (!rep || !auth.seesInspection(insp)) { page.setTitle('Site viewing report', 'm/jobs'); page.body.innerHTML = '<div class="empty">Report not found.</div>'; return; }
  if (rep.status === 'Submitted') return mReportView(page, id);
  page.setTitle(titleOf(rep), `m/job/${insp.id}`, `${rep.no} · Site viewing report`);
  if (!auth.can('inspection', 'edit', 'mobile')) { page.body.innerHTML = '<div class="empty">Only the technician fills in the report.</div>'; return; }
  rep = tidyReport(id);

  const n = Math.min(7, Math.max(1, parseInt(stepStr, 10) || 1));
  const step = STEPS[n - 1];
  sessionStorage.setItem(lastStepKey(rep.id), String(n)); // "Continue the report" opens here
  const passed = passedOf(rep.id);
  let edit1 = false;
  const jump = takeJump();
  step.enter?.();
  const ctx = {
    save(patch) { Object.assign(rep, patch); saveReport(rep.id, patch); },
    repaint() { paint(); },
    preview() { openDocSheet(`Preview · ${rep.no}`, svrSheetHtml(rep, auth.company())); },
  };
  const flush = async () => {
    ctx.save(step.read($('#stepForm', page.body), rep));
    if (step.leave) ctx.save(await step.leave(page.body, rep));
    passed.add(n);
    sessionStorage.setItem(mem(rep.id, 'Passed'), JSON.stringify([...passed]));
  };
  const leaveTo = async route => { await flush(); go(route); };
  // 'done' only when the step holds what it needs: step 1 comes filled in; a step with nothing required counts once
  // it has been passed; a step with something missing is red after "Submit" was tried, and never green.
  const stateOf = (i, issues) => (issues.some(x => x.step === i) ? (checking(rep.id) ? 'bad' : '') : i === 1 || passed.has(i) ? 'done' : '');
  const fieldOf = (form, name) => $(`[name="${name}"]`, form) || $(`#${name}`, form);

  function paint(focusField = '') {
    const issues = reportIssues(rep);
    if (checking(rep.id) && !issues.length) sessionStorage.removeItem(mem(rep.id, 'Check'));
    const mine = checking(rep.id) ? issues.filter(x => x.step === n) : [];
    page.body.innerHTML = String(html`
      ${stepBar(STEPS.map((s, i) => ({ title: s.title, short: s.short, href: `m/report/${rep.id}/${i + 1}`, state: stateOf(i + 1, issues) })), n - 1)}
      ${n === 7 && checking(rep.id) ? problemsBox(issues.map(x => ({ text: x.short, tag: `Step ${x.step}` })), 'Not ready to submit. Tap a line to put it right:') : ''}
      <form id="stepForm" onsubmit="return false">${step.render(rep, { phone: true, edit: edit1 })}</form>`);
    const form = $('#stepForm', page.body);
    step.bind?.(form, rep, ctx);
    bindMics(form);
    hydrateImages(form);
    const autosave = debounce(() => ctx.save(step.read(form, rep)), 400);
    form.addEventListener('input', autosave);
    form.addEventListener('change', () => ctx.save(step.read(form, rep)));
    $('#edit1', form)?.addEventListener('click', () => { edit1 = true; paint(); });
    $$('[data-jump]', page.body).forEach(a => a.addEventListener('click', e => { e.preventDefault(); leaveTo(a.getAttribute('href')); }));
    $$('[data-goto]', form).forEach(a => a.addEventListener('click', e => { e.preventDefault(); leaveTo(`m/report/${rep.id}/${a.dataset.goto}`); }));
    // What "Submit" found missing in this step, under its field (every line still to tick, not only the first).
    mine.forEach(x => {
      const focus = x.field === focusField;
      if (x.key === 'ticks') $$('[name^="ask_"]', form).filter(cb => !cb.checked).forEach((cb, i) => showAt(cb.closest('label'), 'Tick this once you have checked it, or write what you found', focus && i === 0));
      else if (x.key === 'where') {
        const place = $(`[name="pl_${x.rowKey}"]`, form), size = $(`[name="ps_${x.rowKey}"]`, form);
        if (place && !place.value.trim()) showAt(place, 'Enter the location', focus);
        if (size && !$(`[name="ps_${x.rowKey}"]:checked`, form)) showAt(size, 'Tap the size, or measure it', focus && !!place?.value.trim());
      } else showAt(fieldOf(form, x.field), x.short, focus);
    });
    $$('[data-prob]', page.body).forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const x = issues[+a.dataset.prob];
      if (x.step === n) { const el = fieldOf(form, x.field); if (el) showAt(el, x.short); return; }
      setJump({ field: x.field });
      leaveTo(`m/report/${rep.id}/${x.step}`);
    }));
  }
  paint(jump?.field);

  const foot = page.setFoot(html`<button class="btn" id="prev">${n > 1 ? '← Back' : '← Job'}</button>
    ${n < 7 ? html`<button class="btn primary" id="next">Next: ${STEPS[n].nav || STEPS[n].title}</button>` : html`<button class="btn primary" id="submit">Submit report</button>`}`);
  $('#prev', foot).onclick = () => leaveTo(n > 1 ? `m/report/${rep.id}/${n - 1}` : `m/job/${insp.id}`);
  $('#next', foot)?.addEventListener('click', () => leaveTo(`m/report/${rep.id}/${n + 1}`));
  $('#submit', foot)?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    await flush();
    const problems = submitReport(rep.id);
    if (problems.length) {
      btn.disabled = false;
      btn.textContent = 'Submit report';
      sessionStorage.setItem(mem(rep.id, 'Check'), '1');
      paint();
      page.body.scrollTop = 0;
      return;
    }
    ['Passed', 'Check'].forEach(k => sessionStorage.removeItem(mem(rep.id, k)));
    sessionStorage.removeItem(lastStepKey(rep.id));
    toast(`${rep.no} submitted · the office can see it now`);
    go(`m/job/${insp.id}`);
  });
}
