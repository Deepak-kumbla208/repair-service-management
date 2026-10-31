// Generic master list + form engine: page search, status filter, Code + Name, unique codes,
// placeholder tags, Active / Inactive status, and an editable child table (Value Set values).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, on, go, debounce, field, readForm, markInvalid, toast, fmtMoney, pill, placeholderTag, emptyRow } from '../core/ui.js';
import { withCompany } from '../core/lookups.js';
import { nextCode } from '../core/customers.js';
import { DEFS } from './master-defs.js';
import { renderCustomerList, renderCustomerForm } from './customer.js';
import { pageHead } from './shell.js';

const notFound = el => { el.innerHTML = '<div class="page"><div class="empty">Master not found.</div></div>'; };
const nameOf = (def, r) => r[def.nameField || 'name'];

function cell(def, col, r, company) {
  const [key, , opts = {}] = col;
  let v = typeof key === 'function' ? key(r) : r[key];
  if (opts.money) v = fmtMoney(v, company);
  if (opts.company) v = withCompany(v, company);
  const tags = typeof key === 'string' ? [r.placeholders?.includes(key) ? placeholderTag() : '', r.tags?.[key] ? placeholderTag(r.tags[key]) : ''] : [];
  return html`<td class="${opts.wrap ? 'wrap' : ''}">${v ?? ''} ${tags}</td>`;
}

export function renderMasterList(el, key) {
  if (key === 'customer') return renderCustomerList(el);
  const def = DEFS[key];
  if (!def) return notFound(el);
  const company = auth.company();
  const state = { q: '', status: '' };
  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Master', title: def.title, sub: def.note, actions: auth.can(key, 'create') ? html`<a class="btn primary" href="#/master/${key}/new">+ New</a>` : '' })}
    <div class="filters"><input type="search" class="search" id="q" placeholder="Search ${def.title}: code, name and details">
      <select id="st"><option value="">Active and inactive</option><option>Active</option><option>Inactive</option></select></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${def.columns.map(c => html`<th>${c[1]}</th>`)}<th>Status</th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="list-foot"><span id="count"></span></div>
  </div>`);

  function paint() {
    const all = store.list(def.coll).sort(def.sort || ((a, b) => String(a.code).localeCompare(String(b.code))));
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(r => (!state.status || (r.status || 'Active') === state.status)
      && terms.every(t => def.search(r).flat().join(' ').toLowerCase().includes(t)));
    $('#rows', el).innerHTML = String(shown.length ? html`${shown.map(r => html`<tr class="click" data-id="${r.id}">${def.columns.map(c => cell(def, c, r, company))}<td>${pill(r.status || 'Active')}</td></tr>`)}`
      : emptyRow(def.columns.length + 1, 'Nothing matches the search.'));
    $('#count', el).textContent = `${shown.length} of ${all.length} records`;
  }
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 120));
  $('#st', el).addEventListener('change', e => { state.status = e.target.value; paint(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => go(`master/${key}/${tr.dataset.id}`));
  paint();
}

// ---------- Child table editor (used by Value Set values) ----------
function tableEditor(box, f, rows, access, readOnly) {
  const canAdd = !readOnly && access !== 'System';
  const canRemove = !readOnly && access === 'User';
  const sync = () => $$('tr[data-r]', box).forEach(tr => {
    const r = rows[+tr.dataset.r];
    $$('[data-c]', tr).forEach(inp => { r[inp.dataset.c] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) : inp.value.trim(); });
  });
  const paint = () => {
    box.innerHTML = String(html`<div class="tbl-wrap" style="max-height:none"><table class="tbl edit"><thead><tr>${f.columns.map(c => html`<th>${c[1]}</th>`)}${canRemove ? html`<th></th>` : ''}</tr></thead><tbody>
      ${rows.map((r, i) => html`<tr data-r="${i}">${f.columns.map(([k, , type]) => html`<td>${type === 'checkbox'
        ? html`<input type="checkbox" data-c="${k}" ${r[k] ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>`
        : html`<input type="${type || 'text'}" data-c="${k}" value="${r[k] ?? ''}" ${readOnly || (k === 'code' && access === 'System' && !r.isNew) ? 'readonly' : ''}>`}</td>`)}
        ${canRemove ? html`<td><button type="button" class="btn link small" data-rm="${i}">Remove</button></td>` : ''}</tr>`)}
    </tbody></table></div>${canAdd ? html`<button type="button" class="btn small" id="addRow" style="margin-top:6px">+ Add value</button>` : ''}`);
    $('#addRow', box)?.addEventListener('click', () => { sync(); rows.push({ code: '', label: '', order: rows.length + 1, isDefault: false, active: true, isNew: true }); paint(); });
    $$('[data-rm]', box).forEach(b => b.addEventListener('click', () => { sync(); rows.splice(+b.dataset.rm, 1); paint(); }));
  };
  paint();
  return () => { sync(); return rows.map(({ isNew, ...r }) => r); };
}

export function renderMasterForm(el, key, id) {
  if (key === 'customer') return renderCustomerForm(el, id);
  const def = DEFS[key];
  if (!def) return notFound(el);
  const rec = id ? store.get(def.coll, id) : null;
  if (id && !rec) return notFound(el);
  const company = auth.company();
  const editable = auth.can(key, rec ? 'edit' : 'create');
  const draft = rec ? structuredClone(rec) : { code: def.codePrefix ? nextCode(def.coll, def.codePrefix, def.codePad || 4) : '' };
  let readTable = null;

  const fieldHtml = f => {
    if (f.type === 'gap') return html`<div></div>`;
    const opts = typeof f.options === 'function' ? f.options() : f.options;
    const tag = html`${draft.placeholders?.includes(f.name) ? placeholderTag() : ''}${draft.tags?.[f.name] ? placeholderTag(draft.tags[f.name]) : ''}`;
    const label = f.money ? `${f.label} (${company.currency})` : f.label;
    if (f.type === 'multi') {
      const vals = draft[f.name] || [];
      return html`<div class="field ${f.cls || ''}"><div class="field-label">${label}</div><div class="checks">${opts.map(o => html`<label class="check"><input type="checkbox" data-multi="${f.name}" value="${o.value}" ${vals.includes(o.value) ? 'checked' : ''} ${editable ? '' : 'disabled'}> ${o.label}</label>`)}</div></div>`;
    }
    if (f.type === 'table') return html`<div class="field ${f.cls || ''}"><div class="field-label">${label}</div><div id="tbl-${f.name}"></div></div>`;
    return field({ ...f, label, options: opts, value: draft[f.name], readonly: !editable, tag });
  };

  el.innerHTML = String(html`<div class="page" style="max-width:1100px">
    ${pageHead({
      crumb: html`Master › <a href="#/master/${key}">${def.title}</a>${rec ? ` › ${rec.code}` : ''}`,
      title: rec ? html`${rec.code} · ${nameOf(def, rec)} ${pill(rec.status || 'Active')}` : `New ${def.title}`,
      sub: def.note,
      actions: html`<div class="row"><a class="btn" href="#/master/${key}">Back to list</a>
        ${rec && editable ? html`<button class="btn" id="toggle">${rec.status === 'Inactive' ? 'Make active' : 'Make inactive'}</button>` : ''}
        ${editable ? html`<button class="btn primary" id="save">Save</button>` : ''}</div>`,
    })}
    ${editable ? '' : html`<div class="note" style="margin-bottom:10px">Read-only: your role can view this master but not change it.</div>`}
    <form class="card" id="f" onsubmit="return false"><div class="grid g3">${def.fields.map(fieldHtml)}</div>
      ${def.computed && rec ? html`<div class="kv" style="margin-top:12px">${def.computed.map(([label, fn, o]) => html`<div><div class="k">${label} (calculated)</div><div class="v strong">${o?.money ? fmtMoney(fn(rec), company) : fn(rec)}</div></div>`)}</div>` : ''}
    </form>
  </div>`);

  const tableField = def.fields.find(f => f.type === 'table');
  if (tableField) readTable = tableEditor($(`#tbl-${tableField.name}`, el), tableField, structuredClone(draft[tableField.name] || []), draft.access || 'User', !editable);

  $('#toggle', el)?.addEventListener('click', () => {
    const next = rec.status === 'Inactive' ? 'Active' : 'Inactive';
    store.setStatus(def.coll, rec.id, next);
    toast(`${rec.code} is now ${next.toLowerCase()}`);
    renderMasterForm(el, key, id);
  });

  $('#save', el)?.addEventListener('click', () => {
    const form = $('#f', el);
    const d = readForm(form);
    def.fields.filter(f => f.type === 'multi').forEach(f => { d[f.name] = $$(`[data-multi="${f.name}"]`, form).filter(x => x.checked).map(x => x.value); });
    if (readTable) d[tableField.name] = readTable();
    const missing = def.fields.filter(f => f.required && f.type !== 'table' && (d[f.name] === '' || d[f.name] == null)).map(f => f.name);
    if (!markInvalid(form, missing)) { toast('Fill in the required fields', 'bad'); return; }
    if (store.list(def.coll).some(r => r.id !== rec?.id && String(r.code).toLowerCase() === String(d.code).toLowerCase())) {
      markInvalid(form, ['code'], 'This code is already used'); return;
    }
    if (readTable && d[tableField.name].some(v => !v.code || !v.label)) { toast('Every value needs a code and a description', 'bad'); return; }
    const saved = rec ? store.update(def.coll, rec.id, d, `Edited ${def.title} ${d.code}`) : store.insert(def.coll, d, { status: 'Active', note: `Created ${def.title} ${d.code}` });
    toast(`${def.title} ${saved.code} saved`);
    go(`master/${key}/${saved.id}`);
  });
}
