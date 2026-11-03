// Inside an enquiry, stacked like the form: Customer · Site · Enquiry in a header folded to one line, then Later work
// (items the customer will do later; web/later-work.js), "What the customer needs", attachments, Next step (with the
// site inspection), the register's automatic columns and the activity; plus the Workflow popup.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, fmtDateTime, pill, openModal, foldHeader } from '../core/ui.js';
import { vsLabel, zoneLabel, empName, findSite } from '../core/lookups.js';
import { laterColumns, inspectionClock } from '../core/enquiries.js';
import { stagesFor, currentStage } from '../core/flow.js';
import { getUrl, fmtSize } from '../core/media.js';
import { clockHtml } from './site-inspection.js';
import { canCreateFor, createEstimate, currentEstimate } from '../core/estimates.js';
import { currentQuotation } from '../core/quotations.js';
import { jobForEnquiry } from '../core/jobs.js';
import { contractFor } from '../core/contracts.js';
import { linesTable } from './enquiry-parts.js';
import { trailHtml } from './doc-trail.js';
import { laterCard, bindLater } from './later-work.js';
import { openLater } from '../core/later-work.js';

const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
export const channelText = e => (e.channel === 'OTHER' && e.channelOther ? `Other: ${e.channelOther}` : vsLabel('ENQ_CHANNEL', e.channel));

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

// Status history and changes of any record (enquiries by default).
export function activityHtml(enq, coll = 'enquiries') {
  const rows = [
    ...(enq.statusHistory || []).map(h => ({ at: h.at, by: h.by, text: html`Status ${pill(h.status)}${h.note ? ` · ${h.note}` : ''}` })),
    ...store.auditFor(coll, enq.id).filter(a => a.action === 'update').map(a => ({ at: a.at, by: a.userId, text: a.summary })),
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
  const l = laterColumns(e);
  const openInsp = insp && insp.status !== 'Cancelled';
  const canAssign = openInsp && ['To assign', 'Assigned'].includes(insp.status) && auth.can('inspection', 'edit');
  const est = currentEstimate(e.id), q = currentQuotation(e.id), job = jobForEnquiry(e.id), contract = contractFor(e.id);
  // The next document is one click away on the page where it is due.
  const next = canCreateFor(e) ? html`<button class="btn primary" id="mkEst">Create estimate</button>`
    : contract ? html`<a class="btn primary" href="#/contracts/${contract.id}">Open ${contract.no}</a>`
    : job ? html`<a class="btn primary" href="#/jobs/${job.id}">Open ${job.no}</a>`
      : q ? html`<a class="btn primary" href="#/quotations/${q.id}">Open ${q.no} Rev ${q.rev}</a>`
        : est ? html`<a class="btn primary" href="#/estimates/${est.id}">Open ${est.no} Rev ${est.rev}</a>` : '';

  el.innerHTML = String(html`<div class="page" style="max-width:1400px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/enquiries">Enquiry register</a> › ${e.no}</div>
      <h1>${e.no} · ${e.customerName} ${pill(e.status)}${openLater(e) ? html` ${pill(`${e.laterWork.items.length} item${e.laterWork.items.length > 1 ? 's' : ''} later`, 'amber')}` : ''}</h1>
      <div class="page-meta">${vsLabel('ENQ_TYPE', e.type)} · received ${fmtDateTime(e.receivedAt)} by ${channelText(e)} · recorded by <b>${auth.userName(e.recordedBy)}</b>${stage ? html` · <b style="color:var(--blue-600)">now at: ${stage.name}</b>` : ''}</div></div>
      <div class="row">
        <button class="btn soft" id="wfBtn">⇶ Workflow</button>
        ${auth.can('enquiry', 'edit') && e.status !== 'Cancelled' ? html`<a class="btn" href="#/enquiries/${e.id}/edit">✎ Edit</a>` : ''}
        ${report && auth.can('inspection', 'view') ? html`<a class="btn" href="#/reports/${report.id}">Site viewing report</a>` : ''}
        ${canAssign ? html`<a class="btn primary" href="#/inspections/${insp.id}">${insp.technicianId ? 'Change technician' : 'Assign technician'}</a>` : ''}
        ${next}
      </div>
    </div>
    ${trailHtml(e.id, e.id)}
    <div class="stack">
      ${foldHeader({ id: `enq-${e.id}`, title: 'Customer & enquiry details',
        summary: [e.customerName, e.contactName, e.mobile, e.siteName, e.zoneId ? zoneLabel(e.zoneId) : '', vsLabel('ENQ_TYPE', e.type), channelText(e), vsLabel('ENQ_STATUS', e.enquiryStatus), vsLabel('PRIORITY', e.priority)].filter(Boolean).join(' · '),
        body: html`<div class="fold-cols form-lines"><div>
        <div class="form-sec">Customer</div>
        ${row('Customer', auth.can('customer', 'view') ? html`<a href="#/master/customer/${e.customerId}">${e.customerName}</a>` : e.customerName)}
        ${row('Contact Person', e.contactName)}
        ${row('Mobile', e.mobile ? html`<a href="tel:${e.mobile.replace(/\s/g, '')}">${e.mobile}</a>` : '')}
        ${row('Email', e.email ? html`<a href="mailto:${e.email}">${e.email}</a>` : '')}
        </div><div><div class="form-sec">Site</div>
        ${row('Site Location', e.siteName)}
        ${row('Zone', e.zoneId ? zoneLabel(e.zoneId) : html`<span class="muted">Not set</span>`)}
        ${site?.shutters?.length ? row('Customer products', html`${site.shutters.map(s => html`<span class="pill" style="margin:0 4px 4px 0">${s.tag} ${s.location} · ${s.sizeCode}</span>`)}`) : ''}</div>
        <div><div class="form-sec">Enquiry</div>
        ${row('Enquiry Date / Time', fmtDateTime(e.receivedAt))}
        ${row('Type', vsLabel('ENQ_TYPE', e.type))}
        ${row('Enquiry Channel', channelText(e))}
        ${row('Enquiry Status', vsLabel('ENQ_STATUS', e.enquiryStatus))}
        ${row('Priority', vsLabel('PRIORITY', e.priority))}</div>
      </div>` })}
        ${laterCard(e)}
        <div class="card"><div class="card-head"><h2>What the customer needs</h2></div>${linesTable(e.lines)}
          ${e.remarks ? html`<div class="form-lines" style="margin-top:8px;max-width:720px">${row('Remarks', e.remarks)}</div>` : ''}</div>
        <div class="card"><div class="card-head"><h2>Attachments</h2></div>${(e.attachments || []).length
          ? html`<div class="files">${e.attachments.map(a => html`<div class="file-row">📎 <a href="#" data-open="${a.id}">${a.name}</a><span class="muted small">${fmtSize(a.size)}</span></div>`)}</div>`
          : html`<div class="muted">No files attached.</div>`}</div>
        <div class="card"><div class="card-head"><h2>Next step</h2>${openInsp ? html`${pill(insp.status)}${report ? html`<span>${report.no} ${pill(report.status)}</span>` : ''}
          <span class="grow"></span><a class="btn small" href="#/inspections/${insp.id}">Open the site inspection</a>` : ''}</div>
          <div class="form-lines fcols">${row('Site Inspection', vsLabel('YES_NO', e.siteInspection))}
          ${openInsp ? html`${row('Technician', insp.technicianId ? empName(insp.technicianId) : 'No technician yet')}${row('Visit', fmtDateTime(insp.visitAt))}${row('Confirmed by', insp.confirmedBy)}
            ${row(`Target (${company.inspectionTargetHours || 2} h)`, clockHtml(inspectionClock(e, company)))}` : ''}</div></div>
        <div class="card"><div class="card-head"><h2>Register columns filled automatically</h2><span class="muted small">from the quotation, job, invoice and payment</span></div>
          <div class="kv six">${[['Quotation Date', l.quotationDate], ['Quotation Status', l.quotationStatus], ['Quotation Value', l.quotationValue], ['Job Status', l.jobStatus],
            ['Work Completion Status', l.workCompletion], ['Work Completion Date', l.workCompletionDate], ['Invoice Date', l.invoiceDate], ['Invoice No', l.invoiceNo],
            ['Invoice Value', l.invoiceValue], ['Payment Received', l.paymentReceived]].map(([k, v]) => html`<div><div class="k">${k}</div><div class="v">${v || html`<span class="muted">—</span>`}</div></div>`)}</div></div>
        <div class="card"><div class="card-head"><h2>Activity</h2></div>${activityHtml(e)}</div>
    </div>
  </div>`);

  el.querySelector('#wfBtn').onclick = () => openWorkflow(e);
  bindLater(el, e, () => renderEnquiryView(el, id));
  el.querySelector('#mkEst')?.addEventListener('click', () => { const x = createEstimate(e.id); location.hash = `#/estimates/${x.id}`; });
  el.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', async ev => { ev.preventDefault(); const u = await getUrl(a.dataset.open); if (u) window.open(u, '_blank'); }));
}

// The Workflow button opens this popup over the enquiry page.
export function openWorkflow(e) {
  openModal({
    title: `Workflow · ${e.no} · ${vsLabel('ENQ_TYPE', e.type)}`, cls: 'wf-modal',
    body: html`<p class="muted" style="margin:0 0 10px">One box per transaction. The current one is highlighted; click a finished box to open its document.</p>
      ${workflowHtml(e)}
      <div class="muted small" style="margin-top:14px;line-height:1.8"><b>The three enquiry types</b><br>
        Repair: Enquiry → Site inspection → Estimation → Quotation → Job → Invoice → Payment → Job closure<br>
        AMC: Enquiry → Site inspection (optional) → Estimation → Quotation → AMC contract → AMC visits → Invoice → Payment → Contract closure<br>
        General Servicing: Enquiry → Site inspection (optional) → Estimation → Quotation → Job → Invoice → Payment → Job closure</div>`,
    actions: [{ label: 'Close' }],
  });
}
