// Phone shell: the whole screen becomes a phone; header (back, title, search, Web / Mobile switch),
// scrolling body, optional footer buttons, and bottom tabs by role.
import * as auth from '../core/auth.js';
import { html, $ } from '../core/ui.js';
import { switchView } from '../app.js';
import { openPalette } from '../web/palette.js';

function activeTab(route) {
  if (/^m\/(jobs|job|report|rjob)/.test(route)) return 'jobs';
  if (/^m\/tasks?(\/|$)/.test(route)) return 'tasks';
  if (/^m\/enquir/.test(route)) return 'enquiries';
  if (route === 'm/more') return 'more';
  return 'home';
}

export function renderPhone(app, route, run) {
  const tabs = auth.mobileTabs();
  const now = new Date();
  const on = activeTab(route);
  app.innerHTML = String(html`<div class="mobile-stage"><div class="phone">
    <div class="m-head">
      <div class="m-status"><span>${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</span><span>${auth.company().name}</span><span>▂▄▆ ▮</span></div>
      <div class="m-titlebar"><span id="mBack"></span><h1 id="mTitle"></h1>
        <button class="m-icon-btn" id="mSearch" aria-label="Search" title="Search">⌕</button>
        <div class="seg" role="group" aria-label="View"><button id="toWeb">Web</button><button class="on">Mobile</button></div></div>
    </div>
    <div class="m-body" id="mBody"></div>
    <div id="mFoot"></div>
    <nav class="m-tabs">${tabs.map(t => html`<a class="m-tab ${t.key === on ? 'on' : ''}" href="#/${t.route}"><b>${t.icon}</b>${t.label}</a>`)}</nav>
  </div></div>`);
  $('#toWeb', app).onclick = () => switchView('web');
  $('#mSearch', app).onclick = () => openPalette();
  const page = {
    body: $('#mBody', app),
    foot: $('#mFoot', app),
    setTitle(title, backRoute) {
      $('#mTitle', app).textContent = title;
      $('#mBack', app).innerHTML = backRoute ? String(html`<a class="m-icon-btn" href="#/${backRoute}" aria-label="Back">←</a>`) : '';
    },
    setFoot(content) { page.foot.innerHTML = content ? String(html`<div class="m-foot">${content}</div>`) : ''; return page.foot; },
  };
  run(page);
}
