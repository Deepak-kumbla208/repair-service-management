// Phone shell: the whole screen becomes a phone; header (back, title with a small line under it, search),
// scrolling body, optional footer buttons, and bottom tabs by role. The drawn phone body and the status bar (clock,
// company, signal) show on a wide screen only (css/ux-phone.css); on a real phone the app fills the screen.
// The Web / Mobile switch is on the "More" screen.
import * as auth from '../core/auth.js';
import { html, raw, $, go, icon, openModal, holdTap, toast } from '../core/ui.js';
import { hydrateImages } from '../core/media.js';
import { openPalette } from '../web/palette.js';
import { isOffline, waiting } from '../core/offline.js';
import { render } from '../app.js';

// Open a phone screen, drawing it again when it is already the one on screen (after an Undo, for example).
export const show = route => (location.hash === `#/${route}` ? render() : go(route));

function activeTab(route) {
  if (/^m\/(jobs|job|report|rjob|gjob|visit)/.test(route)) return 'jobs';
  if (/^m\/tasks?(\/|$)/.test(route)) return 'tasks';
  if (/^m\/enquir/.test(route)) return 'enquiries';
  if (route === 'm/more') return 'more';
  return 'home';
}

// After a status tap ("On my way", "Check in", "Check out") the buttons drawn next in the footer do nothing for a
// moment, so a double tap cannot fire the next step (finding 3).
let heldUntil = 0;
export const holdNext = (ms = 1300) => { heldUntil = Date.now() + ms; };
// The message after a status tap, with Undo. Only the last tap can be taken back, so an earlier "Undo" goes.
export function undoToast(msg, undo) {
  document.querySelectorAll('.phone .toasts .toast').forEach(t => { if (t.querySelector('.toast-undo')) t.remove(); });
  return toast(msg, '', { undo });
}

// Every field on a phone screen has a name for a screen reader (finding 26): one that has no label of its own takes
// the text of the label beside it, or its hint.
const fieldName = el => (el.closest('.field')?.querySelector('label, .field-label')?.textContent || el.getAttribute('placeholder') || el.name || 'Field').replace('*', '').trim();
function nameFields(root) {
  root.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(el => {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`))) return;
    el.setAttribute('aria-label', fieldName(el));
  });
}
let watcher = null;

export function renderPhone(app, route, run) {
  const tabs = auth.mobileTabs();
  const now = new Date();
  const on = activeTab(route);
  const messages = app.querySelector('.phone .toasts'); // a message with "Undo" stays when the screen changes
  app.innerHTML = String(html`<div class="mobile-stage"><div class="phone">
    <div class="m-head">
      <div class="m-status" aria-hidden="true"><span>${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</span><span>${auth.company().name}</span><span>▂▄▆ ▮</span></div>
      <div class="m-titlebar"><span id="mBack"></span><div class="m-tt"><h1 id="mTitle"></h1><div class="m-sub" id="mSub" hidden></div></div>
        <button class="m-icon-btn" id="mSearch" aria-label="Search" title="Search">${icon('search', 20)}</button></div>
    </div>
    ${isOffline() ? html`<a class="m-offline" href="#/m/more">● Offline · ${waiting().length} change${waiting().length === 1 ? '' : 's'} waiting</a>`
      : sessionStorage.getItem('rsmSynced') ? html`<div class="m-online">✓ ${sessionStorage.getItem('rsmSynced')}</div>` : ''}
    <div class="m-toast-at"><div class="toasts" aria-live="polite"></div></div>
    <div class="m-body" id="mBody"></div>
    <div id="mFoot"></div>
    <nav class="m-tabs" aria-label="Main">${tabs.map(t => html`<a class="m-tab ${t.key === on ? 'on' : ''}" href="#/${t.route}" ${t.key === on ? raw('aria-current="page"') : ''}>${icon(t.key, 24)}${t.label}</a>`)}</nav>
  </div></div>`);
  sessionStorage.removeItem('rsmSynced'); // the green "sent" line shows once
  const phone = $('.phone', app);
  // Messages show under the header, clear of the buttons. One that came with a screen change ("Checked in", with its
  // Undo) stays on the screen it leads to, and goes at the next change.
  if (messages) [...messages.children].filter(t => !t.dataset.carried).forEach(t => { t.dataset.carried = '1'; $('.toasts', phone).appendChild(t); });
  watcher?.disconnect();
  watcher = new MutationObserver(() => nameFields(phone));
  watcher.observe(phone, { childList: true, subtree: true });
  $('#mSearch', app).onclick = () => openPalette();
  const page = {
    body: $('#mBody', app),
    foot: $('#mFoot', app),
    // title: what the person recognises (customer and site); sub: the document number and the step, in small text.
    setTitle(title, backRoute, sub = '') {
      $('#mTitle', app).textContent = title;
      const s = $('#mSub', app);
      s.textContent = sub; s.hidden = !sub;
      $('#mBack', app).innerHTML = backRoute ? String(html`<a class="m-icon-btn" href="#/${backRoute}" aria-label="Back">${icon('back', 20)}</a>`) : '';
    },
    setFoot(content) {
      page.foot.innerHTML = content ? String(html`<div class="m-foot">${content}</div>`) : '';
      const left = heldUntil - Date.now();
      if (left > 0) page.foot.querySelectorAll('.btn').forEach(b => holdTap(b, left));
      return page.foot;
    },
  };
  run(page);
  nameFields(phone);
}

// A document on the phone (site viewing report, Work Done form, service report) as it prints, fitted to the
// screen; "Zoom" makes it larger. Used to preview before starting, before the customer signs, and to view it after.
export function openDocSheet(title, sheet, { actions = [] } = {}) {
  return openModal({
    title, cls: 'm-sheet',
    body: html`<div class="row" style="justify-content:flex-end;margin-bottom:6px"><button type="button" class="btn small" data-zoom>Zoom</button></div><div class="m-a4">${sheet}</div>`,
    actions: actions.length ? actions : [{ label: 'Close', kind: 'primary' }],
    onOpen: body => {
      hydrateImages(body);
      body.querySelector('[data-zoom]').onclick = e => { const a4 = body.querySelector('.m-a4'); a4.classList.toggle('big'); e.target.textContent = a4.classList.contains('big') ? 'Fit to screen' : 'Zoom'; };
    },
  });
}
