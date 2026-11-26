// Phone: a maintenance (AMC) visit or a General Servicing job for the technician. The visit page has "On my way" and
// "Check in"; then the steps: safe isolation and before photos, the Inspection Check List per covered product (Pass /
// Fail / N/A as three wide buttons under each item, "All pass", a photo and note on every Fail), after photos, the
// customer's sign-off on the check list, payment (GS with immediate payment only) and check-out.
// kind: 'visit' (amcVisits) or 'gjob' (a GS job in jobs).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, toast, confirmBox, fmtDate, fmtTime, chipGroup, readForm, pill, MIC, icon } from '../core/ui.js';
import { zoneLabel, vsLabel, vsOptions, items } from '../core/lookups.js';
import { isToday } from '../core/enquiries.js';
import { hydrateImages, removeBlob } from '../core/media.js';
import { savePhotos, signaturePad, bindMics } from '../core/capture.js';
import { startTravel, undoTravel, arrive, undoArrive, saveSvc, signOf, shutterState, setItem, setUnsafe, allPass, failuresOf, finishService, signoffIssues, leaveSite, openRepairFor } from '../core/visits.js';
import { visitsOf } from '../core/contracts.js';
import { invoiceForJob, balanceOf, recordPayment, paymentsFor } from '../core/billing.js';
import { RATINGS } from '../web/print-docs.js';
import { serviceSheet } from '../web/print-amc.js';
import { openDocSheet, holdNext, show, undoToast } from './shell.js';
import { markSeen, whenText, visitWord, callBtn, directionsBtn, stepBar, problemsBox, showAt, setJump, takeJump } from './parts.js';
import { signBox } from './repair-steps.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLL = { visit: 'amcVisits', gjob: 'jobs' };
const stepsFor = (kind, d) => [['start', 'Safety and photos', 'Safety'], ['list', 'Check list', 'Check list'], ['after', 'After photos', 'After'], ['signoff', 'Sign-off', 'Sign-off'],
  ...(kind === 'gjob' && d.paymentTerm === 'IMMEDIATE' ? [['pay', 'Payment', 'Payment']] : []), ['out', 'Check out', 'Check out']];
const titleOf = d => [d.customer, d.site].filter(Boolean).join(' · ');
// The number first, so it is never the part that is cut off.
const docNo = (kind, d) => (kind === 'visit' ? d.contractNo : d.no);
const subOf = (kind, d) => (kind === 'visit' ? `${d.contractNo} · ${visitWord()} ${d.n} of ${d.of}` : `${d.no} · General servicing`);
const mine = (kind, d) => (auth.scope(kind === 'visit' ? 'amcExecution' : 'job') !== 'own' || d.technicianId === auth.user()?.employeeId);
const canWork = (kind, d) => auth.can(kind === 'visit' ? 'amcExecution' : 'job', 'edit', 'mobile') && d.technicianId === auth.user()?.employeeId;
const typeLine = sh => `${[sh.typeName, sh.sizeText || sh.sizeCode].filter(Boolean).join(' · ')}${sh.fireRated ? ' · fire-rated' : ''}`;
// After "Finish: customer signed" found something missing, the steps that hold it show red until it is put right.
const checkKey = id => `rsmSvcCheck.${id}`;
const checking = id => sessionStorage.getItem(checkKey(id)) === '1';
const setChecking = (id, on) => (on ? sessionStorage.setItem(checkKey(id), '1') : sessionStorage.removeItem(checkKey(id)));

function stepDone(kind, d, key) {
  const s = signOf(COLL[kind], d);
  const all = (d.shutters || []).every(sh => { const st = shutterState(d, sh); return st.answered === st.total; });
  const inv = kind === 'gjob' ? invoiceForJob(d.id) : null;
  const told = failuresOf(d).every(f => f.note.trim() && f.photoId); // a failed item is finished with its photo and note
  return { start: !!d.safeIsolation, list: all && told && !!d.shutters?.length, after: (d.photosAfter || []).length > 0, signoff: !!s?.signedAt,
    pay: !!inv && inv.status === 'Posted' && balanceOf(inv) <= 0, out: !!d.steps?.checkOutAt }[key];
}
// 'done', 'skip' (after photos passed with none taken), 'bad' (asked for at sign-off and still missing) or ''.
function stepState(kind, d, key, passed = false) {
  if (stepDone(kind, d, key)) return 'done';
  const s = signOf(COLL[kind], d);
  if (key === 'after') return passed || s?.signedAt ? 'skip' : '';
  if (checking(d.id) && !s?.signedAt && signoffIssues(COLL[kind], d).some(i => i.step === key)) return 'bad';
  return '';
}
const bar = (kind, d, idx) => stepBar(stepsFor(kind, d).map(([k, t, short], i) => ({ title: t, short, href: `m/${kind}/${d.id}/${k}`, state: stepState(kind, d, k, i < idx) })), idx);

export function mService(page, kind, id, { just = '' } = {}) {
  if (kind === 'gjob' && store.get('jobs', id)?.type !== 'GS') { go(`m/rjob/${id}`); return; }
  const coll = COLL[kind];
  const d = store.get(coll, id);
  page.setTitle(d ? titleOf(d) : 'Visit', 'm/jobs', d ? subOf(kind, d) : '');
  if (!d || !mine(kind, d)) { page.body.innerHTML = '<div class="empty">Not found.</div>'; return; }
  const inv = kind === 'gjob' ? invoiceForJob(d.id) : null;
  const address = d.address || d.site;
  if (canWork(kind, d)) markSeen(d.id, d.start);
  const steps = stepsFor(kind, d);
  page.body.innerHTML = String(html`
    <div class="m-card">
      <div class="row top"><span class="row wrap grow"><span class="pill ${kind === 'visit' ? 'green' : 'purple'}">${kind === 'visit' ? visitWord() : 'General servicing'}</span><span class="pill">${d.status}</span></span><b>${whenText(d.start, 'Not scheduled')}</b></div>
      <div style="margin-top:8px">${address}${d.access ? html`<br><span class="small">Access: ${d.access}</span>` : ''}</div>
      <div class="muted small">Zone ${zoneLabel(d.zoneId)} · ${[d.contact, d.phone].filter(Boolean).join(' ')}${d.days > 1 ? ` · ${d.days} days` : ''}</div>
      <div class="m-acts">${callBtn(d.phone)}${directionsBtn(address)}</div>
    </div>
    ${d.steps?.checkInAt ? html`<div class="m-section">Steps</div><div class="m-card"><ol class="m-steps">${steps.map(([k, t], n) => { const st = stepState(kind, d, k); return html`<li class="${st}"><span class="n">${st === 'done' ? '✓' : st === 'skip' ? '–' : st === 'bad' ? '!' : n + 1}</span><div><b>${t}</b></div></li>`; })}</ol></div>` : ''}
    <div class="m-section">Products to check (${d.shutters.length})</div>${d.shutters.map(sh => html`<div class="m-card"><b>${sh.tag}</b> ${sh.location}<br><span class="small muted">${typeLine(sh)}</span></div>`)}
    <div class="m-section">Payment</div>
    ${kind === 'gjob' ? html`<div class="m-card">${vsLabel('PAYMENT_TERMS', d.paymentTerm)}${inv?.status === 'Posted' && d.paymentTerm === 'IMMEDIATE' ? html` · ${inv.no} · <b>collect ${auth.company().currency} ${m2(balanceOf(inv))}</b>` : ' · invoice from the office'}</div>`
      : html`<div class="m-card">Nothing to collect: the contract is billed by its plan.</div>`}`);
  if (!canWork(kind, d)) return;
  const label = d.status === 'Scheduled' ? 'On my way' : d.status === 'On the way' ? 'Check in · Time In now' : d.steps?.checkOutAt ? 'View the steps' : 'Continue';
  const btn = page.setFoot(html`<button class="btn primary" id="go">${just ? `✓ ${just}` : label}</button>`).querySelector('#go');
  if (just) setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1300);
  btn.onclick = async () => {
    if (btn.dataset.held) return;
    if (d.status === 'Scheduled') {
      if (!isToday(d.start) && !(await confirmBox('Not planned for today', `This visit is planned for ${fmtDate(d.start)} ${fmtTime(d.start)}. Start travelling now?`, 'On my way'))) return;
      startTravel(coll, id); holdNext();
      mService(page, kind, id, { just: 'On the way' });
      undoToast('On the way · the office can see it', () => { undoTravel(coll, id); show(`m/${kind}/${id}`); });
      return;
    }
    if (d.status === 'On the way') {
      arrive(coll, id); holdNext();
      undoToast(`Checked in · Time In ${fmtTime(new Date().toISOString())}`, () => { undoArrive(coll, id); show(`m/${kind}/${id}`); });
      go(`m/${kind}/${id}/start`);
      return;
    }
    const cur = store.get(coll, id);
    go(`m/${kind}/${id}/${stepsFor(kind, cur).find(([k]) => !stepDone(kind, cur, k) && stepState(kind, cur, k) !== 'skip')?.[0] || 'out'}`);
  };
}

function photosBlock(d, field, label) {
  return html`<div class="m-section">${label} (${(d[field] || []).length})</div><div class="photos">${(d[field] || []).map(p => html`<div class="photo"><img data-media="${p}" alt="${label}"><button type="button" class="del" data-pdel="${field}|${p}" aria-label="Remove photo">×</button></div>`)}</div>
    <label class="add-dashed" style="margin-top:8px">${icon('plus', 18)} Take or add photos<input type="file" accept="image/*" capture="environment" multiple hidden data-padd="${field}" aria-label="${label}"></label>`;
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

// The open repair enquiry (same site) that already holds this product's fault, if any.
const openFault = (d, shutterId, code) => openRepairFor(d.siteId, shutterId, code);
// Last visit's failures for a product (visits of the same contract and site).
function lastResult(kind, d, sh) {
  if (kind !== 'visit') return null;
  const prev = visitsOf(d.contractId).filter(v => v.siteKey === d.siteKey && v.n < d.n && v.signoff?.signedAt).sort((a, b) => b.n - a.n)[0];
  if (!prev) return null;
  const fails = (prev.failures || []).filter(f => f.shutterId === sh.shutterId);
  return { n: prev.n, fails };
}

// The check list of one product.
export function mShutter(page, kind, id, shutterId) {
  const coll = COLL[kind];
  const d = store.get(coll, id);
  const sh = d?.shutters.find(s => s.shutterId === shutterId);
  if (!d || !sh || !mine(kind, d)) { page.setTitle('Product', 'm/jobs'); page.body.innerHTML = '<div class="empty">Not found.</div>'; return; }
  page.setTitle(`${sh.tag} ${sh.location}`, `m/${kind}/${id}/list`, typeLine(sh));
  const locked = !!signOf(coll, d)?.signedAt || !canWork(kind, d);
  const st = shutterState(d, sh);
  const last = lastResult(kind, d, sh);
  const parts = [{ value: '', label: 'No part' }, ...items().map(i => ({ value: i.id, label: i.name }))];
  const on = st.items.filter(i => i.on), off = st.items.filter(i => !i.on);
  page.body.innerHTML = String(html`
    <div class="row" style="margin-bottom:8px"><span class="grow"><b>${st.answered} of ${st.total}</b> checked${st.fails ? html` · <span style="color:var(--red)">${st.fails} failed</span>` : ''}</span>${locked ? '' : html`<button class="btn" id="allPass">✓ All pass</button>`}</div>
    ${last ? html`<div class="small strong" style="margin-bottom:8px;color:${last.fails.length ? 'var(--red-ink)' : 'var(--green-ink)'}">Last visit (${last.n}): ${last.fails.length ? last.fails.map(f => f.label).join(', ') : 'all pass'}</div>` : ''}
    ${on.map(i => { const open = i.r === 'F' ? openFault(d, sh.shutterId, i.code) : null; return html`<div class="ck" data-code="${i.code}"><div class="t"><b>${i.label}${i.hint ? html`<small>${i.hint}</small>` : ''}</b></div>
      <div class="pf" role="group" aria-label="${i.label}">${[['P', 'Pass', 'p'], ['F', 'Fail', 'f'], ['NA', 'N/A', 'na']].map(([r, label, cls]) => html`<button type="button" class="${i.r === r ? cls : ''}" data-r="${i.code}|${r}" aria-pressed="${i.r === r ? 'true' : 'false'}" ${locked ? 'disabled' : ''}>${label}</button>`)}</div>
      ${i.r === 'F' ? html`<div class="failbox"><div class="row top">
          ${i.photoId ? html`<div class="photo" style="width:76px;height:76px;flex:none"><img data-media="${i.photoId}" alt="Photo of the fault"></div>` : html`<div class="field" style="flex:none"><label class="add-dashed fail-photo">${icon('plus', 18)} Photo<input type="file" accept="image/*" capture="environment" hidden data-fphoto="${i.code}" aria-label="Photo of the fault"></label></div>`}
          <div class="grow"><div class="field"><div class="with-mic"><input type="text" data-fnote="${i.code}" name="n_${i.code}" value="${i.note || ''}" placeholder="What is wrong?" aria-label="What is wrong with ${i.label}" ${locked ? 'disabled' : ''}><button type="button" class="mic" data-mic="n_${i.code}" aria-label="Voice input">${MIC}</button></div></div>
            <div class="row" style="margin-top:8px"><select data-fpart="${i.code}" aria-label="Part needed" class="grow" ${locked ? 'disabled' : ''}>${parts.map(p => html`<option value="${p.value}" ${p.value === (i.itemId || '') ? 'selected' : ''}>${p.label}</option>`)}</select>
              ${i.itemId ? html`<input type="number" data-fqty="${i.code}" value="${i.qty || 1}" style="width:72px" aria-label="Quantity of the part" ${locked ? 'disabled' : ''}>` : ''}</div></div></div>
        ${open ? html`<div class="small" style="margin-top:6px;color:var(--red-ink)">Already open in ${open.no} (${open.status}): this will be added to it.</div>` : ''}</div>` : ''}</div>`; })}
    ${off.length ? html`<div class="ck na"><div class="t"><b>${off.length} item${off.length > 1 ? 's' : ''} not for this product (N/A)<small>${off.map(i => i.label).join(' · ')}</small></b></div></div>` : ''}
    <label class="check" style="margin:10px 0"><input type="checkbox" id="unsafe" ${st.unsafe ? 'checked' : ''} ${locked ? 'disabled' : ''}> Unsafe: take this product out of service</label>
    <p class="m-info">An adjustment you made on the spot is a Pass with a note. Fail means a repair is needed.</p>`);
  hydrateImages(page.body);
  bindMics(page.body);
  const repaint = () => mShutter(page, kind, id, shutterId);
  // Tapping an answer keeps the place on the page (the list is long).
  const keep = fn => { const top = page.body.scrollTop; fn(); repaint(); page.body.scrollTop = top; };
  $('#allPass', page.body)?.addEventListener('click', () => keep(() => allPass(coll, id, shutterId)));
  $$('[data-r]', page.body).forEach(b => b.addEventListener('click', () => { const [code, r] = b.dataset.r.split('|'); keep(() => setItem(coll, id, shutterId, code, { r })); }));
  $$('[data-fnote]', page.body).forEach(inp => inp.addEventListener('input', () => setItem(coll, id, shutterId, inp.dataset.fnote, { note: inp.value })));
  $$('[data-fpart]', page.body).forEach(s => s.addEventListener('change', () => keep(() => setItem(coll, id, shutterId, s.dataset.fpart, { itemId: s.value, qty: 1 }))));
  $$('[data-fqty]', page.body).forEach(s => s.addEventListener('input', () => setItem(coll, id, shutterId, s.dataset.fqty, { qty: Number(s.value) || 1 })));
  $$('[data-fphoto]', page.body).forEach(inp => inp.addEventListener('change', async e => { const [pid] = await savePhotos(e.target.files); const top = page.body.scrollTop; if (pid) setItem(coll, id, shutterId, inp.dataset.fphoto, { photoId: pid }); repaint(); page.body.scrollTop = top; }));
  $('#unsafe', page.body)?.addEventListener('change', e => setUnsafe(coll, id, shutterId, e.target.checked));
  // Asked for at sign-off: the items of this product still to answer, and failed items with no photo or note.
  const jump = takeJump();
  if (checking(id) && !locked) {
    let focused = false;
    const at = (el, text, code) => { const f = !focused && jump?.code === code; if (showAt(el, text, f)) focused = focused || f; };
    on.filter(i => !i.r).forEach(i => at($(`.ck[data-code="${i.code}"] .pf button`, page.body), 'Choose Pass, Fail or N/A', i.code));
    on.filter(i => i.r === 'F').forEach(i => {
      if (!i.photoId) at($(`[data-fphoto="${i.code}"]`, page.body)?.closest('label'), 'Take a photo', i.code);
      if (!(i.note || '').trim()) at($(`[data-fnote="${i.code}"]`, page.body), 'Say what is wrong', i.code);
    });
  }
  const list = d.shutters;
  const next = list[list.findIndex(s => s.shutterId === shutterId) + 1];
  const foot = page.setFoot(html`<a class="btn" href="#/m/${kind}/${id}/list">← All products</a>${next ? html`<a class="btn primary" href="#/m/${kind}/${id}/sh/${next.shutterId}">Next: ${next.tag} →</a>` : html`<a class="btn primary" href="#/m/${kind}/${id}/after">Next: After photos</a>`}`);
  foot.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { $$('[data-fnote]', page.body).forEach(inp => setItem(coll, id, shutterId, inp.dataset.fnote, { note: inp.value })); }));
}

const RENDER = {
  start: (kind, d, locked) => html`<div><label class="check" style="font-weight:600"><input type="checkbox" id="safe" ${d.safeIsolation ? 'checked' : ''} ${locked ? 'disabled' : ''}> Safe isolation done (power off and locked) before work</label></div>
    <p class="m-info" style="margin-top:10px">Take photos of the products before you start.</p>${photosBlock(d, 'photosBefore', 'Before photos')}`,
  list: (kind, d) => (!d.shutters.length ? html`<div class="m-card">No products to check. Ask the office to add them to the site's customer products.</div>` : html`${d.shutters.map(sh => { const st = shutterState(d, sh); return html`<a class="shl m-list-link" href="#/m/${kind}/${d.id}/sh/${sh.shutterId}">
      <div class="r"><b>${sh.tag}</b>&nbsp;${sh.location}<span class="grow"></span>${st.fails ? pill(`${st.fails} fail`, 'red') : st.answered === st.total ? pill('All pass', 'green') : pill(st.answered ? `${st.answered} of ${st.total}` : 'Not started')}</div>
      <div class="muted small">${typeLine(sh)} · ${st.total} items${st.off ? ` (${st.off} N/A)` : ''}</div><div class="minibar"><i style="width:${st.total ? (st.answered / st.total) * 100 : 0}%;${st.answered === st.total && !st.fails ? 'background:var(--green)' : ''}"></i></div></a>`; })}`),
  after: (kind, d) => photosBlock(d, 'photosAfter', 'After photos'),
  signoff: (kind, d, locked, issues) => {
    const coll = COLL[kind];
    const s = signOf(coll, d);
    const fails = failuresOf(d);
    const names = (who, p) => html`<div class="grid g2"><div class="field"><label for="${who}_name">Name</label><input type="text" id="${who}_name" name="${who}_name" value="${p.name}" ${locked ? 'disabled' : ''}></div>
      <div class="field"><label for="${who}_designation">Designation</label><input type="text" id="${who}_designation" name="${who}_designation" value="${p.designation}" ${locked ? 'disabled' : ''}></div></div>`;
    return html`${problemsBox(issues, 'Not ready to finish. Tap a line to put it right:')}
      <div class="wd-sec">INSPECTION CHECK LIST · ${kind === 'visit' ? d.reportNo : d.no}</div>
      <div class="wd-kv"><span class="k">Customer</span><span>${d.customer}</span><span class="k">Site</span><span>${d.site}</span><span class="k">Result</span><span><b>${d.shutters.length} products</b> · ${fails.length ? `${fails.length} failed item(s)` : 'all pass'}</span></div>
      ${fails.length ? html`<div class="wd-sec">FAILED ITEMS</div>${fails.map(f => { const o = openFault(d, f.shutterId, f.code); return html`<div class="wl small"><b>${f.tag} ${f.label}</b> · ${f.note || html`<span style="color:var(--red-ink)">note missing</span>`} · ${o ? html`added to <b>${o.no}</b>` : html`<b>new repair enquiry</b>`}</div>`; })}` : ''}
      <div class="wd-sec">CUSTOMER FEEDBACK</div><p class="m-info">Hand the phone to the customer. 5 is excellent, 1 is very poor.</p>
      ${RATINGS.map(([k, label]) => html`<div class="rate" data-rate-row="${k}" role="group" aria-label="${label}"><span>${label}</span>${[5, 4, 3, 2, 1].map(n => html`<button type="button" class="dot ${s.ratings[k] === n ? 'on' : ''}" data-rate="${k}|${n}" aria-label="${label}: ${n}" aria-pressed="${s.ratings[k] === n ? 'true' : 'false'}" ${locked ? 'disabled' : ''}>${n}</button>`)}</div>`)}
      <div class="wd-sec">SIGN-OFF</div>
      <div class="m-section" style="margin-top:8px">Checked by · company representative</div>
      <div class="m-card stack">${names('t', s.tech)}${signBox('tech', s.tech.signatureId, 'Signature', locked)}</div>
      <div class="m-section">Acknowledged by · customer</div>
      <div class="m-card stack"><button type="button" class="btn block" id="previewDoc">${icon('eye', 18)} Preview the service report for the customer</button>
        ${names('c', s.cust)}${signBox('cust', s.cust.signatureId, 'Customer signature', locked)}</div>
      <div class="m-section">Company stamp</div>
      ${s.cust.stampId ? html`<img class="sig-img" data-media="${s.cust.stampId}" alt="Company stamp" style="max-height:80px">` : locked ? html`<p class="m-info">No stamp photo.</p>` : html`<label class="add-dashed">${icon('plus', 18)} Photo of the company stamp<input type="file" accept="image/*" capture="environment" hidden id="stampIn" aria-label="Photo of the company stamp"></label>`}`;
  },
  pay: (kind, d) => {
    const inv = invoiceForJob(d.id);
    if (!inv || inv.status !== 'Posted') return html`<div class="m-card">The invoice is not posted yet. Ask the office.</div>`;
    const bal = balanceOf(inv);
    return html`<div class="m-card"><div class="row"><b>${inv.no}</b><span class="grow"></span><span class="pill ${bal > 0 ? 'amber' : 'green'}">${bal > 0 ? 'Due now' : 'Paid'}</span></div>
      <div style="font-size:var(--fs-xl);font-weight:600;margin-top:4px">${auth.company().currency} ${m2(bal > 0 ? bal : inv.total)}</div></div>
      ${paymentsFor(inv.id).map(p => html`<div class="m-card small">✓ ${p.no} · ${vsLabel('PAYMENT_METHOD', p.method)} · ${m2(p.amount)}</div>`)}
      ${bal > 0 && auth.can('payment', 'create', 'mobile') ? html`<div class="m-fields" style="margin-top:6px"><div class="field"><div class="field-label">Method</div>${chipGroup('method', vsOptions('PAYMENT_METHOD'), vsOptions('PAYMENT_METHOD')[0]?.value)}</div>
        <div class="field"><label for="payAmount">Amount</label><input type="number" step="0.01" id="payAmount" name="amount" value="${bal.toFixed(2)}"></div><div class="field"><label for="payRef">Reference</label><input type="text" id="payRef" name="reference"></div></div>
        <button type="button" class="btn primary block" id="recPay" style="margin-top:8px">Record payment</button>` : ''}`;
  },
  out: (kind, d) => (d.steps?.checkOutAt ? html`<div class="okay"><b>✓ Checked out at ${fmtTime(d.steps.checkOutAt)}</b><br>${kind === 'visit' ? 'Visit done. The office files the report.' : 'Job done. Thank you.'}</div>`
    : signOf(COLL[kind], d)?.signedAt ? html`<div class="okay"><b>✓ You may leave</b><br>The check list is signed. Check out to set Time Out.</div>`
      : html`<div class="m-card"><p>The customer has not signed the check list yet.</p><a class="btn block" href="#/m/${kind}/${d.id}/signoff">Go to the sign-off</a></div>`),
};

export function mServiceStep(page, kind, id, key) {
  const coll = COLL[kind];
  const d = store.get(coll, id);
  if (!d || !mine(kind, d)) { page.setTitle('Visit', 'm/jobs'); page.body.innerHTML = '<div class="empty">Not found.</div>'; return; }
  if (!d.steps?.checkInAt) { go(`m/${kind}/${id}`); return; }
  const steps = stepsFor(kind, d);
  const idx = Math.max(0, steps.findIndex(([k]) => k === key));
  const [step, label] = steps[idx];
  page.setTitle(titleOf(d), `m/${kind}/${id}`, `${docNo(kind, d)} · ${label}`);
  const signed = !!signOf(coll, d)?.signedAt;
  const locked = !canWork(kind, d) || (signed && ['start', 'signoff'].includes(step));
  const issues = checking(id) && !signed ? signoffIssues(coll, d).map(i => ({ ...i, tag: i.step === 'start' ? 'Safety' : i.step === 'list' ? 'Check list' : '' })) : [];
  if (checking(id) && (signed || !issues.length)) setChecking(id, false);
  const pads = {};
  page.body.innerHTML = String(html`${bar(kind, d, idx)}<form id="f" onsubmit="return false">${RENDER[step](kind, d, locked, issues)}</form>${locked && signed && step === 'signoff' ? html`<div class="note small" style="margin-top:8px">Signed by the customer; the check list is locked.</div>` : ''}`);
  const body = $('#f', page.body);
  hydrateImages(page.body);
  bindMics(body);
  const repaint = () => mServiceStep(page, kind, id, step);
  if (canWork(kind, d)) bindPhotos(body, coll, id, repaint);
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
    ['tech', 'cust'].forEach(who => { const c = $(`#sig_${who}`, body); if (c) { pads[who] = signaturePad(c); c.addEventListener('pointerdown', () => c.dispatchEvent(new Event('input', { bubbles: true }))); } });
    body.addEventListener('input', () => saveSvc(coll, id, { [sk]: readSign() }));
    $$('[data-rate]', body).forEach(b => b.addEventListener('click', async () => { await savePads(); const [k, n] = b.dataset.rate.split('|'); const s = readSign(); s.ratings[k] = Number(n); saveSvc(coll, id, { [sk]: s }); const top = page.body.scrollTop; repaint(); page.body.scrollTop = top; }));
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
    if (r.problems.length) { showAt($('[name="amount"]', body), r.problems[0]); return; }
    toast(`${r.payment.no} recorded · the office sees it now`); repaint();
  });

  // What is missing in this step, shown at its field; the one tapped in the list gets the cursor.
  const jump = takeJump();
  const marks = {
    safe: () => [[$('#safe', body)?.closest('label'), 'Tick this before the check list']],
    ratings: () => $$('[data-rate-row]', body).filter(row => !row.querySelector('.dot.on')).map(row => [row.querySelector('.dot'), 'Tap a rating from 5 to 1']),
    techSign: () => [[$('#sig_tech', body), 'Sign here']],
    custSign: () => [[$('#sig_cust', body), 'The customer signs here']],
  };
  let focused = false;
  if (!locked) issues.filter(i => i.step === step).forEach(i => (marks[i.key]?.() || []).forEach(([el, text]) => { const f = !focused && jump?.key === i.key; if (showAt(el, text, f)) focused = focused || f; }));
  $$('[data-prob]', page.body).forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    const p = issues[+a.dataset.prob];
    await savePads();
    setJump({ key: p.key, code: p.code || '' });
    if (p.shutterId) go(`m/${kind}/${id}/sh/${p.shutterId}`);
    else if (p.step === step) repaint();
    else go(p.step ? `m/${kind}/${id}/${p.step}` : `m/${kind}/${id}`);
  }));
  $$('[data-jump]', page.body).forEach(a => a.addEventListener('click', async e => { e.preventDefault(); await savePads(); go(a.getAttribute('href')); }));

  const prev = idx > 0 ? `m/${kind}/${id}/${steps[idx - 1][0]}` : `m/${kind}/${id}`;
  const nextRoute = idx < steps.length - 1 ? `m/${kind}/${id}/${steps[idx + 1][0]}` : `m/${kind}/${id}`;
  const cur = store.get(coll, id);
  const main = !canWork(kind, cur) ? '' : step === 'list' && cur.shutters.length ? html`<a class="btn primary" href="#/m/${kind}/${id}/sh/${(cur.shutters.find(sh => { const st = shutterState(cur, sh); return st.answered < st.total; }) || cur.shutters[0]).shutterId}">${stepDone(kind, cur, 'list') ? 'Review a product' : 'Check the next product'}</a><button class="btn" id="next">Next</button>`
    : step === 'signoff' && !signed ? html`<button class="btn primary" id="finish">Finish: customer signed</button>`
      : step === 'out' ? (cur.steps?.checkOutAt ? html`<a class="btn primary" href="#/m/jobs">Back to My jobs</a>` : signed ? html`<button class="btn primary" id="checkout">Check out · Time Out now</button>` : '')
        : html`<button class="btn primary" id="next">${step === 'after' && !(cur.photosAfter || []).length ? 'Next without photos' : `Next: ${steps[idx + 1]?.[1]}`}</button>`;
  const foot = page.setFoot(html`<button class="btn" id="back">← Back</button>${main}`);
  $('#back', foot).onclick = async () => { await savePads(); go(prev); };
  $('#next', foot)?.addEventListener('click', async e => {
    if (e.currentTarget.dataset.held) return;
    await savePads();
    if (step === 'start' && !store.get(coll, id).safeIsolation) { showAt($('#safe', body)?.closest('label'), 'Tick this before the check list'); return; }
    go(nextRoute);
  });
  $('#finish', foot)?.addEventListener('click', async () => {
    await savePads();
    const r = finishService(coll, id);
    if (r.problems?.length) { setChecking(id, true); repaint(); page.body.scrollTop = 0; return; }
    setChecking(id, false);
    const made = r.repair?.created ? `Repair enquiry ${r.repair.created.no} created` : r.repair?.addedTo?.length ? 'Failure added to the open repair enquiry' : 'All pass';
    toast(`Check list signed · ${made}`);
    go(nextRoute);
  });
  $('#checkout', foot)?.addEventListener('click', e => { if (e.currentTarget.dataset.held) return; leaveSite(coll, id); holdNext(); toast(`Checked out · Time Out ${fmtTime(new Date().toISOString())}`); repaint(); });
}
