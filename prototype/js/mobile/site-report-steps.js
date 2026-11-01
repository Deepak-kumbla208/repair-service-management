// Phone: Site Viewing Report steps 2–7, one per section of the team lead's form.
// Photos (step 2) are attached to the report but are not part of the printed form.
import { html, $, $$, field, readForm, toast } from '../core/ui.js';
import { zones, items } from '../core/lookups.js';
import { manHours } from '../core/costing.js';
import { removeBlob } from '../core/media.js';
import { savePhotos, signaturePad } from '../core/capture.js';

const check = (name, label, on) => html`<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
// Read "prefix_key" controls back into a section object.
function readSection(body, prefix, current) {
  const d = readForm(body);
  const out = { ...current };
  Object.keys(d).filter(k => k.startsWith(`${prefix}_`)).forEach(k => { out[k.slice(prefix.length + 1)] = d[k]; });
  return out;
}

const step2 = {
  title: 'Job scope',
  render: rep => html`
    <div class="checks" style="grid-template-columns:1fr 1fr">${check('s2_supplyInstall', 'Supply & install', rep.s2.supplyInstall)}${check('s2_repair', 'Repair', rep.s2.repair)}
      ${check('s2_replace', 'Replace component', rep.s2.replace)}${check('s2_motor', 'Motor / control works', rep.s2.motor)}
      ${check('s2_dismantle', 'Dismantle / removal', rep.s2.dismantle)}${check('s2_servicing', 'Servicing / maintenance', rep.s2.servicing)}</div>
    ${(rep.asked || []).length ? html`<div class="m-section">What the customer asked for <span class="tag info">screen only</span></div>
      <p class="small muted" style="margin:0 0 6px">From the enquiry. Tick each one once you have checked it on site; add a note if needed.</p>
      <div class="asked">${rep.asked.map((a, i) => html`<div class="ask ${a.done ? 'on' : ''}"><label class="check"><input type="checkbox" name="ask_${i}" ${a.done ? 'checked' : ''}> <b>${a.n}.</b> ${a.text}</label>
        <div class="with-mic"><input type="text" name="asknote_${i}" placeholder="Note (optional)" value="${a.note || ''}"><button type="button" class="mic" data-mic="asknote_${i}" title="Voice input">🎤</button></div></div>`)}</div>` : ''}
    <div class="stack" style="margin-top:10px">
      ${field({ name: 's2_other', label: 'Other', value: rep.s2.other })}
      ${field({ name: 's2_description', label: 'Job Scope / Description of Work', type: 'textarea', value: rep.s2.description, mic: true })}
      ${field({ name: 's2_findings', label: 'Customer Complaint / Findings', type: 'textarea', value: rep.s2.findings, mic: true, hint: 'Pre-filled from the enquiry, one line per item' })}
    </div>
    <div class="m-section">Photos <span class="tag info">attached, not printed on the form</span></div>
    <div class="photos">${rep.photos.map(p => html`<div class="photo"><img data-media="${p}" alt="Site photo"><button type="button" class="del" data-delphoto="${p}" aria-label="Remove photo">×</button></div>`)}</div>
    <label class="add-dashed" style="display:block;margin-top:8px">📷 Take or add photos<input type="file" accept="image/*" capture="environment" multiple hidden id="photoIn"></label>`,
  read: (body, rep) => {
    const d = readForm(body);
    const asked = (rep.asked || []).map((a, i) => ({ ...a, done: d[`ask_${i}`] ?? a.done, note: d[`asknote_${i}`] ?? a.note }));
    return { s2: readSection(body, 's2', rep.s2), asked };
  },
  bind(body, rep, ctx) {
    $('#photoIn', body).addEventListener('change', async e => {
      ctx.save(step2.read(body, rep));
      const ids = await savePhotos(e.target.files);
      if (ids.length) { ctx.save({ photos: [...rep.photos, ...ids] }); toast(`${ids.length} photo(s) added`); }
      ctx.repaint();
    });
    $$('[data-delphoto]', body).forEach(b => b.addEventListener('click', () => {
      ctx.save({ ...step2.read(body, rep), photos: rep.photos.filter(p => p !== b.dataset.delphoto) });
      removeBlob(b.dataset.delphoto);
      ctx.repaint();
    }));
  },
};

const step3 = {
  title: 'Labour / man-hours / transport',
  render: rep => html`
    <div class="field"><div class="field-label">Transport Zone (from the site)</div><div class="row wrap">${zones().map(z => html`<label class="check" style="margin-right:10px"><input type="radio" name="s3_zoneId" value="${z.id}" ${z.id === rep.s3.zoneId ? 'checked' : ''}> ${z.code} <span class="muted small">${z.name}</span></label>`)}</div></div>
    <div class="grid g3" style="margin-top:10px">
      ${field({ name: 's3_persons', label: 'No. of Persons', type: 'number', value: rep.s3.persons })}
      ${field({ name: 's3_days', label: 'No. of Days', type: 'number', value: rep.s3.days })}
      ${field({ name: 's3_hoursPerDay', label: 'Hours / Day', type: 'number', step: '0.5', value: rep.s3.hoursPerDay })}
    </div>
    <div class="m-card" style="margin-top:10px">Total Man-hours: <b id="mh">${manHours(rep.s3.persons, rep.s3.days, rep.s3.hoursPerDay) || '—'}</b> <span class="small muted">(persons × days × hours)</span></div>
    ${field({ name: 's3_remarks', label: 'Remarks', value: rep.s3.remarks })}
    <div class="field" style="margin-top:10px"><div class="field-label">Working Hours</div><div class="checks" style="grid-template-columns:1fr">
      ${check('s3_normal', 'Normal hours', rep.s3.normal)}${check('s3_afterHours', 'After hours / night', rep.s3.afterHours)}
      ${check('s3_weekend', 'Weekend / Public holiday', rep.s3.weekend)}${check('s3_phased', 'Phased (per level / block)', rep.s3.phased)}</div></div>`,
  read: (body, rep) => ({ s3: readSection(body, 's3', rep.s3) }),
  bind(body) {
    body.addEventListener('input', () => { const d = readForm(body); $('#mh', body).textContent = manHours(d.s3_persons, d.s3_days, d.s3_hoursPerDay) || '—'; });
  },
};

const step4 = {
  title: 'Equipment & access',
  render: rep => html`
    <div class="checks" style="grid-template-columns:1fr">
      ${check('s4_ladder', 'Ladder / platform ladder', rep.s4.ladder)}
      <div class="row">${check('s4_scaffolding', 'Scaffolding', rep.s4.scaffolding)}<input type="number" name="s4_scaffoldSets" value="${rep.s4.scaffoldSets}" placeholder="sets" style="width:80px"></div>
      <div class="row">${check('s4_scissor', 'Scissor lift', rep.s4.scissor)}<input type="number" name="s4_scissorNos" value="${rep.s4.scissorNos}" placeholder="nos" style="width:80px"></div>
      ${check('s4_boom', 'Boom lift / MEWP', rep.s4.boom)}${check('s4_hoist', 'Hoist / chain block', rep.s4.hoist)}${check('s4_welding', 'Welding set', rep.s4.welding)}
      ${check('s4_grinding', 'Grinding machine / cutter', rep.s4.grinding)}${check('s4_powerTools', 'Power tools / drill', rep.s4.powerTools)}
    </div>
    <div class="stack" style="margin-top:10px">
      ${field({ name: 's4_other', label: 'Other', value: rep.s4.other })}
      ${field({ name: 's4_maxHeight', label: 'Max. Working Height (m)', type: 'number', step: '0.1', value: rep.s4.maxHeight })}
      <div id="heightNote"></div>
      <div class="field"><div class="field-label">Provided By</div><div class="row">${['Customer', 'Contractor'].map(p => html`<label class="check" style="margin-right:14px"><input type="radio" name="s4_providedBy" value="${p}" ${rep.s4.providedBy === p ? 'checked' : ''}> ${p}</label>`)}</div></div>
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
  title: 'Materials / spare parts',
  render: rep => html`
    <datalist id="itemList">${items().map(i => html`<option value="${i.name}">${i.code}${i.spec ? ` · ${i.spec}` : ''}</option>`)}</datalist>
    <p class="small muted" style="margin:0 0 6px">Pick from the Material/Item master (type to search) or type a new part.</p>
    ${rep.s5.rows.map((r, i) => html`<div class="mat-row" data-row="${i}"><div class="row"><b>${i + 1}.</b><span class="grow"></span><button type="button" class="btn link small" data-delrow="${i}">Remove</button></div>
      <div class="grid g2">
        <div class="field spanall"><label>Material / Spare Part</label><input list="itemList" data-c="name" value="${r.name}"><input type="hidden" data-c="itemId" value="${r.itemId || ''}"></div>
        ${rep.shutters.length > 1 ? html`<div class="field spanall"><label>For shutter <span class="muted">(screen only, for the estimate lines)</span></label><select data-c="shutterKey"><option value="">Whole job</option>
          ${rep.shutters.map(s => html`<option value="${s.key}" ${s.key === r.shutterKey ? 'selected' : ''}>${s.tag} ${s.location}</option>`)}</select></div>` : ''}
        <div class="field spanall"><label>Size / Spec / Model</label><input data-c="spec" value="${r.spec}"></div>
        <div class="field"><label>Qty</label><input type="number" data-c="qty" value="${r.qty ?? ''}"></div>
        <div class="field"><label>Unit</label><input data-c="unit" value="${r.unit}"></div>
        <div class="field spanall"><label>Remarks</label><input data-c="remarks" value="${r.remarks}"></div>
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
  title: 'Site requirements & remarks',
  render: rep => html`
    <div class="checks" style="grid-template-columns:1fr">
      ${check('s6_normalAccess', 'Normal access', rep.s6.normalAccess)}${check('s6_restricted', 'Restricted access / key required', rep.s6.restricted)}
      ${check('s6_permit', 'Permit-to-work required', rep.s6.permit)}${check('s6_safetyDocs', 'Safety documents required', rep.s6.safetyDocs)}
      ${check('s6_protection', 'Protection of floor / property', rep.s6.protection)}${check('s6_barricade', 'Safety barricade / signage', rep.s6.barricade)}
    </div>
    ${rep.s4.maxHeight > 3 ? html`<div class="note warn small" style="margin-top:8px">Max. working height is ${rep.s4.maxHeight} m (over 3 m).</div>` : ''}
    <div style="margin-top:10px">${field({ name: 's6_remarks', label: 'Remarks / Exclusions / Assumptions', type: 'textarea', value: rep.s6.remarks, mic: true })}</div>`,
  read: (body, rep) => ({ s6: readSection(body, 's6', rep.s6) }),
};

let pad = null;
const step7 = {
  title: 'Sign-off',
  render: rep => html`
    <div class="m-card small">
      <div>${rep.shutters.length ? '✓' : '•'} Shutters picked: <b>${rep.shutters.length}</b></div>
      <div>${rep.photos.length ? '✓' : '•'} Photos: <b>${rep.photos.length}</b></div>
      <div>${rep.s5.rows.length ? '✓' : '•'} Materials listed: <b>${rep.s5.rows.length}</b></div>
    </div>
    <div class="m-section">VIEWED BY · Company Representative</div>
    <div class="stack">
      ${field({ name: 's7_name', label: 'Name', value: rep.s7.name })}
      ${field({ name: 's7_designation', label: 'Designation', value: rep.s7.designation })}
      ${field({ name: 's7_date', label: 'Date', type: 'date', value: rep.s7.date })}
      <div class="field"><div class="row"><span class="field-label grow">Signature</span><button type="button" class="btn link small" id="clearSig">${rep.s7.signatureId ? 'Sign again' : 'Clear'}</button></div>
        ${rep.s7.signatureId ? html`<img class="sig-img" data-media="${rep.s7.signatureId}" alt="Saved signature">` : html`<canvas class="sig-pad" id="sig"></canvas><div class="hint small muted">Sign with your finger or the mouse.</div>`}</div>
    </div>`,
  read: (body, rep) => ({ s7: readSection(body, 's7', rep.s7) }),
  bind(body, rep, ctx) {
    const canvas = $('#sig', body);
    pad = canvas ? signaturePad(canvas) : null;
    $('#clearSig', body).addEventListener('click', () => {
      if (rep.s7.signatureId) { removeBlob(rep.s7.signatureId); ctx.save({ s7: { ...step7.read(body, rep).s7, signatureId: null } }); ctx.repaint(); } else pad?.clear();
    });
  },
  // Save the drawn signature before leaving the step or submitting.
  async leave(body, rep) {
    if (!pad || pad.isEmpty()) return {};
    const m = await pad.save();
    pad = null;
    return { s7: { ...rep.s7, signatureId: m.id } };
  },
};

export const STEPS_2_TO_7 = [step2, step3, step4, step5, step6, step7];
