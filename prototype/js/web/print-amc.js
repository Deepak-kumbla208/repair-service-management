// Prints for AMC and General Servicing: the AMC part of a quotation (period, visits, billing plan, shutter schedule),
// the contract summary (the team lead's template is still missing), and the service report: the Inspection Check List
// signed by the customer (flow step 8), with a photo page for failed items. Every page carries the DEMO mark.
import * as store from '../core/store.js';
import { html } from '../core/ui.js';
import { vsLabel, zoneLabel } from '../core/lookups.js';
import { shutterState, signOf, checkItems } from '../core/visits.js';
import { visitsOf, billingLines } from '../core/contracts.js';
import { RATINGS, logoHtml } from './print-docs.js';
import { issued } from '../core/setup.js';

const money = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = s => (s ? s.slice(0, 10).split('-').reverse().join(' / ') : '');
const right = 'text-align:right';
const sec = (title, cols) => html`<tr class="sec"><td colspan="${cols}">${title}</td></tr>`;
const head = (company, title, water = 'DEMO') => html`<div class="demo-water"><span>${water}</span></div><div class="demo-banner">DEMO – prototype, not a valid document</div>
  <div class="head"><div class="logo">${logoHtml(company)}</div><div class="head-main"><h1>${title}</h1>
    <div>${company.address} | ${company.regLabel}: ${company.regNo}${company.chargesTax ? ` | ${company.taxRegLabel}: ${company.taxRegNo}` : ''}</div>
    <div>Tel: ${company.tel} &nbsp;|&nbsp; Mobile: ${company.mobile} &nbsp;|&nbsp; Email: ${company.email}</div></div></div>`;
const sizesOf = counts => Object.entries(counts || {}).filter(([, n]) => n).map(([k, n]) => `${n} × ${k}`).join(', ');

// Added under the price table of an AMC or GS quotation.
export function amcQuoteBlock(q) {
  const a = q.amc;
  if (!a) return '';
  const plan = a.plan || [];
  return html`<table style="margin-top:8px">${sec(a.jobType === 'GS' ? 'SERVICING' : 'MAINTENANCE SCHEDULE', 4)}
    <tr><td class="lbl">Site</td><td class="lbl">Zone</td><td class="lbl">Shutters (by size)</td><td class="lbl">${a.jobType === 'GS' ? 'Visits' : 'Visits per year'}</td></tr>
    ${a.sites.map(s => html`<tr><td>${s.name}</td><td>${zoneLabel(s.zoneId)}</td><td>${s.shutters} (${sizesOf(s.counts)})</td><td>${s.visits}</td></tr>`)}
    ${a.jobType === 'GS' ? '' : html`<tr><td class="lbl">Contract period</td><td colspan="3">${a.periodMonths} months from the start date</td></tr>
      <tr><td class="lbl">Billing</td><td colspan="3">${vsLabel('BILLING', a.billing)} in advance: ${plan.length > 1 ? `${plan.length - 1} × ${money(plan[0].amount)} and 1 × ${money(plan[plan.length - 1].amount)}` : money(plan[0]?.amount)}${q.taxRate ? `, plus ${q.taxLabel} ${q.taxRate} % on each invoice (${money(plan[0]?.tax)})` : ''}</td></tr>`}
  </table>`;
}

// The contract summary.
export function contractSheet(c, company) {
  company = issued(c, company); // an activated contract keeps its letterhead
  const draft = c.status === 'Draft';
  const visits = draft ? [] : visitsOf(c.id);
  const lines = draft ? billingLines(c, c.start) : c.billingPlan;
  const q = store.get('quotations', c.quotationId);
  return html`<div class="sheet">${head(company, 'ANNUAL MAINTENANCE CONTRACT', draft ? 'DRAFT' : 'DEMO')}
    <table>
      <tr><td class="lbl">Customer</td><td>${c.customer}</td><td class="lbl">Contract No.</td><td>${c.no}</td></tr>
      <tr><td class="lbl">Billing Address</td><td>${c.billingAddress}</td><td class="lbl">Period</td><td>${dmy(c.start)} – ${dmy(c.end)}</td></tr>
      <tr><td class="lbl">Contact Person</td><td>${c.contact} · ${c.phone}</td><td class="lbl">Customer PO</td><td>${c.po?.no || ''}${c.po?.date ? ` · ${dmy(c.po.date)}` : ''}</td></tr>
      <tr><td class="lbl">Contract Value</td><td>${company.currency} ${money(c.value)} + ${c.taxLabel} ${money(c.tax)} = <b>${money(c.total)}</b></td><td class="lbl">Payment Term</td><td>${vsLabel('PAYMENT_TERMS', c.paymentTerm)}</td></tr>
    </table>
    <table style="margin-top:6px">${sec('SCHEDULE OF SITES AND SHUTTERS', 4)}
      ${c.sites.map(s => html`<tr><td class="lbl" colspan="4">${s.name} · ${zoneLabel(s.zoneId)} · ${s.visits} visit${s.visits > 1 ? 's' : ''} a year</td></tr>
        ${s.typed ? html`<tr><td colspan="4">${sizesOf(s.counts)} (to be tagged on the first visit)</td></tr>` : s.shutters.map(sh => html`<tr><td>${sh.tag}</td><td>${sh.location}</td><td>${sh.typeName}</td><td>Size ${sh.sizeCode}${sh.fireRated ? ' · fire-rated' : ''}</td></tr>`)}`)}
    </table>
    <table style="margin-top:6px">${sec('VISIT PLAN', 4)}<tr><td class="lbl">Visit</td><td class="lbl">Site</td><td class="lbl">Planned</td><td class="lbl">Status</td></tr>
      ${draft ? html`<tr><td colspan="4">${c.sites.map(s => `${s.visits} visits at ${s.name}`).join('; ')}, about two weeks into each period, dates agreed with the customer.</td></tr>`
        : visits.map(v => html`<tr><td>${v.n} of ${v.of}</td><td>${v.site}</td><td>${dmy(v.blocks?.[0]?.date || v.confirmedDate || v.plannedDate)}</td><td>${v.status}</td></tr>`)}
    </table>
    <table style="margin-top:6px">${sec('BILLING PLAN', 5)}<tr><td class="lbl">Instalment</td><td class="lbl">Period</td><td class="lbl" style="${right}">Amount</td><td class="lbl" style="${right}">${c.taxLabel}</td><td class="lbl" style="${right}">Total</td></tr>
      ${lines.map(l => html`<tr><td>${l.n} of ${l.of}</td><td>${dmy(l.from)} – ${dmy(l.to)}</td><td style="${right}">${money(l.amount)}</td><td style="${right}">${money(l.tax)}</td><td style="${right}">${money(l.total)}</td></tr>`)}
      <tr><td colspan="2" style="${right}"><b>TOTAL</b></td><td style="${right}"><b>${money(c.value)}</b></td><td style="${right}"><b>${money(c.tax)}</b></td><td style="${right}"><b>${money(c.total)}</b></td></tr>
    </table>
    <div style="margin-top:8px;font-weight:700">Terms &amp; Conditions</div>
    <ol style="margin:4px 0 0;padding-left:18px;font-size:9pt">${(q?.terms || []).map(t => html`<li>${t}</li>`)}</ol>
    <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:10pt"><div>For ${company.name}<br><br><br>Name / Signature: ____________________</div><div style="width:45%">For ${c.customer}<br><br><br>Name / Signature &amp; Stamp: ____________</div></div>
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; Annual maintenance contract ${c.no}</span><span>Page 1 of 1</span></div>
  </div>`;
}

// The service report: the Inspection Check List per shutter, failed items and the customer's sign-off.
// coll: 'amcVisits' (AMC visit) or 'jobs' (General Servicing job).
export function serviceSheet(d, coll, company) {
  const s = signOf(coll, d) || {};
  const items = checkItems();
  const mark = r => (r === 'P' ? '✓' : r === 'F' ? '✗' : '–');
  const ref = coll === 'jobs' ? d.no : d.reportNo;
  const sig = id => (id ? html`<img class="sig" data-media="${id}" alt="Signature">` : '');
  const fails = d.failures || [];
  const timeIn = coll === 'jobs' ? s.s1?.timeIn : s.timeIn;
  const timeOut = coll === 'jobs' ? s.s1?.timeOut : s.timeOut;
  return html`<div class="sheet">${head(company, 'INSPECTION CHECK LIST · SERVICE REPORT', s.signedAt ? 'DEMO' : 'DRAFT')}
    <table>
      <tr><td class="lbl">Customer</td><td>${d.customer}</td><td class="lbl">Report No.</td><td>${ref}</td></tr>
      <tr><td class="lbl">Site</td><td>${d.site}</td><td class="lbl">Date</td><td>${dmy(s.signedAt || d.steps?.checkInAt)}</td></tr>
      <tr><td class="lbl">${coll === 'jobs' ? 'Job' : 'Contract / visit'}</td><td>${coll === 'jobs' ? `General servicing · ${d.quotationNo}` : `${d.contractNo} · visit ${d.n} of ${d.of}`}</td><td class="lbl">Time In / Out</td><td>${timeIn || ''} / ${timeOut || ''}</td></tr>
      <tr><td class="lbl">Technician</td><td>${s.tech?.name || ''}</td><td class="lbl">Safe isolation</td><td>${d.safeIsolation ? 'Done' : ''}</td></tr>
    </table>
    <table style="margin-top:6px;font-size:8.5pt">${sec('CHECK LIST  (✓ pass · ✗ fail · – not applicable)', items.length + 1)}
      <tr><td class="lbl">Shutter</td>${items.map(i => html`<td class="lbl" style="text-align:center;font-size:7.5pt">${i.label.split(/[ ,/]/)[0]}</td>`)}</tr>
      ${(d.shutters || []).map(sh => { const st = shutterState(d, sh); return html`<tr><td style="white-space:nowrap"><b>${sh.tag}</b> <span class="small">${sh.location.slice(0, 16)}</span></td>${st.items.map(i => html`<td style="text-align:center">${i.on ? mark(i.r) : '–'}</td>`)}</tr>`; })}
    </table>
    <table style="margin-top:6px">${sec('FAILED ITEMS', 3)}
      ${fails.length ? fails.map(f => html`<tr><td style="width:18%">${f.tag}</td><td style="width:28%">${f.label}</td><td>${f.note}${f.unsafe ? ' · TAKEN OUT OF SERVICE' : ''}</td></tr>`) : html`<tr><td colspan="3">None. All covered shutters passed.</td></tr>`}
      ${d.repairEnquiryId ? html`<tr><td colspan="3">Repair enquiry ${store.get('enquiries', d.repairEnquiryId)?.no} raised for the failed items.</td></tr>` : ''}
    </table>
    <table style="margin-top:6px">${sec('CUSTOMER FEEDBACK', 6)}
      ${RATINGS.map(([k, label]) => html`<tr><td>${label}</td>${[5, 4, 3, 2, 1].map(n => html`<td style="text-align:center;width:10%"><span class="box">${s.ratings?.[k] === n ? '✓' : ''}</span> ${n}</td>`)}</tr>`)}
    </table>
    <table style="margin-top:6px">${sec('SIGN-OFF', 4)}
      <tr><td colspan="2"><b>CHECKED BY</b> &nbsp; Company Representative</td><td colspan="2"><b>ACKNOWLEDGED BY</b> &nbsp; Customer</td></tr>
      <tr><td class="lbl">Name</td><td>${s.tech?.name || ''} · ${s.tech?.designation || ''}</td><td class="lbl">Name</td><td>${s.cust?.name || ''} · ${s.cust?.designation || ''}</td></tr>
      <tr><td class="lbl">Signature</td><td style="height:22mm">${sig(s.tech?.signatureId)}</td><td class="lbl">Signature &amp; Stamp</td><td>${sig(s.cust?.signatureId)} ${s.cust?.stampId ? html`<img class="sig" data-media="${s.cust.stampId}" alt="Company stamp">` : ''}</td></tr>
    </table>
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; Service report ${ref}</span><span>Page 1 of ${fails.some(f => f.photoId) ? 2 : 1}</span></div>
  </div>
  ${fails.some(f => f.photoId) ? html`<div class="sheet">${head(company, `PHOTOS · ${ref}`)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">${fails.filter(f => f.photoId).map(f => html`<div><img data-media="${f.photoId}" alt="${f.tag}" style="width:100%;border:1px solid #ccc"><div style="font-size:9pt">${f.tag} · ${f.label}: ${f.note}</div></div>`)}</div>
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; Service report ${ref}</span><span>Page 2 of 2</span></div></div>` : ''}`;
}
