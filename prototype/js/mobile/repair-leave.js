// Phone: leaving the site after a repair job (UX audit, finding 24). The technician sees the checks first (form signed,
// after photos, money collected) with a link to put right what is missing. When every check passes and the company's
// working style allows it, the app gives the OK at once; otherwise the office is asked, and the waiting screen looks
// for the answer by itself every few seconds. A "Not yet" from the office shows with its reason and can be asked again.
import * as store from '../core/store.js';
import { html, $, toast, fmtTime, fmtDuration } from '../core/ui.js';
import { leaveChecks, requestLeave, checkOut } from '../core/jobs.js';
import { ux } from '../core/ux.js';
import { isOffline } from '../core/offline.js';
import { holdNext } from './shell.js';
import { noPaymentLine } from './repair-steps.js';

const FIX = { signed: ['signoff', 'Go to the sign-off'], photos: ['works', 'Add after photos'], payment: ['payment', 'Record the payment'] };
const checkList = j => html`<ul class="m-checks">${leaveChecks(j).map(c => html`<li class="${c.ok ? '' : 'no'}"><span class="mk">${c.ok ? '✓' : '!'}</span><span class="tx">${c.text}</span>
  ${c.ok ? '' : html`<a class="btn small" href="#/m/rjob/${j.id}/${FIX[c.key][0]}">${FIX[c.key][1]}</a>`}</li>`)}</ul>`;
const waiting = l => !!l?.requestedAt && !l.confirmedAt && !l.declinedAt;
const ago = iso => (Date.now() - new Date(iso) < 60000 ? 'just now' : `${fmtDuration(Date.now() - new Date(iso))} ago`);

export function leaveBody(j) {
  const l = j.leaveSite;
  const allOk = leaveChecks(j).every(c => c.ok);
  if (j.steps?.checkOutAt) return html`<div class="okay"><b>✓ Checked out at ${fmtTime(j.steps.checkOutAt)}</b><br>Job done. Thank you.</div>`;
  if (l?.confirmedAt) return html`<div class="okay"><b>✓ You may leave</b><br>${l.auto ? 'Every check has passed.' : `The office said OK at ${fmtTime(l.confirmedAt)}.`} Check out to set Time Out.</div>
    <div class="m-card" style="margin-top:10px">${checkList(j)}</div>`;
  if (!j.workDone?.signedAt) return html`<div class="m-card"><p>The customer has not signed the Work Done form yet.</p><a class="btn block" href="#/m/rjob/${j.id}/signoff">Go to the sign-off</a></div>`;
  if (waiting(l)) return html`<div class="wait" id="waitBox"><b>Waiting for the office<span class="dots"></span></b><br>
      ${isOffline() ? `Asked at ${fmtTime(l.requestedAt)} while offline: the request reaches the office when the phone is back online.`
        : html`Asked at ${fmtTime(l.requestedAt)}, <span id="waitAgo">${ago(l.requestedAt)}</span>. This screen shows the answer by itself.`}</div>
    <div class="m-card" style="margin-top:10px">${checkList(j)}</div>`;
  return html`${l?.declinedAt ? html`<div class="note bad" role="alert"><b>Not yet: ${l.declineReason || 'the office asks you to stay'}</b><br><span class="small">From the office at ${fmtTime(l.declinedAt)}. Put it right, then ask again.</span></div>` : ''}
    <div class="m-section">Before you leave</div>
    <div class="m-card">${checkList(j)}</div>
    <p class="m-info">${allOk && ux().autoLeave ? 'Every check has passed: you may leave without waiting for the office.'
      : allOk ? 'The office gives the OK before you leave.' : 'Something is missing. Put it right if you can; otherwise the office decides.'}</p>
    ${noPaymentLine(j) ? html`<p class="m-info">${noPaymentLine(j)}</p>` : ''}`;
}

// The step's own button in the footer ('' while waiting: the answer comes by itself).
export function leaveFoot(j) {
  const l = j.leaveSite;
  if (j.steps?.checkOutAt) return html`<a class="btn primary" href="#/m/jobs">Back to My jobs</a>`;
  if (l?.confirmedAt) return html`<button class="btn primary" id="out">Check out · Time Out now</button>`;
  if (!j.workDone?.signedAt || waiting(l)) return '';
  const auto = ux().autoLeave && leaveChecks(j).every(c => c.ok);
  return html`<button class="btn primary" id="ask">${auto ? 'Leave the site' : l?.declinedAt ? 'Ask the office again' : 'Ask the office'}</button>`;
}

// The record as another window saved it: the office usually answers from its own window, which this one cannot see
// without loading the data again.
function savedAnswer(id) {
  try {
    const key = Object.keys(localStorage).find(k => /^rsm\.v\d+\.jobs$/.test(k));
    const l = JSON.parse(localStorage.getItem(key) || '[]').find(r => r.id === id)?.leaveSite;
    return `${l?.confirmedAt || ''}|${l?.declinedAt || ''}`;
  } catch { return ''; }
}

export function bindLeave(page, foot, id, repaint) {
  $('#ask', foot)?.addEventListener('click', () => {
    holdNext();
    requestLeave(id); // 'auto': the app gave the OK; 'asked': the waiting screen shows next
    repaint();
  });
  $('#out', foot)?.addEventListener('click', e => {
    if (e.currentTarget.dataset.held) return;
    checkOut(id); holdNext(); toast(`Checked out · Time Out ${fmtTime(new Date().toISOString())}`); repaint();
  });
  // Waiting: look for the answer every few seconds; the timer stops when this screen is gone.
  const box = $('#waitBox', page.body);
  if (!box) return;
  const before = savedAnswer(id);
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return; }
    if (savedAnswer(id) !== before) store.reload('jobs'); // the office answered from its own window
    const job = store.get('jobs', id), l = job?.leaveSite;
    if (l?.confirmedAt || l?.declinedAt) { clearInterval(timer); repaint(); return; }
    // Every check passes now (a photo was added, the payment recorded): no need to keep waiting for the office.
    if (job && ux().autoLeave && !isOffline() && leaveChecks(job).every(c => c.ok) && requestLeave(id) === 'auto') { clearInterval(timer); repaint(); return; }
    const agoEl = $('#waitAgo', box);
    if (agoEl && l?.requestedAt) agoEl.textContent = ago(l.requestedAt);
  }, 4000);
}
