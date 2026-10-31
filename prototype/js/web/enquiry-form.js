// New / edit enquiry: the register's first block (Enquiry No … Site Inspection), with
// paste-an-email intake, customer type-ahead + quick-create + duplicate check, zone from the site, attachments.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, field, readForm, markInvalid, openModal, confirmBox, toast, dateInput, timeInput, joinDateTime } from '../core/ui.js';
import { vsOptions, vsLabel, zones, zoneLabel } from '../core/lookups.js';
import { findDuplicates, primaryContact } from '../core/customers.js';
import { saveNewEnquiry, saveEnquiryChanges } from '../core/enquiries.js';
import { parseEmail, SAMPLE_EMAIL } from '../core/intake.js';
import { saveBlob, removeBlob, getUrl, fmtSize } from '../core/media.js';
import { bindMics } from '../core/capture.js';
import { pageHead } from './shell.js';

const MAX_FILE = 10 * 1024 * 1024;

export function renderEnquiryForm(el, id) {
  const enq = id ? store.get('enquiries', id) : null;
  if (id && !enq) { el.innerHTML = '<div class="page"><div class="empty">Enquiry not found.</div></div>'; return; }
  if (!auth.can('enquiry', enq ? 'edit' : 'create')) { el.innerHTML = '<div class="page"><div class="empty">Your role cannot change enquiries.</div></div>'; return; }

  const now = new Date(enq ? enq.receivedAt : Date.now());
  const st = {
    mode: 'existing', customerId: enq?.customerId || '', contactId: enq?.contactId || '',
    siteMode: 'existing', siteId: enq?.siteId || '', siteTouched: !!enq, dupsSeen: '',
    attachments: [...(enq?.attachments || [])], added: [], fromEmail: new Set(),
  };

  el.innerHTML = String(html`<div class="page" style="max-width:1100px">
    ${pageHead({
      crumb: html`<a href="#/enquiries">Sales Enquiry</a> › ${enq ? enq.no : 'New'}`,
      title: enq ? `Edit ${enq.no}` : 'New enquiry',
      sub: enq ? `${enq.customerName} · ${enq.status}` : 'The enquiry number is given automatically when you save.',
      actions: html`<div class="row">${!enq ? html`<button class="btn" id="paste">✉ Paste email</button>` : ''}
        <a class="btn" href="#/${enq ? `enquiries/${enq.id}` : 'enquiries'}">Cancel</a><button class="btn primary" id="save">Save enquiry</button></div>`,
    })}
    <div id="emailNote"></div>
    <form id="f" autocomplete="off" onsubmit="return false">
      <div class="card"><div class="card-head"><h2>Enquiry</h2></div>
        <div class="grid g4">
          ${field({ name: 'no', label: 'Enquiry No', value: enq ? enq.no : `${store.peekNumber('ENQ')} (on save)`, readonly: true })}
          ${field({ name: 'date', label: 'Enquiry Date', type: 'date', value: dateInput(now), required: true })}
          ${field({ name: 'time', label: 'Enquiry Time', type: 'time', value: timeInput(now), required: true })}
          ${field({ name: 'recordedBy', label: 'Recorded By', value: enq ? auth.userName(enq.recordedBy) : auth.user().name, readonly: true })}
          ${field({ name: 'channel', label: 'Enquiry Channel', type: 'select', options: vsOptions('ENQ_CHANNEL'), value: enq?.channel || 'CALL', required: true })}
          ${field({ name: 'type', label: 'Type', type: 'select', options: vsOptions('ENQ_TYPE'), value: enq?.type || 'REPAIR', required: true })}
          ${field({ name: 'enquiryStatus', label: 'Enquiry Status', type: 'select', options: vsOptions('ENQ_STATUS'), value: enq?.enquiryStatus || 'WARM', required: true, hint: 'Sales judgement: Hot / Warm / Cold' })}
          ${field({ name: 'priority', label: 'Priority', type: 'select', options: vsOptions('PRIORITY'), value: enq?.priority || 'MEDIUM', required: true })}
          ${field({ name: 'siteInspection', label: 'Site Inspection', type: 'select', options: vsOptions('YES_NO'), value: enq?.siteInspection || 'YES', required: true })}
          <div class="field span3"><div class="field-label">Next step</div><div id="nextStep" class="note"></div></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Customer</h2><span id="custMode"></span></div><div id="customerBox"></div></div>
      <div class="card"><div class="card-head"><h2>Site</h2><span id="zoneChip"></span></div><div id="siteBox"></div></div>
      <div class="card"><div class="card-head"><h2>Description</h2></div>
        <div class="grid g2">
          ${field({ name: 'description', label: 'Enquiry Description', type: 'textarea', value: enq?.description || '', required: true, mic: true, placeholder: 'What the customer reported' })}
          ${field({ name: 'remarks', label: 'Remarks', type: 'textarea', value: enq?.remarks || '', mic: true })}
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Attachments</h2><label class="btn small">+ Attach files<input type="file" id="files" multiple hidden></label></div>
        <div id="fileList"></div><div class="hint small muted" style="margin-top:6px">For example a BOQ, photos from the customer or the original email. Up to 10 MB each; kept in this browser.</div>
      </div>
    </form>
  </div>`);

  const form = $('#f', el);
  const v = name => $(`[name="${name}"]`, form);

  // ---------- Customer ----------
  function paintCustomer() {
    const c = st.customerId ? store.get('customers', st.customerId) : null;
    $('#custMode', el).innerHTML = enq ? '' : String(html`<div class="seg"><button type="button" data-mode="existing" class="${st.mode === 'existing' ? 'on' : ''}">Existing customer</button><button type="button" data-mode="new" class="${st.mode === 'new' ? 'on' : ''}">+ New customer</button></div>`);
    const keep = (n, first = '') => v(n)?.value ?? first;
    const contactVals = { contactName: keep('contactName', enq?.contactName), mobile: keep('mobile', enq?.mobile), email: keep('email', enq?.email) };
    let top;
    if (st.mode === 'new') {
      top = html`${field({ name: 'newName', label: 'Customer Name', value: keep('newName'), required: true, hint: 'A new customer is quick-created with code CUS-… when you save.' })}`;
    } else if (c) {
      top = html`<div class="field"><div class="field-label">Customer Name</div><div class="row"><b>${c.name}</b><span class="muted">${c.code}</span>
        ${!enq ? html`<button type="button" class="btn link" id="changeCust">Change</button>` : ''}</div></div>`;
    } else {
      top = html`<div class="field" style="position:relative"><label for="custQ">Customer Name <span class="req">*</span></label>
        <input type="search" id="custQ" placeholder="Type name, code, mobile or email" autocomplete="off"><div id="custRes" class="card" style="position:absolute;top:100%;left:0;right:0;z-index:5;padding:4px;display:none"></div></div>`;
    }
    const contacts = c?.contacts || [];
    $('#customerBox', el).innerHTML = String(html`<div class="grid g4">
      <div class="span2">${top}</div>
      ${field({ name: 'contactName', label: 'Contact Person', value: contactVals.contactName, required: true, list: 'contactList' })}
      <datalist id="contactList">${contacts.map(p => html`<option value="${p.name}">`)}</datalist>
      ${field({ name: 'mobile', label: 'Mobile', type: 'tel', value: contactVals.mobile })}
      ${field({ name: 'email', label: 'Email', type: 'email', value: contactVals.email, cls: 'span2' })}
      <div class="span2" id="dupBox"></div>
    </div>`);
    markFromEmail();
    bindCustomer();
    paintSite();
  }

  function bindCustomer() {
    $$('[data-mode]', el).forEach(b => b.onclick = () => { st.mode = b.dataset.mode; st.customerId = ''; st.siteMode = st.mode === 'new' ? 'new' : 'existing'; paintCustomer(); });
    $('#changeCust', el)?.addEventListener('click', () => { st.customerId = ''; st.siteId = ''; paintCustomer(); $('#custQ', el)?.focus(); });
    const q = $('#custQ', el);
    if (q) {
      const res = $('#custRes', el);
      q.addEventListener('input', () => {
        const t = q.value.trim().toLowerCase();
        const hits = t ? store.list('customers', c => c.status !== 'Inactive' && [c.name, c.code, c.phone, c.email, ...(c.contacts || []).flatMap(p => [p.name, p.mobile, p.email])].join(' ').toLowerCase().includes(t)).slice(0, 8) : [];
        res.style.display = t ? 'block' : 'none';
        res.innerHTML = String(hits.length ? html`${hits.map(c => html`<button type="button" class="btn link block" style="justify-content:flex-start" data-pick="${c.id}">${c.name} <span class="muted">· ${c.code} · ${c.phone}</span></button>`)}`
          : html`<div class="muted" style="padding:6px">No customer found. Use “+ New customer”.</div>`);
      });
      res.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) pickCustomer(b.dataset.pick); });
    }
    v('contactName').addEventListener('change', () => {
      const c = st.customerId && store.get('customers', st.customerId);
      const p = c?.contacts.find(x => x.name.toLowerCase() === v('contactName').value.trim().toLowerCase());
      st.contactId = p?.id || '';
      if (p) { v('mobile').value = p.mobile; v('email').value = p.email; }
    });
    ['newName', 'mobile', 'email'].forEach(n => v(n)?.addEventListener('input', checkDuplicates));
    checkDuplicates();
  }

  function pickCustomer(cid, { keepContact } = {}) {
    const c = store.get('customers', cid);
    st.mode = 'existing'; st.customerId = cid; st.siteMode = 'existing';
    st.siteId = c.sites.length === 1 ? c.sites[0].id : '';
    const p = primaryContact(c);
    paintCustomer();
    if (!keepContact && p) { st.contactId = p.id; v('contactName').value = p.name; v('mobile').value = p.mobile; v('email').value = p.email; }
  }

  function checkDuplicates() {
    const box = $('#dupBox', el);
    if (!box) return;
    if (st.mode !== 'new') { box.innerHTML = ''; return; }
    const hits = findDuplicates({ name: v('newName')?.value, mobile: v('mobile').value, email: v('email').value });
    st.dupsSeen = hits.map(h => h.customer.id).join(',');
    box.innerHTML = String(hits.length ? html`<div class="note warn">Possible duplicate: ${hits.map(h => html`<div class="row" style="margin-top:4px"><b>${h.customer.name}</b><span>(${h.customer.code}, ${h.reason})</span>
      <button type="button" class="btn small" data-use="${h.customer.id}">Use this customer</button></div>`)}</div>` : '');
    $$('[data-use]', box).forEach(b => b.onclick = () => pickCustomer(b.dataset.use, { keepContact: true }));
  }

  // ---------- Site (zone comes from the site) ----------
  function paintSite() {
    const c = st.customerId ? store.get('customers', st.customerId) : null;
    const sites = c?.sites || [];
    const keep = n => v(n)?.value ?? '';
    if (st.mode === 'new') st.siteMode = 'new';
    let body;
    if (st.siteMode === 'new') {
      body = html`<div class="grid g4">
        ${field({ name: 'siteName', label: 'Site Location', value: keep('siteName'), required: true, placeholder: 'e.g. IMM Building L1 Shop @ Jurong East' })}
        ${field({ name: 'siteAddress', label: 'Address', value: keep('siteAddress') })}
        ${field({ name: 'siteBlock', label: 'Block / Level / Unit', value: keep('siteBlock') })}
        ${field({ name: 'siteZone', label: 'Zone', type: 'select', options: zones().map(z => ({ value: z.id, label: `${z.code} · ${z.name}` })), value: keep('siteZone'), required: true, hint: 'Zones are kept in the Transport master' })}
      </div>${c ? html`<button type="button" class="btn link" id="pickSite">← Choose one of the customer's sites</button>` : ''}`;
    } else if (c) {
      body = html`<div class="grid g4">
        ${field({ name: 'siteId', label: 'Site Location', type: 'select', options: sites.map(s => ({ value: s.id, label: s.name })), value: st.siteId, required: true, blankLabel: 'Choose a site…', cls: 'span2' })}
        <div class="field span2"><div class="field-label">Shutters at this site (from the shutter register)</div><div id="siteShutters" class="small"></div></div>
      </div><button type="button" class="btn link" id="newSite">+ New site for this customer</button>`;
    } else {
      body = html`<div class="muted">Choose the customer first.</div>`;
    }
    $('#siteBox', el).innerHTML = String(body);
    $('#newSite', el)?.addEventListener('click', () => { st.siteMode = 'new'; paintSite(); });
    $('#pickSite', el)?.addEventListener('click', () => { st.siteMode = 'existing'; paintSite(); });
    v('siteId')?.addEventListener('change', e => { st.siteId = e.target.value; paintZone(); });
    v('siteZone')?.addEventListener('change', paintZone);
    markFromEmail();
    paintZone();
  }

  function paintZone() {
    let zoneId = '', site = null;
    if (st.siteMode === 'new') zoneId = v('siteZone')?.value;
    else if (st.customerId && st.siteId) { site = store.get('customers', st.customerId).sites.find(s => s.id === st.siteId); zoneId = site?.zoneId; }
    $('#zoneChip', el).innerHTML = String(zoneId ? html`<span class="pill blue">Zone ${zoneLabel(zoneId)}</span>` : html`<span class="muted small">Zone comes from the site</span>`);
    const box = $('#siteShutters', el);
    if (box) box.innerHTML = String(site ? (site.shutters.length ? html`${site.shutters.map(s => html`<span class="pill" style="margin:0 4px 4px 0">${s.tag} ${s.location} · ${s.sizeCode}</span>`)}` : html`<span class="muted">None recorded yet; the technician can add them in the site report.</span>`) : '');
  }

  // ---------- Next step, from Type and Site Inspection ----------
  function paintNext() {
    const type = v('type').value, si = v('siteInspection').value;
    const text = si === 'YES' ? 'Site inspection: assign a technician by zone and confirm the visit time (target: within 2 hours of the call).'
      : type === 'REPAIR' ? 'No site inspection: goes straight to estimation.' : `BOQ study for ${vsLabel('ENQ_TYPE', type)}; site inspection is optional.`;
    $('#nextStep', el).textContent = text;
  }
  v('type').addEventListener('change', () => { if (!st.siteTouched) v('siteInspection').value = v('type').value === 'REPAIR' ? 'YES' : 'NO'; paintNext(); });
  v('siteInspection').addEventListener('change', () => { st.siteTouched = true; paintNext(); });

  // ---------- Paste an email (OCR / scanning simulation) ----------
  function markFromEmail() {
    st.fromEmail.forEach(n => v(n)?.classList.add('from-email'));
    $('#emailNote', el).innerHTML = String(st.fromEmail.size ? html`<div class="note warn" style="margin-bottom:10px">Filled from the pasted email. Check the highlighted fields before saving.</div>` : '');
  }
  function applyEmail(text) {
    const r = parseEmail(text);
    const f = r.fields;
    ['channel', 'type', 'priority', 'enquiryStatus'].forEach(n => { v(n).value = f[n]; st.fromEmail.add(n); });
    v('description').value = f.description; st.fromEmail.add('description');
    st.siteTouched = false; v('siteInspection').value = f.type === 'REPAIR' ? 'YES' : 'NO';
    if (r.customer) {
      st.mode = 'existing'; st.customerId = r.customer.id; st.contactId = r.contact?.id || '';
      st.siteMode = r.site ? 'existing' : f.siteText ? 'new' : 'existing'; st.siteId = r.site?.id || '';
    } else {
      st.mode = 'new'; st.customerId = ''; st.siteMode = 'new';
    }
    paintCustomer();
    if (st.mode === 'new') { v('newName').value = f.customerName; st.fromEmail.add('newName'); }
    v('contactName').value = f.contactName; v('mobile').value = f.mobile; v('email').value = f.email;
    ['contactName', 'mobile', 'email'].forEach(n => f[n] && st.fromEmail.add(n));
    if (st.siteMode === 'new' && f.siteText) { paintSite(); v('siteName').value = f.siteText; st.fromEmail.add('siteName'); }
    if (r.site) st.fromEmail.add('siteId');
    markFromEmail(); checkDuplicates(); paintNext(); paintZone();
    toast(r.customer ? `Matched existing customer ${r.customer.name}` : 'New customer: check the details');
  }
  function openPaste() {
    openModal({
      title: 'Paste an email', wide: true,
      body: html`<p class="muted">Paste the customer's email. The form is filled in for you to check (a stand-in for OCR / scanning).</p>
        <textarea id="mail" style="min-height:240px" placeholder="From: …&#10;Subject: …&#10;&#10;Message…"></textarea>
        <button type="button" class="btn link" id="sample">Use the sample email</button>`,
      onOpen: body => { $('#sample', body).onclick = () => { $('#mail', body).value = SAMPLE_EMAIL; }; $('#mail', body).focus(); },
      actions: [{ label: 'Cancel' }, { label: 'Fill the form', kind: 'primary', onClick: body => { const t = $('#mail', body).value.trim(); if (!t) { toast('Paste an email first', 'bad'); return false; } applyEmail(t); } }],
    });
  }
  $('#paste', el)?.addEventListener('click', openPaste);

  // ---------- Attachments ----------
  function paintFiles() {
    $('#fileList', el).innerHTML = String(st.attachments.length ? html`<div class="files">${st.attachments.map(a => html`<div class="file-row">📎 <a href="#" data-open="${a.id}">${a.name}</a><span class="muted small">${fmtSize(a.size)}</span><span class="grow"></span><button type="button" class="btn link small" data-del="${a.id}">Remove</button></div>`)}</div>` : html`<div class="muted">No files attached.</div>`);
  }
  $('#files', el).addEventListener('change', async e => {
    for (const f of e.target.files) {
      if (f.size > MAX_FILE) { toast(`${f.name} is over 10 MB`, 'bad'); continue; }
      const m = await saveBlob(f, { name: f.name, kind: 'attachment' });
      st.attachments.push(m); st.added.push(m.id);
    }
    e.target.value = '';
    paintFiles();
  });
  $('#fileList', el).addEventListener('click', async e => {
    const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
    if (o) { e.preventDefault(); const u = await getUrl(o.dataset.open); if (u) window.open(u, '_blank'); }
    if (d) { const fid = d.dataset.del; st.attachments = st.attachments.filter(a => a.id !== fid); if (st.added.includes(fid)) removeBlob(fid); paintFiles(); }
  });

  // ---------- Save ----------
  $('#save', el).onclick = async () => {
    const d = readForm(form);
    const missing = ['date', 'time', 'channel', 'type', 'enquiryStatus', 'priority', 'siteInspection', 'contactName', 'description'].filter(n => !d[n]);
    if (st.mode === 'new' && !d.newName) missing.push('newName');
    if (st.mode === 'existing' && !st.customerId) { toast('Choose the customer, or use “+ New customer”.', 'bad'); $('#custQ', el)?.focus(); return; }
    if (st.siteMode === 'new') { if (!d.siteName) missing.push('siteName'); if (!d.siteZone) missing.push('siteZone'); } else if (!d.siteId) missing.push('siteId');
    if (!markInvalid(form, missing)) { toast('Fill in the required fields', 'bad'); return; }
    if (!d.mobile && !d.email) { markInvalid(form, ['mobile'], 'Enter a mobile or an email'); return; }
    if (st.mode === 'new' && st.dupsSeen && !(await confirmBox('Possible duplicate', 'A customer with the same mobile, email or name already exists. Create a new customer anyway?', 'Create new'))) return;

    const data = {
      receivedAt: joinDateTime(d.date, d.time), channel: d.channel, type: d.type, enquiryStatus: d.enquiryStatus, priority: d.priority, siteInspection: d.siteInspection,
      customerId: st.customerId, contactId: st.contactId, contactName: d.contactName, mobile: d.mobile, email: d.email, siteId: st.siteMode === 'new' ? '' : d.siteId,
      description: d.description, remarks: d.remarks, attachments: st.attachments,
    };
    const newSite = st.siteMode === 'new' ? { name: d.siteName, address: d.siteAddress || d.siteName, blockUnit: d.siteBlock, zoneId: d.siteZone } : null;
    const newCustomer = st.mode === 'new' ? { name: d.newName, contactName: d.contactName, mobile: d.mobile, email: d.email } : null;
    const saved = enq ? saveEnquiryChanges(enq.id, data, { newSite }) : saveNewEnquiry(data, { newCustomer, newSite });
    toast(`${saved.no} saved · ${saved.status}`);
    go(`enquiries/${saved.id}`);
  };

  paintCustomer();
  paintNext();
  paintFiles();
  bindMics(form);
  if (!enq && sessionStorage.getItem('rsmOpenPaste')) { sessionStorage.removeItem('rsmOpenPaste'); openPaste(); }
}
