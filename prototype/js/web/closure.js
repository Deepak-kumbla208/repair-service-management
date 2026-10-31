// Job Closure: the list of finished jobs, and the review page with every linked document ticked and an
// estimated-vs-actual summary. "Completed & documented" is flow step 9; "Closed" follows by itself when the
// invoice is fully paid (step 12).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, fmtDateTime, fmtNum, pill, toast, openModal } from '../core/ui.js';
import { empName } from '../core/lookups.js';
import { checklist, estimatedVsActual, markDocumented, docInvoice } from '../core/closure.js';
import { balanceOf } from '../core/billing.js';
import { renderDocList } from './doc-list.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';

const m2 = n => (n == null ? '—' : Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const DONE = ['Work done', 'Completed & documented', 'Closed'];

export function renderClosureList(el) {
  renderDocList(el, {
    key: 'rsmClosure', crumb: 'Transactions › Job Closure', title: 'Job closure', sub: 'Check the documents of finished jobs; a documented job closes itself when its invoice is fully paid.',
    placeholder: 'Search: job no, customer, site, invoice',
    rows: () => store.list('jobs', j => DONE.includes(j.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    tiles: [
      { key: 'todo', label: 'To review', test: j => j.status === 'Work done', tone: 'warn', sub: 'work done, not documented' },
      { key: 'wait', label: 'Documented, waiting for payment', test: j => j.status === 'Completed & documented' },
      { key: 'closed', label: 'Closed', test: j => j.status === 'Closed' },
    ],
    columns: [['Job No', j => j.no], ['Customer', j => j.customer], ['Site', j => j.site], ['Technician', j => empName(j.technicianId)],
      ['Work done', j => fmtDateTime(j.workDone?.signedAt)], ['Invoice', j => docInvoice(j)?.no || 'Draft'], ['Balance', j => { const i = docInvoice(j); return i?.status === 'Posted' ? m2(balanceOf(i)) : ''; }, 'num'], ['Status', j => pill(j.status)]],
    search: j => [j.no, j.customer, j.site, docInvoice(j)?.no], route: j => `closure/${j.id}`, empty: 'Jobs appear here once the Work Done form is signed.',
  });
}

export function renderClosure(el, id) {
  const j = store.get('jobs', id);
  if (!j) { el.innerHTML = '<div class="page"><div class="empty">Job not found.</div></div>'; return; }
  const items = checklist(j);
  const ev = estimatedVsActual(j);
  const inv = docInvoice(j);
  const canMark = j.status === 'Work done' && auth.can('closure', 'edit');
  el.innerHTML = String(html`<div class="page" style="max-width:1200px">
    ${pageHead({ crumb: html`<a href="#/closure">Job Closure</a> › ${j.no}`, title: html`${j.no} · ${j.customer} ${pill(j.status)}`,
      sub: j.status === 'Closed' ? `Closed ${fmtDateTime(j.closedAt)}: all work completed, paid and filed.` : j.status === 'Completed & documented' ? `Documented ${fmtDateTime(j.documentedAt)}. It closes by itself when ${inv?.no || 'the invoice'} is fully paid.` : 'Check the documents, then mark the job completed and documented.',
      actions: html`<div class="row"><a class="btn" href="#/jobs/${j.id}">Open the job</a>${canMark ? html`<button class="btn primary" id="mark">✓ Completed &amp; documented</button>` : ''}</div>` })}
    <div class="cols2">
      <div class="card"><div class="card-head"><h2>Documents</h2><span class="muted small">${items.filter(i => i.ok).length} of ${items.length}</span></div>
        <ul class="chk">${items.map(i => html`<li><span class="${i.ok ? 'ok' : 'wn'}" style="${!i.ok && i.optional ? 'color:var(--faint)' : ''}">${i.ok ? '✓' : i.optional ? '○' : '!'}</span>
          <span class="grow">${i.route && i.ok ? html`<a href="#/${i.route}">${i.label}</a>` : i.label}${i.optional && !i.ok ? html` <span class="muted small">(not needed to document)</span>` : ''}</span><span class="muted small">${i.doc}</span></li>`)}</ul></div>
      <div class="card"><div class="card-head"><h2>Estimated vs actual</h2><span class="muted small">crew of ${ev?.persons || 2}</span></div>
        ${ev ? html`<table class="tbl cost-tbl"><thead><tr><th></th><th class="num">Estimated</th><th class="num">Actual</th></tr></thead><tbody>
          ${ev.rows.map(r => html`<tr class="${r.strong ? 'sum' : ''}"><td>${r.label}</td><td class="num">${r.hours ? `${fmtNum(r.est)} h` : m2(r.est)}</td><td class="num">${r.act == null ? '—' : r.hours ? `${fmtNum(r.act)} h` : m2(r.act)}</td></tr>`)}
        </tbody></table><p class="mini-note">Actual hours = check-in to check-out on the phone. Parts = the parts the technician marked as used.</p>` : html`<div class="muted">No estimate linked.</div>`}</div>
    </div>
  </div>`);
  $('#mark', el)?.addEventListener('click', () => {
    const problems = markDocumented(j.id);
    if (problems.length) { openModal({ title: 'Not ready to document', body: html`<ul>${problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] }); return; }
    const now = store.get('jobs', j.id);
    toast(now.status === 'Closed' ? `${j.no} documented and closed (paid in full)` : `${j.no} documented; it closes when the invoice is paid`);
    render();
  });
}
