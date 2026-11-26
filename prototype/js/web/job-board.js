// Job Execution: the scheduling board (flow step 7). Left: jobs not scheduled yet, with their parts check and the
// suggested technician and day. Right: the week by technician, job assessments and AMC visits included, coloured by
// zone. A job is placed by dragging its card onto a day, by picking it and clicking a green day, or with its Schedule
// button; a scheduled job is moved by dragging its block. Every way opens the same dialog and ends in the same
// scheduleJob call (core/jobs.js), so the checks are the same. The board opens on the current week.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, toast, tiles, openModal, readForm, field, clearErrors, go } from '../core/ui.js';
import { zoneCode, technicians, empName, vsLabel } from '../core/lookups.js';
import { missingGroups } from '../core/products.js';
import { suggestSlot, earliestDate, bookings, jobDuration, jobDays, setPartReady, scheduleJob, scheduleProblems, freeJobStart, helpers, defaultHelper, nextWorkday, isWorkday, dayStart, dayEnd, fmtHour, seesJob, INSPECTION_HOURS } from '../core/jobs.js';
import { invoiceForJob } from '../core/billing.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';
import { bindBoardDrag, dayText, sayDates, tagOf, problemInForm } from './board-drag.js';
import { before, undoOf } from './board-undo.js';

const PX = 20;                           // pixels per hour on the calendar
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const zc = id => `z${['A', 'B', 'C', 'D'].includes(zoneCode(id)) ? zoneCode(id) : 'A'}`;
const state = { sel: '', week: null, hi: '', tile: '' };
let lastToast = null;                    // the last "scheduled" message, with its Undo
const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const thisWeek = () => { const t = new Date(); return mondayOf(isWorkday(t) ? t : nextWorkday(t)); };
const fmtDay = d => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}`;
const month = d => d.toLocaleString('en-SG', { month: 'short' });
const ROUTE = { job: 'jobs', amc: 'amc-visits', inspection: 'assessments' };
const TILE = { apr: ['waiting for approval', j => !j.termApproved], parts: ['parts on order', j => j.parts.some(p => !p.ready)] };
// Coming back from another part of the app, the board opens on the current week again (a job opened from the board
// and closed again keeps the week).
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/jobs')) Object.assign(state, { week: null, hi: '', tile: '' }); });

// The hours a job books a day: what it is booked for now when it is moved, else the estimate's hours.
const hoursOf = j => (j.start && j.blocks?.[0] ? j.blocks[0].to - j.blocks[0].from : jobDuration(j));

// Can this job go to this technician on this day? The dialog's own checks (scheduleProblems), asked for the first
// free start of that day, so a day marked free here is a day the dialog accepts.
export function slotVerdict(job, techId, ds) {
  const hours = hoursOf(job);
  if (job.start && job.technicianId === techId && job.blocks?.[0]?.date === ds) return { ok: true, same: true, start: job.blocks[0].from, hours, why: '', tag: 'It is here now' };
  const start = freeJobStart(techId, ds, job, hours);
  const problems = scheduleProblems(job, { technicianId: techId, date: ds, start, hours });
  if (start == null && !problems.length) {
    const busy = bookings(techId, ds, job.id).map(b => `${fmtHour(b.from)}–${fmtHour(b.to)}`).join(', ');
    problems.push(`${empName(techId)} has no free time for it ${ds === dstr(new Date()) ? 'in what is left of today' : 'that day'}${busy ? ` (booked ${busy})` : ''}: it needs ${hours} h${jobDays(job) > 1 ? ` a day on ${jobDays(job)} working days in a row` : ''}.`);
  }
  return { ok: !problems.length, start, hours, why: sayDates(problems[0] || ''), tag: problems.length ? tagOf(problems[0]) : `Free from ${fmtHour(start)}` };
}

// Why this technician and day are suggested: what the board already knows.
function sugText(j, s) {
  const t = store.get('employees', s.technicianId);
  const why = [t?.mainZoneId === j.zoneId ? 'zone match' : (t?.extraZoneIds || []).includes(j.zoneId) ? 'extra zone' : 'first free technician'];
  if (t && missingGroups(t, j.groups || []).length) why.push(`does not work on ${missingGroups(t, j.groups).map(g => vsLabel('PRODUCT_GROUP', g)).join(', ')}`);
  if (j.parts.length) why.push(j.parts.every(p => p.ready) ? 'parts in stock' : 'parts ready');
  if (s.days > 1) why.push(`${s.days} days`);
  return `${empName(s.technicianId)}, ${dayText(s.date)} ${fmtHour(s.start)} (${why.join(', ')})`;
}

function jobCard(j, sug, canEdit) {
  const blocked = !j.termApproved;
  const on = state.sel === j.id;
  return html`<div class="jobc ${zc(j.zoneId)} ${on ? 'on' : ''}" data-pick="${j.id}" ${canEdit ? html`draggable="true" data-drag="${j.id}"` : ''} role="group"
    aria-label="${j.no}, ${j.customer}, ${j.site}, ${blocked ? 'waiting for the payment term' : 'not scheduled'}${canEdit && !blocked ? '. Drag it onto a day, or use Schedule.' : ''}">
    <div class="row"><b>${j.no}</b><span class="zone-chip">${zoneCode(j.zoneId)}</span>${j.type === 'GS' ? html`<span class="pill purple">General servicing</span>` : ''}${j.noVisit ? html`<span class="pill purple">No site visit</span>` : ''}<span class="grow"></span>${blocked ? (j.termNote ? html`<span class="pill red">Term returned</span>` : html`<span class="pill amber">Waiting for Approver</span>`) : html`<span class="pill blue">To schedule</span>`}</div>
    <div class="strong" style="margin-top:3px">${j.customer} · ${j.site}</div>
    <div class="l"><span class="k">Work</span><span>${j.tags.join(', ') || j.lines.length + ' line(s)'} · ${j.workHours} h + ${j.travelHours} h travel</span></div>
    <div class="l"><span class="k">Crew</span><span>${j.crew.label}</span></div>
    <div class="l"><span class="k">Payment</span><span>${vsLabel('PAYMENT_TERMS', j.paymentTerm)}${j.paymentTerm === 'IMMEDIATE' ? ' · invoice raised when scheduled' : blocked ? (j.termNote ? ' · returned: open the job to change it' : ' · the Approver must approve first') : ' · approved'}</span></div>
    ${j.parts.length ? html`<ul class="parts">${j.parts.map(p => html`<li><label class="check"><input type="checkbox" data-part="${j.id}|${p.key}" ${p.ready ? 'checked' : ''} ${canEdit ? '' : 'disabled'}> ${p.qty} × ${p.name}</label>
      <span class="muted small">${p.ready ? 'in stock' : `order · ${p.leadDays} days`}</span></li>`)}</ul>
      <div class="small muted">Parts ready from <b>${dayText(earliestDate(j))}</b></div>` : ''}
    ${blocked ? '' : sug ? html`<button type="button" class="sug-link" data-sug="${j.id}" title="Show this slot on the board"><b>Suggested:</b> ${sugText(j, sug)}</button>`
      : html`<div class="small muted" style="margin-top:6px">No free slot found in the next 14 working days.</div>`}
    <div class="row" style="margin-top:8px"><a class="btn small" href="#/jobs/${j.id}" draggable="false" aria-label="Open ${j.no}">Open</a><span class="grow"></span>
      ${canEdit && !blocked ? html`<button class="btn primary small" data-sched="${j.id}" aria-label="Schedule ${j.no}">Schedule</button>` : ''}</div>
  </div>`;
}

function calendar(days, sel, sug, canEdit) {
  const today = dstr(new Date());
  const H = (dayEnd() - dayStart()) * PX + 4;
  // A booking outside the working hours stays inside its day's box; its text is cut to the lines that fit.
  const box = (from, to) => { const top = Math.max(0, Math.min((from - dayStart()) * PX, H - 30)), h = Math.max(28, Math.min((to - from) * PX - 2, H - top - 2)); return { h, css: `top:${top}px;height:${h}px` }; };
  const text = (h, label) => { const n = Math.floor((h - 20) / 16.25); return n < 1 ? '' : html`<span class="bt ${n === 1 ? 'one' : ''}" style="-webkit-line-clamp:${n}">${label}</span>`; };
  return html`<div class="cal" style="grid-template-columns:140px repeat(${days.length}, minmax(0, 1fr))">
    <div class="hd">Technician</div>${days.map(d => html`<div class="hd ${dstr(d) === today ? 'today' : ''}">${fmtDay(d)}${dstr(d) === today ? html` <span class="today-tag">Today</span>` : ''}</div>`)}
    ${technicians().map(t => html`<div class="who"><b>${t.name}</b><br><span class="muted">Zones ${[zoneCode(t.mainZoneId), ...(t.extraZoneIds || []).map(zoneCode)].join(', ')}</span><br><span class="muted small">+ ${defaultHelper(t.id)?.name || 'helper'}</span></div>
      ${days.map(d => {
        const ds = dstr(d);
        const items = bookings(t.id, ds);
        const free = canEdit && sel ? slotVerdict(sel, t.id, ds) : null;
        const isSug = sug && sug.technicianId === t.id && sug.date === ds;
        return html`<div class="day ${free?.ok ? 'free' : ''} ${ds === today ? 'today' : ''}" data-day="${t.id}|${ds}" style="height:${H}px" role="group"
          aria-label="${t.name}, ${dayText(ds)}${ds === today ? ', today' : ''}: ${items.length ? `${items.length} booked` : 'nothing booked'}${free?.ok ? `, free for ${sel.no} from ${fmtHour(free.start)}` : ''}">
          ${free?.ok ? html`<button type="button" class="place" data-slot="${t.id}|${ds}" title="Place ${sel.no} here" aria-label="Place ${sel.no} with ${t.name} on ${dayText(ds)} from ${fmtHour(free.start)}"></button>` : ''}
          ${items.map(b => {
            const move = canEdit && b.kind === 'job' && b.status === 'Scheduled';
            const what = b.kind === 'job' ? b.no : b.kind === 'amc' ? `AMC · ${b.no}` : 'Job assessment';
            const at = box(b.from, b.to);
            return html`<a class="blk ${zc(b.zoneId)} ${b.kind === 'amc' ? 'amc' : ''} ${at.h < 42 ? 'short' : ''}" href="#/${ROUTE[b.kind]}/${b.id}" draggable="${move ? 'true' : 'false'}" ${move ? html`data-drag="${b.id}"` : ''} style="${at.css}"
              title="${what} · ${b.title} · ${fmtHour(b.from)}–${fmtHour(b.to)}. ${move ? 'Drag it to another day or technician to move it; click to open it.' : 'Click to open it.'}" aria-label="${what}, ${b.title}, ${fmtHour(b.from)} to ${fmtHour(b.to)}, ${b.status}. Open it${move ? ' (Move is on its page)' : ''}.">
              <b>${fmtHour(b.from)}–${fmtHour(b.to)}</b>${text(at.h, `${what} · ${b.title}`)}</a>`;
          })}
          ${isSug ? html`<button type="button" class="blk ${zc(sel.zoneId)} sug ${state.hi === sel.id ? 'hi' : ''}" data-slot="${t.id}|${ds}" style="${box(sug.start, sug.end).css}" aria-label="Suggested slot for ${sel.no}: ${t.name}, ${dayText(ds)} ${fmtHour(sug.start)} to ${fmtHour(sug.end)}. Schedule it here."><b>${fmtHour(sug.start)}–${fmtHour(sug.end)}</b>${text(box(sug.start, sug.end).h, `${sel.no} · suggested`)}</button>` : ''}
        </div>`;
      })}`)}
  </div>`;
}

export function renderJobBoard(el) {
  const canEdit = auth.can('job', 'edit');
  const all = store.list('jobs', seesJob);
  const unscheduled = all.filter(j => j.status === 'To schedule').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!unscheduled.find(j => j.id === state.sel)) Object.assign(state, { sel: unscheduled.find(j => j.termApproved)?.id || '', hi: '' });
  const sel = unscheduled.find(j => j.id === state.sel) || null;
  const sugs = new Map(unscheduled.filter(j => j.termApproved).map(j => [j.id, suggestSlot(j)]));
  const sug = (sel && sugs.get(sel.id)) || null;
  if (!state.week) state.week = thisWeek();
  // The company's working days of the week (Company Setup), Monday first.
  const days = [...Array(7)].map((_, i) => { const d = new Date(state.week); d.setDate(d.getDate() + i); return d; }).filter(isWorkday);
  const first = days[0], last = days[days.length - 1];
  const onThisWeek = +state.week === +thisWeek();
  const leave = store.list('tasks', t => t.kind === 'leaveSite' && t.status === 'Open');
  const shown = unscheduled.filter(TILE[state.tile]?.[1] || (() => true));
  const rest = !canEdit ? '' : state.hi && sel ? `The suggested slot for ${sel.no} is the dashed box. Click it, or the suggestion again, to schedule it there.`
    : sel ? `Drag a job onto a day, or click a green day to place ${sel.no}. Drag a scheduled job to move it.` : 'Drag a scheduled job onto another day or technician to move it.';

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Transactions › Job Execution', title: 'Scheduling board',
      sub: 'Accepted quotations become jobs here, each with a suggested technician and day.',
      actions: html`<div class="row"><a class="btn" href="#/jobs/list">All jobs</a><button class="btn small" id="prev" title="Previous week" aria-label="Previous week">‹</button><b>${fmtDay(first)}${month(first) === month(last) ? '' : ` ${month(first)}`} – ${fmtDay(last)} ${month(last)}</b><button class="btn small" id="next" title="Next week" aria-label="Next week">›</button><button class="btn small" id="thisWeek">This week</button></div>` })}
    ${tiles([
      { key: 'open', label: 'Not scheduled', count: unscheduled.length, sub: 'jobs waiting for a slot', tone: 'warn' },
      { key: 'apr', label: 'Waiting for approval', count: unscheduled.filter(TILE.apr[1]).length, sub: 'non-immediate payment term', tone: 'warn' },
      { key: 'parts', label: 'Parts on order', count: unscheduled.filter(TILE.parts[1]).length, sub: 'earliest date from the lead time' },
      { key: 'week', label: onThisWeek ? 'Scheduled this week' : 'Scheduled in the week shown', count: all.filter(j => j.start && dstr(new Date(j.start)) >= dstr(first) && dstr(new Date(j.start)) <= dstr(last)).length },
      { key: 'leave', label: 'Leave-site requests', count: leave.length, sub: 'technician waiting on site', tone: 'bad' },
    ], state.tile)}
    ${leave.length ? html`<div class="note bad" style="margin-bottom:10px">${leave.map(t => html`<div>${t.title} · <a href="#/tasks">confirm in My tasks</a></div>`)}</div>` : ''}
    <div class="board">
      <div><div class="m-section board-h">Not scheduled${TILE[state.tile] ? html` · ${TILE[state.tile][0]} <button class="btn link small" data-tile="open">Show all</button>` : ''}</div>
        ${shown.length ? html`${shown.map(j => jobCard(j, sugs.get(j.id), canEdit))}` : html`<div class="card"><div class="empty">${unscheduled.length ? 'No job of that kind is waiting.' : 'No jobs waiting. Accepted quotations appear here.'}</div></div>`}</div>
      <div><div class="board-say" id="boardSay" role="status" aria-live="polite" data-rest="${rest}">${rest}</div>
        ${calendar(days, sel, sug, canEdit)}
        <div class="legend" style="margin-top:8px"><span><i style="background:#378ADD"></i>Zone A</span><span><i style="background:#1D9E75"></i>Zone B</span><span><i style="background:#BA7517"></i>Zone C</span><span><i style="background:#7F77DD"></i>Zone D</span>
          <span>Dashed = suggested · double line = AMC visit · a job assessment blocks ${INSPECTION_HOURS} h</span></div></div>
    </div>
  </div>`);

  // The line above the calendar: the hint at rest, what a day can take while dragging, and why a drop was refused.
  const say = (text, kind = '') => { const s = el.querySelector('#boardSay'); if (s) { s.textContent = text || s.dataset.rest; s.className = `board-say ${text ? kind : ''}`; } };
  const where = cell => { const [techId, ds] = cell.dataset.day.split('|'); return { techId, ds, text: `${empName(techId)}, ${dayText(ds)}` }; };
  const redraw = patch => { Object.assign(state, patch); renderJobBoard(el); };
  // The suggestion on a card: the first click shows its week and marks the slot, the second opens the dialog.
  const showSuggestion = id => {
    const j = store.get('jobs', id), s = suggestSlot(j);
    if (!s) return;
    const week = mondayOf(new Date(`${s.date}T00:00`));
    if (state.sel === id && state.hi === id && +week === +state.week) return scheduleDialog(el, j, s);
    redraw({ sel: id, hi: id, week });
    el.querySelector('.blk.sug')?.scrollIntoView({ block: 'nearest' });
    el.querySelector(`[data-sug="${id}"]`)?.focus({ preventScroll: true });
  };

  el.onclick = e => {
    const t = e.target;
    if (t.closest('#prev, #next')) { const w = new Date(state.week); w.setDate(w.getDate() + (t.closest('#prev') ? -7 : 7)); return redraw({ week: w, hi: '' }); }
    if (t.closest('#thisWeek')) return redraw({ week: thisWeek(), hi: '' });
    const tile = t.closest('[data-tile]')?.dataset.tile;
    if (tile === 'leave') return go('tasks');
    if (tile) return redraw(tile === 'week' ? { week: thisWeek(), hi: '' } : { tile: TILE[tile] && state.tile !== tile ? tile : '' });
    if (t.closest('.parts')) return;
    if (t.closest('[data-sug]')) return showSuggestion(t.closest('[data-sug]').dataset.sug);
    const sched = t.closest('[data-sched]');
    if (sched) { const j = store.get('jobs', sched.dataset.sched); const s = suggestSlot(j); return scheduleDialog(el, j, s ? { technicianId: s.technicianId, date: s.date, start: s.start } : {}); }
    const slot = t.closest('[data-slot]');
    if (slot && sel) { const [techId, ds] = slot.dataset.slot.split('|'); return scheduleDialog(el, sel, { technicianId: techId, date: ds, start: freeJobStart(techId, ds, sel) }); }
    if (t.closest('a')) return;
    const pick = t.closest('[data-pick]');
    if (pick && pick.dataset.pick !== state.sel) redraw({ sel: pick.dataset.pick, hi: '' });
  };
  el.onchange = e => {
    const p = e.target.closest('[data-part]');
    if (!p) return;
    const [jobId, key] = p.dataset.part.split('|');
    setPartReady(jobId, key, p.checked);
    redraw({ hi: '' });
  };

  if (!canEdit) return;
  const board = el.querySelector('.board');
  const hint = j => say(`${j.no}: drop it on a green day. A red day cannot take it; hold it over the day to see why.`);
  bindBoardDrag(board, {
    item: src => { const j = store.get('jobs', src.dataset.drag); return j && ['To schedule', 'Scheduled'].includes(j.status) ? j : null; },
    check: (j, cell) => { const { techId, ds } = where(cell); return slotVerdict(j, techId, ds); },
    start: j => { board.classList.toggle('drag-other', j.id !== state.sel); hint(j); },
    end: () => { board.classList.remove('drag-other'); say(''); },
    over: (j, cell, v) => (!cell ? hint(j)
      : v.same ? say(`${where(cell).text}: ${j.no} is here now.`) : v.ok ? say(`${where(cell).text}: free from ${fmtHour(v.start)}. Drop to ${j.start ? 'move' : 'schedule'} ${j.no} here.`, 'ok') : say(`${where(cell).text}: ${v.why}`, 'bad')),
    refuse: (j, cell, v) => say(`${j.no} was not ${j.start ? 'moved to' : 'placed on'} ${where(cell).text}. ${v.why}`, 'bad'),
    // A drop on a day that can take it opens the same dialog as a click, with that technician, day and first free time.
    drop: (j, cell, v) => {
      if (v.same) return say(`${j.no} stays where it is.`);
      const { techId, ds } = where(cell);
      redraw({ sel: j.status === 'To schedule' ? j.id : state.sel, hi: '' });
      scheduleDialog(el, j, { technicianId: techId, date: ds, start: v.start, hours: v.hours });
    },
  });
}

export function scheduleDialog(el, job, slot = {}) {
  const moving = job.status !== 'To schedule' && !!job.start;
  const hours = slot.hours || hoursOf(job);
  // Technicians who work on all the job's product groups first, then the rest (with what they do not work on).
  const misses = t => missingGroups(t, job.groups || []);
  const techs = technicians().slice().sort((a, b) => (misses(a).length ? 1 : 0) - (misses(b).length ? 1 : 0))
    .map(t => ({ value: t.id, label: `${t.name}${t.mainZoneId === job.zoneId ? ' · zone match' : (t.extraZoneIds || []).includes(job.zoneId) ? ' · extra zone' : ''}${misses(t).length ? ` · does not work on ${misses(t).map(g => vsLabel('PRODUCT_GROUP', g)).join(', ')}` : ''}` }));
  const tech = slot.technicianId || techs[0]?.value;
  // A move to another day keeps the helper; another technician brings his own.
  const helper = moving && tech === job.technicianId ? job.helperIds?.[0] || '' : defaultHelper(tech)?.id;
  const inv = invoiceForJob(job.id);
  const money = `${auth.company().currency} ${Number(job.total).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  openModal({
    title: `${moving ? 'Move' : 'Schedule'} ${job.no}`,
    body: html`<form class="form-lines" onsubmit="return false">
      ${field({ name: 'technicianId', label: 'Technician', type: 'select', options: techs, value: tech, blank: false })}
      ${field({ name: 'helperId', label: 'Helper', type: 'select', options: helpers().map(h => ({ value: h.id, label: h.name })), value: helper, blankLabel: 'No helper' })}
      ${field({ name: 'date', label: 'Date', type: 'date', value: slot.date || earliestDate(job) })}
      ${field({ name: 'time', label: 'Start', type: 'time', value: fmtHour(slot.start ?? 9) })}
      ${field({ name: 'hours', label: jobDays(job) > 1 ? 'Hours per day' : 'Hours', type: 'number', step: '0.5', value: hours, hint: `${job.workHours} h work + ${job.travelHours} h travel (from the estimate)${jobDays(job) > 1 ? ` · ${jobDays(job)} working days` : ''}` })}
      <div class="field"><div class="field-label">Crew</div><div class="ro">${job.crew.label}</div></div>
      <div class="field"><div class="field-label">Parts</div><div class="ro">${job.parts.length ? job.parts.map(p => `${p.name}: ${p.ready ? 'in stock' : `order (${p.leadDays} days)`}`).join(' · ') : 'none'}<br><span class="muted small">Ready from ${dayText(earliestDate(job))}</span></div></div>
      ${job.paymentTerm !== 'IMMEDIATE' ? '' : inv ? html`<div class="note" style="margin-top:6px">Payment is immediate: ${inv.no || 'the invoice'} is already raised, and its due date follows the day of the visit.</div>`
        : html`<div class="note" style="margin-top:6px">Payment is immediate: the invoice is raised now, so the technician can collect ${money} on site. After that the job can be moved, but the scheduling cannot be undone.</div>`}
      <div class="form-end"><span data-end></span></div>
    </form>`,
    actions: [{ label: 'Cancel' }, { label: moving ? 'Confirm move' : 'Confirm schedule', kind: 'primary', onClick: b => {
      clearErrors(b);
      const d = readForm(b);
      const [hh, mm] = (d.time || '09:00').split(':').map(Number);
      const s = { technicianId: d.technicianId, helperIds: d.helperId ? [d.helperId] : [], date: d.date, start: hh + mm / 60, hours: Number(d.hours) || hours };
      const problems = scheduleProblems(store.get('jobs', job.id), s);
      if (problems.length) return problemInForm(b, problems[0]);
      const was = before('jobs', job.id);
      const r = scheduleJob(job.id, s);
      if (r.problems.length) return problemInForm(b, r.problems[0]);
      const raised = r.invoice && r.invoice.id !== was.invoiceId ? r.invoice : null;
      // Undo puts the job back as it was; not offered when this scheduling raised the invoice (see board-undo.js).
      const undo = undoOf(was, r, (text, kind) => { toast(text, kind); render(); });
      lastToast?.remove(); // an earlier message's Undo no longer fits
      lastToast = toast(`${job.no} ${was.booked ? 'moved to' : 'scheduled for'} ${empName(s.technicianId)}, ${dayText(s.date)} ${fmtHour(s.start)}${raised ? ` · ${raised.no} raised` : ''}`, '', { undo });
      Object.assign(state, { sel: '', hi: '' });
      render();
      return true;
    } }],
  });
}
