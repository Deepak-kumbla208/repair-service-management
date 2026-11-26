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
  amber: ['Waiting for assessment', 'To assign', 'Draft', 'Report in progress', 'Returned', 'To schedule', 'Waiting for estimate', 'Work done'],
  blue: ['Assessment assigned', 'Assigned', 'In counter-check', 'Waiting for approval', 'Quotation in check', 'Sent', 'Quoted', 'Scheduled', 'On the way', 'On site', 'Open'],
  green: ['Assessed', 'Report submitted', 'Submitted', 'Active', 'Registered', 'Yes', 'Approved', 'Quotation approved', 'Accepted', 'Won', 'Completed', 'Completed & documented', 'Closed', 'Posted', 'Done'],
  purple: ['BOQ study', 'Estimating'],
  red: ['Cancelled', 'Inactive', 'Over target', 'Rejected', 'Expired', 'Lost'],
};
// Statuses are stored as before; a few are shown in plainer words (UX audit, finding 8).
const SHOWN = { 'BOQ study': 'Reviewing the customer\'s list', 'In counter-check': 'Waiting for approval', 'Quotation in check': 'Quotation waiting for approval', 'Estimating': 'Estimate being made' };
export const statusText = s => SHOWN[s] || s;
export function pill(text, tone) {
  const t = tone || Object.keys(TONES).find(k => TONES[k].includes(text)) || '';
  return html`<span class="pill ${t}">${statusText(text)}</span>`;
}
const TAG_WORDS = { placeholder: 'To confirm', 'new item': 'Not in the price list', dummy: 'Sample value' };
export const placeholderTag = (label = 'To confirm') => html`<span class="tag" title="Value not known yet">${TAG_WORDS[label] || label}</span>`;

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
// Line icons for the phone (tabs, header, buttons): one stroke style, drawn in the text colour.
const ICON_PATHS = {
  home: '<path d="M3 11 12 4l9 7v9h-7v-6h-4v6H3z"/>',
  jobs: '<path d="M4 8h16v12H4zM9 8V5h6v3"/>',
  enquiries: '<path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5"/>',
  tasks: '<path d="M4 12l5 5L20 6"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
  call: '<path d="M5 4h4l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  mail: '<path d="M3 6h18v12H3zM3 7l9 6 9-6"/>',
  print: '<path d="M7 8V3h10v5M5 8h14v9h-2v4H7v-4H5zM9 15h6"/>',
  undo: '<path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>',
  clip: '<path d="M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7"/>',
  flow: '<path d="M3 6h5v4H3zM16 14h5v4h-5zM8 8h5a2 2 0 0 1 2 2v4"/>',
  // The office menu (finding 13: the same line icons as the phone, not text symbols)
  dashboard: '<path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z"/>',
  customer: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  employee: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  transport: '<path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  equipment: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  labour: '<path d="M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 3-3-1-1-3z"/>',
  product: '<path d="M3 8l9-4 9 4v8l-9 4-9-4zM3 8l9 4 9-4M12 12v8"/>',
  item: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><circle cx="12" cy="12" r="3"/>',
  size: '<path d="M3 15L15 3l6 6L9 21zM7 13l2 2M10 10l2 2M13 7l2 2"/>',
  uom: '<path d="M4 6h16M4 12h10M4 18h6"/>',
  valueset: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  tax: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  terms: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>',
  enquiry: '<path d="M4 5h16v10H9l-5 4z"/>',
  inspection: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  estimation: '<path d="M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
  quotation: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4"/>',
  job: '<path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5"/>',
  amcContract: '<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16l1.5 1.5L14 14"/>',
  amcScheduling: '<path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M12 13v3l2 1"/>',
  amcExecution: '<path d="M4 7l2 2 3-3M4 13l2 2 3-3M12 8h8M12 14h8M4 19h16"/>',
  closure: '<path d="M4 5h16v4H4zM6 9v10h12V9M9 14l2 2 4-4"/>',
  invoice: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  payment: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.4-.9-1.3-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.200 0-2.100-.6-2.500-1.500M12 6.500v11"/>',
  companySetup: '<path d="M5 21V5l7-2v18M12 9h7v12M3 21h18M8 8h1M8 12h1M8 16h1M15 13h1M15 17h1"/>',
  transactionSetup: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  userRole: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 9-6M17 12l4 1.5v3c0 2-1.700 3.600-4 4.500-2.300-.9-4-2.500-4-4.500v-3z"/>',
  menuAccess: '<path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  authWorkflow: '<path d="M4 6h5v4H4zM15 14h5v4h-5zM9 8h4a2 2 0 0 1 2 2v4M6.5 10v6a2 2 0 0 0 2 2H11"/>',
};
export const hasIcon = name => name in ICON_PATHS;
export const icon = (name, size = 16) => raw(`<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`);

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
  clearErrors(root);
  names.forEach(n => fieldError($(`[name="${n}"]`, root), msg, { focus: false }));
  if (names.length) focusField($(`[name="${names[0]}"]`, root));
  return names.length === 0;
}

// One way to show an error on every screen (UX audit, finding 16): in red under the field, kept until it is put
// right, with the cursor in the first one. `el` is the control (or any element the message belongs under).
export function clearErrors(root = document) {
  $$('.invalid', root).forEach(f => f.classList.remove('invalid'));
  $$('.err[data-err]', root).forEach(x => x.remove());
}
export function focusField(el) {
  if (!el) return;
  el.closest('details:not([open])')?.setAttribute('open', '');
  el.scrollIntoView({ block: 'center' });
  (el.matches('input, select, textarea, button, a') ? el : el.querySelector('input:not([type=hidden]), select, textarea, button'))?.focus({ preventScroll: true });
}
export function fieldError(el, msg, { focus = true } = {}) {
  if (!el) return false;
  const box = el.closest('.field') || el.closest('td') || el.parentElement;
  box.querySelectorAll(':scope > .err[data-err]').forEach(x => x.remove());
  box.classList.add('invalid');
  box.insertAdjacentHTML('beforeend', `<div class="err" data-err role="alert">${esc(msg)}</div>`);
  const clear = () => { box.classList.remove('invalid'); box.querySelector(':scope > .err[data-err]')?.remove(); box.removeEventListener('input', clear); box.removeEventListener('change', clear); };
  box.addEventListener('input', clear); box.addEventListener('change', clear);
  if (focus) focusField(el);
  return false;
}
// A date typed by hand must be near today (finding 17: a PO date in the year 0081 was accepted). '' when fine.
export function dateProblem(value, { label = 'The date', pastYears = 2, futureYears = 2 } = {}) {
  if (!value) return '';
  const d = new Date(`${String(value).slice(0, 10)}T00:00`);
  if (isNaN(d)) return `${label} is not a date.`;
  const y = new Date().getFullYear();
  if (d.getFullYear() < y - pastYears || d.getFullYear() > y + futureYears) return `${label} is in the year ${d.getFullYear()}. Check the year.`;
  return '';
}
// A tap on a status button cannot fire twice (finding 3): false while the button is still held from the first tap.
export function holdTap(btn, ms = 1200) {
  if (!btn || btn.dataset.held) return false;
  btn.dataset.held = '1'; btn.setAttribute('aria-disabled', 'true');
  setTimeout(() => { delete btn.dataset.held; btn.removeAttribute('aria-disabled'); }, ms);
  return true;
}

// ---------- Overlays: dialogs, menus, toasts ----------
// Dialogs open inside the phone frame in the mobile view, so web and mobile never show together.
export const overlayRoot = () => $('.phone') || document.body;

export function openModal({ title, body, actions = [], wide = false, cls = '', onOpen }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const opener = document.activeElement;
  back.innerHTML = String(html`<div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
    <div class="modal-head"><h2>${title}</h2><button class="x-btn" data-close aria-label="Close">×</button></div>
    <div class="modal-body">${body}</div>
    ${actions.length ? html`<div class="modal-foot">${actions.map((a, i) => html`<button class="btn ${a.kind || ''}" data-a="${i}">${a.label}</button>`)}</div>` : ''}
  </div>`);
  // The cursor moves into the dialog, Tab stays inside it, and it returns to the button on close (finding 26).
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus?.({ preventScroll: true }); };
  const tabbable = () => [...back.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
  const onKey = e => {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab' || back !== [...document.querySelectorAll('.modal-back')].pop()) return;
    const t = tabbable();
    if (!t.length) return;
    if (!back.contains(document.activeElement)) { e.preventDefault(); t[0].focus(); }
    else if (e.shiftKey && document.activeElement === t[0]) { e.preventDefault(); t[t.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === t[t.length - 1]) { e.preventDefault(); t[0].focus(); }
  };
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
  if (!back.contains(document.activeElement)) {
    const body = back.querySelector('.modal-body');
    (body.querySelector('[autofocus]') || body.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])')
      || back.querySelector('.modal-foot .btn.primary') || back.querySelector('.modal'))?.focus({ preventScroll: true });
  }
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

// A problem is never a pop-up in the far corner that fades (UX audit, finding 16). When it belongs to one field it is
// shown under that field (fieldError). Any other problem is a red bar where the person is looking: above the buttons
// of the open dialog, else under the page title (pinned in a large window; in a smaller one the bar itself is pinned
// at the top of the page), and it stays until something is changed.
function errorBar(msg) {
  const dialog = [...document.querySelectorAll('.modal-back')].pop();
  const host = dialog ? dialog.querySelector('.modal-foot') || dialog.querySelector('.modal-body') : $('.phone .m-body') || $('#content .page > .page-head');
  if (!host) return null;
  document.querySelectorAll('.err-bar').forEach(x => { x.dataset.cleared = '1'; x.remove(); });
  const bar = Object.assign(document.createElement('div'), { className: 'err-bar', textContent: msg });
  bar.setAttribute('role', 'alert');
  if (host.matches('.modal-foot')) host.before(bar);
  // In a laptop-size window the title scrolls away (css/ux.css), so the bar pins itself at the top of the page instead
  else if (host.matches('.page-head')) { if (getComputedStyle(host).position === 'sticky') host.appendChild(bar); else { bar.classList.add('err-pin'); host.after(bar); } }
  else host.prepend(bar);
  const clear = e => { if (!bar.isConnected || !e || !bar.contains(e.target)) { bar.dataset.cleared = '1'; bar.remove(); document.removeEventListener('input', clear, true); document.removeEventListener('change', clear, true); } };
  setTimeout(() => { document.addEventListener('input', clear, true); document.addEventListener('change', clear, true); }, 0);
  return bar;
}
// On the phone the message shows inside the phone frame. opts.undo: a function that takes the action back; the
// message then stays 8 seconds with an "Undo" button (UX audit, findings 3 and 17).
export function toast(msg, kind = '', { undo = null, undoLabel = 'Undo', ms = 0 } = {}) {
  if (kind === 'bad' && !ms) {
    const bar = errorBar(msg);
    // If the page is drawn again at once (the message came with a move to another page), it is shown as a message
    // there instead, and stays longer than a plain one.
    if (bar) { setTimeout(() => { if (!bar.isConnected && !bar.dataset.cleared) toast(msg, 'bad', { ms: 9000 }); }, 450); return bar; }
  }
  const phone = $('.phone');
  let box = $('#toasts');
  if (phone) box = $('.toasts', phone) || phone.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  t.appendChild(Object.assign(document.createElement('span'), { textContent: msg }));
  if (undo) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-undo', textContent: undoLabel });
    b.onclick = () => { t.remove(); undo(); };
    t.appendChild(b);
  }
  box.appendChild(t);
  setTimeout(() => t.remove(), ms || (undo ? 8000 : 4200));
  return t;
}

// Empty-state and "not built yet" blocks
export const emptyRow = (cols, text) => html`<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;
