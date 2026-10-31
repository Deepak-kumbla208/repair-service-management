// Inside an enquiry: register fields grouped, the current transaction, the inspection clock,
// the register's automatic columns, attachments and activity; plus the Workflow view.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, fmtDate, fmtTime, fmtDateTime, pill } from '../core/ui.js';
import { vsLabel, zoneLabel, empName, findSite } from '../core/lookups.js';
import { laterColumns, inspectionClock } from '../core/enquiries.js';
import { stagesFor, currentStage } from '../core/flow.js';
import { getUrl, fmtSize } from '../core/media.js';
import { pageHead } from './shell.js';
import { clockHtml } from './site-inspection.js';

const kv = (k, v) => html`<div><div class="k">${k}</div><div class="v">${v || html`<span class="muted">—</span>`}</div></div>`;

// One box per transaction; the current one highlighted, the rest dimmed.
export function workflowHtml(enq, { vertical = false } = {}) {
  const steps = stagesFor(enq);
  const mobile = auth.view() === 'mobile';
  return html`<div class="wf ${vertical ? 'vertical' : ''}">${steps.map((s, i) => {
    const inner = html`<div class="wf-top"><span class="wf-num">${s.state === 'done' ? '✓' : s.state === 'skip' ? '–' : i + 1}</span>${s.state === 'now' ? html`<span class="wf-now">Now</span>` : ''}</div>
      <div class="wf-name">${s.name}</div><div class="wf-doc">${s.doc || '—'}</div>${s.status ? html`<div class="wf-status">${s.status}</div>` : ''}`;
    const link = !mobile && s.route && s.state !== 'next' && s.key !== 'enquiry';
    return html`${i ? html`<span class="arr">→</span>` : ''}${link ? html`<a class="wf-box ${s.state}" href="#/${s.route}">${inner}</a>` : html`<div class="wf-box ${s.state}">${inner}</div>`}`;
  })}</div>`;
}

function activity(enq) {
  const rows = [
    ...(enq.statusHistory || []).map(h => ({ at: h.at, by: h.by, text: html`Status ${pill(h.status)}${h.note ? ` · ${h.note}` : ''}` })),
    ...store.auditFor('enquiries', enq.id).filter(a => a.action === 'update').map(a => ({ at: a.at, by: a.userId, text: a.summary })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return html`<div class="activity">${rows.map(r => html`<div><span class="when">${fmtDateTime(r.at)}</span><span class="grow">${r.text}</span><span class="muted">${auth.userName(r.by)}</span></div>`)}</div>`;
}

export function renderEnquiryView(el, id) {
  const e = store.get('enquiries', id);
  if (!e) { el.innerHTML = '<div class="page"><div class="empty">Enquiry not found.</div></div>'; return; }
  const company = auth.company();
  const insp = e.inspectionId ? store.get('inspections', e.inspectionId) : null;
  const report = insp?.reportId ? store.get('siteReports', insp.reportId) : null;
  const { site } = findSite(e.siteId);
  const stage = currentStage(e);
  const clock = inspectionClock(e, company);
  const l = laterColumns(e);
  const canAssign = insp && ['To assign', 'Assigned'].includes(insp.status) && auth.can('inspection', 'edit');

  el.innerHTML = String(html`<div class="page">
    ${pageHead({
      crumb: html`<a href="#/enquiries">Enquiry register</a> › ${e.no}`,
      title: html`${e.no} · ${e.customerName} ${pill(e.status)}`,
      sub: html`${vsLabel('ENQ_TYPE', e.type)} · received ${fmtDateTime(e.receivedAt)} by ${vsLabel('ENQ_CHANNEL', e.channel)} · recorded by ${auth.userName(e.recordedBy)}${stage ? html` · <b style="color:var(--blue-600)">now at: ${stage.name}</b>` : ''}`,
      actions: html`<div class="row">
        <a class="btn soft" href="#/enquiries/${e.id}/workflow">⇶ Workflow</a>
        ${auth.can('enquiry', 'edit') && e.status !== 'Cancelled' ? html`<a class="btn" href="#/enquiries/${e.id}/edit">✎ Edit</a>` : ''}
        ${report?.status === 'Submitted' && auth.can('inspection', 'view') ? html`<a class="btn" href="#/reports/${report.id}">View site report</a>` : ''}
        ${canAssign ? html`<a class="btn primary" href="#/inspections/${insp.id}">${insp.technicianId ? 'Change technician' : 'Assign technician'}</a>` : ''}
      </div>`,
    })}
    <div class="cols2">
      <div class="card"><div class="card-head"><h2>Enquiry</h2></div>
        <div class="kv">${kv('Enquiry Date', fmtDate(e.receivedAt))}${kv('Enquiry Time', fmtTime(e.receivedAt))}${kv('Enquiry Channel', vsLabel('ENQ_CHANNEL', e.channel))}
          ${kv('Type', vsLabel('ENQ_TYPE', e.type))}${kv('Enquiry Status', vsLabel('ENQ_STATUS', e.enquiryStatus))}${kv('Priority', vsLabel('PRIORITY', e.priority))}
          ${kv('Site Inspection', vsLabel('YES_NO', e.siteInspection))}${kv('Recorded By', auth.userName(e.recordedBy))}</div>
        <div class="kv" style="grid-template-columns:1fr;margin-top:10px">${kv('Enquiry Description', e.description)}${kv('Remarks', e.remarks)}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Customer and site</h2></div>
        <div class="kv two">
          ${kv('Customer Name', auth.can('customer', 'view') ? html`<a href="#/master/customer/${e.customerId}">${e.customerName}</a>` : e.customerName)}
          ${kv('Contact Person', e.contactName)}${kv('Mobile', e.mobile ? html`<a href="tel:${e.mobile.replace(/\s/g, '')}">${e.mobile}</a>` : '')}
          ${kv('Email', e.email ? html`<a href="mailto:${e.email}">${e.email}</a>` : '')}${kv('Site Location', e.siteName)}${kv('Zone', zoneLabel(e.zoneId))}
        </div>
        <div class="kv" style="grid-template-columns:1fr;margin-top:10px">${kv('Shutters at this site', site?.shutters?.length ? html`${site.shutters.map(s => html`<span class="pill" style="margin:0 4px 4px 0">${s.tag} ${s.location} · ${s.sizeCode}</span>`)}` : '')}</div>
      </div>
    </div>
    ${insp && insp.status !== 'Cancelled' ? html`<div class="card" style="margin-top:10px"><div class="card-head"><h2>Site inspection</h2>${pill(insp.status)}</div>
      <div class="kv six">${kv('Technician', empName(insp.technicianId))}${kv('Visit (confirmed)', fmtDateTime(insp.visitAt))}${kv('Confirmed by', insp.confirmedBy)}
        ${kv('Site report', report ? html`${report.no} · ${report.status}` : '')}<div class="span2">${kv('Target: within ' + (company.inspectionTargetHours || 2) + ' h of the call', clockHtml(clock))}</div></div>
    </div>` : ''}
    <div class="card"><div class="card-head"><h2>Register columns filled automatically</h2><span class="muted small">from the quotation, job, invoice and payment (Stretch 2)</span></div>
      <div class="kv six">${kv('Quotation Date', l.quotationDate)}${kv('Quotation Status', l.quotationStatus)}${kv('Quotation Value', l.quotationValue)}${kv('Job Status', l.jobStatus)}
        ${kv('Work Completion Status', l.workCompletion)}${kv('Work Completion Date', l.workCompletionDate)}${kv('Invoice Date', l.invoiceDate)}${kv('Invoice No', l.invoiceNo)}
        ${kv('Invoice Value', l.invoiceValue)}${kv('Payment Received', l.paymentReceived)}</div>
    </div>
    <div class="cols2" style="margin-top:10px">
      <div class="card"><div class="card-head"><h2>Attachments</h2></div>${(e.attachments || []).length
        ? html`<div class="files">${e.attachments.map(a => html`<div class="file-row">📎 <a href="#" data-open="${a.id}">${a.name}</a><span class="muted small">${fmtSize(a.size)}</span></div>`)}</div>`
        : html`<div class="muted">No files attached.</div>`}</div>
      <div class="card"><div class="card-head"><h2>Activity</h2></div>${activity(e)}</div>
    </div>
  </div>`);

  el.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', async ev => { ev.preventDefault(); const u = await getUrl(a.dataset.open); if (u) window.open(u, '_blank'); }));
}

export function renderWorkflow(el, id) {
  const e = store.get('enquiries', id);
  if (!e) { el.innerHTML = '<div class="page"><div class="empty">Enquiry not found.</div></div>'; return; }
  el.innerHTML = String(html`<div class="page">
    ${pageHead({
      crumb: html`<a href="#/enquiries">Enquiry register</a> › <a href="#/enquiries/${e.id}">${e.no}</a> › Workflow`,
      title: `Workflow · ${e.no} · ${vsLabel('ENQ_TYPE', e.type)}`,
      sub: 'One box per transaction. The current one is highlighted; click a finished box to open its document.',
      actions: html`<a class="btn" href="#/enquiries/${e.id}">← Back to enquiry</a>`,
    })}
    <div class="card">${workflowHtml(e)}</div>
    <div class="card"><b>Other enquiry types</b>
      <div class="muted" style="margin-top:4px;line-height:1.8">AMC: Enquiry → Site inspection (optional) → Estimation → Quotation → AMC contract → AMC visits → Invoice → Payment<br>
      General Servicing: Enquiry → Site inspection (optional) → Estimation → Quotation → Job → Invoice → Payment → Job closure</div></div>
  </div>`);
}
