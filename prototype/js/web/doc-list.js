// Shared list page for the Stretch 2 documents: count tiles above (each also a filter), the page's own search,
// a striped table, and click-to-open. Each list passes its rows, tiles and columns.
import { html, $, on, go, debounce, tiles, emptyRow } from '../core/ui.js';
import { pageHead } from './shell.js';

// cfg: { key, crumb, title, sub, actions, placeholder, rows(), tiles: [{ key, label, sub, tone, test }],
//        columns: [[header, row => value, cls?]], search: row => [texts], route: row => route, empty }
export function renderDocList(el, cfg) {
  const state = { tile: '', q: '' };
  try { Object.assign(state, JSON.parse(sessionStorage.getItem(cfg.key)) || {}); } catch { /* fresh state */ }
  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: cfg.crumb, title: cfg.title, sub: cfg.sub, actions: cfg.actions })}
    <div id="tiles"></div>
    <div class="filters"><input type="search" class="search" id="q" placeholder="${cfg.placeholder}" value="${state.q}">
      <button class="btn link" id="clear" hidden>Clear filter</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${cfg.columns.map(([h, , cls]) => html`<th class="${cls || ''}">${h}</th>`)}</tr></thead><tbody id="rows"></tbody></table></div>
    <div class="list-foot"><span id="count"></span></div>
  </div>`);

  function paint() {
    const all = cfg.rows();
    const defs = (cfg.tiles || []).map(t => ({ ...t, count: all.filter(t.test).length }));
    $('#tiles', el).innerHTML = defs.length ? String(tiles(defs, state.tile)) : '';
    const tile = defs.find(t => t.key === state.tile);
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(r => (!tile || tile.test(r)) && terms.every(t => cfg.search(r).flat().filter(Boolean).join(' ').toLowerCase().includes(t)));
    $('#rows', el).innerHTML = String(shown.length
      ? html`${shown.map((r, i) => html`<tr class="click" data-i="${all.indexOf(r)}">${cfg.columns.map(([, f, cls], c) => html`<td class="${cls || ''} ${c === 0 ? 'lnk' : ''}">${f(r)}</td>`)}</tr>`)}`
      : emptyRow(cfg.columns.length, all.length ? 'Nothing matches the search and filter.' : cfg.empty || 'Nothing here yet.'));
    $('#count', el).textContent = `${shown.length} of ${all.length}${tile ? ` · filtered by "${tile.label}"` : ''}`;
    $('#clear', el).hidden = !tile;
    sessionStorage.setItem(cfg.key, JSON.stringify(state));
    el._rows = all;
  }
  on(el, 'click', '[data-tile]', (e, b) => { state.tile = state.tile === b.dataset.tile ? '' : b.dataset.tile; paint(); });
  $('#clear', el).onclick = () => { state.tile = ''; paint(); };
  on(el, 'click', 'tr[data-i]', (e, tr) => go(cfg.route(el._rows[+tr.dataset.i])));
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 150));
  paint();
}
