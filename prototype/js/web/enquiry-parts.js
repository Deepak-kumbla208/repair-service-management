// Parts of the enquiry screens: the product-lines editor ("What the customer needs"), the read-only lines table,
// and the "Recorded by" picker (small arrow, no box).
import * as auth from '../core/auth.js';
import { html, $$, popMenu, fmtNum, MIC } from '../core/ui.js';
import { itemChoices, itemName, productInfo } from '../core/lookups.js';
import { bindMics } from '../core/capture.js';

const blankLine = () => ({ itemRef: '', itemName: '', qty: null, unit: '', description: '' });

// The picked product's details under it, from its master, e.g. "ITM-004 · Spare part · rate 85.00 · lead time 3 days".
export function productStrip(ref) {
  const p = productInfo(ref);
  if (!p) return '';
  const text = p.kind === 'shutter' ? [p.code, 'shutter type', 'size class set on site']
    : [p.code, p.category, p.spec, `rate ${p.rate.toFixed(2)}${p.placeholder ? ' (placeholder)' : ''}`, p.leadDays ? `lead time ${p.leadDays} days` : 'in stock'];
  return html`<div class="pinfo">${text.filter(Boolean).join(' · ')}</div>`;
}

// Editable lines: Product (optional: shutter types, parts and materials) · Qty · Unit · Description · ＋ / －.
// Returns { read, set } so the form can read the lines and paste-email can replace them.
export function linesEditor(box, initial) {
  let lines = (initial && initial.length ? initial : [blankLine()]).map(l => ({ ...l }));
  const choices = itemChoices();

  const sync = () => $$('tr[data-i]', box).forEach(tr => {
    const l = lines[+tr.dataset.i];
    l.itemRef = tr.querySelector('[data-c="item"]').value;
    l.itemName = itemName(l.itemRef);
    l.qty = l.itemRef ? (Number(tr.querySelector('[data-c="qty"]').value) || 1) : null;
    l.unit = l.itemRef ? (tr.querySelector('[data-c="unit"]').value.trim() || productInfo(l.itemRef)?.unit || 'Nos') : '';
    l.description = tr.querySelector('[data-c="desc"]').value.trim();
  });

  const paint = () => {
    box.innerHTML = String(html`<table class="lines"><thead><tr><th style="width:26px">#</th><th style="width:32%">Product <span class="muted">(optional)</span></th>
      <th style="width:70px">Qty</th><th style="width:70px">Unit</th><th>Description</th><th class="pmc"></th></tr></thead><tbody>
      ${lines.map((l, i) => html`<tr data-i="${i}"><td>${i + 1}</td>
        <td><select data-c="item" aria-label="Product"><option value="">No product</option>${choices.map(g => html`<optgroup label="${g.group}">
          ${g.options.map(o => html`<option value="${o.value}" ${o.value === l.itemRef ? 'selected' : ''}>${o.label}</option>`)}</optgroup>`)}</select>${productStrip(l.itemRef)}</td>
        <td><input type="number" min="1" data-c="qty" value="${l.itemRef ? (l.qty || 1) : ''}" placeholder="–" ${l.itemRef ? '' : 'disabled'} aria-label="Quantity"></td>
        <td><input type="text" data-c="unit" value="${l.itemRef ? (l.unit || productInfo(l.itemRef)?.unit || 'Nos') : ''}" placeholder="–" ${l.itemRef ? '' : 'disabled'} aria-label="Unit"></td>
        <td><div class="with-mic"><input type="text" data-c="desc" name="line_desc_${i}" value="${l.description}" placeholder="${l.itemRef ? 'Where / what is wrong' : 'Describe what the customer needs'}" aria-label="Description">
          <button type="button" class="mic" data-mic="line_desc_${i}" title="Voice input">${MIC}</button></div></td>
        <td class="pmc"><button type="button" class="pm add" data-add="${i}" title="Add a line below" aria-label="Add a line">＋</button><button type="button" class="pm rm" data-rm="${i}" title="Remove this line" aria-label="Remove this line">－</button></td></tr>`)}
    </tbody></table>
    <div class="sub">Pick a product, then the quantity and a description; with no product, just describe. ＋ adds a line, － removes it.</div>`);
    bindMics(box);
  };

  box.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]');
    if (!add && !rm) return;
    sync();
    if (add) lines.splice(+add.dataset.add + 1, 0, blankLine());
    if (rm) { lines.splice(+rm.dataset.rm, 1); if (!lines.length) lines.push(blankLine()); }
    paint();
    $$('[data-c="desc"]', box)[add ? +add.dataset.add + 1 : 0]?.focus();
  });
  box.addEventListener('change', e => {
    if (e.target.dataset.c !== 'item') return;
    sync();
    const l = lines[+e.target.closest('tr').dataset.i];
    l.unit = productInfo(l.itemRef)?.unit || '';
    paint();
  });
  paint();
  return {
    read: () => { sync(); return lines.map(l => ({ ...l })); },
    set: next => { lines = (next.length ? next : [blankLine()]).map(l => ({ ...blankLine(), ...l })); paint(); },
  };
}

// Read-only lines table for the enquiry page.
export function linesTable(lines) {
  const rows = (lines || []).filter(l => l.itemRef || l.description);
  if (!rows.length) return html`<div class="muted">Nothing listed.</div>`;
  return html`<table class="lines"><thead><tr><th style="width:26px">#</th><th style="width:32%">Product</th><th style="width:70px">Qty</th><th style="width:70px">Unit</th><th>Description</th></tr></thead><tbody>
    ${rows.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.itemName || html`<span class="muted">—</span>`}${productStrip(l.itemRef)}</td><td>${l.itemRef ? fmtNum(l.qty) : ''}</td>
      <td>${l.itemRef ? (l.unit || productInfo(l.itemRef)?.unit || 'Nos') : ''}</td><td>${l.description}</td></tr>`)}
  </tbody></table>`;
}

// "Recorded by": the logged-in user by default; the small arrow lists users whose role may create enquiries.
export function recordedByButton(userId) {
  return html`<button type="button" class="rb" id="recordedBy" title="Change who recorded this enquiry">${auth.userName(userId)}<span class="arr">▾</span></button>`;
}
export function bindRecordedBy(root, getId, onPick) {
  root.querySelector('#recordedBy')?.addEventListener('click', e => {
    const me = auth.user().id;
    const users = auth.usersWhoCan('enquiry', 'create');
    popMenu(e.currentTarget, [
      { info: html`<span class="small muted">Recorded by</span>` },
      ...users.map(u => ({ label: `${u.id === getId() ? '✓ ' : ' '}${u.name}${u.id === me ? ' (logged in)' : ''}`, onClick: () => onPick(u.id) })),
      { sep: true },
      { info: html`<span class="small muted">Only users whose role may create enquiries.</span>` },
    ]);
  });
}
