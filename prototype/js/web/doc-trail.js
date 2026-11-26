// Under the title of every document of a job: the STEP BAR (UX audit, finding 2). One box per step of the job, the
// same steps as the Workflow popup, always in sight: a finished box opens its document, the current box holds the
// next-step button. Documents the bar has no box for (the visit a repair came from, more invoices, receipts) follow
// on one "Also linked" line. Every document page already calls trailHtml(), so they all get the bar.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, go, toast } from '../core/ui.js';
import { heldNote } from '../core/offline.js';
import { stagesFor, stageLabel, stageStatus } from '../core/flow.js';
import { canCreateFor, createEstimate } from '../core/estimates.js';

// The menu a document's page belongs to: a role that cannot open it sees plain text, not a link.
const MENU_OF = { enquiries: 'enquiry', assessments: 'inspection', reports: 'inspection', estimates: 'estimation', quotations: 'quotation', jobs: 'job', contracts: 'amcContract', invoices: 'invoice', closure: 'closure', 'amc-visits': 'amcExecution', 'amc-scheduling': 'amcScheduling' };
const opens = route => auth.can(MENU_OF[route.split('/')[0]] || '', 'view', 'web');

export function stepBar(enq, currentId = '') {
  const steps = stagesFor(enq);
  return html`<nav class="stepbar" aria-label="Steps of this job" data-enq="${enq.id}">${steps.map((s, i) => {
    const here = !!currentId && !!s.route && (s.route.endsWith(`/${currentId}`) || (s.key === 'closure' && currentId.startsWith('closure_')));
    const link = s.route && s.state !== 'next' && opens(s.route);
    const make = s.state === 'now' && s.key === 'estimation' && canCreateFor(enq) && auth.can('estimation', 'create') ? 'estimate' : '';
    return html`<div class="sb ${s.state} ${here ? 'here' : ''}" ${s.state === 'now' ? 'aria-current="step"' : ''}>
      <div class="sb-top"><span class="sb-n">${s.state === 'done' ? '✓' : s.state === 'skip' ? '–' : i + 1}</span><b>${stageLabel(s)}</b></div>
      ${s.doc ? html`<div class="sb-doc">${link && !here ? html`<a href="#/${s.route}">${s.doc}</a>` : s.doc}</div>` : ''}
      ${s.status ? html`<div class="sb-st">${stageStatus(s)}</div>` : ''}
      ${s.state === 'now' ? html`<div class="sb-next" data-sb-next data-here="${here ? 1 : 0}" data-route="${link ? s.route : ''}" data-make="${make}" data-enq="${enq.id}" data-doc="${s.doc && !/^(Technician|Not assigned|Paid|Not paid)/.test(s.doc) ? s.doc : stageLabel(s)}"></div>` : ''}
    </div>`;
  })}</nav>`;
}

// The current box gets its button once the page is drawn: on the page of that step it repeats the page's own main
// button (one click does the step); on any other page it opens the document where the step is done. "Create
// estimate" works from anywhere. Called by the web shell after every draw.
export function wireStepBars(root) {
  root.querySelectorAll('[data-sb-next]:not([data-wired])').forEach(box => {
    box.dataset.wired = '1';
    const mk = (label, onClick, title = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary small'; b.textContent = label; if (title) b.title = title; b.onclick = onClick; box.appendChild(b); };
    if (box.dataset.make === 'estimate') return mk('Create estimate', () => { const x = createEstimate(box.dataset.enq); toast(`${x.no} created from the site report`); go(`estimates/${x.id}`); }, 'Makes the estimate, pre-filled from the site report');
    if (box.dataset.here === '1') {
      const scope = box.closest('.job-sec, .page');
      const main = [...(scope?.querySelectorAll('.page-head .btn.primary') || [])].find(b => !b.disabled && !b.closest('.stepbar'));
      if (main) mk(main.textContent.trim(), () => main.click());
      return;
    }
    if (box.dataset.route) mk(`Open ${box.dataset.doc}`, () => go(box.dataset.route));
  });
}

const latest = (coll, enqId) => {
  const all = store.list(coll, r => r.enquiryId === enqId).sort((a, b) => (b.rev || 0) - (a.rev || 0));
  return all.find(r => r.status !== 'Superseded') || all[0] || null;
};

// The step bar, then the documents it has no box for.
export function trailHtml(enqId, currentId = '') {
  const enq = store.get('enquiries', enqId);
  if (!enq) return '';
  const items = [];
  const add = (label, route, id) => items.push({ label, route, id });
  if (enq.fromService) add(`From ${enq.fromService.no}`, enq.fromService.coll === 'jobs' ? `jobs/${enq.fromService.id}` : `amc-visits/${enq.fromService.id}`, enq.fromService.id);
  if (enq.laterOf) { const first = store.get('enquiries', enq.laterOf); if (first) add(`Later items of ${first.no}`, `enquiries/${first.id}`, first.id); }
  const job = store.list('jobs', j => j.enquiryId === enq.id).sort((a, b) => (a.status === 'Cancelled') - (b.status === 'Cancelled'))[0];
  const contract = store.list('contracts', c => c.enquiryId === enq.id).sort((a, b) => (a.status === 'Cancelled') - (b.status === 'Cancelled'))[0];
  const est = latest('estimates', enq.id), q = latest('quotations', enq.id);
  // Earlier revisions are one click away.
  if (est && est.rev > 1) add(`${est.rev - 1} earlier estimate revision${est.rev > 2 ? 's' : ''}`, `estimates/${est.id}`, '');
  if (q && q.rev > 1) add(`${q.rev - 1} earlier quotation revision${q.rev > 2 ? 's' : ''}`, `quotations/${q.id}`, '');
  const invoices = store.list('invoices', i => i.enquiryId === enq.id && i.status !== 'Cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (invoices.length > 1 || contract) {
    const shown = invoices.length > 3 ? invoices.slice(-2) : invoices;
    if (invoices.length > shown.length) add(`${invoices.length - shown.length} earlier invoices`, `contracts/${contract?.id}`, '');
    shown.forEach(i => add(i.no || 'Draft invoice', `invoices/${i.id}`, i.id));
  }
  const receipts = store.list('payments', p => invoices.some(i => i.id === p.invoiceId)).sort((a, b) => a.date.localeCompare(b.date));
  receipts.slice(-3).forEach(p => add(`Receipt ${p.no}`, `invoices/${p.invoiceId}`, p.id));
  const note = heldNote([['enquiries', enq.id], ['inspections', enq.inspectionId], ...(job ? [['jobs', job.id]] : []),
    ...(contract ? store.list('amcVisits', v => v.contractId === contract.id).map(v => ['amcVisits', v.id]) : [])]);
  return html`${note ? html`<div class="note warn small" style="margin-bottom:8px">${note}</div>` : ''}${stepBar(enq, currentId)}
    ${items.length ? html`<div class="trail"><span class="muted">Also linked</span>${items.map((it, i) => html`${i ? html`<span class="sep">·</span>` : ''}${it.id && it.id === currentId
      ? html`<b>${it.label}</b>` : opens(it.route) ? html`<a href="#/${it.route}">${it.label}</a>` : html`<span class="plain" title="Your role cannot open this document">${it.label}</span>`}`)}</div>` : ''}`;
}
