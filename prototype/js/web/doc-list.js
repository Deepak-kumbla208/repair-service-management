// Shared list page for the Stretch 2 documents: count tiles above (each also a filter), the page's own search,
// a striped table, and click-to-open. Each list passes its rows, tiles and columns.
// UX audit (findings 5 and 26): headings sort the list, and the first cell of a row is a real link
// (keyboard, "open in new tab"); the whole row still opens on a click.
import { html, $, on, go, debounce, tiles, emptyRow } from '../core/ui.js';
import { pageHead } from './shell.js';
import { sortHead, sortRows, nextSort } from './sortable.js';

// cfg: { key, crumb, title, sub, actions, placeholder, rows(), tiles: [{ key, label, sub, tone, test }],
//        columns: [[header, row => value, cls?, row => sortValue?]], search: row => [texts], route: row => route, empty }
export function renderDocList(el, cfg) {
  const state = { tile: '', q: '', sort: '', dir: 'asc' };
  try { Object.assign(state, JSON.parse(sessionStorage.getItem(cfg.key)) || {}); } catch { /* fresh state */ }
  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: cfg.crumb, title: cfg.title, sub: cfg.sub, actions: cfg.actions })}
    <div id="tiles"></div>
    <div class="filters"><input type="search" class="search" id="q" aria-label="${cfg.placeholder}" placeholder="${cfg.placeholder}" value="${state.q}">
      <button class="btn link" id="clear" hidden>Clear filter</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead id="head"></thead><tbody id="rows"></tbody></table></div>
    <div class="list-foot"><span id="count"></span><span>Click a heading to sort.</span></div>
  </div>`);

  function paint() {
    const all = cfg.rows();
    const defs = (cfg.tiles || []).map(t => ({ ...t, count: all.filter(t.test).length }));
    $('#tiles', el).innerHTML = defs.length ? String(tiles(defs, state.tile)) : '';
    const tile = defs.find(t => t.key === state.tile);
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const col = cfg.columns[Number(state.sort)];
    const shown = sortRows(all.filter(r => (!tile || tile.test(r)) && terms.every(t => cfg.search(r).flat().filter(Boolean).join(' ').toLowerCase().includes(t))),
      state.sort !== '' && col ? (col[3] || col[1]) : null, state.dir);
    $('#head', el).innerHTML = String(html`<tr>${cfg.columns.map(([h, , cls], i) => sortHead(h, String(i), state, cls || ''))}</tr>`);
    $('#rows', el).innerHTML = String(shown.length
      ? html`${shown.map(r => html`<tr class="click" data-i="${all.indexOf(r)}">${cfg.columns.map(([, f, cls], c) => html`<td class="${cls || ''}">${c === 0 ? html`<a class="rowlink" href="#/${cfg.route(r)}">${f(r)}</a>` : f(r)}</td>`)}</tr>`)}`
      : emptyRow(cfg.columns.length, all.length ? 'Nothing matches the search and filter.' : cfg.empty || 'Nothing here yet.'));
    $('#count', el).textContent = `${shown.length} of ${all.length}${tile ? ` · filtered by "${tile.label}"` : ''}`;
    $('#clear', el).hidden = !tile;
    sessionStorage.setItem(cfg.key, JSON.stringify(state));
    el._rows = all;
  }
  on(el, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  $('#clear', el).onclick = () => { state.tile = ''; paint(); };
  on(el, 'click', 'tr[data-i]', (e, tr) => { if (!e.target.closest('a')) go(cfg.route(el._rows[+tr.dataset.i])); });
  on(el, 'click', 'th[data-sort]', (e, th) => { nextSort(state, th.dataset.sort); paint(); $(`th[data-sort="${th.dataset.sort}"] button`, el)?.focus(); });
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}
