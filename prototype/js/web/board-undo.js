// Undo for the scheduling boards (UX audit, findings 3 and 18): a job or a maintenance visit that was just scheduled
// or moved goes back exactly as it was (not scheduled, or its earlier technician, helper, days and time). The record
// is copied before the change and that copy is put back; the Activity list keeps one line saying it was undone.
import * as store from '../core/store.js';
import { bookings, fmtHour } from '../core/jobs.js';
import { invoiceForJob, syncDueDate } from '../core/billing.js';
import { empName } from '../core/lookups.js';
import { dayText } from './board-drag.js';

// What scheduling writes on a job (scheduleJob) and on a visit (scheduleVisit, which also confirms the date).
const FIELDS = {
  jobs: ['technicianId', 'helperIds', 'blocks', 'start', 'end', 'status', 'statusHistory'],
  amcVisits: ['technicianId', 'helperIds', 'blocks', 'start', 'end', 'status', 'statusHistory', 'confirmedDate', 'confirmedVia'],
};
const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const startHour = rec => rec.blocks?.[0]?.from ?? (rec.start ? new Date(rec.start).getHours() + new Date(rec.start).getMinutes() / 60 : null);
const firstDay = rec => rec.blocks?.[0]?.date || (rec.start ? dayOfIso(rec.start) : '');
const dayOfIso = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const slotText = rec => `${empName(rec.technicianId)}, ${dayText(firstDay(rec))} ${fmtHour(startHour(rec))}`;

// Take this before scheduling: the record as it is now.
export function before(coll, id) {
  const rec = store.get(coll, id);
  return { coll, id, name: coll === 'jobs' ? rec.no : `${rec.contractNo} visit ${rec.n}`, booked: !!rec.start && rec.status === 'Scheduled',
    fields: Object.fromEntries(FIELDS[coll].map(k => [k, copy(rec[k])])), invoiceId: coll === 'jobs' ? invoiceForJob(id)?.id || '' : '' };
}

// After scheduling: the function behind the "Undo" button, or null when the step cannot be taken back cleanly.
// That is the case when this scheduling raised the invoice (payment immediate): it is posted with its number at
// once, and a posted invoice is only ever cancelled, never removed. The job can still be moved.
// done(text, kind) is called with what to tell the user.
export function undoOf(was, { invoice = null } = {}, done = () => {}) {
  if (invoice && invoice.id !== was.invoiceId) return null;
  const now = store.get(was.coll, was.id);
  const stamp = { status: now.status, start: now.start, technicianId: now.technicianId };
  return () => {
    const cur = store.get(was.coll, was.id);
    if (!cur || store.heldByOther(was.coll, was.id) || Object.keys(stamp).some(k => cur[k] !== stamp[k])) return done(`${was.name} has changed since, so it was not undone.`, 'bad');
    // Going back to an earlier slot: nothing else may have been booked there in the meantime.
    const taken = was.booked && (was.fields.blocks || []).some(b => bookings(was.fields.technicianId, b.date, was.id).some(x => x.from < b.to - 0.01 && x.to > b.from + 0.01));
    if (taken) return done(`${empName(was.fields.technicianId)} has been booked at the earlier time since, so ${was.name} was not moved back.`, 'bad');
    const back = `${was.name} is ${was.booked ? `back with ${slotText(was.fields)}` : was.coll === 'jobs' ? 'back in the not scheduled list' : `${String(was.fields.status).toLowerCase()} again`}`;
    store.update(was.coll, was.id, was.fields, `Undone: ${back}`);
    if (was.coll === 'jobs') syncDueDate(was.id); // an immediate invoice's due date follows the visit day back
    done(back, '');
  };
}
