// Print previews of the Stretch 2 documents, following the team lead's layouts: the Quotation Print and Invoice
// Print sheets of the Repair estimator (plus the TOTAL / GST / TOTAL INCL. GST rows), and the Work Done &
// Customer Feedback Form (4 sections). Every page carries the DEMO mark.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $ } from '../core/ui.js';
import { vsLabel } from '../core/lookups.js';
import { hydrateImages } from '../core/media.js';
import { amcQuoteBlock, contractSheet, serviceSheet } from './print-amc.js';
import { issued, logoSrc } from '../core/setup.js';

// The logo from Company Setup, or the empty box the team lead's forms have.
export const logoHtml = company => { const src = logoSrc(company); return src ? html`<img src="${src}" alt="Logo">` : 'LOGO'; };

const money = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = s => (s ? s.slice(0, 10).split('-').reverse().join(' / ') : 'DD / MM / YYYY');
const box = on => html`<span class="box">${on ? '✓' : ''}</span>`;
const sec = (n, title, cols) => html`<tr class="sec"><td colspan="${cols}">${n}&nbsp;&nbsp;&nbsp;${title}</td></tr>`;
const right = 'text-align:right';
const CHECKED = ['Approved', 'Sent', 'Accepted', 'Expired'];

function head(company, title, water = 'DEMO') {
  return html`<div class="demo-water"><span>${water}</span></div><div class="demo-banner">DEMO – prototype, not a valid document</div>
    <div class="head"><div class="logo">${logoHtml(company)}</div><div class="head-main"><h1>${title}</h1>
      <div>${company.address} | ${company.regLabel}: ${company.regNo}${company.chargesTax ? ` | ${company.taxRegLabel}: ${company.taxRegNo}` : ''}</div>
      <div>Tel: ${company.tel} &nbsp;|&nbsp; Mobile: ${company.mobile} &nbsp;|&nbsp; Email: ${company.email}</div></div></div>`;
}

function priceTable(doc, cur) {
  const rows = [...doc.rows];
  while (rows.length < 3) rows.push(null);
  return html`<table style="margin-top:8px"><tr><th style="width:26px">#</th><th>Description</th><th style="width:44px">Qty</th><th style="width:48px">Unit</th><th style="width:92px">Rate (${cur})</th><th style="width:100px">Amount (${cur})</th></tr>
    ${rows.map((r, i) => html`<tr><td>${r ? i + 1 : ''}</td><td>${r?.description || html`&nbsp;`}</td><td>${r?.qty ?? ''}</td><td>${r?.unit || ''}</td><td style="${right}">${r ? money(r.rate) : ''}</td><td style="${right}">${r ? money(r.amount) : ''}</td></tr>`)}
    <tr><td colspan="5" style="${right}"><b>TOTAL</b></td><td style="${right}"><b>${money(doc.subtotal)}</b></td></tr>
    ${doc.taxRate || doc.tax ? html`<tr><td colspan="5" style="${right}">${doc.taxLabel} ${doc.taxRate} %</td><td style="${right}">${money(doc.tax)}</td></tr>
      <tr><td colspan="5" style="${right}"><b>TOTAL INCL. ${doc.taxLabel}</b></td><td style="${right}"><b>${money(doc.total)}</b></td></tr>` : ''}
  </table>`;
}

function signBlock(company, userId, rightSide) {
  const u = store.all('users').find(x => x.id === userId);
  const emp = u?.employeeId ? store.get('employees', u.employeeId) : null;
  return html`<div style="display:flex;justify-content:space-between;margin-top:18px;font-size:10pt">
    <div>For ${company.name}<br><br><br>${u?.name || ''}<br>${emp?.designation || u?.name || ''}<br>Mobile: ${company.mobile}</div>${rightSide}</div>`;
}

export function quotationSheet(q, company) {
  company = issued(q, company); // a sent quotation keeps its letterhead
  return html`<div class="sheet">${head(company, 'QUOTATION', CHECKED.includes(q.status) ? 'DEMO' : 'NOT COUNTER-CHECKED')}
    <table>
      <tr><td class="lbl">Customer Name</td><td>${q.customer}</td><td class="lbl">Date</td><td>${dmy(q.date)}</td></tr>
      <tr><td class="lbl">Contact Person</td><td>${q.contact}</td><td class="lbl">Quotation No.</td><td>${q.no}${q.rev > 1 ? ` Rev ${q.rev}` : ''}</td></tr>
      <tr><td class="lbl">Phone</td><td>${q.phone}</td><td class="lbl">Payment Term</td><td>${vsLabel('PAYMENT_TERMS', q.paymentTerm)}</td></tr>
      <tr><td class="lbl">SITE Location</td><td colspan="3">${q.site}</td></tr>
    </table>
    ${priceTable(q, company.currency)}
    ${amcQuoteBlock(q)}
    <table style="margin-top:8px"><tr><td class="lbl">Findings</td><td>${q.findings}</td></tr></table>
    <div style="margin-top:10px;font-weight:700">Terms &amp; Conditions</div>
    <ol style="margin:4px 0 0;padding-left:18px;font-size:9.5pt">${q.terms.map(t => html`<li>${t}</li>`)}</ol>
    ${signBlock(company, q.preparedBy, html`<div style="width:45%">Customer Acceptance<br><br>Name: ____________________<br><br>Signature &amp; Stamp: ____________<br><br>Date: ____________________</div>`)}
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; Quotation${q.validUntil ? ` · valid until ${dmy(q.validUntil)}` : ''}</span><span>Page 1 of 1</span></div>
  </div>`;
}

export function invoiceSheet(inv, company) {
  company = issued(inv, company); // a posted invoice keeps its letterhead
  const title = company.chargesTax ? 'TAX INVOICE' : 'INVOICE';
  return html`<div class="sheet">${head(company, title, inv.status === 'Cancelled' ? 'CANCELLED' : inv.status === 'Draft' ? 'DRAFT' : 'DEMO')}
    <table>
      <tr><td class="lbl">Customer Name</td><td>${inv.customer}</td><td class="lbl">Date</td><td>${dmy(inv.date)}</td></tr>
      <tr><td class="lbl">Billing Address</td><td>${inv.billingAddress}</td><td class="lbl">Invoice No.</td><td>${inv.no || 'Draft (number given when posted)'}</td></tr>
      <tr><td class="lbl">Contact Person</td><td>${inv.contact}</td><td class="lbl">Payment Term</td><td>${vsLabel('PAYMENT_TERMS', inv.paymentTerm)}</td></tr>
      <tr><td class="lbl">Phone</td><td>${inv.phone}</td><td class="lbl">Due Date</td><td>${dmy(inv.dueDate)}</td></tr>
      <tr><td class="lbl">SITE Location</td><td>${inv.site}</td><td class="lbl">Your PO / Our ref.</td><td>${[inv.poNo, inv.jobNo, inv.quotationNo].filter(Boolean).join(' · ')}</td></tr>
    </table>
    ${priceTable(inv, company.currency)}
    <table style="margin-top:8px"><tr><td class="lbl">Findings</td><td>${inv.findings}</td></tr></table>
    ${company.bank || company.payNow ? html`<p style="margin:8px 0 0;font-size:9.5pt"><b>Payment:</b> ${[company.bank, company.payNow].filter(Boolean).join(' · ')}</p>` : ''}
    <div style="margin-top:8px;font-weight:700">Terms</div>
    <ol style="margin:4px 0 0;padding-left:18px;font-size:8.5pt">${inv.terms.map(t => html`<li>${t}</li>`)}</ol>
    ${signBlock(company, inv.preparedBy, '')}
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; ${title.toLowerCase().replace(/^./, c => c.toUpperCase())}</span><span>Page 1 of 1</span></div>
  </div>`;
}

const RATINGS = [['punctuality', 'Punctuality & Timeliness'], ['quality', 'Quality of Work Done'], ['staff', 'Staff Professionalism & Conduct'], ['overall', 'Overall Service Satisfaction']];
export { RATINGS };

// The Work Done & Customer Feedback Form, exactly its 4 sections.
export function workDoneSheet(job, company) {
  const w = job.workDone;
  const s1 = w?.s1 || {};
  const rows = [...(w?.rows || [])];
  while (rows.length < 4) rows.push(null);
  const sig = id => (id ? html`<img class="sig" data-media="${id}" alt="Signature">` : '');
  return html`<div class="sheet">${head(company, 'WORK DONE & CUSTOMER FEEDBACK FORM')}
    <table>${sec(1, 'PROJECT & WORK DETAILS', 4)}
      <tr><td class="lbl">Project</td><td>${s1.project}</td><td class="lbl">Reference No.</td><td>${s1.refNo}</td></tr>
      <tr><td class="lbl">Customer Name</td><td>${s1.customer}</td><td class="lbl">Date <span class="small">DD / MM / YYYY</span></td><td>${dmy(s1.date)}</td></tr>
      <tr><td class="lbl">Site / Location</td><td>${s1.location}</td><td class="lbl">Time In <span class="small">24-hour</span></td><td>${s1.timeIn}</td></tr>
      <tr><td class="lbl">Subject / Purpose</td><td>${s1.subject}</td><td class="lbl">Time Out <span class="small">24-hour</span></td><td>${s1.timeOut}</td></tr>
    </table>
    <table style="margin-top:6px">${sec(2, 'DESCRIPTION OF WORKS DONE', 3)}
      <tr><td class="lbl" style="width:8%">S. No.</td><td class="lbl">Description of Works Done</td><td class="lbl" style="width:30%">Remarks / Status</td></tr>
      ${rows.map((r, i) => html`<tr><td>${r ? i + 1 : html`&nbsp;`}</td><td>${r?.description || ''}</td><td>${r ? [vsLabel('WORK_DONE', r.status), r.remark].filter(Boolean).join(' · ') : ''}</td></tr>`)}
    </table>
    <table style="margin-top:6px">${sec(3, 'CUSTOMER FEEDBACK RATING', 6)}
      <tr><td colspan="6" class="small">Please rate our service by marking the appropriate box for each category.</td></tr>
      <tr><td class="lbl">Service Category</td>${['Excellent 5', 'Good 4', 'Satisfactory 3', 'Poor 2', 'Very Poor 1'].map(h => html`<td class="lbl" style="text-align:center;width:12%">${h}</td>`)}</tr>
      ${RATINGS.map(([k, label]) => html`<tr><td>${label}</td>${[5, 4, 3, 2, 1].map(n => html`<td style="text-align:center">${box(w?.ratings?.[k] === n)}</td>`)}</tr>`)}
      <tr><td colspan="6"><b>Customer Comments / Recommendations</b><br>${w?.comments || html`&nbsp;`}</td></tr>
    </table>
    <table style="margin-top:6px">${sec(4, 'SIGN-OFF & VERIFICATION', 4)}
      <tr><td colspan="2"><b>CHECKED BY</b> &nbsp; Company Representative</td><td colspan="2"><b>ACKNOWLEDGED &amp; ACCEPTED BY</b> &nbsp; Customer</td></tr>
      <tr><td class="lbl">Name</td><td>${w?.tech?.name}</td><td class="lbl">Name</td><td>${w?.cust?.name}</td></tr>
      <tr><td class="lbl">Designation</td><td>${w?.tech?.designation}</td><td class="lbl">Designation</td><td>${w?.cust?.designation}</td></tr>
      <tr><td class="lbl">Signature</td><td style="height:24mm">${sig(w?.tech?.signatureId)}</td><td class="lbl">Signature &amp; Company Stamp</td><td>${sig(w?.cust?.signatureId)} ${w?.cust?.stampId ? html`<img class="sig" data-media="${w.cust.stampId}" alt="Company stamp">` : ''}</td></tr>
      <tr><td class="lbl">Date <span class="small">DD / MM / YYYY</span></td><td>${dmy(w?.tech?.date)}</td><td class="lbl">Date <span class="small">DD / MM / YYYY</span></td><td>${dmy(w?.cust?.date)}</td></tr>
    </table>
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; Work Done &amp; Customer Feedback Form</span><span>Page 1 of 1</span></div>
  </div>`;
}

// Print page outside the web shell: #/quotations/:id/print, #/invoices/:id/print, #/jobs/:id/workdone, #/contracts/:id/print,
// #/amc-visits/:id/print and #/jobs/:id/service (General Servicing)
export function renderPrintDoc(app, kind, id) {
  const company = auth.company();
  const def = {
    quotation: { coll: 'quotations', back: `quotations/${id}`, title: d => `${d.no} Rev ${d.rev}`, sheet: d => quotationSheet(d, company) },
    invoice: { coll: 'invoices', back: `invoices/${id}`, title: d => d.no || 'Draft invoice', sheet: d => invoiceSheet(d, company) },
    workdone: { coll: 'jobs', back: `jobs/${id}`, title: d => `${d.no} · Work Done form`, sheet: d => workDoneSheet(d, company) },
    contract: { coll: 'contracts', back: `contracts/${id}`, title: d => d.no, sheet: d => contractSheet(d, company) },
    service: { coll: 'amcVisits', back: `amc-visits/${id}`, title: d => `${d.reportNo} · service report`, sheet: d => serviceSheet(d, 'amcVisits', company) },
    gsservice: { coll: 'jobs', back: `jobs/${id}`, title: d => `${d.no} · service report`, sheet: d => serviceSheet(d, 'jobs', company) },
  }[kind];
  const doc = store.get(def.coll, id);
  if (!doc) { app.innerHTML = '<div class="page"><div class="empty">Document not found.</div></div>'; return; }
  app.innerHTML = String(html`<div class="print-view">
    <div class="print-bar"><a class="btn small" href="#/${def.back}">← Back</a><h1>Print preview · ${def.title(doc)}</h1><button class="btn primary" id="print">⎙ Print</button></div>
    ${def.sheet(doc)}</div>`);
  hydrateImages(app);
  $('#print', app).onclick = () => window.print();
}
