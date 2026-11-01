// Phone: Home (role-based tiles and today's work), More (view switch, switch user, reset), and later-stretch tabs.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, on, go, tiles, confirmBox, toast, fmtTime } from '../core/ui.js';
import { isToday } from '../core/enquiries.js';
import { switchView, resetDemo, render } from '../app.js';
import { logoutTo } from '../web/shell.js';
import { enquiryTiles, setEnquiryTile } from '../web/enquiry-list.js';
import { myWork, openReport } from './jobs.js';
import { myTasks } from '../core/workflow.js';
import { taskCard } from './tasks.js';
import { revenue, owed, amcEnding, visitsOverdue } from '../core/dashboard.js';
import { isOffline, waiting, goOffline, goOnline } from '../core/offline.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function mHome(page) {
  const u = auth.user(), r = auth.role(), c = auth.company();
  page.setTitle('Home');
  const own = auth.scope('inspection') === 'own' && auth.can('inspection', 'view', 'mobile');
  let body = html`<h2>Welcome, ${u.name}</h2><div class="muted" style="margin-bottom:12px">${r.name !== u.name ? `${r.name} · ` : ''}${c.name}</div>`;
  if (own) {
    const jobs = myWork();
    const today = jobs.filter(x => isToday(x.at) && !x.done);
    const open = jobs.filter(x => !x.done);
    body = html`${body}${tiles([
      { key: 'today', label: 'Today', count: today.length },
      { key: 'upcoming', label: 'Upcoming', count: open.length - today.length },
      { key: 'done', label: 'Done', count: jobs.length - open.length },
    ], '', 'm-tiles')}
    <div class="m-section">Today's jobs</div>
    ${today.length ? html`${today.map(x => x.card())}` : html`<div class="empty">No visits today. Check “Upcoming” in My jobs.</div>`}`;
  } else {
    const tasks = auth.hasTasks('mobile') ? myTasks() : [];
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
    if (own) { sessionStorage.setItem('rsmMobJobs', JSON.stringify({ tile: b.dataset.tile, q: '' })); go('m/jobs'); }
    else { setEnquiryTile(b.dataset.tile); go('m/enquiries'); }
  });
  on(page.body, 'click', '[data-start]', (e, b) => openReport(b.dataset.start));
}

export function mMore(page) {
  const u = auth.user(), r = auth.role(), c = auth.company();
  page.setTitle('More');
  page.body.innerHTML = String(html`
    <div class="m-card"><b>${u.name}</b>${r.name !== u.name ? html`<br><span class="muted">${r.name}</span>` : ''}<br><span class="small">${c.name} · ${c.country}</span></div>
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
