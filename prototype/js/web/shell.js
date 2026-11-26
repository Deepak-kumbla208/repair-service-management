// Web shell: white top bar (search, notifications, company, Web / Mobile switch, user menu) and the navy sidebar menu.
// UX audit: the menu has line icons and plain names (a working-style switch),
// the bell is a real notification list, and every page shows one name for one place.
import * as auth from '../core/auth.js';
import { html, $, popMenu, confirmBox, icon, hasIcon, fmtDateTime, fmtDuration } from '../core/ui.js';
import { GROUPS, MENUS, routeOf } from '../data/menus.js';
import { notifications, bellCount, markSeen } from '../core/notify.js';
import { ux, watchSaves } from '../core/ux.js';
import { switchView, resetDemo } from '../app.js';
import { openPalette } from './palette.js';
import { wireStepBars } from './doc-trail.js';
import { refreshJobPage } from './job-page.js';
import { labelInputs, linkRows } from './a11y.js';
import { phoneOffline } from '../core/offline.js';

const OPEN_KEY = 'rsmOpenGroups';
const openGroups = () => { try { return JSON.parse(sessionStorage.getItem(OPEN_KEY)) || ['Transactions', 'Admin Setup']; } catch { return ['Transactions']; } };
// The menu can be collapsed to icons; remembered per browser (a convenience only).
const COLLAPSE_KEY = 'rsmSideCollapsed';
const isCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };
const setCollapsed = on => { try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch { /* storage blocked */ } };
const initials = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const GROUP_PLAIN = { Master: 'Lists and rates', Transactions: 'Work', 'Admin Setup': 'Settings' };
export const groupLabel = g => (ux().plainMenus && GROUP_PLAIN[g]) || g;

function sidebar(activeKey) {
  const menus = auth.webMenus();
  if (!menus.length) return html`<nav class="sidebar"><div class="side-group"><div class="side-head">No web menus</div>
    <p class="small" style="padding:4px 9px;color:#B5D4F4">This role works on the phone. Use the Mobile switch at the top.</p></div></nav>`;
  const open = openGroups();
  const collapsed = isCollapsed();
  const toggle = html`<button class="side-toggle" id="sideToggle" title="${collapsed ? 'Expand the menu' : 'Collapse the menu'}" aria-label="${collapsed ? 'Expand the menu' : 'Collapse the menu'}">${collapsed ? '»' : '« Collapse'}</button>`;
  return html`<nav class="sidebar ${collapsed ? 'collapsed' : ''}" aria-label="Main menu">${toggle}${GROUPS.map(g => {
    const items = menus.filter(m => m.group === g);
    if (!items.length) return '';
    const hasActive = items.some(m => m.key === activeKey);
    const isOpen = g === 'Dashboard' || hasActive || open.includes(g) || collapsed;
    const links = items.map(m => html`<a class="side-item ${m.key === activeKey ? 'on' : ''}" href="#/${routeOf(m)}" title="${m.label}" ${m.key === activeKey ? 'aria-current="page"' : ''}>
      <span class="ic">${hasIcon(m.key) ? icon(m.key, 17) : m.icon}</span><span class="lbl">${m.label}</span></a>`);
    if (g === 'Dashboard') return html`<div>${links}</div>`;
    return html`<div class="side-group"><button class="side-head" data-group="${g}" aria-expanded="${isOpen ? 'true' : 'false'}">${groupLabel(g)}<span>${isOpen ? '▾' : '▸'}</span></button>${isOpen ? links : ''}</div>`;
  })}</nav>`;
}

// One name per place (finding 9): pages wrote "Enquiry register", "Scheduling board", "AMC visits" … for places the
// menu calls something else. Every crumb and page title is brought to the menu's current name.
function nameMap() {
  const map = new Map();
  MENUS.forEach(m => [m.tl, m.plain, ...(m.also || [])].filter(Boolean).forEach(n => { if (n !== m.label) map.set(n, m.label); }));
  GROUPS.forEach(g => { if (groupLabel(g) !== g) map.set(g, groupLabel(g)); });
  return map;
}
export function namesIn(root) {
  const map = nameMap();
  const fix = node => {
    const parts = node.nodeValue.split(' › ');
    const next = parts.map(p => { const t = p.trim(); return map.has(t) ? p.replace(t, map.get(t)) : p; }).join(' › ');
    if (next !== node.nodeValue) node.nodeValue = next;
  };
  root.querySelectorAll('.crumb, .page-head h1').forEach(el => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) fix(n);
  });
}

function openBell(anchor) {
  document.querySelector('.menu-pop')?.remove();
  const list = notifications();
  const box = document.createElement('div');
  box.className = 'menu-pop notif';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Notifications');
  box.innerHTML = String(html`<h3>Notifications ${auth.hasTasks('web') ? html`<a class="small" href="#/tasks">Open My tasks</a>` : ''}</h3>
    ${list.length ? list.slice(0, 14).map(n => html`<a class="ni ${n.unread ? 'unread' : ''}" href="#/${n.route}">${n.unread ? html`<span class="new-dot">New</span>` : ''}${n.title}
      <small>${n.sub} · ${fmtDuration(Date.now() - new Date(n.at))} ago</small></a>`) : html`<div class="empty">Nothing new. You will see here when a site report comes in, a quotation is approved or a technician asks to leave.</div>`}
    ${list.length > 14 ? html`<div class="pick-more">${list.length - 14} older, from ${fmtDateTime(list[list.length - 1].at)}</div>` : ''}`);
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  box.style.top = `${r.bottom + 6}px`;
  box.style.left = `${Math.max(8, Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`;
  const close = e => { if (!e || (!box.contains(e.target) && e.target !== anchor)) { box.remove(); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); } };
  const onKey = e => { if (e.key === 'Escape') { close(); anchor.focus(); } };
  setTimeout(() => { document.addEventListener('mousedown', close); document.addEventListener('keydown', onKey); });
  box.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  box.querySelector('a')?.focus();
  markSeen('bell');
  const n = anchor.querySelector('.n');
  if (n) { const left = list.filter(x => x.kind === 'task').length; n.textContent = left; n.classList.toggle('zero', !left); }
}

let watching = null;
export function renderWebShell(app, route, activeKey, page) {
  const u = auth.user(), c = auth.company(), r = auth.role();
  const who = r.name !== u.name ? `${u.name} · ${r.name}` : u.name;
  const count = bellCount();
  app.innerHTML = String(html`<div class="web">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">RSM</span><div>Repair &amp; Service<small>Prototype · demo data</small></div></div>
      <button class="gsearch-btn" id="gsearch" title="Search everything you can open"><span>${icon('search', 15)} Search everything</span><kbd>Ctrl K</kbd></button>
      <span class="grow"></span>
      ${phoneOffline() ? html`<span class="company-btn offline-chip" title="${phoneOffline().count} changes are waiting on the phone; the office gets them when it is back online">${phoneOffline().name}'s phone is offline</span>` : ''}
      <button class="company-btn bell" id="bell" title="Notifications: what came in, and what waits for you" aria-label="Notifications, ${count} new or waiting">${icon('bell', 16)}<span class="n ${count ? '' : 'zero'}">${count}</span></button>
      <button class="company-btn" id="company" title="Company">${c.name} ▾</button>
      <div class="seg" role="group" aria-label="View"><button class="on" aria-pressed="true">Web</button><button id="toMobile" aria-pressed="false">Mobile</button></div>
      <button class="avatar" id="me" title="${who}" aria-label="User menu: ${who}">${initials(u.name)}</button>
    </header>
    <div class="web-body">${sidebar(activeKey)}<main class="content" id="content"></main></div>
  </div>`);

  $('#gsearch').onclick = () => openPalette();
  $('#toMobile').onclick = () => switchView('mobile');
  $('#bell').onclick = e => openBell(e.currentTarget);
  $('#company').onclick = e => popMenu(e.currentTarget, [
    { info: html`<b>${c.name}</b><br><span class="muted">${c.country} · ${c.currency}</span>` },
    { sep: true },
    { label: 'Switch company…', onClick: () => logoutTo(c.id === 'co_dsh' ? 'co_gdd' : 'co_dsh') },
  ]);
  $('#me').onclick = e => popMenu(e.currentTarget, [
    { info: html`<b>${u.name}</b>${r.name !== u.name ? html`<br><span class="muted">${r.name}</span>` : ''}` },
    { sep: true },
    { label: 'Switch user', onClick: () => logoutTo(c.id) },
    { label: 'Log out', onClick: () => logoutTo(c.id) },
    { sep: true },
    { label: 'Reset demo data…', onClick: async () => { if (await confirmBox('Reset demo data', 'All changes and photos will be removed and the sample data restored.', 'Reset')) resetDemo(); } },
  ]);
  $('#sideToggle')?.addEventListener('click', () => { setCollapsed(!isCollapsed()); renderWebShell(app, route, activeKey, page); });
  app.querySelectorAll('[data-group]').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.group, open = openGroups();
    sessionStorage.setItem(OPEN_KEY, JSON.stringify(open.includes(g) ? open.filter(x => x !== g) : [...open, g]));
    renderWebShell(app, route, activeKey, page);
  }));
  const content = $('#content');
  page(content);
  // Pages redraw themselves after an action; the names are brought in line each time.
  const tidy = () => { refreshJobPage(content); namesIn(content); wireStepBars(content); watchSaves(content); linkRows(content, route); labelInputs(content); };
  tidy();
  watching?.disconnect();
  watching = new MutationObserver(() => { watching.disconnect(); tidy(); watching.observe(content, { childList: true, subtree: true }); });
  watching.observe(content, { childList: true, subtree: true });
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
