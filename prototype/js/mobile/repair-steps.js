// Phone: the steps of a repair job after check-in: before photos, works done (Work Done form sections 1 and 2),
// customer feedback (section 3), sign-off with both signatures and the company stamp photo (section 4), and payment
// (only when the term is immediate: the step is left out when there is nothing to collect). Leaving the site is in
// repair-leave.js. A step counts as done only when it holds what it needs.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $$, toast, fmtTime, chipGroup, MIC, icon } from '../core/ui.js';
import { vsLabel, vsOptions } from '../core/lookups.js';
import { removeBlob } from '../core/media.js';
import { savePhotos } from '../core/capture.js';
import { saveJob, workDoneIssues } from '../core/jobs.js';
import { invoiceForJob, balanceOf, paymentsFor } from '../core/billing.js';
import { RATINGS } from '../web/print-docs.js';
import { problemsBox } from './parts.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ALL = [['before', 'Before photos', 'Before'], ['works', 'Works done', 'Works'], ['feedback', 'Feedback', 'Feedback'], ['signoff', 'Sign-off', 'Sign-off'], ['payment', 'Payment', 'Payment'], ['leave', 'Leave site', 'Leave']];
// The steps of this job: "Payment" only when money is collected on the spot.
export const stepsOf = j => ALL.filter(([k]) => k !== 'payment' || j.paymentTerm === 'IMMEDIATE');
export const noPaymentLine = j => (j.paymentTerm === 'IMMEDIATE' ? '' : `Nothing to collect today: the payment term is ${vsLabel('PAYMENT_TERMS', j.paymentTerm)}, and the office sends the invoice.`);

// After "Finish: customer signed" found something missing, the steps that hold it show red until it is put right.
const checkKey = id => `rsmJobCheck.${id}`;
export const checking = id => sessionStorage.getItem(checkKey(id)) === '1';
export const setChecking = (id, on) => (on ? sessionStorage.setItem(checkKey(id), '1') : sessionStorage.removeItem(checkKey(id)));

export function stepDone(j, key) {
  const w = j.workDone, inv = invoiceForJob(j.id);
  return {
    before: (j.photosBefore || []).length > 0, works: !!w && w.rows.every(r => r.status) && (!!w.worksAt || !!w.signedAt), feedback: !!w && Object.values(w.ratings).every(Boolean),
    signoff: !!w?.signedAt, payment: !!w?.signedAt && !!inv && inv.status === 'Posted' && balanceOf(inv) <= 0, leave: !!j.steps?.checkOutAt,
  }[key];
}
// 'done', 'skip' (before photos passed with none taken), 'bad' (asked for at sign-off and still missing) or ''.
export function stepState(j, key, passed = false) {
  if (stepDone(j, key)) return 'done';
  const w = j.workDone;
  if (key === 'before') return passed || w?.worksAt || w?.signedAt || w?.rows.some(r => r.status) ? 'skip' : '';
  if (checking(j.id) && !w?.signedAt && workDoneIssues(j).some(i => i.step === key)) return 'bad';
  return '';
}

const sec = (n, t) => html`<div class="wd-sec">${n} &nbsp; ${t}</div>`;
export function photosBlock(j, field, label) {
  return html`<div class="m-section" id="${field}">${label} (${(j[field] || []).length})</div><div class="photos">${(j[field] || []).map(p => html`<div class="photo"><img data-media="${p}" alt="${label}"><button type="button" class="del" data-del="${field}|${p}" aria-label="Remove photo">×</button></div>`)}</div>
    <label class="add-dashed" style="margin-top:8px">${icon('plus', 18)} Take or add photos<input type="file" accept="image/*" capture="environment" multiple hidden data-add="${field}" aria-label="${label}"></label>`;
}
export function bindPhotos(body, j, repaint) {
  $$('[data-add]', body).forEach(inp => inp.addEventListener('change', async e => {
    const ids = await savePhotos(e.target.files);
    const f = inp.dataset.add;
    if (ids.length) { saveJob(j.id, { [f]: [...(store.get('jobs', j.id)[f] || []), ...ids] }); toast(`${ids.length} photo(s) added`); }
    repaint();
  }));
  $$('[data-del]', body).forEach(b => b.addEventListener('click', () => {
    const [f, id] = b.dataset.del.split('|');
    saveJob(j.id, { [f]: store.get('jobs', j.id)[f].filter(p => p !== id) });
    removeBlob(id);
    repaint();
  }));
}

const nameFields = (who, p, lock) => html`<div class="grid g2"><div class="field"><label for="${who}_name">Name</label><input type="text" id="${who}_name" name="${who}_name" value="${p.name}" ${lock ? 'disabled' : ''}></div>
  <div class="field"><label for="${who}_designation">Designation</label><input type="text" id="${who}_designation" name="${who}_designation" value="${p.designation}" ${lock ? 'disabled' : ''}></div></div>`;
// A saved signature, or the pad to sign on. who: 'tech' or 'cust'.
export const signBox = (who, id, label, lock = false) => html`<div class="field sig-wrap"><div class="field-label">${label}</div>
  ${id ? html`<img class="sig-img" data-media="${id}" alt="${label}">${lock ? '' : html`<button type="button" class="btn link" data-resign="${who}">Sign again</button>`}`
    : html`<canvas class="sig-pad" id="sig_${who}" style="height:120px" role="img" aria-label="${label}: sign here"></canvas><div class="hint">Sign with a finger.</div>`}</div>`;

export const RENDER = {
  before: j => html`<p class="m-info">Take photos of each product before you start.</p>${photosBlock(j, 'photosBefore', 'Before photos')}`,
  works: j => {
    const w = j.workDone, s1 = w.s1;
    return html`${sec(1, 'PROJECT & WORK DETAILS')}
      <div class="wd-kv"><span class="k">Project</span><span>${s1.project}</span><span class="k">Reference No.</span><span>${s1.refNo}</span><span class="k">Customer</span><span>${s1.customer}</span>
        <span class="k">Date</span><span>${s1.date.split('-').reverse().join(' / ')}</span><span class="k">Time In / Out</span><span>${s1.timeIn || '—'} / ${s1.timeOut || html`<span class="muted">at check-out</span>`}</span><span class="k">Subject</span><span>${s1.subject}</span></div>
      ${sec(2, 'DESCRIPTION OF WORKS DONE')}
      <p class="m-info">Choose how each line went.</p>
      ${w.rows.map((r, i) => html`<div class="wl" data-row="${i}"><div><b>${i + 1}.</b> ${r.description}</div>
        <div class="field" style="margin-top:8px" role="group" aria-label="Line ${i + 1}: status">${chipGroup(`st_${i}`, vsOptions('WORK_DONE'), r.status)}</div>
        <div class="with-mic" style="margin-top:8px"><input type="text" name="rm_${i}" value="${r.remark}" placeholder="Remark (if any)" aria-label="Remark for line ${i + 1}"><button type="button" class="mic" data-mic="rm_${i}" aria-label="Voice input">${MIC}</button></div></div>`)}
      ${w.partsUsed.length ? html`<div class="m-section">Parts used <span class="muted" style="text-transform:none;font-weight:400">(untick or change if different)</span></div>
        ${w.partsUsed.map((p, i) => html`<div class="check-with" style="margin-bottom:8px"><label class="check"><input type="checkbox" name="pu_${i}" ${p.used ? 'checked' : ''}> ${p.name}</label>
          <div class="row"><input type="number" name="pq_${i}" value="${p.qty}" style="width:76px" aria-label="Quantity of ${p.name}"><span class="small">${p.unit}</span></div></div>`)}` : ''}
      ${photosBlock(j, 'photosAfter', 'After photos')}`;
  },
  feedback: j => {
    const w = j.workDone;
    return html`${sec(3, 'CUSTOMER FEEDBACK RATING')}<p class="m-info">Hand the phone to the customer. 5 is excellent, 1 is very poor.</p>
      ${RATINGS.map(([k, label]) => html`<div class="rate" data-rate-row="${k}" role="group" aria-label="${label}"><span>${label}</span>${[5, 4, 3, 2, 1].map(n => html`<button type="button" class="dot ${w.ratings[k] === n ? 'on' : ''}" data-rate="${k}|${n}" aria-label="${label}: ${n}" aria-pressed="${w.ratings[k] === n ? 'true' : 'false'}">${n}</button>`)}</div>`)}
      <div class="field" style="margin-top:10px"><label for="comments">Customer comments / recommendations</label>
        <div class="with-mic"><textarea id="comments" name="comments" style="min-height:72px">${w.comments}</textarea><button type="button" class="mic" data-mic="comments" aria-label="Voice input">${MIC}</button></div></div>`;
  },
  signoff: (j, locked, issues) => {
    const w = j.workDone;
    return html`${problemsBox(issues.map(i => ({ text: i.text, tag: i.tag })), 'Not ready to finish. Tap a line to put it right:')}
      ${sec(4, 'SIGN-OFF & VERIFICATION')}
      <div class="m-section" style="margin-top:8px">Checked by · company representative</div>
      <div class="m-card stack">${nameFields('t', w.tech, locked)}${signBox('tech', w.tech.signatureId, 'Signature', locked)}</div>
      <div class="m-section">Acknowledged and accepted by · customer</div>
      <div class="m-card stack">
        <button type="button" class="btn block" id="previewDoc">${icon('eye', 18)} Preview the Work Done form for the customer</button>
        ${nameFields('c', w.cust, locked)}${signBox('cust', w.cust.signatureId, 'Customer signature', locked)}</div>
      ${noPaymentLine(j) ? html`<p class="m-info">${noPaymentLine(j)}</p>` : ''}
      <div class="m-section">Company stamp</div>
      ${w.cust.stampId ? html`<div class="row"><img class="sig-img" data-media="${w.cust.stampId}" alt="Company stamp" style="max-height:80px">${locked ? '' : html`<button type="button" class="btn link" data-stampdel="1">Retake</button>`}</div>`
        : locked ? html`<p class="m-info">No stamp photo.</p>` : html`<label class="add-dashed">${icon('plus', 18)} Photo of the company stamp<input type="file" accept="image/*" capture="environment" hidden id="stampIn" aria-label="Photo of the company stamp"></label>`}`;
  },
  payment: j => {
    const inv = invoiceForJob(j.id);
    if (!inv || inv.status !== 'Posted') return html`<div class="m-card">The invoice is not posted yet. Ask the office.</div>`;
    const bal = balanceOf(inv);
    const pays = paymentsFor(inv.id);
    return html`<div class="m-card"><div class="row"><b>${inv.no}</b><span class="grow"></span><span class="pill ${bal > 0 ? 'amber' : 'green'}">${bal > 0 ? 'Due now' : 'Paid'}</span></div>
      <div class="muted small">Payment on the spot · raised when the job was scheduled</div><div style="font-size:var(--fs-xl);font-weight:600;margin-top:4px">${auth.company().currency} ${m2(bal > 0 ? bal : inv.total)}</div></div>
      ${pays.map(p => html`<div class="m-card small">✓ ${p.no} · ${vsLabel('PAYMENT_METHOD', p.method)} · ${m2(p.amount)}${p.reference ? ` · ${p.reference}` : ''} · ${fmtTime(p.createdAt)}</div>`)}
      ${bal > 0 && auth.can('payment', 'create', 'mobile') ? html`<div class="m-fields" style="margin-top:6px">
        <div class="field"><div class="field-label">Method</div>${chipGroup('method', vsOptions('PAYMENT_METHOD'), 'PAYNOW')}</div>
        <div class="field"><label for="payAmount">Amount</label><input type="number" step="0.01" id="payAmount" name="amount" value="${bal.toFixed(2)}"></div>
        <div class="field"><label for="payRef">Reference</label><input type="text" id="payRef" name="reference" placeholder="Cheque no. / transfer ref."></div>
        <div class="field"><div class="field-label">Proof photo</div><label class="add-dashed">${icon('plus', 18)} <span id="proofName">Take or add a photo</span><input type="file" accept="image/*" capture="environment" id="proofIn" hidden aria-label="Proof photo"></label></div></div>
        <button type="button" class="btn primary block" id="recPay" style="margin-top:8px">Record payment</button>` : ''}`;
  },
};
