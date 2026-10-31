// Global search box (Ctrl+K on the web, search icon on the phone). Results come from core/search.js,
// which only returns what the user's role may open in the current view.
import { html, overlayRoot, go, debounce } from '../core/ui.js';
import { globalSearch } from '../core/search.js';
import * as auth from '../core/auth.js';

export function openPalette() {
  if (document.querySelector('.palette-back')) return;
  const back = document.createElement('div');
  back.className = 'palette-back';
  back.innerHTML = String(html`<div class="palette" role="dialog" aria-label="Search">
    <div class="palette-in"><span class="muted">⌕</span><input type="search" placeholder="Search enquiries, customers, sites, shutters, reports, masters…" aria-label="Search"><kbd>Esc</kbd></div>
    <div class="palette-res"><div class="empty">Type to search. Results are limited to what ${auth.role()?.name || 'your role'} can open.</div></div>
    <div class="palette-foot"><span>Shows only what your role can open</span><span class="grow"></span><span>↑↓ move</span><span>Enter open</span><span>Esc close</span></div>
  </div>`);
  overlayRoot().appendChild(back);
  const input = back.querySelector('input');
  const res = back.querySelector('.palette-res');
  let items = [], sel = 0;

  const close = () => { back.remove(); document.removeEventListener('keydown', keys, true); };
  const open = i => { const it = items[i]; if (!it) return; close(); go(it.route); };
  const paint = () => res.querySelectorAll('.p-item').forEach((el, i) => el.classList.toggle('sel', i === sel));

  const run = debounce(() => {
    const groups = globalSearch(input.value);
    items = groups.flatMap(g => g.items);
    sel = 0;
    let n = 0;
    res.innerHTML = input.value.trim() && !items.length
      ? String(html`<div class="empty">No matches you can open.</div>`)
      : String(html`${groups.map(g => html`<div class="p-group">${g.group}${g.more ? ` (+${g.more} more)` : ''}</div>
          ${g.items.map(it => html`<div class="p-item" data-i="${n++}"><span class="p-ic">${it.icon}</span>
            <div class="grow"><div>${it.title}</div><div class="p-sub">${it.sub}</div></div></div>`)}`)}`);
    paint();
  }, 120);

  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); res.querySelector('.p-item.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); res.querySelector('.p-item.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); open(sel); }
  }
  document.addEventListener('keydown', keys, true);
  input.addEventListener('input', run);
  back.addEventListener('click', e => {
    if (e.target === back) return close();
    const it = e.target.closest('.p-item');
    if (it) open(+it.dataset.i);
  });
  input.focus();
}
