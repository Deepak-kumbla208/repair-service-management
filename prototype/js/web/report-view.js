// Site Viewing Report on the web ("S3"): the 7 sections on the left (the same sections the technician fills on the
// phone, in line style), a live A4 print preview on the right that highlights the field being edited.
// Users who may only view (Approver, Management) get the read-only page instead.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, fmtDateTime, pill, fmtNum, openModal, toast, debounce } from '../core/ui.js';
import { empName, productName } from '../core/lookups.js';
import { hydrateImages } from '../core/media.js';
import { bindMics } from '../core/capture.js';
import { saveReport, submitReport } from '../core/inspections.js';
import { STEPS } from '../mobile/site-report.js';
import { pageHead } from './shell.js';
import { svrSheetHtml } from './print-svr.js';
import { canCreateFor, createEstimate, currentEstimate } from '../core/estimates.js';

const OPEN_KEY = 'rsmSvrSection';

export function renderReport(el, id) {
  const rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  if (!rep || !auth.seesInspection(insp)) { el.innerHTML = '<div class="page"><div class="empty">Report not found.</div></div>'; return; }
  if (auth.can('inspection', 'edit', 'web')) return renderEditor(el, rep, insp);
  return renderReadOnly(el, rep, insp);
}

function renderEditor(el, rep, insp) {
  const e = store.get('enquiries', rep.enquiryId);
  const company = auth.company();
  let open = Number(sessionStorage.getItem(OPEN_KEY)) || 0;
  if (open > 6) open = 0;
  let focusKey = '';

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/inspections">Site Inspection</a> › <a href="#/inspections/${insp.id}">${e.no}</a> › Site viewing report</div>
      <h1>${rep.no} · Site viewing report ${pill(rep.status)}</h1>
      <div class="page-meta">${e.customerName} · ${empName(rep.technicianId)}${insp.visitAt ? ` · visit ${fmtDateTime(insp.visitAt)}` : ''} · pre-filled from ${e.no} · the technician can continue it on the phone${rep.submittedAt ? ` · ${rep.paper ? 'received on paper' : 'submitted'} ${fmtDateTime(rep.submittedAt)}` : ''}</div></div>
      <div class="row"><button class="btn" id="saveBtn">Save</button>
        ${rep.status !== 'Submitted' ? html`<button class="btn" id="paperBtn" title="The technician filled the report on paper; you have typed it in">Mark received (paper)</button>` : ''}
        ${auth.can('inspection', 'print') ? html`<button class="btn" id="printBtn">⎙ Print</button>` : ''}
        ${canCreateFor(e) ? html`<button class="btn primary" id="mkEst">Create estimate</button>` : currentEstimate(e.id) ? html`<a class="btn primary" href="#/estimates/${currentEstimate(e.id).id}">Open the estimate</a>` : ''}</div>
    </div>
    <div class="s3">
      <div class="card form-lines" id="acc"></div>
      <div class="preview"><div class="preview-bar"><span>Live print preview · A4</span><span>updates as you type</span></div><div id="pv"></div></div>
    </div>
  </div>`);

  const acc = $('#acc', el), pv = $('#pv', el);
  const step = () => STEPS[open];
  const form = () => $('#secForm', acc);
  const ctx = {
    save(patch) { Object.assign(rep, patch); saveReport(rep.id, patch); paintPreview(); },
    repaint() { paintAccordion(); },
  };
  const flush = async () => {
    if (!form()) return;
    ctx.save(step().read(form(), rep));
    if (step().leave) ctx.save(await step().leave(form(), rep));
  };

  function paintPreview() {
    pv.innerHTML = String(svrSheetHtml(rep, company));
    hydrateImages(pv);
    if (focusKey) {
      const cell = pv.querySelector(`[data-f~="${focusKey}"]`);
      if (cell) { cell.classList.add('hi'); cell.scrollIntoView({ block: 'nearest' }); }
    }
  }

  function paintAccordion() {
    acc.innerHTML = String(html`${STEPS.map((s, i) => html`<button type="button" class="acc-head" data-sec="${i}">${i + 1}. ${s.title}<span class="grow"></span>${i === open ? '▾' : '▸'}</button>
      ${i === open ? html`<form class="acc-body" id="secForm" onsubmit="return false">${s.render(rep)}</form>` : ''}`)}`);
    const f = form();
    step().bind?.(f, rep, ctx);
    bindMics(f);
    hydrateImages(f);
    const autosave = debounce(() => ctx.save(step().read(f, rep)), 300);
    f.addEventListener('input', autosave);
    f.addEventListener('change', () => ctx.save(step().read(f, rep)));
    // Highlight the printed cell of the field in focus: input "s1_customer" → cell data-f "s1.customer".
    f.addEventListener('focusin', ev => {
      const m = (ev.target.name || '').match(/^(s\d)_(.+)$/);
      focusKey = m ? `${m[1]}.${m[2]}` : '';
      pv.querySelectorAll('.hi').forEach(c => c.classList.remove('hi'));
      paintPreview();
    });
  }

  acc.addEventListener('click', async ev => {
    const head = ev.target.closest('[data-sec]');
    if (!head) return;
    await flush();
    open = +head.dataset.sec;
    sessionStorage.setItem(OPEN_KEY, String(open));
    focusKey = '';
    paintAccordion();
    paintPreview();
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
  paintPreview();
}

// Read-only page for roles that may view but not edit: screen helpers, then the form as it prints.
function renderReadOnly(el, rep, insp) {
  const e = store.get('enquiries', rep.enquiryId);
  el.innerHTML = String(html`<div class="page" style="max-width:1100px">
    ${pageHead({
      crumb: html`<a href="#/inspections">Site Inspection</a> › <a href="#/inspections/${insp.id}">${e.no}</a> › ${rep.no}`,
      title: html`${rep.no} · Site viewing report ${pill(rep.status)}`,
      sub: `${e.customerName} · ${e.siteName} · by ${empName(rep.technicianId)}${rep.submittedAt ? ` · submitted ${fmtDateTime(rep.submittedAt)}` : ''}`,
      actions: html`<div class="row"><a class="btn" href="#/enquiries/${e.id}">Open ${e.no}</a>
        ${auth.can('inspection', 'print') ? html`<a class="btn primary" href="#/reports/${rep.id}/print">⎙ Print preview</a>` : ''}</div>`,
    })}
    <div class="cols2">
      <div class="card"><div class="card-head"><h2>Shutters picked</h2><span class="tag info">screen only · become the estimate lines</span></div>
        ${rep.shutters.length ? html`<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Tag</th><th>Location</th><th>Type</th><th>Size (W × H)</th><th>Class</th><th>Fault found</th></tr></thead><tbody>
          ${rep.shutters.map(s => html`<tr><td class="lnk">${s.tag}</td><td>${s.location}</td><td>${productName(s.productId)}</td><td>${fmtNum(s.width)} × ${fmtNum(s.height)} ${s.unit}</td><td>${s.sizeCode}</td><td class="wrap">${s.finding}</td></tr>`)}
        </tbody></table></div>` : html`<div class="muted">No shutters picked.</div>`}
      </div>
      <div class="card"><div class="card-head"><h2>Photos</h2><span class="muted small">${rep.photos.length} photo(s)</span></div>
        ${rep.photos.length ? html`<div class="photos">${rep.photos.map(p => html`<a class="photo" href="#" data-full="${p}"><img data-media="${p}" alt="Site photo"></a>`)}</div>` : html`<div class="muted">No photos.</div>`}
      </div>
    </div>
    <div class="card" style="margin-top:10px;background:#CFCDC5;overflow:auto"><div style="zoom:.8">${svrSheetHtml(rep, auth.company())}</div></div>
  </div>`);
  hydrateImages(el);
  $$('[data-full]', el).forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); const img = a.querySelector('img'); if (img.src) window.open(img.src, '_blank'); }));
}
