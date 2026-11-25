// Record acceptance: "Assign technician now" (optional, team lead 17 Nov 2026). Unticked, Accept works as before and the
// job waits on the scheduling board. Ticked, the technician (zone first), helper, date and start open already filled in
// with the first free time after the parts are ready, and Accept books the job at once (the board's checks apply).
// One technician per job: the "Now" items of one visit; items put to Later become their own job later.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, readForm, field, fmtDate } from '../core/ui.js';
import { technicians, empName, vsLabel } from '../core/lookups.js';
import { missingGroups } from '../core/products.js';
import { jobDraft, termBlocks, suggestSlot, firstFree, freeJobStart, scheduleProblems, jobDuration, jobDays, earliestDate, helpers, defaultHelper, fmtHour, dayStart, dayEnd } from '../core/jobs.js';
import { splitOf } from '../core/later-work.js';

// Repair and General Servicing make a job; an AMC makes a contract whose visits are scheduled from it.
export const canAssign = q => q.type !== 'AMC' && auth.can('job', 'edit');
export const techBlock = () => html`<div class="assign-now"><label class="check"><input type="checkbox" name="assignNow"> Assign technician now</label></div>
  <div class="sub" id="techOff" hidden></div><div id="techBox" hidden></div>`;

const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayText = ds => (ds === todayStr() ? 'today' : new Date(`${ds}T00:00`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }));
const hhmm = t => { const [h, m] = (t || '').split(':').map(Number); return Number.isFinite(h) ? h + (m || 0) / 60 : null; };

// ctx() gives what the rest of the popup says now: { decisions, paymentTerm, linesCut }.
export function bindTech(b, q, ctx) {
  const tick = $('[name="assignNow"]', b), box = $('#techBox', b), off = $('#techOff', b);
  const btn = b.closest('.modal')?.querySelector('.modal-foot .btn.primary');
  const st = { draft: null, hours: null };
  // The technician who did the site inspection (for later work: on the first enquiry).
  const enq = store.get('enquiries', q.enquiryId);
  const inspector = new Set(store.list('inspections', i => [q.enquiryId, enq?.laterOf?.enquiryId].includes(i.enquiryId) && i.technicianId && i.status !== 'Cancelled').map(i => i.technicianId));

  const draftNow = () => {
    const c = ctx();
    const split = c.decisions && Object.values(c.decisions).some(v => v !== 'NOW') ? splitOf(q, c.decisions) : null;
    return jobDraft(q, { split, paymentTerm: c.paymentTerm || q.paymentTerm });
  };
  const rank = t => (t.mainZoneId === st.draft.zoneId ? 0 : (t.extraZoneIds || []).includes(st.draft.zoneId) ? 1 : 2);
  // Technicians who work on all the job's product groups first (Employee master, Works on), then by zone.
  const misses = t => missingGroups(t, st.draft.groups || []);
  const order = (a, b2) => (misses(a).length ? 1 : 0) - (misses(b2).length ? 1 : 0) || rank(a) - rank(b2);

  function fill(techId = '') {
    const d = st.draft;
    const hours = jobDuration(d);
    const sug = techId ? firstFree(d, techId) : suggestSlot(d);
    const techs = technicians().slice().sort(order);
    const tech = techId || sug?.technicianId || techs[0]?.id || '';
    const opts = techs.map(t => {
      const f = firstFree(d, t.id);
      return { value: t.id, label: [t.name, ['zone match', 'extra zone', ''][rank(t)], inspector.has(t.id) ? 'did the site inspection' : '',
        misses(t).length ? `does not work on ${misses(t).map(g => vsLabel('PRODUCT_GROUP', g)).join(', ')}` : '',
        f ? `free ${dayText(f.date)} ${fmtHour(f.start)}` : 'no free time in 2 weeks'].filter(Boolean).join(' · ') };
    });
    st.hours = hours;
    box.innerHTML = String(html`
      ${field({ name: 'techId', label: 'Technician', type: 'select', options: opts, value: tech, blank: false })}
      ${field({ name: 'helperId', label: 'Helper', type: 'select', options: helpers().map(h => ({ value: h.id, label: h.name })), value: defaultHelper(tech)?.id, blankLabel: 'No helper' })}
      <div class="field"><label>Date / start</label><div class="row"><input type="date" name="jobDate" value="${sug?.date || earliestDate(d)}"><input type="time" name="jobTime" value="${fmtHour(sug?.start ?? dayStart() + 0.5)}" style="width:110px"></div></div>
      ${field({ name: 'jobHours', label: jobDays(d) > 1 ? 'Hours per day' : 'Hours', type: 'number', step: '0.5', value: hours, hint: `${d.workHours} h work + ${d.travelHours} h travel · ${d.crew.label}${jobDays(d) > 1 ? ` · ${jobDays(d)} working days` : ''}` })}
      <div id="slotNote" style="margin-top:6px"></div>`);
  }

  function read() {
    const d = readForm(box);
    return { technicianId: d.techId, helperIds: d.helperId ? [d.helperId] : [], date: d.jobDate, start: hhmm(d.jobTime), hours: Number(d.jobHours) || st.hours };
  }
  // The board's checks (clash, parts, past time). The term is checked before the box can be ticked.
  const problemsOf = slot => {
    if (!slot.date || slot.start == null) return ['Enter the date and start time.'];
    // "In stock" is ticked on the scheduling board, not here.
    return scheduleProblems({ ...st.draft, termApproved: true }, slot)
      .map(p => (p.startsWith('Parts are not ready') ? `Parts are ready from ${fmtDate(earliestDate(st.draft))}: pick that day or later.` : p));
  };
  function check() {
    const slot = read();
    const p = problemsOf(slot);
    const d = st.draft;
    const later = d.parts.some(x => !x.ready) ? ` Parts ready from ${fmtDate(earliestDate(d))}.` : '';
    const inv = d.paymentTerm === 'IMMEDIATE' ? ' The invoice is raised now (payment immediate).' : '';
    const end = slot.start + slot.hours;
    const ot = end > dayEnd() + 0.01 ? ` It ends at ${fmtHour(end)}, after the working day (${fmtHour(dayEnd())}): overtime.` : '';
    $('#slotNote', box).innerHTML = String(p.length ? html`<div class="note bad small">${p[0]}${p[0].startsWith('Pick') || p[0].includes('already has') ? ' Or untick "Assign technician now".' : ''}</div>`
      : html`<div class="note ${ot ? 'warn' : ''} small">✓ Free: ${dayText(slot.date)}, ${fmtHour(slot.start)}–${fmtHour(end)}${jobDays(d) > 1 ? ` and the next ${jobDays(d) - 1} working day${jobDays(d) > 2 ? 's' : ''}` : ''} with ${empName(slot.technicianId)}.${ot}${later}${inv}</div>`);
  }

  function paint() {
    const c = ctx();
    st.draft = draftNow();
    const why = c.linesCut ? 'With fewer lines, the next revision goes for the counter-check first: assign the technician when it is accepted.'
      : st.draft.noVisit ? 'Only fixed-price products: there is no site visit to schedule. Mark the job done on its page when the work is finished.'
      : termBlocks(st.draft) ? 'The new payment term needs the Approver before scheduling: assign the technician on the scheduling board after approval.' : '';
    tick.disabled = !!why;
    if (why) tick.checked = false;
    off.hidden = !why; off.textContent = why;
    box.hidden = !tick.checked;
    if (btn) btn.textContent = tick.checked ? 'Accept and schedule' : 'Accept';
    if (!tick.checked) return;
    // New hours (other "Now" items) or first opening: fill in again for the technician already chosen.
    if (!box.innerHTML.trim() || jobDuration(st.draft) !== st.hours) fill(readForm(box).techId || '');
    check();
  }

  b.addEventListener('change', e => {
    if (!e.target.closest('#techBox')) return paint();
    const name = e.target.name;
    if (name === 'techId') fill(readForm(box).techId); // that technician's first free time and helper
    else if (name === 'jobDate') {
      const s = read();
      const free = s.technicianId && s.date ? freeJobStart(s.technicianId, s.date, st.draft, s.hours) : null;
      if (free != null) $('[name="jobTime"]', box).value = fmtHour(free);
    }
    check();
  });
  paint();

  // For Accept: null when not ticked; else the slot and anything that stops it.
  return () => (tick.checked && !tick.disabled ? { slot: read(), problems: problemsOf(read()) } : null);
}

// The toast's part about the booking (accept() returns booked = { problems, invoice }).
export function bookedText(r, slot) {
  if (!slot || !r.booked) return '';
  if (r.booked.problems?.length) return ` · not booked: ${r.booked.problems[0]}`;
  return ` · booked for ${empName(slot.technicianId)}, ${dayText(slot.date)} ${fmtHour(slot.start)}${r.booked.invoice ? ` · ${r.booked.invoice.no} raised` : ''}`;
}
