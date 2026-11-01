// AMC Scheduling: every visit of the active contracts by month and zone. The year strip shows the months ahead per
// zone; the month calendar shows each visit (dashed = Planned, light = Confirmed, solid = Scheduled, red = overdue).
// The left list holds what needs action; "Confirm & assign" takes the suggestion (zone technician, first free time,
// helper) and the customer's agreement in one step. Repair jobs and inspections are checked for clashes.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, on, fmtDate, pill, toast, openModal, readForm, chipGroup, tiles, debounce } from '../core/ui.js';
import { zones, zoneCode, technicians, empName } from '../core/lookups.js';
import { refreshAmc, todayStr, addMonths } from '../core/contracts.js';
import { suggestVisit, scheduleVisit, scheduleVisitProblems, confirmVisitDate, isOverdue, visitDate, perDayHours, OPEN_VISIT, DONE_VISIT } from '../core/visits.js';
import { fmtHour, helpers, isWorkday } from '../core/jobs.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';

const KEY = 'rsmAmcSched';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZCLS = { A: 'zA', B: 'zB', C: 'zC', D: 'zD' };
const ym = ds => ds.slice(0, 7);
const VIA = ['Phone', 'WhatsApp', 'Email'];
const short = ds => { const d = new Date(`${ds}T00:00`); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const slotText = s => (s ? `${empName(s.technicianId)}${s.helperIds?.length ? ` + ${empName(s.helperIds[0])}` : ''} · ${short(s.date)} ${fmtHour(s.start)}–${fmtHour(s.start + s.hours)}${s.days > 1 ? ` (${s.days} days)` : ''}` : 'No free slot in the next 3 weeks');

export function renderAmcScheduling(el) {
  refreshAmc();
  const state = { zone: '', month: ym(todayStr()), tile: '', q: '' };
  try { Object.assign(state, JSON.parse(sessionStorage.getItem(KEY)) || {}); } catch { /* fresh */ }
  const edit = auth.can('amcScheduling', 'edit');
  const all = store.list('amcVisits', v => v.status !== 'Cancelled' && store.get('contracts', v.contractId));
  const t = todayStr();
  const zs = zones();
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter(v => (!state.zone || v.zoneId === state.zone) && terms.every(x => [v.contractNo, v.customer, v.site, empName(v.technicianId)].join(' ').toLowerCase().includes(x)));
  const tileDefs = [
    { key: 'planned', label: 'Planned', sub: 'to confirm', test: v => v.status === 'Planned' && !isOverdue(v) },
    { key: 'confirmed', label: 'Confirmed', sub: 'to assign', tone: 'warn', test: v => v.status === 'Confirmed' && !isOverdue(v) },
    { key: 'scheduled', label: 'Scheduled', test: v => v.status === 'Scheduled' && !isOverdue(v) },
    { key: 'overdue', label: 'Overdue', sub: 'date passed, not done', tone: 'bad', test: isOverdue },
    { key: 'done', label: 'Done this month', test: v => DONE_VISIT.includes(v.status) && ym(v.signoff?.signedAt?.slice(0, 10) || '') === ym(t) },
  ].map(d => ({ ...d, count: shown.filter(d.test).length }));
  const tile = tileDefs.find(d => d.key === state.tile);
  const months = Array.from({ length: 12 }, (_, i) => ym(addMonths(`${ym(t)}-01`, i)));
  const inMonth = v => ym(visitDate(v)) === state.month || (v.blocks || []).some(b => ym(b.date) === state.month);
  const action = shown.filter(v => (tile ? tile.test(v) : (isOverdue(v) || (['Planned', 'Confirmed'].includes(v.status) && inMonth(v)))))
    .sort((a, b) => (isOverdue(b) - isOverdue(a)) || visitDate(a).localeCompare(visitDate(b)));
  const [yy, mm] = state.month.split('-').map(Number);

  // Month grid of the company's working days (Company Setup), Monday first.
  const cells = [];
  const last = new Date(yy, mm, 0);
  const d = new Date(yy, mm - 1, 1 - ((new Date(yy, mm - 1, 1).getDay() + 6) % 7)); // the Monday on or before the 1st
  while (d <= last || d.getDay() !== 1) { if (isWorkday(d)) cells.push(new Date(d)); d.setDate(d.getDate() + 1); }
  const heads = [1, 2, 3, 4, 5, 6, 0].filter(n => cells.some(c => c.getDay() === n)).map(n => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n]);
  const ds = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const onDay = day => shown.filter(v => (v.blocks?.length ? v.blocks.some(b => b.date === day) : visitDate(v) === day));
  const block = v => {
    const late = isOverdue(v), done = DONE_VISIT.includes(v.status);
    const cls = late ? 'vb late' : `vb ${ZCLS[zoneCode(v.zoneId)] || 'zA'} ${v.status === 'Planned' ? 'plan' : ''} ${v.status === 'Confirmed' ? 'conf' : ''} ${done ? 'done' : ''}`;
    return html`<a class="${cls}" href="#/amc-visits/${v.id}" title="${v.contractNo} · visit ${v.n} of ${v.of} · ${v.status}${v.technicianId ? ` · ${empName(v.technicianId)}` : ''}">${done ? '✓ ' : ''}${v.customer.replace(/ Pte Ltd| LLC/, '')} · ${v.n} of ${v.of}${v.technicianId && !done ? ` · ${empName(v.technicianId).replace('Technician ', 'Tech ')}` : ''}</a>`;
  };

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    ${pageHead({ crumb: 'Transactions', title: 'AMC Scheduling', sub: 'Visits of the active contracts. Repair jobs and inspections are checked for clashes.' })}
    ${tiles(tileDefs, state.tile)}
    <div class="filters"><input type="search" class="search" id="q" placeholder="Search customer, contract, site, technician" value="${state.q}">
      ${chipGroup('zone', [{ value: '', label: 'All zones' }, ...zs.map(z => ({ value: z.id, label: z.code }))], state.zone)}
      ${state.tile ? html`<button class="btn link" id="clear">Clear filter</button>` : ''}</div>
    <div class="tbl-wrap" style="max-height:none;margin-bottom:12px"><table class="ycal"><thead><tr><th>Visits</th>${months.map(m => html`<th>${MONTHS[Number(m.slice(5)) - 1]}${m.endsWith('-01') || m === months[0] ? ` ${m.slice(2, 4)}` : ''}</th>`)}</tr></thead><tbody>
      ${zs.filter(z => !state.zone || z.id === state.zone).map(z => html`<tr><td><span class="zch ${ZCLS[z.code] || ''}"></span>Zone ${z.code} · ${z.name}</td>${months.map(m => {
        const vs = shown.filter(v => v.zoneId === z.id && ym(visitDate(v)) === m);
        const late = vs.some(isOverdue);
        return html`<td class="${m === state.month ? 'on' : ''}" data-month="${m}">${vs.length ? html`<span class="n ${late ? 'late' : ''}">${vs.length}</span>` : ''}</td>`; })}</tr>`)}
      <tr><td><b>All zones</b></td>${months.map(m => html`<td class="${m === state.month ? 'on' : ''}" data-month="${m}"><b>${shown.filter(v => ym(visitDate(v)) === m).length || ''}</b></td>`)}</tr>
    </tbody></table></div>
    <div class="board">
      <div><div class="muted small" style="margin-bottom:6px">${tile ? tile.label.toUpperCase() : 'NEEDS ACTION'} · ${action.length}</div>
        ${action.length ? html`${action.map(v => visitCard(v, edit))}` : html`<div class="card"><div class="empty">Nothing to confirm or assign${tile ? ' here' : ' this month'}.</div></div>`}</div>
      <div>
        <div class="row" style="margin-bottom:6px"><button class="btn small" data-step="-1">‹</button><b style="font-size:14px">${MONTHS[mm - 1]} ${yy}</b><button class="btn small" data-step="1">›</button>
          ${state.month !== ym(t) ? html`<button class="btn link small" data-month="${ym(t)}">This month</button>` : ''}<span class="grow"></span>
          <span class="legend">${zs.map(z => html`<span><i class="${ZCLS[z.code] || ''}"></i>${z.code}</span>`)}</span></div>
        <div class="mcal" style="grid-template-columns:repeat(${heads.length}, minmax(0, 1fr))">${heads.map(h => html`<div class="hd">${h}</div>`)}
          ${cells.map(d => { const day = ds(d); return html`<div class="c ${d.getMonth() !== mm - 1 ? 'out' : ''} ${day === t ? 'today' : ''}"><div class="d">${d.getDate()}${day === t ? ' · today' : ''}</div>${onDay(day).map(block)}</div>`; })}</div>
        <p class="mini-note">A visit longer than one working day shows on each of its days. Click a visit to open it.</p>
      </div>
    </div>
  </div>`);

  const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));
  on(el, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; save(); render(); });
  on(el, 'click', '[data-month]', (e, b) => { state.month = b.dataset.month; save(); render(); });
  on(el, 'click', '[data-step]', (e, b) => { state.month = ym(addMonths(`${state.month}-01`, Number(b.dataset.step))); save(); render(); });
  $('#clear', el)?.addEventListener('click', () => { state.tile = ''; save(); render(); });
  el.querySelectorAll('[name="zone"]').forEach(r => r.addEventListener('change', () => { state.zone = r.value; save(); render(); }));
  // Filter as you type; the page re-renders, so the cursor is put back in the search box.
  $('#q', el).addEventListener('input', debounce(e => {
    state.q = e.target.value; save(); render();
    const q = document.getElementById('q'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length);
  }, 250));
  on(el, 'click', '[data-quick]', (e, b) => {
    const v = store.get('amcVisits', b.dataset.quick);
    const s = suggestVisit(v);
    if (!s) { toast('No free slot found: use Change', 'bad'); return; }
    const r = scheduleVisit(v.id, { ...s, via: v.confirmedVia || 'Phone' });
    if (r.problems.length) { toast(r.problems[0], 'bad'); return; }
    toast(`${v.contractNo} visit ${v.n}: ${slotText(s)}`); render();
  });
  on(el, 'click', '[data-change]', (e, b) => visitDialog(store.get('amcVisits', b.dataset.change)));
  on(el, 'click', '[data-confirm]', (e, b) => confirmDialog(store.get('amcVisits', b.dataset.confirm)));
}

function visitCard(v, edit) {
  const late = isOverdue(v);
  const s = OPEN_VISIT.includes(v.status) && v.status !== 'Scheduled' ? suggestVisit(v) : null;
  return html`<div class="vcard ${late ? 'late' : ''}" style="--zc:${{ A: '#378ADD', B: '#1D9E75', C: '#BA7517', D: '#7F77DD' }[zoneCode(v.zoneId)] || '#378ADD'}">
    <div class="row"><b>${v.customer}</b><span class="grow"></span>${late ? pill(`Overdue ${Math.round((new Date(`${todayStr()}T00:00`) - new Date(`${visitDate(v)}T00:00`)) / 86400000)} days`, 'red') : pill(v.status, v.status === 'Confirmed' ? 'amber' : '')}</div>
    <div class="l"><span class="k">Visit</span><span><a href="#/amc-visits/${v.id}">${v.contractNo} · <b>${v.n} of ${v.of}</b></a> · ${v.confirmedDate ? `${short(v.confirmedDate)} (${v.confirmedVia || 'agreed'})` : `planned ${short(v.plannedDate)}`}</span></div>
    <div class="l"><span class="k">Site</span><span>${v.site} · <span class="zone-chip">${zoneCode(v.zoneId)}</span> · ${v.shutters.length} shutters · ${v.workHours} team-hours${v.days > 1 ? ` (${v.days} days)` : ''}</span></div>
    ${v.status === 'Scheduled' ? html`<div class="l"><span class="k">Booked</span><span>${empName(v.technicianId)} · ${short(visitDate(v))} ${fmtHour(v.blocks[0].from)}</span></div>`
      : html`<div class="l"><span class="k">Suggested</span><span>${slotText(s)}</span></div>`}
    ${edit ? html`<div class="row" style="margin-top:7px">${v.status === 'Scheduled' ? html`<button class="btn small" data-change="${v.id}">Move</button>`
      : html`${s ? html`<button class="btn small primary" data-quick="${v.id}">${v.status === 'Confirmed' ? 'Assign' : 'Confirm & assign'}</button>` : ''}<button class="btn small" data-change="${v.id}">Change</button>
        ${v.status === 'Planned' ? html`<button class="btn small" data-confirm="${v.id}">Confirm date only</button>` : ''}`}</div>` : ''}
  </div>`;
}

// Change: any technician, helper, date and start time (the suggestion pre-filled); the clash check runs on save.
export function visitDialog(v) {
  const s = suggestVisit(v) || { technicianId: v.technicianId, helperIds: v.helperIds, date: visitDate(v) < todayStr() ? todayStr() : visitDate(v), start: 9 };
  const cur = v.status === 'Scheduled' ? { technicianId: v.technicianId, helperIds: v.helperIds, date: v.blocks[0].date, start: v.blocks[0].from } : s;
  const techs = technicians().sort((a, b) => (b.mainZoneId === v.zoneId) - (a.mainZoneId === v.zoneId));
  const times = Array.from({ length: 16 }, (_, i) => 8.5 + i * 0.5).filter(h => h + perDayHours(v) <= 17.5 + 0.01);
  openModal({
    title: `${v.status === 'Scheduled' ? 'Move' : 'Schedule'} ${v.contractNo} visit ${v.n} of ${v.of}`,
    body: html`<form class="form-lines" onsubmit="return false">
      <div class="field"><label>Site</label><div class="ro">${v.customer} · ${v.site} · Zone ${zoneCode(v.zoneId)} · ${v.workHours} team-hours + ${v.travelHours} h travel${v.days > 1 ? ` · ${v.days} days` : ''}</div></div>
      <div class="field"><label>Technician</label><select name="technicianId">${techs.map(t => html`<option value="${t.id}" ${t.id === cur.technicianId ? 'selected' : ''}>${t.name}${t.mainZoneId === v.zoneId ? ' (zone)' : ''}</option>`)}</select></div>
      <div class="field"><label>Helper</label><select name="helperId"><option value="">None</option>${helpers().map(h => html`<option value="${h.id}" ${cur.helperIds?.includes(h.id) ? 'selected' : ''}>${h.name}</option>`)}</select></div>
      <div class="field"><label>Date</label><input type="date" name="date" value="${cur.date}" min="${todayStr()}"></div>
      <div class="field"><label>Start</label><select name="start">${times.map(h => html`<option value="${h}" ${Math.abs(h - cur.start) < 0.01 ? 'selected' : ''}>${fmtHour(h)}</option>`)}</select><div class="sub">${perDayHours(v)} h a day including travel</div></div>
      <div class="field"><label>Agreed with the customer by</label>${chipGroup('via', VIA, v.confirmedVia || 'Phone')}</div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: b => {
      const d = readForm(b);
      const slot = { technicianId: d.technicianId, helperIds: d.helperId ? [d.helperId] : [], date: d.date, start: Number(d.start), via: d.via };
      const problems = scheduleVisitProblems(v, slot);
      if (problems.length) { toast(problems[0], 'bad'); return false; }
      scheduleVisit(v.id, slot); toast(`${v.contractNo} visit ${v.n}: ${empName(slot.technicianId)}, ${short(slot.date)} ${fmtHour(slot.start)}`); render();
    } }],
  });
}

function confirmDialog(v) {
  openModal({
    title: `Customer agreed a date · ${v.contractNo} visit ${v.n}`,
    body: html`<form class="form-lines" onsubmit="return false"><div class="field"><label>Date</label><input type="date" name="date" value="${v.plannedDate < todayStr() ? todayStr() : v.plannedDate}" min="${todayStr()}"></div>
      <div class="field"><label>By</label>${chipGroup('via', VIA, 'Phone')}</div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Confirm', kind: 'primary', onClick: b => { const d = readForm(b); if (!d.date) return false; confirmVisitDate(v.id, d); toast(`Confirmed for ${short(d.date)}`); render(); } }],
  });
}
