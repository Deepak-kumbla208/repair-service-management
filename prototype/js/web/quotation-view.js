// Quotation page (like the "S3" report editor): the wording on the left in line style, the live A4 print on the right.
// Prices come from the estimate. Submit sends it to the Approver; Send stays locked until it is approved;
// acceptance (method, PO, attachment) creates the job; partial acceptance makes the next revision.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, debounce, fmtDate, fmtDateTime, pill, toast, openModal, chipGroup, readForm, markInvalid, confirmBox } from '../core/ui.js';
import { vsOptions, vsLabel } from '../core/lookups.js';
import { saveBlob } from '../core/media.js';
import { canEdit, saveWording, submitForCheck, canSend, markSent, accept, reject, reviseWording, refreshExpiry, quotationsOf, todayIso } from '../core/quotations.js';
import { reviseEstimate } from '../core/estimates.js';
import { openTaskFor } from '../core/workflow.js';
import { quotationSheet } from './print-docs.js';
import { openWorkflow } from './enquiry-view.js';

const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      <h1>${q.no} · Rev ${q.rev} · ${q.customer} ${pill(q.status === 'Submitted' ? 'In counter-check' : q.status)}</h1>
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
    <div class="s3">
      <form class="card form-lines" id="f" onsubmit="return false">
        <div class="form-sec">Quotation</div>
        ${row('Quotation No.', `${q.no} · Rev ${q.rev}`)}
        ${editable ? html`<div class="field"><label>Date</label><input type="date" name="date" value="${q.date}"></div>` : row('Date', fmtDate(q.date))}
        ${row('Valid until', html`<span id="vu">${fmtDate(q.validUntil)}</span> <span class="muted">(${q.validDays} days)</span>`)}
        <div class="field"><label>Payment Term</label>${chipGroup('paymentTerm', vsOptions('PAYMENT_TERMS'), q.paymentTerm, !editable)}</div>
        ${q.amc && q.amc.jobType === 'AMC' ? row('Contract', `${q.amc.periodMonths} months · ${vsLabel('BILLING', q.amc.billing)} billing · ${q.amc.sites.reduce((t, x) => t + x.visits, 0)} visits a year`) : ''}
        <div class="form-sec">Customer</div>
        ${row('Customer Name', q.customer)}${row('Contact Person', [q.contact, q.phone].filter(Boolean).join(' · '))}${row('Site Location', q.site)}
        <div class="form-sec">Wording</div>
        ${q.costingLevel === 'JOB' ? (editable ? html`<div class="field"><label>Description</label><textarea name="description" rows="3">${q.description}</textarea></div>` : row('Description', q.description))
          : q.rows.map((r, i) => (editable ? html`<div class="field"><label>Line ${i + 1}</label><input type="text" name="row_${i}" value="${r.description}"></div>` : row(`Line ${i + 1}`, r.description)))}
        ${editable ? html`<div class="field"><label>Findings</label><input type="text" name="findings" value="${q.findings}"></div>` : row('Findings', q.findings)}
        <div class="field"><label>Terms</label><div class="ro">${q.terms.length} terms from the Terms master ${editable ? html`<a href="#" id="editTerms">edit</a>` : ''}</div></div>
        <div id="terms" hidden>${q.terms.map((t, i) => html`<div class="field"><label>Term ${i + 1}</label><textarea name="term_${i}" rows="2">${t}</textarea></div>`)}</div>
        ${row('Prepared by', auth.userName(q.preparedBy))}
        ${q.approvals?.length ? html`<div class="form-sec">Counter-check</div>${q.approvals.map(a => row(`Level ${a.level}`, `${a.decision === 'return' ? 'Returned' : 'Approved'} by ${auth.userName(a.by)} · ${fmtDateTime(a.at)}${a.comment ? ` · ${a.comment}` : ''}`))}` : ''}
        ${q.sentAt ? html`<div class="form-sec">Sent</div>${row('Sent', `${fmtDateTime(q.sentAt)} by ${q.sentVia}`)}` : ''}
        ${q.acceptance ? html`<div class="form-sec">Accepted</div>${row('Method', vsLabel('ACCEPT_METHOD', q.acceptance.method))}${row('PO number', q.acceptance.poNo)}${row('Accepted by', `${q.acceptance.contact} · ${fmtDateTime(q.acceptance.at)}`)}` : ''}
        <div class="form-sec">Revisions</div>
        ${revs.map(r => row(`Rev ${r.rev}`, html`${r.id === q.id ? html`<b>this one</b>` : html`<a href="#/quotations/${r.id}">open</a>`} · ${r.status}${r.returnNote ? ` · returned: ${r.returnNote.comment}` : ''}`))}
      </form>
      <div class="preview"><div class="preview-bar"><span>Live print preview · A4</span><span>${editable ? 'updates as you type' : ''}</span></div><div id="pv"></div></div>
    </div>
  </div>`);

  const pv = $('#pv', el);
  const paint = () => { pv.innerHTML = String(quotationSheet(q, company)); };
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
    const save = debounce(() => { const p = saveWording(q.id, readWording()); Object.assign(q, p); $('#vu', el).textContent = fmtDate(p.validUntil); paint(); }, 250);
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
  paint();
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

function acceptDialog(el, q) {
  const enq = store.get('enquiries', q.enquiryId);
  const priced = q.rows.filter(r => r.lineKey && !r.isShared);
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
      ${priced.length > 1 ? html`<div class="form-sec">Accepted lines</div>${priced.map(r => html`<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" name="line_${r.lineKey}" checked> ${r.description} · ${m2(r.amount)}</label>`)}
        <div class="sub">Untick a line the customer does not want: the estimate is revised without it, shared costs are re-spread, and the next revision goes for the counter-check.</div>` : ''}
    </form>`,
    onOpen: b => $('#po', b).addEventListener('change', e => { files = [...e.target.files]; }),
    actions: [{ label: 'Cancel' }, { label: 'Accept', kind: 'primary', onClick: async b => {
      const d = readForm(b);
      if (d.method === 'PO' && !markInvalid(b, d.poNo ? [] : ['poNo'], 'Enter the PO number')) return false;
      const attachments = [...(pre.attachments || [])];
      for (const f of files) attachments.push(await saveBlob(f, { name: f.name, kind: 'po' }));
      const lineKeys = priced.length > 1 ? priced.filter(r => d[`line_${r.lineKey}`]).map(r => r.lineKey) : null;
      if (lineKeys && !lineKeys.length) { toast('Tick at least one line, or use "Customer rejected".', 'bad'); return false; }
      const r = accept(q.id, { method: d.method, poNo: d.poNo, poDate: d.poDate, contact: d.contact, attachments, paymentTerm: d.paymentTerm, lineKeys });
      if (r.error) { toast(r.error, 'bad'); return false; }
      if (r.partial) { toast(`Partial acceptance: ${r.quotation.no} Rev ${r.quotation.rev} made without the other lines`); go(`quotations/${r.quotation.id}`); return true; }
      if (r.contract) { toast(`${q.no} accepted · ${r.contract.no} created: check the start date and activate`); go(`contracts/${r.contract.id}`); return true; }
      toast(`${q.no} accepted · ${r.job.no} is waiting to be scheduled`);
      go(`jobs/${r.job.id}`);
      return true;
    } }],
  });
}
