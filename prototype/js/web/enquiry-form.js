// New / edit enquiry, stacked (team lead, 1 Nov 2026): Customer · Site · Enquiry in one full-width header that folds
// to a summary line, then "What the customer needs" (product lines = the Enquiry Description), attachments,
// Next step last, and the activity of a saved enquiry.
// Keeps paste-an-email intake, customer type-ahead + quick-create + duplicate check, voice input.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, field, chipGroup, readForm, markInvalid, openModal, confirmBox, toast, dateInput, timeInput, joinDateTime, foldHeader } from '../core/ui.js';
import { vsOptions, vsLabel, zones, zoneLabel } from '../core/lookups.js';
import { findDuplicates, primaryContact } from '../core/customers.js';
import { saveNewEnquiry, saveEnquiryChanges } from '../core/enquiries.js';
import { techniciansFor } from '../core/inspections.js';
import { parseEmail, SAMPLE_EMAIL } from '../core/intake.js';
import { saveBlob, removeBlob, getUrl, fmtSize } from '../core/media.js';
import { bindMics } from '../core/capture.js';
import { linesEditor, recordedByButton, bindRecordedBy } from './enquiry-parts.js';
import { activityHtml } from './enquiry-view.js';

const MAX_FILE = 10 * 1024 * 1024;
const CONFIRM_BY = ['Call', 'WhatsApp', 'Email', 'SMS'];
const row = (label, value, sub) => html`<div class="field"><div class="field-label">${label}</div><div><div class="ro">${value}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}</div></div>`;

export function renderEnquiryForm(el, id) {
  const enq = id ? store.get('enquiries', id) : null;
  if (id && !enq) { el.innerHTML = '<div class="page"><div class="empty">Enquiry not found.</div></div>'; return; }
  if (!auth.can('enquiry', enq ? 'edit' : 'create')) { el.innerHTML = '<div class="page"><div class="empty">Your role cannot change enquiries.</div></div>'; return; }

  const insp = enq?.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const inspLocked = insp && !['To assign', 'Assigned', 'Cancelled'].includes(insp.status);
  const when = new Date(enq ? enq.receivedAt : Date.now());
  const visit = insp?.visitAt ? new Date(insp.visitAt) : null;
  const st = {
    mode: 'existing', customerId: enq?.customerId || '', contactId: enq?.contactId || '', siteMode: 'existing', siteId: enq?.siteId || '',
    siteTouched: !!enq, dupsSeen: '', attachments: [...(enq?.attachments || [])], added: [], fromEmail: new Set(),
    recordedBy: enq?.recordedBy || auth.user().id,
  };

  el.innerHTML = String(html`<div class="page" style="max-width:1400px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/enquiries">Sales Enquiry</a> › ${enq ? enq.no : 'New'}</div>
      <h1>${enq ? `Edit ${enq.no}` : 'New enquiry'} <span class="pill">${enq ? enq.status : 'Draft'}</span></h1>
      <div class="page-meta">${enq ? enq.no : `${store.peekNumber('ENQ')} (given on save)`} · Recorded by <span id="rbBox"></span></div></div>
      <div class="row">${!enq ? html`<button class="btn" id="paste">✉ Paste email</button>` : ''}
        <a class="btn" href="#/${enq ? `enquiries/${enq.id}` : 'enquiries'}">Cancel</a><button class="btn primary" id="save">Save</button></div>
    </div>
    <div id="emailNote"></div>
    <form id="f" class="stack" autocomplete="off" onsubmit="return false">
      ${foldHeader({ title: 'Customer & enquiry details', open: true, body: html`<div class="fold-cols form-lines">
        <div><div class="form-sec">Customer</div><div id="customerBox"></div></div>
        <div><div class="form-sec">Site</div><div id="siteBox"></div></div>
        <div><div class="form-sec">Enquiry</div>
        <div class="field"><label>Enquiry Date / Time <span class="req">*</span></label>
          <div class="row"><input type="date" name="date" value="${dateInput(when)}"><input type="time" name="time" value="${timeInput(when)}" style="width:110px"></div></div>
        ${field({ name: 'type', label: 'Type', type: 'select', options: vsOptions('ENQ_TYPE'), value: enq?.type || 'REPAIR', required: true, blank: false })}
        ${field({ name: 'channel', label: 'Enquiry Channel', type: 'select', options: vsOptions('ENQ_CHANNEL'), value: enq?.channel || 'CALL', blank: false })}
        <div class="field" id="otherRow"><label for="f-channelOther">Specify channel</label><input type="text" name="channelOther" id="f-channelOther" value="${enq?.channelOther || ''}" placeholder="e.g. Walk-in at the office"></div>
        ${field({ name: 'enquiryStatus', label: 'Enquiry Status', type: 'chips', options: vsOptions('ENQ_STATUS'), value: enq?.enquiryStatus || 'WARM' })}
        ${field({ name: 'priority', label: 'Priority', type: 'chips', options: vsOptions('PRIORITY'), value: enq?.priority || 'MEDIUM' })}</div>
      </div>` })}
      <div class="card"><div class="card-head"><h2>What the customer needs</h2><span class="muted small">this is the Enquiry Description</span></div>
        <div id="linesBox"></div>
        <div class="form-lines" id="remarksBox" style="margin-top:10px;max-width:720px">${field({ name: 'remarks', label: 'Remarks', value: enq?.remarks || '', placeholder: 'Internal note (optional)', mic: true })}</div></div>
      <div class="card"><div class="card-head"><h2>Attachments</h2><label class="btn small">+ Attach files<input type="file" id="files" multiple hidden></label></div>
        <div id="fileList"></div><div class="sub">For example a BOQ, photos from the customer or the original email. Up to 10 MB each; kept in this browser.</div></div>
      <div class="card"><div class="card-head"><h2>Next step</h2></div>
        <div class="form-lines fcols">
        ${field({ name: 'siteInspection', label: 'Site Inspection', type: 'chips', options: vsOptions('YES_NO'), value: enq?.siteInspection || 'YES' })}
        <div id="inspBox" style="display:contents"></div></div></div>
      ${enq ? html`<div class="card"><div class="card-head"><h2>Activity</h2></div>${activityHtml(enq)}</div>` : ''}
    </form>
  </div>`);

  const form = $('#f', el);
  const v = name => $(`[name="${name}"]`, form);
  const radio = name => $(`[name="${name}"]:checked`, form)?.value || '';
  const setRadio = (name, value) => { const r = $(`[name="${name}"][value="${value}"]`, form); if (r) r.checked = true; };
  const lines = linesEditor($('#linesBox', el), enq?.lines || []);

  // Folding the header shows one summary line of what is filled in.
  const fold = $('details.fold', form);
  fold.addEventListener('toggle', () => {
    if (fold.open) return;
    const shown = n => v(n)?.selectedOptions?.[0]?.text || '';
    const chip = n => $(`[name="${n}"]:checked`, form)?.nextElementSibling?.textContent || '';
    const cust = st.customerId ? store.get('customers', st.customerId)?.name : v('newName')?.value;
    $('.fold-s', fold).textContent = [cust, v('contactName')?.value, v('mobile')?.value, shown('siteId') || v('siteName')?.value,
      shown('type'), shown('channel'), chip('enquiryStatus'), chip('priority')].filter(Boolean).join(' · ');
  });

  // ---------- Recorded by (logged-in user by default; small arrow to change) ----------
  const paintRb = () => { $('#rbBox', el).innerHTML = String(recordedByButton(st.recordedBy)); bindRecordedBy($('#rbBox', el), () => st.recordedBy, uid => { st.recordedBy = uid; paintRb(); }); };
  paintRb();

  // ---------- Customer ----------
  function paintCustomer() {
    const c = st.customerId ? store.get('customers', st.customerId) : null;
    const keep = (n, first = '') => v(n)?.value ?? first;
    const vals = { contactName: keep('contactName', enq?.contactName), mobile: keep('mobile', enq?.mobile), email: keep('email', enq?.email) };
    let top;
    if (st.mode === 'new') {
      top = field({ name: 'newName', label: 'Customer', value: keep('newName'), required: true, hint: html`New customer (code given on save) · <a href="#" id="pickExisting">choose an existing one</a>` });
    } else if (c) {
      top = row(html`Customer <span class="req">*</span>`, html`<b>${c.name}</b> <span class="muted">${c.code}</span>
        ${!enq ? html` <button type="button" class="btn link small" id="changeCust">Change</button>` : ''}`);
    } else {
      top = html`<div class="field"><label for="custQ">Customer <span class="req">*</span></label><div style="position:relative">
        <input type="search" id="custQ" placeholder="Type name, code, mobile or email" autocomplete="off">
        <div id="custRes" class="card" style="position:absolute;top:100%;left:0;right:0;z-index:5;padding:4px;display:none"></div>
        <div class="sub"><a href="#" id="newCust">+ New customer</a></div></div></div>`;
    }
    $('#customerBox', el).innerHTML = String(html`${top}
      ${field({ name: 'contactName', label: 'Contact Person', value: vals.contactName, required: true, list: 'contactList' })}
      <datalist id="contactList">${(c?.contacts || []).map(p => html`<option value="${p.name}">`)}</datalist>
      ${field({ name: 'mobile', label: 'Mobile', type: 'tel', value: vals.mobile, required: true })}
      ${field({ name: 'email', label: 'Email', type: 'email', value: vals.email })}
      <div id="dupBox"></div>`);
    bindCustomer();
    paintSite();
  }

  function bindCustomer() {
    $('#newCust', el)?.addEventListener('click', e => { e.preventDefault(); st.mode = 'new'; st.customerId = ''; st.siteMode = 'new'; paintCustomer(); v('newName').focus(); });
    $('#pickExisting', el)?.addEventListener('click', e => { e.preventDefault(); st.mode = 'existing'; st.siteMode = 'existing'; paintCustomer(); });
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
    if (st.mode !== 'new') { box.innerHTML = ''; st.dupsSeen = ''; return; }
    const hits = findDuplicates({ name: v('newName')?.value, mobile: v('mobile').value, email: v('email').value });
    st.dupsSeen = hits.map(h => h.customer.id).join(',');
    box.innerHTML = String(hits.length ? html`<div class="note warn" style="margin:6px 0">Possible duplicate: ${hits.map(h => html`<div class="row" style="margin-top:4px"><b>${h.customer.name}</b><span>(${h.customer.code}, ${h.reason})</span>
      <button type="button" class="btn small" data-use="${h.customer.id}">Use this customer</button></div>`)}</div>` : '');
    $$('[data-use]', box).forEach(b => b.onclick = () => pickCustomer(b.dataset.use, { keepContact: true }));
  }

  // ---------- Site (zone from the site; may stay empty for a new site) ----------
  function currentZone() {
    if (st.siteMode === 'new') return v('siteZone')?.value || '';
    const s = st.customerId && st.siteId ? store.get('customers', st.customerId).sites.find(x => x.id === st.siteId) : null;
    return s?.zoneId || '';
  }
  function paintSite() {
    const c = st.customerId ? store.get('customers', st.customerId) : null;
    const keep = n => v(n)?.value ?? '';
    if (st.mode === 'new') st.siteMode = 'new';
    let body;
    if (st.siteMode === 'new') {
      body = html`${field({ name: 'siteName', label: 'Site Location', value: keep('siteName'), required: true, placeholder: 'e.g. Blk 123 Tampines St 11', hint: c ? html`<a href="#" id="pickSite">choose one of the customer's sites</a>` : '' })}
        ${field({ name: 'siteAddress', label: 'Address', value: keep('siteAddress') })}
        ${field({ name: 'siteBlock', label: 'Block / Level / Unit', value: keep('siteBlock') })}
        ${field({ name: 'siteZone', label: 'Zone', type: 'select', options: zones().map(z => ({ value: z.id, label: `${z.code} · ${z.name}` })), value: keep('siteZone'), blankLabel: 'Not set', hint: 'Can be left empty for now and set later on the customer\'s site.' })}`;
    } else if (c) {
      const site = c.sites.find(s => s.id === st.siteId);
      body = html`${field({ name: 'siteId', label: 'Site Location', type: 'select', options: c.sites.map(s => ({ value: s.id, label: s.name })), value: st.siteId, required: true, blankLabel: 'Choose a site…', hint: html`<a href="#" id="newSite">+ New site</a>` })}
        ${row('Zone', site ? (site.zoneId ? zoneLabel(site.zoneId) : html`<span class="muted">Not set</span>`) : '')}
        ${site?.shutters?.length ? row('Shutters', html`${site.shutters.map(s => html`<span class="pill" style="margin:0 4px 4px 0">${s.tag} ${s.location} · ${s.sizeCode}</span>`)}`) : ''}`;
    } else {
      body = html`<div class="muted" style="padding:4px 0 6px">Choose the customer first.</div>`;
    }
    $('#siteBox', el).innerHTML = String(body);
    $('#newSite', el)?.addEventListener('click', e => { e.preventDefault(); st.siteMode = 'new'; paintSite(); });
    $('#pickSite', el)?.addEventListener('click', e => { e.preventDefault(); st.siteMode = 'existing'; paintSite(); });
    v('siteId')?.addEventListener('change', e => { st.siteId = e.target.value; paintSite(); });
    v('siteZone')?.addEventListener('change', paintInspection);
    markFromEmail();
    paintInspection();
  }

  // ---------- Next step: site inspection, technician (any; zone matches first), optional visit ----------
  function paintInspection() {
    const yes = radio('siteInspection') === 'YES';
    const box = $('#inspBox', el);
    const type = v('type').value;
    const nextText = yes ? 'Goes to Site Inspection (target: within 2 hours of the call).'
      : type === 'REPAIR' ? 'No site inspection: goes straight to estimation.' : `BOQ study for ${vsLabel('ENQ_TYPE', type)}.`;
    if (!yes) { box.innerHTML = String(html`<div class="sub" style="grid-column:1/-1;margin:0">${nextText}</div>`); return; }
    if (inspLocked) {
      box.innerHTML = String(row('Technician', `${store.get('employees', insp.technicianId)?.name || '—'} · ${insp.status}`, 'Change it from the site inspection page.'));
      return;
    }
    const keep = (n, d) => v(n)?.value ?? d;
    const techId = keep('technicianId', insp?.technicianId || '');
    const date = keep('visitDate', visit ? dateInput(visit) : ''), time = keep('visitTime', visit ? timeInput(visit) : '');
    const zoneId = currentZone();
    const opts = techniciansFor(zoneId, date ? joinDateTime(date, time) : new Date().toISOString())
      .map(x => ({ value: x.tech.id, label: `${x.tech.name}${x.match ? ` · covers Zone ${store.get('zones', zoneId)?.code}` : ''}${x.visits ? ` · ${x.visits} visit(s) that day` : ''}` }));
    box.innerHTML = String(html`
      ${field({ name: 'technicianId', label: 'Technician', type: 'select', options: opts, value: techId, blankLabel: 'Assign later' })}
      <div class="field"><label>Visit date / time</label><div class="row"><input type="date" name="visitDate" value="${date}"><input type="time" name="visitTime" value="${time}" style="width:110px"></div></div>
      ${field({ name: 'confirmedBy', label: 'Confirmed by', type: 'select', options: CONFIRM_BY, value: keep('confirmedBy', insp?.confirmedBy || 'Call'), blank: false })}
      <div class="sub" style="grid-column:1/-1;margin:0">${nextText} Optional: leave the technician empty to assign later.</div>`);
    v('visitDate').addEventListener('change', paintInspection);
  }
  $$('[name="siteInspection"]', form).forEach(r => r.addEventListener('change', () => { st.siteTouched = true; paintInspection(); }));
  v('type').addEventListener('change', () => { if (!st.siteTouched) setRadio('siteInspection', v('type').value === 'REPAIR' ? 'YES' : 'NO'); paintInspection(); });
  const paintOther = () => { $('#otherRow', el).hidden = v('channel').value !== 'OTHER'; };
  v('channel').addEventListener('change', paintOther);

  // ---------- Paste an email (OCR / scanning simulation) ----------
  function markFromEmail() {
    st.fromEmail.forEach(n => { const x = v(n); (x?.type === 'radio' ? x.closest('.chips') : x)?.classList.add('from-email'); });
    $('#emailNote', el).innerHTML = String(st.fromEmail.size ? html`<div class="note warn" style="margin-bottom:10px">Filled from the pasted email. Check the highlighted fields before saving.</div>` : '');
  }
  function applyEmail(text) {
    const r = parseEmail(text);
    const f = r.fields;
    ['channel', 'type'].forEach(n => { v(n).value = f[n]; st.fromEmail.add(n); });
    setRadio('enquiryStatus', f.enquiryStatus); setRadio('priority', f.priority); st.fromEmail.add('enquiryStatus'); st.fromEmail.add('priority');
    st.siteTouched = false; setRadio('siteInspection', f.type === 'REPAIR' ? 'YES' : 'NO');
    lines.set([{ description: f.description }]);
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
    paintOther(); markFromEmail(); checkDuplicates(); paintInspection();
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
    const missing = ['date', 'time', 'type', 'contactName'].filter(n => !d[n]);
    if (st.mode === 'new' && !d.newName) missing.push('newName');
    if (st.mode === 'existing' && !st.customerId) { toast('Choose the customer, or use “+ New customer”.', 'bad'); fold.open = true; $('#custQ', el)?.focus(); return; }
    if (st.siteMode === 'new') { if (!d.siteName) missing.push('siteName'); } else if (!d.siteId) missing.push('siteId');
    if (d.channel === 'OTHER' && !d.channelOther) missing.push('channelOther');
    if (!d.mobile) missing.push('mobile');
    if (!markInvalid(form, missing)) { toast('Fill in the required fields', 'bad'); return; }
    const itemLines = lines.read();
    if (!itemLines.some(l => l.itemRef || l.description)) { toast('Add at least one line: a product or a description of what the customer needs', 'bad'); return; }
    if (st.mode === 'new' && st.dupsSeen && !(await confirmBox('Possible duplicate', 'A customer with the same mobile, email or name already exists. Create a new customer anyway?', 'Create new'))) return;

    const data = {
      receivedAt: joinDateTime(d.date, d.time), channel: d.channel, channelOther: d.channel === 'OTHER' ? d.channelOther : '', type: d.type,
      enquiryStatus: d.enquiryStatus, priority: d.priority, siteInspection: d.siteInspection, recordedBy: st.recordedBy,
      customerId: st.customerId, contactId: st.contactId, contactName: d.contactName, mobile: d.mobile, email: d.email, siteId: st.siteMode === 'new' ? '' : d.siteId,
      lines: itemLines, remarks: d.remarks, attachments: st.attachments,
    };
    const newSite = st.siteMode === 'new' ? { name: d.siteName, address: d.siteAddress || d.siteName, blockUnit: d.siteBlock, zoneId: d.siteZone || '' } : null;
    const newCustomer = st.mode === 'new' ? { name: d.newName, contactName: d.contactName, mobile: d.mobile, email: d.email } : null;
    const assign = d.siteInspection === 'YES' && d.technicianId
      ? { technicianId: d.technicianId, visitAt: d.visitDate ? joinDateTime(d.visitDate, d.visitTime) : null, confirmedBy: d.confirmedBy } : null;
    const saved = enq ? saveEnquiryChanges(enq.id, data, { newSite, assign }) : saveNewEnquiry(data, { newCustomer, newSite, assign });
    toast(`${saved.no} saved · ${saved.status}`);
    go(`enquiries/${saved.id}`);
  };

  paintCustomer();
  paintOther();
  paintFiles();
  bindMics($('#remarksBox', el));
  if (!enq && sessionStorage.getItem('rsmOpenPaste')) { sessionStorage.removeItem('rsmOpenPaste'); openPaste(); }
}
