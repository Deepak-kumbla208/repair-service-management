// Dashboard (web). Stretch 1 shows each role's waiting work; full role dashboards come in Stretch 3.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, go, on, tiles, fmtDateTime, pill } from '../core/ui.js';
import { zoneCode, empName } from '../core/lookups.js';
import { inspectionClock } from '../core/enquiries.js';
import { enquiryTiles, setEnquiryTile } from './enquiry-list.js';
import { clockHtml } from './site-inspection.js';
import { pageHead } from './shell.js';
import { switchView } from '../app.js';
import { myTasks } from '../core/workflow.js';
import { openInvoices } from '../core/billing.js';
import { canCreateFor } from '../core/estimates.js';

export function renderHome(el) {
  const u = auth.user(), r = auth.role(), c = auth.company();
  if (!auth.webMenus().length) {
    el.innerHTML = String(html`<div class="page"><div class="card" style="max-width:560px"><h1>Welcome, ${u.name}</h1>
      <p class="muted" style="margin:8px 0 12px">Your role (${r.name}) works on the phone: your jobs, site reports and photos are in the Mobile view.</p>
      <button class="btn primary" id="go">Open the Mobile view</button></div></div>`);
    el.querySelector('#go').onclick = () => switchView('mobile');
    return;
  }
  const enquiries = store.list('enquiries');
  const tasks = auth.hasTasks('web') ? myTasks() : [];
  const open = store.list('inspections', i => ['To assign', 'Assigned', 'Report in progress'].includes(i.status) && auth.seesInspection(i))
    .map(i => ({ i, e: store.get('enquiries', i.enquiryId) })).filter(x => x.e)
    .sort((a, b) => a.e.receivedAt.localeCompare(b.e.receivedAt));

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Dashboard', title: `Welcome, ${u.name}`, sub: `${r.name !== u.name ? `${r.name} · ` : ''}${c.name}. Full dashboards for each role come in Stretch 3.`,
      actions: auth.can('enquiry', 'create') ? html`<div class="row"><button class="btn" id="paste">✉ Paste email</button><a class="btn primary" href="#/enquiries/new">+ New enquiry</a></div>` : '' })}
    ${auth.can('enquiry') ? html`<h2 style="margin:4px 0 8px">Enquiries</h2>${tiles(enquiryTiles(enquiries, c), '')}` : ''}
    ${auth.can('inspection') ? html`<div class="card"><div class="card-head"><h2>Site inspections not finished</h2><a href="#/inspections">Open the list</a></div>
      ${open.length ? html`<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Enquiry No</th><th>Customer</th><th>Zone</th><th>Technician</th><th>Visit</th><th>Since the call</th><th>Status</th></tr></thead><tbody>
        ${open.map(x => html`<tr class="click" data-go="inspections/${x.i.id}"><td class="lnk">${x.e.no}</td><td>${x.e.customerName}</td><td><span class="zone-chip">${zoneCode(x.i.zoneId)}</span></td>
          <td>${empName(x.i.technicianId) || '—'}</td><td>${fmtDateTime(x.i.visitAt)}</td><td style="min-width:200px">${clockHtml(inspectionClock(x.e, c))}</td><td>${pill(x.i.status)}</td></tr>`)}
      </tbody></table></div>` : html`<div class="muted">Nothing waiting.</div>`}</div>` : ''}
    ${auth.hasTasks('web') ? html`<div class="card"><div class="card-head"><h2>My tasks</h2><a href="#/tasks">Open my tasks</a></div>
      ${tasks.length ? html`<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Document</th><th>Task</th><th>Customer</th><th>Waiting since</th></tr></thead><tbody>
        ${tasks.map(t => html`<tr class="click" data-go="tasks"><td class="lnk">${t.docNo}</td><td>${t.title}</td><td>${t.customer}</td><td>${fmtDateTime(t.createdAt)}</td></tr>`)}</tbody></table></div>` : html`<div class="muted">Nothing is waiting for you.</div>`}</div>` : ''}
    ${auth.can('estimation') || auth.can('job') || auth.can('payment') ? html`<h2 style="margin:14px 0 8px">Money side of repair jobs</h2>${tiles([
      ...(auth.can('estimation') ? [{ key: 'est', label: 'Inspected, to estimate', count: enquiries.filter(canCreateFor).length, tone: 'warn', sub: 'click to open the estimates' }] : []),
      ...(auth.can('quotation') ? [{ key: 'qt', label: 'Quotations to send', count: store.list('quotations', q => q.status === 'Approved').length, tone: 'warn', sub: 'counter-checked' }] : []),
      ...(auth.can('job') ? [{ key: 'job', label: 'Jobs to schedule', count: store.list('jobs', j => j.status === 'To schedule').length, tone: 'warn' }] : []),
      ...(auth.can('invoice') ? [{ key: 'inv', label: 'Invoices to post', count: store.list('invoices', i => i.status === 'Draft').length }] : []),
      ...(auth.can('payment') ? [{ key: 'pay', label: 'Overdue invoices', count: openInvoices().filter(o => o.dueIn < 0).length, tone: 'bad' }] : []),
    ], '', 'tiles money')}` : ''}
  </div>`);

  const MONEY = { est: 'estimates', qt: 'quotations', job: 'jobs', inv: 'invoices', pay: 'payments' };
  on(el, 'click', '[data-tile]', (e, b) => { if (MONEY[b.dataset.tile]) return go(MONEY[b.dataset.tile]); setEnquiryTile(b.dataset.tile); go('enquiries'); });
  on(el, 'click', '[data-go]', (e, tr) => go(tr.dataset.go));
  el.querySelector('#paste')?.addEventListener('click', () => { sessionStorage.setItem('rsmOpenPaste', '1'); go('enquiries/new'); });
}
