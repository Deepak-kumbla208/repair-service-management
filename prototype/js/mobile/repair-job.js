// Phone: a repair job for the technician. The job page has "On my way" and "Check in" (each with Undo, and the
// button rests a moment after a tap so a double tap cannot fire the next step); then the steps in repair-steps.js
// and repair-leave.js: before photos, works done, customer feedback, sign-off, payment (immediate term only), leave site.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, toast, confirmBox, fmtDate, fmtTime, readForm } from '../core/ui.js';
import { zoneLabel, vsLabel } from '../core/lookups.js';
import { isToday } from '../core/enquiries.js';
import { hydrateImages, removeBlob } from '../core/media.js';
import { savePhotos, signaturePad, bindMics } from '../core/capture.js';
import { seesJob, onMyWay, undoOnMyWay, checkIn, undoCheckIn, workDoneFor, workDoneIssues, saveJob, completeWorkDone } from '../core/jobs.js';
import { invoiceForJob, balanceOf, recordPayment } from '../core/billing.js';
import { workDoneSheet } from '../web/print-docs.js';
import { openDocSheet, holdNext, show, undoToast } from './shell.js';
import { markSeen, whenText, callBtn, directionsBtn, stepBar, showAt, setJump, takeJump } from './parts.js';
import { stepsOf, stepDone, stepState, checking, setChecking, bindPhotos, RENDER } from './repair-steps.js';
import { leaveBody, leaveFoot, bindLeave } from './repair-leave.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const titleOf = j => [j.customer, j.site].filter(Boolean).join(' · ');
const STEP_NAME = { works: 'Works done', feedback: 'Feedback', signoff: 'Sign-off' };

// The whole visit as a list on the job page: done steps green, the current one blue, a step passed with nothing in it dashed.
function jobSteps(j) {
  const s = j.steps || {};
  const list = [['On my way', 'The office sees you are travelling', s.onMyWayAt ? 'done' : ''], ['Check in', s.checkInAt ? `Time In ${fmtTime(s.checkInAt)}` : 'Sets Time In', s.checkInAt ? 'done' : ''],
    ...stepsOf(j).map(([k, label]) => [k === 'signoff' ? 'Customer signs' : label, k === 'signoff' ? 'After seeing the Work Done form' : k === 'leave' ? 'When the checks pass, or the office says OK'
      : k === 'before' && stepState(j, k) === 'skip' ? 'No photo taken' : '', stepState(j, k)]),
    ['Check out', s.checkOutAt ? `Time Out ${fmtTime(s.checkOutAt)}` : 'Sets Time Out', s.checkOutAt ? 'done' : '']];
  const now = list.findIndex(x => x[2] !== 'done' && x[2] !== 'skip');
  return html`<ol class="m-steps">${list.map(([t, sub, st], n) => html`<li class="${st || (n === now ? 'now' : '')}"><span class="n">${st === 'done' ? '✓' : st === 'skip' ? '–' : st === 'bad' ? '!' : n + 1}</span><div><b>${t}</b>${sub ? html`<span class="s">${sub}</span>` : ''}</div></li>`)}</ol>`;
}

// just: the status set a moment ago, shown on the resting button before the next step's name takes its place.
export function mRepairJob(page, id, { just = '' } = {}) {
  const j = store.get('jobs', id);
  if (j?.type === 'GS') { go(`m/gjob/${id}`); return; }
  page.setTitle(j ? titleOf(j) : 'Job', 'm/jobs', j ? `${j.no} · Repair job` : '');
  if (!j || !seesJob(j)) { page.body.innerHTML = '<div class="empty">Job not found.</div>'; return; }
  const inv = invoiceForJob(j.id);
  const canWork = auth.can('job', 'edit', 'mobile') && j.technicianId === auth.user()?.employeeId;
  if (canWork) markSeen(j.id, j.start);
  const address = j.address || j.site;
  page.body.innerHTML = String(html`
    <div class="m-card">
      <div class="row top"><span class="row wrap grow"><span class="pill blue">Repair job</span><span class="pill">${j.status}</span></span><b>${whenText(j.start, 'Not scheduled')}</b></div>
      <div style="margin-top:8px">${address}</div>
      <div class="muted small">Zone ${zoneLabel(j.zoneId)} · ${[j.contact, j.phone].filter(Boolean).join(' ')}</div>
      <div class="m-acts">${callBtn(j.phone)}${directionsBtn(address)}</div>
    </div>
    <div class="m-section">Steps</div><div class="m-card">${jobSteps(j)}</div>
    <div class="m-section">Work to do</div>${j.lines.map((l, i) => html`<div class="m-card"><b>${i + 1}.</b> ${l.description}</div>`)}
    ${j.parts.length ? html`<div class="m-section">Parts to bring</div>${j.parts.map(p => html`<div class="m-card">${p.qty} ${p.unit} × ${p.name}</div>`)}` : ''}
    <div class="m-section">Payment</div><div class="m-card">${vsLabel('PAYMENT_TERMS', j.paymentTerm)}${inv?.status === 'Posted' ? html` · ${inv.no} · ${j.paymentTerm === 'IMMEDIATE' ? html`<b>collect ${auth.company().currency} ${m2(balanceOf(inv))}</b>` : 'invoice from the office'}` : ' · invoice from the office'}</div>
    `);
  if (!canWork) return;
  const label = j.status === 'Scheduled' ? 'On my way' : j.status === 'On the way' ? 'Check in · Time In now' : j.steps?.checkOutAt ? 'View the steps' : 'Continue';
  const btn = page.setFoot(html`<button class="btn primary" id="go">${just ? `✓ ${just}` : label}</button>`).querySelector('#go');
  if (just) setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1300);
  btn.onclick = async () => {
    if (btn.dataset.held) return;
    if (j.status === 'Scheduled') {
      if (!isToday(j.start) && !(await confirmBox('Not planned for today', `This job is planned for ${fmtDate(j.start)} ${fmtTime(j.start)}. Start travelling now?`, 'On my way'))) return;
      onMyWay(j.id); holdNext();
      mRepairJob(page, id, { just: 'On the way' });
      undoToast('On the way · the office can see it', () => { undoOnMyWay(j.id); show(`m/rjob/${j.id}`); });
      return;
    }
    if (j.status === 'On the way') {
      checkIn(j.id, { unanswered: true }); holdNext();
      undoToast(`Checked in · Time In ${fmtTime(new Date().toISOString())}`, () => { undoCheckIn(j.id); show(`m/rjob/${j.id}`); });
      go(`m/rjob/${j.id}/before`);
      return;
    }
    const cur = store.get('jobs', j.id);
    go(`m/rjob/${j.id}/${stepsOf(cur).find(([k]) => !stepDone(cur, k) && stepState(cur, k) !== 'skip')?.[0] || 'leave'}`);
  };
}

export function mRepairStep(page, id, key) {
  const j = store.get('jobs', id);
  if (!j || !seesJob(j)) { page.setTitle('Job', 'm/jobs'); page.body.innerHTML = '<div class="empty">Job not found.</div>'; return; }
  if (!j.workDone) saveJob(j.id, { workDone: workDoneFor(j, { unanswered: true }) });
  const job = store.get('jobs', id);
  const steps = stepsOf(job);
  if (!steps.some(([k]) => k === key)) { go(`m/rjob/${id}/${key === 'payment' ? 'leave' : steps[0][0]}`); return; } // nothing to collect: no payment step
  const idx = steps.findIndex(([k]) => k === key);
  const [step, title] = steps[idx];
  page.setTitle(titleOf(job), `m/rjob/${job.id}`, `${job.no} · ${title}`);
  const signed = !!job.workDone.signedAt;
  const locked = signed && ['works', 'feedback', 'signoff'].includes(step);
  // What "Finish: customer signed" found missing; it stays on screen, with red steps, until it is put right.
  const issues = checking(id) && !signed ? workDoneIssues(job).map(i => ({ ...i, tag: STEP_NAME[i.step] || '' })) : [];
  if (checking(id) && (signed || !issues.length)) setChecking(id, false);
  const pads = {};
  const bar = stepBar(steps.map(([k, t, short], i) => ({ title: t, short, href: `m/rjob/${id}/${k}`, state: stepState(job, k, i < idx) })), idx);
  page.body.innerHTML = String(html`${bar}<form id="f" onsubmit="return false">${step === 'leave' ? leaveBody(job) : RENDER[step](job, locked, issues)}</form>
    ${locked ? html`<div class="note small" style="margin-top:8px">Signed by the customer; the form is locked.</div>` : ''}`);
  const body = $('#f', page.body);
  if (locked) $$('input:not([data-add]), textarea, button.dot', body).forEach(x => { x.disabled = true; });
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
    if (!locked) saveJob(id, { workDone: w });
  };
  if (step === 'signoff' && !locked) {
    ['tech', 'cust'].forEach(who => { const c = $(`#sig_${who}`, body); if (c) { pads[who] = signaturePad(c); c.addEventListener('pointerdown', () => c.dispatchEvent(new Event('input', { bubbles: true }))); } });
    $$('[data-resign]', body).forEach(b => b.addEventListener('click', async () => { await savePads(); const w = read(); removeBlob(w[b.dataset.resign].signatureId); w[b.dataset.resign].signatureId = null; saveJob(id, { workDone: w }); repaint(); }));
    $('#stampIn', body)?.addEventListener('change', async e => { await savePads(); const [sid] = await savePhotos(e.target.files); if (sid) { const w = read(); w.cust.stampId = sid; saveJob(id, { workDone: w }); } repaint(); });
    $('[data-stampdel]', body)?.addEventListener('click', async () => { await savePads(); const w = read(); removeBlob(w.cust.stampId); w.cust.stampId = null; saveJob(id, { workDone: w }); repaint(); });
  }
  // The customer reads the Work Done form before signing: what is drawn is kept, then the form opens as it prints.
  $('#previewDoc', body)?.addEventListener('click', async () => {
    if (!locked) { await savePads(); repaint(); }
    openDocSheet('Preview · Work Done form', workDoneSheet(store.get('jobs', id), auth.company()));
  });
  $('#proofIn', body)?.addEventListener('change', e => { $('#proofName', body).textContent = e.target.files?.[0]?.name || 'Take or add a photo'; });
  $('#recPay', body)?.addEventListener('click', async () => {
    const d = readForm(body);
    const f = $('#proofIn', body)?.files?.[0];
    const proofId = f ? (await savePhotos([f]))[0] || null : null;
    const r = recordPayment({ invoiceId: invoiceForJob(id).id, amount: d.amount, method: d.method, reference: d.reference, proofId, via: 'phone' });
    if (r.problems.length) { showAt($('[name="amount"]', body), r.problems[0]); return; }
    toast(`${r.payment.no} recorded · the office sees it now`);
    repaint();
  });

  // What is missing in this step, shown at its field; the one tapped in the list gets the cursor.
  const marks = {
    rows: () => $$('[data-row]', body).filter(row => !row.querySelector('input[type=radio]:checked')).map(row => [row.querySelector('.chips'), 'Choose one']),
    ratings: () => $$('[data-rate-row]', body).filter(row => !row.querySelector('.dot.on')).map(row => [row.querySelector('.dot'), 'Tap a rating from 5 to 1']),
    techSign: () => [[$('#sig_tech', body), 'Sign here']],
    custSign: () => [[$('#sig_cust', body), 'The customer signs here']],
  };
  // focusKey: the problem whose first field gets the cursor (none: the fields are only marked).
  const mark = (keys, focusKey = '') => {
    let any = false, focused = false;
    keys.forEach(k => (marks[k]?.() || []).forEach(([el, text]) => {
      const focus = !focused && k === focusKey;
      if (showAt(el, text, focus)) { any = true; focused = focused || focus; }
    }));
    return any;
  };
  const jump = takeJump();
  if (issues.length && !locked) mark(issues.filter(i => i.step === step).map(i => i.key), jump?.key);
  $$('[data-prob]', page.body).forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    const p = issues[+a.dataset.prob];
    await savePads();
    setJump({ key: p.key });
    if (p.step === step) repaint(); else go(p.step ? `m/rjob/${id}/${p.step}` : `m/rjob/${id}`);
  }));
  $$('[data-jump]', page.body).forEach(a => a.addEventListener('click', async e => { e.preventDefault(); await savePads(); go(a.getAttribute('href')); }));

  // Footer: back / next, or the step's own action.
  const prev = idx > 0 ? `m/rjob/${id}/${steps[idx - 1][0]}` : `m/rjob/${id}`;
  const nextRoute = idx < steps.length - 1 ? `m/rjob/${id}/${steps[idx + 1][0]}` : `m/rjob/${id}`;
  const main = step === 'signoff' && !signed ? html`<button class="btn primary" id="next">Finish: customer signed</button>`
    : step === 'leave' ? leaveFoot(job)
      : html`<button class="btn primary" id="next">${step === 'before' && !(job.photosBefore || []).length ? 'Next without photos' : `Next: ${steps[idx + 1]?.[1]}`}</button>`;
  const foot = page.setFoot(html`<button class="btn" id="back">← Back</button>${main}`);
  $('#back', foot).onclick = async () => { await savePads(); go(prev); };
  $('#next', foot)?.addEventListener('click', async e => {
    if (e.currentTarget.dataset.held) return;
    await savePads();
    if (step === 'works' && !locked) {
      saveJob(id, { workDone: read() });
      if (mark(['rows'], 'rows')) return;
      saveJob(id, { workDone: { ...read(), worksAt: new Date().toISOString() } });
    }
    if (step === 'feedback' && !locked && mark(['ratings'], 'ratings')) return;
    if (step === 'signoff' && !signed) {
      if (workDoneIssues(store.get('jobs', id)).length) { setChecking(id, true); repaint(); page.body.scrollTop = 0; return; }
      completeWorkDone(id);
      setChecking(id, false);
      toast('Work Done form signed');
    }
    go(nextRoute);
  });
  if (step === 'leave') bindLeave(page, foot, id, repaint);
}
