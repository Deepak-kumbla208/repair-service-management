// The phone's "Work offline" switch (Stretch 3 Part B). The store holds the phone's changes back from everyone else
// until the phone is back online (core/store.js); this module is what the screens use.
import * as store from './store.js';
import * as auth from './auth.js';

const state = () => store.offlineState();
// This user's phone is offline.
export const isOffline = () => { const o = state(); return !!o && o.userId === auth.user()?.id && o.tenantId === auth.company()?.id; };
// Another user's phone of this company is offline: { name, since, count } or null.
export function phoneOffline() {
  const o = state();
  if (!o || o.tenantId !== auth.company()?.id || o.userId === auth.user()?.id) return null;
  return { name: auth.userName(o.userId), since: o.since, count: waiting().length };
}
// The changes waiting on the phone, oldest first (from the audit entries it made while offline).
export function waiting() {
  const ids = state()?.bases?.audit || {};
  return store.all('audit').filter(a => a.id in ids && a.action !== 'login').sort((a, b) => a.at.localeCompare(b.at));
}
// The office's note on a record the phone has changed but not sent yet.
export function heldNote(refs) {
  const o = state(), p = phoneOffline();
  if (!p) return '';
  const held = refs.some(([coll, id]) => o.bases[coll] && o.bases[coll][id]);
  return held ? `${p.name}'s phone is offline since ${new Date(p.since).toTimeString().slice(0, 5)}: what was done on the phone reaches the office when it is back online.` : '';
}
export const goOffline = () => store.goOffline(auth.user().id);
// Returns the numbers given on sync: [{ temp, real }].
export function goOnline() {
  const n = waiting().length;
  const numbers = store.goOnline();
  store.audit('update', 'users', auth.user().id, `Back online: ${n} change${n === 1 ? '' : 's'} sent${numbers.length ? ` (${numbers.map(x => `${x.temp} → ${x.real}`).join(', ')})` : ''}`);
  return { count: n, numbers };
}
