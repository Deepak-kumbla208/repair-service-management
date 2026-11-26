// Phone: Home (the technician's work for today, newly assigned work first; role-based tiles for the office roles),
// More (work offline, switch to the web view, switch user, reset), and later-stretch tabs.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, on, go, tiles, confirmBox, toast, fmtTime, icon } from '../core/ui.js';
import { switchView, resetDemo, render } from '../app.js';
import { logoutTo } from '../web/shell.js';
import { enquiryTiles, setEnquiryTile } from '../web/enquiry-list.js';
import { myWork, bindCards, jobsKey } from './jobs.js';
import { myTasks } from '../core/workflow.js';
import { taskCard } from './tasks.js';
import { revenue, owed, amcEnding, visitsOverdue } from '../core/dashboard.js';
import { isOffline, waiting, goOffline, goOnline } from '../core/offline.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const today = () => new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The technician: newly assigned work first (also when its visit time is not set yet), then what is under way,
// then the next job and the rest of today. The count in the heading includes all of them.
function technicianHome() {
  const jobs = myWork();
  const due = jobs.filter(x => x.due);
  const fresh = jobs.filter(x => x.isNew);
  const now = jobs.filter(x => x.stage === 'now');
  const next = jobs.filter(x => x.stage === 'next' && !x.isNew);
  const first = next[0];
  const later = next.slice(1).filter(x => x.due);
  const count = k => jobs.filter(x => x.stage === k).length;
  return html`<h2>${due.length ? `${plural(due.length, 'job')} today` : 'No jobs today'}${fresh.length ? html` <span class="new-dot">${fresh.length} new</span>` : ''}</h2>
    <div class="m-kpi">${[['now', 'Now'], ['next', 'Next'], ['done', 'Done']].map(([k, label]) => html`<a href="#/m/jobs" data-tile="${k}"><b>${count(k)}</b><span>${label}</span></a>`)}</div>
    ${fresh.length ? html`<div class="m-section">New from the office</div><div class="m-next">${fresh.map(x => x.card())}</div>` : ''}
    ${now.length ? html`<div class="m-section">Now</div><div class="m-next">${now.map(x => x.card())}</div>` : ''}
    ${first ? html`<div class="m-section">${first.due ? 'Next' : 'Next job'}</div><div class="${now.length || fresh.length ? '' : 'm-next'}">${first.card()}</div>` : ''}
    ${later.length ? html`<div class="m-section">Later today</div>${later.map(x => x.card())}` : ''}
    ${!fresh.length && !now.length && !first ? html`<div class="empty">Nothing planned. New jobs appear here when the office assigns them.</div>` : ''}`;
}

export function mHome(page) {
  const u = auth.user(), r = auth.role(), c = auth.company();
  const own = auth.scope('inspection') === 'own' && auth.can('inspection', 'view', 'mobile');
  page.setTitle(own ? greeting() : 'Home');
  const hello = html`<div class="m-hello">${u.name}${r.name !== u.name ? ` · ${r.name}` : ''} · ${today()}</div>`;
  const paint = () => {
    let body = own ? html`${hello}${technicianHome()}` : hello;
    if (!own) {
      const tasks = auth.hasTasks('mobile') ? myTasks() : [];
      // Quick actions for what this role may do on the phone.
      const quick = [
        auth.can('enquiry', 'create', 'mobile') && ['m/enquiry-new', 'plus', 'New enquiry'],
        auth.can('enquiry', 'view', 'mobile') && ['m/enquiries', 'enquiries', 'Enquiries'],
        auth.can('customer', 'view', 'mobile') && ['m/customers', 'users', 'Customers'],
        auth.hasTasks('mobile') && ['m/tasks', 'tasks', `Tasks (${tasks.length})`],
      ].filter(Boolean);
      body = html`${hello}<h2>${greeting()}</h2>
        ${quick.length ? html`<div class="m-quick" style="margin-top:12px">${quick.map(([route, ic, label]) => html`<a href="#/${route}">${icon(ic, 22)}${label}</a>`)}</div>` : ''}`;
      if (auth.hasTasks('mobile')) body = html`${body}<div class="m-section">Tasks waiting for you (${tasks.length})</div>${tasks.length ? html`${tasks.slice(0, 3).map(taskCard)}` : html`<div class="muted small">Nothing waiting.</div>`}`;
      if (r.dashboard === 'management') {
        const money = owed();
        body = html`${body}<div class="m-section">This month</div><div class="m-card"><div class="kv two">
          <div><div class="k">Revenue before ${c.taxLabel || 'tax'}</div><div class="v"><b>${m2(revenue('month'))}</b></div></div>
          <div><div class="k">Owed to us</div><div class="v"><b>${m2(money.total)}</b>${money.overdue ? html`<br><span class="small" style="color:var(--red-ink)">${m2(money.overdue)} overdue</span>` : ''}</div></div>
          <div><div class="k">Contracts ending in 60 days</div><div class="v"><b>${amcEnding().length}</b></div></div>
          <div><div class="k">Maintenance visits overdue</div><div class="v"><b>${visitsOverdue().length}</b></div></div></div></div>
          <p class="m-info">The full Management dashboard is in the web view.</p>`;
      }
      if (auth.can('enquiry', 'view', 'mobile')) body = html`${body}<div class="m-section">Enquiries</div>${tiles(enquiryTiles(store.list('enquiries'), c).slice(0, 3), '', 'm-tiles')}
        <p class="m-info">Use the search icon at the top to find any enquiry.</p>`;
    }
    page.body.innerHTML = String(body);
  };
  paint();
  on(page.body, 'click', '[data-tile]', (e, b) => {
    e.preventDefault();
    if (own) { sessionStorage.setItem(jobsKey(), JSON.stringify({ tab: b.dataset.tile, q: '' })); go('m/jobs'); }
    else { setEnquiryTile(b.dataset.tile); go('m/enquiries'); }
  });
  if (own) bindCards(page.body, paint);
}

const backOnline = () => { const r = goOnline(); sessionStorage.setItem('rsmSynced', `Back online · ${r.count} change${r.count === 1 ? '' : 's'} sent${r.numbers.length ? ` · ${r.numbers.map(x => `${x.temp} is now ${x.real}`).join(', ')}` : ''}`); };

export function mMore(page) {
  const u = auth.user(), r = auth.role(), c = auth.company();
  page.setTitle('More');
  page.body.innerHTML = String(html`
    <div class="m-card"><b>${u.name}</b>${r.name !== u.name ? html`<br><span class="muted">${r.name}</span>` : ''}<br><span class="small">${c.name} · ${c.country}</span></div>
    ${auth.can('customer', 'view', 'mobile') ? html`<div class="m-quick" style="grid-template-columns:1fr"><a href="#/m/customers">${icon('users', 22)}Customers</a></div>` : ''}
    <div class="m-section">Work offline</div>
    <label class="check" style="justify-content:space-between"><span><b>Work offline</b><br><span class="muted small">${isOffline() ? 'Changes stay on this phone until you go back online' : 'For places without signal: the office gets your changes when you are back online'}</span></span>
      <input type="checkbox" id="offline" ${isOffline() ? 'checked' : ''}></label>
    ${isOffline() ? html`<div class="m-section">Waiting to send (${waiting().length})</div>
      ${waiting().slice(-12).map(a => html`<div class="wl small">${fmtTime(a.at)} · ${a.summary}</div>`)}
      <button class="btn primary block" id="online" style="margin:8px 0 4px">Go back online and send</button>` : ''}
    <div class="m-section">This device</div>
    <div class="stack">
      <button class="btn block" id="web" ${isOffline() ? 'disabled' : ''}>Switch to the web view</button>
      ${isOffline() ? html`<p class="m-info">Go back online first: the web view is the office's side.</p>` : ''}
      <button class="btn block" id="user">Switch user</button>
    </div>
    <div class="m-apart">
      <p class="m-info">Prototype with sample test data. Everything stays in this browser; nothing is sent anywhere.</p>
      <button class="btn small quiet danger" id="reset">Reset demo data</button>
    </div>`);
  page.body.querySelector('#offline').onchange = e => {
    if (e.target.checked) { goOffline(); toast('Offline: your changes wait on this phone'); }
    else backOnline();
    go('m/more');
    render();
  };
  page.body.querySelector('#online')?.addEventListener('click', () => { backOnline(); render(); });
  page.body.querySelector('#web').onclick = () => switchView('web');
  page.body.querySelector('#user').onclick = () => logoutTo(c.id);
  page.body.querySelector('#reset').onclick = async () => {
    if (await confirmBox('Reset demo data', 'All changes and photos will be removed and the sample data restored.', 'Reset')) resetDemo();
  };
}

export function mSoon(page) {
  page.setTitle('Not on the phone');
  page.body.innerHTML = String(html`<div class="m-card"><p>This screen is in the web view.</p></div>`);
}
