// The returned Site Viewing Report on the web: screen helpers first (shutters picked with findings, photos),
// then the form itself exactly as it prints.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, fmtDateTime, pill, fmtNum } from '../core/ui.js';
import { empName, productName } from '../core/lookups.js';
import { hydrateImages } from '../core/media.js';
import { pageHead } from './shell.js';
import { svrSheetHtml } from './print-svr.js';

export function renderReport(el, id) {
  const rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  if (!rep || !auth.seesInspection(insp)) { el.innerHTML = '<div class="page"><div class="empty">Report not found.</div></div>'; return; }
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
  el.querySelectorAll('[data-full]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); const img = a.querySelector('img'); if (img.src) window.open(img.src, '_blank'); }));
}
