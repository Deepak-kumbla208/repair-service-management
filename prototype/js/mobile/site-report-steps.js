// Site Viewing Report steps 3–7, one per section of the team lead's form (step 2, Job scope, is in
// site-report-scope.js). Shared by the phone and the web editor; opt.phone asks for the phone's layout (large tick rows).
import { html, $, $$, field, readForm, icon } from '../core/ui.js';
import { zones, items, vsLabel } from '../core/lookups.js';
import { manHours } from '../core/costing.js';
import { signaturePad } from '../core/capture.js';
import { check, readSection, step2 } from './site-report-scope.js';

const step3 = {
  title: 'Labour / man-hours / transport', short: 'Labour', nav: 'Labour and transport',
  render: (rep, opt = {}) => html`
    <div class="field"><div class="field-label">Transport Zone (from the site)</div><div class="${opt.phone ? 'checks two' : 'row wrap'}" role="radiogroup" aria-label="Transport zone">${zones().map(z => html`<label class="check" style="${opt.phone ? '' : 'margin-right:10px'}"><input type="radio" name="s3_zoneId" value="${z.id}" ${z.id === rep.s3.zoneId ? 'checked' : ''}> <span>${z.code} <span class="muted small">${z.name}</span></span></label>`)}</div></div>
    <div class="grid g3" style="margin-top:10px">
      ${field({ name: 's3_persons', label: 'No. of Persons', type: 'number', value: rep.s3.persons })}
      ${field({ name: 's3_days', label: 'No. of Days', type: 'number', value: rep.s3.days })}
      ${field({ name: 's3_hoursPerDay', label: 'Hours / Day', type: 'number', step: '0.5', value: rep.s3.hoursPerDay })}
    </div>
    <div class="m-card" style="margin-top:10px">Total Man-hours: <b id="mh">${manHours(rep.s3.persons, rep.s3.days, rep.s3.hoursPerDay) || '—'}</b> <span class="small muted">(persons × days × hours)</span></div>
    ${field({ name: 's3_remarks', label: 'Remarks', value: rep.s3.remarks })}
    <div class="field" style="margin-top:10px"><div class="field-label">Working Hours</div><div class="checks" style="${opt.phone ? '' : 'grid-template-columns:1fr'}">
      ${check('s3_normal', 'Normal hours', rep.s3.normal)}${check('s3_afterHours', 'Overtime (after 5:30 pm)', rep.s3.afterHours)}
      ${check('s3_weekend', 'Weekend / Public holiday', rep.s3.weekend)}${check('s3_phased', 'Phased (per level / block)', rep.s3.phased)}</div></div>`,
  read: (body, rep) => ({ s3: readSection(body, 's3', rep.s3) }),
  bind(body) {
    body.addEventListener('input', () => { const d = readForm(body); $('#mh', body).textContent = manHours(d.s3_persons, d.s3_days, d.s3_hoursPerDay) || '—'; });
  },
};

const step4 = {
  title: 'Equipment & access', short: 'Tools', nav: 'Equipment',
  render: (rep, opt = {}) => html`
    <div class="checks" style="${opt.phone ? '' : 'grid-template-columns:1fr'}">
      ${check('s4_ladder', 'Ladder / platform ladder', rep.s4.ladder)}
      <div class="row check-with">${check('s4_scaffolding', 'Scaffolding', rep.s4.scaffolding)}<input type="number" name="s4_scaffoldSets" value="${rep.s4.scaffoldSets}" placeholder="sets" aria-label="Scaffolding: number of sets" style="${opt.phone ? '' : 'width:80px'}"></div>
      <div class="row check-with">${check('s4_scissor', 'Scissor lift', rep.s4.scissor)}<input type="number" name="s4_scissorNos" value="${rep.s4.scissorNos}" placeholder="nos" aria-label="Scissor lift: how many" style="${opt.phone ? '' : 'width:80px'}"></div>
      ${check('s4_boom', 'Boom lift / MEWP', rep.s4.boom)}${check('s4_hoist', 'Hoist / chain block', rep.s4.hoist)}${check('s4_welding', 'Welding set', rep.s4.welding)}
      ${check('s4_grinding', 'Grinding machine / cutter', rep.s4.grinding)}${check('s4_powerTools', 'Power tools / drill', rep.s4.powerTools)}
    </div>
    <div class="stack" style="margin-top:10px">
      ${field({ name: 's4_other', label: 'Other', value: rep.s4.other })}
      ${field({ name: 's4_maxHeight', label: 'Max. Working Height (m)', type: 'number', step: '0.1', value: rep.s4.maxHeight })}
      <div id="heightNote"></div>
      <div class="field"><div class="field-label">Provided By</div><div class="${opt.phone ? 'checks two' : 'row'}" role="radiogroup" aria-label="Provided by">${['Customer', 'Contractor'].map(p => html`<label class="check" style="${opt.phone ? '' : 'margin-right:14px'}"><input type="radio" name="s4_providedBy" value="${p}" ${rep.s4.providedBy === p ? 'checked' : ''}> ${p}</label>`)}</div></div>
      ${field({ name: 's4_rentalDuration', label: 'Rental Duration', value: rep.s4.rentalDuration })}
      ${field({ name: 's4_others', label: 'Others', value: rep.s4.others })}
    </div>`,
  read: (body, rep) => ({ s4: readSection(body, 's4', rep.s4) }),
  bind(body) {
    const note = () => { const h = Number(readForm(body).s4_maxHeight); $('#heightNote', body).innerHTML = String(h > 3 ? html`<div class="note warn small">Over 3 m: work at height. If a fall is possible, tick “Permit-to-work required” in step 6.</div>` : ''); };
    body.addEventListener('input', note);
    note();
  },
};

const step5 = {
  title: 'Materials / spare parts', short: 'Parts', nav: 'Materials',
  render: rep => html`
    <datalist id="itemList">${items().map(i => html`<option value="${i.name}">${i.code}${i.spec ? ` · ${i.spec}` : ''}${i.groupCode ? ` · ${vsLabel('PRODUCT_GROUP', i.groupCode)}` : ''}</option>`)}</datalist>
    <p class="small muted" style="margin:0 0 6px">Type to search the parts list, or type a new part.</p>
    ${rep.s5.rows.map((r, i) => html`<div class="mat-row" data-row="${i}"><div class="row"><b>${i + 1}.</b><span class="grow"></span><button type="button" class="btn link small" data-delrow="${i}">Remove</button></div>
      <div class="grid g2">
        <div class="field spanall"><label for="m${i}_name">Material / Spare Part</label><input type="text" id="m${i}_name" list="itemList" data-c="name" value="${r.name}"><input type="hidden" data-c="itemId" value="${r.itemId || ''}"></div>
        ${rep.shutters.length > 1 ? html`<div class="field spanall"><label for="m${i}_for">For product</label><select id="m${i}_for" data-c="shutterKey"><option value="">Whole job</option>
          ${rep.shutters.map(s => html`<option value="${s.key}" ${s.key === r.shutterKey ? 'selected' : ''}>${s.tag} ${s.location}</option>`)}</select></div>` : ''}
        <div class="field spanall"><label for="m${i}_spec">Size / Spec / Model</label><input type="text" id="m${i}_spec" data-c="spec" value="${r.spec}"></div>
        <div class="field"><label for="m${i}_qty">Qty</label><input type="number" id="m${i}_qty" data-c="qty" value="${r.qty ?? ''}"></div>
        <div class="field"><label for="m${i}_unit">Unit</label><input type="text" id="m${i}_unit" data-c="unit" value="${r.unit}"></div>
        <div class="field spanall"><label for="m${i}_remarks">Remarks</label><input type="text" id="m${i}_remarks" data-c="remarks" value="${r.remarks}"></div>
      </div></div>`)}
    <button type="button" class="add-dashed" id="addRow">+ Add material / spare part</button>
    <div style="margin-top:10px">${field({ name: 's5_consumables', label: 'Consumables / Misc. (item / qty / est. cost)', type: 'textarea', value: rep.s5.consumables, mic: true, hint: 'e.g. grinding disc, welding rod, lubricant, fasteners, paint' })}</div>`,
  read(body, rep) {
    const rows = $$('[data-row]', body).map(row => {
      const o = {};
      $$('[data-c]', row).forEach(inp => { o[inp.dataset.c] = inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value.trim(); });
      if (rep.shutters.length === 1) o.shutterKey = rep.shutters[0].key;
      return o;
    });
    return { s5: { rows, consumables: readForm(body).s5_consumables ?? rep.s5.consumables } };
  },
  bind(body, rep, ctx) {
    $('#addRow', body).addEventListener('click', () => {
      const cur = step5.read(body, rep).s5;
      ctx.save({ s5: { ...cur, rows: [...cur.rows, { name: '', spec: '', qty: 1, unit: '', remarks: '', itemId: null, shutterKey: '' }] } });
      ctx.repaint();
    });
    $$('[data-delrow]', body).forEach(b => b.addEventListener('click', () => {
      const cur = step5.read(body, rep).s5;
      ctx.save({ s5: { ...cur, rows: cur.rows.filter((_, i) => i !== +b.dataset.delrow) } });
      ctx.repaint();
    }));
    // Choosing a master item fills its spec and unit.
    body.addEventListener('change', e => {
      if (e.target.dataset.c !== 'name') return;
      const it = items().find(i => i.name.toLowerCase() === e.target.value.trim().toLowerCase());
      const row = e.target.closest('[data-row]');
      $('[data-c="itemId"]', row).value = it?.id || '';
      if (!it) { ctx.save(step5.read(body, rep)); return; }
      const spec = $('[data-c="spec"]', row), unit = $('[data-c="unit"]', row);
      if (!spec.value) spec.value = it.spec || '';
      if (!unit.value) unit.value = it.unit;
      ctx.save(step5.read(body, rep));
    });
  },
};

const step6 = {
  title: 'Site requirements & remarks', short: 'Site', nav: 'Site requirements',
  render: (rep, opt = {}) => html`
    <div class="checks" style="${opt.phone ? '' : 'grid-template-columns:1fr'}">
      ${check('s6_normalAccess', 'Normal access', rep.s6.normalAccess)}${check('s6_restricted', 'Restricted access / key required', rep.s6.restricted)}
      ${check('s6_permit', 'Permit-to-work required', rep.s6.permit)}${check('s6_safetyDocs', 'Safety documents required', rep.s6.safetyDocs)}
      ${check('s6_protection', 'Protection of floor / property', rep.s6.protection)}${check('s6_barricade', 'Safety barricade / signage', rep.s6.barricade)}
    </div>
    ${rep.s4.maxHeight > 3 ? html`<div class="note warn small" style="margin-top:8px">Max. working height is ${rep.s4.maxHeight} m (over 3 m).</div>` : ''}
    <div style="margin-top:10px">${field({ name: 's6_remarks', label: 'Remarks / Exclusions / Assumptions', type: 'textarea', value: rep.s6.remarks, mic: true })}</div>`,
  read: (body, rep) => ({ s6: readSection(body, 's6', rep.s6) }),
};

// Sign-off (section 7): the technician (Viewed by) and the customer (Acknowledged by), who first sees the report
// ("Preview the report for the customer"). A customer who is not there is marked with the reason.
let pads = {};
const SIG = { tech: 'signatureId', cust: 'custSignatureId' };
const sigBox = (who, id, label) => html`<div class="field sig-wrap"><div class="row"><span class="field-label grow">${label}</span><button type="button" class="btn link small" data-clear="${who}">${id ? 'Sign again' : 'Clear'}</button></div>
  ${id ? html`<img class="sig-img" data-media="${id}" alt="Saved signature">` : html`<canvas class="sig-pad" id="sig_${who}" style="height:120px" role="img" aria-label="${label}: sign here"></canvas><div class="hint small muted">Sign with a finger or the mouse.</div>`}</div>`;
const step7 = {
  title: 'Sign-off', short: 'Sign-off',
  render: (rep, opt = {}) => {
    const s = rep.s7;
    // The lines the customer asked about: counted as checked only when they are ticked.
    const asks = (rep.asked || []).filter(a => !a.added), left = asks.filter(a => !a.done).length;
    return html`
    <div class="m-card small">
      ${asks.length ? html`<div>${left ? '!' : '✓'} Lines checked on site: <b>${asks.length - left} of ${asks.length}</b>${left && opt.phone ? html` · <a href="#" data-goto="2">Go to Job scope</a>` : ''}</div>` : ''}
      <div>Products: <b>${rep.shutters.length}</b> · Photos: <b>${rep.photos.length}</b> · Materials listed: <b>${rep.s5.rows.length}</b></div>
    </div>
    <div class="m-section">Viewed by · company representative</div>
    <div class="m-card stack">
      ${field({ name: 's7_name', label: 'Name', value: s.name })}
      ${field({ name: 's7_designation', label: 'Designation', value: s.designation })}
      ${field({ name: 's7_date', label: 'Date', type: 'date', value: s.date })}
      ${sigBox('tech', s.signatureId, 'Signature')}
    </div>
    <div class="m-section">Acknowledged by · customer</div>
    <div class="m-card stack">
      <button type="button" class="btn block" id="previewRep">${icon('eye', 15)} Preview the report for the customer</button>
      <div class="hint small muted">Let the customer read it before signing.</div>
      ${s.custAbsent ? '' : html`${field({ name: 's7_custName', label: 'Customer name', value: s.custName || '' })}
        ${field({ name: 's7_custDesignation', label: 'Designation', value: s.custDesignation || '', placeholder: 'e.g. Facilities Manager' })}
        ${sigBox('cust', s.custSignatureId, 'Customer signature')}`}
      <div>${check('s7_custAbsent', 'Customer not available to sign', s.custAbsent)}</div>
      ${s.custAbsent ? field({ name: 's7_custAbsentReason', label: 'Reason', value: s.custAbsentReason || '', placeholder: 'e.g. shop closed; the guard let us in' }) : ''}
    </div>`;
  },
  read: (body, rep) => ({ s7: readSection(body, 's7', rep.s7) }),
  bind(body, rep, ctx) {
    pads = {};
    // A pad that is drawn on tells the form, so a "Sign here" message under it clears.
    Object.keys(SIG).forEach(who => { const c = $(`#sig_${who}`, body); if (c) { pads[who] = signaturePad(c); c.addEventListener('pointerdown', () => c.dispatchEvent(new Event('input', { bubbles: true }))); } });
    // Keep what is drawn, then redraw the step (clearing a saved signature, or the customer-not-available tick).
    const keepAndRepaint = async patch => { ctx.save(step7.read(body, rep)); ctx.save(await step7.leave(body, rep)); if (patch) ctx.save({ s7: { ...rep.s7, ...patch } }); ctx.repaint(); };
    $$('[data-clear]', body).forEach(b => b.addEventListener('click', () => {
      const who = b.dataset.clear, id = rep.s7[SIG[who]];
      if (!id) { pads[who]?.clear(); return; }
      keepAndRepaint({ [SIG[who]]: null });
    }));
    $('[name="s7_custAbsent"]', body)?.addEventListener('change', () => keepAndRepaint());
    const pv = $('#previewRep', body);
    if (!ctx.preview) pv.hidden = true;
    pv.addEventListener('click', async () => { ctx.save(step7.read(body, rep)); ctx.save(await step7.leave(body, rep)); ctx.repaint(); ctx.preview(); });
  },
  // Save the drawn signatures before leaving the step, previewing or submitting.
  async leave(body, rep) {
    const patch = {};
    for (const who of Object.keys(pads)) if (!pads[who].isEmpty()) patch[SIG[who]] = (await pads[who].save()).id;
    Object.keys(patch).forEach(k => { delete pads[Object.keys(SIG).find(w => SIG[w] === k)]; });
    return Object.keys(patch).length ? { s7: { ...rep.s7, ...patch } } : {};
  },
};

export const STEPS_2_TO_7 = [step2, step3, step4, step5, step6, step7];
