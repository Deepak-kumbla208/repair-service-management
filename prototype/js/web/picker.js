// Type-to-search box for long lists such as products and parts (UX audit, finding 14). It takes the place of a plain
// drop-down: type a few letters, move with the arrow keys, Enter picks. The picked value sits in a hidden input that
// carries the attributes the drop-down had (data-c, data-f, name …) and fires "change", so the code that read the
// drop-down reads the picker without changes.
//   pickerHtml({ attrs: 'data-c="item"', value, label, placeholder, ariaLabel })
//   bindPickers(root, pickEl => [{ group, options: [{ value, label, sub }] }])
import { html, raw, esc } from '../core/ui.js';

const MAX = 60;

export function pickerHtml({ attrs = '', value = '', label = '', placeholder = 'Type to search', ariaLabel = 'Search', disabled = false, cls = '' }) {
  return html`<span class="pick ${cls}"><input type="text" class="pick-in" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" spellcheck="false"
    aria-label="${ariaLabel}" placeholder="${placeholder}" value="${label}" data-label="${label}" ${disabled ? raw('disabled') : ''}><input type="hidden" ${raw(attrs)} value="${value}"></span>`;
}

let pop = null; // the open list: { box, pick, input, rows, at }
// A page that redraws itself closes the open list first (its box is about to be removed).
export const closePicker = () => closePop();
function closePop() {
  if (!pop) return;
  pop.box.remove();
  pop.input.setAttribute('aria-expanded', 'false');
  pop.input.removeAttribute('aria-activedescendant');
  pop = null;
}

function matches(groups, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  let n = 0;
  for (const g of groups) {
    const hit = g.options.filter(o => terms.every(t => `${o.label} ${o.sub || ''} ${g.group}`.toLowerCase().includes(t)));
    // Names that start with what was typed come first.
    if (terms.length) hit.sort((a, b) => (b.label.toLowerCase().startsWith(terms[0]) ? 1 : 0) - (a.label.toLowerCase().startsWith(terms[0]) ? 1 : 0));
    if (!hit.length) continue;
    const take = hit.slice(0, Math.max(0, MAX - n));
    if (take.length) out.push({ group: g.group, options: take });
    n += take.length;
    if (n >= MAX) break;
  }
  return { out, total: groups.reduce((t, g) => t + g.options.filter(o => terms.every(x => `${o.label} ${o.sub || ''} ${g.group}`.toLowerCase().includes(x))).length, 0) };
}

function openPop(pick, input, groups, q) {
  closePop();
  const { out, total } = matches(groups, q);
  const box = document.createElement('div');
  box.className = 'pick-list';
  box.setAttribute('role', 'listbox');
  box.id = 'pickList';
  let i = 0;
  box.innerHTML = out.length ? out.map(g => `<div class="pick-g">${esc(g.group)}</div>${g.options.map(o => `<div class="pick-o" role="option" id="pick-o-${i}" data-n="${i++}" data-v="${esc(o.value)}" data-l="${esc(o.label)}">${esc(o.label)}${o.sub ? `<span>${esc(o.sub)}</span>` : ''}</div>`).join('')}`).join('')
    + (total > i ? `<div class="pick-more">${total - i} more: keep typing to narrow the list</div>` : '')
    : `<div class="pick-more">Nothing matches “${esc(q)}”.</div>`;
  (document.querySelector('.phone') || document.body).appendChild(box);
  const r = input.getBoundingClientRect();
  const phone = document.querySelector('.phone'), host = phone?.getBoundingClientRect();
  const below = innerHeight - r.bottom, h = Math.min(320, box.scrollHeight);
  const w = Math.min(Math.max(r.width, 280), (host ? host.width : innerWidth) - 16);
  box.style.width = `${w}px`;
  box.style.left = `${Math.max(8, Math.min(r.left, (host ? host.right : innerWidth) - w - 8)) - (host ? host.left + phone.clientLeft : 0)}px`;
  box.style.top = `${(below < h + 12 && r.top > h + 12 ? r.top - h - 4 : r.bottom + 4) - (host ? host.top + phone.clientTop : 0)}px`;
  if (host) box.style.position = 'absolute';
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'pickList');
  pop = { box, pick, input, rows: [...box.querySelectorAll('.pick-o')], at: -1 };
  // With something typed the first match is ready for Enter; an untouched list highlights the current value.
  const cur = pick.querySelector('input[type=hidden]').value;
  move(q ? 0 : Math.max(0, pop.rows.findIndex(x => x.dataset.v === cur)), true);
  box.addEventListener('mousedown', e => { const o = e.target.closest('.pick-o'); e.preventDefault(); if (o) choose(o); });
}

function move(to, quiet = false) {
  if (!pop || !pop.rows.length) return;
  pop.rows[pop.at]?.classList.remove('on');
  pop.at = Math.max(0, Math.min(pop.rows.length - 1, to));
  const row = pop.rows[pop.at];
  row.classList.add('on');
  pop.input.setAttribute('aria-activedescendant', row.id);
  if (!quiet || pop.at > 6) row.scrollIntoView({ block: 'nearest' });
}

function setValue(pick, value, label) {
  const input = pick.querySelector('.pick-in'), hidden = pick.querySelector('input[type=hidden]');
  input.value = label; input.dataset.label = label;
  const changed = hidden.value !== value;
  hidden.value = value;
  if (changed) hidden.dispatchEvent(new Event('change', { bubbles: true }));
}
function choose(row) {
  const { pick, input } = pop;
  closePop();
  setValue(pick, row.dataset.v, row.dataset.l);
  input.dispatchEvent(new CustomEvent('pick:done', { bubbles: true }));
}

// One set of listeners per root. getGroups(pickEl) gives the choices for that box.
export function bindPickers(root, getGroups) {
  if (root.dataset.pickBound) return;
  root.dataset.pickBound = '1';
  const show = input => openPop(input.closest('.pick'), input, getGroups(input.closest('.pick')), input.value === input.dataset.label ? '' : input.value);
  root.addEventListener('focusin', e => { if (e.target.matches?.('.pick-in')) e.target.select(); });
  root.addEventListener('click', e => { if (e.target.matches?.('.pick-in') && !pop) show(e.target); });
  root.addEventListener('input', e => { if (e.target.matches?.('.pick-in')) { e.stopPropagation(); show(e.target); } }, true);
  root.addEventListener('keydown', e => {
    const input = e.target;
    if (!input.matches?.('.pick-in')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!pop || pop.input !== input) return show(input);
      return move(pop.at + (e.key === 'ArrowDown' ? 1 : -1));
    }
    if (e.key === 'Enter') {
      if (pop && pop.input === input && pop.rows[pop.at]) { e.preventDefault(); e.stopPropagation(); choose(pop.rows[pop.at]); }
      return;
    }
    if (e.key === 'Escape' && pop) { e.stopPropagation(); input.value = input.dataset.label; closePop(); }
  }, true);
  root.addEventListener('focusout', e => {
    const input = e.target;
    if (!input.matches?.('.pick-in')) return;
    const pick = input.closest('.pick');
    // Leaving the box: a cleared box means "nothing picked"; half-typed text goes back to the picked name.
    setTimeout(() => {
      if (pop?.input === input) closePop();
      if (!pick.isConnected) return;
      if (!input.value.trim()) setValue(pick, '', '');
      else if (input.value !== input.dataset.label) input.value = input.dataset.label;
    }, 120);
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', closePop);
  window.addEventListener('scroll', e => { if (pop && !pop.box.contains(e.target)) closePop(); }, true);
  window.addEventListener('resize', closePop);
}
