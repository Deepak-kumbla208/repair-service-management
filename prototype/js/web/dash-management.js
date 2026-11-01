// Management dashboard (also the Admin's, with "Setup to finish" and the tasks waiting). Period and zone filters change
// every figure; every figure opens its list. Revenue = posted invoices before tax (core/dashboard.js has the rules).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, on, go, fmtDate } from '../core/ui.js';
import { zones } from '../core/lookups.js';
import { revenue, revenueByMonth, conversion, owed, amcEnding, visitsOverdue, rating, ratingsByTech, stages, byZone } from '../core/dashboard.js';
import { setupToFinish, isAdminRole } from '../core/setup.js';
import { myTasks } from '../core/workflow.js';
import { setEnquiryFilters } from './enquiry-list.js';
import { openList } from './home.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';

const KEY = 'rsmDash';
const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = ym => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const PERIODS = [['month', 'This month'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months']];

function state() { try { return { period: '12m', zone: '', ...JSON.parse(sessionStorage.getItem(KEY)) }; } catch { return { period: '12m', zone: '' }; } }

const stat = (label, value, sub, go, bad = false) => html`<button class="stat click" ${go ? html`data-open="${go}"` : ''} title="${go ? 'Open the list' : ''}"><span>${label}</span><b>${value}</b><small class="${bad ? 'bad' : ''}">${sub}</small></button>`;

export function renderManagement(el) {
  const s = state(), c = auth.company(), r = auth.role();
  const z = s.zone;
  const pname = PERIODS.find(p => p[0] === s.period)[1].toLowerCase();
  const months = revenueByMonth(s.period, z);
  const max = Math.max(1, ...months.map(m => m.amount));
  const thisMonth = months[months.length - 1];
  const conv = conversion(s.period, z), money = owed(z), ending = amcEnding(z), late = visitsOverdue(z), rate = rating(s.period, z);
  const st = stages(s.period, z), stMax = Math.max(1, ...st.map(x => x.count));
  const zr = byZone(s.period).filter(x => !z || x.zone.id === z);
  const sum = k => zr.reduce((t, x) => t + x[k], 0);
  const bMax = Math.max(1, ...Object.values(money.buckets));
  const admin = isAdminRole(r);
  const todo = admin ? setupToFinish(c) : [];
  const tasks = admin ? myTasks() : [];
  const can = m => auth.can(m);

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    ${pageHead({ crumb: 'Dashboard', title: admin ? `Welcome, ${auth.user().name}` : 'Management', sub: `${c.name} · revenue = posted invoices before ${c.taxLabel || 'tax'} · ${c.currency}` })}
    <div class="filters"><span class="chips">${PERIODS.map(([v, l]) => html`<label class="chip"><input type="radio" name="period" value="${v}" ${s.period === v ? 'checked' : ''}><span>${l}</span></label>`)}</span>
      <span class="chips"><label class="chip"><input type="radio" name="zone" value="" ${!z ? 'checked' : ''}><span>All zones</span></label>${zones().map(x => html`<label class="chip"><input type="radio" name="zone" value="${x.id}" ${z === x.id ? 'checked' : ''}><span>${x.code}</span></label>`)}</span></div>
    ${admin && (todo.length || tasks.length) ? html`<div class="split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);margin-bottom:12px">
      ${todo.length ? html`<div class="card"><div class="card-head"><h2>Setup to finish</h2><a href="#/admin/companySetup">Company Setup</a></div>
        <ul class="chk">${todo.map(t => html`<li><span class="wn">!</span><span>${t.text} <span class="muted">· ${t.where}</span></span></li>`)}</ul></div>` : html`<div></div>`}
      ${tasks.length ? html`<div class="card"><div class="card-head"><h2>Tasks waiting (${tasks.length})</h2><a href="#/tasks">Open My tasks</a></div>
        <ul class="chk">${tasks.slice(0, 4).map(t => html`<li class="click" data-go="tasks/${t.id}"><span class="wn">•</span><span>${t.docNo} · ${t.title} <span class="muted">· ${t.roleName}</span></span></li>`)}</ul></div>` : html`<div></div>`}</div>` : ''}
    <div class="dgrid" style="grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:12px">
      ${can('invoice') ? stat(`Revenue, ${pname}`, m2(revenue(s.period, z)), `${monthName(thisMonth.month)} ${m2(thisMonth.amount)} so far`, 'invoices|') : ''}
      ${can('quotation') ? stat('Conversion', conv.pct == null ? '—' : `${conv.pct} %`, `${conv.won} accepted of ${conv.decided} decided`, 'quotations|won') : ''}
      ${can('payment') ? stat('Money owed', m2(money.total), `${m2(money.overdue)} overdue`, 'payments|open', money.overdue > 0) : ''}
      ${can('amcContract') ? stat('AMC ending in 60 days', ending.length, ending[0] ? `${ending[0].customer.replace(/ Pte Ltd| LLC/, '')} · ${fmtDate(ending[0].end)}` : 'none', 'contracts|ending') : ''}
      ${can('amcScheduling') ? stat('AMC visits overdue', late.length, late.length ? [...new Set(late.map(v => v.customer.replace(/ Pte Ltd| LLC/, '')))].join(', ') : 'none', 'amc-scheduling|overdue', late.length > 0) : ''}
      ${can('closure') ? stat('Customer rating', rate.avg == null ? '—' : rate.avg, `of 5 · ${rate.count} sign-offs`, 'closure|closed') : ''}
    </div>
    <div class="dgrid">
      ${can('invoice') ? html`<div class="card" style="grid-column:span 2"><div class="card-head"><h2>Revenue by month</h2><span class="muted small">before tax · hover a bar · click to open the invoices</span></div>
        <div class="vbars">${months.map((m, i) => html`<div class="click" data-open="invoices|" title="${monthName(m.month)}: ${m2(m.amount)}">${m.amount ? short(m.amount) : ''}<i style="height:${Math.round((m.amount / max) * 100)}%;${i === months.length - 1 ? 'opacity:.55' : ''}"></i></div>`)}</div>
        <div class="vlab">${months.map((m, i) => html`<span>${MONTHS[Number(m.month.slice(5)) - 1]}${i === months.length - 1 ? '*' : ''}</span>`)}</div>
        <p class="mini-note">* this month so far (lighter bar)</p></div>` : ''}
      ${can('payment') ? html`<div class="card"><div class="card-head"><h2>Money owed by age</h2><span class="muted small">days since the invoice</span></div>
        ${Object.entries(money.buckets).map(([k, v]) => html`<div class="hb click" data-open="payments|open"><span>${k}</span><i style="width:${Math.round((v / bMax) * 100)}%"></i><em>${m2(v)}</em></div>`)}</div>` : ''}
    </div>
    <div class="split" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>By zone</h2><span class="muted small">${pname}</span></div>
        <table class="tbl"><thead><tr><th>Zone</th><th class="num">Enquiries</th><th class="num">Jobs done</th><th class="num">Revenue</th><th class="num">Transport cost</th><th class="num">AMC visits done / due</th></tr></thead><tbody>
          ${zr.map(x => html`<tr class="click" data-zone="${x.zone.id}" title="Open the enquiries of Zone ${x.zone.code}"><td><span class="zone-chip">${x.zone.code}</span> ${x.zone.name}</td><td class="num">${x.enquiries}</td><td class="num">${x.jobsDone}</td><td class="num">${m2(x.revenue)}</td><td class="num">${m2(x.transport)}</td>
            <td class="num">${x.visitsDone} / ${x.visitsDue}${x.visitsLate ? html` <span class="pill red">${x.visitsLate} late</span>` : ''}</td></tr>`)}
          ${zr.length > 1 ? html`<tr class="sum"><td><b>All zones</b></td><td class="num"><b>${sum('enquiries')}</b></td><td class="num"><b>${sum('jobsDone')}</b></td><td class="num"><b>${m2(sum('revenue'))}</b></td><td class="num"><b>${m2(sum('transport'))}</b></td><td class="num"><b>${sum('visitsDone')} / ${sum('visitsDue')}</b></td></tr>` : ''}
        </tbody></table><p class="mini-note">Revenue counts AMC instalments too; transport cost comes from the estimates of the jobs done.</p></div>
      <div>
        <div class="card"><div class="card-head"><h2>Ratings per technician</h2><span class="muted small">${pname}</span></div>
          <table class="tbl"><thead><tr><th>Technician</th><th class="num">Average</th><th class="num">Sign-offs</th></tr></thead><tbody>
            ${ratingsByTech(s.period, z).map(t => html`<tr><td>${t.name}</td><td class="num">${t.avg ?? '—'}</td><td class="num">${t.count}</td></tr>`)}</tbody></table>
          <p class="mini-note">Overall rating on Work Done forms and AMC / GS sign-offs.</p></div>
        ${can('enquiry') ? html`<div class="card"><div class="card-head"><h2>Enquiries by stage</h2><span class="muted small">received ${pname}</span></div>
          ${st.map(x => html`<div class="hb click" data-stage="${x.stage}" title="Open these enquiries"><span>${x.stage}</span><i style="width:${Math.round((x.count / stMax) * 100)}%"></i><em>${x.count}</em></div>`)}</div>` : ''}
      </div>
    </div></div>`);

  const save = patch => { sessionStorage.setItem(KEY, JSON.stringify({ ...s, ...patch })); render(); };
  el.querySelectorAll('[name=period]').forEach(i => i.addEventListener('change', () => save({ period: i.value })));
  el.querySelectorAll('[name=zone]').forEach(i => i.addEventListener('change', () => save({ zone: i.value })));
  on(el, 'click', '[data-open]', (e, b) => { const [route, tile] = b.dataset.open.split('|'); openList(route, tile); });
  on(el, 'click', '[data-stage]', (e, b) => { setEnquiryFilters({ stage: b.dataset.stage, zone: z }); go('enquiries'); });
  on(el, 'click', '[data-zone]', (e, tr) => { setEnquiryFilters({ zone: tr.dataset.zone }); go('enquiries'); });
  on(el, 'click', '[data-go]', (e, t) => go(t.dataset.go));
}
