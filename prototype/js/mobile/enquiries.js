// Phone: the enquiry list (search, tiles, ＋ New when the role may create on the phone) and an enquiry with its product
// lines, Edit, the technician assignment (roles that may edit all assessments on the phone) and its workflow.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, debounce, tiles, pill, fmtDateTime, icon, readForm, toast, dateInput, timeInput, joinDateTime, fieldError } from '../core/ui.js';
import { cleanLines } from '../core/enquiries.js';
import { techniciansFor, assignTechnician, enquiryGroups } from '../core/inspections.js';
import { vsLabel, zoneLabel, empName } from '../core/lookups.js';
import { enquiryTiles } from '../web/enquiry-list.js';
import { workflowHtml } from '../web/enquiry-view.js';
import { callBtn } from './parts.js';

const KEY = 'rsmEnqFilters';

export function mEnquiries(page) {
  page.setTitle('Enquiries');
  if (!auth.can('enquiry', 'view', 'mobile')) { page.body.innerHTML = '<div class="empty">Your role cannot see enquiries on the phone.</div>'; return; }
  const state = { tile: '', q: '', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') };
  page.body.innerHTML = String(html`<input type="search" class="m-search" id="q" aria-label="Search enquiries" placeholder="Search enquiries" value="${state.q || ''}"><div id="tiles"></div><div id="list"></div>
    ${auth.can('enquiry', 'create', 'mobile') ? html`<a class="m-fab" href="#/m/enquiry-new" aria-label="New enquiry" title="New enquiry">${icon('plus', 26)}</a>` : ''}`);
  function paint() {
    const all = store.list('enquiries').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const defs = enquiryTiles(all, auth.company()).slice(0, 3);
    $('#tiles', page.body).innerHTML = String(tiles(defs, state.tile, 'm-tiles'));
    $('#tiles', page.body).querySelectorAll('.tile').forEach(t => t.setAttribute('aria-pressed', t.classList.contains('sel') ? 'true' : 'false'));
    const tile = enquiryTiles(all, auth.company()).find(t => t.key === state.tile);
    const terms = (state.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(e => (!tile || tile.test(e)) && terms.every(t => [e.no, e.customerName, e.contactName, e.mobile, e.siteName].join(' ').toLowerCase().includes(t)));
    $('#list', page.body).innerHTML = String(html`<p class="m-info">${tile ? `${shown.length} of ${all.length} enquiries · ${tile.label}` : `${shown.length} enquiries`}${tile ? html` · <a href="#" id="allEnq">Show all</a>` : ''}</p>
      ${shown.length ? html`${shown.map(e => html`<a class="m-card m-list-link" href="#/m/enquiry/${e.id}">
      <div class="row">${pill(e.status)}<span class="grow"></span><span class="small muted">${fmtDateTime(e.receivedAt)}</span></div>
      <div class="strong" style="margin-top:4px">${e.customerName}</div>
      <div class="small muted">${e.no} · ${vsLabel('ENQ_TYPE', e.type)} · ${e.siteName}</div></a>`)}` : html`<div class="empty">No enquiries match.</div>`}`);
    sessionStorage.setItem(KEY, JSON.stringify(state));
  }
  on(page.body, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  on(page.body, 'click', '#allEnq', e => { e.preventDefault(); state.tile = ''; paint(); });
  $('#q', page.body).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}

export function mEnquiry(page, id) {
  const e = store.get('enquiries', id);
  page.setTitle(e ? [e.customerName, e.siteName].filter(Boolean).join(' · ') : 'Enquiry', 'm/enquiries', e ? `${e.no} · ${vsLabel('ENQ_TYPE', e.type)}` : '');
  if (!e || !auth.can('enquiry', 'view', 'mobile')) { page.body.innerHTML = '<div class="empty">Enquiry not found.</div>'; return; }
  const insp = e.inspectionId ? store.get('inspections', e.inspectionId) : null;
  // Roles that may edit job assessments on the phone (all of them, not only their own) can assign the technician here.
  const canAssign = insp && ['To assign', 'Assigned'].includes(insp.status) && auth.can('inspection', 'edit', 'mobile') && auth.scope('inspection') !== 'own';
  const visit = insp?.visitAt ? new Date(insp.visitAt) : null;
  page.body.innerHTML = String(html`
    <div class="m-card">
      <div class="row">${pill(e.status)}<span class="grow"></span><span class="small muted">${vsLabel('ENQ_TYPE', e.type)}</span></div>
      <div class="strong" style="margin-top:6px">${e.customerName}</div>
      <div class="muted small">${e.siteName} · Zone ${zoneLabel(e.zoneId)}</div>
      <div class="muted small">${[e.contactName, e.mobile].filter(Boolean).join(' ')}</div>
      <div class="m-acts">${callBtn(e.mobile)}</div>
    </div>
    <div class="m-section">What the customer needs</div>
    ${cleanLines(e.lines).map(l => html`<div class="m-line">${l.itemName ? html`<b>${l.qty} ${l.unit && l.unit !== 'Nos' ? l.unit : '×'} ${l.itemName}</b><br>` : ''}<span class="${l.itemName ? 'small muted' : ''}">${l.description}</span></div>`)}
    <div class="m-card small">Received ${fmtDateTime(e.receivedAt)} by ${vsLabel('ENQ_CHANNEL', e.channel)} · Priority ${vsLabel('PRIORITY', e.priority)} · ${vsLabel('ENQ_STATUS', e.enquiryStatus)}
      ${insp && insp.status !== 'Cancelled' ? html`<br>Job assessment: ${insp.status}${insp.technicianId ? ` · ${empName(insp.technicianId)} · ${fmtDateTime(insp.visitAt)}` : ''}` : ''}</div>
    ${canAssign ? html`<div class="m-section">Assign technician</div>
      <form class="m-card m-fields" id="asg" onsubmit="return false">
        <div class="field"><label for="asgTech">Technician</label><select id="asgTech" name="technicianId">${techniciansFor(insp.zoneId, insp.visitAt || new Date().toISOString(), enquiryGroups(e)).map(x => html`<option value="${x.tech.id}" ${x.tech.id === insp.technicianId ? 'selected' : ''}>${x.tech.name}${x.match ? ' · covers the zone' : ''}${x.missing.length ? ' · not all products' : ''}${x.visits ? ` · ${x.visits} visit(s) that day` : ''}</option>`)}</select></div>
        <div class="row"><div class="field grow"><label for="asgDate">Visit date</label><input type="date" id="asgDate" name="visitDate" value="${visit ? dateInput(visit) : dateInput()}"></div><div class="field"><label for="asgTime">Time</label><input type="time" id="asgTime" name="visitTime" value="${visit ? timeInput(visit) : '10:00'}"></div></div>
        <div class="field"><label for="asgBy">Confirmed with the customer by</label><select id="asgBy" name="confirmedBy">${['Call', 'WhatsApp', 'Email', 'SMS'].map(x => html`<option ${x === insp.confirmedBy ? 'selected' : ''}>${x}</option>`)}</select></div>
        <button class="btn primary block" id="saveAsg">Save assignment</button></form>` : ''}
    <div class="m-section">Workflow</div>${workflowHtml(e, { vertical: true })}`);
  if (auth.can('enquiry', 'edit', 'mobile') && !['Cancelled', 'Closed', 'Lost'].includes(e.status)) page.setFoot(html`<a class="btn primary" href="#/m/enquiry/${e.id}/edit">${icon('edit', 18)} Edit enquiry</a>`);
  $('#saveAsg', page.body)?.addEventListener('click', () => {
    const form = $('#asg', page.body);
    const d = readForm(form);
    if (!d.visitDate) { fieldError($('[name="visitDate"]', form), 'Enter the visit date'); return; }
    if (!d.visitTime) { fieldError($('[name="visitTime"]', form), 'Enter the time'); return; }
    assignTechnician(insp.id, { technicianId: d.technicianId, visitAt: joinDateTime(d.visitDate, d.visitTime), confirmedBy: d.confirmedBy, notes: insp.notes || '' });
    toast(`${empName(d.technicianId)} assigned`);
    mEnquiry(page, id);
  });
}
