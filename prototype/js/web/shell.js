// Web shell: white top bar (search, company, Web / Mobile switch, user menu) and the navy sidebar menu.
import * as auth from '../core/auth.js';
import { html, $, popMenu, confirmBox } from '../core/ui.js';
import { GROUPS, routeOf } from '../data/menus.js';
import { switchView, resetDemo } from '../app.js';
import { openPalette } from './palette.js';

const OPEN_KEY = 'rsmOpenGroups';
const openGroups = () => { try { return JSON.parse(sessionStorage.getItem(OPEN_KEY)) || ['Transactions', 'Admin Setup']; } catch { return ['Transactions']; } };
const initials = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function sidebar(activeKey) {
  const menus = auth.webMenus();
  if (!menus.length) return html`<nav class="sidebar"><div class="side-group"><div class="side-head">No web menus</div>
    <p class="small" style="padding:4px 9px;color:#B5D4F4">This role works on the phone. Use the Mobile switch at the top.</p></div></nav>`;
  const open = openGroups();
  return html`<nav class="sidebar" aria-label="Main menu">${GROUPS.map(g => {
    const items = menus.filter(m => m.group === g);
    if (!items.length) return '';
    const hasActive = items.some(m => m.key === activeKey);
    const isOpen = g === 'Dashboard' || hasActive || open.includes(g);
    const links = items.map(m => html`<a class="side-item ${m.key === activeKey ? 'on' : ''}" href="#/${routeOf(m)}">
      <span class="ic">${m.icon}</span>${m.label}${m.stretch > 1 ? html`<span class="soon" title="${m.preview ? 'Read-only view now; editing screen in Stretch ' + m.stretch : 'Built in Stretch ' + m.stretch}">${m.preview ? 'view' : 'S' + m.stretch}</span>` : ''}</a>`);
    if (g === 'Dashboard') return html`<div>${links}</div>`;
    return html`<div class="side-group"><button class="side-head" data-group="${g}">${g}<span>${isOpen ? '▾' : '▸'}</span></button>${isOpen ? links : ''}</div>`;
  })}</nav>`;
}

export function renderWebShell(app, route, activeKey, page) {
  const u = auth.user(), c = auth.company(), r = auth.role();
  app.innerHTML = String(html`<div class="web">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">RSM</span><div>Repair &amp; Service<small>Prototype · demo data</small></div></div>
      <button class="gsearch-btn" id="gsearch" title="Search everything you can open"><span>⌕ Search everything</span><kbd>Ctrl K</kbd></button>
      <span class="grow"></span>
      <button class="company-btn" id="company" title="Company">${c.name} ▾</button>
      <div class="seg" role="group" aria-label="View"><button class="on">Web</button><button id="toMobile">Mobile</button></div>
      <button class="avatar" id="me" title="${u.name} · ${r.name}">${initials(u.name)}</button>
    </header>
    <div class="web-body">${sidebar(activeKey)}<main class="content" id="content"></main></div>
  </div>`);

  $('#gsearch').onclick = () => openPalette();
  $('#toMobile').onclick = () => switchView('mobile');
  $('#company').onclick = e => popMenu(e.currentTarget, [
    { info: html`<b>${c.name}</b><br><span class="muted">${c.country} · ${c.currency}</span>` },
    { sep: true },
    { label: 'Switch company…', onClick: () => logoutTo(c.id === 'co_dsh' ? 'co_gdd' : 'co_dsh') },
  ]);
  $('#me').onclick = e => popMenu(e.currentTarget, [
    { info: html`<b>${u.name}</b><br><span class="muted">${r.name}</span>` },
    { sep: true },
    { label: 'Switch user', onClick: () => logoutTo(c.id) },
    { label: 'Reset demo data', onClick: async () => { if (await confirmBox('Reset demo data', 'All changes and photos will be removed and the sample data restored.', 'Reset')) resetDemo(); } },
    { label: 'Log out', onClick: () => logoutTo(c.id) },
  ]);
  app.querySelectorAll('[data-group]').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.group, open = openGroups();
    sessionStorage.setItem(OPEN_KEY, JSON.stringify(open.includes(g) ? open.filter(x => x !== g) : [...open, g]));
    renderWebShell(app, route, activeKey, page);
  }));
  page($('#content'));
}

// Log out and show the login screen with the given company selected.
export function logoutTo(companyId) {
  sessionStorage.setItem('rsmLoginCompany', companyId);
  sessionStorage.setItem('rsmLoginView', auth.view());
  auth.logout();
  location.hash = '#/login';
}

export function renderNoAccess(el) {
  el.innerHTML = String(html`<div class="page"><div class="card"><h1>No access</h1>
    <p class="muted" style="margin-top:6px">Your role cannot open this page in the web view.</p><a class="btn" href="#/home">Go to the dashboard</a></div></div>`);
}

// Standard page header: breadcrumb, title, subtitle, buttons on the right.
export function pageHead({ crumb, title, sub, actions }) {
  return html`<div class="page-head"><div class="grow">
    ${crumb ? html`<div class="crumb">${crumb}</div>` : ''}<h1>${title}</h1>${sub ? html`<div class="page-sub">${sub}</div>` : ''}
  </div>${actions || ''}</div>`;
}
