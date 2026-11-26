// Generic master list + form engine: page search, status filter, Code + Name, unique codes,
// placeholder tags, Active / Inactive status, an editable child table (Value Set values), group headings with count
// tiles (groupBy), and fields shown only when they apply (showIf).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, on, go, debounce, field, readForm, markInvalid, toast, fmtMoney, pill, placeholderTag, emptyRow, tiles } from '../core/ui.js';
import { withCompany } from '../core/lookups.js';
import { nextCode } from '../core/customers.js';
import { DEFS } from './master-defs.js';
import { renderCustomerList, renderCustomerForm } from './customer.js';
import { renderProductSize } from './product-size.js';
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
  if (key === 'size') return renderProductSize(el, null);
  const def = DEFS[key];
  if (!def) return notFound(el);
  const company = auth.company();
  const state = { q: '', status: '', group: '' };
  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Master', title: def.title, sub: def.note, actions: auth.can(key, 'create') ? html`<a class="btn primary" href="#/master/${key}/new">+ New</a>` : '' })}
    ${def.groupBy ? html`<div id="tiles"></div>` : ''}
    <div class="filters"><input type="search" class="search" id="q" placeholder="Search ${def.title}: code, name and details">
      <select id="st"><option value="">Active and inactive</option><option>Active</option><option>Inactive</option></select></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${def.columns.map(c => html`<th>${c[1]}</th>`)}<th>Status</th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="list-foot"><span id="count"></span></div>
  </div>`);

  // groupBy: rows under a heading per group, in the group list's order; a count tile per group filters the list.
  const grp = def.groupBy;
  const groupOrder = () => { const o = grp.order(); return g => (o.includes(g) ? o.indexOf(g) : o.length); };
  function paint() {
    const all = store.list(def.coll).sort(def.sort || ((a, b) => String(a.code).localeCompare(String(b.code))));
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = all.filter(r => (!state.status || (r.status || 'Active') === state.status) && (!state.group || grp.label(r) === state.group)
      && terms.every(t => def.search(r).flat().join(' ').toLowerCase().includes(t)));
    const row = r => html`<tr class="click" data-id="${r.id}">${def.columns.map(c => cell(def, c, r, company))}<td>${pill(r.status || 'Active')}</td></tr>`;
    let body = shown.map(row);
    if (grp) {
      const rank = groupOrder();
      const names = [...new Set(shown.map(grp.label))].sort((a, b) => rank(a) - rank(b));
      body = names.map(g => html`<tr class="grp-row"><td colspan="${def.columns.length + 1}">${g}</td></tr>${shown.filter(r => grp.label(r) === g).map(row)}`);
      const counts = [...new Set(all.map(grp.label))].sort((a, b) => rank(a) - rank(b));
      $('#tiles', el).innerHTML = String(tiles([{ key: '', label: 'All', count: all.length }, ...counts.map(g => ({ key: g, label: g, count: all.filter(r => grp.label(r) === g).length }))], state.group));
    }
    $('#rows', el).innerHTML = String(shown.length ? html`${body}` : emptyRow(def.columns.length + 1, 'Nothing matches the search.'));
    $('#count', el).textContent = `${shown.length} of ${all.length} records`;
  }
  if (grp) on(el, 'click', '[data-tile]', (e, b) => { state.group = b.dataset.tile; paint(); });
  $('#q', el).addEventListener('input', debounce(e => { state.q = e.target.value; paint(); }, 120));
  $('#st', el).addEventListener('change', e => { state.status = e.target.value; paint(); });
  on(el, 'click', 'tr[data-id]', (e, tr) => go(`master/${key}/${tr.dataset.id}`));
  paint();
}

// ---------- Child table editor (used by Value Set values) ----------
// f.columns may depend on the record (the AMC check list has more columns).
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
  if (key === 'size') return renderProductSize(el, id || 'new');
  const def = DEFS[key];
  if (!def) return notFound(el);
  const rec = id ? store.get(def.coll, id) : null;
  if (id && !rec) return notFound(el);
  const company = auth.company();
  const editable = auth.can(key, rec ? 'edit' : 'create');
  const draft = rec ? { ...(def.defaults?.() || {}), ...structuredClone(rec) } : { ...(def.defaults?.() || {}), code: def.codePrefix ? nextCode(def.coll, def.codePrefix, def.codePad || 4) : '' };
  let readTable = null;
  const shows = (f, d) => !f.showIf || f.showIf(d);
  const needed = (f, d) => (f.required || f.requiredIf?.(d)) && shows(f, d);
  // Fields locked while the record is in use (a product's costing): shown, not changeable.
  const uses = rec && def.lockWhenUsed ? def.lockWhenUsed.uses(rec) : null;
  const locked = f => !!uses?.total && def.lockWhenUsed.fields.includes(f.name);

  // A field shown only when it applies (showIf) sits in a wrapper that hides with it.
  const fieldHtml = f => (f.showIf ? html`<div class="showif" data-show="${f.name}" ${shows(f, draft) ? '' : 'hidden'}>${fieldBody(f)}</div>` : fieldBody(f));
  const fieldBody = f => {
    if (f.type === 'gap') return html`<div></div>`;
    const opts = typeof f.options === 'function' ? f.options() : f.options;
    const tag = html`${draft.placeholders?.includes(f.name) ? placeholderTag() : ''}${draft.tags?.[f.name] ? placeholderTag(draft.tags[f.name]) : ''}`;
    const label = f.money ? `${f.label} (${company.currency})` : f.label;
    if (f.type === 'multi') {
      const vals = draft[f.name] || [];
      return html`<div class="field ${f.cls || ''}"><div class="field-label">${label}</div><div class="checks">${opts.map(o => html`<label class="check"><input type="checkbox" data-multi="${f.name}" value="${o.value}" ${vals.includes(o.value) ? 'checked' : ''} ${editable ? '' : 'disabled'}> ${o.label}</label>`)}</div></div>`;
    }
    if (f.type === 'table') return html`<div class="field ${f.cls || ''}"><div class="field-label">${label}</div><div id="tbl-${f.name}"></div></div>`;
    return field({ ...f, label, options: opts, value: draft[f.name], readonly: !editable || locked(f), tag });
  };

  el.innerHTML = String(html`<div class="page">
    ${pageHead({
      crumb: html`Master › <a href="#/master/${key}">${def.title}</a>${rec ? ` › ${rec.code}` : ''}`,
      title: rec ? html`${rec.code} · ${nameOf(def, rec)} ${pill(rec.status || 'Active')}` : `New ${def.title}`,
      sub: def.note,
      actions: html`<div class="row"><a class="btn" href="#/master/${key}">Back to list</a>
        ${rec && editable ? html`<button class="btn" id="toggle">${rec.status === 'Inactive' ? 'Make active' : 'Make inactive'}</button>` : ''}
        ${editable ? html`<button class="btn primary" id="save">Save</button>` : ''}</div>`,
    })}
    ${editable ? '' : html`<div class="note" style="margin-bottom:10px">Read-only: your role can view this master but not change it.</div>`}
    ${editable && uses?.total ? html`<div class="note" style="margin-bottom:10px">${def.lockWhenUsed.note(uses)}</div>`: ''}
    <form class="card form-lines" id="f" onsubmit="return false"><div class="grid g2">${def.fields.map(fieldHtml)}</div>
      ${def.computed && rec ? html`<div class="kv" style="margin-top:12px">${def.computed.map(([label, fn, o]) => html`<div><div class="k">${label} (calculated)</div><div class="v strong">${o?.money ? fmtMoney(fn(rec), company) : fn(rec)}</div></div>`)}</div>` : ''}
    </form>
  </div>`);

  const tableField = def.fields.find(f => f.type === 'table');
  if (tableField) {
    const tf = typeof tableField.columns === 'function' ? { ...tableField, columns: tableField.columns(draft) } : tableField;
    readTable = tableEditor($(`#tbl-${tableField.name}`, el), tf, structuredClone(draft[tableField.name] || []), draft.access || 'User', !editable);
  }
  // Fields that depend on another (a product's costing) show and hide as it changes.
  $('#f', el).addEventListener('change', () => {
    const d = readForm($('#f', el));
    def.fields.filter(f => f.showIf).forEach(f => { $(`[data-show="${f.name}"]`, el).hidden = !shows(f, d); });
  });

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
    // A field that does not apply is not asked for and not kept.
    def.fields.filter(f => !shows(f, d)).forEach(f => { d[f.name] = null; });
    // Locked fields keep their saved value whatever the form says.
    def.fields.filter(locked).forEach(f => { d[f.name] = rec[f.name]; });
    const missing = def.fields.filter(f => f.type !== 'table' && needed(f, d) && (d[f.name] === '' || d[f.name] == null)).map(f => f.name);
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
