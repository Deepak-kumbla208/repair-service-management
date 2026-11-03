// Quotation page, stacked: customer and quotation details in a header that folds to one line, then the priced
// lines, the wording, the counter-check, sent / accepted and the revisions. No preview beside it: Print shows the
// document. Prices come from the estimate. Submit sends it to the Approver; Send stays locked until it is approved;
// acceptance (method, PO, attachment) creates the job. A repair quotation in Line costing can be accepted in part
// (each line Now, Later or Not wanted; core/later-work.js); an AMC accepted for fewer sites makes the next revision.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, debounce, fmtDate, fmtDateTime, fmtNum, pill, toast, openModal, chipGroup, readForm, markInvalid, confirmBox, foldHeader } from '../core/ui.js';
import { vsOptions, vsLabel } from '../core/lookups.js';
import { saveBlob } from '../core/media.js';
import { canEdit, saveWording, submitForCheck, canSend, markSent, accept, reject, reviseWording, refreshExpiry, quotationsOf, todayIso } from '../core/quotations.js';
import { reviseEstimate } from '../core/estimates.js';
import { openTaskFor } from '../core/workflow.js';
import { lineInfo, splitOf, followUpFor, notWantedReasons } from '../core/later-work.js';
import { priorityLabel } from '../core/inspections.js';
import { rowText } from '../core/enquiries.js';
import { openWorkflow } from './enquiry-view.js';
import { trailHtml } from './doc-trail.js';

const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Accepted in part: each line's answer, and the counts.
const ANSWER = { NOW: ['Now', 'green'], LATER: ['Later', 'amber'], NO: ['Not wanted', ''] };
const answerPill = (q, r) => { const [t, tone] = ANSWER[r.isShared ? 'NOW' : q.split.decisions[r.lineKey] || 'NOW']; return pill(t, tone); };
const splitCounts = q => { const v = Object.values(q.split.decisions); return ['NOW', 'LATER', 'NO'].map(k => `${v.filter(x => x === k).length} ${ANSWER[k][0].toLowerCase()}`).join(' · '); };

export function renderQuotation(el, id) {
  refreshExpiry();
  const saved = store.get('quotations', id);
  if (!saved) { el.innerHTML = '<div class="page"><div class="empty">Quotation not found.</div></div>'; return; }
  const q = structuredClone(saved);
  const enq = store.get('enquiries', q.enquiryId);
  const company = auth.company();
  const editable = canEdit(q);
  const revs = quotationsOf(q.no);
  const latest = revs[revs.length - 1];
  const task = openTaskFor('quotation', q.id);
  const mayEdit = auth.can('quotation', 'edit');
  const est = store.get('estimates', q.estimateId);
  const estOpen = est && est.status === 'Quoted' && !store.list('estimates', e => e.no === est.no && e.rev > est.rev).length;
  const newestEst = est ? store.list('estimates', e => e.no === est.no).sort((a, b) => b.rev - a.rev)[0] : null;

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/quotations">Sales Quotation</a> › <a href="#/enquiries/${enq.id}">${enq.no}</a></div>
      <h1>${q.no} · Rev ${q.rev} · ${q.customer} ${q.split ? pill('Partly accepted', 'green') : pill(q.status === 'Submitted' ? 'In counter-check' : q.status)}</h1>
      <div class="page-meta">from <a href="#/estimates/${q.estimateId}">${q.estimateNo}</a> · prices are changed in the estimate${q.validUntil ? ` · valid until ${fmtDate(q.validUntil)}` : ''}${q.partialFrom ? ` · partial acceptance of ${q.partialFrom}` : ''}</div></div>
      <div class="row" id="actions"><button class="btn soft" id="wf">⇶ Workflow</button>
        ${auth.can('quotation', 'print') || mayEdit ? html`<a class="btn" href="#/quotations/${q.id}/print">⎙ ${['Draft', 'Returned', 'Submitted'].includes(q.status) ? 'Print draft' : 'Print'}</a>` : ''}
        ${mayEdit && editable ? html`<button class="btn" disabled title="Locked until the counter-check">Send</button><button class="btn primary" id="submit">Submit for check</button>` : ''}
        ${mayEdit && q.status === 'Approved' ? html`<button class="btn" id="rev">Revise wording</button><button class="btn primary" id="send">Send to customer</button>` : ''}
        ${mayEdit && q.status === 'Sent' ? html`<button class="btn" id="rev">Revise wording</button><button class="btn danger" id="reject">Customer rejected</button><button class="btn" id="send">Send again</button><button class="btn primary" id="accept">Record acceptance</button>` : ''}
        ${mayEdit && q.status === 'Expired' ? html`<button class="btn primary" id="rev">Renew (new revision)</button>` : ''}
        ${q.jobId ? html`<a class="btn primary" href="#/jobs/${q.jobId}">Open the job</a>` : ''}${q.contractId ? html`<a class="btn primary" href="#/contracts/${q.contractId}">Open the contract</a>` : ''}</div>
    </div>
    ${q.status === 'Superseded' ? (latest.id !== q.id ? html`<div class="note warn" style="margin-bottom:10px">Replaced by <a href="#/quotations/${latest.id}">Rev ${latest.rev}</a>.</div>`
      : html`<div class="note warn" style="margin-bottom:10px">Replaced: the estimate is being revised. ${newestEst ? html`<a href="#/estimates/${newestEst.id}">Open ${newestEst.no} Rev ${newestEst.rev}</a> and create the quotation revision there.` : ''}</div>`) : ''}
    ${q.status === 'Returned' && q.returnNote ? html`<div class="note bad" style="margin-bottom:10px;display:flex;gap:10px;align-items:center"><span class="grow"><b>Returned by ${auth.userName(q.returnNote.by)}:</b> ${q.returnNote.comment}
      <br><span class="small">A price change: revise the estimate (this makes Rev ${q.rev + 1}). Wording only: change it here and submit again.</span></span>
      ${estOpen && auth.can('estimation', 'edit') ? html`<button class="btn small" id="revEst">Revise estimate</button>` : ''}</div>` : ''}
    ${q.status === 'Submitted' && task ? html`<div class="note" style="margin-bottom:10px">Waiting for the ${task.roleName} (level ${task.level}): ${task.rules.map(r => r.name).join(' + ')}. Send unlocks after approval.</div>` : ''}
    ${trailHtml(enq.id, q.id)}
    <form class="stack" id="f" onsubmit="return false">
      ${foldHeader({ id: `q-${q.id}`, title: 'Customer & quotation details', open: editable,
        summary: [q.customer, q.contact, q.phone, q.site, `${q.no} Rev ${q.rev}`, fmtDate(q.date), vsLabel('PAYMENT_TERMS', q.paymentTerm)].filter(Boolean).join(' · '),
        body: html`<div class="fold-cols form-lines">
          <div><div class="form-sec">Customer</div>${row('Customer Name', q.customer)}${row('Contact Person', [q.contact, q.phone].filter(Boolean).join(' · '))}${row('Site Location', q.site)}</div>
          <div><div class="form-sec">Quotation</div>
          ${row('Quotation No.', `${q.no} · Rev ${q.rev}`)}
          ${editable ? html`<div class="field"><label>Date</label><input type="date" name="date" value="${q.date}"></div>` : row('Date', fmtDate(q.date))}
          ${row('Valid until', html`<span id="vu">${fmtDate(q.validUntil)}</span> <span class="muted">(${q.validDays} days)</span>`)}
          <div class="field"><label>Payment Term</label>${chipGroup('paymentTerm', vsOptions('PAYMENT_TERMS'), q.paymentTerm, !editable)}</div>
          ${q.amc && q.amc.jobType === 'AMC' ? row('Contract', `${q.amc.periodMonths} months · ${vsLabel('BILLING', q.amc.billing)} billing · ${q.amc.sites.reduce((t, x) => t + x.visits, 0)} visits a year`) : ''}
          ${row('Prepared by', auth.userName(q.preparedBy))}</div>
        </div>` })}
      <div class="card"><div class="card-head"><h2>Lines</h2><span class="muted small">${q.costingLevel === 'LINE' ? 'Line costing: a price per line' : 'Job costing: one price for the whole job'} · prices from ${q.estimateNo}</span></div>
        <table class="tbl"><thead><tr><th style="width:30px">#</th><th>Description</th><th class="num" style="width:60px">Qty</th><th style="width:60px">Unit</th><th class="num" style="width:110px">Rate (${company.currency})</th><th class="num" style="width:120px">Amount (${company.currency})</th>${q.split ? html`<th style="width:150px">Customer's answer</th>` : ''}</tr></thead><tbody>
          ${q.rows.map((r, i) => html`<tr><td>${i + 1}</td><td class="wrap">${!editable ? r.description : q.costingLevel === 'JOB'
            ? html`<textarea name="description" rows="2" style="width:100%">${q.description}</textarea>` : html`<input type="text" name="row_${i}" value="${r.description}" style="width:100%">`}</td>
            <td class="num">${fmtNum(r.qty)}</td><td>${r.unit}</td><td class="num">${m2(r.rate)}</td><td class="num">${m2(r.amount)}</td>${q.split ? html`<td>${answerPill(q, r)}</td>` : ''}</tr>`)}
          ${q.taxRate || q.tax ? html`<tr class="sum"><td colspan="5" class="num">Total</td><td class="num">${m2(q.subtotal)}</td>${q.split ? html`<td></td>` : ''}</tr>
            <tr><td colspan="5" class="num">${q.taxLabel} ${fmtNum(q.taxRate)} %</td><td class="num">${m2(q.tax)}</td>${q.split ? html`<td></td>` : ''}</tr>` : ''}
          <tr class="sum"><td colspan="5" class="num"><b>${q.taxRate || q.tax ? `Total incl. ${q.taxLabel || 'tax'}` : 'Total'}</b></td><td class="num"><b>${m2(q.total)}</b></td>${q.split ? html`<td></td>` : ''}</tr>
          ${q.split ? html`<tr class="sum"><td colspan="5" class="num"><b>Accepted now${q.split.tax ? ` incl. ${q.taxLabel || 'tax'}` : ''}</b></td><td class="num"><b>${m2(q.split.total)}</b></td><td>${q.jobId ? html`<a href="#/jobs/${q.jobId}">the job</a>` : ''}</td></tr>` : ''}
        </tbody></table></div>
      <div class="card form-lines"><div class="card-head"><h2>Wording</h2></div>
        ${editable ? html`<div class="field"><label>Findings</label><input type="text" name="findings" value="${q.findings}"></div>` : row('Findings', q.findings)}
        <div class="field"><label>Terms</label><div class="ro">${q.terms.length} terms from the Terms master ${editable ? html`<a href="#" id="editTerms">edit</a>` : ''}</div></div>
        <div id="terms" hidden>${q.terms.map((t, i) => html`<div class="field"><label>Term ${i + 1}</label><textarea name="term_${i}" rows="2">${t}</textarea></div>`)}</div></div>
      ${q.approvals?.length ? html`<div class="card form-lines"><div class="card-head"><h2>Counter-check</h2></div>${q.approvals.map(a => row(`Level ${a.level}`, `${a.decision === 'return' ? 'Returned' : 'Approved'} by ${auth.userName(a.by)} · ${fmtDateTime(a.at)}${a.comment ? ` · ${a.comment}` : ''}`))}</div>` : ''}
      ${q.sentAt || q.acceptance ? html`<div class="card form-lines"><div class="card-head"><h2>${q.acceptance ? 'Sent and accepted' : 'Sent'}</h2></div>
        ${q.sentAt ? row('Sent', `${fmtDateTime(q.sentAt)} by ${q.sentVia}`) : ''}
        ${q.acceptance ? html`${row('Method', vsLabel('ACCEPT_METHOD', q.acceptance.method))}${row('PO number', q.acceptance.poNo)}${row('Accepted by', `${q.acceptance.contact} · ${fmtDateTime(q.acceptance.at)}`)}` : ''}
        ${q.split ? row('Items', html`${splitCounts(q)} · <a href="#/enquiries/${q.enquiryId}">see ${enq.no}</a>`) : ''}</div>` : ''}
      <div class="card form-lines"><div class="card-head"><h2>Revisions</h2></div>
        ${revs.map(r => row(`Rev ${r.rev}`, html`${r.id === q.id ? html`<b>this one</b>` : html`<a href="#/quotations/${r.id}">open</a>`} · ${r.status}${r.returnNote ? ` · returned: ${r.returnNote.comment}` : ''}`))}</div>
    </form>
  </div>`);

  const readWording = () => {
    const d = readForm($('#f', el));
    const patch = { paymentTerm: d.paymentTerm || q.paymentTerm, findings: d.findings ?? q.findings };
    if (d.date) patch.date = d.date;
    if (q.costingLevel === 'JOB' && d.description != null) { patch.description = d.description; patch.rows = q.rows.map(r => ({ ...r, description: d.description })); }
    if (q.costingLevel === 'LINE') patch.rows = q.rows.map((r, i) => ({ ...r, description: d[`row_${i}`] ?? r.description }));
    patch.terms = q.terms.map((t, i) => d[`term_${i}`] ?? t);
    return patch;
  };
  if (editable) {
    const save = debounce(() => { const p = saveWording(q.id, readWording()); Object.assign(q, p); $('#vu', el).textContent = fmtDate(p.validUntil); }, 250);
    $('#f', el).addEventListener('input', save);
    $('#f', el).addEventListener('change', save);
    $('#editTerms', el)?.addEventListener('click', e => { e.preventDefault(); $('#terms', el).hidden = !$('#terms', el).hidden; });
  }
  $('#wf', el).onclick = () => openWorkflow(enq);
  $('#submit', el)?.addEventListener('click', () => {
    if (editable) saveWording(q.id, readWording());
    const r = submitForCheck(q.id);
    toast(r.status === 'Approved' ? `${q.no} Rev ${q.rev} approved (no approval rule applies)` : `${q.no} Rev ${q.rev} sent to the Approver for the counter-check`);
    renderQuotation(el, q.id);
  });
  $('#revEst', el)?.addEventListener('click', () => { const next = reviseEstimate(q.estimateId, { note: 'returned by the Approver' }); if (!next) return toast('The quotation is already closed', 'bad'); toast(`${next.no} Rev ${next.rev} created`); go(`estimates/${next.id}`); });
  $('#rev', el)?.addEventListener('click', async () => {
    if (!await confirmBox('Revise the wording', `Rev ${q.rev + 1} is created with the same prices. It goes to the counter-check again before it can be sent.`, `Create Rev ${q.rev + 1}`)) return;
    const n = reviseWording(q.id); go(`quotations/${n.id}`);
  });
  $('#send', el)?.addEventListener('click', () => sendDialog(el, q));
  $('#accept', el)?.addEventListener('click', () => acceptDialog(el, q));
  $('#reject', el)?.addEventListener('click', () => openModal({
    title: `Customer rejected ${q.no}`, body: html`<div class="form-lines"><div class="field"><label>Reason</label><input type="text" name="reason" placeholder="e.g. price too high, chose another vendor"></div></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Mark rejected', kind: 'danger', onClick: b => { reject(q.id, readForm(b).reason || 'Rejected by the customer'); renderQuotation(el, q.id); } }],
  }));
}

function sendDialog(el, q) {
  const enq = store.get('enquiries', q.enquiryId);
  openModal({
    title: `Send ${q.no} Rev ${q.rev}`,
    body: html`<div class="form-lines">
      <div class="field"><label>Send by</label>${chipGroup('via', ['Email', 'WhatsApp', 'By hand'], enq.email ? 'Email' : 'WhatsApp')}</div>
      ${enq.email ? html`<div class="field"><label>Email</label><div class="ro">${enq.email}</div></div>` : ''}${enq.mobile ? html`<div class="field"><label>WhatsApp</label><div class="ro">${enq.mobile}</div></div>` : ''}
      <p class="small muted" style="margin-top:8px">Nothing is sent from the prototype: this records the date and the method, and the register shows "Quoted".</p></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Mark as sent', kind: 'primary', onClick: b => { markSent(q.id, readForm(b).via); toast(`${q.no} Rev ${q.rev} marked as sent`); renderQuotation(el, q.id); } }],
  });
}

// Repair in Line costing: each line Now / Later / Not wanted (core/later-work.js); AMC: tick the sites accepted.
const DECISIONS = [{ value: 'NOW', label: 'Now' }, { value: 'LATER', label: 'Later' }, { value: 'NO', label: 'Not wanted' }];
const PRIO_TONE = { URGENT: 'red', NORMAL: 'amber', LATER: '' };
const prioPill = p => pill(priorityLabel(p), PRIO_TONE[p] ?? '');
function splitBlock(q, priced) {
  const shared = q.rows.find(r => r.isShared);
  return html`<div class="form-sec">Which items, and when?</div>
    <table class="tbl"><thead><tr><th>Line</th><th>Priority</th><th class="num">Price</th><th>Customer's answer</th></tr></thead><tbody>
      ${priced.map(r => html`<tr><td class="wrap">${rowText(r)}</td><td>${prioPill(lineInfo(q, r.lineKey).priority)}</td><td class="num">${m2(r.amount)}</td>
        <td>${chipGroup(`dec_${r.lineKey}`, DECISIONS, 'NOW')}<div data-why="${r.lineKey}" hidden style="margin-top:4px">${chipGroup(`why_${r.lineKey}`, notWantedReasons(), 'NOT_NEEDED')}</div></td></tr>`)}
      ${shared ? html`<tr><td class="muted">${shared.description}: goes with this visit</td><td></td><td class="num muted">${m2(shared.amount)}</td><td class="small muted">follows the "Now" items</td></tr>` : ''}
    </tbody></table>
    <div class="field" id="fuRow" hidden style="margin-top:8px"><label>Follow up on</label><input type="date" name="followUp"><div class="sub" id="fuNote"></div></div>
    <div class="kpi" id="splitSum" style="margin-top:8px"></div><div id="urgentNote"></div>`;
}
// Live summary under the lines: what the job takes now, what waits, what is not wanted.
function bindSplit(b, q, priced) {
  let touched = false;
  const fu = $('[name="followUp"]', b);
  fu.addEventListener('input', () => { touched = true; });
  const upd = () => {
    const d = readForm(b);
    const dec = Object.fromEntries(priced.map(r => [r.lineKey, d[`dec_${r.lineKey}`] || 'NOW']));
    const pick = v => priced.filter(r => dec[r.lineKey] === v);
    const sum = rows => rows.reduce((t, r) => t + r.amount, 0);
    const later = pick('LATER'), no = pick('NO');
    priced.forEach(r => { $(`[data-why="${r.lineKey}"]`, b).hidden = dec[r.lineKey] !== 'NO'; });
    $('#fuRow', b).hidden = !later.length;
    const pr = later.map(r => lineInfo(q, r.lineKey).priority);
    if (later.length && !touched) fu.value = followUpFor(pr);
    $('#fuNote', b).textContent = later.length ? 'From the most urgent "Later" item: Urgent 1 week, Normal 2 weeks, Can wait 4 weeks.' : '';
    const now = splitOf(q, dec), nowCount = pick('NOW').length;
    $('#splitSum', b).innerHTML = String(html`<div><b>${nowCount ? m2(now.total) : '—'}</b><span>${nowCount ? `Job now: ${nowCount} item(s)${now.rows.some(r => r.isShared) ? ' + transport' : ''}` : 'Job now: choose "Now" for at least one item'}</span></div>
      <div><b>${later.length ? m2(sum(later)) : '—'}</b><span>Later: ${later.length} item(s)</span></div><div><b>${no.length ? m2(sum(no)) : '—'}</b><span>Not wanted: ${no.length} item(s)</span></div>`);
    const urgent = [...later, ...no].filter(r => lineInfo(q, r.lineKey).priority === 'URGENT');
    $('#urgentNote', b).innerHTML = urgent.length ? String(html`<div class="note bad small">${urgent.map(r => lineInfo(q, r.lineKey).tag || rowText(r)).join(', ')} ${urgent.length > 1 ? 'are' : 'is'} Urgent (not safe to use) and not being done now. The customer's product will show this.</div>`) : '';
  };
  b.addEventListener('change', upd);
  upd();
}

function acceptDialog(el, q) {
  const enq = store.get('enquiries', q.enquiryId);
  const priced = q.rows.filter(r => r.lineKey && !r.isShared);
  const est = store.get('estimates', q.estimateId);
  const split = q.type === 'REPAIR' && q.costingLevel === 'LINE' && priced.length > 1;
  const oneJob = q.type === 'REPAIR' && q.costingLevel === 'JOB' && (est?.lines || []).length > 1;
  const pre = q.pendingAcceptance || {};
  let files = [];
  openModal({
    title: `Customer accepts ${q.no} Rev ${q.rev}`, wide: true,
    body: html`<form class="form-lines" onsubmit="return false">
      <div class="field"><label>Method</label>${chipGroup('method', vsOptions('ACCEPT_METHOD'), pre.method || 'PO')}</div>
      <div class="field"><label>PO number</label><input type="text" name="poNo" value="${pre.poNo || ''}" placeholder="Customer's purchase order no."></div>
      <div class="field"><label>PO date</label><input type="date" name="poDate" value="${pre.poDate || todayIso()}"></div>
      <div class="field"><label>Accepted by</label><input type="text" name="contact" value="${pre.contact || enq.contactName}"></div>
      ${(pre.attachments || []).length ? html`<div class="field"><label>Kept from ${q.partialFrom}</label><div class="ro">${pre.attachments.map(a => a.name).join(', ')}</div></div>` : ''}
      ${q.type === 'AMC' ? html`<div class="field"><label>Payment Term</label><div class="ro">${vsLabel('PAYMENT_TERMS', q.paymentTerm)} (approved at the counter-check)</div></div>`
        : html`<div class="field"><label>Payment Term</label>${chipGroup('paymentTerm', vsOptions('PAYMENT_TERMS'), q.paymentTerm)}<div class="sub">A change to a non-immediate term needs the Approver before scheduling.</div></div>`}
      <div class="field"><label>Attachment</label><input type="file" id="po" multiple></div>
      ${split ? splitBlock(q, priced) : oneJob ? html`<div class="sub" style="margin-top:6px">One price for the whole job (Job costing). To do only some items now, revise the estimate to Line costing and send it again.</div>`
        : priced.length > 1 ? html`<div class="form-sec">Accepted lines</div>${priced.map(r => html`<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" name="line_${r.lineKey}" checked> ${r.description} · ${m2(r.amount)}</label>`)}
        <div class="sub">Untick a line the customer does not want: the estimate is revised without it, shared costs are re-spread, and the next revision goes for the counter-check.</div>` : ''}
    </form>`,
    onOpen: b => { $('#po', b).addEventListener('change', e => { files = [...e.target.files]; }); if (split) bindSplit(b, q, priced); },
    actions: [{ label: 'Cancel' }, { label: 'Accept', kind: 'primary', onClick: async b => {
      const d = readForm(b);
      if (d.method === 'PO' && !markInvalid(b, d.poNo ? [] : ['poNo'], 'Enter the PO number')) return false;
      const attachments = [...(pre.attachments || [])];
      for (const f of files) attachments.push(await saveBlob(f, { name: f.name, kind: 'po' }));
      const lineKeys = !split && priced.length > 1 ? priced.filter(r => d[`line_${r.lineKey}`]).map(r => r.lineKey) : null;
      if (lineKeys && !lineKeys.length) { toast('Tick at least one line, or use "Customer rejected".', 'bad'); return false; }
      const decisions = split ? Object.fromEntries(priced.map(r => [r.lineKey, d[`dec_${r.lineKey}`] || 'NOW'])) : null;
      const reasons = split ? Object.fromEntries(priced.filter(r => decisions[r.lineKey] === 'NO').map(r => [r.lineKey, d[`why_${r.lineKey}`]])) : null;
      const r = accept(q.id, { method: d.method, poNo: d.poNo, poDate: d.poDate, contact: d.contact, attachments, paymentTerm: d.paymentTerm, lineKeys, decisions, reasons, followUp: d.followUp });
      if (r.error) { toast(r.error, 'bad'); return false; }
      if (r.quotation.split) { const n = Object.values(decisions).filter(v => v !== 'NOW').length; toast(`${q.no} accepted in part · ${r.job.no} for the "Now" items · ${n} item(s) kept on ${enq.no}`); go(`jobs/${r.job.id}`); return true; }
      if (r.partial) { toast(`Partial acceptance: ${r.quotation.no} Rev ${r.quotation.rev} made without the other lines`); go(`quotations/${r.quotation.id}`); return true; }
      if (r.contract) { toast(`${q.no} accepted · ${r.contract.no} created: check the start date and activate`); go(`contracts/${r.contract.id}`); return true; }
      toast(`${q.no} accepted · ${r.job.no} is waiting to be scheduled`);
      go(`jobs/${r.job.id}`);
      return true;
    } }],
  });
}
