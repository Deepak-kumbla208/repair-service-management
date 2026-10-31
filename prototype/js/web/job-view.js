// A job on the web: properties on the left (customer, site, crew, schedule, payment, invoice), and on the right the
// lines, the parts check, the technician's progress on the phone, the leave-site request, the Work Done form and
// photos. Also the list of all jobs.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, fmtDate, fmtDateTime, pill, toast, openModal, readForm, dateInput } from '../core/ui.js';
import { zoneLabel, empName, vsLabel } from '../core/lookups.js';
import { hydrateImages } from '../core/media.js';
import { earliestDate, setPartReady, cancelJob, confirmLeave, seesJob, fmtHour, suggestSlot, workCompletion } from '../core/jobs.js';
import { openTaskFor } from '../core/workflow.js';
import { balanceOf } from '../core/billing.js';
import { RATINGS } from './print-docs.js';
import { scheduleDialog } from './job-board.js';
import { openWorkflow, activityHtml } from './enquiry-view.js';
import { renderDocList } from './doc-list.js';
import { render } from '../app.js';

const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = j => (j.start ? `${fmtDate(j.start)} ${fmtHour(new Date(j.start).getHours() + new Date(j.start).getMinutes() / 60)}–${fmtHour(new Date(j.end).getHours() + new Date(j.end).getMinutes() / 60)}` : '');

export function renderJobList(el) {
  renderDocList(el, {
    key: 'rsmJobList', crumb: html`<a href="#/jobs">Job Execution</a> › All jobs`, title: 'All jobs', sub: 'Every repair job, from scheduling to closure.',
    actions: html`<a class="btn primary" href="#/jobs">Scheduling board</a>`, placeholder: 'Search jobs: job no, customer, site, technician, quotation',
    rows: () => store.list('jobs', seesJob).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    tiles: [
      { key: 'sched', label: 'To schedule', test: j => j.status === 'To schedule', tone: 'warn' },
      { key: 'up', label: 'Scheduled', test: j => j.status === 'Scheduled' },
      { key: 'site', label: 'On the way / on site', test: j => ['On the way', 'On site'].includes(j.status) },
      { key: 'done', label: 'Work done, to document', test: j => j.status === 'Work done' },
      { key: 'closed', label: 'Documented / closed', test: j => ['Completed & documented', 'Closed'].includes(j.status) },
    ],
    columns: [['Job No', j => j.no], ['Customer', j => j.customer], ['Site', j => j.site], ['Zone', j => html`<span class="zone-chip">${zoneLabel(j.zoneId).split(' ')[0]}</span>`],
      ['Technician', j => empName(j.technicianId) || '—'], ['Scheduled', j => when(j) || '—'], ['Payment term', j => vsLabel('PAYMENT_TERMS', j.paymentTerm)],
      ['Work completion', j => vsLabel('WORK_COMPLETION', workCompletion(j))], ['Status', j => pill(j.status)]],
    search: j => [j.no, j.customer, j.site, empName(j.technicianId), j.quotationNo, j.enquiryNo],
    route: j => `jobs/${j.id}`, empty: 'No jobs yet. Accepting a quotation creates the job.',
  });
}

export function renderJob(el, id) {
  const j = store.get('jobs', id);
  if (!j || !seesJob(j)) { el.innerHTML = '<div class="page"><div class="empty">Job not found.</div></div>'; return; }
  const enq = store.get('enquiries', j.enquiryId);
  const inv = j.invoiceId ? store.get('invoices', j.invoiceId) : null;
  const edit = auth.can('job', 'edit');
  const leaveTask = openTaskFor('job', j.id, 'leaveSite');
  const termTask = openTaskFor('job', j.id, 'approval');
  const w = j.workDone;
  const s = j.steps || {};
  const step = (label, at) => html`<li><span class="${at ? 'ok' : 'wn'}" style="color:${at ? 'var(--green)' : 'var(--faint)'}">${at ? '✓' : '○'}</span><span class="grow">${label}</span><span class="muted">${at ? fmtDateTime(at) : ''}</span></li>`;

  el.innerHTML = String(html`<div class="page" style="max-width:1400px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/jobs">Job Execution</a> › <a href="#/enquiries/${enq.id}">${enq.no}</a></div>
      <h1>${j.no} · ${j.customer} ${pill(j.status)}</h1>
      <div class="page-meta">Repair · from <a href="#/quotations/${j.quotationId}">${j.quotationNo}</a> · ${j.site}</div></div>
      <div class="row"><button class="btn soft" id="wf">⇶ Workflow</button>
        ${w ? html`<a class="btn" href="#/jobs/${j.id}/workdone">⎙ Work Done form</a>` : ''}
        ${inv ? html`<a class="btn" href="#/invoices/${inv.id}">${inv.no || 'Draft invoice'}</a>` : ''}
        ${w?.signedAt && auth.can('closure', 'view') ? html`<a class="btn" href="#/closure/${j.id}">Job closure</a>` : ''}
        ${edit && ['To schedule', 'Scheduled'].includes(j.status) ? html`<button class="btn danger" id="cancel">Cancel job</button>` : ''}
        ${edit && j.termApproved && ['To schedule', 'Scheduled'].includes(j.status) ? html`<button class="btn primary" id="sched">${j.status === 'To schedule' ? 'Schedule' : 'Move'}</button>` : ''}</div>
    </div>
    ${leaveTask ? html`<div class="note bad" style="margin-bottom:10px;display:flex;gap:10px;align-items:center"><span class="grow"><b>${empName(j.technicianId)} asks to leave the site</b> (since ${fmtDateTime(leaveTask.createdAt)}). ${w?.signedAt ? 'The Work Done form is signed.' : 'The Work Done form is not signed yet.'}</span>
      ${auth.hasTasks('web') ? html`<button class="btn primary small" id="okLeave">✓ OK to leave</button>` : ''}</div>` : ''}
    ${termTask ? html`<div class="note warn" style="margin-bottom:10px">The payment term ${vsLabel('PAYMENT_TERMS', j.paymentTerm)} is waiting for the Approver; scheduling is locked until then.</div>` : ''}
    <div class="e2">
      <div class="props form-lines">
        <div class="form-sec">Customer</div>
        ${row('Customer', j.customer)}${row('Contact', [j.contact, j.phone].filter(Boolean).join(' · '))}${row('Site', html`${j.site}<br><span class="small muted">${j.address}</span>`)}${row('Zone', zoneLabel(j.zoneId))}
        <div class="form-sec">Work</div>
        ${row('Crew', j.crew.label)}${row('Hours', `${j.workHours} h work + ${j.travelHours} h travel`)}
        ${row('Technician', j.technicianId ? `${empName(j.technicianId)}${j.helperIds?.length ? ` + ${j.helperIds.map(empName).join(', ')}` : ''}` : '')}${row('Scheduled', when(j))}
        <div class="form-sec">Money</div>
        ${row('Quotation', html`<a href="#/quotations/${j.quotationId}">${j.quotationNo}</a> · ${auth.company().currency} ${m2(j.total)}`)}
        ${row('Payment term', `${vsLabel('PAYMENT_TERMS', j.paymentTerm)}${j.paymentTerm !== 'IMMEDIATE' ? (j.termApproved ? ' · approved' : ' · waiting for the Approver') : ''}`)}
        ${row('Invoice', inv ? html`<a href="#/invoices/${inv.id}">${inv.no || 'Draft'}</a> · ${inv.status}${inv.status === 'Posted' ? ` · balance ${m2(balanceOf(inv))}` : ''}` : j.paymentTerm === 'IMMEDIATE' ? 'Raised when the job is scheduled' : 'Drafted when the Work Done form is signed')}
      </div>
      <div class="e2-main">
        <div class="card"><div class="card-head"><h2>Lines to do</h2></div><table class="lines"><tbody>${j.lines.map((l, i) => html`<tr><td style="width:26px">${i + 1}</td><td>${l.description}</td>
          <td style="width:120px">${w ? pill(vsLabel('WORK_DONE', w.rows.find(r => r.key === l.key)?.status), w.rows.find(r => r.key === l.key)?.status === 'DONE' ? 'green' : 'amber') : ''}</td></tr>`)}</tbody></table></div>
        ${j.parts.length ? html`<div class="card"><div class="card-head"><h2>Parts</h2><span class="muted small">ready from ${earliestDate(j)}</span></div>
          ${j.parts.map(p => html`<div class="row" style="padding:3px 0"><label class="check grow"><input type="checkbox" data-part="${p.key}" ${p.ready ? 'checked' : ''} ${edit && j.status === 'To schedule' ? '' : 'disabled'}> ${p.qty} ${p.unit} × ${p.name}</label>
            <span class="muted small">${p.ready ? 'in stock' : `to order · lead time ${p.leadDays} days`}</span>${w ? html`<span class="small">${w.partsUsed.find(u => u.key === p.key)?.used ? '· used' : '· not used'}</span>` : ''}</div>`)}</div>` : ''}
        <div class="card"><div class="card-head"><h2>On site (from the phone)</h2></div><ul class="chk">
          ${step('Scheduled', j.start && j.statusHistory?.find(h => h.status === 'Scheduled')?.at)}${step('On my way', s.onMyWayAt)}${step('Checked in', s.checkInAt)}
          ${step('Work Done form signed', w?.signedAt)}${step('Leave-site request', j.leaveSite?.requestedAt)}${step('Office OK to leave', j.leaveSite?.confirmedAt)}${step('Checked out', s.checkOutAt)}</ul></div>
        ${w?.signedAt ? html`<div class="card"><div class="card-head"><h2>Customer feedback</h2><a href="#/jobs/${j.id}/workdone">Print the form</a></div>
          <div class="kv">${RATINGS.map(([k, label]) => html`<div><div class="k">${label}</div><div class="v">${'★'.repeat(w.ratings[k])}${'☆'.repeat(5 - w.ratings[k])} ${w.ratings[k]}</div></div>`)}
            <div><div class="k">Comments</div><div class="v">${w.comments || '—'}</div></div><div><div class="k">Signed by</div><div class="v">${w.cust.name} · ${w.cust.designation}</div></div></div></div>` : ''}
        ${(j.photosBefore || []).length || (j.photosAfter || []).length || w?.cust?.stampId ? html`<div class="card"><div class="card-head"><h2>Photos</h2></div>
          ${[['Before', j.photosBefore], ['After', j.photosAfter], ['Company stamp', w?.cust?.stampId ? [w.cust.stampId] : []]].filter(([, l]) => l?.length).map(([label, l]) => html`<div class="small muted" style="margin:4px 0">${label}</div><div class="photos">${l.map(p => html`<div class="photo"><img data-media="${p}" alt="${label} photo"></div>`)}</div>`)}</div>` : ''}
        <div class="card"><div class="card-head"><h2>Activity</h2></div>${activityHtml(j, 'jobs')}</div>
      </div>
    </div>
  </div>`);
  hydrateImages(el);
  $('#wf', el).onclick = () => openWorkflow(enq);
  el.querySelectorAll('[data-part]').forEach(cb => cb.addEventListener('change', () => { setPartReady(j.id, cb.dataset.part, cb.checked); render(); }));
  $('#sched', el)?.addEventListener('click', () => { const sg = suggestSlot(j); scheduleDialog(el, j, j.start ? { technicianId: j.technicianId, date: dateInput(new Date(j.start)), start: new Date(j.start).getHours() + new Date(j.start).getMinutes() / 60 } : sg || {}); });
  $('#okLeave', el)?.addEventListener('click', () => { confirmLeave(leaveTask.id); toast(`${empName(j.technicianId)} may leave the site`); render(); });
  $('#cancel', el)?.addEventListener('click', () => openModal({
    title: `Cancel ${j.no}`, body: html`<div class="form-lines"><div class="field"><label>Reason</label><input type="text" name="reason"></div>${inv?.status === 'Posted' ? html`<p class="small" style="margin-top:8px">${inv.no} is cancelled too. It keeps its number, so the invoice series has no gap.</p>` : ''}</div>`,
    actions: [{ label: 'Keep the job' }, { label: 'Cancel the job', kind: 'danger', onClick: b => { cancelJob(j.id, readForm(b).reason || 'Cancelled'); toast(`${j.no} cancelled`); render(); } }],
  }));
}
