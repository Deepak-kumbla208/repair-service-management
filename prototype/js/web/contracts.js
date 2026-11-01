// AMC contracts on the web: the list, and the contract page ("E2": contract, customer and money on the left; the visit
// plan, billing plan, sites and history on the right). A draft shows both plans as a preview; "Activate" creates them.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, on, fmtDate, pill, toast, openModal, readForm, confirmBox, popMenu, fmtNum } from '../core/ui.js';
import { vsLabel, zoneLabel, empName } from '../core/lookups.js';
import { saveBlob, getUrl } from '../core/media.js';
import { canEditContract, saveContract, activateContract, activateProblems, cancelContract, renewContract, visitsOf, contractProgress, daysLeft, plannedDates, billingLines,
  refreshAmc } from '../core/contracts.js';
import { postInvoice, postContractDrafts, balanceOf, paymentStatus } from '../core/billing.js';
import { isOverdue, visitDate } from '../core/visits.js';
import { activityHtml, openWorkflow } from './enquiry-view.js';
import { renderDocList } from './doc-list.js';
import { render } from '../app.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const row = (label, value) => html`<div class="field"><div class="field-label">${label}</div><div class="ro">${value || html`<span class="muted">—</span>`}</div></div>`;
const TAB_KEY = 'rsmContractTab';
export const contractPill = c => pill(c.status, { Draft: 'amber', Active: 'green', Renewed: 'green', Closed: 'green', Expired: 'red', Terminated: 'red', Cancelled: 'red' }[c.status]);
const visitPill = v => (isOverdue(v) ? pill(`Overdue · ${v.status}`, 'red') : pill(v.status, { Planned: '', Confirmed: 'amber', Scheduled: 'blue', 'On the way': 'blue', 'On site': 'blue', Done: 'green', 'Checked & filed': 'green', Cancelled: 'red' }[v.status]));

export function renderContractList(el) {
  refreshAmc();
  const cur = auth.company().currency;
  renderDocList(el, {
    key: 'rsmContractList', crumb: 'Transactions › AMC Contract', title: 'AMC contracts', sub: 'Created when an AMC quotation is accepted; "Activate" makes the visit plan and the billing plan.',
    placeholder: 'Search contracts: no, customer, site, PO, quotation',
    rows: () => store.list('contracts').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    tiles: [
      { key: 'draft', label: 'To activate', test: c => c.status === 'Draft', tone: 'warn' },
      { key: 'active', label: 'Active', test: c => c.status === 'Active' },
      { key: 'ending', label: 'Ending in 60 days', test: c => c.status === 'Active' && daysLeft(c) <= 60, tone: 'warn', sub: 'renew' },
      { key: 'ended', label: 'Ended, to close', test: c => ['Expired', 'Renewed', 'Terminated'].includes(c.status) },
      { key: 'closed', label: 'Closed', test: c => c.status === 'Closed' },
    ],
    columns: [['Contract No', c => c.no], ['Customer', c => c.customer], ['Sites', c => c.sites.map(s => s.name).join(', ')], ['Period', c => `${fmtDate(c.start)} – ${fmtDate(c.end)}`],
      ['Visits done', c => { const p = contractProgress(c); return c.status === 'Draft' ? '—' : `${p.done} of ${p.visits}`; }], ['Billing', c => vsLabel('BILLING', c.billing)],
      [`Total (${cur})`, c => m2(c.total), 'num'], ['Status', c => contractPill(c)]],
    search: c => [c.no, c.customer, c.sites.map(s => s.name), c.po?.no, c.quotationNo], route: c => `contracts/${c.id}`, empty: 'No AMC contracts yet. Accepting an AMC quotation creates one.',
  });
}

export function renderContract(el, id) {
  refreshAmc();
  const c = store.get('contracts', id);
  if (!c) { el.innerHTML = '<div class="page"><div class="empty">Contract not found.</div></div>'; return; }
  const enq = store.get('enquiries', c.enquiryId);
  const draft = c.status === 'Draft';
  const edit = canEditContract(c);
  const mayEdit = auth.can('amcContract', 'edit');
  const p = contractProgress(c);
  const visits = visitsOf(c.id);
  const drafts = store.list('invoices', i => i.contractId === c.id && i.status === 'Draft');
  const renewal = c.renewal?.enquiryId ? store.get('enquiries', c.renewal.enquiryId) : null;
  const canRenew = mayEdit && !c.renewal?.renewedById && ['Active', 'Expired'].includes(c.status);
  const left = draft ? 0 : daysLeft(c);
  const total = Math.round((new Date(`${c.end}T00:00`) - new Date(`${c.start}T00:00`)) / 86400000) + 1;
  let tab = sessionStorage.getItem(TAB_KEY) || 'visits';

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/contracts">AMC Contract</a> › <a href="#/enquiries/${enq.id}">${enq.no}</a></div>
      <h1>${c.no} · ${c.customer} ${contractPill(c)}</h1>
      <div class="page-meta">From <a href="#/quotations/${c.quotationId}">${c.quotationNo}</a>${c.po?.no ? ` · PO ${c.po.no}` : ''} · ${fmtDate(c.start)} – ${fmtDate(c.end)}${c.status === 'Active' ? ` · day ${Math.max(1, total - left)} of ${total}` : ''}${c.renewsNo ? ` · renews ${c.renewsNo}` : ''}</div></div>
      <div class="row"><button class="btn soft" id="wf">⇶ Workflow</button><a class="btn" href="#/contracts/${c.id}/print">⎙ Print contract</a>
        ${renewal ? html`<a class="btn" href="#/enquiries/${renewal.id}">Renewal ${renewal.no}</a>` : canRenew && (left <= 60 || c.status === 'Expired') ? html`<button class="btn" id="renew">⟳ Renew</button>` : ''}
        ${drafts.length && auth.can('invoice', 'edit') ? html`<button class="btn" id="postAll">Post ${drafts.length} due invoice${drafts.length > 1 ? 's' : ''}</button>` : ''}
        ${mayEdit && ['Draft', 'Active'].includes(c.status) ? html`<button class="btn" id="more">⋯</button>` : ''}
        ${edit ? html`<button class="btn primary" id="activate">Activate</button>` : ''}</div>
    </div>
    ${draft ? html`<div class="note" style="margin-bottom:10px">Draft from the accepted quotation. Check the start date; a signed copy is optional (flow step 6). "Activate" creates the ${c.sites.reduce((t, s) => t + s.visits, 0)} visits and the ${c.plan.length} billing line${c.plan.length > 1 ? 's' : ''} below.</div>` : ''}
    <div class="e2">
      <div class="props form-lines">
        <div class="form-sec">Contract</div>
        ${row('Contract No', c.no)}
        ${edit ? html`<div class="field"><label>Start date</label><input type="date" id="start" value="${c.start}"></div>` : row('Start date', fmtDate(c.start))}
        ${row('End date', html`<span id="endTxt">${fmtDate(c.end)}</span> · ${c.periodMonths} months`)}
        ${row('Quotation', html`<a href="#/quotations/${c.quotationId}">${c.quotationNo}</a>`)}
        ${row('Customer PO', c.po?.no ? html`${c.po.no}${c.po.date ? ` · ${fmtDate(c.po.date)}` : ''}${(c.po.attachments || []).map(a => html` · <a href="#" data-open="${a.id}">${a.name}</a>`)}` : vsLabel('ACCEPT_METHOD', c.po?.method))}
        ${row('Signed contract', c.signedDoc ? html`<a href="#" data-open="${c.signedDoc.id}">${c.signedDoc.name}</a>` : html`<span class="muted">Optional</span>${mayEdit && ['Draft', 'Active'].includes(c.status) ? html` · <label class="btn link small" style="padding:0">Upload<input type="file" id="signed" hidden></label>` : ''}`)}
        ${draft ? '' : row('Renewal reminder', c.renewal?.renewedById ? `Renewed by ${c.renewal.renewedByNo}` : renewal ? html`Renewal started: <a href="#/enquiries/${renewal.id}">${renewal.no}</a>` : `${fmtDate(c.renewal?.reminderDate)} (60 days before the end)`)}
        <div class="form-sec">Customer</div>
        ${row('Customer Name', c.customer)}${row('Contact Person', [c.contact, c.phone].filter(Boolean).join(' · '))}${row('Billing Address', c.billingAddress)}
        <div class="form-sec">Money</div>
        ${row('Contract value', m2(c.value))}${row(`${c.taxLabel} ${c.taxRate} %`, m2(c.tax))}${row('Total', html`<b>${m2(c.total)}</b>`)}
        ${row('Billing', `${vsLabel('BILLING', c.billing)}, in advance · ${c.plan.length} invoice${c.plan.length > 1 ? 's' : ''}`)}
        ${row('Payment Term', `${vsLabel('PAYMENT_TERMS', c.paymentTerm)}${c.paymentTerm !== 'IMMEDIATE' ? ' (approved at the counter-check)' : ''}`)}
      </div>
      <div class="e2-main"><div class="card">
        <div class="kpi k4">
          <div><b>${draft ? '—' : `${p.done} of ${p.visits}`}</b><span>Visits done${p.next && !draft ? ` · next ${fmtDate(visitDate(p.next))}` : ''}</span></div>
          <div><b>${draft ? '—' : `${p.posted} of ${p.lines}`}</b><span>Instalments posted${drafts.length ? ` · ${drafts.length} to post` : ''}</span></div>
          <div><b>${m2(p.paid)}</b><span>Paid${p.balance > 0.004 ? ` · balance ${m2(p.balance)}` : ''}</span></div>
          <div><b>${draft ? '—' : left >= 0 ? `${left} days` : 'Ended'}</b><span>${draft ? 'Starts after activation' : `Ends ${fmtDate(c.end)}`}</span></div></div>
        <div class="etabs" id="ctabs">${[['visits', `Visit plan (${draft ? c.sites.reduce((t, s) => t + s.visits, 0) : visits.length})`], ['billing', `Billing plan (${c.plan.length})`], ['sites', `Sites & shutters (${c.sites.length})`], ['history', 'History']]
          .map(([k, label]) => html`<button data-ct="${k}" class="${k === tab ? 'on' : ''}">${label}</button>`)}</div>
        <div id="ctab"></div>
      </div></div>
    </div>
  </div>`);

  const visitTab = () => {
    if (draft) {
      const rows = c.sites.flatMap(s => plannedDates(c.start, c.periodMonths, s.visits).map((d, k) => ({ s, k, d })));
      return html`<table class="tbl"><thead><tr><th>Visit</th><th>Site</th><th>Planned</th><th>Status</th></tr></thead><tbody>
        ${rows.map(r => html`<tr><td><b>${r.k + 1} of ${r.s.visits}</b></td><td>${r.s.name} <span class="zone-chip">${zoneLabel(r.s.zoneId).split(' ')[0]}</span></td><td>${fmtDate(r.d)}</td><td class="muted">after activation</td></tr>`)}</tbody></table>`;
    }
    const multi = c.sites.length > 1;
    return html`<table class="tbl"><thead><tr><th>Visit</th>${multi ? html`<th>Site</th>` : ''}<th>Planned</th><th>Status</th><th>Technician</th><th>Service report</th><th>Result</th></tr></thead><tbody>
      ${visits.map(v => html`<tr class="click" data-go="amc-visits/${v.id}"><td class="lnk">${v.n} of ${v.of}</td>${multi ? html`<td>${v.site}</td>` : ''}
        <td>${visitDate(v) !== v.plannedDate ? html`<b>${fmtDate(visitDate(v))}</b> <span class="muted small">(was ${fmtDate(v.plannedDate)})</span>` : fmtDate(v.plannedDate)}</td>
        <td>${visitPill(v)}</td><td>${v.technicianId ? empName(v.technicianId) : html`<span class="muted">—</span>`}</td><td>${v.signoff?.signedAt ? v.reportNo : html`<span class="muted">—</span>`}</td>
        <td>${v.signoff?.signedAt ? (v.failures?.length ? `${v.failures.length} failed item${v.failures.length > 1 ? 's' : ''}` : 'All pass') : ''}</td></tr>`)}</tbody></table>
      <p class="mini-note">Each visit covers all the covered shutters of its site. Dates are about two weeks into each period; book them on <a href="#/amc-scheduling">AMC Scheduling</a>.</p>`;
  };
  const billingTab = () => {
    const lines = draft ? billingLines(c, c.start) : c.billingPlan;
    return html`<table class="tbl"><thead><tr><th>Instalment</th><th>Period</th><th>Bill date</th><th class="num">Amount</th><th class="num">${c.taxLabel} ${c.taxRate} %</th><th class="num">Total</th><th>Invoice</th><th>Status</th></tr></thead><tbody>
      ${lines.map(l => { const inv = l.invoiceId ? store.get('invoices', l.invoiceId) : null; const ps = inv ? paymentStatus(inv) : '';
        return html`<tr><td><b>${l.n} of ${l.of}</b></td><td>${fmtDate(l.from)} – ${fmtDate(l.to)}</td><td>${fmtDate(l.billDate)}</td><td class="num">${m2(l.amount)}</td><td class="num">${m2(l.tax)}</td><td class="num">${m2(l.total)}</td>
          <td>${inv ? html`<a href="#/invoices/${inv.id}">${inv.no || 'Draft'}</a>` : html`<span class="muted">—</span>`}</td>
          <td>${draft ? html`<span class="muted">after activation</span>` : l.status === 'Cancelled' ? pill('Cancelled') : !inv ? pill('Scheduled', '') : inv.status === 'Draft' ? html`${pill('To post', 'amber')}${auth.can('invoice', 'edit') ? html` <button class="btn small primary" data-post="${inv.id}">Post</button>` : ''}`
            : ps === 'PAID' ? pill('Paid', 'green') : pill(`${ps === 'PARTLY' ? 'Part paid' : 'Posted'} · balance ${m2(balanceOf(inv))}`, 'blue')}</td></tr>`; })}
      <tr class="sum"><td></td><td><b>TOTAL</b></td><td></td><td class="num"><b>${m2(c.value)}</b></td><td class="num"><b>${m2(c.tax)}</b></td><td class="num"><b>${m2(c.total)}</b></td><td></td><td></td></tr></tbody></table>
      <p class="mini-note">Invoices come only from this plan; visits never raise invoices. Each line's draft appears by itself on its bill date. The left-over cents sit on the last instalment.</p>`;
  };
  const sitesTab = () => html`${c.sites.map(s => html`<div class="row" style="margin:6px 0"><b>${s.name}</b> <span class="zone-chip">${zoneLabel(s.zoneId).split(' ')[0]}</span> ${zoneLabel(s.zoneId).split(' · ')[1] || ''} · ${s.visits} visit${s.visits > 1 ? 's' : ''} a year · ${fmtNum(s.teamHrs)} team-hours (${s.days} day${s.days > 1 ? 's' : ''})${s.access ? html` · <span class="muted">${s.access}</span>` : ''}</div>
    ${s.typed ? html`<div class="note small">Counts typed from the BOQ (${Object.entries(s.counts || {}).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}). "Activate" adds them to the shutter register.</div>`
      : html`<table class="tbl"><thead><tr><th>Tag</th><th>Location</th><th>Type</th><th>Size</th><th>Fire-rated</th><th>Last visit</th></tr></thead><tbody>${s.shutters.map(sh => {
        const last = visits.filter(v => v.siteKey === s.key && v.signoff?.signedAt).sort((a, b) => b.n - a.n)[0];
        const st = last?.checklist?.[sh.shutterId];
        const fails = st ? Object.entries(st.items || {}).filter(([, x]) => x.r === 'F').length : 0;
        return html`<tr><td><b>${sh.tag}</b></td><td>${sh.location}</td><td>${sh.typeName}</td><td>${sh.sizeCode}</td><td>${sh.fireRated ? 'Yes' : 'No'}</td>
          <td>${last ? html`${fails ? pill(`${fails} fail`, 'red') : pill('Pass', 'green')} <span class="muted small">visit ${last.n}</span>` : html`<span class="muted">—</span>`}</td></tr>`; })}</tbody></table>`}`)}`;
  const paintTab = () => { $('#ctab', el).innerHTML = String(tab === 'billing' ? billingTab() : tab === 'sites' ? sitesTab() : tab === 'history' ? activityHtml(c, 'contracts') : visitTab()); };

  on(el, 'click', '[data-ct]', (e, b) => { tab = b.dataset.ct; sessionStorage.setItem(TAB_KEY, tab); el.querySelectorAll('[data-ct]').forEach(x => x.classList.toggle('on', x === b)); paintTab(); });
  on(el, 'click', '[data-go]', (e, tr) => go(tr.dataset.go));
  on(el, 'click', '[data-post]', (e, b) => { const inv = postInvoice(b.dataset.post); toast(`Posted as ${inv.no}`); render(); });
  on(el, 'click', '[data-open]', async (e, a) => { e.preventDefault(); const u = await getUrl(a.dataset.open); if (u) window.open(u, '_blank'); });
  $('#wf', el).onclick = () => openWorkflow(enq);
  $('#start', el)?.addEventListener('change', e => { const n = saveContract(c.id, { start: e.target.value }); $('#endTxt', el).textContent = fmtDate(n.end); paintTab(); });
  $('#signed', el)?.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; const doc = await saveBlob(f, { name: f.name, kind: 'contract' }); store.update('contracts', c.id, { signedDoc: doc }, `Signed contract uploaded: ${f.name}`); render(); });
  $('#postAll', el)?.addEventListener('click', async () => { if (!await confirmBox('Post the due invoices', `${drafts.length} draft instalment invoice(s) get their numbers now.`, 'Post')) return; const done = postContractDrafts(c.id); toast(`Posted ${done.map(i => i.no).join(', ')}`); render(); });
  $('#activate', el)?.addEventListener('click', () => {
    const problems = activateProblems(store.get('contracts', c.id));
    if (problems.length) { toast(problems[0], 'bad'); return; }
    const cur = store.get('contracts', c.id);
    openModal({
      title: `Activate ${c.no}`, body: html`<p>From <b>${fmtDate(cur.start)}</b> to <b>${fmtDate(cur.end)}</b>: ${cur.sites.reduce((t, s) => t + s.visits, 0)} visits are planned and ${cur.plan.length} billing line${cur.plan.length > 1 ? 's are' : ' is'} created.${cur.start <= new Date().toISOString().slice(0, 10) ? ' The first invoice is drafted now.' : ''}</p>
        ${cur.sites.some(s => s.typed) ? html`<p class="small">The typed shutter counts are added to the shutter register (location "to confirm").</p>` : ''}`,
      actions: [{ label: 'Cancel' }, { label: 'Activate', kind: 'primary', onClick: () => { const err = activateContract(c.id); if (err.length) { toast(err[0], 'bad'); return false; } toast(`${c.no} is active`); render(); } }],
    });
  });
  $('#renew', el)?.addEventListener('click', async () => {
    if (!await confirmBox(`Renew ${c.no}`, 'A renewal enquiry is created with an estimate pre-filled from this contract (same sites, shutters and visits, today’s rates). It then goes to the quotation and the counter-check as usual.', 'Renew')) return;
    const r = renewContract(c.id); toast(`${r.enquiry.no} and ${r.estimate.no} created`); go(`estimates/${r.estimate.id}`);
  });
  $('#more', el)?.addEventListener('click', e => popMenu(e.currentTarget, [{ label: draft ? 'Cancel the contract' : 'Terminate the contract', onClick: () => openModal({
    title: `${draft ? 'Cancel' : 'Terminate'} ${c.no}`, body: html`<div class="form-lines"><div class="field"><label>Reason</label><input type="text" name="reason"></div>
      <p class="small" style="margin-top:8px">${draft ? 'The enquiry is marked lost.' : 'Visits not started and billing lines not yet invoiced are cancelled; invoices already raised stay.'}</p></div>`,
    actions: [{ label: 'Keep it' }, { label: draft ? 'Cancel contract' : 'Terminate', kind: 'danger', onClick: b => { cancelContract(c.id, readForm(b).reason || 'Cancelled'); render(); } }],
  }) }]));
  paintTab();
}
