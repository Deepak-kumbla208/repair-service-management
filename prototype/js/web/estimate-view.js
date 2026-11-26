// Shared by the repair and the AMC estimate pages: the money format, the parts list for the type-to-search box of
// the Materials tab, the joined switches and the markup box of the one-row Costing card, and redrawing the page
// without losing the scroll position or the cursor. No price maths here: every figure comes from estimateSummary
// (core/costing.js).
import * as store from '../core/store.js';
import { html, raw, fmtNum } from '../core/ui.js';
import { itemChoices, vsOptions } from '../core/lookups.js';

export const m2 = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- The one-row Costing card (user's choice A, 26 Nov 2026) ----------
// A small joined switch: the same radio buttons as the chips, side by side.
export const segGroup = (name, options, value, readonly, label) => html`<span class="segc" role="radiogroup" aria-label="${label}">${options.map(o => html`<label><input type="radio" name="${name}" value="${o.value}"
  ${String(o.value) === String(value) ? raw('checked') : ''} ${readonly ? raw('disabled') : ''}><span>${o.label}</span></label>`)}</span>`;
// The figures set by the Admin: overheads and the markup only with "See markup" (sees), Change only with "Change
// markup" (change; open says whether its box is open), and the tax.
export function costFacts(est, { sees, change, open = false }) {
  const one = est.overheads.length === 1 && est.overheads[0].basis !== 'FIXED';
  const oh = est.overheads.map(o => (o.basis === 'FIXED' ? `${m2(o.value)} fixed` : `${fmtNum(o.value)} %`)).join(' + ');
  const onPrice = est.marginBasis === 'MARGIN';
  return html`<span class="cs-facts">
    ${sees ? html`<span class="cs-fact">Overheads <b>${oh || '0 %'}</b>${one ? ' of direct cost' : ''}</span>
    <span class="cs-fact">${onPrice ? 'Margin' : 'Markup'} <b>${fmtNum(est.marginPct)} %</b> ${onPrice ? 'of the price' : 'on cost'}${change
      ? html`<button type="button" class="btn link cs-change" id="mkChange" aria-haspopup="dialog" aria-expanded="${open ? 'true' : 'false'}">Change</button>` : ''}</span>` : ''}
    <span class="cs-fact">${est.taxCode ? html`Tax <b>${est.taxLabel} ${fmtNum(est.taxRate)} %</b>` : 'No tax charged'}</span>
  </span>`;
}
// Change: the margin basis and percent in a small box under the button. It sits inside the page (root), so the page's
// own handlers save what is typed and re-price as you type. Done, Escape, a click elsewhere or a scroll closes it;
// onClose(back) is told, back = the cursor should return to Change. Returns the function that closes it.
export function openMarkupBox(root, est, btn, onClose) {
  const pop = document.createElement('div');
  pop.className = 'mk-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Change the markup of this estimate');
  pop.innerHTML = String(html`<div class="mk-r"><span class="cs-l">Basis</span>${segGroup('marginBasis', vsOptions('MARGIN_BASIS'), est.marginBasis, false, 'Margin basis')}</div>
    <div class="mk-r"><label class="cs-l" for="est-margin">Margin %</label><input type="number" step="any" id="est-margin" data-h="marginPct" value="${est.marginPct}"></div>
    <div class="mk-foot"><button type="button" class="btn primary small" data-mk-done>Done</button></div>`);
  root.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8))}px`;
  const onDown = e => { if (!pop.contains(e.target) && !e.target.closest('#mkChange')) done(false); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); done(true); } };
  const onScroll = e => { if (!pop.contains(e.target)) done(false); };
  const done = back => {
    pop.remove();
    document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); document.removeEventListener('scroll', onScroll, true);
    onClose(back);
  };
  setTimeout(() => { document.addEventListener('mousedown', onDown, true); document.addEventListener('keydown', onKey, true); document.addEventListener('scroll', onScroll, true); });
  pop.querySelector('[data-mk-done]').onclick = () => done(true);
  pop.querySelector('#est-margin').focus();
  return done;
}

// ---------- Parts and materials for the type-to-search box (the Materials tab's list, grouped as the master is) ----------
// keep: ids already on the estimate, offered even when switched off since.
export function partGroups(keep = []) {
  return itemChoices(keep.filter(Boolean).map(id => `itm:${id}`))
    .map(g => ({ group: g.group.replace(/^Parts · /, ''), options: g.options.filter(o => o.value.startsWith('itm:')).map(o => {
      const it = store.get('items', o.value.slice(4));
      return { value: o.value.slice(4), label: o.label, sub: it ? `${m2(it.rate)} / ${it.unit || 'Nos'}` : '' };
    }) }))
    .filter(g => g.options.length);
}

// ---------- Redrawing without losing the place ----------
const scroller = root => root.closest('.content') || document.scrollingElement;
const find = a => {
  const d = a.dataset;
  if (a.id) return `#${CSS.escape(a.id)}`;
  if (d.t) return `[data-t="${d.t}"][data-i="${d.i}"][data-f="${d.f}"]`;
  if (d.p) return `[data-p="${CSS.escape(d.p)}"]`;
  if (d.h) return `[data-h="${d.h}"]`;
  if (d.tab) return `[data-tab="${d.tab}"]`;
  if (a.type === 'radio' && a.name) return `input[name="${a.name}"][value="${CSS.escape(a.value)}"]`;
  return '';
};
// Where the cursor is, as something that can be found again after a redraw (a type-to-search box by its hidden input).
function cursor(root) {
  const a = document.activeElement;
  if (!a || a === document.body || !root.contains(a)) return null;
  const pick = a.classList.contains('pick-in');
  const sel = find(pick ? a.parentElement.querySelector('input[type=hidden]') : a);
  if (!sel) return null;
  let range = null;
  try { if (a.tagName === 'TEXTAREA' || a.type === 'text') range = [a.selectionStart, a.selectionEnd]; } catch { range = null; }
  return { sel, pick, range };
}
// scroll: bring the control into view (a row just added); otherwise the page stays where it is.
export function focusOn(root, sel, { pick = false, range = null, scroll = false } = {}) {
  let x = sel ? root.querySelector(sel) : null;
  if (x && (pick || x.type === 'hidden')) x = x.parentElement.querySelector('.pick-in');
  if (!x) return null;
  x.focus({ preventScroll: !scroll });
  try { if (range) x.setSelectionRange(range[0], range[1]); else if (x.tagName === 'INPUT' && x.type !== 'radio') x.select(); } catch { /* not a text box */ }
  return x;
}
// Redraw (paint) and put the scroll position and the cursor back. box: an area that keeps enough height for the
// position to stay valid when its new content is shorter (a short tab after a long one), so the page does not jump.
// focus: { sel, pick, scroll } puts the cursor somewhere new instead (the quantity of a part just added).
export function redraw(root, paint, { box = null, focus = null } = {}) {
  const sc = scroller(root), top = sc.scrollTop;
  const cur = focus ? null : cursor(root);
  // An open type-to-search list belongs to a box that is about to be replaced: it is closed (the picker closes on a
  // scroll) and opened again on the new box when the cursor was in it.
  const listOpen = !!document.querySelector('.pick-list');
  if (listOpen) document.dispatchEvent(new Event('scroll'));
  paint();
  const holder = typeof box === 'function' ? box() : box;
  if (holder) {
    holder.style.minHeight = '';
    const lack = top + sc.clientHeight - sc.scrollHeight;
    if (lack > 0) holder.style.minHeight = `${holder.offsetHeight + lack}px`;
  }
  sc.scrollTop = top;
  const at = focus ? focusOn(root, focus.sel, focus) : cur ? focusOn(root, cur.sel, cur) : null;
  if (at && listOpen && cur?.pick) at.click();
}
