// AMC Execution on the web: the list of visits (service reports) and a visit's page: the check list as the technician
// filled it on the phone, the failed items and the repair enquiry they made, the customer's sign-off, photos, and the
// office's "Checked & filed" (flow step 9). The same check-list panel shows a General Servicing job's results.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, fmtDate, fmtDateTime, pill, toast, openModal, readForm } from '../core/ui.js';
import { zoneLabel, zoneCode, empName } from '../core/lookups.js';
import { hydrateImages } from '../core/media.js';
import { refreshAmc, todayStr } from '../core/contracts.js';
import { shutterState, signOf, fileVisit, cancelVisit, isOverdue, visitDate, seesVisit, DONE_VISIT, OPEN_VISIT } from '../core/visits.js';
import { BOOKABLE } from '../core/contracts.js';
import { fmtHour } from '../core/jobs.js';
import { RATINGS } from './print-docs.js';
import { activityHtml, openWorkflow } from './enquiry-view.js';
import { visitDialog } from './amc-scheduling.js';
import { renderDocList } from './doc-list.js';
import { trailHtml } from './doc-trail.js';
import { render } from '../app.js';

const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
const RES = { P: ['Pass', 'green'], F: ['Fail', 'red'], NA: ['N/A', ''] };

export function renderVisitList(el) {
  refreshAmc();
  renderDocList(el, {
    key: 'rsmVisitList', crumb: 'Transactions › AMC Execution', title: 'AMC visits', sub: 'Every visit of the active contracts; the technician fills the check list on the phone, the office files the signed report.',
    actions: html`<a class="btn primary" href="#/amc-scheduling">AMC Scheduling</a>`, placeholder: 'Search visits: contract, customer, site, technician, report no',
    rows: () => store.list('amcVisits', v => v.status !== 'Cancelled' && seesVisit(v)).sort((a, b) => visitDate(a).localeCompare(visitDate(b))),
    tiles: [
      { key: 'today', label: 'Today', test: v => visitDate(v) === todayStr() && !DONE_VISIT.includes(v.status) },
      { key: 'late', label: 'Overdue', test: isOverdue, tone: 'bad' },
      { key: 'file', label: 'Done, to check & file', test: v => v.status === 'Done', tone: 'warn' },
      { key: 'filed', label: 'Checked & filed', test: v => v.status === 'Checked & filed' },
      { key: 'fails', label: 'With failed items', test: v => (v.failures || []).length > 0 },
    ],
    columns: [['Visit', v => `${v.contractNo} · ${v.n} of ${v.of}`], ['Customer', v => v.customer], ['Site', v => v.site], ['Zone', v => html`<span class="zone-chip">${zoneCode(v.zoneId)}</span>`],
      ['Date', v => fmtDate(visitDate(v))], ['Technician', v => empName(v.technicianId) || '—'], ['Result', v => (v.signoff?.signedAt ? (v.failures?.length ? `${v.failures.length} failed` : 'All pass') : '')],
      ['Status', v => (isOverdue(v) ? pill(`Overdue · ${v.status}`, 'red') : pill(v.status))]],
    search: v => [v.contractNo, v.customer, v.site, empName(v.technicianId), v.reportNo], route: v => `amc-visits/${v.id}`, empty: 'No visits yet. Activating an AMC contract plans them.',
  });
}

// The check list as filled on the phone, one block per shutter (shared with the GS job page).
export function checklistHtml(d) {
  return html`${(d.shutters || []).map(sh => {
    const st = shutterState(d, sh);
    const live = st.items.filter(i => i.on);
    return html`<div class="ck-web"><div class="row"><b>${sh.tag}</b> ${sh.location} <span class="muted small">${sh.typeName} · ${sh.sizeCode}${sh.fireRated ? ' · fire-rated' : ''}</span><span class="grow"></span>
      ${st.unsafe ? pill('Taken out of service', 'red') : ''}${st.fails ? pill(`${st.fails} fail`, 'red') : st.answered === st.total && st.total ? pill('All pass', 'green') : pill(`${st.answered} of ${st.total} checked`, 'amber')}
      <span class="muted small">${st.off} N/A by type</span></div>
      ${live.some(i => i.r !== 'P') ? html`<div class="ck-items">${live.filter(i => i.r !== 'P').map(i => html`<span class="ck-i ${i.r === 'F' ? 'f' : ''}" title="${i.hint}">${i.label}: ${i.r ? RES[i.r][0] : 'not checked'}${i.r === 'F' && i.note ? ` – ${i.note}` : ''}${i.r === 'F' && i.photoId ? html` <img class="ck-ph" data-media="${i.photoId}" alt="Photo">` : ''}</span>`)}</div>` : ''}</div>`;
  })}`;
}

export function renderVisit(el, id) {
  refreshAmc();
  const v = store.get('amcVisits', id);
  if (!v || !seesVisit(v)) { el.innerHTML = '<div class="page"><div class="empty">Visit not found.</div></div>'; return; }
  const c = store.get('contracts', v.contractId);
  const enq = store.get('enquiries', v.enquiryId);
  const s = v.signoff;
  const st = v.steps || {};
  const step = (label, at) => html`<li><span style="color:${at ? 'var(--green)' : 'var(--faint)'}">${at ? '✓' : '○'}</span><span class="grow">${label}</span><span class="muted">${at ? fmtDateTime(at) : ''}</span></li>`;
  const repair = v.repairEnquiryId ? store.get('enquiries', v.repairEnquiryId) : null;
  const added = (v.repairAddedTo || []).map(x => store.get('enquiries', x)).filter(Boolean);
  const canFile = v.status === 'Done' && auth.can('amcExecution', 'edit');
  el.innerHTML = String(html`<div class="page" style="max-width:1400px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/amc-visits">AMC Execution</a> › <a href="#/contracts/${c.id}">${c.no}</a></div>
      <h1>${c.no} · visit ${v.n} of ${v.of} · ${v.customer} ${isOverdue(v) ? pill(`Overdue · ${v.status}`, 'red') : pill(v.status)}</h1>
      <div class="page-meta">${v.site} · ${zoneLabel(v.zoneId)} · ${v.blocks?.length ? `${fmtDate(v.blocks[0].date)} ${fmtHour(v.blocks[0].from)}${v.blocks.length > 1 ? ` (${v.blocks.length} days)` : ''}` : `planned ${fmtDate(visitDate(v))}`}${v.technicianId ? ` · ${empName(v.technicianId)}` : ''}</div></div>
      <div class="row"><button class="btn soft" id="wf">⇶ Workflow</button><a class="btn" href="#/contracts/${c.id}">Open ${c.no}</a>
        ${s?.signedAt ? html`<a class="btn" href="#/amc-visits/${v.id}/print">⎙ Service report</a>` : ''}
        ${OPEN_VISIT.includes(v.status) && auth.can('amcScheduling', 'edit') ? html`<button class="btn danger" id="cancelV">Cancel visit</button>` : ''}
        ${OPEN_VISIT.includes(v.status) && auth.can('amcScheduling', 'edit') && BOOKABLE.includes(c.status) ? html`<button class="btn" id="sched">${v.status === 'Scheduled' ? 'Move' : 'Schedule'}</button>` : ''}
        ${canFile ? html`<button class="btn primary" id="file">✓ Checked &amp; filed</button>` : ''}</div>
    </div>
    ${v.status === 'Done' ? html`<div class="note" style="margin-bottom:10px">Signed by the customer on ${fmtDateTime(s.signedAt)}. Check the report and the photos, then file it (flow step 9).</div>` : ''}
    ${trailHtml(v.enquiryId, '')}
    <div class="e2">
      <div class="props form-lines">
        <div class="form-sec">Visit</div>
        ${row('Contract', html`<a href="#/contracts/${c.id}">${c.no}</a> · ${c.status}`)}${row('Visit', `${v.n} of ${v.of}`)}${row('Planned', fmtDate(v.plannedDate))}
        ${row('Agreed with customer', v.confirmedDate ? `${fmtDate(v.confirmedDate)}${v.confirmedVia ? ` · ${v.confirmedVia}` : ''}` : '')}
        ${row('Technician', v.technicianId ? `${empName(v.technicianId)}${v.helperIds?.length ? ` + ${v.helperIds.map(empName).join(', ')}` : ''}` : '')}
        ${row('Hours', `${v.workHours} team-hours + ${v.travelHours} h travel${v.days > 1 ? ` · ${v.days} days` : ''}`)}
        ${row('Service report', s?.signedAt ? v.reportNo : '')}
        <div class="form-sec">Customer</div>
        ${row('Customer', v.customer)}${row('Contact', [v.contact, v.phone].filter(Boolean).join(' · '))}
        <div class="form-sec">Site</div>
        ${row('Site', html`${v.site}<br><span class="small muted">${v.address}</span>`)}${row('Zone', zoneLabel(v.zoneId))}${v.access ? row('Access', v.access) : ''}
      </div>
      <div class="e2-main">
        <div class="card"><div class="card-head"><h2>Inspection check list</h2><span class="muted small">${v.shutters.length} shutters · only failed and unchecked items are listed</span></div>
          ${v.steps?.checkInAt ? checklistHtml(v) : html`<div class="muted">The technician fills it on the phone after checking in. Covered shutters: ${v.shutters.map(x => x.tag).join(', ')}.</div>`}</div>
        ${(v.failures || []).length ? html`<div class="card"><div class="card-head"><h2>Failed items</h2></div>
          ${v.failures.map(f => html`<div class="row" style="padding:4px 0;border-top:1px solid var(--line-soft)"><b>${f.tag}</b> ${f.label}${f.note ? ` – ${f.note}` : ''}${f.unsafe ? html` ${pill('Out of service', 'red')}` : ''}</div>`)}
          <div style="margin-top:8px">${repair ? html`New repair enquiry: <a href="#/enquiries/${repair.id}">${repair.no}</a> ${pill(repair.status)}` : ''}${added.length ? html`${repair ? ' · ' : ''}Added to the open ${added.map(e => html`<a href="#/enquiries/${e.id}">${e.no}</a> `)}(same fault reported before)` : ''}</div></div>` : ''}
        <div class="card"><div class="card-head"><h2>On site (from the phone)</h2></div><ul class="chk">
          ${step('On my way', st.onMyWayAt)}${step('Checked in', st.checkInAt)}${step('Safe isolation done', v.safeIsolation ? st.checkInAt : null)}${step('Check list signed by the customer', s?.signedAt)}${step('Checked out', st.checkOutAt)}${step('Checked & filed by the office', v.filedAt)}</ul></div>
        ${s?.signedAt ? html`<div class="card"><div class="card-head"><h2>Customer sign-off</h2></div>
          <div class="kv">${RATINGS.map(([k, label]) => html`<div><div class="k">${label}</div><div class="v">${'★'.repeat(s.ratings[k])}${'☆'.repeat(5 - s.ratings[k])} ${s.ratings[k]}</div></div>`)}
            <div><div class="k">Signed by</div><div class="v">${s.cust.name} · ${s.cust.designation}</div></div><div><div class="k">Checked by</div><div class="v">${s.tech.name}</div></div></div></div>` : ''}
        ${(v.photosBefore || []).length || (v.photosAfter || []).length ? html`<div class="card"><div class="card-head"><h2>Photos</h2></div>
          ${[['Before', v.photosBefore], ['After', v.photosAfter], ['Company stamp', s?.cust?.stampId ? [s.cust.stampId] : []]].filter(([, l]) => l?.length).map(([label, l]) => html`<div class="small muted" style="margin:4px 0">${label}</div><div class="photos">${l.map(p => html`<div class="photo"><img data-media="${p}" alt="${label} photo"></div>`)}</div>`)}</div>` : ''}
        <div class="card"><div class="card-head"><h2>Activity</h2></div>${activityHtml(v, 'amcVisits')}</div>
      </div>
    </div>
  </div>`);
  hydrateImages(el);
  $('#wf', el).onclick = () => openWorkflow(enq);
  $('#sched', el)?.addEventListener('click', () => visitDialog(v));
  $('#file', el)?.addEventListener('click', () => { fileVisit(v.id); toast(`${v.reportNo} checked and filed`); render(); });
  $('#cancelV', el)?.addEventListener('click', () => openModal({
    title: `Cancel visit ${v.n} of ${v.of}`, body: html`<div class="form-lines"><div class="field"><label>Reason</label><input type="text" name="reason" placeholder="e.g. customer cancelled, site closed"></div>
      <p class="small" style="margin-top:8px">The billing plan does not change (question 16 to the team lead).</p></div>`,
    actions: [{ label: 'Keep it' }, { label: 'Cancel visit', kind: 'danger', onClick: b => { cancelVisit(v.id, readForm(b).reason || 'Cancelled'); toast('Visit cancelled'); render(); } }],
  }));
}

// A General Servicing job's check list (job page card).
export const gsChecklistCard = j => html`<div class="card"><div class="card-head"><h2>Inspection check list</h2>${signOf('jobs', j)?.signedAt ? html`<a href="#/jobs/${j.id}/service">Print the service report</a>` : ''}</div>
  ${j.steps?.checkInAt ? checklistHtml(j) : html`<div class="muted">Filled on the phone after check-in. Shutters: ${(j.shutters || []).map(x => x.tag).join(', ')}.</div>`}
  ${(j.failures || []).length ? html`<div style="margin-top:8px">${j.repairEnquiryId ? html`Failed items → repair enquiry <a href="#/enquiries/${j.repairEnquiryId}">${store.get('enquiries', j.repairEnquiryId)?.no}</a>` : ''}
    ${(j.repairAddedTo || []).map(x => html` · added to <a href="#/enquiries/${x}">${store.get('enquiries', x)?.no}</a>`)}</div>` : ''}</div>`;
