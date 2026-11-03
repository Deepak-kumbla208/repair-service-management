// Customer master: header, contacts, sites, and the customer products (shutter register) at each site
// (location, type, width × height, size class, motor, serial, install date). Duplicate check by mobile and email.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, on, go, debounce, field, readForm, markInvalid, toast, openModal, pill, emptyRow, fmtNum } from '../core/ui.js';
import { zones, zoneLabel, products, productName, sizes, vsOptions, vsDefault } from '../core/lookups.js';
import { nextCode, findDuplicates, primaryContact, shutterCount, nextShutterTag } from '../core/customers.js';
import { classifySize, toMetres } from '../core/costing.js';
import { pageHead } from './shell.js';
import { openLater } from '../core/later-work.js';

export function renderCustomerList(el) {
  const state = { q: '', status: '' };
  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Master', title: 'Customer', sub: 'Customers with their contacts, sites and the customer products at each site.',
      actions: auth.can('customer', 'create') ? html`<a class="btn primary" href="#/master/customer/new">+ New customer</a>` : '' })}
    <div class="filters"><input type="search" class="search" id="q" placeholder="Search customers: code, name, contact, mobile, email, UEN, site, product tag">
      <select id="st"><option value="">Active and inactive</option><option>Active</option><option>Inactive</option></select></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Name</th><th>Primary contact</th><th>Mobile</th><th>Email</th><th>Sites</th><th>Products</th><th>Tax registered</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="list-foot"><span id="count"></span></div>
  </div>`);
  function paint() {
    const all = store.list('customers').sort((a, b) => a.code.localeCompare(b.code));
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const text = c => [c.code, c.name, c.uen, c.phone, c.email, ...(c.contacts || []).flatMap(p => [p.name, p.mobile, p.email]),
      ...(c.sites || []).flatMap(s => [s.name, s.address, ...(s.shutters || []).flatMap(sh => [sh.tag, sh.location, sh.serial])])].join(' ').toLowerCase();
    const shown = all.filter(c => (!state.status || (c.status || 'Active') === state.status) && terms.every(t => text(c).includes(t)));
    $('#rows', el).innerHTML = String(shown.length ? html`${shown.map(c => { const p = primaryContact(c); return html`<tr class="click" data-id="${c.id}">
      <td class="lnk">${c.code}</td><td>${c.name} ${c.quickCreated ? html`<span class="tag info">quick-created</span>` : ''}</td><td>${p?.name}</td><td>${p?.mobile || c.phone}</td><td>${p?.email || c.email}</td>
      <td>${(c.sites || []).length}</td><td>${shutterCount(c)}</td><td>${c.taxRegistered ? 'Yes' : 'No'}</td><td>${pill(c.status || 'Active')}</td></tr>`; })}`
      : emptyRow(9, 'No customer matches the search.'));
    $('#count', el).textContent = `${shown.length} of ${all.length} customers`;
  }
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 120));
  $('#st', el).addEventListener('change', e => { state.status = e.target.value; paint(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => go(`master/customer/${tr.dataset.id}`));
  paint();
}

export function renderCustomerForm(el, id) {
  const rec = id ? store.get('customers', id) : null;
  if (id && !rec) { el.innerHTML = '<div class="page"><div class="empty">Customer not found.</div></div>'; return; }
  const company = auth.company();
  const editable = auth.can('customer', rec ? 'edit' : 'create');
  const draft = rec ? structuredClone(rec) : { code: nextCode('customers', 'CUS-'), name: '', uen: '', taxRegistered: false, phone: '', email: '', address: '',
    contacts: [{ id: store.uid('con_'), name: '', designation: '', mobile: '', email: '', primary: true }], sites: [] };
  let q = '';
  const ro = editable ? '' : 'readonly';

  el.innerHTML = String(html`<div class="page" style="max-width:1250px">
    ${pageHead({
      crumb: html`Master › <a href="#/master/customer">Customer</a>${rec ? ` › ${rec.code}` : ''}`,
      title: rec ? html`${rec.code} · ${rec.name} ${pill(rec.status || 'Active')}` : 'New customer',
      sub: rec ? `${(rec.sites || []).length} site(s) · ${shutterCount(rec)} customer product(s)` : 'Duplicates are checked by mobile and email when you save.',
      actions: html`<div class="row"><a class="btn" href="#/master/customer">Back to list</a>
        ${rec && editable ? html`<button class="btn" id="toggle">${rec.status === 'Inactive' ? 'Make active' : 'Make inactive'}</button>` : ''}
        ${editable ? html`<button class="btn primary" id="save">Save</button>` : ''}</div>`,
    })}
    <div id="dup"></div>
    <form class="card form-lines" id="head" onsubmit="return false"><div class="card-head"><h2>Customer</h2></div><div class="grid g2">
      ${field({ name: 'code', label: 'Code', value: draft.code, required: true, readonly: !editable })}
      ${field({ name: 'name', label: 'Name', value: draft.name, required: true, readonly: !editable })}
      ${field({ name: 'uen', label: 'UEN / registration no.', value: draft.uen, readonly: !editable })}
      ${field({ name: 'phone', label: 'Phone', type: 'tel', value: draft.phone, readonly: !editable })}
      ${field({ name: 'email', label: 'Email', type: 'email', value: draft.email, readonly: !editable })}
      ${field({ name: 'address', label: 'Billing address', value: draft.address, readonly: !editable })}
      <div class="field"><div class="field-label">Tax</div>${field({ name: 'taxRegistered', label: `${company.taxLabel}-registered customer`, type: 'checkbox', value: draft.taxRegistered, readonly: !editable })}</div>
      ${field({ name: 'paymentTerm', label: 'Payment term', type: 'select', options: vsOptions('PAYMENT_TERMS'), value: draft.paymentTerm || vsDefault('PAYMENT_TERMS'), blank: false, readonly: !editable })}
    </div></form>
    <div class="card"><div class="card-head"><h2>Contacts</h2>${editable ? html`<button class="btn small" id="addContact">+ Add contact</button>` : ''}</div><div id="contacts"></div></div>
    <div class="card"><div class="card-head"><h2>Sites and customer products</h2>
      <input type="search" id="sq" placeholder="Search sites and products: tag, location, type, serial" style="max-width:340px">
      ${editable ? html`<button class="btn small" id="addSite">+ Add site</button>` : ''}</div><div id="sites"></div></div>
  </div>`);

  // ---------- Contacts ----------
  function syncContacts() {
    $$('#contacts tr[data-i]', el).forEach(tr => {
      const c = draft.contacts[+tr.dataset.i];
      $$('[data-f]', tr).forEach(inp => { c[inp.dataset.f] = inp.type === 'radio' ? inp.checked : inp.value.trim(); });
    });
  }
  function paintContacts() {
    $('#contacts', el).innerHTML = String(html`<div class="tbl-wrap" style="max-height:none"><table class="tbl edit"><thead><tr><th>Name <span class="req">*</span></th><th>Designation</th><th>Mobile <span class="req">*</span></th><th>Email</th><th>Primary</th>${editable ? html`<th></th>` : ''}</tr></thead><tbody>
      ${draft.contacts.map((c, i) => html`<tr data-i="${i}">${['name', 'designation', 'mobile', 'email'].map(k => html`<td><input data-f="${k}" value="${c[k]}" ${ro}></td>`)}
        <td><input type="radio" name="primary" data-f="primary" ${c.primary ? 'checked' : ''} ${editable ? '' : 'disabled'}></td>
        ${editable ? html`<td>${draft.contacts.length > 1 ? html`<button type="button" class="btn link small" data-rmc="${i}">Remove</button>` : ''}</td>` : ''}</tr>`)}
    </tbody></table></div>`);
    $$('[data-rmc]', el).forEach(b => b.onclick = () => { syncContacts(); draft.contacts.splice(+b.dataset.rmc, 1); if (!draft.contacts.some(c => c.primary)) draft.contacts[0].primary = true; paintContacts(); });
  }

  // ---------- Sites and the customer products (shutter register) ----------
  function syncSites() {
    $$('#sites [data-site]', el).forEach(inp => { draft.sites[+inp.dataset.site][inp.dataset.f] = inp.value.trim(); });
  }
  function paintSites() {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    // Work the customer put off (later) or did not want, from quotations accepted in part (core/later-work.js).
    const owed = new Map();
    store.list('enquiries', e => e.customerId === draft.id).forEach(e => {
      (e.notWanted || []).filter(i => i.shutterKey).forEach(i => owed.set(i.shutterKey, { ...i, how: 'not wanted' }));
      (openLater(e)?.items || []).filter(i => i.shutterKey).forEach(i => owed.set(i.shutterKey, { ...i, how: 'later work' }));
    });
    const owedPill = sh => { const o = owed.get(sh.id); return o ? html` ${pill(o.priority === 'URGENT' ? `Urgent · ${o.how}` : o.how, o.priority === 'URGENT' ? 'red' : 'amber')}` : ''; };
    const shMatch = sh => terms.every(t => [sh.tag, sh.location, productName(sh.productId), sh.serial, sh.motor, sh.sizeCode].join(' ').toLowerCase().includes(t));
    const siteMatch = s => terms.every(t => [s.name, s.address, s.blockUnit, zoneLabel(s.zoneId)].join(' ').toLowerCase().includes(t));
    const parts = draft.sites.map((s, i) => {
      const list = terms.length && !siteMatch(s) ? s.shutters.filter(shMatch) : s.shutters;
      if (terms.length && !siteMatch(s) && !list.length) return '';
      const inp = (f, label, extra = '') => html`<div class="field ${extra}"><label>${label}</label><input data-site="${i}" data-f="${f}" value="${s[f] || ''}" ${ro}></div>`;
      return html`<div class="card" style="background:var(--zebra)"><div class="card-head"><h3>${s.code} · ${s.name || 'New site'}</h3><span class="pill blue">Zone ${zoneLabel(s.zoneId) || '—'}</span>
          ${editable ? html`<button type="button" class="btn small" data-addsh="${i}">+ Add product</button>` : ''}</div>
        <div class="grid g2 form-lines">${inp('name', 'Site name')}${inp('address', 'Address')}${inp('blockUnit', 'Block / Level / Unit')}
          <div class="field"><label>Zone</label><select data-site="${i}" data-f="zoneId" ${editable ? '' : 'disabled'}><option value="">Not set</option>${zones().map(z => html`<option value="${z.id}" ${z.id === s.zoneId ? 'selected' : ''}>${z.code} · ${z.name}</option>`)}</select></div>
          ${inp('postal', 'Postal code')}${inp('access', 'Access notes')}</div>
        <div class="tbl-wrap" style="max-height:none;margin-top:8px"><table class="tbl"><thead><tr><th>Tag</th><th>Location</th><th>Type</th><th>Width × height</th><th>Size</th><th>Motor</th><th>Serial</th><th>Install date</th><th>Added from</th><th>Status</th>${editable ? html`<th></th>` : ''}</tr></thead><tbody>
          ${list.length ? html`${list.map(sh => html`<tr><td class="lnk">${sh.tag}${owedPill(sh)}</td><td>${sh.location}</td><td>${productName(sh.productId)}</td>
            <td>${sh.width && sh.height ? html`${fmtNum(sh.width)} × ${fmtNum(sh.height)} ${sh.unit}${sh.unit === 'ft' ? html` <span class="muted small">(${fmtNum(sh.widthM)} × ${fmtNum(sh.heightM)} m)</span>` : ''}` : '—'}</td>
            <td><b>${sh.sizeCode}</b>${sh.fireRated ? html` <span class="tag">fire</span>` : ''}</td><td>${sh.motor}</td><td>${sh.serial}</td><td>${sh.installDate}</td><td class="small">${sh.source}</td><td>${sh.outOfService ? pill('Out of service', 'red') : pill(sh.status)}</td>
            ${editable ? html`<td><button type="button" class="btn link small" data-edsh="${i}:${sh.id}">Edit</button></td>` : ''}</tr>`)}` : emptyRow(11, terms.length ? 'No product matches.' : 'No customer products recorded at this site yet.')}
        </tbody></table></div></div>`;
    });
    $('#sites', el).innerHTML = String(draft.sites.length ? html`${parts}` : html`<div class="muted">No sites yet.${editable ? ' Use “+ Add site”.' : ''}</div>`);
    $$('[data-addsh]', el).forEach(b => b.onclick = () => { syncSites(); shutterDialog(+b.dataset.addsh, null); });
    $$('[data-edsh]', el).forEach(b => b.onclick = () => { syncSites(); const [i, sid] = b.dataset.edsh.split(':'); shutterDialog(+i, sid); });
    $$('#sites select[data-site]', el).forEach(s => s.addEventListener('change', () => { syncSites(); paintSites(); }));
  }

  function shutterDialog(siteIdx, shutterId) {
    const site = draft.sites[siteIdx];
    const sh = shutterId ? site.shutters.find(x => x.id === shutterId) : { tag: nextShutterTag(site), location: '', productId: products()[0]?.id, width: '', height: '', unit: 'm', motor: '', serial: '', installDate: '', status: 'Active' };
    const sizeOf = d => classifySize(toMetres(d.width, d.unit), toMetres(d.height, d.unit), sizes());
    const sizeCodes = sizes().filter(z => z.status !== 'Inactive').sort((a, b) => a.order - b.order).map(z => z.code);
    openModal({
      title: shutterId ? `Edit product ${sh.tag}` : `Add a product at ${site.name || 'site'}`,
      body: html`<div class="grid g2 form-lines" id="shf">
        ${field({ name: 'tag', label: 'Tag', value: sh.tag, required: true })}${field({ name: 'location', label: 'Location', value: sh.location, required: true, cls: 'span2' })}
        ${field({ name: 'productId', label: 'Type', type: 'select', options: products().map(p => ({ value: p.id, label: p.name })), value: sh.productId, required: true })}
        ${field({ name: 'width', label: 'Width', type: 'number', step: '0.01', value: sh.width })}${field({ name: 'height', label: 'Height', type: 'number', step: '0.01', value: sh.height })}
        ${field({ name: 'unit', label: 'Unit', type: 'select', options: [{ value: 'm', label: 'metres' }, { value: 'ft', label: 'feet' }], value: sh.unit, blank: false })}
        ${field({ name: 'sizeCode', label: 'Size (from width × height when measured)', type: 'select', options: sizeCodes, value: sizeOf(sh) || sh.sizeCode, required: true })}
        ${field({ name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], value: sh.status, blank: false })}
        ${field({ name: 'motor', label: 'Motor (make / model)', value: sh.motor })}${field({ name: 'serial', label: 'Serial no.', value: sh.serial })}
        ${field({ name: 'installDate', label: 'Install date', type: 'date', value: sh.installDate })}
        ${field({ name: 'fireRated', label: 'Fire-rated shutter (the AMC check list adds the fire drop test)', type: 'checkbox', value: sh.fireRated, cls: 'span2' })}</div>`,
      // Measuring sets the size by the one rule; a product recorded from a site report may only have the size tapped on site.
      onOpen: body => body.addEventListener('input', () => { const code = sizeOf(readForm(body)); if (code) $('[name="sizeCode"]', body).value = code; }),
      actions: [{ label: 'Cancel' }, { label: shutterId ? 'Update product' : 'Add product', kind: 'primary', onClick: body => {
        const d = readForm(body);
        if (!markInvalid(body, ['tag', 'location', 'productId', 'sizeCode'].filter(n => n === 'sizeCode' ? !sizeOf(d) && !d.sizeCode : d[n] === '' || d[n] == null))) return false;
        if (site.shutters.some(x => x.id !== shutterId && x.tag.toLowerCase() === d.tag.toLowerCase())) { markInvalid(body, ['tag'], 'Tag already used at this site'); return false; }
        const widthM = toMetres(d.width, d.unit), heightM = toMetres(d.height, d.unit);
        const next = { ...sh, ...d, widthM, heightM, sizeCode: classifySize(widthM, heightM, sizes()) || d.sizeCode };
        if (shutterId) Object.assign(sh, next); else site.shutters.push({ ...next, id: store.uid('sht_'), source: 'Manual' });
        paintSites();
      } }],
    });
  }

  paintContacts();
  paintSites();
  $('#sq', el).addEventListener('input', debounce(e => { syncSites(); q = e.target.value; paintSites(); }, 120));
  $('#addContact', el)?.addEventListener('click', () => { syncContacts(); draft.contacts.push({ id: store.uid('con_'), name: '', designation: '', mobile: '', email: '', primary: false }); paintContacts(); });
  $('#addSite', el)?.addEventListener('click', () => { syncSites(); draft.sites.push({ id: store.uid('sit_'), code: `S${draft.sites.length + 1}`, name: '', address: '', blockUnit: '', postal: '', zoneId: '', access: '', shutters: [] }); q = ''; $('#sq', el).value = ''; paintSites(); });
  $('#toggle', el)?.addEventListener('click', () => { store.setStatus('customers', rec.id, rec.status === 'Inactive' ? 'Active' : 'Inactive'); renderCustomerForm(el, id); });

  $('#save', el)?.addEventListener('click', () => {
    const head = readForm($('#head', el));
    syncContacts(); syncSites();
    if (!markInvalid($('#head', el), ['code', 'name'].filter(n => !head[n]))) { toast('Fill in the required fields', 'bad'); return; }
    if (store.list('customers').some(c => c.id !== rec?.id && c.code.toLowerCase() === head.code.toLowerCase())) { markInvalid($('#head', el), ['code'], 'This code is already used'); return; }
    if (draft.contacts.some(c => !c.name || !c.mobile)) { toast('Every contact needs a name and a mobile', 'bad'); return; }
    if (draft.sites.some(s => !s.name || !s.zoneId)) { toast('Every site needs a name and a zone', 'bad'); return; }
    const dups = [head, ...draft.contacts].flatMap(p => findDuplicates({ mobile: p.phone || p.mobile, email: p.email }, rec?.id));
    $('#dup', el).innerHTML = String(dups.length ? html`<div class="note warn" style="margin-bottom:10px">Saved, but please check: ${[...new Set(dups.map(d => `${d.customer.name} (${d.customer.code}, ${d.reason})`))].join('; ')}</div>` : '');
    const data = { ...draft, ...head, contacts: draft.contacts, sites: draft.sites.map(s => ({ ...s, address: s.address || s.name })) };
    delete data.id; delete data.tenantId; delete data.status; delete data.statusHistory;
    const saved = rec ? store.update('customers', rec.id, data, `Edited customer ${head.code}`) : store.insert('customers', data, { status: 'Active', note: `Created customer ${head.code}` });
    toast(`Customer ${saved.code} saved`);
    if (!rec) go(`master/customer/${saved.id}`);
  });
}
