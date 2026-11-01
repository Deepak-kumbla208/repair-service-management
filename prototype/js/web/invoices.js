// Invoices on the web: the list, and the invoice page (properties and payments on the left, the tax-invoice print on
// the right). A draft gets its number when posted; flagged lines (not done on site) can be removed before posting.
// The "Record payment" dialog is shared with the Payment Collection page.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, fmtDate, pill, toast, openModal, readForm, chipGroup, confirmBox, dateInput } from '../core/ui.js';
import { vsLabel, vsOptions } from '../core/lookups.js';
import { saveBlob } from '../core/media.js';
import { canEditInvoice, postInvoice, removeRow, cancelInvoice, setRowAmount, balanceOf, paidAmount, paymentStatus, paymentsFor, recordPayment, followUpsFor, addFollowUp } from '../core/billing.js';
import { invoiceSheet } from './print-docs.js';
import { renderDocList } from './doc-list.js';
import { render } from '../app.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
export const payPill = inv => { const s = paymentStatus(inv); return s ? pill(vsLabel('PAYMENT_RECEIVED', s), s === 'PAID' ? 'green' : s === 'PARTLY' ? 'blue' : 'amber') : ''; };

export function renderInvoiceList(el) {
  const cur = auth.company().currency;
  renderDocList(el, {
    key: 'rsmInvList', crumb: 'Transactions › Invoice', title: 'Invoices', sub: 'Drafted from the accepted quotation; the number is given when an invoice is posted.',
    placeholder: 'Search invoices: invoice no, customer, job, quotation, PO',
    rows: () => store.list('invoices').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    tiles: [
      { key: 'draft', label: 'Drafts to post', test: i => i.status === 'Draft', tone: 'warn' },
      { key: 'unpaid', label: 'Posted, not fully paid', test: i => i.status === 'Posted' && balanceOf(i) > 0 },
      { key: 'paid', label: 'Paid in full', test: i => paymentStatus(i) === 'PAID' },
      { key: 'cancel', label: 'Cancelled', test: i => i.status === 'Cancelled' },
    ],
    columns: [['Invoice No', i => i.no || 'Draft'], ['Date', i => fmtDate(i.date)], ['Customer', i => i.customer], ['Job', i => i.jobNo], ['Payment term', i => vsLabel('PAYMENT_TERMS', i.paymentTerm)],
      ['Due', i => fmtDate(i.dueDate)], [`Total (${cur})`, i => m2(i.total), 'num'], [`Balance (${cur})`, i => (i.status === 'Posted' ? m2(balanceOf(i)) : ''), 'num'], ['Status', i => html`${pill(i.status, i.status === 'Posted' ? 'green' : '')} ${payPill(i)}`]],
    search: i => [i.no, i.customer, i.jobNo, i.quotationNo, i.poNo], route: i => `invoices/${i.id}`, empty: 'No invoices yet.',
  });
}

export function paymentDialog(inv, onDone, { via = 'web' } = {}) {
  let proof = null;
  openModal({
    title: `Record a payment for ${inv.no}`,
    body: html`<form class="form-lines" onsubmit="return false">
      <div class="field"><label>Balance</label><div class="ro"><b>${auth.company().currency} ${m2(balanceOf(inv))}</b> of ${m2(inv.total)}</div></div>
      <div class="field"><label>Method</label>${chipGroup('method', vsOptions('PAYMENT_METHOD'), 'BANK')}</div>
      <div class="field"><label>Amount</label><input type="number" step="0.01" name="amount" value="${balanceOf(inv).toFixed(2)}"><div class="sub">Change it for a part payment.</div></div>
      <div class="field"><label>Date</label><input type="date" name="date" value="${dateInput()}"></div>
      <div class="field"><label>Reference</label><input type="text" name="reference" placeholder="Cheque no., transfer ref., PayNow ref."></div>
      <div class="field"><label>Proof photo</label><input type="file" accept="image/*" id="proof"></div>
    </form>`,
    onOpen: b => $('#proof', b).addEventListener('change', e => { proof = e.target.files[0] || null; }),
    actions: [{ label: 'Cancel' }, { label: 'Record payment', kind: 'primary', onClick: async b => {
      const d = readForm(b);
      const proofId = proof ? (await saveBlob(proof, { name: proof.name, kind: 'proof' })).id : null;
      const r = recordPayment({ invoiceId: inv.id, amount: d.amount, method: d.method, reference: d.reference, date: d.date, proofId, via });
      if (r.problems.length) { toast(r.problems[0], 'bad'); return false; }
      toast(`${r.payment.no} recorded: ${m2(r.payment.amount)}`);
      onDone?.(r.payment);
      return true;
    } }],
  });
}

export function followUpDialog(inv, onDone) {
  openModal({
    title: `Follow up ${inv.no}`,
    body: html`<form class="form-lines" onsubmit="return false">
      <div class="field"><label>How</label>${chipGroup('method', ['Call', 'Email', 'WhatsApp', 'Visit'], 'Call')}</div>
      <div class="field"><label>Note</label><input type="text" name="note" placeholder="e.g. promised to pay on Friday"></div>
      <div class="field"><label>Next follow-up</label><input type="date" name="nextDate"></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: b => { addFollowUp(inv.id, readForm(b)); toast('Follow-up logged'); onDone?.(); } }],
  });
}

export function renderInvoice(el, id) {
  const inv = store.get('invoices', id);
  if (!inv) { el.innerHTML = '<div class="page"><div class="empty">Invoice not found.</div></div>'; return; }
  const company = auth.company();
  const edit = canEditInvoice(inv);
  const pays = paymentsFor(inv.id);
  const fus = followUpsFor(inv.id);
  const canPay = inv.status === 'Posted' && balanceOf(inv) > 0 && auth.can('payment', 'create');
  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/invoices">Invoice</a> › <a href="#/jobs/${inv.jobId}">${inv.jobNo}</a></div>
      <h1>${inv.no || 'Draft invoice'} · ${inv.customer} ${pill(inv.status, inv.status === 'Posted' ? 'green' : '')} ${payPill(inv)}</h1>
      <div class="page-meta">from <a href="#/quotations/${inv.quotationId}">${inv.quotationNo}</a>${inv.poNo ? ` · PO ${inv.poNo}` : ''} · ${vsLabel('PAYMENT_TERMS', inv.paymentTerm)}</div></div>
      <div class="row"><a class="btn" href="#/invoices/${inv.id}/print">⎙ Print</a>
        ${auth.can('invoice', 'edit') && inv.status === 'Posted' && !pays.length ? html`<button class="btn danger" id="cancel">Cancel invoice</button>` : ''}
        ${inv.status === 'Posted' && balanceOf(inv) > 0 && auth.can('payment', 'edit') ? html`<button class="btn" id="fu">Log follow-up</button>` : ''}
        ${canPay ? html`<button class="btn primary" id="pay">Record payment</button>` : ''}
        ${edit ? html`<button class="btn primary" id="post">Post invoice</button>` : ''}</div>
    </div>
    ${inv.status === 'Draft' && (inv.flagNote || inv.rows.some(r => r.flag)) ? html`<div class="note warn" style="margin-bottom:10px">Check before posting: ${inv.flagNote || 'lines marked not fully done on the Work Done form are flagged below.'}</div>` : ''}
    <div class="s3">
      <div>
        <div class="card form-lines">
          <div class="form-sec">Invoice</div>
          ${row('Invoice No.', inv.no || 'Given when posted (no gaps in the series)')}${row('Date', fmtDate(inv.date))}${row('Due date', fmtDate(inv.dueDate))}
          ${row('Total', `${company.currency} ${m2(inv.total)}${inv.tax ? ` incl. ${inv.taxLabel} ${m2(inv.tax)}` : ''}`)}
          ${inv.status === 'Posted' ? html`${row('Paid', m2(paidAmount(inv)))}${row('Balance', html`<b>${m2(balanceOf(inv))}</b>`)}` : ''}
          <div class="form-sec">Lines</div>
          ${inv.rows.map((r, i) => html`<div class="field"><div class="field-label">Line ${i + 1}</div><div class="ro">${r.description} · <b>${m2(r.amount)}</b>
            ${r.flag ? html`<br><span class="tag">${r.flag}</span>${edit && inv.rows.length > 1 ? html` <button class="btn link small" data-rm="${i}">Remove this line</button>` : ''}` : ''}
            ${edit && (r.flag || inv.flagNote) ? html` <button class="btn link small" data-amt="${i}">Change amount</button>` : ''}${r.note ? html`<br><span class="small muted">Changed: ${r.note}</span>` : ''}</div></div>`)}
          ${pays.length ? html`<div class="form-sec">Payments</div>${pays.map(p => row(p.no, `${fmtDate(p.date)} · ${vsLabel('PAYMENT_METHOD', p.method)} · ${m2(p.amount)}${p.reference ? ` · ${p.reference}` : ''}${p.via === 'phone' ? ' · collected on site' : ''}`))}` : ''}
          ${fus.length ? html`<div class="form-sec">Follow-ups</div>${fus.map(f => row(fmtDate(f.at), `${f.method} · ${f.note}${f.nextDate ? ` · next ${fmtDate(f.nextDate)}` : ''} · ${auth.userName(f.by)}`))}` : ''}
        </div>
      </div>
      <div class="preview"><div class="preview-bar"><span>Print preview · A4</span></div>${invoiceSheet(inv, company)}</div>
    </div>
  </div>`);
  $('#post', el)?.addEventListener('click', async () => {
    if (!await confirmBox('Post the invoice', 'Posting gives the next invoice number and fixes the date. A posted invoice can only be cancelled, not edited.', 'Post')) return;
    const p = postInvoice(inv.id); toast(`Posted as ${p.no}`); render();
  });
  el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { removeRow(inv.id, +b.dataset.rm); render(); }));
  el.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => {
    const r = inv.rows[+b.dataset.amt];
    openModal({
      title: 'Change the amount to match the work done',
      body: html`<div class="form-lines"><div class="field"><label>Line</label><div class="ro">${r.description}</div></div>
        <div class="field"><label>Quoted</label><div class="ro">${m2(r.amount)}</div></div>
        <div class="field"><label>New amount</label><input type="number" step="0.01" name="amount" value="${r.amount.toFixed(2)}"></div>
        <div class="field"><label>Reason</label><input type="text" name="reason" placeholder="e.g. RS-2 springs not replaced"></div></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Change', kind: 'primary', onClick: m => {
        const d = readForm(m);
        if (!(Number(d.amount) >= 0) || !d.reason) { toast('Enter the new amount and the reason', 'bad'); return false; }
        setRowAmount(inv.id, +b.dataset.amt, Number(d.amount), d.reason); render();
      } }],
    });
  }));
  $('#pay', el)?.addEventListener('click', () => paymentDialog(inv, () => render()));
  $('#fu', el)?.addEventListener('click', () => followUpDialog(inv, () => render()));
  $('#cancel', el)?.addEventListener('click', () => openModal({
    title: `Cancel ${inv.no}`, body: html`<div class="form-lines"><div class="field"><label>Reason</label><input type="text" name="reason"></div><p class="small" style="margin-top:8px">The number ${inv.no} is kept and shown as cancelled.</p></div>`,
    actions: [{ label: 'Keep it' }, { label: 'Cancel invoice', kind: 'danger', onClick: b => { const err = cancelInvoice(inv.id, readForm(b).reason || 'Cancelled'); toast(err || `${inv.no} cancelled; the job can raise a corrected invoice`, err ? 'bad' : ''); render(); } }],
  }));
}
