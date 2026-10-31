// Phone: Home (role-based tiles and today's work), More (view switch, switch user, reset), and later-stretch tabs.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, on, go, tiles, confirmBox } from '../core/ui.js';
import { isToday } from '../core/enquiries.js';
import { switchView, resetDemo } from '../app.js';
import { logoutTo } from '../web/shell.js';
import { enquiryTiles, setEnquiryTile } from '../web/enquiry-list.js';
import { myWork, openReport } from './jobs.js';
import { myTasks } from '../core/workflow.js';
import { taskCard } from './tasks.js';

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
    if (auth.can('enquiry', 'view', 'mobile')) body = html`${body}<div class="m-section">Enquiries</div>${tiles(enquiryTiles(store.list('enquiries'), c).slice(0, 3), '', 'm-tiles')}
      <p class="muted small">Full dashboards come in Stretch 3. Use the search icon at the top to find any enquiry.</p>`;
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
    <div class="stack">
      <button class="btn block" id="web">Switch to the Web view</button>
      <button class="btn block" id="user">Switch user</button>
      <button class="btn block danger" id="reset">Reset demo data</button>
    </div>
    <p class="muted small" style="margin-top:14px">Prototype with sample test data. Everything stays in this browser; nothing is sent anywhere.</p>`);
  page.body.querySelector('#web').onclick = () => switchView('web');
  page.body.querySelector('#user').onclick = () => logoutTo(c.id);
  page.body.querySelector('#reset').onclick = async () => {
    if (await confirmBox('Reset demo data', 'All changes and photos will be removed and the sample data restored.', 'Reset')) resetDemo();
  };
}

export function mSoon(page) {
  page.setTitle('Coming soon');
  page.body.innerHTML = String(html`<div class="m-card"><span class="tag info">Stretch 3</span><p style="margin-top:8px">This screen comes in a later stretch.</p></div>`);
}
