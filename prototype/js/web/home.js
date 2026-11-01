// Dashboard (web), one per role (the role's dashboard type is set in User Role): Work queue (Operations Executive),
// Approvals (Approver), Management (Management and Admin) and Phone (technicians: open the Mobile view). Every number
// opens its list with the filter already set, and a card shows only if the role may open the list behind it.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, go, on, tiles, fmtDateTime, fmtDuration, pill } from '../core/ui.js';
import { zoneCode, empName } from '../core/lookups.js';
import { inspectionClock } from '../core/enquiries.js';
import { nextActions, owed, approverStats } from '../core/dashboard.js';
import { enquiryTiles, setEnquiryTile } from './enquiry-list.js';
import { clockHtml } from './site-inspection.js';
import { setPaymentsTile } from './payments.js';
import { renderManagement } from './dash-management.js';
import { pageHead } from './shell.js';
import { switchView } from '../app.js';
import { visitDate, isOverdue } from '../core/visits.js';
import { todayStr, addDays } from '../core/contracts.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Open a list page with one of its count tiles switched on (the list pages keep their filter under these keys).
export function openList(route, tile = '') {
  const keys = { estimates: 'rsmEstList', quotations: 'rsmQtList', invoices: 'rsmInvList', contracts: 'rsmContractList', 'amc-visits': 'rsmVisitList', closure: 'rsmClosure', 'amc-scheduling': 'rsmAmcSched' };
  if (route === 'payments') setPaymentsTile(tile);
  else if (keys[route]) { let s = {}; try { s = JSON.parse(sessionStorage.getItem(keys[route])) || {}; } catch { /* fresh */ } sessionStorage.setItem(keys[route], JSON.stringify({ ...s, tile, q: '' })); }
  go(route);
}

export function renderHome(el) {
  const u = auth.user(), r = auth.role();
  const kind = r.dashboard || 'work';
  if (kind === 'phone' || !auth.webMenus().length) {
    el.innerHTML = String(html`<div class="page"><div class="card" style="max-width:560px"><h1>Welcome, ${u.name}</h1>
      <p class="muted" style="margin:8px 0 12px">Your role (${r.name}) works on the phone: your jobs, site reports and photos are in the Mobile view.</p>
      <button class="btn primary" id="go">Open the Mobile view</button></div></div>`);
    el.querySelector('#go').onclick = () => switchView('mobile');
    return;
  }
  if (kind === 'management') return renderManagement(el);
  if (kind === 'approvals') return renderApprovals(el);
  return renderWork(el);
}

function renderWork(el) {
  const u = auth.user(), c = auth.company();
  const actions = nextActions();
  const money = auth.can('payment') ? owed() : null;
  const open = auth.can('inspection') ? store.list('inspections', i => ['To assign', 'Assigned', 'Report in progress'].includes(i.status) && auth.seesInspection(i))
    .map(i => ({ i, e: store.get('enquiries', i.enquiryId) })).filter(x => x.e).sort((a, b) => a.e.receivedAt.localeCompare(b.e.receivedAt)) : [];
  const work = [
    ...(auth.can('estimation') ? [{ key: 'est|enquiries|', label: 'To estimate', count: actions.filter(a => a.what === 'Estimate to make').length, tone: 'warn', sub: 'site report or BOQ in' }] : []),
    ...(auth.can('quotation') ? [{ key: 'qt|quotations|send', label: 'Quotations to send', count: store.list('quotations', q => q.status === 'Approved').length, tone: 'warn', sub: 'counter-checked' },
      { key: 'qs|quotations|sent', label: 'Quotations sent', count: store.list('quotations', q => q.status === 'Sent').length, sub: 'waiting for the customer' }] : []),
    ...(auth.can('job') ? [{ key: 'job|jobs|', label: 'Jobs to schedule', count: store.list('jobs', j => j.status === 'To schedule').length, tone: 'warn' }] : []),
    ...(auth.can('invoice') ? [{ key: 'inv|invoices|draft', label: 'Invoices to post', count: store.list('invoices', i => i.status === 'Draft').length, sub: `${store.list('invoices', i => i.status === 'Draft' && i.contractId).length} AMC instalments` }] : []),
    ...(money ? [{ key: 'pay|payments|over', label: 'Overdue invoices', count: money.overdueCount, tone: 'bad', sub: `${m2(money.overdue)} owed` }] : []),
    ...(auth.can('amcScheduling') ? [{ key: 'vis|amc-scheduling|', label: 'AMC visits to book', count: store.list('amcVisits', v => ['Planned', 'Confirmed'].includes(v.status) && visitDate(v) <= addDays(todayStr(), 30)).length, tone: 'warn', sub: `${store.list('amcVisits', isOverdue).length} overdue` }] : []),
  ];

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Dashboard', title: `Welcome, ${u.name}`, sub: `${c.name} · what needs you, most urgent first`,
      actions: auth.can('enquiry', 'create') ? html`<div class="row"><button class="btn" id="paste">✉ Paste email</button><a class="btn primary" href="#/enquiries/new">+ New enquiry</a></div>` : '' })}
    ${auth.can('enquiry') ? html`<h2 style="margin:4px 0 8px">Enquiries</h2>${tiles(enquiryTiles(store.list('enquiries'), c), '')}` : ''}
    ${work.length ? html`<h2 style="margin:10px 0 8px">Work</h2>${tiles(work, '', 'tiles money')}` : ''}
    <div class="split" style="grid-template-columns:minmax(0,2.3fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>Next actions</h2><span class="muted small">${Math.min(12, actions.length)} of ${actions.length} · most urgent first</span></div>
        ${actions.length ? html`<table class="tbl"><thead><tr><th>What</th><th>Document</th><th>Customer</th><th>When</th><th></th></tr></thead><tbody>
          ${actions.slice(0, 12).map(a => html`<tr class="click" data-go="${a.route}"><td class="w">${a.rank === 0 ? html`${pill('Overdue', 'red')} ` : ''}${a.what}</td><td class="w">${a.doc}</td><td class="w">${a.customer.replace(/ Pte Ltd| LLC/g, '')}</td><td class="w">${a.when}</td>
            <td style="text-align:right"><button class="btn small ${a.rank === 1 ? 'primary' : ''}" data-go="${a.route}">${a.button}</button></td></tr>`)}</tbody></table>`
          : html`<div class="muted">Nothing waiting. Well done.</div>`}</div>
      <div>
        ${auth.can('inspection') ? html`<div class="card"><div class="card-head"><h2>Site inspections not finished</h2><a href="#/inspections">Open the list</a></div>
          ${open.length ? html`<table class="tbl"><thead><tr><th>Enquiry</th><th>Since the call</th></tr></thead><tbody>
            ${open.map(x => html`<tr class="click" data-go="inspections/${x.i.id}"><td class="lnk">${x.e.no} <span class="zone-chip">${zoneCode(x.i.zoneId)}</span><br><span class="muted small">${empName(x.i.technicianId) || 'no technician'}</span></td><td class="w">${clockHtml(inspectionClock(x.e, c))}</td></tr>`)}
          </tbody></table>` : html`<div class="muted">Nothing waiting.</div>`}</div>` : ''}
        ${money ? html`<div class="card"><div class="card-head"><h2>Money</h2><a href="#/payments">Payment Collection</a></div>
          <div class="kv two"><div class="click" data-pay="open"><div class="k">Owed to us</div><div class="v"><b>${m2(money.total)}</b> · ${money.count} invoice${money.count === 1 ? '' : 's'}</div></div>
            <div class="click" data-pay="over"><div class="k">Overdue</div><div class="v" style="color:var(--red-ink)"><b>${m2(money.overdue)}</b> · ${money.overdueCount} invoice${money.overdueCount === 1 ? '' : 's'}</div></div></div></div>` : ''}
      </div>
    </div></div>`);

  on(el, 'click', '[data-tile]', (e, b) => {
    const [kind, route, tile] = b.dataset.tile.split('|');
    if (!route) { setEnquiryTile(b.dataset.tile); return go('enquiries'); }
    if (kind === 'est') { setEnquiryTile(''); return go('enquiries'); }
    return openList(route, tile);
  });
  on(el, 'click', '[data-go]', (e, t) => { e.stopPropagation(); go(t.dataset.go); });
  on(el, 'click', '[data-pay]', (e, t) => openList('payments', t.dataset.pay));
  el.querySelector('#paste')?.addEventListener('click', () => { sessionStorage.setItem('rsmOpenPaste', '1'); go('enquiries/new'); });
}

function renderApprovals(el) {
  const u = auth.user(), c = auth.company();
  const s = approverStats();
  const roleName = code => store.findOne('roles', r => r.code === code)?.name || code;
  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Dashboard', title: `Welcome, ${u.name}`, sub: `${c.name} · quotations and payment terms waiting for you` })}
    ${tiles([
      { key: 'wait', label: 'Waiting for me', count: s.waiting.length, tone: 'warn', sub: s.waiting[0] ? `oldest ${fmtDuration(Date.now() - new Date(s.waiting[0].createdAt))}` : 'nothing waiting' },
      { key: 'done', label: 'Decided, last 90 days', count: s.decided, sub: `${s.decided - s.returned} approved · ${s.returned} returned` },
      { key: 'time', label: 'Time to decide', count: s.median == null ? '—' : `${Math.round(s.median)} h`, sub: 'median, last 90 days' },
      { key: 'higher', label: 'At a higher level', count: s.higher.length, sub: s.higher.map(t => `${t.docNo} · ${roleName(t.roleCode)}`).join(', ') || 'none' },
    ], '')}
    <div class="card"><div class="card-head"><h2>Waiting for me</h2><a href="#/tasks">Open My tasks</a></div>
      ${s.waiting.length ? html`<table class="tbl"><thead><tr><th>Document</th><th>Customer</th><th>Check</th><th class="num">Total</th><th>Waiting</th></tr></thead><tbody>
        ${s.waiting.map(t => html`<tr class="click" data-go="tasks/${t.id}"><td class="lnk">${t.docNo}</td><td>${t.customer}</td><td>${t.rules.map(r => pill(r.name, 'blue'))}${t.level > 1 ? ` level ${t.level}` : ''}</td>
          <td class="num">${t.amount == null ? '' : m2(t.amount)}</td><td>${fmtDuration(Date.now() - new Date(t.createdAt))}</td></tr>`)}</tbody></table>`
        : html`<div class="muted">Nothing is waiting for you.</div>`}</div>
    <p class="mini-note">Approved since ${fmtDateTime(new Date(Date.now() - 90 * 86400000).toISOString()).slice(0, 11)}: ${s.decided - s.returned}.</p>
  </div>`);
  on(el, 'click', '[data-go]', (e, t) => go(t.dataset.go));
  on(el, 'click', '[data-tile]', (e, b) => { if (b.dataset.tile === 'wait' || b.dataset.tile === 'higher') go('tasks'); });
}
