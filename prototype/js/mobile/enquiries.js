// Phone: enquiry list (search + tiles) and a read-only enquiry with its transaction workflow.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, debounce, tiles, pill, fmtDateTime } from '../core/ui.js';
import { vsLabel, zoneLabel, empName } from '../core/lookups.js';
import { enquiryTiles } from '../web/enquiry-list.js';
import { workflowHtml } from '../web/enquiry-view.js';

const KEY = 'rsmEnqFilters';

export function mEnquiries(page) {
  page.setTitle('Enquiries');
  if (!auth.can('enquiry', 'view', 'mobile')) { page.body.innerHTML = '<div class="empty">Your role cannot see enquiries on the phone.</div>'; return; }
  const state = { tile: '', q: '', ...JSON.parse(sessionStorage.getItem(KEY) || '{}') };
  page.body.innerHTML = String(html`<input type="search" class="m-search" id="q" placeholder="Search enquiries" value="${state.q || ''}"><div id="tiles"></div><div id="list"></div>`);
  function paint() {
    const all = store.list('enquiries').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const defs = enquiryTiles(all, auth.company()).slice(0, 3);
    $('#tiles', page.body).innerHTML = String(tiles(defs, state.tile, 'm-tiles'));
    const tile = enquiryTiles(all, auth.company()).find(t => t.key === state.tile);
    const terms = (state.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(e => (!tile || tile.test(e)) && terms.every(t => [e.no, e.customerName, e.contactName, e.mobile, e.siteName].join(' ').toLowerCase().includes(t)));
    $('#list', page.body).innerHTML = String(shown.length ? html`${shown.map(e => html`<a class="m-card" style="display:block;color:inherit;text-decoration:none" href="#/m/enquiry/${e.id}">
      <div class="row"><b>${e.no}</b><span class="grow"></span>${pill(e.status)}</div><div>${e.customerName}</div>
      <div class="small muted">${vsLabel('ENQ_TYPE', e.type)} · ${e.siteName} · ${fmtDateTime(e.receivedAt)}</div></a>`)}` : html`<div class="empty">No enquiries match.</div>`);
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
  page.body.innerHTML = String(html`
    <div class="row">${pill(e.status)}<span class="grow"></span><span class="small muted">${vsLabel('ENQ_TYPE', e.type)}</span></div>
    <h2 style="margin:8px 0 2px">${e.customerName}</h2><div class="muted">${e.siteName} · Zone ${zoneLabel(e.zoneId)}</div>
    <div class="m-card" style="margin-top:10px"><div class="small muted">Contact</div>${e.contactName} · ${e.mobile ? html`<a href="tel:${e.mobile.replace(/\s/g, '')}">${e.mobile}</a>` : ''}</div>
    <div class="m-card"><div class="small muted">Description</div>${e.description}</div>
    <div class="m-card small">Received ${fmtDateTime(e.receivedAt)} by ${vsLabel('ENQ_CHANNEL', e.channel)} · Priority ${vsLabel('PRIORITY', e.priority)} · ${vsLabel('ENQ_STATUS', e.enquiryStatus)}
      ${insp && insp.status !== 'Cancelled' ? html`<br>Site inspection: ${insp.status}${insp.technicianId ? ` · ${empName(insp.technicianId)} · ${fmtDateTime(insp.visitAt)}` : ''}` : ''}</div>
    <div class="m-section">Workflow</div>${workflowHtml(e, { vertical: true })}`);
}
