// Phone parts shared by Home, My jobs and the job, report and visit screens (UX audit, 26 Nov 2026):
// the "New" mark on newly assigned work, the step bar, the list of problems that jumps to the field, Directions.
import * as auth from '../core/auth.js';
import { html, raw, icon, fmtDate, fmtTime, fmtDuration, fieldError } from '../core/ui.js';
import { isToday } from '../core/enquiries.js';
import { ux } from '../core/ux.js';

// ---------- "New" work (finding 20) ----------
// Work is new until this technician has opened it, and again when it is assigned or moved after that. The list of
// what was opened is kept per user in this browser, beside the demo data, so "Reset demo data" clears it too.
const prefix = () => (Object.keys(localStorage).find(k => /^rsm\.v\d+\.seeded$/.test(k)) || 'rsm.seeded').replace(/seeded$/, '');
const seenKey = () => `${prefix()}seen.${auth.user()?.id || ''}`;
function readSeen() { try { return JSON.parse(localStorage.getItem(seenKey()) || '{}'); } catch { return {}; } }
export function markSeen(id, when = '') {
  const s = readSeen();
  s[id] = { at: new Date().toISOString(), when: when || '' };
  try { localStorage.setItem(seenKey(), JSON.stringify(s)); } catch { /* storage full or blocked: the mark stays */ }
}
export function isNewWork(id, when = '', assignedAt = '') {
  const s = readSeen()[id];
  return !s || s.when !== (when || '') || (!!assignedAt && assignedAt > s.at);
}
export const newMark = () => html`<span class="new-dot">New</span>`;

// ---------- Words ----------
export const visitWord = () => (ux().plainMenus ? 'Maintenance visit' : 'AMC visit');
export function whenText(iso, none = 'Visit time not set') {
  if (!iso) return none;
  const d = new Date(iso), t = new Date();
  const tomorrow = new Date(t); tomorrow.setDate(t.getDate() + 1);
  const yesterday = new Date(t); yesterday.setDate(t.getDate() - 1);
  const day = isToday(iso) ? 'Today' : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : d.toDateString() === yesterday.toDateString() ? 'Yesterday' : fmtDate(iso);
  return `${day} ${fmtTime(iso)}`;
}
// A job assessment with no visit time yet: how long is left of the target the office works to.
export function targetText(clock) {
  if (!clock || clock.done) return '';
  return clock.left > 0 ? `Assess within ${fmtDuration(clock.left)}` : `${fmtDuration(-clock.left)} over the ${Math.round(clock.target / 3600000)}-hour target`;
}

// ---------- Buttons ----------
export const callBtn = (phone, label = 'Call') => (phone ? html`<a class="btn" href="tel:${String(phone).replace(/\s/g, '')}">${icon('call', 18)} ${label}</a>` : '');
export const directionsBtn = address => (address ? html`<a class="btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" rel="noopener">${icon('pin', 18)} Directions</a>` : '');

// ---------- The step bar ----------
// steps: [{ title, short, href, state }] with state 'done' (it has what it needs), 'skip' (passed with nothing in it),
// 'bad' (something is missing and was asked for) or '' (not done yet). cur: the index of the step on screen.
const MARK = { done: '✓', skip: '–', bad: '!' };
const SAYS = { done: ': done', skip: ': skipped', bad: ': something is missing', '': '' };
export function stepBar(steps, cur) {
  return html`<div class="m-step-head"><b>${cur + 1}. ${steps[cur].title}</b><span>${cur + 1} of ${steps.length}</span></div>
    <nav class="m-prog" aria-label="Steps">${steps.map((s, i) => html`<a href="#/${s.href}" data-jump="${i}" class="${s.state || ''} ${i === cur ? 'now' : ''}" aria-label="${i + 1}. ${s.title}${SAYS[s.state || '']}" ${i === cur ? raw('aria-current="step"') : ''}><i>${MARK[s.state] || i + 1}</i>${s.short || s.title}</a>`)}</nav>`;
}

// ---------- Problems (finding 16) ----------
// A list at the top of the screen, each line a link that jumps to its step and field. list: [{ text, tag }].
export const problemsBox = (list, lead) => (list.length ? html`<div class="m-probs" role="alert"><b>${lead}</b>
  ${list.map((p, i) => html`<a href="#" data-prob="${i}">${p.tag ? html`<span class="st">${p.tag}</span>` : ''}<span>${p.text}</span></a>`)}</div>` : '');
// The message under a field; a field that is not on screen (for example in a closed card) is opened first.
export function showAt(el, text, focus = true) {
  if (!el) return false;
  el.closest('details:not([open])')?.setAttribute('open', '');
  fieldError(el, text, { focus });
  return true;
}
// The step of a site report the technician was on last ("Continue the report" opens it).
export const lastStepKey = id => `rsmRepAt.${id}`;
// What to jump to after the screen changes: kept for one screen change only.
const JUMP = 'rsmPhoneJump';
export const setJump = j => sessionStorage.setItem(JUMP, JSON.stringify(j));
export function takeJump() {
  let j = null;
  try { j = JSON.parse(sessionStorage.getItem(JUMP) || 'null'); } catch { j = null; }
  sessionStorage.removeItem(JUMP);
  return j;
}
