// My tasks (web): the task bell opens this page. Approvers see quotation counter-checks (with the system's
// automatic checks, the cost and margin summary and the quotation as the customer will see it) and payment-term
// approvals; the Operations Executive sees technicians' leave-site requests.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, fmtDate, fmtDateTime, fmtDuration, toast, tiles, pill } from '../core/ui.js';
import { vsLabel } from '../core/lookups.js';
import { myTasks, cannotDecide } from '../core/workflow.js';
import { decideQuotation, autoChecks } from '../core/quotations.js';
import { estimateSummary } from '../core/estimates.js';
import { approveJobTerm, confirmLeave } from '../core/jobs.js';
import { renewContract, declineRenewal, contractProgress } from '../core/contracts.js';
import { invoiceForJob, balanceOf } from '../core/billing.js';
import { bindMics } from '../core/capture.js';
import { quotationSheet } from './print-docs.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sel = { id: '' };

export function taskLabel(t) {
  if (t.kind === 'leaveSite') return 'Leave site';
  if (t.kind === 'renewal') return 'AMC renewal';
  return t.docType === 'job' ? 'Payment term' : t.level > 1 ? `Approval level ${t.level}` : 'Counter-check';
}

// The decision panel for one task, shared with the phone (compact = true).
export function taskDetail(t, { compact = false } = {}) {
  const cur = auth.company().currency;
  if (t.kind === 'leaveSite') {
    const j = store.get('jobs', t.docId);
    const inv = invoiceForJob(j.id);
    const w = j.workDone;
    return html`<div class="card"><div class="card-head"><h2>${t.title}</h2></div>
      <ul class="chk">
        <li><span class="${w?.signedAt ? 'ok' : 'wn'}">${w?.signedAt ? '✓' : '!'}</span><span>Work Done form ${w?.signedAt ? `signed by ${w.cust.name}` : 'not signed yet'}</span></li>
        <li><span class="${(j.photosAfter || []).length ? 'ok' : 'wn'}">${(j.photosAfter || []).length ? '✓' : '!'}</span><span>${(j.photosAfter || []).length} after photo(s), ${(j.photosBefore || []).length} before</span></li>
        <li><span class="${!inv || inv.status !== 'Posted' || balanceOf(inv) <= 0 || j.paymentTerm !== 'IMMEDIATE' ? 'ok' : 'wn'}">${!inv || balanceOf(inv) <= 0 || j.paymentTerm !== 'IMMEDIATE' ? '✓' : '!'}</span>
          <span>${inv?.status === 'Posted' ? (balanceOf(inv) <= 0 ? `${inv.no} paid in full` : j.paymentTerm === 'IMMEDIATE' ? `${inv.no}: ${cur} ${m2(balanceOf(inv))} not collected yet` : `${inv.no}: due in ${vsLabel('PAYMENT_TERMS', j.paymentTerm)}`) : 'Invoice goes out from the office'}</span></li>
      </ul>
      <div class="muted small" style="margin-top:6px">${j.no} · ${j.customer} · asked ${fmtDateTime(t.createdAt)} (${fmtDuration(Date.now() - new Date(t.createdAt))} ago)</div>
      <div class="apr-foot"><input type="text" class="grow" name="comment" placeholder="Note (optional)"><button class="btn primary" data-do="confirm">✓ OK to leave</button></div></div>`;
  }
  if (t.kind === 'renewal') {
    const c = store.get('contracts', t.docId);
    const p = contractProgress(c);
    return html`<div class="card"><div class="card-head"><h2>${t.title}</h2></div>
      <p>${c.no} for ${c.customer} ends on <b>${fmtDate(c.end)}</b>. ${p.done} of ${p.visits} visits done; ${cur} ${m2(p.paid)} paid of ${m2(c.total)}.</p>
      <p class="small muted">Renew creates a renewal enquiry with an estimate pre-filled from this contract (same sites, shutters and visits, today's rates). It then goes to the quotation and the counter-check.</p>
      <div class="apr-foot"><a class="btn" href="#/contracts/${c.id}">Open ${c.no}</a><span class="grow"></span><button class="btn" data-do="decline">Not renewing</button><button class="btn primary" data-do="renew">⟳ Renew now</button></div></div>`;
  }
  if (t.docType === 'job') {
    const j = store.get('jobs', t.docId);
    return html`<div class="card"><div class="card-head"><h2>${t.title}</h2></div>
      <p>The customer accepted ${j.quotationNo} with the payment term <b>${vsLabel('PAYMENT_TERMS', j.paymentTerm)}</b>. Scheduling waits for this approval (flow step 6).</p>
      <div class="muted small">${j.customer} · ${cur} ${m2(j.total)}</div>
      ${decision(compact, t)}</div>`;
  }
  const q = store.get('quotations', t.docId);
  const est = store.get('estimates', q.estimateId);
  const s = estimateSummary(est);
  const parts = [['Materials', s.heads.materials, '#378ADD'], ['Labour', s.heads.labour, '#1D9E75'], ['Transport', s.heads.transport, '#BA7517'], ['Equipment', s.heads.equipment, '#7F77DD'], ['Overhead', s.overhead, '#888780'], ['Margin', s.margin, '#3B6D11']].filter(p => p[1] > 0);
  const checks = html`<div class="card"><div class="card-head"><h2>${t.title}</h2></div>
      <div class="muted small" style="margin:-6px 0 8px">Submitted by ${auth.userName(q.submittedBy)} · ${fmtDateTime(q.submittedAt)} · from ${q.estimateNo}${t.level > 1 ? ` · level ${t.level}: ${t.rules.map(r => r.name).join(', ')}` : ''}</div>
      <ul class="chk">${autoChecks(q).map(c => html`<li><span class="${c.tone === 'ok' ? 'ok' : 'wn'}">${c.tone === 'ok' ? '✓' : '!'}</span><span>${c.text}</span></li>`)}</ul></div>
    <div class="card"><div class="card-head"><h2>Cost and margin</h2><span class="muted small">from the estimate</span></div>
      <div class="kpi"><div><b>${m2(s.subtotal)}</b><span>Selling price</span></div><div><b>${s.markupPct.toFixed(1)} %</b><span>Markup on cost</span></div><div><b>${s.marginOnPricePct.toFixed(1)} %</b><span>Margin on price</span></div></div>
      <div class="bar">${parts.map(p => html`<span style="width:${(p[1] / s.sell) * 100}%;background:${p[2]}"></span>`)}</div>
      <div class="legend">${parts.map(p => html`<span><i style="background:${p[2]}"></i>${p[0]} ${m2(p[1])}</span>`)}</div>
      <table class="tbl cost-tbl" style="margin-top:10px"><tbody>
        <tr><td>Direct cost</td><td class="num">${m2(s.direct)}</td></tr><tr><td>Overhead</td><td class="num">${m2(s.overhead)}</td></tr><tr><td>Margin</td><td class="num">${m2(s.margin)}</td></tr>
        <tr class="sum"><td>Selling price</td><td class="num">${m2(s.subtotal)}</td></tr><tr><td>${q.taxLabel} ${q.taxRate} %</td><td class="num">${m2(q.tax)}</td></tr><tr class="grand"><td>Total quote</td><td class="num">${m2(q.total)}</td></tr>
      </tbody></table></div>`;
  return html`${checks}${decision(compact, t)}`;
}

// The decision buttons; off for the person who submitted the document (nobody approves their own document).
const decision = (compact = false, t = null) => cannotDecide(t) ? html`<div class="note warn small" style="margin-top:10px">${cannotDecide(t)}</div>` : html`<div class="apr-foot" style="${compact ? 'flex-direction:column;align-items:stretch' : ''}"><div class="with-mic grow"><textarea name="comment" placeholder="Comment (needed to return)" style="min-height:58px"></textarea><button type="button" class="mic" data-mic="comment" title="Voice input">🎤</button></div>
  <div style="display:flex;flex-direction:column;gap:6px"><button class="btn primary" data-do="approve">✓ Approve</button><button class="btn danger" data-do="return">↩ Return</button></div></div>`;

// Carry out a decision; returns an error text or ''.
export function actOnTask(t, action, comment) {
  if (!myTasks().some(x => x.id === t.id)) return 'This task is not for your role.';
  if (cannotDecide(t)) return cannotDecide(t);
  if (action === 'return' && !comment.trim()) return 'Write a comment to say what needs changing.';
  if (t.kind === 'leaveSite') { confirmLeave(t.id, comment); return ''; }
  if (t.kind === 'renewal' && action === 'decline') { declineRenewal(t.docId, comment); return ''; }
  if (t.kind === 'renewal') { const r = renewContract(t.docId); go(`estimates/${r.estimate.id}`); return ''; }
  if (t.docType === 'job') { approveJobTerm(t.id, action, comment); return ''; }
  decideQuotation(t.id, action, comment);
  return '';
}

export function renderTasks(el, openId) {
  // #/tasks/<id> (from a dashboard row) opens that task; the address goes back to #/tasks so later renders keep the
  // user's own choice.
  if (openId) { sel.id = openId; history.replaceState(null, '', '#/tasks'); }
  const list = myTasks();
  if (!list.find(t => t.id === sel.id)) sel.id = list[0]?.id || '';
  const t = list.find(x => x.id === sel.id);
  const doneToday = store.list('tasks', x => x.doneBy === store.currentActor() && x.doneAt && new Date(x.doneAt).toDateString() === new Date().toDateString());
  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    ${pageHead({ crumb: 'Dashboard › My tasks', title: 'My tasks', sub: `${auth.role().name}: approvals and confirmations waiting for you.` })}
    ${tiles([{ key: 'open', label: 'Waiting for me', count: list.length, tone: 'warn' }, { key: 'ret', label: 'Returned by me today', count: doneToday.filter(x => x.status === 'Returned').length },
      { key: 'ok', label: 'Approved or confirmed today', count: doneToday.filter(x => x.status === 'Done').length }], 'open')}
    ${list.length ? html`<div class="apr">
      <div>${list.map(x => html`<div class="task ${x.id === sel.id ? 'on' : ''}" data-task="${x.id}"><div class="row"><b>${x.docNo}</b><span class="grow"></span><span class="small muted">${fmtDuration(Date.now() - new Date(x.createdAt))} ago</span></div>
        <div>${x.customer}</div><div class="row small"><span class="pill ${x.kind === 'leaveSite' ? 'amber' : x.kind === 'renewal' ? 'purple' : 'blue'}">${taskLabel(x)}</span>${x.rules?.some(r => r.code === 'PAY_TERM') && x.docType === 'quotation' ? pill('Payment term', 'purple') : ''}<span class="grow"></span>${x.amount != null ? html`<b>${auth.company().currency} ${m2(x.amount)}</b>` : ''}</div></div>`)}</div>
      <div id="detail">${taskDetail(t)}</div>
      ${t.docType === 'quotation' ? html`<div class="preview" style="padding:8px;overflow:hidden"><div class="preview-bar"><span>Quotation as the customer will see it</span><a href="#/quotations/${t.docId}">open</a></div>
        <div style="zoom:.55">${quotationSheet(store.get('quotations', t.docId), auth.company())}</div></div>` : html`<div></div>`}
    </div>` : html`<div class="card"><div class="empty">Nothing is waiting for you.</div></div>`}
  </div>`);
  bindMics(el);
  el.onclick = e => {
    const tb = e.target.closest('[data-task]');
    if (tb) { sel.id = tb.dataset.task; renderTasks(el); return; }
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const err = actOnTask(t, b.dataset.do, $('[name="comment"]', el)?.value || '');
    if (err) { toast(err, 'bad'); return; }
    toast(`${t.docNo}: ${b.dataset.do === 'return' ? 'returned with your comment' : b.dataset.do === 'confirm' ? 'the technician may leave the site' : b.dataset.do === 'renew' ? 'renewal enquiry and estimate created' : b.dataset.do === 'decline' ? 'marked as not renewing' : 'approved'}`);
    sel.id = '';
    if (b.dataset.do !== 'renew') render();
  };
}
