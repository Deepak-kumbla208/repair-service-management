// The enquiry's "Later work" box: the items the customer will do later (from a quotation accepted in part), their
// follow-up date, "Not wanted" and "Quote the rest"; and the items not wanted, with the reason (core/later-work.js).
import * as auth from '../core/auth.js';
import * as store from '../core/store.js';
import { html, $, go, fmtDate, pill, toast, openModal, chipGroup, readForm } from '../core/ui.js';
import { priorityLabel } from '../core/inspections.js';
import { openLater, laterTotal, remindLater, dropLaterWork, quoteLaterWork, notWantedReasons, reasonLabel } from '../core/later-work.js';

const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRIO_TONE = { URGENT: 'red', NORMAL: 'amber', LATER: '' };
export const prioPill = p => pill(priorityLabel(p), PRIO_TONE[p] ?? '');
const what = i => (i.tag ? html`<b>${i.tag}</b> ${i.location}${i.sizeCode ? ` · ${i.sizeCode}` : ''}` : i.description);

export function laterCard(e) {
  const lw = e.laterWork, no = e.notWanted || [];
  if (!lw && !no.length) return '';
  const open = openLater(e);
  const can = auth.can('estimation', 'edit');
  const quoted = lw?.status === 'Quoted' ? store.get('enquiries', lw.enquiryId) : null;
  return html`<div class="card"><div class="card-head"><h2>Later work</h2>
      ${lw ? pill(open ? 'Waiting for the customer' : lw.status, open ? 'amber' : lw.status === 'Quoted' ? 'green' : '') : ''}<span class="grow"></span>
      ${open && can ? html`<label class="small muted">Follow up on <input type="date" id="lwDate" value="${lw.followUp}"></label><button class="btn small" id="lwDrop">Not wanted</button><button class="btn small primary" id="lwQuote">Quote the rest</button>` : ''}
      ${quoted ? html`<a class="btn small" href="#/enquiries/${quoted.id}">Open ${quoted.no}</a>` : ''}</div>
    ${lw ? html`<table class="tbl"><thead><tr><th>Product</th><th>Fault found (site report)</th><th>Action needed</th><th>Priority</th><th class="num">Last quoted</th></tr></thead><tbody>
      ${lw.items.map(i => html`<tr><td class="wrap">${what(i)}</td><td class="wrap">${i.fault}</td><td class="wrap">${i.action}</td><td>${prioPill(i.priority)}</td><td class="num">${m2(i.amount)}</td></tr>`)}
      <tr class="sum"><td colspan="4" class="num">Total</td><td class="num">${m2(laterTotal(lw))}</td></tr></tbody></table>
      <div class="muted small" style="margin-top:6px">From ${lw.quotationNo}, accepted in part on ${fmtDate(lw.since)}${open ? ` · reminder in My tasks on ${fmtDate(lw.followUp)}` : ''}${quoted ? ` · quoted in ${quoted.no}` : ''}.</div>` : ''}
    ${no.length ? html`<div class="form-sec" style="margin-top:12px">Not wanted</div><table class="tbl"><thead><tr><th>Product</th><th>Reason</th><th>From</th><th class="num">Last quoted</th></tr></thead><tbody>
      ${no.map(i => html`<tr><td class="wrap">${what(i)}${i.priority === 'URGENT' ? html` ${pill('Urgent', 'red')}` : ''}</td><td>${reasonLabel(i.reason)}</td><td class="small">${i.quotationNo} · ${fmtDate(i.at)}</td><td class="num">${m2(i.amount)}</td></tr>`)}</tbody></table>` : ''}
  </div>`;
}

export function bindLater(el, e, rerender) {
  $('#lwDate', el)?.addEventListener('change', ev => { remindLater(e.id, ev.target.value); toast(`Reminder moved to ${fmtDate(ev.target.value)}`); rerender(); });
  $('#lwDrop', el)?.addEventListener('click', () => openModal({
    title: 'The customer does not want the later items',
    body: html`<div class="form-lines"><div class="field"><label>Reason</label>${chipGroup('reason', notWantedReasons(), 'NOT_NEEDED')}</div>
      <div class="field"><label>Note</label><input type="text" name="note" placeholder="Optional"></div></div>`,
    actions: [{ label: 'Cancel' }, { label: 'Mark not wanted', kind: 'danger', onClick: b => { const d = readForm(b); dropLaterWork(e.id, d.reason, d.note); toast('Later work marked not wanted'); rerender(); } }],
  }));
  $('#lwQuote', el)?.addEventListener('click', () => {
    const r = quoteLaterWork(e.id);
    if (!r) return toast('Nothing left to quote', 'bad');
    toast(`${r.enquiry.no} and ${r.estimate.no} made from the later items`);
    go(`estimates/${r.estimate.id}`);
  });
}
