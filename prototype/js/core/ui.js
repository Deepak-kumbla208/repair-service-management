// Shared screen helpers: safe HTML building, formatting, dialogs, toasts, tiles, form fields.

// ---------- Safe HTML ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s ?? ''));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function part(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

// Tagged template: values are escaped unless wrapped in raw() or produced by html``.
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Delegated event: on(root, 'click', '[data-act=save]', (e, el) => ...)
export function on(root, type, sel, fn) {
  root.addEventListener(type, e => {
    const el = e.target.closest(sel);
    if (el && root.contains(el)) fn(e, el);
  });
}

export const go = route => { location.hash = '#/' + route.replace(/^#?\/?/, ''); };

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Formatting ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fmtDateTime = iso => iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '';

// Local date / time strings for <input type=date|time>
export const dateInput = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeInput = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const joinDateTime = (date, time) => (date ? new Date(`${date}T${time || '00:00'}`).toISOString() : null);

export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${pad(m % 60)} m`;
  return `${Math.floor(h / 24)} days`;
}

export function fmtMoney(amount, company) {
  if (amount == null || amount === '') return '';
  const n = Number(amount).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${company?.currency || ''} ${n}`.trim();
}

export function fmtNum(n, dp = 2) {
  if (n == null || n === '' || isNaN(n)) return '';
  return Number(n).toLocaleString('en-SG', { maximumFractionDigits: dp });
}

// ---------- Status pills ----------
const TONES = {
  amber: ['Waiting for inspection', 'To assign', 'Draft', 'Report in progress', 'Returned', 'To schedule', 'Waiting for estimate', 'Work done'],
  blue: ['Inspection assigned', 'Assigned', 'In counter-check', 'Quotation in check', 'Sent', 'Quoted', 'Scheduled', 'On the way', 'On site', 'Open'],
  green: ['Inspected', 'Report submitted', 'Submitted', 'Active', 'Registered', 'Yes', 'Approved', 'Quotation approved', 'Accepted', 'Won', 'Completed', 'Completed & documented', 'Closed', 'Posted', 'Done'],
  purple: ['BOQ study', 'Estimating'],
  red: ['Cancelled', 'Inactive', 'Over target', 'Rejected', 'Expired', 'Lost'],
};
export function pill(text, tone) {
  const t = tone || Object.keys(TONES).find(k => TONES[k].includes(text)) || '';
  return html`<span class="pill ${t}">${text}</span>`;
}
export const placeholderTag = (label = 'placeholder') => html`<span class="tag" title="Value not known yet">${label}</span>`;

// ---------- Count tiles (also filters) ----------
// list: [{key, label, count, sub, tone: 'warn'|'bad'}]
export function tiles(list, activeKey, cls = 'tiles') {
  return html`<div class="${cls}">${list.map(t => html`
    <button class="tile ${t.key === activeKey ? 'sel' : ''}" data-tile="${t.key}" title="Click to filter">
      <div class="t-label">${t.label}</div>
      <div class="t-num ${t.count > 0 ? (t.tone || '') : ''}">${t.count}</div>
      ${t.sub ? html`<div class="t-sub">${t.sub}</div>` : ''}
    </button>`)}</div>`;
}

// ---------- Form fields ----------
// f: {name, label, type, value, options, required, readonly, hint, cls, placeholder, mic, list, step}
// The header of an entry page: customer, site and document details in one full-width card that folds to a summary
// line (the sections follow one below another). Forms open it; a saved record shows it folded. With an id, the
// reader's choice is kept for that record while browsing.
export function foldHeader({ id = '', title, summary = '', body, open = false }) {
  let kept = null;
  try { kept = id ? sessionStorage.getItem(`rsmFold.${id}`) : null; } catch { /* storage blocked */ }
  const isOpen = kept === null ? open : kept === '1';
  return html`<details class="card fold" ${id ? raw(`data-fold="${esc(id)}" data-fold-default="${open ? '1' : '0'}"`) : ''} ${isOpen ? raw('open') : ''}><summary><span class="fold-t">${title}</span><span class="fold-s">${summary}</span></summary>${body}</details>`;
}
// Browsers also fire "toggle" when a header is drawn open, so only a state other than the default is kept.
if (typeof document !== 'undefined') {
  document.addEventListener('toggle', e => {
    const d = e.target?.dataset;
    if (!d?.fold) return;
    try {
      if (e.target.open === (d.foldDefault === '1')) sessionStorage.removeItem(`rsmFold.${d.fold}`);
      else sessionStorage.setItem(`rsmFold.${d.fold}`, e.target.open ? '1' : '0');
    } catch { /* storage blocked */ }
  }, true);
}

// Voice input button icon: a plain microphone, the same on every device (the emoji is drawn differently by each).
export const MIC = raw('<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>');

export function field(f) {
  const v = f.value ?? '';
  const common = html`name="${f.name}" id="f-${f.name}" ${f.readonly ? raw('readonly') : ''} ${f.required ? raw('required') : ''} ${f.placeholder ? raw(`placeholder="${esc(f.placeholder)}"`) : ''}`;
  let input;
  switch (f.type) {
    case 'textarea':
      input = html`<textarea ${common}>${v}</textarea>`;
      break;
    case 'select': {
      const opts = (f.options || []).map(o => (typeof o === 'object' ? o : { value: o, label: o }));
      input = html`<select ${common} ${f.readonly ? raw('disabled') : ''}>
        ${f.blank !== false ? html`<option value="">${f.blankLabel || ''}</option>` : ''}
        ${opts.map(o => html`<option value="${o.value}" ${String(o.value) === String(v) ? raw('selected') : ''}>${o.label}</option>`)}
      </select>`;
      break;
    }
    case 'checkbox':
      return html`<label class="check ${f.cls || ''}"><input type="checkbox" name="${f.name}" ${v ? raw('checked') : ''} ${f.readonly ? raw('disabled') : ''}> ${f.label}</label>`;
    case 'chips':
      input = chipGroup(f.name, f.options || [], v, f.readonly);
      break;
    default:
      input = html`<input type="${f.type || 'text'}" ${common} value="${v}" ${f.step ? raw(`step="${f.step}"`) : ''} ${f.list ? raw(`list="${esc(f.list)}"`) : ''}>`;
  }
  if (f.mic) input = html`<div class="with-mic">${input}<button type="button" class="mic" data-mic="${f.name}" title="Voice input">${MIC}</button></div>`;
  return html`<div class="field ${f.cls || ''}">
    ${f.label ? html`<label for="f-${f.name}">${f.label}${f.required ? html` <span class="req">*</span>` : ''}${f.tag ? html` ${f.tag}` : ''}</label>` : ''}
    ${input}
    ${f.hint ? html`<div class="hint">${f.hint}</div>` : ''}
  </div>`;
}

// One-click option buttons for short lists (radio inputs styled as chips); readForm reads the checked one.
export function chipGroup(name, options, value, readonly = false) {
  const opts = options.map(o => (typeof o === 'object' ? o : { value: o, label: o }));
  return html`<span class="chips" role="radiogroup">${opts.map(o => html`<label class="chip"><input type="radio" name="${name}" value="${o.value}"
    ${String(o.value) === String(value) ? raw('checked') : ''} ${readonly ? raw('disabled') : ''}><span>${o.label}</span></label>`)}</span>`;
}

// Read every [name] control inside root into a plain object.
export function readForm(root) {
  const out = {};
  $$('[name]', root).forEach(el => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value.trim();
  });
  return out;
}

export function markInvalid(root, names, msg = 'Required') {
  $$('.field.invalid', root).forEach(f => { f.classList.remove('invalid'); f.querySelector('.err')?.remove(); });
  names.forEach(n => {
    const box = $(`[name="${n}"]`, root)?.closest('.field');
    if (!box) return;
    box.closest('details:not([open])')?.setAttribute('open', '');
    box.classList.add('invalid');
    box.insertAdjacentHTML('beforeend', `<div class="err">${esc(msg)}</div>`);
  });
  if (names.length) $(`[name="${names[0]}"]`, root)?.focus();
  return names.length === 0;
}

// ---------- Overlays: dialogs, menus, toasts ----------
// Dialogs open inside the phone frame in the mobile view, so web and mobile never show together.
export const overlayRoot = () => $('.phone') || document.body;

export function openModal({ title, body, actions = [], wide = false, cls = '', onOpen }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = String(html`<div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-label="${title}">
    <div class="modal-head"><h2>${title}</h2><button class="x-btn" data-close aria-label="Close">×</button></div>
    <div class="modal-body">${body}</div>
    ${actions.length ? html`<div class="modal-foot">${actions.map((a, i) => html`<button class="btn ${a.kind || ''}" data-a="${i}">${a.label}</button>`)}</div>` : ''}
  </div>`);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', async e => {
    if (e.target === back || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-a]');
    if (b) {
      const res = await actions[+b.dataset.a].onClick?.(back.querySelector('.modal-body'), close);
      if (res !== false && !actions[+b.dataset.a].keepOpen) close();
    }
  });
  overlayRoot().appendChild(back);
  onOpen?.(back.querySelector('.modal-body'), close);
  return { el: back, close };
}

export function confirmBox(title, message, okLabel = 'OK') {
  return new Promise(resolve => {
    openModal({
      title, body: html`<p>${message}</p>`,
      actions: [{ label: 'Cancel', onClick: () => resolve(false) }, { label: okLabel, kind: 'primary', onClick: () => resolve(true) }],
    });
  });
}

export function popMenu(anchor, items) {
  document.querySelector('.menu-pop')?.remove();
  const box = document.createElement('div');
  box.className = 'menu-pop';
  box.innerHTML = String(html`${items.map((it, i) => it.sep ? html`<div class="sep"></div>`
    : it.info ? html`<div class="mi">${it.info}</div>` : html`<button data-i="${i}">${it.label}</button>`)}`);
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  box.style.top = `${r.bottom + 6}px`;
  box.style.left = `${Math.max(8, Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`;
  const close = e => { if (!e || !box.contains(e.target)) { box.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close));
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b) { box.remove(); document.removeEventListener('mousedown', close); items[+b.dataset.i].onClick(); }
  });
}

export function toast(msg, kind = '') {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// Empty-state and "not built yet" blocks
export const emptyRow = (cols, text) => html`<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
