// AMC Scheduling: every visit of the active contracts by month and zone. The year strip shows the months ahead per
// zone; the month calendar shows each visit (dashed = Planned, light = Confirmed, solid = Scheduled, red = overdue).
// The left list holds what needs action; "Confirm & assign" takes the suggestion (zone technician, first free time,
// helper) and the customer's agreement in one step. Repair jobs and assessments are checked for clashes.
// A visit (its card, or its box in the month) can also be dragged onto a day of the month: the dialog then opens with
// that day, a technician who is free and the first free time, and its own checks run on Save (UX audit, finding 18).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, go, on, fmtDate, pill, toast, openModal, readForm, chipGroup, tiles, debounce, clearErrors } from '../core/ui.js';
import { zones, zoneCode, technicians, empName } from '../core/lookups.js';
import { refreshAmc, todayStr, addMonths } from '../core/contracts.js';
import { suggestVisit, scheduleVisit, scheduleVisitProblems, confirmVisitDate, isOverdue, visitDate, perDayHours, workingDays, OPEN_VISIT, DONE_VISIT } from '../core/visits.js';
import { fmtHour, helpers, isWorkday, freeStart } from '../core/jobs.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';
import { bindBoardDrag, dayText, sayDates, tagOf, problemInForm } from './board-drag.js';
import { before, undoOf } from './board-undo.js';

const KEY = 'rsmAmcSched';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZCLS = { A: 'zA', B: 'zB', C: 'zC', D: 'zD' };
const ym = ds => ds.slice(0, 7);
const VIA = ['Phone', 'WhatsApp', 'Email'];
const short = ds => { const d = new Date(`${ds}T00:00`); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const slotText = s => (s ? `${empName(s.technicianId)}${s.helperIds?.length ? ` + ${empName(s.helperIds[0])}` : ''} · ${short(s.date)} ${fmtHour(s.start)}–${fmtHour(s.start + s.hours)}${s.days > 1 ? ` (${s.days} days)` : ''}` : 'No free slot in the next 3 weeks');
const visitName = v => `${v.contractNo} visit ${v.n} of ${v.of}`;
const techShort = id => empName(id).replace('Technician ', 'Tech ');
const REST = 'Drag a visit onto a day to book it there. A technician who is free and the first free time are filled in.';
let lastToast = null; // the last "booked" message, with its Undo

// Where a visit dragged onto a day would go: with the technician it has now when he is free (a move keeps the crew),
// else with the zone technician who is free that day (suggestVisit, held to that day); then the dialog's own checks.
function dayVerdict(v, ds) {
  if (v.status === 'Scheduled' && v.blocks?.[0]?.date === ds) return { ok: true, same: true, why: '', tag: 'It is here now' };
  let slot = null;
  if (ds >= todayStr()) {
    const own = v.status === 'Scheduled' ? workingDays(ds, v.days || 1).map(x => freeStart(v.technicianId, x, perDayHours(v), v.id)) : [null];
    slot = own.every(x => x != null) ? { technicianId: v.technicianId, helperIds: v.helperIds || [], date: ds, start: own[0] } : suggestVisit({ ...v, confirmedDate: ds });
  }
  const problems = scheduleVisitProblems(v, { technicianId: slot?.technicianId || 'none', date: ds, start: slot ? slot.start : null });
  if (!slot && !problems.length) problems.push(`No technician has free time for it that day (it needs ${perDayHours(v)} h${v.days > 1 ? ` a day on ${v.days} working days in a row` : ''}).`);
  return { ok: !problems.length, slot, why: sayDates(problems[0] || ''), tag: problems.length ? tagOf(problems[0]) : `${techShort(slot.technicianId)} ${fmtHour(slot.start)}` };
}
// Book a visit and say so, with Undo (the visit goes back exactly as it was: planned, confirmed or its earlier slot).
function book(v, slot, text) {
  const was = before('amcVisits', v.id);
  const r = scheduleVisit(v.id, slot);
  if (r.problems.length) return r.problems;
  lastToast?.remove();
  lastToast = toast(text, '', { undo: undoOf(was, {}, (msg, kind) => { toast(msg, kind); render(); }) });
  return [];
}

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
    const move = edit && OPEN_VISIT.includes(v.status);
    return html`<a class="${cls}" href="#/amc-visits/${v.id}" draggable="${move ? 'true' : 'false'}" ${move ? html`data-drag="${v.id}"` : ''} title="${v.contractNo} · visit ${v.n} of ${v.of} · ${v.status}${v.technicianId ? ` · ${empName(v.technicianId)}` : ''}${move ? '. Drag it onto another day to move it; click to open it.' : ''}"
      aria-label="${v.customer}, visit ${v.n} of ${v.of}, ${late ? 'overdue' : v.status}${v.technicianId ? `, ${empName(v.technicianId)}` : ''}. Open it.">${done ? '✓ ' : ''}${v.customer.replace(/ Pte Ltd| LLC/, '')} · ${v.n} of ${v.of}${v.technicianId && !done ? ` · ${empName(v.technicianId).replace('Technician ', 'Tech ')}` : ''}</a>`;
  };

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Transactions', title: 'AMC Scheduling', sub: 'Visits of the active contracts. Repair jobs and assessments are checked for clashes.' })}
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
        <div class="row" style="margin-bottom:6px"><button class="btn small" data-step="-1" title="Previous month" aria-label="Previous month">‹</button><b style="font-size:14px">${MONTHS[mm - 1]} ${yy}</b><button class="btn small" data-step="1" title="Next month" aria-label="Next month">›</button>
          ${state.month !== ym(t) ? html`<button class="btn link small" data-month="${ym(t)}">This month</button>` : ''}<span class="grow"></span>
          <span class="legend">${zs.map(z => html`<span><i class="${ZCLS[z.code] || ''}"></i>${z.code}</span>`)}</span></div>
        ${edit ? html`<div class="board-say" id="amcSay" role="status" aria-live="polite" data-rest="${REST}">${REST}</div>` : ''}
        <div class="mcal" style="grid-template-columns:repeat(${heads.length}, minmax(0, 1fr))">${heads.map(h => html`<div class="hd">${h}</div>`)}
          ${cells.map(d => { const day = ds(d); const vs = onDay(day); return html`<div class="c ${d.getMonth() !== mm - 1 ? 'out' : ''} ${day === t ? 'today' : ''}" data-day="${day}" role="group" aria-label="${dayText(day)}${day === t ? ', today' : ''}: ${vs.length ? `${vs.length} visit${vs.length > 1 ? 's' : ''}` : 'no visits'}"><div class="d">${d.getDate()}${day === t ? ' · today' : ''}</div>${vs.map(block)}</div>`; })}</div>
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
    const problems = book(v, { ...s, via: v.confirmedVia || 'Phone' }, `${v.contractNo} visit ${v.n}: ${slotText(s)}`);
    if (problems.length) { toast(sayDates(problems[0]), 'bad'); return; }
    render();
  });
  on(el, 'click', '[data-change]', (e, b) => visitDialog(store.get('amcVisits', b.dataset.change)));
  on(el, 'click', '[data-confirm]', (e, b) => confirmDialog(store.get('amcVisits', b.dataset.confirm)));

  if (!edit) return;
  // The line above the month: the hint at rest, what a day can take while dragging, and why a drop was refused.
  const say = (text, kind = '') => { const x = $('#amcSay', el); if (x) { x.textContent = text || x.dataset.rest; x.className = `board-say ${text ? kind : ''}`; } };
  const hint = v => say(`${visitName(v)}: drop it on a green day. A red day cannot take it; hold it over the day to see why.`);
  bindBoardDrag($('.board', el), {
    item: src => { const v = store.get('amcVisits', src.dataset.drag); return v && OPEN_VISIT.includes(v.status) ? v : null; },
    check: (v, cell) => dayVerdict(v, cell.dataset.day),
    start: hint,
    end: () => say(''),
    over: (v, cell, r) => (!cell ? hint(v) : r.same ? say(`${dayText(cell.dataset.day)}: ${visitName(v)} is here now.`)
      : r.ok ? say(`${dayText(cell.dataset.day)}: ${empName(r.slot.technicianId)} is free from ${fmtHour(r.slot.start)}. Drop to book ${visitName(v)} here.`, 'ok') : say(`${dayText(cell.dataset.day)}: ${r.why}`, 'bad')),
    refuse: (v, cell, r) => say(`${visitName(v)} was not put on ${dayText(cell.dataset.day)}. ${r.why}`, 'bad'),
    drop: (v, cell, r) => (r.same ? say(`${visitName(v)} stays where it is.`) : visitDialog(v, r.slot)),
  });
}

function visitCard(v, edit) {
  const late = isOverdue(v);
  const s = OPEN_VISIT.includes(v.status) && v.status !== 'Scheduled' ? suggestVisit(v) : null;
  const move = edit && OPEN_VISIT.includes(v.status);
  return html`<div class="vcard ${late ? 'late' : ''}" ${move ? html`draggable="true" data-drag="${v.id}"` : ''} role="group" aria-label="${v.customer}, ${visitName(v)}, ${late ? 'overdue' : v.status}${move ? '. Drag it onto a day of the month, or use its buttons.' : ''}" style="--zc:${{ A: '#378ADD', B: '#1D9E75', C: '#BA7517', D: '#7F77DD' }[zoneCode(v.zoneId)] || '#378ADD'}">
    <div class="row"><b>${v.customer}</b><span class="grow"></span>${late ? pill(`Overdue ${Math.round((new Date(`${todayStr()}T00:00`) - new Date(`${visitDate(v)}T00:00`)) / 86400000)} days`, 'red') : pill(v.status, v.status === 'Confirmed' ? 'amber' : '')}</div>
    <div class="l"><span class="k">Visit</span><span><a href="#/amc-visits/${v.id}" draggable="false">${v.contractNo} · <b>${v.n} of ${v.of}</b></a> · ${v.confirmedDate ? `${short(v.confirmedDate)} (${v.confirmedVia || 'agreed'})` : `planned ${short(v.plannedDate)}`}</span></div>
    <div class="l"><span class="k">Site</span><span>${v.site} · <span class="zone-chip">${zoneCode(v.zoneId)}</span> · ${v.shutters.length} products · ${v.workHours} team-hours${v.days > 1 ? ` (${v.days} days)` : ''}</span></div>
    ${v.status === 'Scheduled' ? html`<div class="l"><span class="k">Booked</span><span>${empName(v.technicianId)} · ${short(visitDate(v))} ${fmtHour(v.blocks[0].from)}</span></div>`
      : html`<div class="l"><span class="k">Suggested</span><span>${slotText(s)}</span></div>`}
    ${edit ? html`<div class="row" style="margin-top:7px">${v.status === 'Scheduled' ? html`<button class="btn small" data-change="${v.id}">Move</button>`
      : html`${s ? html`<button class="btn small primary" data-quick="${v.id}">${v.status === 'Confirmed' ? 'Assign' : 'Confirm & assign'}</button>` : ''}<button class="btn small" data-change="${v.id}">Change</button>
        ${v.status === 'Planned' ? html`<button class="btn small" data-confirm="${v.id}">Confirm date only</button>` : ''}`}</div>` : ''}
  </div>`;
}

// Change: any technician, helper, date and start time (the suggestion pre-filled, or the day a visit was dropped on);
// the clash check runs on save.
export function visitDialog(v, preset = null) {
  const s = suggestVisit(v) || { technicianId: v.technicianId, helperIds: v.helperIds, date: visitDate(v) < todayStr() ? todayStr() : visitDate(v), start: 9 };
  const cur = preset || (v.status === 'Scheduled' ? { technicianId: v.technicianId, helperIds: v.helperIds, date: v.blocks[0].date, start: v.blocks[0].from } : s);
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
      <div class="field"><label>Agreed with the customer by</label>${chipGroup('via', VIA, v.confirmedVia || 'Phone')}</div><div class="form-end"><span data-end></span></div></form>`,
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: b => {
      const d = readForm(b);
      const slot = { technicianId: d.technicianId, helperIds: d.helperId ? [d.helperId] : [], date: d.date, start: Number(d.start), via: d.via };
      clearErrors(b);
      const problems = scheduleVisitProblems(v, slot);
      if (problems.length) return problemInForm(b, problems[0], 'start');
      const left = book(v, slot, `${v.contractNo} visit ${v.n}: ${empName(slot.technicianId)}, ${short(slot.date)} ${fmtHour(slot.start)}`);
      if (left.length) return problemInForm(b, left[0], 'start');
      render();
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
