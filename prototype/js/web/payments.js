// Payment Collection (record only, no gateway): open invoices with due-date tiles, the ageing view
// (0–30 / 31–60 / 61–90 / 90+ days since the invoice date), follow-ups (flow step 11), and the receipts.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, fmtDate, tiles, emptyRow, debounce, dateInput } from '../core/ui.js';
import { vsLabel } from '../core/lookups.js';
import { openInvoices, followUpsFor } from '../core/billing.js';
import { paymentDialog, followUpDialog, payPill } from './invoices.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BUCKETS = ['0–30', '31–60', '61–90', '90+'];
const state = { tile: '', q: '' };

export function renderPayments(el) {
  const cur = auth.company().currency;
  const open = openInvoices().sort((a, b) => a.dueIn - b.dueIn);
  const month = dateInput().slice(0, 7);
  const receipts = store.list('payments').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const defs = [
    { key: 'open', label: 'Open invoices', test: () => true, sub: `${cur} ${m2(open.reduce((t, o) => t + o.balance, 0))} owed` },
    { key: 'soon', label: 'Due in 3 days', test: o => o.dueIn >= 0 && o.dueIn <= 3, tone: 'warn', sub: 'follow up before the due date' },
    { key: 'over', label: 'Overdue', test: o => o.dueIn < 0, tone: 'bad', sub: 'past the due date' },
    { key: 'next', label: 'Follow-up due', test: o => { const f = followUpsFor(o.inv.id)[0]; return !!f?.nextDate && f.nextDate <= dateInput(); }, tone: 'warn', sub: 'next follow-up date reached' },
  ].map(d => ({ ...d, count: open.filter(d.test).length }));
  const can = auth.can('payment', 'create');

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Transactions › Payment Collection', title: 'Payment collection', sub: 'Payments are recorded only (cash, cheque, bank transfer, PayNow). A job closes itself when its invoice is fully paid.' })}
    <div id="tiles"></div>
    <div class="cols2" style="grid-template-columns:minmax(0,2.2fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>Open invoices</h2><input type="search" id="q" placeholder="Search: invoice no, customer, job" value="${state.q}" style="max-width:280px"></div>
        <div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Age</th><th>Last follow-up</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>Ageing</h2><span class="muted small">days since the invoice date</span></div>
        <table class="tbl cost-tbl"><thead><tr><th>Days</th><th class="num">Invoices</th><th class="num">Balance (${cur})</th></tr></thead><tbody>
          ${BUCKETS.map(b => { const l = open.filter(o => o.bucket === b); return html`<tr><td>${b}</td><td class="num">${l.length}</td><td class="num">${m2(l.reduce((t, o) => t + o.balance, 0))}</td></tr>`; })}
          <tr class="sum"><td>Total</td><td class="num">${open.length}</td><td class="num">${m2(open.reduce((t, o) => t + o.balance, 0))}</td></tr></tbody></table>
        <p class="mini-note">Received this month: ${cur} ${m2(receipts.filter(p => p.date.startsWith(month)).reduce((t, p) => t + p.amount, 0))}</p></div>
    </div>
    <div class="card"><div class="card-head"><h2>Receipts</h2><span class="muted small">${receipts.length} payment(s)</span></div>
      <div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Receipt</th><th>Date</th><th>Invoice</th><th>Customer</th><th>Method</th><th>Reference</th><th>Recorded</th><th class="num">Amount (${cur})</th></tr></thead><tbody>
        ${receipts.length ? html`${receipts.map(p => html`<tr class="click" data-go="invoices/${p.invoiceId}"><td class="lnk">${p.no}</td><td>${fmtDate(p.date)}</td><td>${p.invoiceNo}</td><td>${p.customer}</td><td>${vsLabel('PAYMENT_METHOD', p.method)}</td>
          <td>${p.reference}</td><td>${p.via === 'phone' ? 'on site (phone)' : 'office'}</td><td class="num">${m2(p.amount)}</td></tr>`)}` : emptyRow(8, 'No payments yet.')}</tbody></table></div></div>
  </div>`);

  const paint = () => {
    $('#tiles', el).innerHTML = String(tiles(defs, state.tile));
    const tile = defs.find(d => d.key === state.tile);
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = open.filter(o => (!tile || tile.test(o)) && terms.every(t => [o.inv.no, o.inv.customer, o.inv.jobNo].join(' ').toLowerCase().includes(t)));
    $('#rows', el).innerHTML = String(shown.length ? html`${shown.map(o => { const f = followUpsFor(o.inv.id)[0]; return html`<tr><td><a class="lnk" href="#/invoices/${o.inv.id}">${o.inv.no}</a> ${payPill(o.inv)}</td><td>${o.inv.customer}</td><td>${fmtDate(o.inv.date)}</td>
      <td><span class="cd ${o.dueIn < 0 ? 'bad' : o.dueIn <= 3 ? 'warn' : 'ok'}">${o.dueIn < 0 ? `${-o.dueIn} day(s) overdue` : o.dueIn === 0 ? 'due today' : `in ${o.dueIn} day(s)`}</span></td>
      <td class="num">${m2(o.inv.total)}</td><td class="num"><b>${m2(o.balance)}</b></td><td>${o.bucket}</td><td class="small">${f ? `${fmtDate(f.at)} · ${f.note}` : '—'}</td>
      <td class="nowrap">${can ? html`<button class="btn small" data-fu="${o.inv.id}">Follow up</button> <button class="btn small primary" data-pay="${o.inv.id}">Record payment</button>` : ''}</td></tr>`; })}`
      : emptyRow(9, open.length ? 'Nothing matches.' : 'No open invoices.'));
  };
  on(el, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  on(el, 'click', '[data-go]', (e, tr) => { location.hash = `#/${tr.dataset.go}`; });
  on(el, 'click', '[data-pay]', (e, b) => paymentDialog(store.get('invoices', b.dataset.pay), () => render()));
  on(el, 'click', '[data-fu]', (e, b) => followUpDialog(store.get('invoices', b.dataset.fu), () => render()));
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}
