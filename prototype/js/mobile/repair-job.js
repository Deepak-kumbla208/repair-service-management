// Phone: a repair job for the technician (flow step 8). The job page has "On my way" and "Check in"; then six
// steps: before photos, works done (Work Done form sections 1–2), customer feedback (section 3), sign-off with both
// signatures and the company stamp photo (section 4), payment (immediate term), and the office's OK to leave.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, toast, openModal, fmtDate, fmtTime, chipGroup, readForm } from '../core/ui.js';
import { zoneLabel, vsLabel, vsOptions } from '../core/lookups.js';
import { hydrateImages, removeBlob } from '../core/media.js';
import { savePhotos, signaturePad, bindMics } from '../core/capture.js';
import { seesJob, onMyWay, checkIn, workDoneFor, saveJob, completeWorkDone, requestLeave, checkOut } from '../core/jobs.js';
import { invoiceForJob, balanceOf, recordPayment, paymentsFor } from '../core/billing.js';
import { RATINGS } from '../web/print-docs.js';

export const STEPS = [['before', 'Before photos'], ['works', 'Works done'], ['feedback', 'Feedback'], ['signoff', 'Sign-off'], ['payment', 'Payment'], ['leave', 'Leave site']];
const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DONE_ST = ['Work done', 'Completed & documented', 'Closed'];

function stepDone(j, key) {
  const w = j.workDone, inv = invoiceForJob(j.id);
  return {
    before: (j.photosBefore || []).length > 0 || !!w?.worksAt, works: !!w?.worksAt, feedback: !!w && Object.values(w.ratings).every(Boolean),
    signoff: !!w?.signedAt, payment: !!w?.signedAt && (j.paymentTerm !== 'IMMEDIATE' || (inv && inv.status === 'Posted' && balanceOf(inv) <= 0)), leave: !!j.steps?.checkOutAt,
  }[key];
}
const progress = (j, cur) => html`<div class="prog">${STEPS.map(([k, label]) => html`<a href="#/m/rjob/${j.id}/${k}" class="${k === cur ? 'n' : stepDone(j, k) ? 'd' : ''}" style="text-decoration:none">${stepDone(j, k) && k !== cur ? '✓ ' : ''}${label}</a>`)}</div>`;
const sec = (n, t) => html`<div class="wd-sec">${n} &nbsp; ${t}</div>`;

export function repairCard(j) {
  const done = DONE_ST.includes(j.status) && j.steps?.checkOutAt;
  const action = j.status === 'Scheduled' ? 'On my way' : j.status === 'On the way' ? 'Check in' : done ? 'View' : 'Continue';
  return html`<div class="job-card" style="${done ? 'opacity:.65;box-shadow:none' : ''}">
    <div class="row"><span class="pill blue">Repair job</span><span class="grow"></span><b>${j.start ? `${fmtDate(j.start)} ${fmtTime(j.start)}` : 'Not scheduled'}</b></div>
    <div class="strong" style="margin-top:6px">${j.customer}</div>
    <div class="muted">${j.site} · Zone ${zoneLabel(j.zoneId)}</div>
    <div class="muted">${j.no} · ${j.tags.join(', ')} · ${j.contact}</div>
    <div class="row" style="margin-top:4px"><span class="pill">${j.status}</span></div>
    <div class="actions">${j.phone ? html`<a class="btn" href="tel:${j.phone.replace(/\s/g, '')}">☎ Call</a>` : ''}<a class="btn primary" href="#/m/rjob/${j.id}" style="flex:2">${action}</a></div>
  </div>`;
}

export function mRepairJob(page, id) {
  const j = store.get('jobs', id);
  page.setTitle(j ? j.no : 'Job', 'm/jobs');
  if (!j || !seesJob(j)) { page.body.innerHTML = '<div class="empty">Job not found.</div>'; return; }
  const inv = invoiceForJob(j.id);
  const canWork = auth.can('job', 'edit', 'mobile') && j.technicianId === auth.user()?.employeeId;
  page.body.innerHTML = String(html`
    <div class="row"><span class="pill blue">Repair job</span><span class="pill">${j.status}</span><span class="grow"></span><b>${j.start ? fmtTime(j.start) : ''}</b></div>
    <h2 style="margin:8px 0 2px">${j.customer}</h2><div class="muted">${j.no} · ${j.start ? fmtDate(j.start) : ''}</div>
    <div class="m-card" style="margin-top:10px"><div class="k muted small">Address</div>${j.address || j.site}<br><span class="pill blue" style="margin-top:4px">Zone ${zoneLabel(j.zoneId)}</span></div>
    <div class="m-card"><div class="k muted small">Contact</div>${j.contact}<br>${j.phone ? html`<a href="tel:${j.phone.replace(/\s/g, '')}">☎ ${j.phone}</a>` : ''}</div>
    <div class="m-section">Work to do</div>${j.lines.map((l, i) => html`<div class="m-card small"><b>${i + 1}.</b> ${l.description}</div>`)}
    ${j.parts.length ? html`<div class="m-section">Parts to bring</div>${j.parts.map(p => html`<div class="m-card small">${p.qty} ${p.unit} × ${p.name}</div>`)}` : ''}
    <div class="m-section">Payment</div><div class="m-card small">${vsLabel('PAYMENT_TERMS', j.paymentTerm)}${inv?.status === 'Posted' ? html` · ${inv.no} · ${j.paymentTerm === 'IMMEDIATE' ? html`<b>collect ${auth.company().currency} ${m2(balanceOf(inv))}</b>` : 'invoice from the office'}` : ' · invoice from the office'}</div>
    ${j.steps?.checkInAt ? html`<div class="m-section">Steps</div>${progress(j, '')}` : ''}`);
  if (!canWork) return;
  const foot = j.status === 'Scheduled' ? html`<button class="btn primary" id="go">On my way</button>`
    : j.status === 'On the way' ? html`<button class="btn primary" id="go">Check in · Time In now</button>`
      : html`<button class="btn primary" id="go">${j.steps?.checkOutAt ? 'View the steps' : 'Continue'}</button>`;
  page.setFoot(foot).querySelector('#go').onclick = () => {
    if (j.status === 'Scheduled') { onMyWay(j.id); toast('The office sees you are on the way'); return mRepairJob(page, id); }
    if (j.status === 'On the way') { checkIn(j.id); toast('Checked in'); return go(`m/rjob/${j.id}/before`); }
    const next = STEPS.find(([k]) => !stepDone(store.get('jobs', j.id), k))?.[0] || 'leave';
    go(`m/rjob/${j.id}/${next}`);
  };
}

// ---------- The six steps ----------
function photosBlock(j, field, label) {
  return html`<div class="m-section">${label}</div><div class="photos">${(j[field] || []).map(p => html`<div class="photo"><img data-media="${p}" alt="${label}"><button type="button" class="del" data-del="${field}|${p}" aria-label="Remove photo">×</button></div>`)}</div>
    <label class="add-dashed" style="display:block;margin-top:8px">📷 Take or add photos<input type="file" accept="image/*" capture="environment" multiple hidden data-add="${field}"></label>`;
}

function bindPhotos(body, j, repaint) {
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

const RENDER = {
  before: j => html`<p class="small muted" style="margin:0 0 6px">Take photos of each shutter before you start.</p>${photosBlock(j, 'photosBefore', 'Before photos')}`,
  works: j => {
    const w = j.workDone, s1 = w.s1;
    return html`${sec(1, 'PROJECT & WORK DETAILS')}
      <div class="wd-kv"><span class="k">Project</span><span>${s1.project}</span><span class="k">Reference No.</span><span>${s1.refNo}</span><span class="k">Customer</span><span>${s1.customer}</span>
        <span class="k">Date</span><span>${s1.date.split('-').reverse().join(' / ')}</span><span class="k">Time In / Out</span><span>${s1.timeIn || '—'} / ${s1.timeOut || html`<span class="muted">at check-out</span>`}</span><span class="k">Subject</span><span>${s1.subject}</span></div>
      ${sec(2, 'DESCRIPTION OF WORKS DONE')}
      ${w.rows.map((r, i) => html`<div class="wl"><div><b>${i + 1}.</b> ${r.description}</div><div style="margin-top:5px">${chipGroup(`st_${i}`, vsOptions('WORK_DONE'), r.status)}</div>
        <div class="with-mic" style="margin-top:5px"><input type="text" name="rm_${i}" value="${r.remark}" placeholder="Remark (optional)"><button type="button" class="mic" data-mic="rm_${i}">🎤</button></div></div>`)}
      ${w.partsUsed.length ? html`<div class="m-section">Parts used <span class="muted small">(from the estimate; change if different)</span></div>
        ${w.partsUsed.map((p, i) => html`<div class="row" style="margin:3px 0"><label class="check grow"><input type="checkbox" name="pu_${i}" ${p.used ? 'checked' : ''}> ${p.name}</label><input type="number" name="pq_${i}" value="${p.qty}" style="width:64px"> <span class="small">${p.unit}</span></div>`)}` : ''}
      ${photosBlock(j, 'photosAfter', 'After photos')}`;
  },
  feedback: j => {
    const w = j.workDone;
    return html`${sec(3, 'CUSTOMER FEEDBACK RATING')}<div class="small muted">Hand the phone to the customer. 5 Excellent · 4 Good · 3 Satisfactory · 2 Poor · 1 Very poor</div>
      ${RATINGS.map(([k, label]) => html`<div class="rate"><span>${label}</span>${[5, 4, 3, 2, 1].map(n => html`<button type="button" class="dot ${w.ratings[k] === n ? 'on' : ''}" data-rate="${k}|${n}" aria-label="${label}: ${n}">${n}</button>`)}</div>`)}
      <div class="with-mic" style="margin-top:8px"><textarea name="comments" placeholder="Customer comments / recommendations" style="min-height:52px">${w.comments}</textarea><button type="button" class="mic" data-mic="comments">🎤</button></div>`;
  },
  signoff: j => {
    const w = j.workDone;
    const pad = (who, id) => (id ? html`<img class="sig-img" data-media="${id}" alt="Signature"><button type="button" class="btn link small" data-resign="${who}">Sign again</button>`
      : html`<canvas class="sig-pad" id="sig_${who}" style="height:110px"></canvas><div class="hint small muted">Sign with a finger or the mouse.</div>`);
    return html`${sec(4, 'SIGN-OFF & VERIFICATION')}
      <div class="small strong">Checked by · Company Representative</div>
      <div class="grid g2" style="margin:4px 0"><div class="field"><label>Name</label><input name="t_name" value="${w.tech.name}"></div><div class="field"><label>Designation</label><input name="t_designation" value="${w.tech.designation}"></div></div>
      ${pad('tech', w.tech.signatureId)}
      <div class="small strong" style="margin-top:12px">Acknowledged &amp; accepted by · Customer</div>
      <div class="grid g2" style="margin:4px 0"><div class="field"><label>Name</label><input name="c_name" value="${w.cust.name}"></div><div class="field"><label>Designation</label><input name="c_designation" value="${w.cust.designation}"></div></div>
      ${j.paymentTerm !== 'IMMEDIATE' ? html`<div class="note small" style="margin:4px 0">Payment due: ${vsLabel('PAYMENT_TERMS', j.paymentTerm)} from the invoice date.</div>` : ''}
      ${pad('cust', w.cust.signatureId)}
      <div class="m-section">Company stamp</div>
      ${w.cust.stampId ? html`<div class="row"><img class="sig-img" data-media="${w.cust.stampId}" alt="Company stamp" style="max-height:80px"><button type="button" class="btn link small" data-stampdel="1">Retake</button></div>`
        : html`<label class="add-dashed" style="display:block">📷 Photo of the company stamp<input type="file" accept="image/*" capture="environment" hidden id="stampIn"></label>`}`;
  },
  payment: j => {
    const inv = invoiceForJob(j.id);
    if (j.paymentTerm !== 'IMMEDIATE') return html`<div class="m-card">Payment term <b>${vsLabel('PAYMENT_TERMS', j.paymentTerm)}</b>. The office sends the invoice; nothing to collect today.</div>`;
    if (!inv || inv.status !== 'Posted') return html`<div class="m-card">The invoice is not posted yet. Ask the office.</div>`;
    const bal = balanceOf(inv);
    const pays = paymentsFor(inv.id);
    return html`<div class="m-card"><div class="row"><b>${inv.no}</b><span class="grow"></span><span class="pill ${bal > 0 ? 'amber' : 'green'}">${bal > 0 ? 'Due now' : 'Paid'}</span></div>
      <div class="muted small">Payment term Immediate · raised when the job was scheduled</div><div style="font-size:20px;font-weight:600;margin-top:4px">${auth.company().currency} ${m2(bal > 0 ? bal : inv.total)}</div></div>
      ${pays.map(p => html`<div class="m-card small">✓ ${p.no} · ${vsLabel('PAYMENT_METHOD', p.method)} · ${m2(p.amount)}${p.reference ? ` · ${p.reference}` : ''}</div>`)}
      ${bal > 0 && auth.can('payment', 'create', 'mobile') ? html`<div class="form-lines" style="margin-top:6px">
        <div class="field"><label>Method</label>${chipGroup('method', vsOptions('PAYMENT_METHOD'), 'PAYNOW')}</div>
        <div class="field"><label>Amount</label><input type="number" step="0.01" name="amount" value="${bal.toFixed(2)}"></div>
        <div class="field"><label>Reference</label><input type="text" name="reference" placeholder="Cheque no. / transfer ref."></div>
        <div class="field"><label>Proof photo</label><input type="file" accept="image/*" capture="environment" id="proofIn"></div></div>
        <button type="button" class="btn primary block" id="recPay" style="margin-top:8px">Record payment</button>` : ''}`;
  },
  leave: j => {
    const l = j.leaveSite;
    if (j.steps?.checkOutAt) return html`<div class="okay"><b>✓ Checked out at ${fmtTime(j.steps.checkOutAt)}</b><br><span class="small">Job done. Thank you.</span></div>`;
    if (l?.confirmedAt) return html`<div class="okay"><b>✓ Office confirmed at ${fmtTime(l.confirmedAt)}</b><br><span class="small">You can check out now</span></div>`;
    if (l?.requestedAt) return html`<div class="wait"><b>Waiting for the office OK…</b><br><span class="small">Request sent ${fmtTime(l.requestedAt)} to the Operations Executive</span></div><button type="button" class="btn block" id="refresh" style="margin-top:8px">Check again</button>`;
    return html`<div class="m-card small">Ask the office before you leave the site (flow step 8). The Operations Executive confirms on the web or the phone.</div>`;
  },
};

export function mRepairStep(page, id, key) {
  const j = store.get('jobs', id);
  if (!j || !seesJob(j)) { page.setTitle('Job', 'm/jobs'); page.body.innerHTML = '<div class="empty">Job not found.</div>'; return; }
  if (!j.workDone) saveJob(j.id, { workDone: workDoneFor(j) });
  const job = store.get('jobs', id);
  const idx = Math.max(0, STEPS.findIndex(([k]) => k === key));
  const [step, title] = STEPS[idx];
  page.setTitle(`${job.no} · ${title}`, `m/rjob/${job.id}`);
  const locked = !!job.workDone.signedAt && ['works', 'feedback', 'signoff'].includes(step);
  const pads = {};
  page.body.innerHTML = String(html`${progress(job, step)}<form id="f" onsubmit="return false">${RENDER[step](job)}</form>${locked ? html`<div class="note small" style="margin-top:8px">Signed by the customer; the form is locked.</div>` : ''}`);
  const body = $('#f', page.body);
  if (locked) $$('input, textarea, button.dot', body).forEach(x => { x.disabled = true; });
  hydrateImages(page.body);
  bindMics(body);
  const repaint = () => mRepairStep(page, id, step);
  bindPhotos(body, job, repaint);

  // Read the step's inputs into the Work Done form.
  const read = () => {
    const w = structuredClone(store.get('jobs', id).workDone);
    const d = readForm(body);
    if (step === 'works') {
      w.rows = w.rows.map((r, i) => ({ ...r, status: d[`st_${i}`] || r.status, remark: d[`rm_${i}`] ?? r.remark }));
      w.partsUsed = w.partsUsed.map((p, i) => ({ ...p, used: !!d[`pu_${i}`], qty: d[`pq_${i}`] ?? p.qty }));
    }
    if (step === 'feedback') w.comments = d.comments ?? w.comments;
    if (step === 'signoff') { w.tech = { ...w.tech, name: d.t_name ?? w.tech.name, designation: d.t_designation ?? w.tech.designation }; w.cust = { ...w.cust, name: d.c_name ?? w.cust.name, designation: d.c_designation ?? w.cust.designation }; }
    return w;
  };
  const save = () => { if (!locked && ['works', 'feedback', 'signoff'].includes(step)) saveJob(id, { workDone: read() }); };
  body.addEventListener('change', save);
  body.addEventListener('input', save);
  $$('[data-rate]', body).forEach(b => b.addEventListener('click', () => {
    const [k, n] = b.dataset.rate.split('|');
    const w = read(); w.ratings[k] = Number(n); saveJob(id, { workDone: w }); repaint();
  }));
  // Drawn signatures are saved before anything redraws the step, so they are never lost.
  const savePads = async () => {
    const w = read();
    for (const who of Object.keys(pads)) if (!pads[who].isEmpty()) w[who].signatureId = (await pads[who].save()).id;
    saveJob(id, { workDone: w });
  };
  if (step === 'signoff' && !locked) {
    ['tech', 'cust'].forEach(who => { const c = $(`#sig_${who}`, body); if (c) pads[who] = signaturePad(c); });
    $$('[data-resign]', body).forEach(b => b.addEventListener('click', async () => { await savePads(); const w = read(); removeBlob(w[b.dataset.resign].signatureId); w[b.dataset.resign].signatureId = null; saveJob(id, { workDone: w }); repaint(); }));
    $('#stampIn', body)?.addEventListener('change', async e => { await savePads(); const [sid] = await savePhotos(e.target.files); if (sid) { const w = read(); w.cust.stampId = sid; saveJob(id, { workDone: w }); } repaint(); });
    $('[data-stampdel]', body)?.addEventListener('click', async () => { await savePads(); const w = read(); removeBlob(w.cust.stampId); w.cust.stampId = null; saveJob(id, { workDone: w }); repaint(); });
  }
  $('#recPay', body)?.addEventListener('click', async () => {
    const d = readForm(body);
    const f = $('#proofIn', body)?.files?.[0];
    const proofId = f ? (await savePhotos([f]))[0] || null : null;
    const r = recordPayment({ invoiceId: invoiceForJob(id).id, amount: d.amount, method: d.method, reference: d.reference, proofId, via: 'phone' });
    if (r.problems.length) { toast(r.problems[0], 'bad'); return; }
    toast(`${r.payment.no} recorded · the office sees it now`);
    repaint();
  });
  $('#refresh', body)?.addEventListener('click', repaint);

  // Footer: back / next, or the step's own action.
  const prev = idx > 0 ? `m/rjob/${id}/${STEPS[idx - 1][0]}` : `m/rjob/${id}`;
  const nextRoute = idx < STEPS.length - 1 ? `m/rjob/${id}/${STEPS[idx + 1][0]}` : `m/rjob/${id}`;
  const l = job.leaveSite;
  const main = step === 'signoff' && !job.workDone.signedAt ? html`<button class="btn primary" id="next">Finish: customer signed</button>`
    : step === 'leave' ? (job.steps?.checkOutAt ? html`<a class="btn primary" href="#/m/jobs">Back to My jobs</a>` : l?.confirmedAt ? html`<button class="btn primary" id="out">Check out · Time Out now</button>`
      : l?.requestedAt ? '' : html`<button class="btn primary" id="ask">Ask the office to leave</button>`)
      : html`<button class="btn primary" id="next">Next: ${STEPS[idx + 1]?.[1]}</button>`;
  const foot = page.setFoot(html`<button class="btn" id="back">← Back</button>${main}`);
  $('#back', foot).onclick = async () => { await savePads(); go(prev); };
  $('#next', foot)?.addEventListener('click', async () => {
    await savePads();
    if (step === 'works' && !locked) saveJob(id, { workDone: { ...read(), worksAt: new Date().toISOString() } });
    if (step === 'feedback' && Object.values(store.get('jobs', id).workDone.ratings).some(v => !v)) { toast('The customer has not rated all 4 categories', 'bad'); return; }
    if (step === 'signoff' && !store.get('jobs', id).workDone.signedAt) {
      const problems = completeWorkDone(id);
      if (problems.length) { openModal({ title: 'Not ready to finish', body: html`<ul>${problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] }); return; }
      toast('Work Done form signed');
    }
    go(nextRoute);
  });
  $('#ask', foot)?.addEventListener('click', () => {
    const now = store.get('jobs', id);
    const problems = now.workDone?.signedAt ? [] : ['Finish the sign-off first (step "Sign-off": Finish, customer signed).'];
    if (problems.length) { toast(problems[0], 'bad'); return; }
    requestLeave(id); toast('Request sent to the office'); repaint();
  });
  $('#out', foot)?.addEventListener('click', () => { checkOut(id); toast('Checked out'); repaint(); });
}
