// Dashboard (web), one per role (the role's dashboard type is set in User Role): Work queue (Operations Executive),
// Approvals (Approver), Management (Management and Admin) and Phone (technicians: open the Mobile view). Every number
// opens its list with the filter already set, and a card shows only if the role may open the list behind it.
// UX audit (findings 3 and 4): the work queue leads with the list of what needs doing; what arrived
// since the last visit is marked "New"; four counters stay on top (all of them are one click away under "All
// counters"); a button in the list either does the step or is called "Open".
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, go, on, tiles, fmtDateTime, fmtDuration, pill, toast, icon } from '../core/ui.js';
import { zoneCode, empName } from '../core/lookups.js';
import { inspectionClock } from '../core/enquiries.js';
import { nextActions, owed, approverStats } from '../core/dashboard.js';
import { seenAt, markSeen } from '../core/notify.js';
import { createEstimate } from '../core/estimates.js';
import { confirmLeave, undoConfirmLeave } from '../core/jobs.js';
import { enquiryTiles, setEnquiryTile } from './enquiry-list.js';
import { clockHtml } from './site-inspection.js';
import { setPaymentsTile } from './payments.js';
import { renderManagement } from './dash-management.js';
import { sendDialog } from './quotation-view.js';
import { pageHead } from './shell.js';
import { switchView } from '../app.js';
import { visitDate, isOverdue } from '../core/visits.js';
import { todayStr, addDays } from '../core/contracts.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = name => String(name || '').replace(/ Pte Ltd| LLC/g, '');

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
    el.innerHTML = String(html`<div class="page">${pageHead({ crumb: 'Dashboard', title: `Welcome, ${u.name}` })}<div class="card" style="max-width:560px">
      <p class="muted" style="margin:0 0 12px">Your role (${r.name}) works on the phone: your jobs, site reports and photos are in the Mobile view.</p>
      <button class="btn primary" id="go">Open the Mobile view</button></div></div>`);
    el.querySelector('#go').onclick = () => switchView('mobile');
    return;
  }
  if (kind === 'management') return renderManagement(el);
  if (kind === 'approvals') return renderApprovals(el);
  return renderWork(el);
}

// What arrived since this person last left the dashboard is "New" (kept while they stay on it).
let leaving = null;
function newSince() {
  const seen = seenAt('home') || new Date(Date.now() - 6 * 3600000).toISOString();
  if (!leaving) {
    leaving = () => { if (location.hash.replace(/^#\/?/, '') !== 'home') { markSeen('home'); window.removeEventListener('hashchange', leaving); leaving = null; } };
    window.addEventListener('hashchange', leaving);
  }
  return seen;
}

function renderWork(el) {
  const u = auth.user(), c = auth.company();
  const seen = newSince();
  const isNew = a => !!a.since && a.since > seen;
  // What arrived since the last visit comes first (in order of urgency), then the rest, most urgent first.
  const all = nextActions();
  const actions = [...all.filter(isNew), ...all.filter(a => !isNew(a))];
  const fresh = actions.filter(isNew).length;
  const state = { all: false };
  const money = auth.can('payment') ? owed() : null;
  const open = auth.can('inspection') ? store.list('inspections', i => ['To assign', 'Assigned', 'Report in progress'].includes(i.status) && auth.seesInspection(i))
    .map(i => ({ i, e: store.get('enquiries', i.enquiryId) })).filter(x => x.e).sort((a, b) => a.e.receivedAt.localeCompare(b.e.receivedAt)) : [];
  const enqTiles = auth.can('enquiry') ? enquiryTiles(store.list('enquiries'), c) : [];
  const work = [
    ...(auth.can('estimation') ? [{ key: 'est|enquiries|', label: 'To estimate', count: actions.filter(a => a.what === 'Estimate to make').length, tone: 'warn', sub: 'site report or the customer\'s list is in' }] : []),
    ...(auth.can('quotation') ? [{ key: 'qt|quotations|send', label: 'Quotations to send', count: store.list('quotations', q => q.status === 'Approved').length, tone: 'warn', sub: 'approved' },
      { key: 'qs|quotations|sent', label: 'Quotations sent', count: store.list('quotations', q => q.status === 'Sent').length, sub: 'waiting for the customer' }] : []),
    ...(auth.can('job') ? [{ key: 'job|jobs|', label: 'Jobs to schedule', count: store.list('jobs', j => j.status === 'To schedule').length, tone: 'warn', sub: 'accepted by the customer' }] : []),
    ...(auth.can('invoice') ? [{ key: 'inv|invoices|draft', label: 'Invoices to post', count: store.list('invoices', i => i.status === 'Draft').length, sub: `${store.list('invoices', i => i.status === 'Draft' && i.contractId).length} maintenance instalments` }] : []),
    ...(money ? [{ key: 'pay|payments|over', label: 'Overdue invoices', count: money.overdueCount, tone: 'bad', sub: `${m2(money.overdue)} owed` }] : []),
    ...(auth.can('amcScheduling') ? [{ key: 'vis|amc-scheduling|', label: 'Maintenance visits to book', count: store.list('amcVisits', v => ['Planned', 'Confirmed'].includes(v.status) && visitDate(v) <= addDays(todayStr(), 30)).length, tone: 'warn', sub: `${store.list('amcVisits', isOverdue).length} overdue` }] : []),
  ];
  // Four counters on top: the queues a person acts on. The rest are under "All counters".
  const waiting = enqTiles.find(t => t.key === 'waiting'), over = enqTiles.find(t => t.key === 'over');
  const top = [
    ...(waiting ? [{ ...waiting, sub: over?.count ? `${over.count} over the ${c.inspectionTargetHours || 2} h target` : waiting.sub, tone: over?.count ? 'bad' : 'warn' }] : []),
    ...['est', 'job', 'pay', 'qt', 'inv', 'vis'].map(k => work.find(w => w.key.startsWith(`${k}|`))).filter(Boolean),
  ].slice(0, 4);

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Dashboard', title: `Welcome, ${u.name}`, sub: `${c.name} · what needs you, most urgent first`,
      actions: auth.can('enquiry', 'create') ? html`<div class="row"><button class="btn" id="paste">${icon('mail', 15)} Paste email</button><a class="btn primary" href="#/enquiries/new">+ New enquiry</a></div>` : '' })}
    ${top.length ? tiles(top, '', 'tiles top4') : ''}
    <div class="card"><div class="card-head"><h2>To do next</h2>${fresh ? html`<span class="new-dot">${fresh} new</span>` : ''}<span class="muted small" id="actCount"></span></div>
      <div id="actions"></div></div>
    <div class="cols2" style="margin-top:12px">
      ${auth.can('inspection') ? html`<div class="card"><div class="card-head"><h2>Job assessments not finished</h2><a href="#/assessments">Open the list</a></div>
        ${open.length ? html`<table class="tbl"><thead><tr><th>Enquiry</th><th>Technician</th><th>Since the call</th></tr></thead><tbody>
          ${open.map(x => html`<tr class="click" data-go="assessments/${x.i.id}"><td class="nowrap"><a class="rowlink" href="#/assessments/${x.i.id}">${x.e.no}</a> <span class="zone-chip">${zoneCode(x.i.zoneId)}</span><div class="small muted">${short(x.e.customerName)}</div></td>
            <td>${empName(x.i.technicianId) || html`<span style="color:var(--red);font-weight:600">Not assigned</span>`}</td><td>${clockHtml(inspectionClock(x.e, c))}</td></tr>`)}
        </tbody></table>` : html`<div class="muted">Nothing waiting.</div>`}</div>` : ''}
      ${money ? html`<div class="card"><div class="card-head"><h2>Money</h2><a href="#/payments">Open the payments</a></div>
        <div class="kv two"><button class="stat click" data-pay="open"><span>Owed to us</span><b>${m2(money.total)}</b><small>${money.count} invoice${money.count === 1 ? '' : 's'}</small></button>
          <button class="stat click" data-pay="over"><span>Overdue</span><b style="color:var(--red-ink)">${m2(money.overdue)}</b><small>${money.overdueCount} invoice${money.overdueCount === 1 ? '' : 's'}</small></button></div></div>` : ''}
    </div>
    <details class="card fold" style="margin-top:12px"><summary><span class="fold-t">All counters</span><span class="fold-s">${enqTiles.length + work.length} figures: enquiries and work, each opens its list</span></summary>
      ${enqTiles.length ? html`<h3 style="margin:10px 0 6px">Enquiries</h3>${tiles(enqTiles, '')}` : ''}
      ${work.length ? html`<h3 style="margin:10px 0 6px">Work</h3>${tiles(work, '', 'tiles money')}` : ''}</details>
  </div>`);

  function paintActions() {
    const list = state.all ? actions : actions.slice(0, 10);
    el.querySelector('#actCount').textContent = `${list.length} of ${actions.length}`;
    el.querySelector('#actions').innerHTML = String(actions.length ? html`<table class="tbl"><thead><tr><th>What</th><th>Document</th><th>Customer</th><th>Detail</th><th>Waiting</th><th></th></tr></thead><tbody>
      ${list.map((a, i) => html`<tr class="click ${isNew(a) ? 'is-new' : ''}" data-go="${a.route}">
        <td>${isNew(a) ? html`<span class="new-dot">New</span>` : ''}${a.rank === 0 ? html`${pill('Overdue', 'red')} ` : ''}<b>${a.what}</b></td>
        <td class="nowrap"><a class="rowlink" href="#/${a.route}">${a.doc}</a></td><td>${short(a.customer)}</td><td>${a.when}</td>
        <td class="nowrap">${a.since && a.since.length > 10 ? fmtDuration(Date.now() - new Date(a.since)) : ''}</td>
        <td style="text-align:right">${a.act ? html`<button class="btn small primary" data-act="${actions.indexOf(a)}" title="Does it now">${a.button}</button>` : html`<a class="btn small" href="#/${a.route}" title="Opens ${a.doc}">Open</a>`}</td></tr>`)}</tbody></table>
      ${actions.length > 10 ? html`<p style="margin:8px 0 0"><button class="btn link" id="more">${state.all ? 'Show the first 10' : `Show all ${actions.length}`}</button></p>` : ''}`
      : html`<div class="muted">Nothing waiting. Well done.</div>`);
  }
  paintActions();

  // A button in the list does its step (finding 3): no second click on another page.
  function act(a) {
    if (a.act === 'estimate') { const x = createEstimate(a.id); toast(`${x.no} created from ${a.doc}`); return go(`estimates/${x.id}`); }
    if (a.act === 'send') return sendDialog(el, store.get('quotations', a.id), () => renderWork(el));
    if (a.act === 'okLeave') {
      const t = store.get('tasks', a.id);
      confirmLeave(a.id);
      toast(`${a.doc}: the technician may leave the site`, '', { undo: () => { if (undoConfirmLeave(t.docId)) { toast('Taken back: the request is waiting again'); renderWork(el); } else toast('Too late to undo: the technician has checked out', 'bad'); } });
      return renderWork(el);
    }
    return go(a.route);
  }
  el.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (b) { e.stopPropagation(); return act(actions[+b.dataset.act]); }
    if (e.target.closest('#more')) { state.all = !state.all; return paintActions(); }
    const tile = e.target.closest('[data-tile]');
    if (tile) {
      const [kind, route, t] = tile.dataset.tile.split('|');
      if (!route) { setEnquiryTile(tile.dataset.tile); return go('enquiries'); }
      if (kind === 'est') { setEnquiryTile('inspected'); return go('enquiries'); }
      return openList(route, t);
    }
    const pay = e.target.closest('[data-pay]');
    if (pay) return openList('payments', pay.dataset.pay);
    const row = e.target.closest('[data-go]');
    if (row && !e.target.closest('a, button')) go(row.dataset.go);
  };
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
      { key: 'time', label: 'Time to decide', count: s.median == null ? '–' : `${Math.round(s.median)} h`, sub: 'median, last 90 days' },
      { key: 'higher', label: 'At a higher level', count: s.higher.length, sub: s.higher.map(t => `${t.docNo} · ${roleName(t.roleCode)}`).join(', ') || 'none' },
    ], '')}
    <div class="card"><div class="card-head"><h2>Waiting for me</h2><a href="#/tasks">Open My tasks</a></div>
      ${s.waiting.length ? html`<table class="tbl"><thead><tr><th>Document</th><th>Customer</th><th>Why it needs you</th><th class="num">Total</th><th>Waiting</th><th></th></tr></thead><tbody>
        ${s.waiting.map(t => html`<tr class="click" data-go="tasks/${t.id}"><td class="nowrap"><a class="rowlink" href="#/tasks/${t.id}">${t.docNo}</a></td><td>${t.customer}</td><td>${t.rules.map(r => pill(r.name, 'blue'))}${t.level > 1 ? ` level ${t.level}` : ''}</td>
          <td class="num">${t.amount == null ? '' : m2(t.amount)}</td><td class="nowrap">${fmtDuration(Date.now() - new Date(t.createdAt))}</td><td style="text-align:right"><a class="btn small" href="#/tasks/${t.id}">Open</a></td></tr>`)}</tbody></table>`
        : html`<div class="muted">Nothing is waiting for you.</div>`}</div>
    <p class="mini-note">Approved since ${fmtDateTime(new Date(Date.now() - 90 * 86400000).toISOString()).slice(0, 11)}: ${s.decided - s.returned}.</p>
  </div>`);
  on(el, 'click', '[data-go]', (e, t) => { if (!e.target.closest('a')) go(t.dataset.go); });
  on(el, 'click', '[data-tile]', (e, b) => { if (b.dataset.tile === 'wait' || b.dataset.tile === 'higher') go('tasks'); });
}
