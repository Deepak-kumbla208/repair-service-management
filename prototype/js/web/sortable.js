// Sort a list by clicking a column heading (UX audit, finding 5). The heading is a real button, so it works from the
// keyboard, and says which way it is sorted (aria-sort).
//   state: { sort: 'key' | '', dir: 'asc' | 'desc' }
import { html, raw } from '../core/ui.js';

export const sortHead = (label, key, state, cls = '', title = '') => html`<th class="sort ${cls}" data-sort="${key}" ${title ? raw(`title="${title}"`) : ''}
  ${state.sort === key ? raw(`aria-sort="${state.dir === 'desc' ? 'descending' : 'ascending'}"`) : ''}><button type="button">${label}<span class="dir" aria-hidden="true">${state.sort === key ? (state.dir === 'desc' ? '▼' : '▲') : '↕'}</span></button></th>`;

const plain = v => (v && typeof v === 'object' ? String(v).replace(/<[^>]+>/g, ' ') : v);
const numberLike = s => /^-?[\d,]+(\.\d+)?$/.test(s);
export function compare(a, b) {
  a = plain(a); b = plain(b);
  const ea = a == null || a === '', eb = b == null || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empty values last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a).trim(), sb = String(b).trim();
  if (numberLike(sa) && numberLike(sb)) return Number(sa.replace(/,/g, '')) - Number(sb.replace(/,/g, ''));
  // Dates as the screens write them ("5 Nov 2026", with or without a time) sort by day, not by letter.
  const day = /^\d{1,2} [A-Z][a-z]{2} \d{4}/;
  if (day.test(sa) && day.test(sb)) return Date.parse(sa.slice(0, 11).trim()) - Date.parse(sb.slice(0, 11).trim()) || sa.localeCompare(sb);
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}
// rows sorted by get(row); a stable copy, the list's own order kept between equal values.
export function sortRows(rows, get, dir = 'asc') {
  if (!get) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => ({ r, i, v: get(r) })).sort((x, y) => {
    const ex = x.v == null || x.v === '', ey = y.v == null || y.v === '';
    if (ex || ey) return ex === ey ? x.i - y.i : ex ? 1 : -1;
    return sign * compare(x.v, y.v) || x.i - y.i;
  }).map(x => x.r);
}
// A click on a heading: first ascending, then descending, then back to the list's own order.
export function nextSort(state, key) {
  if (state.sort !== key) { state.sort = key; state.dir = 'asc'; } else if (state.dir === 'asc') state.dir = 'desc'; else { state.sort = ''; state.dir = 'asc'; }
}
