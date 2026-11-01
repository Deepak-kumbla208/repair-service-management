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
import { renderAdmin, renderSoon } from './web/admin-preview.js';
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
import { mRepairJob, mRepairStep } from './mobile/repair-job.js';
import { mService, mServiceStep, mShutter } from './mobile/service.js';
import { mTasks, mTask } from './mobile/tasks.js';
import { mHome, mMore, mSoon } from './mobile/home.js';
import { mJobs, mJob } from './mobile/jobs.js';
import { mReport } from './mobile/site-report.js';
import { mEnquiries, mEnquiry } from './mobile/enquiries.js';

const app = document.getElementById('app');

// [pattern, menu key needed (web view), page]
const WEB = [
  [/^home$/, null, renderHome],
  [/^enquiries$/, 'enquiry', renderEnquiryList],
  [/^enquiries\/new$/, 'enquiry', el => renderEnquiryForm(el, null)],
  [/^enquiries\/([^/]+)\/edit$/, 'enquiry', renderEnquiryForm],
  [/^enquiries\/([^/]+)$/, 'enquiry', renderEnquiryView],
  [/^inspections$/, 'inspection', renderInspectionList],
  [/^inspections\/([^/]+)$/, 'inspection', renderInspection],
  [/^reports\/([^/]+)$/, 'inspection', renderReport],
  [/^estimates$/, 'estimation', renderEstimateList],
  [/^estimates\/([^/]+)$/, 'estimation', renderEstimate],
  [/^quotations$/, 'quotation', renderQuotationList],
  [/^quotations\/([^/]+)$/, 'quotation', renderQuotation],
  [/^tasks$/, null, renderTasks],
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

const MOBILE = [
  [/^m\/home$/, mHome],
  [/^m\/jobs$/, mJobs],
  [/^m\/job\/([^/]+)$/, mJob],
  [/^m\/report\/([^/]+)\/(\d)$/, mReport],
  [/^m\/enquiries$/, mEnquiries],
  [/^m\/enquiry\/([^/]+)$/, mEnquiry],
  [/^m\/rjob\/([^/]+)$/, mRepairJob],
  [/^m\/rjob\/([^/]+)\/(\w+)$/, mRepairStep],
  [/^m\/(visit|gjob)\/([^/]+)$/, mService],
  [/^m\/(visit|gjob)\/([^/]+)\/sh\/([^/]+)$/, mShutter],
  [/^m\/(visit|gjob)\/([^/]+)\/(\w+)$/, mServiceStep],
  [/^m\/tasks$/, mTasks],
  [/^m\/task\/([^/]+)$/, mTask],
  [/^m\/more$/, mMore],
  [/^m\/soon\/([^/]+)$/, mSoon],
];

// Which sidebar item to highlight for a web route.
function activeMenu(route) {
  const [a, b] = route.split('/');
  return { home: 'dashboard', tasks: 'dashboard', enquiries: 'enquiry', inspections: 'inspection', reports: 'inspection', estimates: 'estimation', quotations: 'quotation',
    jobs: 'job', invoices: 'invoice', payments: 'payment', closure: 'closure', contracts: 'amcContract', 'amc-scheduling': 'amcScheduling', 'amc-visits': 'amcExecution',
    master: b, admin: b, soon: b }[a] || '';
}

// Keep the user on the same record when switching view, where the other view has that screen.
export function routeForView(route, view) {
  let m;
  if (view === 'mobile') {
    if ((m = route.match(/^enquiries\/([^/]+)/)) && m[1] !== 'new') return `m/enquiry/${m[1]}`;
    if ((m = route.match(/^inspections\/([^/]+)/)) && auth.scope('inspection') === 'own') return `m/job/${m[1]}`;
    if ((m = route.match(/^jobs\/([^/]+)$/)) && m[1] !== 'list') return store.get('jobs', m[1])?.type === 'GS' ? `m/gjob/${m[1]}` : `m/rjob/${m[1]}`;
    if ((m = route.match(/^amc-visits\/([^/]+)$/)) && auth.can('amcExecution', 'view', 'mobile')) return `m/visit/${m[1]}`;
    if (route === 'tasks') return 'm/tasks';
    return route.startsWith('m/') ? route : 'm/home';
  }
  if ((m = route.match(/^m\/enquiry\/([^/]+)/))) return `enquiries/${m[1]}`;
  if ((m = route.match(/^m\/job\/([^/]+)/))) return `inspections/${m[1]}`;
  if ((m = route.match(/^m\/(rjob|gjob)\/([^/]+)/))) return `jobs/${m[2]}`;
  if ((m = route.match(/^m\/visit\/([^/]+)/))) return `amc-visits/${m[1]}`;
  if (route === 'm/tasks' || route.startsWith('m/task/')) return 'tasks';
  return route.startsWith('m/') ? 'home' : route;
}

const replaceRoute = r => location.replace(`#/${r}`);

export function render() {
  const route = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('.menu-pop, .modal-back, .palette-back').forEach(x => x.remove());
  if (!auth.session()) {
    if (route !== 'login') return replaceRoute('login');
    return renderLogin(app);
  }
  const view = auth.view();
  if (!route || route === 'login') return replaceRoute(view === 'mobile' ? 'm/home' : 'home');
  refreshAmc(); // the daily check: instalment invoices on their bill dates, renewal reminders, contract ends
  const wanted = routeForView(route, view);
  if (wanted !== route) return replaceRoute(wanted);

  if (view === 'mobile') {
    const hit = MOBILE.find(([re]) => re.test(route));
    if (!hit) return replaceRoute('m/home');
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
  app.innerHTML = '<div class="empty" style="padding-top:30vh">Preparing the sample data…</div>';
  await clearAllMedia().catch(() => {});
  store.writeSeed(buildSeed());
  await buildDemoFlow().catch(e => console.error('Stage samples could not be built', e));
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

// ---------- Start ----------
store.dropOldVersions();
if (!store.isSeeded()) await seedAll();
auth.restore();
window.addEventListener('hashchange', render);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && auth.session()) {
    e.preventDefault();
    openPalette();
  }
});
render();
