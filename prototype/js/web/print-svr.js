// Print preview of the Site Viewing Report. The layout follows the team lead's Word form exactly
// (7 sections and its footer). Photos and the picked-shutter list are screen helpers: photos print only
// on a separate attachment page. Every printed page carries the DEMO mark.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $ } from '../core/ui.js';
import { zones, productName } from '../core/lookups.js';
import { hydrateImages } from '../core/media.js';

const box = on => html`<span class="box">${on ? '✓' : ''}</span>`;
const opt = (on, label) => html`<span class="nowrap" style="margin-right:14px">${box(on)}${label}</span>`;
const dmy = iso => (iso ? iso.split('-').reverse().join(' / ') : 'DD / MM / YYYY');
const sec = (n, title, cols) => html`<tr class="sec"><td colspan="${cols}">${n}&nbsp;&nbsp;&nbsp;${title}</td></tr>`;

function sheetHead(company) {
  return html`<div class="demo-banner">DEMO – prototype, not a valid document</div>
    <div class="head"><div class="logo">LOGO</div><div class="head-main"><h1>SITE VIEWING REPORT</h1>
      <div>${company.address} | ${company.regLabel}: ${company.regNo}</div>
      <div>Tel: ${company.tel} &nbsp;|&nbsp; Mobile: ${company.mobile} &nbsp;|&nbsp; Email: ${company.email}</div></div></div>`;
}

// Text for "Full Address & Shutter Location": the site address plus the shutters picked on the phone.
export const shutterLocations = rep => rep.shutters.map(s => `${s.tag} ${s.location}`.trim()).join('; ');

export function svrSheetHtml(rep, company) {
  const { s1, s2, s3, s4, s5, s6, s7 } = rep;
  const zoneCodes = zones().map(z => ({ code: z.code, on: z.id === s3.zoneId }));
  const total = Number(s3.persons || 0) * Number(s3.days || 0) * Number(s3.hoursPerDay || 0);
  const rows = [...s5.rows];
  while (rows.length < 5) rows.push(null);
  const loc = shutterLocations(rep);
  return html`<div class="sheet"><div class="demo-water"><span>DEMO</span></div>
    ${sheetHead(company)}
    <table>
      ${sec(1, 'GENERAL DETAILS', 4)}
      <tr><td class="lbl">Company / Customer</td><td data-f="s1.customer">${s1.customer}</td><td class="lbl">Date of Viewing</td><td data-f="s1.viewDate">${dmy(s1.viewDate)}</td></tr>
      <tr><td class="lbl">Site / Project</td><td data-f="s1.site">${s1.site}</td><td class="lbl">Report / Ref. No.</td><td>${rep.no}</td></tr>
      <tr><td class="lbl">Full Address &amp; Shutter Location</td><td data-f="s1.address">${s1.address}${loc ? html`<br>${loc}` : ''}</td><td class="lbl">Contact Person</td><td data-f="s1.contactPerson">${s1.contactPerson}</td></tr>
      <tr><td class="lbl">Block / Level / Unit</td><td data-f="s1.blockUnit">${s1.blockUnit}</td><td class="lbl">Contact No. / Email</td><td data-f="s1.contactNo">${s1.contactNo}</td></tr>
      <tr><td class="lbl">Viewed By</td><td data-f="s1.viewedBy">${s1.viewedBy}</td><td class="lbl">Time In / Out <span class="small">24-hour</span></td><td data-f="s1.timeIn s1.timeOut">${s1.timeIn || ''} / ${s1.timeOut || ''}</td></tr>
    </table>
    <table style="margin-top:6px">
      ${sec(2, 'JOB SCOPE', 3)}
      <tr><td data-f="s2.supplyInstall">${box(s2.supplyInstall)}Supply &amp; install</td><td data-f="s2.repair">${box(s2.repair)}Repair</td><td data-f="s2.replace">${box(s2.replace)}Replace component</td></tr>
      <tr><td data-f="s2.motor">${box(s2.motor)}Motor / control works</td><td data-f="s2.dismantle">${box(s2.dismantle)}Dismantle / removal</td><td data-f="s2.servicing">${box(s2.servicing)}Servicing / maintenance</td></tr>
      <tr><td colspan="3" data-f="s2.other">Other: ${s2.other}</td></tr>
    </table>
    <table><tr><td class="lbl">Job Scope / Description of Work</td><td data-f="s2.description">${s2.description}</td></tr>
      <tr><td class="lbl">Customer Complaint / Findings</td><td data-f="s2.findings">${s2.findings}</td></tr></table>
    <table style="margin-top:6px">
      ${sec(3, 'LABOUR / MAN-HOURS / TRANSPORT', 6)}
      <tr><td class="lbl">Transport Zone</td><td class="lbl">No. of Persons</td><td class="lbl">No. of Days</td><td class="lbl">Hours / Day</td><td class="lbl">Total Man-hours</td><td class="lbl">Remarks</td></tr>
      <tr><td data-f="s3.zoneId">${zoneCodes.map(z => html`<span style="margin-right:6px">${box(z.on)}${z.code}</span>`)}</td><td data-f="s3.persons">${s3.persons ?? ''}</td><td data-f="s3.days">${s3.days ?? ''}</td><td data-f="s3.hoursPerDay">${s3.hoursPerDay ?? ''}</td><td>${total || ''}</td><td data-f="s3.remarks">${s3.remarks}</td></tr>
      <tr><td class="lbl">Working Hours</td><td colspan="5" data-f="s3.normal s3.afterHours s3.weekend s3.phased">${opt(s3.normal, 'Normal hours')}${opt(s3.afterHours, 'After hours / night /')}${opt(s3.weekend, 'Weekend / Public holiday')}${opt(s3.phased, 'Phased (per level / block)')}</td></tr>
    </table>
    <table style="margin-top:6px">
      ${sec(4, 'EQUIPMENT & ACCESS FOR THE WORK', 3)}
      <tr><td data-f="s4.ladder">${box(s4.ladder)}Ladder / platform ladder</td><td data-f="s4.scaffolding s4.scaffoldSets">${box(s4.scaffolding)}Scaffolding: ${s4.scaffoldSets || '______'} set(s)</td><td data-f="s4.scissor s4.scissorNos">${box(s4.scissor)}Scissor lift: ${s4.scissorNos || '______'} no(s).</td></tr>
      <tr><td data-f="s4.boom">${box(s4.boom)}Boom lift / MEWP</td><td data-f="s4.hoist">${box(s4.hoist)}Hoist / chain block</td><td data-f="s4.welding">${box(s4.welding)}Welding set</td></tr>
      <tr><td data-f="s4.grinding">${box(s4.grinding)}Grinding machine / cutter</td><td data-f="s4.powerTools">${box(s4.powerTools)}Power tools / drill</td><td data-f="s4.other">${box(!!s4.other)}Other: ${s4.other || '________________'}</td></tr>
    </table>
    <table><tr><td class="lbl">Max. Working Height</td><td data-f="s4.maxHeight">${s4.maxHeight ? `${s4.maxHeight} m` : ''}</td><td class="lbl">Provided By</td><td data-f="s4.providedBy">${opt(s4.providedBy === 'Customer', 'Customer')}${opt(s4.providedBy === 'Contractor', 'Contractor')}</td></tr>
      <tr><td class="lbl">Rental Duration</td><td data-f="s4.rentalDuration">${s4.rentalDuration}</td><td class="lbl">Others</td><td data-f="s4.others">${s4.others}</td></tr></table>
    <table style="margin-top:6px">
      ${sec(5, 'MATERIALS / SPARE PARTS REQUIRED', 6)}
      <tr><td class="lbl" style="width:7%">No.</td><td class="lbl">Material / Spare Part</td><td class="lbl">Size / Spec / Model</td><td class="lbl" style="width:8%">Qty</td><td class="lbl" style="width:9%">Unit</td><td class="lbl">Remarks</td></tr>
      ${rows.map((r, i) => html`<tr><td>${i + 1}</td><td>${r?.name || ''}</td><td>${r?.spec || ''}</td><td>${r?.qty ?? ''}</td><td>${r?.unit || ''}</td><td>${r?.remarks || ''}</td></tr>`)}
      <tr><td colspan="6" data-f="s5.consumables"><b>Consumables / Misc.</b> <span class="small">e.g. grinding disc, welding rod, lubricant, fasteners, paint (item / qty / est. cost)</span><br>${s5.consumables}</td></tr>
    </table>
    <table style="margin-top:6px">
      ${sec(6, 'SITE REQUIREMENTS & REMARKS', 3)}
      <tr><td data-f="s6.normalAccess">${box(s6.normalAccess)}Normal access</td><td data-f="s6.restricted">${box(s6.restricted)}Restricted access / key required</td><td data-f="s6.permit">${box(s6.permit)}Permit-to-work required</td></tr>
      <tr><td data-f="s6.safetyDocs">${box(s6.safetyDocs)}Safety documents required</td><td data-f="s6.protection">${box(s6.protection)}Protection of floor / property</td><td data-f="s6.barricade">${box(s6.barricade)}Safety barricade / signage</td></tr>
    </table>
    <table><tr><td class="lbl">Remarks / Exclusions / Assumptions</td><td data-f="s6.remarks">${s6.remarks}</td></tr></table>
    <table style="margin-top:6px">
      ${sec(7, 'SIGN-OFF', 2)}
      <tr><td colspan="2"><b>VIEWED BY</b> &nbsp; Company Representative</td></tr>
      <tr><td class="lbl">Name</td><td data-f="s7.name">${s7.name}</td></tr>
      <tr><td class="lbl">Designation</td><td data-f="s7.designation">${s7.designation}</td></tr>
      <tr><td class="lbl">Signature</td><td data-f="s7.signature">${s7.signatureId ? html`<img class="sig" data-media="${s7.signatureId}" alt="Signature">` : ''}</td></tr>
      <tr><td class="lbl">Date <span class="small">DD / MM / YYYY</span></td><td data-f="s7.date">${dmy(s7.date)}</td></tr>
    </table>
    <div class="eoe">E. &amp; O.E. (errors and omissions excepted). This report is for quotation purposes; final quantities are subject to confirmation on site.</div>
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; Site Viewing Report</span><span>Page 1 of 1</span></div>
  </div>`;
}

export function photoSheetHtml(rep, company) {
  if (!rep.photos.length) return '';
  return html`<div class="sheet"><div class="demo-water"><span>DEMO</span></div>${sheetHead(company)}
    <p><b>Attachment to ${rep.no}: site photos</b> (taken on the phone; not part of the printed form)</p>
    <p class="small">Shutters picked: ${rep.shutters.map(s => `${s.tag} ${s.location} (${productName(s.productId)}, ${s.sizeCode || '?'}${s.finding ? `: ${s.finding}` : ''})`).join('; ') || '—'}</p>
    <div class="photo-grid">${rep.photos.map(p => html`<img data-media="${p}" alt="Site photo">`)}</div>
    <div class="foot"><span>${company.name} &nbsp;|&nbsp; ${rep.no} attachment</span><span>Photos</span></div></div>`;
}

export function renderPrintSvr(app, id) {
  const rep = store.get('siteReports', id);
  if (!rep) { app.innerHTML = '<div class="page"><div class="empty">Report not found.</div></div>'; return; }
  const company = auth.company();
  let withPhotos = rep.photos.length > 0;
  const paint = () => {
    app.innerHTML = String(html`<div class="print-view">
      <div class="print-bar"><a class="btn small" href="#/reports/${rep.id}">← Back</a><h1>Print preview · ${rep.no}</h1>
        ${rep.photos.length ? html`<label class="check"><input type="checkbox" id="ph" ${withPhotos ? 'checked' : ''}> Add the photo page</label>` : ''}
        <button class="btn primary" id="print">⎙ Print</button></div>
      ${svrSheetHtml(rep, company)}${withPhotos ? photoSheetHtml(rep, company) : ''}
    </div>`);
    hydrateImages(app);
    $('#print', app).onclick = () => window.print();
    $('#ph', app)?.addEventListener('change', e => { withPhotos = e.target.checked; paint(); });
  };
  paint();
}
