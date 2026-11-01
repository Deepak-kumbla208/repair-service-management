// Phone: an AMC visit or a General Servicing job for the technician (flow step 8). The visit page has "On my way" and
// "Check in"; then the steps: safe isolation and before photos, the Inspection Check List per covered shutter (Pass /
// Fail / N/A, "All pass", a photo and note on every Fail), after photos, the customer's sign-off on the check list,
// payment (GS with immediate payment only) and check-out. kind: 'visit' (amcVisits) or 'gjob' (a GS job in jobs).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, toast, openModal, fmtDate, fmtTime, chipGroup, readForm, pill, MIC, icon } from '../core/ui.js';
import { zoneLabel, vsLabel, vsOptions, items } from '../core/lookups.js';
import { hydrateImages, removeBlob } from '../core/media.js';
import { savePhotos, signaturePad, bindMics } from '../core/capture.js';
import { startTravel, arrive, saveSvc, signOf, shutterState, setItem, setUnsafe, allPass, failuresOf, finishService, leaveSite, openRepairFor } from '../core/visits.js';
import { visitsOf } from '../core/contracts.js';
import { invoiceForJob, balanceOf, recordPayment, paymentsFor } from '../core/billing.js';
import { RATINGS } from '../web/print-docs.js';
import { serviceSheet } from '../web/print-amc.js';
import { openDocSheet } from './shell.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLL = { visit: 'amcVisits', gjob: 'jobs' };
const DONE = ['Done', 'Checked & filed', 'Work done', 'Completed & documented', 'Closed'];
const stepsFor = (kind, d) => [['start', 'Safety & photos'], ['list', 'Check list'], ['after', 'After photos'], ['signoff', 'Sign-off'],
  ...(kind === 'gjob' && d.paymentTerm === 'IMMEDIATE' ? [['pay', 'Payment']] : []), ['out', 'Check out']];
const title = (kind, d) => (kind === 'visit' ? `AMC visit ${d.n} of ${d.of}` : `${d.no} · servicing`);
const mine = (kind, d) => (auth.scope(kind === 'visit' ? 'amcExecution' : 'job') !== 'own' || d.technicianId === auth.user()?.employeeId);
const canWork = (kind, d) => auth.can(kind === 'visit' ? 'amcExecution' : 'job', 'edit', 'mobile') && d.technicianId === auth.user()?.employeeId;

function stepDone(kind, d, key) {
  const s = signOf(COLL[kind], d);
  const all = (d.shutters || []).every(sh => { const st = shutterState(d, sh); return st.answered === st.total; });
  const inv = kind === 'gjob' ? invoiceForJob(d.id) : null;
  return { start: !!d.safeIsolation, list: all && !!d.shutters?.length, after: (d.photosAfter || []).length > 0 || !!s?.signedAt, signoff: !!s?.signedAt,
    pay: !!inv && inv.status === 'Posted' && balanceOf(inv) <= 0, out: !!d.steps?.checkOutAt }[key];
}
const progress = (kind, d, cur) => html`<div class="prog">${stepsFor(kind, d).map(([k, label]) => html`<a href="#/m/${kind}/${d.id}/${k}" class="${k === cur ? 'n' : stepDone(kind, d, k) ? 'd' : ''}" style="text-decoration:none">${stepDone(kind, d, k) && k !== cur ? '✓ ' : ''}${label}</a>`)}</div>`;

// The card on My jobs.
export function serviceCard(kind, d) {
  const done = DONE.includes(d.status) && d.steps?.checkOutAt;
  const action = d.status === 'Scheduled' ? 'On my way' : d.status === 'On the way' ? 'Check in' : done ? 'View' : 'Continue';
  return html`<div class="job-card" style="${done ? 'opacity:.65;box-shadow:none' : ''}">
    <div class="row"><span class="pill ${kind === 'visit' ? 'green' : 'purple'}">${kind === 'visit' ? `AMC visit ${d.n} of ${d.of}` : 'General servicing'}</span><span class="grow"></span><b>${d.start ? `${fmtDate(d.start)} ${fmtTime(d.start)}` : 'Not scheduled'}</b></div>
    <div class="strong" style="margin-top:6px">${d.customer}</div>
    <div class="muted">${d.site} · Zone ${zoneLabel(d.zoneId)}</div>
    <div class="muted">${kind === 'visit' ? d.contractNo : d.no} · ${(d.shutters || []).length} shutters · ${d.contact}</div>
    <div class="row" style="margin-top:4px"><span class="pill">${d.status}</span>${d.days > 1 ? html`<span class="small muted">${d.days} days</span>` : ''}</div>
    <div class="actions">${d.phone ? html`<a class="btn" href="tel:${d.phone.replace(/\s/g, '')}">${icon('call', 15)} Call</a>` : ''}<a class="btn primary" href="#/m/${kind}/${d.id}" style="flex:2">${action}</a></div>
  </div>`;
}

export function mService(page, kind, id) {
  if (kind === 'gjob' && store.get('jobs', id)?.type !== 'GS') { go(`m/rjob/${id}`); return; }
  const coll = COLL[kind];
  const d = store.get(coll, id);
  page.setTitle(d ? title(kind, d) : 'Visit', 'm/jobs');
  if (!d || !mine(kind, d)) { page.body.innerHTML = '<div class="empty">Not found.</div>'; return; }
  const inv = kind === 'gjob' ? invoiceForJob(d.id) : null;
  page.body.innerHTML = String(html`
    <div class="row"><span class="pill ${kind === 'visit' ? 'green' : 'purple'}">${kind === 'visit' ? 'AMC visit' : 'General servicing'}</span><span class="pill">${d.status}</span><span class="grow"></span><b>${d.start ? fmtTime(d.start) : ''}</b></div>
    <h2 style="margin:8px 0 2px">${d.customer}</h2><div class="muted">${kind === 'visit' ? `${d.contractNo} · visit ${d.n} of ${d.of}` : d.no} · ${d.start ? fmtDate(d.start) : ''}</div>
    <div class="m-card" style="margin-top:10px"><div class="k muted small">Address</div>${d.address || d.site}<br><span class="pill blue" style="margin-top:4px">Zone ${zoneLabel(d.zoneId)}</span>${d.access ? html`<div class="small" style="margin-top:4px">Access: ${d.access}</div>` : ''}</div>
    <div class="m-card"><div class="k muted small">Contact</div>${d.contact}<br>${d.phone ? html`<div class="m-acts"><a class="btn" href="tel:${d.phone.replace(/\s/g, '')}">${icon('call', 15)} ${d.phone}</a></div>` : ''}</div>
    <div class="m-section">Shutters to check (${d.shutters.length})</div>${d.shutters.map(sh => html`<div class="m-card small"><b>${sh.tag}</b> ${sh.location} · ${sh.typeName} · ${sh.sizeCode}${sh.fireRated ? ' · fire-rated' : ''}</div>`)}
    ${kind === 'gjob' ? html`<div class="m-section">Payment</div><div class="m-card small">${vsLabel('PAYMENT_TERMS', d.paymentTerm)}${inv?.status === 'Posted' && d.paymentTerm === 'IMMEDIATE' ? html` · ${inv.no} · <b>collect ${auth.company().currency} ${m2(balanceOf(inv))}</b>` : ' · invoice from the office'}</div>`
      : html`<div class="m-section">Payment</div><div class="m-card small">Nothing to collect: the contract is billed by its plan.</div>`}
    ${d.steps?.checkInAt ? html`<div class="m-section">Steps</div>${progress(kind, d, '')}` : ''}`);
  if (!canWork(kind, d)) return;
  const foot = d.status === 'Scheduled' ? html`<button class="btn primary" id="go">On my way</button>`
    : d.status === 'On the way' ? html`<button class="btn primary" id="go">Check in · Time In now</button>` : html`<button class="btn primary" id="go">${d.steps?.checkOutAt ? 'View the steps' : 'Continue'}</button>`;
  page.setFoot(foot).querySelector('#go').onclick = () => {
    if (d.status === 'Scheduled') { startTravel(coll, id); toast('The office sees you are on the way'); return mService(page, kind, id); }
    if (d.status === 'On the way') { arrive(coll, id); toast('Checked in'); return go(`m/${kind}/${id}/start`); }
    const cur = store.get(coll, id);
    go(`m/${kind}/${id}/${stepsFor(kind, cur).find(([k]) => !stepDone(kind, cur, k))?.[0] || 'out'}`);
  };
}

function photosBlock(d, field, label) {
  return html`<div class="m-section">${label}</div><div class="photos">${(d[field] || []).map(p => html`<div class="photo"><img data-media="${p}" alt="${label}"><button type="button" class="del" data-pdel="${field}|${p}" aria-label="Remove photo">×</button></div>`)}</div>
    <label class="add-dashed" style="display:block;margin-top:8px">📷 Take or add photos<input type="file" accept="image/*" capture="environment" multiple hidden data-padd="${field}"></label>`;
}
function bindPhotos(body, coll, id, repaint) {
  $$('[data-padd]', body).forEach(inp => inp.addEventListener('change', async e => {
    const ids = await savePhotos(e.target.files);
    const f = inp.dataset.padd;
    if (ids.length) { saveSvc(coll, id, { [f]: [...(store.get(coll, id)[f] || []), ...ids] }); toast(`${ids.length} photo(s) added`); }
    repaint();
  }));
  $$('[data-pdel]', body).forEach(b => b.addEventListener('click', () => { const [f, pid] = b.dataset.pdel.split('|'); saveSvc(coll, id, { [f]: store.get(coll, id)[f].filter(p => p !== pid) }); removeBlob(pid); repaint(); }));
}

// The open repair enquiry (same site) that already holds this shutter's fault, if any.
const openFault = (d, shutterId, code) => openRepairFor(d.siteId, shutterId, code);
// Last visit's failures for a shutter (AMC visits of the same contract and site).
function lastResult(kind, d, sh) {
  if (kind !== 'visit') return null;
  const prev = visitsOf(d.contractId).filter(v => v.siteKey === d.siteKey && v.n < d.n && v.signoff?.signedAt).sort((a, b) => b.n - a.n)[0];
  if (!prev) return null;
  const fails = (prev.failures || []).filter(f => f.shutterId === sh.shutterId);
  return { n: prev.n, fails };
}

export function mShutter(page, kind, id, shutterId) {
  const coll = COLL[kind];
  const d = store.get(coll, id);
  const sh = d?.shutters.find(s => s.shutterId === shutterId);
  if (!d || !sh || !mine(kind, d)) { page.setTitle('Shutter', 'm/jobs'); page.body.innerHTML = '<div class="empty">Not found.</div>'; return; }
  page.setTitle(`${sh.tag} ${sh.location}`, `m/${kind}/${id}/list`);
  const locked = !!signOf(coll, d)?.signedAt || !canWork(kind, d);
  const st = shutterState(d, sh);
  const last = lastResult(kind, d, sh);
  const parts = [{ value: '', label: 'No part' }, ...items().map(i => ({ value: i.id, label: i.name }))];
  const on = st.items.filter(i => i.on), off = st.items.filter(i => !i.on);
  page.body.innerHTML = String(html`
    <div class="row" style="margin-bottom:4px"><span class="muted small">${sh.typeName} · ${sh.sizeCode}${sh.fireRated ? ' · fire-rated' : ''}</span><span class="grow"></span>${locked ? '' : html`<button class="btn small" id="allPass">✓ All pass</button>`}</div>
    ${last ? html`<div class="small" style="margin-bottom:6px;color:${last.fails.length ? 'var(--red-ink)' : 'var(--green-ink)'}">Last visit (${last.n}): ${last.fails.length ? last.fails.map(f => f.label).join(', ') : 'all pass'}</div>` : ''}
    ${on.map(i => html`<div class="ck"><div class="t"><b>${i.label}${i.hint ? html`<small>${i.hint}</small>` : ''}</b><span class="pf">${[['P', 'Pass', 'p'], ['F', 'Fail', 'f'], ['NA', 'N/A', 'na']].map(([r, label, cls]) => html`<button type="button" class="${i.r === r ? cls : ''}" data-r="${i.code}|${r}" ${locked ? 'disabled' : ''}>${label}</button>`)}</span></div>
      ${i.r === 'F' ? html`<div class="failbox"><div class="row" style="gap:8px;align-items:flex-start">
          ${i.photoId ? html`<div class="photo" style="width:56px;height:56px"><img data-media="${i.photoId}" alt="Photo"></div>` : html`<label class="add-dashed" style="width:70px;font-size:11px;padding:6px">📷 Photo<input type="file" accept="image/*" capture="environment" hidden data-fphoto="${i.code}"></label>`}
          <div class="grow"><div class="with-mic"><input type="text" data-fnote="${i.code}" name="n_${i.code}" value="${i.note || ''}" placeholder="What is wrong (needed)" ${locked ? 'disabled' : ''}><button type="button" class="mic" data-mic="n_${i.code}">${MIC}</button></div>
            <div class="row small" style="margin-top:4px">Part <select data-fpart="${i.code}" ${locked ? 'disabled' : ''}>${parts.map(p => html`<option value="${p.value}" ${p.value === (i.itemId || '') ? 'selected' : ''}>${p.label}</option>`)}</select>
              ${i.itemId ? html`× <input type="number" data-fqty="${i.code}" value="${i.qty || 1}" style="width:48px" ${locked ? 'disabled' : ''}>` : ''}</div></div></div>
        ${openFault(d, sh.shutterId, i.code) ? html`<div class="small" style="margin-top:6px;color:var(--red-ink)">Already open in ${openFault(d, sh.shutterId, i.code).no} (${openFault(d, sh.shutterId, i.code).status}): this will be added to it.</div>` : ''}</div>` : ''}</div>`)}
    ${off.length ? html`<div class="ck na"><div class="t"><b>${off.length} item${off.length > 1 ? 's' : ''} not for this type<small>${off.map(i => i.label).join(' · ')}</small></b><span class="pf"><span class="na">N/A</span></span></div></div>` : ''}
    <label class="check" style="display:flex;margin:8px 0"><input type="checkbox" id="unsafe" ${st.unsafe ? 'checked' : ''} ${locked ? 'disabled' : ''}> Unsafe – take this shutter out of service</label>
    <p class="muted small">An adjustment you made on the spot is a Pass with a note. Fail means a repair is needed.</p>`);
  hydrateImages(page.body);
  bindMics(page.body);
  const repaint = () => mShutter(page, kind, id, shutterId);
  $('#allPass', page.body)?.addEventListener('click', () => { allPass(coll, id, shutterId); repaint(); });
  $$('[data-r]', page.body).forEach(b => b.addEventListener('click', () => { const [code, r] = b.dataset.r.split('|'); setItem(coll, id, shutterId, code, { r }); repaint(); }));
  $$('[data-fnote]', page.body).forEach(inp => inp.addEventListener('input', () => setItem(coll, id, shutterId, inp.dataset.fnote, { note: inp.value })));
  $$('[data-fpart]', page.body).forEach(s => s.addEventListener('change', () => { setItem(coll, id, shutterId, s.dataset.fpart, { itemId: s.value, qty: 1 }); repaint(); }));
  $$('[data-fqty]', page.body).forEach(s => s.addEventListener('input', () => setItem(coll, id, shutterId, s.dataset.fqty, { qty: Number(s.value) || 1 })));
  $$('[data-fphoto]', page.body).forEach(inp => inp.addEventListener('change', async e => { const [pid] = await savePhotos(e.target.files); if (pid) setItem(coll, id, shutterId, inp.dataset.fphoto, { photoId: pid }); repaint(); }));
  $('#unsafe', page.body)?.addEventListener('change', e => setUnsafe(coll, id, shutterId, e.target.checked));
  const list = d.shutters;
  const next = list[list.findIndex(s => s.shutterId === shutterId) + 1];
  const foot = page.setFoot(html`<a class="btn" href="#/m/${kind}/${id}/list">← All shutters</a>${next ? html`<a class="btn primary" href="#/m/${kind}/${id}/sh/${next.shutterId}">Next: ${next.tag} →</a>` : html`<a class="btn primary" href="#/m/${kind}/${id}/after">Next: After photos</a>`}`);
  foot.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { $$('[data-fnote]', page.body).forEach(inp => setItem(coll, id, shutterId, inp.dataset.fnote, { note: inp.value })); }));
}

const RENDER = {
  start: (kind, d, locked) => html`<label class="check" style="display:flex;margin:4px 0 10px;font-weight:600"><input type="checkbox" id="safe" ${d.safeIsolation ? 'checked' : ''} ${locked ? 'disabled' : ''}> Safe isolation done (power off and locked) before work</label>
    <p class="small muted" style="margin:0 0 6px">Take photos of the shutters before you start.</p>${photosBlock(d, 'photosBefore', 'Before photos')}`,
  list: (kind, d) => (!d.shutters.length ? html`<div class="m-card">No shutters to check. Ask the office to add them to the site's shutter register.</div>` : html`${d.shutters.map(sh => { const st = shutterState(d, sh); return html`<a class="shl" href="#/m/${kind}/${d.id}/sh/${sh.shutterId}" style="display:block;color:inherit;text-decoration:none">
      <div class="r"><b>${sh.tag}</b>&nbsp;${sh.location}<span class="grow"></span>${st.fails ? pill(`${st.fails} fail`, 'red') : st.answered === st.total ? pill('All pass', 'green') : pill(st.answered ? `${st.answered} of ${st.total}` : 'Not started')}</div>
      <div class="muted small">${sh.typeName} · ${sh.sizeCode}${sh.fireRated ? ' · fire-rated' : ''} · ${st.total} items${st.off ? ` (${st.off} N/A)` : ''}</div><div class="minibar"><i style="width:${st.total ? (st.answered / st.total) * 100 : 0}%;${st.answered === st.total && !st.fails ? 'background:var(--green)' : ''}"></i></div></a>`; })}`),
  after: (kind, d) => photosBlock(d, 'photosAfter', 'After photos'),
  signoff: (kind, d, locked) => {
    const coll = COLL[kind];
    const s = signOf(coll, d);
    const fails = failuresOf(d);
    const pad = (who, sid) => (sid ? html`<img class="sig-img" data-media="${sid}" alt="Signature">${locked ? '' : html`<button type="button" class="btn link small" data-resign="${who}">Sign again</button>`}`
      : html`<canvas class="sig-pad" id="sig_${who}" style="height:100px"></canvas><div class="hint small muted">Sign with a finger or the mouse.</div>`);
    return html`<div class="wd-sec">INSPECTION CHECK LIST · ${kind === 'visit' ? d.reportNo : d.no}</div>
      <div class="wd-kv"><span class="k">Customer</span><span>${d.customer}</span><span class="k">Site</span><span>${d.site}</span><span class="k">Result</span><span><b>${d.shutters.length} shutters</b> · ${fails.length ? `${fails.length} failed item(s)` : 'all pass'}</span></div>
      ${fails.length ? html`<div class="wd-sec">FAILED ITEMS</div>${fails.map(f => { const o = openFault(d, f.shutterId, f.code); return html`<div class="wl small"><b>${f.tag} ${f.label}</b> · ${f.note || html`<span style="color:var(--red-ink)">note missing</span>`} · ${o ? html`added to <b>${o.no}</b>` : html`<b>new repair enquiry</b>`}</div>`; })}` : ''}
      <div class="wd-sec">CUSTOMER FEEDBACK</div><div class="small muted">Hand the phone to the customer. 5 Excellent · 1 Very poor</div>
      ${RATINGS.map(([k, label]) => html`<div class="rate"><span>${label}</span>${[5, 4, 3, 2, 1].map(n => html`<button type="button" class="dot ${s.ratings[k] === n ? 'on' : ''}" data-rate="${k}|${n}" ${locked ? 'disabled' : ''}>${n}</button>`)}</div>`)}
      <div class="wd-sec">SIGN-OFF</div>
      <div class="small strong">Checked by · Company Representative</div>
      <div class="grid g2" style="margin:4px 0"><div class="field"><label>Name</label><input name="t_name" value="${s.tech.name}" ${locked ? 'disabled' : ''}></div><div class="field"><label>Designation</label><input name="t_designation" value="${s.tech.designation}" ${locked ? 'disabled' : ''}></div></div>
      ${pad('tech', s.tech.signatureId)}
      <div class="small strong" style="margin-top:10px">Acknowledged by · Customer</div>
      <button type="button" class="btn block" id="previewDoc" style="margin:6px 0">${icon('eye', 15)} Preview the service report for the customer</button>
      <div class="grid g2" style="margin:4px 0"><div class="field"><label>Name</label><input name="c_name" value="${s.cust.name}" ${locked ? 'disabled' : ''}></div><div class="field"><label>Designation</label><input name="c_designation" value="${s.cust.designation}" ${locked ? 'disabled' : ''}></div></div>
      ${pad('cust', s.cust.signatureId)}
      <div class="m-section">Company stamp</div>
      ${s.cust.stampId ? html`<img class="sig-img" data-media="${s.cust.stampId}" alt="Company stamp" style="max-height:80px">` : locked ? '' : html`<label class="add-dashed" style="display:block">📷 Photo of the company stamp<input type="file" accept="image/*" capture="environment" hidden id="stampIn"></label>`}`;
  },
  pay: (kind, d) => {
    const inv = invoiceForJob(d.id);
    if (!inv || inv.status !== 'Posted') return html`<div class="m-card">The invoice is not posted yet. Ask the office.</div>`;
    const bal = balanceOf(inv);
    return html`<div class="m-card"><div class="row"><b>${inv.no}</b><span class="grow"></span><span class="pill ${bal > 0 ? 'amber' : 'green'}">${bal > 0 ? 'Due now' : 'Paid'}</span></div>
      <div style="font-size:20px;font-weight:600;margin-top:4px">${auth.company().currency} ${m2(bal > 0 ? bal : inv.total)}</div></div>
      ${paymentsFor(inv.id).map(p => html`<div class="m-card small">✓ ${p.no} · ${vsLabel('PAYMENT_METHOD', p.method)} · ${m2(p.amount)}</div>`)}
      ${bal > 0 && auth.can('payment', 'create', 'mobile') ? html`<div class="form-lines" style="margin-top:6px"><div class="field"><label>Method</label>${chipGroup('method', vsOptions('PAYMENT_METHOD'), vsOptions('PAYMENT_METHOD')[0]?.value)}</div>
        <div class="field"><label>Amount</label><input type="number" step="0.01" name="amount" value="${bal.toFixed(2)}"></div><div class="field"><label>Reference</label><input type="text" name="reference"></div></div>
        <button type="button" class="btn primary block" id="recPay" style="margin-top:8px">Record payment</button>` : ''}`;
  },
  out: (kind, d) => (d.steps?.checkOutAt ? html`<div class="okay"><b>✓ Checked out at ${fmtTime(d.steps.checkOutAt)}</b><br><span class="small">${kind === 'visit' ? 'Visit done. The office files the report.' : 'Job done. Thank you.'}</span></div>`
    : html`<div class="m-card small">Check out when you leave the site. ${kind === 'visit' ? 'The AMC flow needs no office OK to leave.' : ''}</div>`),
};

export function mServiceStep(page, kind, id, key) {
  const coll = COLL[kind];
  const d = store.get(coll, id);
  if (!d || !mine(kind, d)) { page.setTitle('Visit', 'm/jobs'); page.body.innerHTML = '<div class="empty">Not found.</div>'; return; }
  if (!d.steps?.checkInAt) { go(`m/${kind}/${id}`); return; }
  const steps = stepsFor(kind, d);
  const idx = Math.max(0, steps.findIndex(([k]) => k === key));
  const [step, label] = steps[idx];
  page.setTitle(`${title(kind, d)} · ${label}`, `m/${kind}/${id}`);
  const locked = !canWork(kind, d) || (!!signOf(coll, d)?.signedAt && ['start', 'signoff'].includes(step));
  const pads = {};
  page.body.innerHTML = String(html`${progress(kind, d, step)}<form id="f" onsubmit="return false">${RENDER[step](kind, d, locked)}</form>${locked && signOf(coll, d)?.signedAt && ['signoff'].includes(step) ? html`<div class="note small" style="margin-top:8px">Signed by the customer; the check list is locked.</div>` : ''}`);
  const body = $('#f', page.body);
  hydrateImages(page.body);
  bindMics(body);
  const repaint = () => mServiceStep(page, kind, id, step);
  if (!locked) bindPhotos(body, coll, id, repaint);
  $('#safe', body)?.addEventListener('change', e => saveSvc(coll, id, { safeIsolation: e.target.checked }));
  const sk = coll === 'jobs' ? 'workDone' : 'signoff';
  const readSign = () => {
    const s = structuredClone(signOf(coll, store.get(coll, id)));
    const f = readForm(body);
    s.tech = { ...s.tech, name: f.t_name ?? s.tech.name, designation: f.t_designation ?? s.tech.designation };
    s.cust = { ...s.cust, name: f.c_name ?? s.cust.name, designation: f.c_designation ?? s.cust.designation };
    return s;
  };
  const savePads = async () => {
    if (step !== 'signoff' || locked) return;
    const s = readSign();
    for (const who of Object.keys(pads)) if (!pads[who].isEmpty()) s[who].signatureId = (await pads[who].save()).id;
    saveSvc(coll, id, { [sk]: s });
  };
  if (step === 'signoff' && !locked) {
    ['tech', 'cust'].forEach(who => { const c = $(`#sig_${who}`, body); if (c) pads[who] = signaturePad(c); });
    body.addEventListener('input', () => saveSvc(coll, id, { [sk]: readSign() }));
    $$('[data-rate]', body).forEach(b => b.addEventListener('click', async () => { await savePads(); const [k, n] = b.dataset.rate.split('|'); const s = readSign(); s.ratings[k] = Number(n); saveSvc(coll, id, { [sk]: s }); repaint(); }));
    $$('[data-resign]', body).forEach(b => b.addEventListener('click', async () => { await savePads(); const s = readSign(); removeBlob(s[b.dataset.resign].signatureId); s[b.dataset.resign].signatureId = null; saveSvc(coll, id, { [sk]: s }); repaint(); }));
    $('#stampIn', body)?.addEventListener('change', async e => { await savePads(); const [sid] = await savePhotos(e.target.files); if (sid) { const s = readSign(); s.cust.stampId = sid; saveSvc(coll, id, { [sk]: s }); } repaint(); });
  }
  // The customer reads the service report before signing: what is drawn is kept, then the report opens as it prints.
  $('#previewDoc', body)?.addEventListener('click', async () => {
    if (!locked) { await savePads(); repaint(); }
    openDocSheet('Preview · Service report', serviceSheet(store.get(coll, id), coll, auth.company()));
  });
  $('#recPay', body)?.addEventListener('click', () => {
    const f = readForm(body);
    const r = recordPayment({ invoiceId: invoiceForJob(id).id, amount: f.amount, method: f.method, reference: f.reference, via: 'phone' });
    if (r.problems.length) { toast(r.problems[0], 'bad'); return; }
    toast(`${r.payment.no} recorded · the office sees it now`); repaint();
  });

  const prev = idx > 0 ? `m/${kind}/${id}/${steps[idx - 1][0]}` : `m/${kind}/${id}`;
  const nextRoute = idx < steps.length - 1 ? `m/${kind}/${id}/${steps[idx + 1][0]}` : `m/${kind}/${id}`;
  const cur = store.get(coll, id);
  const main = !canWork(kind, cur) ? '' : step === 'list' && cur.shutters.length ? html`<a class="btn primary" href="#/m/${kind}/${id}/sh/${(cur.shutters.find(sh => { const st = shutterState(cur, sh); return st.answered < st.total; }) || cur.shutters[0]).shutterId}">${stepDone(kind, cur, 'list') ? 'Review a shutter' : 'Check the next shutter'}</a><button class="btn" id="next">Next</button>`
    : step === 'signoff' && !signOf(coll, cur)?.signedAt ? html`<button class="btn primary" id="finish">Finish: customer signed</button>`
      : step === 'out' ? (cur.steps?.checkOutAt ? html`<a class="btn primary" href="#/m/jobs">Back to My jobs</a>` : signOf(coll, cur)?.signedAt ? html`<button class="btn primary" id="checkout">Check out · Time Out now</button>` : '')
        : html`<button class="btn primary" id="next">Next: ${steps[idx + 1]?.[1]}</button>`;
  const foot = page.setFoot(html`<button class="btn" id="back">← Back</button>${main}`);
  $('#back', foot).onclick = async () => { await savePads(); go(prev); };
  $('#next', foot)?.addEventListener('click', async () => { await savePads(); if (step === 'start' && !store.get(coll, id).safeIsolation) { toast('Tick "Safe isolation done" first', 'bad'); return; } go(nextRoute); });
  $('#finish', foot)?.addEventListener('click', async () => {
    await savePads();
    const r = finishService(coll, id);
    if (r.problems?.length) { openModal({ title: 'Not ready to finish', body: html`<ul>${r.problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] }); return; }
    const made = r.repair?.created ? `Repair enquiry ${r.repair.created.no} created` : r.repair?.addedTo?.length ? 'Failure added to the open repair enquiry' : 'All pass';
    toast(`Check list signed · ${made}`);
    go(nextRoute);
  });
  $('#checkout', foot)?.addEventListener('click', () => { leaveSite(coll, id); toast('Checked out'); repaint(); });
}
