// Product Size master (was Shutter Size): size sets on top, the chosen set's sizes below (list on top, editor below).
// A set says what is measured (width × height in metres, or one figure in a unit such as kW or A); each size has its
// limit, and the hours to repair one product of that size and to service it on one visit (team of 2 plus extra workers).
// Products pick a set in the Product master; the size is found from the measure taken on site.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, toast, pill, emptyRow, field, readForm, markInvalid } from '../core/ui.js';
import { sizeSets, setSizes, isTwoFigure, uoms } from '../core/products.js';
import { pageHead } from './shell.js';

const NOTE = 'Sizes belong to products: each product picks one size set in the Product master, or none. On site the measure picks the size (the smallest whose limit fits; a blank limit = no limit). Team = 1 technician + 1 helper; big sizes add extra workers. Servicing hours: one product on one AMC or General Servicing visit.';
const usedBy = set => store.list('products', p => p.status !== 'Inactive' && (p.costedBy || 'SIZE') === 'SIZE' && (p.sizeSetId || sizeSets()[0]?.id) === set.id).map(p => p.name);
const allSizes = setId => store.list('sizes', z => (z.setId || sizeSets()[0]?.id) === setId).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
const MEASURES = [{ value: 'WH', label: 'Width × height (m)' }, { value: 'ONE', label: 'One figure' }];

// The size columns: the limit (two figures or one), then the repair and servicing hours.
const cols = two => [['code', 'Code', 'text', 60], ['name', 'Name', 'text', 110], ['order', 'Order', 'number', 54],
  ...(two ? [['maxWidth', 'Max width (m)', 'number', 72], ['maxHeight', 'Max height (m)', 'number', 72]] : [['maxValue', 'Up to', 'number', 80]]),
  ['repairTeamHrs', 'Repair: team of 2 (h)', 'number', 70], ['repairExtraWorkers', 'Repair: extra workers', 'number', 60], ['repairExtraHrs', 'Repair: h per extra worker', 'number', 70],
  ['amcTeamHrs', 'Servicing: team of 2 (h)', 'number', 70], ['amcExtraWorkers', 'Servicing: extra workers', 'number', 60], ['amcExtraHrs', 'Servicing: h per extra worker', 'number', 70]];

export function renderProductSize(el, id) {
  const setRec = id && id !== 'new' ? store.get('sizeSets', id) : null;
  const isNew = id === 'new';
  const editing = !!setRec || isNew;
  const editable = auth.can('size', setRec ? 'edit' : 'create');
  const sets = sizeSets();

  el.innerHTML = String(html`<div class="page" style="max-width:1200px">
    ${pageHead({ crumb: 'Master', title: 'Product Size', sub: NOTE, actions: auth.can('size', 'create') ? html`<a class="btn primary" href="#/master/size/new">+ New size set</a>` : '' })}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Size set</th><th>Measured by</th><th>Unit</th><th>Sizes</th><th>Used by</th><th>Status</th></tr></thead><tbody>
      ${sets.length ? sets.map(z => html`<tr class="click ${setRec?.id === z.id ? 'sel' : ''}" data-id="${z.id}"><td>${z.code}</td><td>${z.name}</td><td>${isTwoFigure(z) ? 'Width × height' : 'One figure'}</td>
        <td>${isTwoFigure(z) ? 'm (feet converted)' : z.unit}</td><td>${setSizes(z.id).map(s => s.code).join(' · ')}</td><td class="wrap">${usedBy(z).join(', ') || html`<span class="muted">no product yet</span>`}</td><td>${pill(z.status || 'Active')}</td></tr>`)
        : emptyRow(7, 'No size sets yet.')}
    </tbody></table></div>
    ${editing ? html`<div class="card" style="margin-top:12px" id="ed"></div>` : html`<p class="small muted" style="margin-top:8px">Click a size set to see and change its sizes.</p>`}
  </div>`);
  $$('tr[data-id]', el).forEach(tr => tr.addEventListener('click', () => go(`master/size/${tr.dataset.id}`)));
  if (!editing) return;

  const draft = setRec ? structuredClone(setRec) : { code: '', name: '', measure: 'ONE', unit: '' };
  let rows = setRec ? allSizes(setRec.id).map(z => ({ ...z })) : [{ code: 'S', name: 'Small', order: 1, status: 'Active', isNew: true }];
  const ed = $('#ed', el);

  function paint() {
    const two = draft.measure === 'WH';
    const c = cols(two);
    ed.innerHTML = String(html`<div class="card-h" style="display:flex;gap:8px;align-items:center"><b class="grow">${setRec ? `${setRec.name} · sizes` : 'New size set'}</b>
        ${setRec && editable ? html`<button class="btn" id="toggle">${setRec.status === 'Inactive' ? 'Make active' : 'Make inactive'}</button>` : ''}
        ${editable ? html`<button class="btn primary" id="save">Save</button>` : ''}</div>
      ${editable ? '' : html`<div class="note" style="margin:10px 12px 0">Read-only: your role can view this master but not change it.</div>`}
      <form class="form-lines" id="f" onsubmit="return false" style="padding:10px 12px"><div class="grid g4">
        ${field({ name: 'code', label: 'Code', value: draft.code, required: true, readonly: !editable })}
        ${field({ name: 'name', label: 'Size set', value: draft.name, required: true, readonly: !editable })}
        ${field({ name: 'measure', label: 'Measured by', type: 'select', options: MEASURES, value: draft.measure, blank: false, readonly: !editable || !!setRec })}
        ${two ? field({ name: 'unit', label: 'Unit', value: 'm', readonly: true }) : field({ name: 'unit', label: 'Unit', type: 'select', options: uoms().map(u => u.code), value: draft.unit, required: true, readonly: !editable })}
      </div></form>
      <div class="tbl-wrap" style="margin:0 12px 12px;max-height:none"><table class="tbl edit"><thead><tr>${c.map(x => html`<th>${x[1]}${x[0] === 'maxValue' && draft.unit ? ` (${draft.unit})` : ''}</th>`)}<th>Active</th></tr></thead><tbody>
        ${rows.map((r, i) => html`<tr data-r="${i}">${c.map(([k, , type, w]) => html`<td><input type="${type}" data-c="${k}" value="${r[k] ?? ''}" style="width:${w}px" ${type === 'number' ? 'step="any" min="0"' : ''} ${editable ? '' : 'readonly'}></td>`)}
          <td><input type="checkbox" data-c="active" ${r.status !== 'Inactive' ? 'checked' : ''} ${editable ? '' : 'disabled'}></td></tr>`)}
      </tbody></table>
      ${editable ? html`<button type="button" class="btn small" id="addRow" style="margin-top:6px">+ Add size</button>` : ''}
      <p class="small muted" style="margin:6px 0 0">${two ? 'A product gets the smallest size whose width and height both fit; a blank limit means no limit (the largest size).' : 'A product gets the smallest size whose limit holds its measure; a blank limit means no limit (the largest size).'}</p></div>`);
  }
  // Inputs back into the draft rows and set fields.
  const sync = () => {
    Object.assign(draft, readForm($('#f', ed)));
    $$('tr[data-r]', ed).forEach(tr => {
      const r = rows[+tr.dataset.r];
      $$('[data-c]', tr).forEach(inp => {
        if (inp.dataset.c === 'active') r.status = inp.checked ? 'Active' : 'Inactive';
        else r[inp.dataset.c] = inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value.trim();
      });
    });
  };
  paint();
  ed.addEventListener('change', e => { if (e.target.name === 'measure') { sync(); paint(); } });
  ed.addEventListener('click', e => {
    if (e.target.id === 'addRow') { sync(); rows.push({ code: '', name: '', order: rows.length + 1, status: 'Active', isNew: true }); paint(); }
    if (e.target.id === 'toggle') {
      const next = setRec.status === 'Inactive' ? 'Active' : 'Inactive';
      store.setStatus('sizeSets', setRec.id, next);
      toast(`${setRec.name} is now ${next.toLowerCase()}`);
      renderProductSize(el, id);
    }
    if (e.target.id === 'save') save();
  });

  function save() {
    sync();
    const form = $('#f', ed);
    const missing = ['code', 'name', ...(draft.measure === 'WH' ? [] : ['unit'])].filter(k => !String(draft[k] ?? '').trim());
    if (!markInvalid(form, missing)) { toast('Fill in the required fields', 'bad'); return; }
    if (sizeSets().some(z => z.id !== setRec?.id && String(z.code).toLowerCase() === String(draft.code).toLowerCase())) { markInvalid(form, ['code'], 'This code is already used'); return; }
    const live = rows.filter(r => r.status !== 'Inactive');
    if (!live.length) { toast('Keep at least one active size', 'bad'); return; }
    if (rows.some(r => !r.code || !r.name)) { toast('Every size needs a code and a name', 'bad'); return; }
    const codes = live.map(r => r.code.toLowerCase());
    if (new Set(codes).size !== codes.length) { toast('Two active sizes have the same code', 'bad'); return; }
    const set = { code: draft.code, name: draft.name, measure: draft.measure, unit: draft.measure === 'WH' ? 'm' : draft.unit, order: setRec?.order ?? sizeSets().length + 1 };
    const saved = setRec ? store.update('sizeSets', setRec.id, set, `Edited size set ${set.code}`) : store.insert('sizeSets', set, { status: 'Active', note: `Created size set ${set.code}` });
    rows.forEach(({ isNew, id: rid, tenantId, createdAt, createdBy, updatedAt, updatedBy, statusHistory, ...r }) => {
      const data = { ...r, setId: saved.id };
      if (isNew) store.insert('sizes', data, { status: r.status || 'Active', note: `Added size ${r.code} to ${set.code}` });
      else store.update('sizes', rid, data, false);
    });
    toast(`Size set ${saved.code} saved`);
    go(`master/size/${saved.id}`);
  }
}
