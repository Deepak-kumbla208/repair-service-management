// Site Viewing Report on the web: the 7 sections one below another, full width (the same sections the technician
// fills on the phone, in line style). Section 1 (General details) is the header and folds to one summary line.
// No document preview beside the form (team lead, 1 Nov 2026): Print shows it.
// Users who may only view (Approver, Management) get the same sections read-only.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, fmtDateTime, pill, openModal, toast, debounce, foldHeader } from '../core/ui.js';
import { empName } from '../core/lookups.js';
import { hydrateImages } from '../core/media.js';
import { bindMics } from '../core/capture.js';
import { saveReport, submitReport } from '../core/inspections.js';
import { STEPS } from '../mobile/site-report.js';
import { pageHead } from './shell.js';
import { canCreateFor, createEstimate, currentEstimate } from '../core/estimates.js';
import { trailHtml } from './doc-trail.js';

const OPEN_KEY = 'rsmSvrSection';
const dmy = iso => (iso ? iso.split('-').reverse().join('/') : '');
// Section 1 folded: "Kosmic M&E · IMM Building · Facilities Manager · 9876 5432 · 01/11/2026 · Technician A · 15:29–15:30".
const s1Summary = rep => [rep.s1.customer, rep.s1.site, rep.s1.contactPerson, rep.s1.contactNo, dmy(rep.s1.viewDate), rep.s1.viewedBy,
  rep.s1.timeIn ? `${rep.s1.timeIn}–${rep.s1.timeOut || '…'}` : ''].filter(Boolean).join(' · ');

export function renderReport(el, id) {
  const rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  if (!rep || !auth.seesInspection(insp)) { el.innerHTML = '<div class="page"><div class="empty">Report not found.</div></div>'; return; }
  if (auth.can('inspection', 'edit', 'web')) return renderEditor(el, rep, insp);
  return renderReadOnly(el, rep, insp);
}

function renderEditor(el, rep, insp) {
  const e = store.get('enquiries', rep.enquiryId);
  let open = Number(sessionStorage.getItem(OPEN_KEY)) || 0;
  if (open > 6) open = 0;

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/inspections">Site Inspection</a> › <a href="#/enquiries/${e.id}">${e.no}</a> › Site viewing report</div>
      <h1>${rep.no} · Site viewing report ${pill(rep.status)}</h1>
      <div class="page-meta">${e.customerName} · ${empName(rep.technicianId)}${insp.visitAt ? ` · visit ${fmtDateTime(insp.visitAt)}` : ''} · pre-filled from <a href="#/enquiries/${e.id}">${e.no}</a> · the technician can continue it on the phone${rep.submittedAt ? ` · ${rep.paper ? 'received on paper' : 'submitted'} ${fmtDateTime(rep.submittedAt)}` : ''}</div></div>
      <div class="row"><button class="btn" id="saveBtn">Save</button>
        ${rep.status !== 'Submitted' ? html`<button class="btn" id="paperBtn" title="The technician filled the report on paper; you have typed it in">Mark received (paper)</button>` : ''}
        ${auth.can('inspection', 'print') ? html`<button class="btn" id="printBtn">⎙ Print</button>` : ''}
        ${canCreateFor(e) ? html`<button class="btn primary" id="mkEst">Create estimate</button>` : currentEstimate(e.id) ? html`<a class="btn primary" href="#/estimates/${currentEstimate(e.id).id}">Open the estimate</a>` : ''}</div>
    </div>
    ${trailHtml(e.id, rep.id)}
    <div class="card form-lines" id="acc"></div>
  </div>`);

  const acc = $('#acc', el);
  const step = () => STEPS[open];
  const form = () => $('#secForm', acc);
  const ctx = {
    save(patch) { Object.assign(rep, patch); saveReport(rep.id, patch); },
    repaint() { paintAccordion(); },
    // The customer's preview is the print page (roles that may print); the report is saved before it opens.
    preview: auth.can('inspection', 'print') ? () => go(`reports/${rep.id}/print`) : null,
  };
  const flush = async () => {
    if (!form()) return;
    ctx.save(step().read(form(), rep));
    if (step().leave) ctx.save(await step().leave(form(), rep));
  };

  function paintAccordion() {
    acc.innerHTML = String(html`${STEPS.map((s, i) => html`<button type="button" class="acc-head" data-sec="${i}"><span class="tw">${i === open ? '▾' : '▸'}</span>${i + 1}. ${s.title}
      ${i === 0 && open !== 0 ? html`<span class="fold-s">${s1Summary(rep)}</span>` : html`<span class="grow"></span>`}</button>
      ${i === open ? html`<form class="acc-body" id="secForm" onsubmit="return false">${s.render(rep)}</form>` : ''}`)}`);
    const f = form();
    step().bind?.(f, rep, ctx);
    bindMics(f);
    hydrateImages(f);
    const autosave = debounce(() => ctx.save(step().read(f, rep)), 300);
    f.addEventListener('input', autosave);
    f.addEventListener('change', () => ctx.save(step().read(f, rep)));
  }

  acc.addEventListener('click', async ev => {
    const head = ev.target.closest('[data-sec]');
    if (!head) return;
    await flush();
    open = +head.dataset.sec;
    sessionStorage.setItem(OPEN_KEY, String(open));
    paintAccordion();
  });

  $('#saveBtn', el).onclick = async () => { await flush(); toast(`${rep.no} saved`); };
  $('#printBtn', el)?.addEventListener('click', async () => { await flush(); go(`reports/${rep.id}/print`); });
  $('#mkEst', el)?.addEventListener('click', async () => { await flush(); go(`estimates/${createEstimate(e.id).id}`); });
  $('#paperBtn', el)?.addEventListener('click', async () => {
    await flush();
    const problems = submitReport(rep.id, { paper: true });
    if (problems.length) {
      openModal({ title: 'Not ready yet', body: html`<ul>${problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] });
      return;
    }
    toast(`${rep.no} marked as received on paper`);
    renderReport(el, rep.id);
  });

  paintAccordion();
}

// Read-only page for roles that may view but not edit: the same 7 sections, one below another, with the fields
// locked; section 1 folded to its summary line. Print shows the form as it prints.
function renderReadOnly(el, rep, insp) {
  const e = store.get('enquiries', rep.enquiryId);
  el.innerHTML = String(html`<div class="page stack" style="max-width:1400px">
    ${pageHead({
      crumb: html`<a href="#/inspections">Site Inspection</a> › <a href="#/inspections/${insp.id}">${e.no}</a> › ${rep.no}`,
      title: html`${rep.no} · Site viewing report ${pill(rep.status)}`,
      sub: `${e.customerName} · ${e.siteName} · by ${empName(rep.technicianId)}${rep.submittedAt ? ` · submitted ${fmtDateTime(rep.submittedAt)}` : ''}`,
      actions: html`<div class="row"><a class="btn" href="#/enquiries/${e.id}">Open ${e.no}</a>
        ${auth.can('inspection', 'print') ? html`<a class="btn primary" href="#/reports/${rep.id}/print">⎙ Print</a>` : ''}</div>`,
    })}
    ${trailHtml(e.id, rep.id)}
    ${STEPS.map((s, i) => foldHeader({ id: i ? '' : `svr-${rep.id}`, title: `${i + 1}. ${s.title}`, summary: i ? '' : s1Summary(rep), open: i > 0,
      body: html`<fieldset class="acc-body form-lines ro-sec" disabled>${s.render(rep)}</fieldset>` }))}
  </div>`);
  hydrateImages(el);
}
