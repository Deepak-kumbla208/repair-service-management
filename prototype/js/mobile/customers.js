// Phone: customers, for roles that may see customers on the phone (Menu Access): search, call, sites and their
// shutters; New / Edit when the role may create / edit on the phone (the same checks as the web master), and
// "New enquiry" for the customer.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, debounce, pill, toast, readForm, icon } from '../core/ui.js';
import { zones, zoneLabel, productName } from '../core/lookups.js';
import { nextCode, findDuplicates, primaryContact, shutterCount } from '../core/customers.js';
import { newEnquiryFor } from './enquiry-form.js';

const tel = m => String(m || '').replace(/\s/g, '');

export function mCustomers(page) {
  page.setTitle('Customers', 'm/home');
  const state = { q: sessionStorage.getItem('rsmMobCustQ') || '' };
  page.body.innerHTML = String(html`<input type="search" class="m-search" id="q" placeholder="Search: name, code, contact, mobile" value="${state.q}"><div id="list"></div>
    ${auth.can('customer', 'create', 'mobile') ? html`<a class="m-fab" href="#/m/customer-new" aria-label="New customer" title="New customer">${icon('plus', 24)}</a>` : ''}`);
  const paint = () => {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = store.list('customers').sort((a, b) => a.name.localeCompare(b.name));
    const shown = all.filter(c => terms.every(t => [c.code, c.name, c.phone, c.email, ...(c.contacts || []).flatMap(p => [p.name, p.mobile, p.email]), ...(c.sites || []).map(s => s.name)].join(' ').toLowerCase().includes(t)));
    $('#list', page.body).innerHTML = String(shown.length ? html`${shown.map(c => { const p = primaryContact(c); return html`<a class="m-card" style="display:block;color:inherit;text-decoration:none" href="#/m/customer/${c.id}">
      <div class="row"><b class="grow">${c.name}</b>${c.status === 'Inactive' ? pill('Inactive') : ''}</div>
      <div class="small muted">${c.code} · ${p ? `${p.name} · ${p.mobile}` : ''} · ${(c.sites || []).length} site(s)</div></a>`; })}` : html`<div class="empty">No customers match.</div>`);
    sessionStorage.setItem('rsmMobCustQ', state.q);
  };
  $('#q', page.body).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}

export function mCustomer(page, id) {
  const c = store.get('customers', id);
  page.setTitle(c ? c.code : 'Customer', 'm/customers');
  if (!c) { page.body.innerHTML = '<div class="empty">Customer not found.</div>'; return; }
  page.body.innerHTML = String(html`
    <div class="m-card"><div class="row"><b class="grow" style="font-size:16px">${c.name}</b>${pill(c.status || 'Active')}</div>
      <div class="small muted">${c.code}${c.uen ? ` · UEN ${c.uen}` : ''} · ${shutterCount(c)} shutter(s) in the register</div></div>
    <div class="m-section">Contacts</div>
    ${(c.contacts || []).map(p => html`<div class="m-card"><div class="row"><b class="grow">${p.name}</b>${p.primary ? html`<span class="pill blue">Primary</span>` : ''}</div>
      <div class="small muted">${p.designation || ''}${p.email ? ` · ${p.email}` : ''}</div>
      ${p.mobile ? html`<div class="m-acts"><a class="btn" href="tel:${tel(p.mobile)}">${icon('call', 15)} ${p.mobile}</a></div>` : ''}</div>`)}
    <div class="m-section">Sites</div>
    ${(c.sites || []).length ? html`${c.sites.map(s => html`<div class="m-card"><b>${s.name}</b> <span class="pill">Zone ${zoneLabel(s.zoneId) || 'not set'}</span>
      <div class="small muted">${[s.address, s.blockUnit].filter(Boolean).join(' ')}</div>
      ${(s.shutters || []).length ? html`<div class="small" style="margin-top:6px">${s.shutters.map(sh => html`<div>${sh.tag} ${sh.location} · ${productName(sh.productId)} · ${sh.sizeCode}</div>`)}</div>` : ''}</div>`)}` : html`<div class="muted small">No sites yet.</div>`}`);
  const acts = [
    auth.can('enquiry', 'create', 'mobile') && c.status !== 'Inactive' ? html`<button class="btn" id="enq">${icon('plus', 15)} New enquiry</button>` : '',
    auth.can('customer', 'edit', 'mobile') ? html`<a class="btn primary" href="#/m/customer/${c.id}/edit">${icon('edit', 15)} Edit</a>` : '',
  ].filter(Boolean);
  if (acts.length) $('#enq', page.setFoot(html`${acts}`))?.addEventListener('click', () => newEnquiryFor(c.id));
}

// New / edit: name, UEN, contacts (each needs a name and a mobile) and sites (each needs a name and a zone).
export function mCustomerForm(page, id) {
  const rec = id ? store.get('customers', id) : null;
  page.setTitle(rec ? `Edit ${rec.code}` : 'New customer', rec ? `m/customer/${rec.id}` : 'm/customers');
  if ((id && !rec) || !auth.can('customer', rec ? 'edit' : 'create', 'mobile')) { page.body.innerHTML = '<div class="empty">Your role cannot do this on the phone.</div>'; return; }
  const d = rec ? structuredClone(rec) : { code: nextCode('customers', 'CUS-'), name: '', uen: '', phone: '', email: '', address: '', taxRegistered: false,
    contacts: [{ id: store.uid('con_'), name: '', designation: '', mobile: '', email: '', primary: true }], sites: [] };
  const inp = (label, { name = '', value = '', type = 'text', readonly = false }, req) => html`<div class="field"><label>${label}${req ? html` <span class="req">*</span>` : ''}</label>
    <input type="${type}" ${name ? html`name="${name}"` : ''} value="${value ?? ''}" ${readonly ? 'readonly' : ''}></div>`;
  const collect = () => {
    const f = readForm($('#cf', page.body));
    d.name = f.name ?? d.name; d.uen = f.uen ?? d.uen;
    d.contacts.forEach((p, i) => { ['name', 'designation', 'mobile', 'email'].forEach(k => { p[k] = f[`c${i}_${k}`] ?? p[k] ?? ''; }); });
    d.sites.forEach((s, i) => { s.name = f[`s${i}_name`] ?? s.name; s.address = f[`s${i}_address`] ?? s.address; s.zoneId = f[`s${i}_zone`] ?? s.zoneId; });
  };
  const paint = () => {
    page.body.innerHTML = String(html`<form id="cf" class="m-fields" onsubmit="return false">
      <div class="m-card">${inp('Code', { value: d.code, readonly: true })}${inp('Customer name', { name: 'name', value: d.name }, true)}${inp('UEN', { name: 'uen', value: d.uen || '' })}</div>
      <div class="m-section">Contacts</div>
      ${d.contacts.map((p, i) => html`<div class="m-card">${inp('Name', { name: `c${i}_name`, value: p.name }, true)}
        <div class="row">${inp('Mobile', { name: `c${i}_mobile`, type: 'tel', value: p.mobile }, true)}${inp('Designation', { name: `c${i}_designation`, value: p.designation || '' })}</div>
        ${inp('Email', { name: `c${i}_email`, type: 'email', value: p.email || '' })}
        ${d.contacts.length > 1 ? html`<button type="button" class="btn link small" data-rmc="${i}">Remove this contact</button>` : ''}</div>`)}
      <button type="button" class="add-dashed" id="addC">${icon('plus', 14)} Add a contact</button>
      <div class="m-section">Sites</div>
      ${d.sites.map((s, i) => html`<div class="m-card">${inp('Site name', { name: `s${i}_name`, value: s.name }, true)}${inp('Address', { name: `s${i}_address`, value: s.address || '' })}
        <div class="field"><label>Zone <span class="req">*</span></label><select name="s${i}_zone"><option value="">Choose</option>${zones().map(z => html`<option value="${z.id}" ${z.id === s.zoneId ? 'selected' : ''}>Zone ${z.code} · ${z.name}</option>`)}</select></div>
        ${(s.shutters || []).length ? html`<div class="small muted">${s.shutters.length} shutter(s) in the register</div>` : ''}</div>`)}
      <button type="button" class="add-dashed" id="addS">${icon('plus', 14)} Add a site</button></form>`);
  };
  page.body.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'addC') { collect(); d.contacts.push({ id: store.uid('con_'), name: '', designation: '', mobile: '', email: '', primary: false }); paint(); }
    if (b.id === 'addS') { collect(); d.sites.push({ id: store.uid('sit_'), code: `S${d.sites.length + 1}`, name: '', address: '', blockUnit: '', postal: '', zoneId: '', access: '', shutters: [] }); paint(); }
    if (b.dataset.rmc) { collect(); d.contacts.splice(+b.dataset.rmc, 1); if (!d.contacts.some(p => p.primary)) d.contacts[0].primary = true; paint(); }
  });
  paint();
  const foot = page.setFoot(html`<a class="btn" href="#/${rec ? `m/customer/${rec.id}` : 'm/customers'}">Cancel</a><button class="btn primary" id="saveC">Save customer</button>`);
  $('#saveC', foot).onclick = e => {
    collect();
    if (!d.name) { toast('Enter the customer name', 'bad'); return; }
    if (d.contacts.some(p => !p.name || !p.mobile)) { toast('Every contact needs a name and a mobile', 'bad'); return; }
    if (d.sites.some(s => !s.name || !s.zoneId)) { toast('Every site needs a name and a zone', 'bad'); return; }
    e.currentTarget.disabled = true; // a double tap saves once
    const dups = d.contacts.flatMap(p => findDuplicates({ mobile: p.mobile, email: p.email }, rec?.id));
    const data = { ...d, phone: d.phone || d.contacts[0].mobile, sites: d.sites.map(s => ({ ...s, address: s.address || s.name })) };
    delete data.id; delete data.tenantId; delete data.status; delete data.statusHistory;
    const saved = rec ? store.update('customers', rec.id, data, `Edited customer ${d.code} on the phone`) : store.insert('customers', data, { status: 'Active', note: `Created customer ${d.code} on the phone` });
    toast(`Customer ${saved.code} saved${dups.length ? ` · check: ${[...new Set(dups.map(x => `${x.customer.name} (${x.reason})`))].join('; ')}` : ''}`);
    go(`m/customer/${saved.id}`);
  };
}
