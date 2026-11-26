// Start-up and screen routing. One app, two views (web / mobile), never shown together:
// web routes look like #/enquiries, phone routes like #/m/jobs.
import * as store from './core/store.js';
import * as auth from './core/auth.js';
import { clearAllMedia } from './core/media.js';
import { buildSeed } from './data/seed.js';
import { buildDemoFlow } from './data/seed-demo-flow.js';
import { renderLogin } from './web/login.js';
import { renderWebShell, renderNoAccess } from './web/shell.js';
import { renderPhone } from './mobile/shell.js';
import { openPalette } from './web/palette.js';
import { renderHome } from './web/home.js';
import { renderEnquiryList } from './web/enquiry-list.js';
import { renderEnquiryForm } from './web/enquiry-form.js';
import { renderEnquiryView } from './web/enquiry-view.js';
import { renderInspectionList, renderInspection } from './web/site-inspection.js';
import { renderReport } from './web/report-view.js';
import { renderPrintSvr } from './web/print-svr.js';
import { renderMasterList, renderMasterForm } from './web/master-engine.js';
import { renderAdmin, renderSoon } from './web/admin.js';
import { renderEstimateList, renderQuotationList } from './web/lists.js';
import { renderEstimate } from './web/estimate-form.js';
import { renderQuotation } from './web/quotation-view.js';
import { renderTasks } from './web/tasks.js';
import { renderJobBoard } from './web/job-board.js';
import { renderJob, renderJobList } from './web/job-view.js';
import { renderInvoiceList, renderInvoice } from './web/invoices.js';
import { renderPayments } from './web/payments.js';
import { renderClosureList, renderClosure } from './web/closure.js';
import { renderPrintDoc } from './web/print-docs.js';
import { renderContractList, renderContract } from './web/contracts.js';
import { renderAmcScheduling } from './web/amc-scheduling.js';
import { renderVisitList, renderVisit } from './web/visits.js';
import { refreshAmc } from './core/contracts.js';
import { refreshLaterWork } from './core/later-work.js';
import { isOffline } from './core/offline.js';
import { upgradeMarkupRights } from './core/setup.js';
import { upgradeProducts } from './core/upgrade-products.js';
import { drawGuideBar } from './web/guide.js';
import { isDirty, dirtyAt, clearDirty, ux, buildingSamples } from './core/ux.js';
import { renderJobPage, jobPageRoute } from './web/job-page.js';
import { openModal, html, fieldError } from './core/ui.js';
import { mRepairJob, mRepairStep } from './mobile/repair-job.js';
import { mService, mServiceStep, mShutter } from './mobile/service.js';
import { mTasks, mTask } from './mobile/tasks.js';
import { mHome, mMore, mSoon } from './mobile/home.js';
import { mJobs, mJob } from './mobile/jobs.js';
import { mReport, mReportView } from './mobile/site-report.js';
import { mEnquiries, mEnquiry } from './mobile/enquiries.js';
import { mEnquiryForm } from './mobile/enquiry-form.js';
import { mCustomers, mCustomer, mCustomerForm } from './mobile/customers.js';

const app = document.getElementById('app');

// [pattern, menu key needed (web view), page]
const WEB = [
  [/^home$/, null, renderHome],
  [/^enquiries$/, 'enquiry', renderEnquiryList],
  [/^enquiries\/new$/, 'enquiry', el => renderEnquiryForm(el, null)],
  [/^enquiries\/([^/]+)\/edit$/, 'enquiry', renderEnquiryForm],
  // Working style "One page per job" (Company Setup): the enquiry page holds every document of the job as a section.
  [/^enquiries\/([^/]+)(?:\/at\/(\w+))?$/, 'enquiry', (el, id, at) => (ux().jobPage ? renderJobPage(el, id, at) : renderEnquiryView(el, id))],
  [/^assessments$/, 'inspection', renderInspectionList],
  [/^assessments\/([^/]+)$/, 'inspection', renderInspection],
  [/^reports\/([^/]+)$/, 'inspection', renderReport],
  [/^estimates$/, 'estimation', renderEstimateList],
  [/^estimates\/([^/]+)$/, 'estimation', renderEstimate],
  [/^quotations$/, 'quotation', renderQuotationList],
  [/^quotations\/([^/]+)$/, 'quotation', renderQuotation],
  [/^tasks$/, null, el => renderTasks(el)],
  [/^tasks\/([^/]+)$/, null, renderTasks],
  [/^jobs$/, 'job', renderJobBoard],
  [/^jobs\/list$/, 'job', renderJobList],
  [/^jobs\/([^/]+)$/, 'job', renderJob],
  [/^invoices$/, 'invoice', renderInvoiceList],
  [/^invoices\/([^/]+)$/, 'invoice', renderInvoice],
  [/^payments$/, 'payment', renderPayments],
  [/^closure$/, 'closure', renderClosureList],
  [/^closure\/([^/]+)$/, 'closure', renderClosure],
  [/^contracts$/, 'amcContract', renderContractList],
  [/^contracts\/([^/]+)$/, 'amcContract', renderContract],
  [/^amc-scheduling$/, 'amcScheduling', renderAmcScheduling],
  [/^amc-visits$/, 'amcExecution', renderVisitList],
  [/^amc-visits\/([^/]+)$/, 'amcExecution', renderVisit],
  [/^master\/([^/]+)\/new$/, m => m[1], (el, key) => renderMasterForm(el, key, null)],
  [/^master\/([^/]+)\/([^/]+)$/, m => m[1], renderMasterForm],
  [/^master\/([^/]+)$/, m => m[1], renderMasterList],
  [/^admin\/([^/]+)$/, m => m[1], renderAdmin],
  [/^soon\/([^/]+)$/, m => m[1], renderSoon],
];

// [pattern, page, menu needed on the phone (a menu hidden in Menu Access refuses its pages too)]
const MOBILE = [
  [/^m\/home$/, mHome],
  [/^m\/jobs$/, mJobs],
  [/^m\/job\/([^/]+)$/, mJob, 'inspection'],
  [/^m\/report\/([^/]+)\/(\d)$/, mReport, 'inspection'],
  [/^m\/report\/([^/]+)\/view$/, mReportView, 'inspection'],
  [/^m\/enquiries$/, mEnquiries, 'enquiry'],
  [/^m\/enquiry\/([^/]+)$/, mEnquiry, 'enquiry'],
  [/^m\/enquiry-new$/, page => mEnquiryForm(page), 'enquiry'],
  [/^m\/enquiry\/([^/]+)\/edit$/, mEnquiryForm, 'enquiry'],
  [/^m\/customers$/, mCustomers, 'customer'],
  [/^m\/customer-new$/, page => mCustomerForm(page), 'customer'],
  [/^m\/customer\/([^/]+)$/, mCustomer, 'customer'],
  [/^m\/customer\/([^/]+)\/edit$/, mCustomerForm, 'customer'],
  [/^m\/rjob\/([^/]+)$/, mRepairJob, 'job'],
  [/^m\/rjob\/([^/]+)\/(\w+)$/, mRepairStep, 'job'],
  [/^m\/(visit|gjob)\/([^/]+)$/, mService, m => (m[1] === 'visit' ? 'amcExecution' : 'job')],
  [/^m\/(visit|gjob)\/([^/]+)\/sh\/([^/]+)$/, mShutter, m => (m[1] === 'visit' ? 'amcExecution' : 'job')],
  [/^m\/(visit|gjob)\/([^/]+)\/(\w+)$/, mServiceStep, m => (m[1] === 'visit' ? 'amcExecution' : 'job')],
  [/^m\/tasks$/, mTasks],
  [/^m\/task\/([^/]+)$/, mTask],
  [/^m\/more$/, mMore],
  [/^m\/soon\/([^/]+)$/, mSoon],
];

// Which sidebar item to highlight for a web route.
function activeMenu(route) {
  const [a, b] = route.split('/');
  return { home: 'dashboard', tasks: 'dashboard', enquiries: 'enquiry', assessments: 'inspection', reports: 'inspection', estimates: 'estimation', quotations: 'quotation',
    jobs: 'job', invoices: 'invoice', payments: 'payment', closure: 'closure', contracts: 'amcContract', 'amc-scheduling': 'amcScheduling', 'amc-visits': 'amcExecution',
    master: b, admin: b, soon: b }[a] || '';
}

// Keep the user on the same record when switching view, where the other view has that screen.
export function routeForView(route, view) {
  let m;
  if (view === 'mobile') {
    if ((m = route.match(/^enquiries\/([^/]+)\/at\/(job|invoice|closure)$/))) { const j = store.list('jobs', x => x.enquiryId === m[1] && x.status !== 'Cancelled')[0]; if (j) return j.type === 'GS' ? `m/gjob/${j.id}` : `m/rjob/${j.id}`; }
    if ((m = route.match(/^enquiries\/([^/]+)/)) && m[1] !== 'new') return `m/enquiry/${m[1]}`;
    if ((m = route.match(/^assessments\/([^/]+)/)) && auth.scope('inspection') === 'own') return `m/job/${m[1]}`;
    if ((m = route.match(/^jobs\/([^/]+)$/)) && m[1] !== 'list') return store.get('jobs', m[1])?.type === 'GS' ? `m/gjob/${m[1]}` : `m/rjob/${m[1]}`;
    if ((m = route.match(/^amc-visits\/([^/]+)$/)) && auth.can('amcExecution', 'view', 'mobile')) return `m/visit/${m[1]}`;
    if (route === 'tasks') return 'm/tasks';
    if ((m = route.match(/^tasks\/([^/]+)$/))) return `m/task/${m[1]}`;
    return route.startsWith('m/') ? route : 'm/home';
  }
  if ((m = route.match(/^m\/enquiry\/([^/]+)/))) return `enquiries/${m[1]}`;
  if ((m = route.match(/^m\/job\/([^/]+)/))) return `assessments/${m[1]}`;
  if ((m = route.match(/^m\/report\/([^/]+)/))) return `reports/${m[1]}`;
  if ((m = route.match(/^m\/(rjob|gjob)\/([^/]+)/))) return `jobs/${m[2]}`;
  if ((m = route.match(/^m\/visit\/([^/]+)/))) return `amc-visits/${m[1]}`;
  if (route === 'm/tasks' || route.startsWith('m/task/')) return 'tasks';
  return route.startsWith('m/') ? 'home' : route;
}

const replaceRoute = r => location.replace(`#/${r}`);

export function render() {
  clearDirty(); // a new page starts with nothing unsaved
  drawGuideBar(); // the guided demo's step bar, outside the app area
  const route = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('.menu-pop, .modal-back, .palette-back').forEach(x => x.remove());
  if (!auth.session()) {
    if (route !== 'login') return replaceRoute('login');
    document.querySelectorAll('.toast').forEach(x => x.remove());
    return renderLogin(app);
  }
  const view = auth.view();
  if (!route || route === 'login') return replaceRoute(view === 'mobile' ? 'm/home' : 'home');
  // The daily check (instalment invoices on their bill dates, renewal reminders, contract ends) runs on the office's
  // side; an offline phone has no server to run it, and doing it there too would make the same invoice twice.
  if (!isOffline()) { upgradeProducts(); refreshAmc(); refreshLaterWork(); upgradeMarkupRights(); }
  const wanted = routeForView(route, view);
  if (wanted !== route) return replaceRoute(wanted);

  if (view === 'mobile') {
    const hit = MOBILE.find(([re]) => re.test(route));
    if (!hit) return replaceRoute('m/home');
    const need = typeof hit[2] === 'function' ? hit[2](route.match(hit[0])) : hit[2];
    if (need && !auth.can(need, 'view', 'mobile')) return renderPhone(app, route, page => { page.setTitle('No access', 'm/home'); page.body.innerHTML = '<div class="empty">Your role cannot open this on the phone.</div>'; });
    return renderPhone(app, route, page => hit[1](page, ...route.match(hit[0]).slice(1)));
  }

  const print = route.match(/^reports\/([^/]+)\/print$/);
  if (print) return auth.can('inspection', 'print', 'web') ? renderPrintSvr(app, print[1]) : renderWebShell(app, route, '', el => renderNoAccess(el));
  const doc = route.match(/^(quotations|invoices|contracts|amc-visits)\/([^/]+)\/print$/) || route.match(/^(jobs)\/([^/]+)\/(workdone|service)$/);
  if (doc) {
    const [kind, menu] = { quotations: ['quotation', 'quotation'], invoices: ['invoice', 'invoice'], contracts: ['contract', 'amcContract'], 'amc-visits': ['service', 'amcExecution'],
      jobs: [doc[3] === 'service' ? 'gsservice' : 'workdone', 'job'] }[doc[1]];
    return auth.can(menu, 'view', 'web') ? renderPrintDoc(app, kind, doc[2]) : renderWebShell(app, route, '', el => renderNoAccess(el));
  }

  // One page per job: a document's own address opens the job page at that document.
  if (ux().jobPage && auth.can('enquiry', 'view', 'web')) { const to = jobPageRoute(route); if (to) return replaceRoute(to); }
  else if (/^enquiries\/[^/]+\/at\//.test(route)) return replaceRoute(route.replace(/\/at\/.*$/, ''));
  const hit = WEB.find(([re]) => re.test(route));
  if (!hit) return replaceRoute('home');
  const params = route.match(hit[0]).slice(1);
  const need = typeof hit[1] === 'function' ? hit[1](route.match(hit[0])) : hit[1];
  renderWebShell(app, route, activeMenu(route), el => {
    if (need && !auth.can(need, 'view', 'web')) return renderNoAccess(el);
    return hit[2](el, ...params);
  });
}

// Base sample data, then the stage samples (one enquiry at every step of the money side).
async function seedAll() {
  app.innerHTML = '<div class="empty" style="padding-top:30vh">Preparing the sample data… about 10 seconds, only on the first visit and after "Reset demo data".</div>';
  await clearAllMedia().catch(() => {});
  buildingSamples(true);
  try {
    store.writeSeed(buildSeed());
    await buildDemoFlow().catch(e => console.error('Stage samples could not be built', e));
  } finally { buildingSamples(false); }
}

export async function resetDemo() {
  store.clearAll();
  await seedAll();
  auth.restore();
  replaceRoute('login');
  render();
}

export function switchView(view) {
  const route = location.hash.replace(/^#\/?/, '');
  auth.setView(view);
  const next = routeForView(route, view);
  if (next === route) render(); else location.hash = `#/${next}`;
}

// A date far from today is a slip of the hand (UX audit, finding 17: a PO number typed into a date gave the year
// 0081 and was accepted). On leaving any date field, a year more than 5 years back or 10 years ahead is refused: the
// field is emptied and says why. Checked on leaving the field, because the year passes through 0002, 0020 … while typed.
document.addEventListener('focusout', e => {
  const el = e.target;
  if (!el.matches?.('input[type=date]') || !el.value || el.readOnly || el.disabled) return;
  const y = Number(el.value.slice(0, 4)), now = new Date().getFullYear();
  if (y >= now - 5 && y <= now + 10) return;
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  fieldError(el, `The year ${y} is not a likely date, so it was cleared. Enter the date again.`, { focus: false });
});

// ---------- Start ----------
store.dropOldVersions();
if (!store.isSeeded()) await seedAll();
auth.restore();
// Leaving a page with unsaved work asks first (UX audit, finding 15). The address is put back while the question
// is open, so the form and what was typed stay on screen.
let asking = false;
window.addEventListener('hashchange', async () => {
  if (isDirty() && location.hash !== dirtyAt()) {
    if (asking) return;
    const target = location.hash;
    history.replaceState(null, '', dirtyAt());
    asking = true;
    const leave = await new Promise(resolve => {
      let answer = false;
      const m = openModal({ title: 'Leave without saving?', body: html`<p>What you typed on this page has not been saved. If you leave, it is lost.</p>`,
        actions: [{ label: 'Leave without saving', onClick: () => { answer = true; } }, { label: 'Keep editing', kind: 'primary' }] });
      const wait = setInterval(() => { if (!m.el.isConnected) { clearInterval(wait); resolve(answer); } }, 60);
    });
    asking = false;
    if (!leave) return;
    clearDirty();
    if (location.hash === target) render(); else location.hash = target;
    return;
  }
  render();
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && auth.session()) {
    e.preventDefault();
    openPalette();
  }
});
render();
