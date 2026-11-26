// Parts of the enquiry screens: the product-lines editor ("What the customer needs"), the read-only lines table,
// and the "Recorded by" picker (small arrow, no box).
// UX audit (finding 14): the product is picked by typing (web/picker.js), Enter in a description adds
// the next line, Tab goes from the description to the next line, and a line that names a customer product by its tag
// says so under the description.
import * as auth from '../core/auth.js';
import { html, $$, popMenu, fmtNum, MIC } from '../core/ui.js';
import { itemChoices, itemName, productInfo, unitOptions } from '../core/lookups.js';
import { bindMics } from '../core/capture.js';
import { pickerHtml, bindPickers } from './picker.js';

const blankLine = () => ({ itemRef: '', itemName: '', qty: null, unit: '', description: '' });
// The line's unit, picked from the Unit of Measure master (it starts from the product's unit).
const unitPick = l => {
  const u = l.itemRef ? (l.unit || productInfo(l.itemRef)?.unit || 'Nos') : '';
  return html`<select data-c="unit" aria-label="Unit" ${l.itemRef ? '' : 'disabled'}>${l.itemRef ? unitOptions(u).map(c => html`<option ${c === u ? 'selected' : ''}>${c}</option>`) : html`<option value="">–</option>`}</select>`;
};

// The picked product's details under it, in plain words, from its master: how a product is costed ("Hours depend on
// the motor power, measured on site", "Standard 0.1 h per m", "Fixed price 800.00 per Lot"), or a part's code,
// category, rate and lead time ("ITM-004 · Spare part · rate 85.00 · lead time 3 days").
const hrsText = h => `${Math.round(h * 100) / 100} h`;
export function productStrip(ref) {
  const p = productInfo(ref);
  if (!p) return '';
  const product = () => (p.costedBy === 'FIXED' ? [`Fixed price ${p.price.toFixed(2)} per ${p.unit}`]
    : p.costedBy === 'HOURS' ? [`Standard ${hrsText(p.repairHrs)} per ${p.unit}`]
      : [`Hours depend on the ${p.twoFigure ? 'size (width × height)' : p.setName.toLowerCase()}, measured on site`]);
  const text = p.kind === 'product' ? product()
    : [p.code, p.category, p.spec, `rate ${p.rate.toFixed(2)}${p.placeholder ? ' (rate to confirm)' : ''}`, p.leadDays ? `lead time ${p.leadDays} days` : 'in stock'];
  return html`<div class="pinfo">${text.filter(Boolean).join(' · ')}</div>`;
}

// The customer's products a text names by their tag ("RS-1 very noisy"), the way the site report links them.
export function namedTags(text, site) {
  return (site?.shutters || []).filter(s => s.status !== 'Inactive' && s.tag).filter(s => {
    const tag = s.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9-])${tag}(?![A-Za-z0-9])`, 'i').test(text || '');
  });
}
const linkedNote = (l, site) => {
  const hit = namedTags(`${l.itemName || ''} ${l.description || ''}`, site);
  return hit.length ? html`<div class="pinfo link">Linked to ${hit.map(s => `${s.tag}${s.location ? ` (${s.location})` : ''}`).join(', ')}</div>` : '';
};

// Editable lines: Product (optional: products, parts and materials) · Qty · Unit · Description · ＋ / －.
// Returns { read, set, add } so the form can read the lines, paste-email can replace them and a chip can add one.
// getSite(): the customer's site chosen on the form (for the "Linked to RS-1" note); may return null.
export function linesEditor(box, initial, { getSite = () => null } = {}) {
  let lines = (initial && initial.length ? initial : [blankLine()]).map(l => ({ ...l }));
  const choices = () => itemChoices(lines.map(l => l.itemRef)).map(g => ({ group: g.group, options: g.options.map(o => ({ ...o, sub: o.value.startsWith('itm:') ? productInfo(o.value)?.code || '' : '' })) }));

  const sync = () => $$('tr[data-i]', box).forEach(tr => {
    const l = lines[+tr.dataset.i];
    l.itemRef = tr.querySelector('[data-c="item"]').value;
    l.itemName = itemName(l.itemRef);
    l.qty = l.itemRef ? (Number(tr.querySelector('[data-c="qty"]').value) || 1) : null;
    l.unit = l.itemRef ? (tr.querySelector('[data-c="unit"]').value || productInfo(l.itemRef)?.unit || 'Nos') : '';
    l.description = tr.querySelector('[data-c="desc"]').value.trim();
  });

  const paint = () => {
    const site = getSite();
    box.innerHTML = String(html`<table class="lines"><thead><tr><th style="width:34px">No.</th><th style="width:32%">Product <span class="muted">(optional)</span></th>
      <th style="width:84px">Qty</th><th style="width:92px">Unit</th><th>Description</th><th class="pmc"></th></tr></thead><tbody>
      ${lines.map((l, i) => html`<tr data-i="${i}"><td>${i + 1}</td>
        <td>${pickerHtml({ attrs: 'data-c="item"', value: l.itemRef, label: l.itemRef ? itemName(l.itemRef) : '', placeholder: 'Type to search products and parts', ariaLabel: `Product, line ${i + 1}` })}${productStrip(l.itemRef)}</td>
        <td><input type="number" min="0" step="any" data-c="qty" value="${l.itemRef ? (l.qty || 1) : ''}" placeholder="–" ${l.itemRef ? '' : 'disabled'} aria-label="Quantity, line ${i + 1}"></td>
        <td>${unitPick(l)}</td>
        <td><div class="with-mic"><input type="text" data-c="desc" name="line_desc_${i}" value="${l.description}" placeholder="${l.itemRef ? 'Where / what is wrong' : 'Describe what the customer needs'}" aria-label="Description, line ${i + 1}">
          <button type="button" class="mic" data-mic="line_desc_${i}" title="Voice input" aria-label="Voice input, line ${i + 1}" tabindex="-1">${MIC}</button></div>${linkedNote(l, site)}</td>
        <td class="pmc"><button type="button" class="pm add" data-add="${i}" title="Add a line below (or press Enter in the description)" aria-label="Add a line below line ${i + 1}" tabindex="-1">＋</button><button type="button" class="pm rm" data-rm="${i}" title="Remove this line" aria-label="Remove line ${i + 1}">－</button></td></tr>`)}
    </tbody></table>
    <div class="sub">Type a product or part name to pick it, then the quantity and what is wrong; with no product, just describe. Enter adds the next line.</div>`);
    bindMics(box);
  };
  const addAfter = (i, line = blankLine(), focus = 'pick') => {
    sync();
    lines.splice(i + 1, 0, line);
    paint();
    const tr = box.querySelector(`tr[data-i="${i + 1}"]`);
    const el = focus === 'desc' ? tr?.querySelector('[data-c="desc"]') : tr?.querySelector('.pick-in');
    el?.focus();
    if (focus === 'desc' && el) el.setSelectionRange(el.value.length, el.value.length);
  };

  bindPickers(box, choices);
  box.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]');
    if (add) return addAfter(+add.dataset.add);
    if (!rm) return;
    sync();
    lines.splice(+rm.dataset.rm, 1); if (!lines.length) lines.push(blankLine());
    paint();
    $$('[data-c="desc"]', box)[Math.max(0, +rm.dataset.rm - 1)]?.focus();
  });
  box.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('[data-c="desc"], [data-c="qty"]')) return;
    e.preventDefault();
    addAfter(+e.target.closest('tr').dataset.i);
  });
  box.addEventListener('change', e => {
    if (e.target.dataset.c === 'desc') { sync(); const tr = e.target.closest('tr'), l = lines[+tr.dataset.i]; tr.querySelector('.pinfo.link')?.remove(); const n = String(linkedNote(l, getSite())); if (n) e.target.closest('td').insertAdjacentHTML('beforeend', n); return; }
    if (e.target.dataset.c !== 'item') return;
    sync();
    const i = +e.target.closest('tr').dataset.i, l = lines[i];
    l.unit = productInfo(l.itemRef)?.unit || '';
    paint();
    box.querySelector(`tr[data-i="${i}"] [data-c="${l.itemRef ? 'qty' : 'desc'}"]`)?.focus();
    box.querySelector(`tr[data-i="${i}"] [data-c="qty"]`)?.select?.();
  });
  paint();
  return {
    read: () => { sync(); return lines.map(l => ({ ...l })); },
    set: next => { lines = (next.length ? next : [blankLine()]).map(l => ({ ...blankLine(), ...l })); paint(); },
    // Add a line (a tapped customer-product chip): it takes the place of a first line that is still empty.
    add: line => {
      sync();
      const full = { ...blankLine(), ...line, itemName: itemName(line.itemRef || '') };
      const empty = lines.findIndex(l => !l.itemRef && !l.description);
      if (empty >= 0) { lines[empty] = full; paint(); const el = box.querySelector(`tr[data-i="${empty}"] [data-c="desc"]`); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); } else addAfter(lines.length - 1, full, 'desc');
      box.dispatchEvent(new Event('change', { bubbles: true }));
    },
    repaint: () => { sync(); paint(); },
    first: () => box.querySelector('[data-c="desc"]'),
  };
}

// Read-only lines table for the enquiry page.
export function linesTable(lines, site = null) {
  const rows = (lines || []).filter(l => l.itemRef || l.description);
  if (!rows.length) return html`<div class="muted">Nothing listed.</div>`;
  return html`<table class="lines"><thead><tr><th style="width:34px">No.</th><th style="width:32%">Product</th><th style="width:84px">Qty</th><th style="width:92px">Unit</th><th>Description</th></tr></thead><tbody>
    ${rows.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.itemName || html`<span class="muted">No product picked</span>`}${productStrip(l.itemRef)}</td><td>${l.itemRef ? fmtNum(l.qty) : ''}</td>
      <td>${l.itemRef ? (l.unit || productInfo(l.itemRef)?.unit || 'Nos') : ''}</td><td>${l.description}${linkedNote(l, site)}</td></tr>`)}
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
      ...users.map(u => ({ label: `${u.id === getId() ? '✓ ' : ' '}${u.name}${u.id === me ? ' (logged in)' : ''}`, onClick: () => onPick(u.id) })),
      { sep: true },
      { info: html`<span class="small muted">Only users whose role may create enquiries.</span>` },
    ]);
  });
}
