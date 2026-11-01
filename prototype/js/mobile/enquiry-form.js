// Phone: a new or edited sales enquiry, for roles that may create / edit enquiries on the phone (Menu Access).
// The same rules as the web form: customer search or quick-create, contact, mobile (required), site or a new site,
// type, product lines (Product, Qty, Unit, Description), and the site inspection with a technician.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, readForm, markInvalid, toast, confirmBox, dateInput, timeInput, joinDateTime, icon, MIC } from '../core/ui.js';
import { vsOptions, zones, itemChoices, itemName, productInfo } from '../core/lookups.js';
import { findDuplicates, primaryContact } from '../core/customers.js';
import { saveNewEnquiry, saveEnquiryChanges, cleanLines } from '../core/enquiries.js';
import { techniciansFor } from '../core/inspections.js';
import { bindMics } from '../core/capture.js';

const CONFIRM_BY = ['Call', 'WhatsApp', 'Email', 'SMS'];
const PREFILL_KEY = 'rsmNewEnqCustomer'; // "New enquiry" from a customer's page
const seg = (name, options, value) => html`<div class="m-seg">${options.map(o => html`<label><input type="radio" name="${name}" value="${o.value}" ${String(o.value) === String(value) ? 'checked' : ''}><span>${o.label}</span></label>`)}</div>`;
const fld = (label, input, req = false) => html`<div class="field"><label>${label}${req ? html` <span class="req">*</span>` : ''}</label>${input}</div>`;
const blankLine = () => ({ itemRef: '', itemName: '', qty: null, unit: '', description: '' });

export function mEnquiryForm(page, id) {
  const enq = id ? store.get('enquiries', id) : null;
  page.setTitle(enq ? `Edit ${enq.no}` : 'New enquiry', enq ? `m/enquiry/${enq.id}` : 'm/enquiries');
  if ((id && !enq) || !auth.can('enquiry', enq ? 'edit' : 'create', 'mobile')) { page.body.innerHTML = '<div class="empty">Your role cannot do this on the phone.</div>'; return; }
  const insp = enq?.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const assignable = !insp || ['To assign', 'Assigned', 'Cancelled'].includes(insp.status);
  const now = new Date(enq ? enq.receivedAt : Date.now());
  const visit = insp?.visitAt ? new Date(insp.visitAt) : null;
  const pre = !enq ? sessionStorage.getItem(PREFILL_KEY) : '';
  sessionStorage.removeItem(PREFILL_KEY);
  const st = {
    customerId: enq?.customerId || pre || '', newCustomer: false, newName: '', q: '',
    contactName: enq?.contactName || '', mobile: enq?.mobile || '', email: enq?.email || '',
    siteId: enq?.siteId || '', newSite: false, siteName: '', siteAddress: '', siteZone: '',
    type: enq?.type || 'REPAIR', channel: enq?.channel || 'CALL', channelOther: enq?.channelOther || '', enquiryStatus: enq?.enquiryStatus || 'WARM', priority: enq?.priority || 'MEDIUM',
    lines: enq?.lines?.length ? enq.lines.map(l => ({ ...l })) : [blankLine()], remarks: enq?.remarks || '',
    // Like the web form, the Type sets Site inspection (Repair: Yes; AMC, General Servicing: No) until it is changed by hand.
    siteInspection: enq?.siteInspection || 'YES', inspectionTouched: !!enq, technicianId: insp?.technicianId || '', visitDate: visit ? dateInput(visit) : '', visitTime: visit ? timeInput(visit) : '', confirmedBy: insp?.confirmedBy || 'Call',
  };
  if (st.customerId && !enq) fillContact(store.get('customers', st.customerId));

  function fillContact(c) {
    const p = primaryContact(c);
    Object.assign(st, { contactName: p?.name || '', mobile: p?.mobile || c?.phone || '', email: p?.email || c?.email || '', siteId: c?.sites?.[0]?.id || '', newSite: !(c?.sites || []).length });
  }
  // Keep what is typed before the form is drawn again.
  function collect() {
    const f = $('#mf', page.body);
    if (!f) return;
    const d = readForm(f);
    ['newName', 'contactName', 'mobile', 'email', 'siteName', 'siteAddress', 'siteZone', 'type', 'channel', 'channelOther', 'enquiryStatus', 'priority', 'remarks',
      'siteInspection', 'technicianId', 'visitDate', 'visitTime', 'confirmedBy'].forEach(k => { if (k in d) st[k] = d[k]; });
    if ('siteId' in d) { st.newSite = d.siteId === '__new'; if (!st.newSite) st.siteId = d.siteId; }
    st.lines = $$('[data-line]', f).map(row => {
      const ref = $('[data-c="item"]', row).value;
      return { itemRef: ref, itemName: itemName(ref), qty: ref ? Number($('[data-c="qty"]', row).value) || 1 : null,
        unit: ref ? ($('[data-c="unit"]', row).value.trim() || productInfo(ref)?.unit || 'Nos') : '', description: $('[data-c="desc"]', row).value.trim() };
    });
  }

  function customerPart() {
    const c = st.customerId ? store.get('customers', st.customerId) : null;
    if (enq || c) {
      return html`<div class="m-card"><b>${c.name}</b> <span class="muted small">${c.code}</span>${!enq ? html` <button type="button" class="btn link small" id="changeCust">Change</button>` : ''}</div>`;
    }
    if (st.newCustomer) return html`${fld('New customer', html`<input name="newName" value="${st.newName}" placeholder="Company or person">`, true)}<button type="button" class="btn link small" id="pickCust">Choose an existing customer</button>`;
    return html`${fld('Customer', html`<input type="search" id="custQ" value="${st.q}" placeholder="Name, code, mobile or email" autocomplete="off">`, true)}
      <div id="custRes">${custResults()}</div>
      <button type="button" class="btn link small" id="newCust">${icon('plus', 14)} New customer</button>`;
  }
  // Search results only: redrawn on their own while typing, so nothing else on the form is touched.
  function custResults() {
    const hits = st.q ? store.list('customers', x => x.status !== 'Inactive' && [x.name, x.code, x.phone, x.email, ...(x.contacts || []).flatMap(p => [p.name, p.mobile, p.email])].join(' ').toLowerCase().includes(st.q.toLowerCase())).slice(0, 6) : [];
    return html`${hits.map(x => html`<button type="button" class="m-line" style="display:block;width:100%;text-align:left;border:0" data-pick="${x.id}"><b>${x.name}</b><br><span class="small muted">${x.code} · ${primaryContact(x)?.mobile || x.phone || ''}</span></button>`)}`;
  }
  function sitePart() {
    const c = st.customerId ? store.get('customers', st.customerId) : null;
    const sites = c?.sites || [];
    const newSite = st.newCustomer || st.newSite || !sites.length;
    return html`${sites.length && !st.newCustomer ? fld('Site', html`<select name="siteId">${sites.map(s => html`<option value="${s.id}" ${s.id === st.siteId && !st.newSite ? 'selected' : ''}>${s.name}</option>`)}<option value="__new" ${st.newSite ? 'selected' : ''}>＋ New site</option></select>`, true) : ''}
      ${newSite ? html`${fld('Site name', html`<input name="siteName" value="${st.siteName}" placeholder="e.g. Main warehouse">`, true)}
        ${fld('Address', html`<input name="siteAddress" value="${st.siteAddress}">`)}
        ${fld('Zone', html`<select name="siteZone"><option value="">Not set yet</option>${zones().map(z => html`<option value="${z.id}" ${z.id === st.siteZone ? 'selected' : ''}>Zone ${z.code} · ${z.name}</option>`)}</select>`)}` : ''}`;
  }
  const zoneNow = () => (st.newCustomer || st.newSite ? st.siteZone : store.get('customers', st.customerId)?.sites?.find(s => s.id === st.siteId)?.zoneId || '');
  function linesPart() {
    const choices = itemChoices();
    return html`${st.lines.map((l, i) => html`<div class="m-line" data-line="${i}">
      <div class="row"><select data-c="item" class="grow" aria-label="Product"><option value="">No product</option>${choices.map(g => html`<optgroup label="${g.group}">${g.options.map(o => html`<option value="${o.value}" ${o.value === l.itemRef ? 'selected' : ''}>${o.label}</option>`)}</optgroup>`)}</select>
        <button type="button" class="btn small" data-rm="${i}" aria-label="Remove this line">－</button></div>
      ${l.itemRef ? html`<div class="row" style="margin-top:6px"><input type="number" min="1" data-c="qty" value="${l.qty || 1}" style="width:80px" aria-label="Quantity"><input data-c="unit" value="${l.unit || productInfo(l.itemRef)?.unit || 'Nos'}" style="width:80px" aria-label="Unit"><span class="small muted grow">${productInfo(l.itemRef)?.code || ''}</span></div>`
        : html`<input type="hidden" data-c="qty" value=""><input type="hidden" data-c="unit" value="">`}
      <div class="with-mic" style="margin-top:6px"><input data-c="desc" name="line_desc_${i}" value="${l.description}" placeholder="${l.itemRef ? 'Where / what is wrong' : 'Describe what the customer needs'}"><button type="button" class="mic" data-mic="line_desc_${i}" title="Voice input">${MIC}</button></div>
    </div>`)}<button type="button" class="add-dashed" id="addLine">${icon('plus', 14)} Add a line</button>`;
  }
  function nextPart() {
    if (!assignable) return html`<div class="m-card small">Site inspection: ${insp.status} · change it from the site inspection.</div>`;
    const yes = st.siteInspection === 'YES';
    const opts = techniciansFor(zoneNow(), st.visitDate ? joinDateTime(st.visitDate, st.visitTime) : new Date().toISOString());
    return html`${fld('Site inspection', seg('siteInspection', vsOptions('YES_NO'), st.siteInspection))}
      ${yes ? html`${fld('Technician', html`<select name="technicianId"><option value="">Assign later</option>${opts.map(x => html`<option value="${x.tech.id}" ${x.tech.id === st.technicianId ? 'selected' : ''}>${x.tech.name}${x.match ? ' · covers the zone' : ''}</option>`)}</select>`)}
        <div class="row">${fld('Visit date', html`<input type="date" name="visitDate" value="${st.visitDate}">`)}${fld('Time', html`<input type="time" name="visitTime" value="${st.visitTime}">`)}</div>
        ${fld('Confirmed by', html`<select name="confirmedBy">${CONFIRM_BY.map(x => html`<option ${x === st.confirmedBy ? 'selected' : ''}>${x}</option>`)}</select>`)}` : ''}`;
  }

  function paint() {
    page.body.innerHTML = String(html`<form id="mf" class="m-fields" onsubmit="return false">
      <div class="m-section" style="margin-top:0">Customer</div>${customerPart()}
      ${st.customerId || st.newCustomer ? html`<div class="row">${fld('Contact', html`<input name="contactName" value="${st.contactName}" list="mContacts">`, true)}${fld('Mobile', html`<input type="tel" name="mobile" value="${st.mobile}">`, true)}</div>
        <datalist id="mContacts">${(store.get('customers', st.customerId)?.contacts || []).map(p => html`<option value="${p.name}">`)}</datalist>
        ${fld('Email', html`<input type="email" name="email" value="${st.email}">`)}
        <div class="m-section">Site</div>${sitePart()}` : ''}
      <div class="m-section">Enquiry</div>
      ${fld('Type', seg('type', vsOptions('ENQ_TYPE'), st.type), true)}
      ${fld('Channel', html`<select name="channel">${vsOptions('ENQ_CHANNEL').map(o => html`<option value="${o.value}" ${o.value === st.channel ? 'selected' : ''}>${o.label}</option>`)}</select>`)}
      ${st.channel === 'OTHER' ? fld('Specify channel', html`<input name="channelOther" value="${st.channelOther}">`, true) : ''}
      ${fld('Status', seg('enquiryStatus', vsOptions('ENQ_STATUS'), st.enquiryStatus))}
      ${fld('Priority', seg('priority', vsOptions('PRIORITY'), st.priority))}
      <div class="m-section">What the customer needs</div>${linesPart()}
      <div style="margin-top:10px">${fld('Remarks', html`<input name="remarks" value="${st.remarks}" placeholder="Internal note (optional)">`)}</div>
      <div class="m-section">Next step</div>${nextPart()}
    </form>`);
    bindMics(page.body);
  }
  const redraw = () => { collect(); paint(); };

  page.body.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.pick) { collect(); st.customerId = t.dataset.pick; st.q = ''; fillContact(store.get('customers', st.customerId)); paint(); return; }
    if (t.id === 'newCust') { collect(); Object.assign(st, { newCustomer: true, customerId: '', siteId: '', newSite: true }); paint(); return; }
    if (t.id === 'pickCust' || t.id === 'changeCust') { collect(); Object.assign(st, { newCustomer: false, customerId: '', q: '' }); paint(); return; }
    if (t.id === 'addLine') { collect(); st.lines.push(blankLine()); paint(); return; }
    if (t.dataset.rm) { collect(); st.lines.splice(+t.dataset.rm, 1); if (!st.lines.length) st.lines.push(blankLine()); paint(); }
  });
  page.body.addEventListener('input', e => { if (e.target.id === 'custQ') { st.q = e.target.value; $('#custRes', page.body).innerHTML = String(custResults()); } });
  page.body.addEventListener('change', e => {
    const n = e.target.name || e.target.dataset.c;
    if (n === 'item') { collect(); const row = st.lines[+e.target.closest('[data-line]').dataset.line]; row.unit = productInfo(row.itemRef)?.unit || ''; paint(); }
    else if (n === 'type') { collect(); if (!st.inspectionTouched) st.siteInspection = st.type === 'REPAIR' ? 'YES' : 'NO'; paint(); }
    else if (n === 'siteInspection') { st.inspectionTouched = true; redraw(); }
    else if (['siteId', 'siteZone', 'channel', 'visitDate'].includes(n)) redraw();
    else if (n === 'contactName') {
      const p = (store.get('customers', st.customerId)?.contacts || []).find(x => x.name === e.target.value);
      if (p) { $('[name="mobile"]', page.body).value = p.mobile || ''; $('[name="email"]', page.body).value = p.email || ''; }
    }
  });

  async function save(e) {
    const btn = e.currentTarget;
    btn.disabled = true; // a double tap saves once
    try { await saveNow(); } finally { if (document.body.contains(btn)) btn.disabled = false; }
  }
  async function saveNow() {
    collect();
    const f = $('#mf', page.body);
    if (!enq && !st.customerId && !st.newCustomer) { toast('Choose the customer, or add a new one', 'bad'); return; }
    const missing = ['contactName', 'mobile'].filter(k => !st[k]);
    if (st.newCustomer && !st.newName) missing.push('newName');
    if ((st.newCustomer || st.newSite) && !st.siteName) missing.push('siteName');
    if (st.channel === 'OTHER' && !st.channelOther) missing.push('channelOther');
    if (!markInvalid(f, missing)) { toast('Fill in the required fields', 'bad'); return; }
    const lines = cleanLines(st.lines);
    if (!lines.length) { toast('Add at least one line: a product or a description of what the customer needs', 'bad'); return; }
    if (st.newCustomer && findDuplicates({ name: st.newName, mobile: st.mobile, email: st.email }).length
      && !(await confirmBox('Possible duplicate', 'A customer with the same mobile, email or name already exists. Create a new customer anyway?', 'Create new'))) return;
    const c = st.customerId ? store.get('customers', st.customerId) : null;
    const contact = (c?.contacts || []).find(x => x.name === st.contactName);
    const data = {
      receivedAt: enq ? enq.receivedAt : joinDateTime(dateInput(now), timeInput(now)), channel: st.channel, channelOther: st.channel === 'OTHER' ? st.channelOther : '', type: st.type,
      enquiryStatus: st.enquiryStatus, priority: st.priority, siteInspection: st.siteInspection, recordedBy: enq?.recordedBy || auth.user().id,
      customerId: st.customerId, contactId: contact?.id || '', contactName: st.contactName, mobile: st.mobile, email: st.email, siteId: st.newSite || st.newCustomer ? '' : st.siteId,
      lines, remarks: st.remarks, attachments: enq?.attachments || [],
    };
    const newSite = st.newCustomer || st.newSite ? { name: st.siteName, address: st.siteAddress || st.siteName, blockUnit: '', zoneId: st.siteZone || '' } : null;
    const newCustomer = st.newCustomer ? { name: st.newName, contactName: st.contactName, mobile: st.mobile, email: st.email } : null;
    const assign = assignable && st.siteInspection === 'YES' && st.technicianId
      ? { technicianId: st.technicianId, visitAt: st.visitDate ? joinDateTime(st.visitDate, st.visitTime) : null, confirmedBy: st.confirmedBy } : null;
    const saved = enq ? saveEnquiryChanges(enq.id, data, { newSite, assign }) : saveNewEnquiry(data, { newCustomer, newSite, assign });
    toast(`${saved.no} saved · ${saved.status}`);
    go(`m/enquiry/${saved.id}`);
  }

  paint();
  const foot = page.setFoot(html`<a class="btn" href="#/${enq ? `m/enquiry/${enq.id}` : 'm/enquiries'}">Cancel</a><button class="btn primary" id="saveEnq">${enq ? 'Save changes' : 'Save enquiry'}</button>`);
  $('#saveEnq', foot).onclick = save;
}

// "New enquiry" from a customer's page opens the form with that customer chosen.
export const newEnquiryFor = customerId => { sessionStorage.setItem(PREFILL_KEY, customerId); go('m/enquiry-new'); };
