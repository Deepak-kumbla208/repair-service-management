// Start-up and screen routing. One app, two views (web / mobile), never shown together:
// web routes look like #/enquiries, phone routes like #/m/jobs.
import * as store from './core/store.js';
import * as auth from './core/auth.js';
import { clearAllMedia } from './core/media.js';
import { buildSeed } from './data/seed.js';
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
  [/^m\/more$/, mMore],
  [/^m\/soon\/([^/]+)$/, mSoon],
];

// Which sidebar item to highlight for a web route.
function activeMenu(route) {
  const [a, b] = route.split('/');
  return { home: 'dashboard', enquiries: 'enquiry', inspections: 'inspection', reports: 'inspection', master: b, admin: b, soon: b }[a] || '';
}

// Keep the user on the same record when switching view, where the other view has that screen.
export function routeForView(route, view) {
  let m;
  if (view === 'mobile') {
    if ((m = route.match(/^enquiries\/([^/]+)/)) && m[1] !== 'new') return `m/enquiry/${m[1]}`;
    if ((m = route.match(/^inspections\/([^/]+)/)) && auth.scope('inspection') === 'own') return `m/job/${m[1]}`;
    return route.startsWith('m/') ? route : 'm/home';
  }
  if ((m = route.match(/^m\/enquiry\/([^/]+)/))) return `enquiries/${m[1]}`;
  if ((m = route.match(/^m\/job\/([^/]+)/))) return `inspections/${m[1]}`;
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
  const wanted = routeForView(route, view);
  if (wanted !== route) return replaceRoute(wanted);

  if (view === 'mobile') {
    const hit = MOBILE.find(([re]) => re.test(route));
    if (!hit) return replaceRoute('m/home');
    return renderPhone(app, route, page => hit[1](page, ...route.match(hit[0]).slice(1)));
  }

  const print = route.match(/^reports\/([^/]+)\/print$/);
  if (print) return auth.can('inspection', 'print', 'web') ? renderPrintSvr(app, print[1]) : renderWebShell(app, route, '', el => renderNoAccess(el));

  const hit = WEB.find(([re]) => re.test(route));
  if (!hit) return replaceRoute('home');
  const params = route.match(hit[0]).slice(1);
  const need = typeof hit[1] === 'function' ? hit[1](route.match(hit[0])) : hit[1];
  renderWebShell(app, route, activeMenu(route), el => {
    if (need && !auth.can(need, 'view', 'web')) return renderNoAccess(el);
    return hit[2](el, ...params);
  });
}

export async function resetDemo() {
  store.clearAll();
  await clearAllMedia().catch(() => {});
  store.writeSeed(buildSeed());
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
if (!store.isSeeded()) {
  clearAllMedia().catch(() => {});
  store.writeSeed(buildSeed());
}
auth.restore();
window.addEventListener('hashchange', render);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && auth.session()) {
    e.preventDefault();
    openPalette();
  }
});
render();
