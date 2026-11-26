// One page per job (UX audit, finding 1; working style "One page per job", Company Setup). The enquiry page becomes the
// home of the job: the step bar on top, then every document of the job as a section of this one page, in the order of
// the flow: enquiry, job assessment and report, estimate, quotation, job (or maintenance contract), invoice and
// payment, closure. The section of the current step is open; the others show one summary line and open on a click.
// Each section draws the document's own page inside it, so nothing is built twice and every button works as on the
// separate page. The menus stay as lists ("all quotations"); a row there opens this page at that document.
// Switched off, every document opens on its own page as before.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, raw, pill, fmtDateTime } from '../core/ui.js';
import { vsLabel } from '../core/lookups.js';
import { stagesFor, stageLabel, stageStatus } from '../core/flow.js';
import { currentEstimate } from '../core/estimates.js';
import { currentQuotation } from '../core/quotations.js';
import { openLater } from '../core/later-work.js';
import { stepBar } from './doc-trail.js';
import { renderEnquiryView, openWorkflow, channelText } from './enquiry-view.js';
import { renderInspection } from './site-inspection.js';
import { renderReport } from './report-view.js';
import { renderEstimate } from './estimate-form.js';
import { renderQuotation } from './quotation-view.js';
import { renderJob } from './job-view.js';
import { renderInvoice } from './invoices.js';
import { renderClosure } from './closure.js';
import { renderContract } from './contracts.js';

// The menu right a section needs, and what draws it. Each returns false when there is nothing to draw yet.
const jobOf = enq => store.list('jobs', j => j.enquiryId === enq.id).sort((a, b) => (a.status === 'Cancelled') - (b.status === 'Cancelled'))[0] || null;
const contractOf = enq => store.list('contracts', c => c.enquiryId === enq.id).sort((a, b) => (a.status === 'Cancelled') - (b.status === 'Cancelled'))[0] || null;
const SECTIONS = {
  enquiry: { menu: 'enquiry', title: 'Enquiry', id: e => e.id, draw: (el, e) => renderEnquiryView(el, e.id) },
  inspection: { menu: 'inspection', title: 'Job assessment and report',
    id: e => { const i = e.inspectionId ? store.get('inspections', e.inspectionId) : null; return i && i.status !== 'Cancelled' ? (i.reportId || i.id) : ''; },
    draw: (el, e) => { const i = store.get('inspections', e.inspectionId); return i.reportId ? renderReport(el, i.reportId) : renderInspection(el, i.id); } },
  estimation: { menu: 'estimation', title: 'Estimate', id: e => currentEstimate(e.id)?.id || '', draw: (el, e) => renderEstimate(el, currentEstimate(e.id).id) },
  quotation: { menu: 'quotation', title: 'Quotation', id: e => currentQuotation(e.id)?.id || '', draw: (el, e) => renderQuotation(el, currentQuotation(e.id).id) },
  job: { menu: 'job', title: 'Job', id: e => jobOf(e)?.id || '', draw: (el, e) => renderJob(el, jobOf(e).id) },
  amcContract: { menu: 'amcContract', title: 'Maintenance contract', id: e => contractOf(e)?.id || '', draw: (el, e) => renderContract(el, contractOf(e).id) },
  invoice: { menu: 'invoice', title: 'Invoice and payment', id: e => { const j = jobOf(e); return (j?.invoiceId && store.get('invoices', j.invoiceId)?.id) || ''; }, draw: (el, e) => renderInvoice(el, jobOf(e).invoiceId) },
  closure: { menu: 'closure', title: 'Job closure', id: e => { const j = jobOf(e); return j && (j.workDone?.signedAt || ['Completed & documented', 'Closed'].includes(j.status)) ? j.id : ''; }, draw: (el, e) => renderClosure(el, jobOf(e).id) },
};
const ORDER = ['enquiry', 'inspection', 'estimation', 'quotation', 'job', 'amcContract', 'invoice', 'closure'];
// The stage of the flow a section belongs to (payment sits with the invoice, visits and contract closure with the contract).
const STAGE_OF = { payment: 'invoice', amcVisits: 'amcContract', contractClosure: 'amcContract' };

function sectionsOf(enq) {
  const stages = stagesFor(enq);
  return ORDER.filter(k => (enq.type === 'AMC' ? !['job', 'closure', 'invoice'].includes(k) : k !== 'amcContract')).map(key => {
    const def = SECTIONS[key];
    const docId = auth.can(def.menu, 'view', 'web') ? def.id(enq) : '';
    const st = stages.filter(s => (STAGE_OF[s.key] || s.key) === key);
    const main = st.find(s => s.state === 'now') || st[0];
    return { key, def, docId, state: st.some(s => s.state === 'now') ? 'now' : main?.state || 'next',
      summary: st.map(s => [s.doc, stageStatus(s)].filter(Boolean).join(' · ')).filter(Boolean).join('  |  ') };
  }).filter(s => s.docId);
}
const titleHtml = e => html`${e.no} · ${e.customerName} ${pill(e.status)}${openLater(e) ? html` ${pill(`${e.laterWork.items.length} item${e.laterWork.items.length > 1 ? 's' : ''} later`, 'amber')}` : ''}`;
const summaryHtml = s => html`<span class="fold-t">${s.def.title}</span>${s.state === 'now' ? html`<span class="new-dot">Now</span>` : s.state === 'done' ? html`<span class="js-ok">✓</span>` : ''}<span class="fold-s">${s.summary}</span>`;

export function renderJobPage(el, id, at = '') {
  const e = store.get('enquiries', id);
  if (!e) { el.innerHTML = '<div class="page"><div class="empty">Enquiry not found.</div></div>'; return; }
  const secs = sectionsOf(e);
  if (at === 'assessment') at = 'inspection';   // the address says assessment; the section keeps its code name
  const want = STAGE_OF[at] || at;
  const now = secs.find(s => s.key === want) || [...secs].reverse().find(s => s.state === 'now') || secs[secs.length - 1];
  el.innerHTML = String(html`<div class="page jobpage" data-enq="${e.id}">
    <div class="page-head"><div class="grow">
      <div class="crumb"><a href="#/enquiries">Sales Enquiry</a> › ${e.no}</div>
      <h1 id="jpTitle">${titleHtml(e)}</h1>
      <div class="page-meta">${vsLabel('ENQ_TYPE', e.type)} · ${e.siteName} · received ${fmtDateTime(e.receivedAt)} by ${channelText(e)} · every document of this job is a section of this page</div></div>
      <div class="row"><button class="btn" id="jpWf" title="The map of the whole job as a pop-up">Workflow</button>
        ${auth.can('enquiry', 'edit') && e.status !== 'Cancelled' ? html`<a class="btn" href="#/enquiries/${e.id}/edit">Edit enquiry</a>` : ''}</div>
    </div>
    <div id="jpBar">${stepBar(e, now?.docId || e.id)}</div>
    <div class="stack" id="jpSecs">${secs.map(s => html`<details class="card fold job-sec" data-key="${s.key}" ${s.key === now?.key ? raw('open') : ''}><summary>${summaryHtml(s)}</summary><div class="js-body"></div></details>`)}</div>
  </div>`);
  el.querySelector('#jpWf').onclick = () => openWorkflow(e);
  const draw = d => {
    const body = d.querySelector('.js-body');
    if (body.dataset.drawn) return;
    body.dataset.drawn = '1';
    const s = secs.find(x => x.key === d.dataset.key);
    try { s.def.draw(body, store.get('enquiries', id)); } catch (err) { body.innerHTML = `<div class="note bad">This section could not be shown: ${String(err.message).replace(/</g, '&lt;')}</div>`; console.error(err); }
  };
  el.querySelectorAll('.job-sec').forEach(d => {
    if (d.open) draw(d);
    d.addEventListener('toggle', () => { if (d.open) draw(d); });
  });
  // A click on a box of the step bar opens (and scrolls to) its section instead of leaving the page.
  el.querySelector('#jpBar').addEventListener('click', ev => {
    const a = ev.target.closest('.sb a');
    if (!a) return;
    const key = routeSection(a.getAttribute('href').replace(/^#\//, ''));
    const d = key && el.querySelector(`.job-sec[data-key="${key}"]`);
    if (!d) return;
    ev.preventDefault();
    d.open = true; draw(d);
    d.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  if (at) el.querySelector(`.job-sec[data-key="${now?.key}"]`)?.scrollIntoView({ block: 'start' });
  wireJobBar(el);
}

// The next-step button of the bar repeats the main button of the section where the step is done.
function wireJobBar(root) {
  const box = root.querySelector('#jpBar [data-sb-next]');
  if (!box) return;
  box.dataset.wired = '1';
  box.innerHTML = '';
  const page = root.querySelector('.jobpage') || root;
  const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary small'; b.textContent = label; b.onclick = fn; box.appendChild(b); };
  if (box.dataset.make === 'estimate') {
    return mk('Create estimate', async () => { const E = await import('../core/estimates.js'); const x = E.createEstimate(box.dataset.enq); location.hash = `#/estimates/${x.id}`; });
  }
  const now = page.querySelector('#jpBar .sb.now');
  const key = now ? [...page.querySelectorAll('#jpBar .sb')].indexOf(now) : -1;
  const stage = key >= 0 ? stagesFor(store.get('enquiries', page.dataset.enq))[key] : null;
  const sec = stage && page.querySelector(`.job-sec[data-key="${STAGE_OF[stage.key] || stage.key}"]`);
  if (!sec) return;
  const main = [...sec.querySelectorAll('.js-body .page-head .btn.primary')].find(b => !b.disabled);
  if (main) mk(main.textContent.trim(), () => { sec.open = true; main.click(); });
  else if (!sec.open) mk(`Open ${sec.querySelector('.fold-t').textContent.toLowerCase()}`, () => { sec.open = true; sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
}

// After a section redraws itself (a quotation was submitted, a job scheduled …) the bar and the summary lines follow.
// Called by the web shell after every change inside the page.
export function refreshJobPage(root) {
  const page = root.querySelector('.jobpage');
  if (!page) return;
  const e = store.get('enquiries', page.dataset.enq);
  if (!e) return;
  const secs = sectionsOf(e);
  const open = [...page.querySelectorAll('.job-sec[open]')].map(d => d.dataset.key);
  const cur = secs.find(s => s.state === 'now' && open.includes(s.key)) || secs.find(s => open.includes(s.key));
  const bar = String(stepBar(e, cur?.docId || e.id));
  const title = page.querySelector('#jpTitle'), th = String(titleHtml(e));
  if (title && title.dataset.html !== th) { title.dataset.html = th; title.innerHTML = th; }
  const holder = page.querySelector('#jpBar');
  if (holder.dataset.html !== bar) { holder.dataset.html = bar; holder.innerHTML = bar; }
  secs.forEach(s => { const sum = page.querySelector(`.job-sec[data-key="${s.key}"] > summary`); const h = String(summaryHtml(s)); if (sum && sum.dataset.html !== h) { sum.dataset.html = h; sum.innerHTML = h; } });
  // A document made just now (the estimate, the quotation, the job) has no section yet: draw the page again.
  if (secs.some(s => !page.querySelector(`.job-sec[data-key="${s.key}"]`))) return renderJobPage(root, e.id, secs.find(s => s.state === 'now')?.key || '');
  wireJobBar(root);
}

// Which section of the job page a document route belongs to.
function routeSection(route) {
  const a = route.split('/')[0];
  return { enquiries: 'enquiry', assessments: 'inspection', reports: 'inspection', estimates: 'estimation', quotations: 'quotation', jobs: 'job', invoices: 'invoice', closure: 'closure', contracts: 'amcContract' }[a] || '';
}
// With "One page per job" on, a document's own address opens the job page at that document. Only the current
// document of the job goes there: an earlier revision keeps its own page. Returns '' when the route stays as it is.
export function jobPageRoute(route) {
  const m = route.match(/^(assessments|reports|estimates|quotations|jobs|invoices|closure|contracts)\/([^/]+)$/);
  if (!m || m[2] === 'list' || m[2] === 'new') return '';
  const [, kind, id] = m;
  const to = (enqId, sec) => (enqId && store.get('enquiries', enqId) ? `enquiries/${enqId}/at/${sec}` : '');
  if (kind === 'assessments') return to(store.get('inspections', id)?.enquiryId, 'assessment');
  if (kind === 'reports') return to(store.get('siteReports', id)?.enquiryId, 'assessment');
  if (kind === 'estimates') { const x = store.get('estimates', id); return x && currentEstimate(x.enquiryId)?.id === id ? to(x.enquiryId, 'estimation') : ''; }
  if (kind === 'quotations') { const x = store.get('quotations', id); return x && currentQuotation(x.enquiryId)?.id === id ? to(x.enquiryId, 'quotation') : ''; }
  if (kind === 'jobs' || kind === 'closure') { const x = store.get('jobs', id); return x && jobOf({ id: x.enquiryId })?.id === id ? to(x.enquiryId, kind === 'jobs' ? 'job' : 'closure') : ''; }
  if (kind === 'invoices') { const x = store.get('invoices', id); const j = x?.jobId ? store.get('jobs', x.jobId) : null; return j && j.invoiceId === id ? to(j.enquiryId, 'invoice') : ''; }
  if (kind === 'contracts') { const x = store.get('contracts', id); return x && contractOf({ id: x.enquiryId })?.id === id ? to(x.enquiryId, 'amcContract') : ''; }
  return '';
}
