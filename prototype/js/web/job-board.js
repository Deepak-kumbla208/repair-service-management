// Job Execution: the scheduling board (flow step 7). Left: jobs not scheduled yet, with their parts check and the
// suggested technician and day. Right: the week by technician, site inspections included, coloured by zone.
// Pick a job, then "Schedule" (the suggestion) or click a free day; the dialog confirms the slot.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, toast, tiles, openModal, readForm, field } from '../core/ui.js';
import { zoneCode, technicians, empName, vsLabel } from '../core/lookups.js';
import { suggestSlot, earliestDate, bookings, jobDuration, setPartReady, scheduleJob, scheduleProblems, freeStart, helpers, defaultHelper, nextWorkday, fmtHour, seesJob, INSPECTION_HOURS } from '../core/jobs.js';
import { pageHead } from './shell.js';
import { render } from '../app.js';

const PX = 20;                           // pixels per hour on the calendar
const DAY0 = 8.5;                        // 08:30
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const zc = id => `z${['A', 'B', 'C', 'D'].includes(zoneCode(id)) ? zoneCode(id) : 'A'}`;
const state = { sel: '', week: null };
const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const fmtDay = d => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}`;

function jobCard(j, sug) {
  const ready = earliestDate(j);
  const blocked = !j.termApproved;
  const on = state.sel === j.id;
  return html`<div class="jobc ${zc(j.zoneId)} ${on ? 'on' : ''}" data-pick="${j.id}" style="${on ? 'outline:2px solid var(--blue-500)' : ''}">
    <div class="row"><b>${j.no}</b><span class="zone-chip">${zoneCode(j.zoneId)}</span>${j.type === 'GS' ? html`<span class="pill purple">General servicing</span>` : ''}<span class="grow"></span>${blocked ? (j.termNote ? html`<span class="pill red">Term returned</span>` : html`<span class="pill amber">Waiting for Approver</span>`) : html`<span class="pill blue">To schedule</span>`}</div>
    <div class="strong" style="margin-top:3px">${j.customer} · ${j.site}</div>
    <div class="l"><span class="k">Work</span><span>${j.tags.join(', ') || j.lines.length + ' line(s)'} · ${j.workHours} h + ${j.travelHours} h travel</span></div>
    <div class="l"><span class="k">Crew</span><span>${j.crew.label}</span></div>
    <div class="l"><span class="k">Payment</span><span>${vsLabel('PAYMENT_TERMS', j.paymentTerm)}${j.paymentTerm === 'IMMEDIATE' ? ' · invoice raised when scheduled' : blocked ? (j.termNote ? ' · returned: open the job to change it' : ' · 🔒 the Approver must approve first') : ' · approved'}</span></div>
    ${j.parts.length ? html`<ul class="parts">${j.parts.map(p => html`<li><label class="check"><input type="checkbox" data-part="${j.id}|${p.key}" ${p.ready ? 'checked' : ''} ${auth.can('job', 'edit') ? '' : 'disabled'}> ${p.qty} × ${p.name}</label>
      <span class="muted small">${p.ready ? 'in stock' : `order · ${p.leadDays} days`}</span></li>`)}</ul>
      <div class="small muted">Parts ready from <b>${ready}</b></div>` : ''}
    ${sug && !blocked ? html`<div class="note" style="margin-top:8px;padding:6px 9px"><b>Suggested:</b> ${empName(sug.technicianId)} · ${sug.date} ${fmtHour(sug.start)}–${fmtHour(sug.end)}</div>` : ''}
    ${auth.can('job', 'edit') && !blocked ? html`<div class="row" style="margin-top:8px"><a class="btn small" href="#/jobs/${j.id}">Details</a><span class="grow"></span><button class="btn primary small" data-sched="${j.id}">Schedule</button></div>` : ''}
  </div>`;
}

function calendar(days, sel, sug) {
  const techs = technicians();
  const today = dstr(new Date());
  return html`<div class="cal">
    <div class="hd">Technician</div>${days.map(d => html`<div class="hd" style="${dstr(d) === today ? 'font-weight:700' : ''}">${fmtDay(d)}</div>`)}
    ${techs.map(t => html`<div class="who"><b>${t.name}</b><br><span class="muted">Zones ${[zoneCode(t.mainZoneId), ...(t.extraZoneIds || []).map(zoneCode)].join(', ')}</span><br><span class="muted small">+ ${defaultHelper(t.id)?.name || 'helper'}</span></div>
      ${days.map(d => {
        const ds = dstr(d);
        const items = bookings(t.id, ds);
        const free = sel && freeStart(t.id, ds, jobDuration(sel), sel.id) != null && ds >= earliestDate(sel) && ds >= today;
        const isSug = sug && sug.technicianId === t.id && sug.date === ds;
        return html`<div class="day ${free ? 'free' : ''}" ${free ? html`data-slot="${t.id}|${ds}" title="Place ${sel.no} here"` : ''}>
          ${items.map(b => html`<a class="blk ${zc(b.zoneId)} ${b.kind === 'amc' ? 'amc' : ''}" href="#/${{ job: 'jobs', amc: 'amc-visits', inspection: 'inspections' }[b.kind]}/${b.id}" style="top:${(b.from - DAY0) * PX}px;height:${Math.max(28, (b.to - b.from) * PX - 2)}px">
            <b>${fmtHour(b.from)}–${fmtHour(b.to)}</b><br>${b.kind === 'job' ? b.no : b.kind === 'amc' ? `AMC · ${b.no}` : 'Site inspection'} · ${b.title}</a>`)}
          ${isSug ? html`<div class="blk ${zc(sel.zoneId)} sug" data-slot="${t.id}|${ds}" style="top:${(sug.start - DAY0) * PX}px;height:${jobDuration(sel) * PX - 2}px"><b>${fmtHour(sug.start)}–${fmtHour(sug.end)}</b><br>${sel.no} · suggested</div>` : ''}
        </div>`;
      })}`)}
  </div>`;
}

export function renderJobBoard(el) {
  const all = store.list('jobs', seesJob);
  const unscheduled = all.filter(j => j.status === 'To schedule').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!unscheduled.find(j => j.id === state.sel)) state.sel = unscheduled.find(j => j.termApproved)?.id || '';
  const sel = unscheduled.find(j => j.id === state.sel) || null;
  const sug = sel && sel.termApproved ? suggestSlot(sel) : null;
  if (!state.week) { const t = new Date(); state.week = mondayOf(t.getDay() === 0 ? nextWorkday(t) : t); }
  if (sug && state.autoJump !== sel.id) { state.week = mondayOf(new Date(`${sug.date}T00:00`)); state.autoJump = sel.id; }
  const days = [...Array(6)].map((_, i) => { const d = new Date(state.week); d.setDate(d.getDate() + i); return d; });
  const weekEnd = dstr(days[5]);
  const leave = store.list('tasks', t => t.kind === 'leaveSite' && t.status === 'Open');

  el.innerHTML = String(html`<div class="page" style="max-width:1600px">
    ${pageHead({ crumb: 'Transactions › Job Execution', title: 'Scheduling board',
      sub: 'Accepted quotations become jobs here. Pick a job: the system suggests a technician (zone first) and the first day the parts are ready.',
      actions: html`<div class="row"><a class="btn" href="#/jobs/list">All jobs</a><button class="btn small" id="prev">‹</button><b>${fmtDay(days[0])} – ${fmtDay(days[5])} ${days[5].toLocaleString('en-SG', { month: 'short' })}</b><button class="btn small" id="next">›</button><button class="btn small" id="thisWeek">This week</button></div>` })}
    ${tiles([
      { key: 'open', label: 'Not scheduled', count: unscheduled.length, sub: 'jobs waiting for a slot', tone: 'warn' },
      { key: 'apr', label: 'Waiting for approval', count: unscheduled.filter(j => !j.termApproved).length, sub: 'non-immediate payment term', tone: 'warn' },
      { key: 'parts', label: 'Parts on order', count: unscheduled.filter(j => j.parts.some(p => !p.ready)).length, sub: 'earliest date from the lead time' },
      { key: 'week', label: 'Scheduled this week', count: all.filter(j => j.start && dstr(new Date(j.start)) >= dstr(days[0]) && dstr(new Date(j.start)) <= weekEnd).length },
      { key: 'leave', label: 'Leave-site requests', count: leave.length, sub: 'technician waiting on site', tone: 'bad' },
    ], '')}
    ${leave.length ? html`<div class="note bad" style="margin-bottom:10px">${leave.map(t => html`<div>${t.title} · <a href="#/tasks">confirm in My tasks</a></div>`)}</div>` : ''}
    <div class="board">
      <div><div class="m-section" style="margin-top:0">Not scheduled</div>
        ${unscheduled.length ? html`${unscheduled.map(j => jobCard(j, j.id === state.sel ? sug : null))}` : html`<div class="card"><div class="empty">No jobs waiting. Accepted quotations appear here.</div></div>`}</div>
      <div>${calendar(days, sel, sug)}
        <div class="legend" style="margin-top:8px"><span><i style="background:#378ADD"></i>Zone A</span><span><i style="background:#1D9E75"></i>Zone B</span><span><i style="background:#BA7517"></i>Zone C</span><span><i style="background:#7F77DD"></i>Zone D</span>
          <span>Dashed = suggested${sel ? ` · free days for ${sel.no} are highlighted; click one to place it` : ''} · a site inspection blocks ${INSPECTION_HOURS} h</span></div></div>
    </div>
  </div>`);

  el.onclick = e => {
    const t = e.target;
    if (t.closest('#prev, #next')) { state.week.setDate(state.week.getDate() + (t.closest('#prev') ? -7 : 7)); state.week = new Date(state.week); return renderJobBoard(el); }
    if (t.closest('#thisWeek')) { const n = new Date(); state.week = mondayOf(n.getDay() === 0 ? nextWorkday(n) : n); return renderJobBoard(el); }
    if (t.closest('[data-part]') || t.closest('a')) return;
    const sched = t.closest('[data-sched]');
    if (sched) { const j = store.get('jobs', sched.dataset.sched); const s = suggestSlot(j); return scheduleDialog(el, j, s ? { technicianId: s.technicianId, date: s.date, start: s.start } : {}); }
    const slot = t.closest('[data-slot]');
    if (slot && sel) { const [techId, ds] = slot.dataset.slot.split('|'); return scheduleDialog(el, sel, { technicianId: techId, date: ds, start: freeStart(techId, ds, jobDuration(sel), sel.id) }); }
    const pick = t.closest('[data-pick]');
    if (pick && pick.dataset.pick !== state.sel) { state.sel = pick.dataset.pick; renderJobBoard(el); }
  };
  el.onchange = e => {
    const p = e.target.closest('[data-part]');
    if (!p) return;
    const [jobId, key] = p.dataset.part.split('|');
    setPartReady(jobId, key, p.checked);
    state.autoJump = '';
    renderJobBoard(el);
  };
}

export function scheduleDialog(el, job, slot) {
  const hours = jobDuration(job);
  const techs = technicians().map(t => ({ value: t.id, label: `${t.name}${t.mainZoneId === job.zoneId ? ' · zone match' : (t.extraZoneIds || []).includes(job.zoneId) ? ' · extra zone' : ''}` }));
  const tech = slot.technicianId || techs[0]?.value;
  openModal({
    title: `Schedule ${job.no}`,
    body: html`<form class="form-lines" onsubmit="return false">
      ${field({ name: 'technicianId', label: 'Technician', type: 'select', options: techs, value: tech, blank: false })}
      ${field({ name: 'helperId', label: 'Helper', type: 'select', options: helpers().map(h => ({ value: h.id, label: h.name })), value: defaultHelper(tech)?.id, blankLabel: 'No helper' })}
      ${field({ name: 'date', label: 'Date', type: 'date', value: slot.date || earliestDate(job) })}
      ${field({ name: 'time', label: 'Start', type: 'time', value: fmtHour(slot.start ?? 9) })}
      ${field({ name: 'hours', label: 'Hours', type: 'number', step: '0.5', value: hours, hint: `${job.workHours} h work + ${job.travelHours} h travel (from the estimate)` })}
      <div class="field"><div class="field-label">Crew</div><div class="ro">${job.crew.label}</div></div>
      <div class="field"><div class="field-label">Parts</div><div class="ro">${job.parts.length ? job.parts.map(p => `${p.name}: ${p.ready ? 'in stock' : `order (${p.leadDays} days)`}`).join(' · ') : 'none'}<br><span class="muted small">Ready from ${earliestDate(job)}</span></div></div>
      ${job.paymentTerm === 'IMMEDIATE' ? html`<div class="note" style="margin-top:6px">Payment is immediate: the invoice is raised now, so the technician can collect ${auth.company().currency} ${Number(job.total).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on site.</div>` : ''}
    </form>`,
    actions: [{ label: 'Cancel' }, { label: 'Confirm schedule', kind: 'primary', onClick: b => {
      const d = readForm(b);
      const [hh, mm] = (d.time || '09:00').split(':').map(Number);
      const s = { technicianId: d.technicianId, helperIds: d.helperId ? [d.helperId] : [], date: d.date, start: hh + mm / 60, hours: Number(d.hours) || hours };
      const problems = scheduleProblems(job, s);
      if (problems.length) { toast(problems[0], 'bad'); return false; }
      const r = scheduleJob(job.id, s);
      toast(`${job.no} scheduled for ${empName(s.technicianId)} on ${s.date}${r.invoice ? ` · ${r.invoice.no} raised` : ''}`);
      state.sel = '';
      render();
      return true;
    } }],
  });
}
