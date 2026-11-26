// Site Viewing Report, step 2 "Job scope" (section 2 of the team lead's form), shared by the phone and the web editor.
// "Products and findings": one row per enquiry line, ticked once checked on site. A product row also takes the product,
// qty, location and, when its product has a size set, the size (tap S / M / L / XL, or measure: width × height, or one
// figure such as kW); a product the customer already has at the site is tapped instead. Each product (each line with no
// product) then gets its fault, the action needed and a priority. Fields are named by row or product key, so adding or
// removing one never mixes up the others.
// On the phone (opt.phone) each line is one closed card showing the tag, product, location, size and whether its
// finding is written; it opens when tapped. A product already linked to the customer's products does not show its
// Product list, Qty and "Already a customer product?" again ("Change product or quantity" brings them back).
// The saved data and the printed form are the same either way.
import { html, $, $$, field, readForm, toast, MIC, icon } from '../core/ui.js';
import { products, productName, findSite } from '../core/lookups.js';
import { productOf, isPhysical, keeps, setOfProduct, sizesOf, isTwoFigure, classifyFor, unitOfProduct, sizeText, wholeUnit, likelyProduct } from '../core/products.js';
import { removeBlob } from '../core/media.js';
import { savePhotos } from '../core/capture.js';
import { isProductRow, reportShutters, jobScope, newProductRow, findingOf, findingRows, findingsText, otherFindings, priorityOptions } from '../core/inspections.js';

export const check = (name, label, on) => html`<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
// Read "prefix_key" controls back into a section object.
export function readSection(body, prefix, current) {
  const d = readForm(body);
  const out = { ...current };
  Object.keys(d).filter(k => k.startsWith(`${prefix}_`)).forEach(k => { out[k.slice(prefix.length + 1)] = d[k]; });
  return out;
}

const micInput = (name, value, label) => html`<div class="with-mic"><input type="text" name="${name}" id="f-${name}" value="${value}"><button type="button" class="mic" data-mic="${name}" title="Voice input" aria-label="Voice input: ${label}">${MIC}</button></div>`;
function findRow(r, k, s, who = true) {
  const f = findingOf(r, k);
  return html`<div class="find-row" data-fk="${k}" data-of="${r.key}">
    ${s && who ? html`<div class="find-who">${s.notKept ? html`<b>${s.qty} ${s.uom || ''}</b><span class="small muted">${productName(s.productId)}</span>`
      : html`<b>${s.tag}</b>${s.isNew ? html`<span class="tag new">new</span>` : ''}<span class="small muted">${productName(s.productId)}${s.sizeCode ? ` · ${sizeText(s)}` : ''}</span>`}</div>` : ''}
    <div class="field"><label for="f-ff_${k}">Fault found</label>${micInput(`ff_${k}`, f.fault, 'Fault found')}</div>
    <div class="field"><label for="f-fa_${k}">Action needed</label>${micInput(`fa_${k}`, f.action, 'Action needed')}</div>
    <div class="field"><div class="field-label">Priority</div><span class="chips prio" role="radiogroup" aria-label="Priority">${priorityOptions().map(o => html`<label class="chip p-${o.value}"><input type="radio" name="fp_${k}" value="${o.value}" ${o.value === f.priority ? 'checked' : ''}><span>${o.label}</span></label>`)}</span></div>
  </div>`;
}
// The size line of a product row, from its product's size set: tap the size, or measure (width × height in metres,
// or one figure in the set's unit, e.g. kW). A product with no size set has none.
function sizeLine(r, p) {
  const set = setOfProduct(p);
  if (!set) return '';
  const k = r.key;
  const measure = isTwoFigure(set)
    ? html`or W <input type="number" step="0.01" min="0" name="pw_${k}" value="${r.width ?? ''}" aria-label="Width in metres"> × H <input type="number" step="0.01" min="0" name="ph_${k}" value="${r.height ?? ''}" aria-label="Height in metres"> m`
    : html`or <input type="number" step="any" min="0" name="pv_${k}" value="${r.measure ?? ''}" aria-label="${set.name} in ${set.unit}"> ${set.unit}`;
  return html`<div class="field spanall"><div class="field-label">Size · ${set.name.toLowerCase()}</div><div class="row wrap" style="gap:8px"><span class="chips" role="radiogroup" aria-label="Size">${sizesOf(p).map(z => html`<label class="chip"><input type="radio" name="ps_${k}" value="${z.code}" ${z.code === r.sizeCode ? 'checked' : ''}><span>${z.code}</span></label>`)}</span>
    <span class="small muted measure">${measure}</span></div></div>`;
}
// What a row holds: its unit, how many new products it records, and the customer's products it can link.
function rowParts(r, site, used) {
  const linked = r.linkIds || [];
  const p = productOf(r.productId);
  const kept = !p || keeps(p);
  return { linked, p, uom: r.uom || unitOfProduct(p), fresh: kept ? (Number(r.qty) || 1) - linked.length : 1, // new products this row records (or the work-only product itself)
    mine: kept ? (site?.shutters || []).filter(s => linked.includes(s.id) || (s.status !== 'Inactive' && !used.has(s.id) && s.productId === r.productId)) : [] };
}
// Product, qty, location, size and the customer's products to link (the phone hides them for a linked product).
function prodFields(r, { linked, p, uom, fresh, mine }) {
  const k = r.key;
  return html`<div class="grid g2 ask-prod">
      <div class="field spanall"><label for="f-pt_${k}">Product</label><select name="pt_${k}" id="f-pt_${k}">${products().filter(x => isPhysical(x) || x.id === r.productId).map(x => html`<option value="${x.id}" ${x.id === r.productId ? 'selected' : ''}>${x.name}</option>`)}</select></div>
      <div class="field"><label for="f-pq_${k}">Qty (${uom})</label><input type="number" min="${wholeUnit(uom) ? 1 : 0}" step="${wholeUnit(uom) ? 1 : 'any'}" name="pq_${k}" id="f-pq_${k}" value="${r.qty || 1}"></div>
      ${fresh > 0 ? html`<div class="field"><label for="f-pl_${k}">Location${linked.length ? ' of the new one' : ''}</label><input type="text" name="pl_${k}" id="f-pl_${k}" value="${r.location || ''}" placeholder="e.g. Back door"></div>
        ${sizeLine(r, p)}` : ''}
      ${mine.length ? html`<div class="field spanall"><div class="field-label">Already a customer product? Tap it</div><div class="chips">${mine.map(s => html`<label class="chip"><input type="checkbox" data-link="${k}" value="${s.id}" ${linked.includes(s.id) ? 'checked' : ''}><span>${s.tag} ${s.location}${s.sizeCode ? ` · ${s.sizeCode}` : ''}</span></label>`)}</div></div>` : ''}
    </div>`;
}
// The web editor's row: everything open.
function askRow(r, site, used, shutters) {
  const k = r.key;
  return html`<div class="ask ${r.done ? 'on' : ''}">
    ${r.added ? html`<div class="row"><b class="grow">${r.n}. ${r.text}</b><span class="tag">added on site</span><button type="button" class="btn link small" data-droprow="${k}">Remove</button></div>`
      : html`<label class="check"><input type="checkbox" name="ask_${k}" data-auto="${r.done && r.autoTick ? 1 : ''}" ${r.done ? 'checked' : ''}> <b>${r.n}.</b> ${r.text}</label>`}
    ${isProductRow(r) ? prodFields(r, rowParts(r, site, used)) : ''}
    <div class="finds">${isProductRow(r) ? shutters.filter(s => s.rowKey === k).map(s => findRow(r, s.key, s)) : findRow(r, k)}</div>
  </div>`;
}

// ---------- The phone's closed card ----------
// Which cards are open, and which linked products show their product fields, kept while the step is drawn again.
const ui = { rep: '', open: new Set(), change: new Set() };
// The closed card: number or tick, tag and product, location and size, and whether the finding is written.
function cardHead(r, prods) {
  const p = productOf(r.productId);
  const one = prods.length === 1 ? prods[0] : null;
  const title = !isProductRow(r) ? r.text : one ? `${one.notKept ? `${one.qty} ${one.uom || ''}` : one.tag} · ${productName(r.productId)}` : `${prods.length} × ${productName(r.productId)}`;
  const sized = !!setOfProduct(p);
  const where = !isProductRow(r) ? '' : [one ? '' : prods.map(s => s.tag).filter(Boolean).join(', '), prods[0]?.location || r.location, prods[0]?.sizeCode ? sizeText(prods[0]) : ''].filter(Boolean).join(' · ');
  const need = isProductRow(r) && (Number(r.qty) || 1) > (r.linkIds || []).length && (!r.location || (sized && !r.sizeCode));
  const keys = isProductRow(r) ? prods.map(s => s.key) : [r.key];
  const written = keys.filter(fk => { const f = findingOf(r, fk); return f.fault || f.action; }).length;
  const urgent = keys.some(fk => findingOf(r, fk).priority === 'URGENT' && (findingOf(r, fk).fault || findingOf(r, fk).action));
  const state = need ? html`<span class="urgent">${!r.location ? 'Location' : 'Size'}${!r.location && sized && !r.sizeCode ? ' and size' : ''} to enter</span>`
    : written && written === keys.length ? html`<span class="ok">Finding${keys.length > 1 ? 's' : ''} written</span>`
      : written ? html`<span>Findings written: ${written} of ${keys.length}</span>`
        : r.done ? html`<span class="ok">Checked, nothing to report</span>` : html`<span>Not checked yet</span>`;
  return html`<span class="st">${r.done ? '✓' : r.n}</span><span class="hd"><b>${title}</b>${where ? html`<span>${where}</span>` : ''}${state}${urgent ? html`<span class="urgent">Urgent</span>` : ''}</span>`;
}
function askCard(r, site, used, shutters) {
  const k = r.key;
  const parts = rowParts(r, site, used);
  const prods = isProductRow(r) ? shutters.filter(s => s.rowKey === k) : [];
  const linkedOnly = isProductRow(r) && parts.fresh <= 0 && !ui.change.has(k);
  return html`<details class="pcard ${r.done ? 'on' : ''}" data-key="${k}" ${ui.open.has(k) ? 'open' : ''}><summary>${cardHead(r, prods)}</summary>
    <div class="bd">
      ${isProductRow(r) && r.desc ? html`<p class="m-info" style="margin:0">The customer said: ${r.desc}</p>` : ''}
      ${!isProductRow(r) ? '' : linkedOnly ? '' : html`<div class="m-one">${prodFields(r, parts)}</div>`}
      <div class="finds">${isProductRow(r) ? prods.map(s => findRow(r, s.key, s, prods.length > 1)) : findRow(r, k)}</div>
      ${r.added ? html`<div class="row"><span class="tag">added on site</span><span class="grow"></span><button type="button" class="btn link" data-droprow="${k}">Remove this product</button></div>`
        : html`<div><label class="check"><input type="checkbox" name="ask_${k}" data-auto="${r.done && r.autoTick ? 1 : ''}" ${r.done ? 'checked' : ''}> Checked on site</label></div>`}
      ${linkedOnly ? html`<button type="button" class="btn link" data-change="${k}">Change product or quantity</button>` : ''}
    </div></details>`;
}

export const step2 = {
  title: 'Job scope', short: 'Scope',
  // Opening the step afresh: every card closed.
  enter() { ui.open = new Set(); ui.change = new Set(); },
  render: (rep, opt = {}) => {
    const rows = jobScope(rep).asked;
    const shutters = reportShutters(rep, rows);
    const { site } = findSite(rep.siteId);
    const usedBy = r => new Set(rows.filter(x => x !== r).flatMap(x => x.linkIds || []));
    if (ui.rep !== rep.id) { ui.rep = rep.id; ui.open = new Set(); ui.change = new Set(); }
    return html`
    <div class="checks two" style="${opt.phone ? '' : 'grid-template-columns:1fr 1fr'}">${check('s2_supplyInstall', 'Supply & install', rep.s2.supplyInstall)}${check('s2_repair', 'Repair', rep.s2.repair)}
      ${check('s2_replace', 'Replace component', rep.s2.replace)}${check('s2_motor', 'Motor / control works', rep.s2.motor)}
      ${check('s2_dismantle', 'Dismantle / removal', rep.s2.dismantle)}${check('s2_servicing', 'Servicing / maintenance', rep.s2.servicing)}</div>
    <div class="stack" style="margin-top:8px">${field({ name: 's2_other', label: 'Other', value: rep.s2.other })}</div>
    <div class="m-section">Products and findings</div>
    ${opt.phone ? html`<p class="m-info">Tap a line to write what you found. Writing a fault or an action ticks the line.</p>`
      : html`<p class="small muted" style="margin:0 0 6px">From the enquiry. Tick each line once you have checked it on site (writing its fault or action ticks it), and give each product its fault, the action needed and a priority. New products are recorded as the customer's products when you submit.</p>`}
    <div class="asked">${rows.map(r => (opt.phone ? askCard : askRow)(r, site, usedBy(r), shutters))}</div>
    <button type="button" class="add-dashed" id="addProd" style="margin-top:8px">+ Add product</button>
    <div class="stack" style="margin-top:12px">
      ${field({ name: 's2_description', label: 'Job Scope / Description of Work', type: 'textarea', value: rep.s2.description, mic: true })}
      ${field({ name: 's2_otherFindings', label: 'Other findings', value: otherFindings(rep), mic: true, placeholder: 'Anything not about one product' })}
    </div>
    <div class="m-section">Photos (${rep.photos.length})</div>
    <div class="photos">${rep.photos.map(p => html`<div class="photo"><img data-media="${p}" alt="Site photo"><button type="button" class="del" data-delphoto="${p}" aria-label="Remove photo">×</button></div>`)}</div>
    <label class="add-dashed" style="display:flex;justify-content:center;gap:6px;margin-top:8px">${icon('plus', 18)} Take or add photos<input type="file" accept="image/*" capture="environment" multiple hidden id="photoIn" aria-label="Site photos"></label>`;
  },
  read: (body, rep) => {
    const d = readForm(body);
    const has = k => Object.prototype.hasOwnProperty.call(d, k);
    const asked = (rep.asked || []).map(a => {
      const k = a.key;
      const cb = $(`[name="ask_${k}"]`, body);
      const r = { ...a, done: a.added || (d[`ask_${k}`] ?? a.done), autoTick: cb ? cb.checked && cb.dataset.auto === '1' : !!a.autoTick };
      const keys = $$(`[data-of="${k}"]`, body).map(e => e.dataset.fk);
      if (keys.length) r.found = { ...a.found, ...Object.fromEntries(keys.map(fk => [fk, { fault: d[`ff_${fk}`] ?? '', action: d[`fa_${fk}`] ?? '', priority: d[`fp_${fk}`] || findingOf(a, fk).priority }])) };
      if (!isProductRow(a)) return r;
      r.productId = d[`pt_${k}`] || a.productId;
      const p = productOf(r.productId), changed = r.productId !== a.productId;
      // Another product brings its own unit and size set: the size is found again.
      r.uom = changed ? unitOfProduct(p) : a.uom || unitOfProduct(p);
      const q = Number(d[`pq_${k}`] ?? a.qty ?? 1) || 1;
      r.qty = Math.max(wholeUnit(r.uom) ? Math.max(1, Math.round(q)) : q, (a.linkIds || []).length);
      r.location = d[`pl_${k}`] ?? a.location;
      r.width = has(`pw_${k}`) ? d[`pw_${k}`] : changed ? null : a.width;
      r.height = has(`ph_${k}`) ? d[`ph_${k}`] : changed ? null : a.height;
      r.measure = has(`pv_${k}`) ? d[`pv_${k}`] : changed ? null : a.measure ?? null;
      const tapped = d[`ps_${k}`] || (changed ? '' : a.sizeCode) || '';
      r.sizeCode = setOfProduct(p) ? classifyFor(p, { width: r.width, height: r.height, unit: 'm', measure: r.measure }) || tapped : ''; // measured wins over tapped
      if (a.added && /^\d+ × /.test(a.text)) r.text = `${r.qty} × ${productName(r.productId)}`;
      return r;
    });
    const shutters = reportShutters(rep, asked);
    const s2 = readSection(body, 's2', rep.s2);
    s2.otherFindings ??= otherFindings(rep);
    s2.findings = findingsText(findingRows(rep, asked, shutters), s2.otherFindings); // the same findings as one text, for the estimate
    return { s2, asked, shutters };
  },
  bind(body, rep, ctx) {
    const keepOpen = () => { if ($('details.pcard', body)) ui.open = new Set($$('details.pcard[open]', body).map(x => x.dataset.key)); };
    // Adding, removing or linking a product, or a new qty or type, draws the rows again.
    const change = fn => { keepOpen(); const cur = step2.read(body, rep); const asked = fn(cur.asked); ctx.save({ s2: cur.s2, asked, shutters: reportShutters(rep, asked) }); ctx.repaint(); };
    // A product added on site starts as the report's own products (else the site's most common, else the first by name).
    const startWith = rows => likelyProduct(rows.map(r => r.productId).filter(Boolean), findSite(rep.siteId).site)
      || products().filter(isPhysical).sort((a, b) => a.name.localeCompare(b.name))[0]?.id;
    $('#addProd', body).addEventListener('click', () => change(rows => { const row = newProductRow(rows, startWith(rows)); ui.open.add(row.key); return [...rows, row]; }));
    $$('[data-droprow]', body).forEach(b => b.addEventListener('click', () => change(rows => rows.filter(r => r.key !== b.dataset.droprow).map((r, i) => ({ ...r, n: i + 1 })))));
    $$('[data-change]', body).forEach(b => b.addEventListener('click', () => { ui.change.add(b.dataset.change); change(rows => rows); }));
    $$('[data-link]', body).forEach(cb => cb.addEventListener('change', () => change(rows => rows.map(r => {
      if (r.key !== cb.dataset.link) return r;
      const linkIds = cb.checked ? [...(r.linkIds || []), cb.value] : (r.linkIds || []).filter(x => x !== cb.value);
      return { ...r, linkIds, qty: Math.max(r.qty || 1, linkIds.length) };
    }))));
    $$('[name^="pq_"], [name^="pt_"]', body).forEach(i => i.addEventListener('change', () => change(rows => rows)));
    // A tick tapped by hand stays, even with nothing written ("checked, nothing wrong").
    const setTick = (cb, on, auto) => {
      cb.checked = on; cb.dataset.auto = auto ? '1' : ''; (cb.closest('.pcard') || cb.closest('.ask')).classList.toggle('on', on);
      const box = cb.closest('label')?.parentElement; // a "tick this" message under the line goes once it is ticked
      if (on && box?.classList.contains('invalid')) { box.classList.remove('invalid'); box.querySelector(':scope > .err[data-err]')?.remove(); }
    };
    $$('[name^="ask_"]', body).forEach(cb => cb.addEventListener('change', () => setTick(cb, cb.checked, false)));
    // Writing a fault or an action (typed or by voice) ticks its line; clearing them all unticks it again, but only when
    // the writing made the tick. Text already there when the report opens ticks nothing.
    body.addEventListener('input', e => {
      if (!/^f[fa]_/.test(e.target.name || '')) return;
      const k = e.target.closest('[data-of]')?.dataset.of;
      const cb = k && $(`[name="ask_${k}"]`, body);
      if (!cb) return; // a row added on site is always ticked
      const written = $$(`[data-of="${k}"] input[name^="ff_"], [data-of="${k}"] input[name^="fa_"]`, body).some(i => i.value.trim());
      if (written && !cb.checked) setTick(cb, true, true);
      else if (!written && cb.checked && cb.dataset.auto === '1') setTick(cb, false, false);
    });
    // The phone's closed card follows what is typed in it (tick, location and size, finding written).
    const refresh = e => {
      const card = e.target.closest?.('details.pcard');
      if (!card) return;
      const cur = step2.read(body, rep);
      const row = cur.asked.find(r => r.key === card.dataset.key);
      if (row) $('summary', card).innerHTML = String(cardHead(row, cur.shutters.filter(s => s.rowKey === row.key)));
    };
    body.addEventListener('input', refresh);
    body.addEventListener('change', refresh);
    // Measuring picks the size (width × height, or one figure such as kW); tapping a size clears the measurement.
    const val = n => $(`[name="${n}"]`, body)?.value;
    body.addEventListener('input', e => {
      const k = e.target.name?.match(/^p[whv]_(.+)$/)?.[1];
      if (!k) return;
      const p = productOf(val(`pt_${k}`) || (rep.asked || []).find(r => r.key === k)?.productId);
      const code = classifyFor(p, { width: Number(val(`pw_${k}`)), height: Number(val(`ph_${k}`)), unit: 'm', measure: val(`pv_${k}`) });
      const radio = code && $(`[name="ps_${k}"][value="${code}"]`, body);
      if (radio) radio.checked = true;
    });
    $$('[name^="ps_"]', body).forEach(r => r.addEventListener('change', () => { const k = r.name.slice(3); ['pw', 'ph', 'pv'].forEach(x => { const i = $(`[name="${x}_${k}"]`, body); if (i) i.value = ''; }); }));
    $('#photoIn', body).addEventListener('change', async e => {
      keepOpen();
      ctx.save(step2.read(body, rep));
      const ids = await savePhotos(e.target.files);
      if (ids.length) { ctx.save({ photos: [...rep.photos, ...ids] }); toast(`${ids.length} photo(s) added`); }
      ctx.repaint();
    });
    $$('[data-delphoto]', body).forEach(b => b.addEventListener('click', () => {
      keepOpen();
      ctx.save({ ...step2.read(body, rep), photos: rep.photos.filter(p => p !== b.dataset.delphoto) });
      removeBlob(b.dataset.delphoto);
      ctx.repaint();
    }));
  },
};
