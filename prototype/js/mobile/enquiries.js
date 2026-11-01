// Phone: the enquiry list (search, tiles, ＋ New when the role may create on the phone) and an enquiry with its product
// lines, Edit, the technician assignment (roles that may edit all inspections on the phone) and its workflow.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, debounce, tiles, pill, fmtDateTime, icon, readForm, toast, dateInput, timeInput, joinDateTime } from '../core/ui.js';
import { cleanLines } from '../core/enquiries.js';
import { techniciansFor, assignTechnician } from '../core/inspections.js';
import { vsLabel, zoneLabel, empName } from '../core/lookups.js';
import { enquiryTiles } from '../web/enquiry-list.js';
import { workflowHtml } from '../web/enquiry-view.js';

const KEY = 'rsmEnqFilters';

export function mEnquiries(page) {
  page.setTitle('Enquiries');
  if (!auth.can('enquiry', 'view', 'mobile')) { page.body.innerHTML = '<div class="empty">Your role cannot see enquiries on the phone.</div>'; return; }
  const state = { tile: '', q: '', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') };
  page.body.innerHTML = String(html`<input type="search" class="m-search" id="q" placeholder="Search enquiries" value="${state.q || ''}"><div id="tiles"></div><div id="list"></div>
    ${auth.can('enquiry', 'create', 'mobile') ? html`<a class="m-fab" href="#/m/enquiry-new" aria-label="New enquiry" title="New enquiry">${icon('plus', 24)}</a>` : ''}`);
  function paint() {
    const all = store.list('enquiries').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const defs = enquiryTiles(all, auth.company()).slice(0, 3);
    $('#tiles', page.body).innerHTML = String(tiles(defs, state.tile, 'm-tiles'));
    const tile = enquiryTiles(all, auth.company()).find(t => t.key === state.tile);
    const terms = (state.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(e => (!tile || tile.test(e)) && terms.every(t => [e.no, e.customerName, e.contactName, e.mobile, e.siteName].join(' ').toLowerCase().includes(t)));
    $('#list', page.body).innerHTML = String(shown.length ? html`${shown.map(e => html`<a class="m-card" style="display:block;color:inherit;text-decoration:none" href="#/m/enquiry/${e.id}">
      <div class="row">${pill(e.status)}<span class="grow"></span><span class="small muted">${fmtDateTime(e.receivedAt)}</span></div>
      <div class="strong" style="margin-top:4px">${e.customerName}</div>
      <div class="small muted">${e.no} · ${vsLabel('ENQ_TYPE', e.type)} · ${e.siteName}</div></a>`)}` : html`<div class="empty">No enquiries match.</div>`);
    sessionStorage.setItem(KEY, JSON.stringify(state));
  }
  on(page.body, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  $('#q', page.body).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}

export function mEnquiry(page, id) {
  const e = store.get('enquiries', id);
  page.setTitle(e ? e.no : 'Enquiry', 'm/enquiries');
  if (!e || !auth.can('enquiry', 'view', 'mobile')) { page.body.innerHTML = '<div class="empty">Enquiry not found.</div>'; return; }
  const insp = e.inspectionId ? store.get('inspections', e.inspectionId) : null;
  // Roles that may edit site inspections on the phone (all of them, not only their own) can assign the technician here.
  const canAssign = insp && ['To assign', 'Assigned'].includes(insp.status) && auth.can('inspection', 'edit', 'mobile') && auth.scope('inspection') !== 'own';
  const visit = insp?.visitAt ? new Date(insp.visitAt) : null;
  page.body.innerHTML = String(html`
    <div class="m-card">
      <div class="row">${pill(e.status)}<span class="grow"></span><span class="small muted">${vsLabel('ENQ_TYPE', e.type)}</span></div>
      <div class="strong" style="margin-top:6px;font-size:16px">${e.customerName}</div>
      <div class="muted small">${e.siteName} · Zone ${zoneLabel(e.zoneId)}</div>
      <div class="m-acts">${e.mobile ? html`<a class="btn" href="tel:${e.mobile.replace(/\s/g, '')}">${icon('call', 15)} ${e.contactName}</a>` : ''}</div>
    </div>
    <div class="m-section">What the customer needs</div>
    ${cleanLines(e.lines).map(l => html`<div class="m-line">${l.itemName ? html`<b>${l.qty} ${l.unit && l.unit !== 'Nos' ? l.unit : '×'} ${l.itemName}</b><br>` : ''}<span class="${l.itemName ? 'small muted' : ''}">${l.description}</span></div>`)}
    <div class="m-card small">Received ${fmtDateTime(e.receivedAt)} by ${vsLabel('ENQ_CHANNEL', e.channel)} · Priority ${vsLabel('PRIORITY', e.priority)} · ${vsLabel('ENQ_STATUS', e.enquiryStatus)}
      ${insp && insp.status !== 'Cancelled' ? html`<br>Site inspection: ${insp.status}${insp.technicianId ? ` · ${empName(insp.technicianId)} · ${fmtDateTime(insp.visitAt)}` : ''}` : ''}</div>
    ${canAssign ? html`<div class="m-section">Assign technician</div>
      <form class="m-card m-fields" id="asg" onsubmit="return false">
        <div class="field"><label>Technician</label><select name="technicianId">${techniciansFor(insp.zoneId, insp.visitAt || new Date().toISOString()).map(x => html`<option value="${x.tech.id}" ${x.tech.id === insp.technicianId ? 'selected' : ''}>${x.tech.name}${x.match ? ' · covers the zone' : ''}${x.visits ? ` · ${x.visits} visit(s) that day` : ''}</option>`)}</select></div>
        <div class="row"><div class="field grow"><label>Visit date</label><input type="date" name="visitDate" value="${visit ? dateInput(visit) : dateInput()}"></div><div class="field"><label>Time</label><input type="time" name="visitTime" value="${visit ? timeInput(visit) : '10:00'}"></div></div>
        <div class="field"><label>Confirmed with the customer by</label><select name="confirmedBy">${['Call', 'WhatsApp', 'Email', 'SMS'].map(x => html`<option ${x === insp.confirmedBy ? 'selected' : ''}>${x}</option>`)}</select></div>
        <button class="btn primary block" id="saveAsg">Save assignment</button></form>` : ''}
    <div class="m-section">Workflow</div>${workflowHtml(e, { vertical: true })}`);
  if (auth.can('enquiry', 'edit', 'mobile') && !['Cancelled', 'Closed', 'Lost'].includes(e.status)) page.setFoot(html`<a class="btn primary" href="#/m/enquiry/${e.id}/edit">${icon('edit', 15)} Edit enquiry</a>`);
  $('#saveAsg', page.body)?.addEventListener('click', () => {
    const d = readForm($('#asg', page.body));
    if (!d.visitDate || !d.visitTime) { toast('Enter the visit date and time', 'bad'); return; }
    assignTechnician(insp.id, { technicianId: d.technicianId, visitAt: joinDateTime(d.visitDate, d.visitTime), confirmedBy: d.confirmedBy, notes: insp.notes || '' });
    toast(`${empName(d.technicianId)} assigned`);
    mEnquiry(page, id);
  });
}
