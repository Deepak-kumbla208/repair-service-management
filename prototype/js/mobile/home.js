// Phone: Home (role-based tiles and today's work), More (view switch, switch user, reset), and later-stretch tabs.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, on, go, tiles, confirmBox, toast, fmtTime, icon } from '../core/ui.js';
import { isToday } from '../core/enquiries.js';
import { switchView, resetDemo, render } from '../app.js';
import { logoutTo } from '../web/shell.js';
import { enquiryTiles, setEnquiryTile } from '../web/enquiry-list.js';
import { myWork } from './jobs.js';
import { myTasks } from '../core/workflow.js';
import { taskCard } from './tasks.js';
import { revenue, owed, amcEnding, visitsOverdue } from '../core/dashboard.js';
import { isOffline, waiting, goOffline, goOnline } from '../core/offline.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const today = () => new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short' });

export function mHome(page) {
  const u = auth.user(), r = auth.role(), c = auth.company();
  const own = auth.scope('inspection') === 'own' && auth.can('inspection', 'view', 'mobile');
  page.setTitle(own ? greeting() : 'Home');
  let body = html`<div class="m-hello">${u.name}${r.name !== u.name ? ` · ${r.name}` : ''} · ${today()}</div>`;
  if (own) {
    // The technician: the next job first, with its one button, then the rest of today.
    const jobs = myWork();
    const todays = jobs.filter(x => isToday(x.at) && !x.done);
    const open = jobs.filter(x => !x.done);
    const next = todays[0] || open[0];
    const later = todays.filter(x => x !== next);
    body = html`${body}<h2>${todays.length ? `${todays.length} job${todays.length > 1 ? 's' : ''} today` : 'No jobs today'}</h2>
    <div class="m-kpi">${[['today', 'Today', todays.length], ['upcoming', 'Upcoming', open.length - todays.length], ['done', 'Done', jobs.length - open.length]]
      .map(([k, label, n]) => html`<a href="#/m/jobs" data-tile="${k}"><b>${n}</b><span>${label}</span></a>`)}</div>
    ${next ? html`<div class="m-section">${isToday(next.at) ? 'Next' : 'Next job'}</div><div class="m-next">${next.card()}</div>` : html`<div class="empty">Nothing planned. New jobs appear here when the office assigns them.</div>`}
    ${later.length ? html`<div class="m-section">Later today</div>${later.map(x => x.card())}` : ''}`;
  } else {
    const tasks = auth.hasTasks('mobile') ? myTasks() : [];
    // Quick actions for what this role may do on the phone.
    const quick = [
      auth.can('enquiry', 'create', 'mobile') && ['m/enquiry-new', 'plus', 'New enquiry'],
      auth.can('enquiry', 'view', 'mobile') && ['m/enquiries', 'enquiries', 'Enquiries'],
      auth.can('customer', 'view', 'mobile') && ['m/customers', 'users', 'Customers'],
      auth.hasTasks('mobile') && ['m/tasks', 'tasks', `Tasks (${tasks.length})`],
    ].filter(Boolean);
    body = html`${body}<h2>${greeting()}</h2>
      ${quick.length ? html`<div class="m-quick" style="margin-top:12px">${quick.map(([route, ic, label]) => html`<a href="#/${route}">${icon(ic, 20)}${label}</a>`)}</div>` : ''}`;
    if (auth.hasTasks('mobile')) body = html`${body}<div class="m-section">Tasks waiting for you (${tasks.length})</div>${tasks.length ? html`${tasks.slice(0, 3).map(taskCard)}` : html`<div class="muted small">Nothing waiting.</div>`}`;
    if (r.dashboard === 'management') {
      const money = owed();
      body = html`${body}<div class="m-section">This month</div><div class="m-card"><div class="kv two">
        <div><div class="k">Revenue before ${c.taxLabel || 'tax'}</div><div class="v"><b>${m2(revenue('month'))}</b></div></div>
        <div><div class="k">Owed to us</div><div class="v"><b>${m2(money.total)}</b>${money.overdue ? html`<br><span class="small" style="color:var(--red-ink)">${m2(money.overdue)} overdue</span>` : ''}</div></div>
        <div><div class="k">AMC ending in 60 days</div><div class="v"><b>${amcEnding().length}</b></div></div>
        <div><div class="k">AMC visits overdue</div><div class="v"><b>${visitsOverdue().length}</b></div></div></div></div>
        <p class="muted small">The full Management dashboard is in the Web view.</p>`;
    }
    if (auth.can('enquiry', 'view', 'mobile')) body = html`${body}<div class="m-section">Enquiries</div>${tiles(enquiryTiles(store.list('enquiries'), c).slice(0, 3), '', 'm-tiles')}
      <p class="muted small">Use the search icon at the top to find any enquiry.</p>`;
  }
  page.body.innerHTML = String(body);
  on(page.body, 'click', '[data-tile]', (e, b) => {
    e.preventDefault();
    if (own) { sessionStorage.setItem('rsmMobJobs', JSON.stringify({ tile: b.dataset.tile, q: '' })); go('m/jobs'); }
    else { setEnquiryTile(b.dataset.tile); go('m/enquiries'); }
  });
}

export function mMore(page) {
  const u = auth.user(), r = auth.role(), c = auth.company();
  page.setTitle('More');
  page.body.innerHTML = String(html`
    <div class="m-card"><b>${u.name}</b>${r.name !== u.name ? html`<br><span class="muted">${r.name}</span>` : ''}<br><span class="small">${c.name} · ${c.country}</span></div>
    ${auth.can('customer', 'view', 'mobile') ? html`<div class="m-quick" style="grid-template-columns:1fr"><a href="#/m/customers">${icon('users', 20)}Customers</a></div>` : ''}
    <div class="m-section">Work offline</div>
    <label class="m-card row" style="justify-content:space-between;cursor:pointer"><span>Work offline<br><span class="muted small">${isOffline() ? 'Changes stay on this phone until you go back online' : 'For places without signal: the office gets your changes when you are back online'}</span></span>
      <input type="checkbox" id="offline" ${isOffline() ? 'checked' : ''}></label>
    ${isOffline() ? html`<div class="m-section">Waiting to send (${waiting().length})</div>
      ${waiting().slice(-12).map(a => html`<div class="wl small">${fmtTime(a.at)} · ${a.summary}</div>`)}
      <button class="btn primary block" id="online" style="margin:8px 0 4px">Go back online and send</button>` : ''}
    <div class="stack">
      <button class="btn block" id="web" ${isOffline() ? 'disabled' : ''}>Switch to the Web view</button>
      <button class="btn block" id="user">Switch user</button>
      <button class="btn block danger" id="reset">Reset demo data</button>
    </div>
    <p class="muted small" style="margin-top:14px">Prototype with sample test data. Everything stays in this browser; nothing is sent anywhere.</p>`);
  page.body.querySelector('#offline').onchange = e => {
    if (e.target.checked) { goOffline(); toast('Offline: your changes wait on this phone'); }
    else { const r = goOnline(); sessionStorage.setItem('rsmSynced', `Back online · ${r.count} change${r.count === 1 ? '' : 's'} sent${r.numbers.length ? ` · ${r.numbers.map(x => `${x.temp} is now ${x.real}`).join(', ')}` : ''}`); }
    go('m/more');
    render();
  };
  page.body.querySelector('#online')?.addEventListener('click', () => { const r = goOnline(); sessionStorage.setItem('rsmSynced', `Back online · ${r.count} change${r.count === 1 ? '' : 's'} sent${r.numbers.length ? ` · ${r.numbers.map(x => `${x.temp} is now ${x.real}`).join(', ')}` : ''}`); render(); });
  page.body.querySelector('#web').onclick = () => switchView('web');
  page.body.querySelector('#user').onclick = () => logoutTo(c.id);
  page.body.querySelector('#reset').onclick = async () => {
    if (await confirmBox('Reset demo data', 'All changes and photos will be removed and the sample data restored.', 'Reset')) resetDemo();
  };
}

export function mSoon(page) {
  page.setTitle('Not on the phone');
  page.body.innerHTML = String(html`<div class="m-card"><p>This screen is in the Web view.</p></div>`);
}
