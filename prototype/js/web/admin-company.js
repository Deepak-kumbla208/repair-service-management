// Company Setup (Admin Setup), stacked: company, registration and contact in a full-width header, then payment
// details, working week, data protection, the logo, "Setup to finish", the letterhead of new documents (a setup
// sample that updates as you type, not a document preview) and the changes from the audit log.
// Sent quotations, posted invoices and activated contracts keep the letterhead they were issued with (core/setup.js).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, toast, placeholderTag, fmtDateTime, foldHeader } from '../core/ui.js';
import { shrinkImage } from '../core/media.js';
import { saveCompany, saveLogo, removeLogo, logoSrc, setupToFinish, hasPostedInvoices, LOCKED_ONCE_POSTED, DAY_NAMES, fmtHours } from '../core/setup.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';

const toHours = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h + (m || 0) / 60; };

export function changesCard(entries, empty = 'No changes since the demo data was created.') {
  return html`<div class="card"><div class="card-head"><h2>Changes</h2><span class="muted small">from the audit log</span></div>
    ${entries.length ? html`<table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
      ${entries.slice(0, 12).map(a => html`<tr><td style="white-space:nowrap">${fmtDateTime(a.at)}</td><td>${auth.userName(a.userId)}</td><td class="wrap">${a.summary}</td></tr>`)}</tbody></table>`
      : html`<div class="muted small">${empty}</div>`}</div>`;
}

function letterheadPreview(c) {
  const src = logoSrc(c);
  return html`<div class="sheet" style="box-shadow:none;border:1px solid var(--line);width:auto;min-height:0;padding:12px 16px;margin:0">
    <div class="demo-banner">DEMO – prototype, not a valid document</div>
    <div class="head"><div class="logo">${src ? html`<img src="${src}" alt="Logo">` : 'LOGO'}</div><div class="head-main"><h1>QUOTATION</h1>
      <div>${c.address} | ${c.regLabel}: ${c.regNo}${c.chargesTax ? ` | ${c.taxRegLabel}: ${c.taxRegNo}` : ''}</div>
      <div>Tel: ${c.tel} &nbsp;|&nbsp; Mobile: ${c.mobile} &nbsp;|&nbsp; Email: ${c.email}</div></div></div>
    <div class="small" style="margin-top:6px">Payment: ${c.bank}${c.payNow ? ` · ${c.payNow}` : ''}</div></div>`;
}

export function renderCompanySetup(el) {
  const c = auth.company();
  const edit = auth.can('companySetup', 'edit');
  const locked = hasPostedInvoices();
  const taxes = store.list('taxes', t => t.status !== 'Inactive');
  const ww = { days: c.workDays || [1, 2, 3, 4, 5, 6], start: c.workStart ?? 8.5, end: c.workEnd ?? 17.5 };
  const ph = k => (c.placeholders || []).includes(k) ? placeholderTag('dummy') : '';
  const ro = edit ? '' : 'readonly';
  const line = (name, label, { lock = false, hint = '', tag = '' } = {}) => html`<div class="field"><label for="c-${name}">${label}${tag ? html` ${tag}` : ''}</label>
    <input type="text" id="c-${name}" name="${name}" value="${c[name] ?? ''}" ${(lock || !edit) ? 'readonly' : ''}>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
  const todo = setupToFinish(c);

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Admin Setup', title: 'Company Setup', sub: `${c.name} · changes apply to new documents`,
      actions: edit ? html`<button class="btn primary" id="save">Save</button>` : '' })}
    <form class="stack" id="cf" onsubmit="return false">
      ${foldHeader({ title: 'Company, registration & contact', open: true, body: html`<div class="fold-cols form-lines"><div>
        <div class="form-sec">Company</div>
        ${line('name', 'Company name')}
        <div class="field"><label>Code</label><input type="text" value="${c.code}" readonly><div class="hint">Fixed for the company</div></div>
        ${line('country', 'Country', { lock: locked, hint: locked ? 'Locked: this company has posted invoices' : '' })}
        ${line('currency', 'Currency', { lock: locked })}
        </div><div><div class="form-sec">Registration and tax</div>
        ${line('regLabel', 'Registration label')}${line('regNo', 'Registration no.', { tag: ph('regNo') })}
        <div class="field"><label>Charges tax</label><span class="chips">${[['true', 'Yes'], ['false', 'No']].map(([v, l]) => html`<label class="chip"><input type="radio" name="chargesTax" value="${v}" ${String(!!c.chargesTax) === v ? 'checked' : ''} ${edit ? '' : 'disabled'}><span>${l}</span></label>`)}</span>
          <div class="hint">New estimates take the change; drafts keep their tax</div></div>
        ${line('taxLabel', 'Tax label')}${line('taxRegLabel', 'Tax number label')}${line('taxRegNo', 'Tax number', { tag: ph('taxRegNo') })}
        <div class="field"><label for="c-tax">Default tax code</label><select id="c-tax" name="defaultTaxCode" ${edit ? '' : 'disabled'}>${taxes.map(t => html`<option value="${t.code}" ${t.code === c.defaultTaxCode ? 'selected' : ''}>${t.code} · ${t.name}</option>`)}</select><div class="hint">From the Tax master</div></div>
        </div><div><div class="form-sec">Contact</div>
        ${line('address', 'Address')}${line('tel', 'Tel')}${line('mobile', 'Mobile')}${line('email', 'Email')}</div>
      </div>` })}
      <div class="card"><div class="card-head"><h2>Payment details (on invoices)</h2></div><div class="form-lines fcols">
        ${line('bank', 'Bank', { tag: ph('bank') })}${line('payNow', 'PayNow', { tag: ph('payNow') })}</div></div>
      <div class="card"><div class="card-head"><h2>Working week</h2></div><div class="form-lines fcols">
        <div class="field"><label>Working days</label><span class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => html`<label class="chip"><input type="checkbox" name="wd${d}" ${ww.days.includes(d) ? 'checked' : ''} ${edit ? '' : 'disabled'}><span>${DAY_NAMES[d]}</span></label>`)}</span></div>
        <div class="field"><label>Working hours</label><div class="ro"><input type="time" name="workStart" value="${fmtHours(ww.start)}" ${ro} style="width:100px"> to <input type="time" name="workEnd" value="${fmtHours(ww.end)}" ${ro} style="width:100px"></div>
          <div class="hint">Scheduling suggestions and visit plans stay inside these days and hours</div></div></div></div>
      <div class="card"><div class="card-head"><h2>Data protection</h2></div><div class="form-lines fcols">
        ${line('dpo', 'DPO contact', { hint: 'Data protection officer (PDPA)' })}</div></div>
        <div class="split" style="grid-template-columns:220px minmax(0,1fr)">
          <div class="card"><div class="card-head"><h2>Logo</h2></div>
            <div class="logo-box">${logoSrc(c) ? html`<img src="${logoSrc(c)}" alt="Logo">` : html`<span class="muted small">No logo: prints show an empty box</span>`}</div>
            ${edit ? html`<div class="row" style="margin-top:8px"><label class="btn small">${c.logoId ? 'Replace' : 'Upload'}<input type="file" id="logo" accept="image/*" hidden></label>${c.logoId ? html`<button type="button" class="btn small link" id="noLogo">Remove</button>` : ''}</div>` : ''}</div>
          <div class="card"><div class="card-head"><h2>Setup to finish</h2><span class="muted small">${todo.length ? 'dummy values still in use' : 'all set'}</span></div>
            <ul class="chk">${todo.length ? todo.map(t => html`<li><span class="wn">!</span><span>${t.text} <span class="muted">· ${t.where}</span></span></li>`) : html`<li><span class="ok">✓</span><span>No dummy values left</span></li>`}</ul></div>
        </div>
        <div class="card"><div class="card-head"><h2>Letterhead on new documents</h2><span class="muted small">updates as you type</span></div>
          <div id="lh">${letterheadPreview(c)}</div>
          <div class="note small" style="margin-top:8px">Sent quotations, posted invoices and activated contracts keep the letterhead they were issued with.</div></div>
        ${changesCard(store.auditFor('companies', c.id).filter(a => a.action === 'update').reverse())}
    </form></div>`);

  const form = $('#cf', el);
  const read = () => {
    const out = {};
    $$('input[type=text][name], select[name]', form).forEach(i => { if (!i.readOnly) out[i.name] = i.value.trim(); });
    out.chargesTax = $('[name=chargesTax]:checked', form)?.value === 'true';
    out.workDays = [1, 2, 3, 4, 5, 6, 0].filter(d => $(`[name=wd${d}]`, form).checked);
    out.workStart = toHours($('[name=workStart]', form).value);
    out.workEnd = toHours($('[name=workEnd]', form).value);
    LOCKED_ONCE_POSTED.forEach(k => { if (locked) delete out[k]; });
    return out;
  };
  form.addEventListener('input', () => { $('#lh', el).innerHTML = String(letterheadPreview({ ...c, ...read() })); });
  $('#save', el)?.addEventListener('click', () => {
    const err = saveCompany(read());
    if (err) { toast(err, 'bad'); return; }
    toast('Company Setup saved'); render();
  });
  $('#logo', el)?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const blob = await shrinkImage(f, 360, 0.85);
      const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      saveLogo(dataUrl, f.name, blob.size);
      toast('Logo saved: it shows on new and draft documents'); render();
    } catch { toast('That file is not an image', 'bad'); }
  });
  $('#noLogo', el)?.addEventListener('click', () => { removeLogo(); render(); });
}
