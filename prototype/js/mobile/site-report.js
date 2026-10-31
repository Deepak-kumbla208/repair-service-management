// Phone: the Site Viewing Report in 7 steps (one per section of the team lead's form), saved as you type.
// Step 1 holds section 1 (pre-filled from the enquiry) and the screen-only shutter picker.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, $$, go, debounce, field, readForm, markInvalid, openModal, toast, fmtDateTime, fmtNum } from '../core/ui.js';
import { findSite, products, productName, sizes } from '../core/lookups.js';
import { nextShutterTag } from '../core/customers.js';
import { classifySize, toMetres } from '../core/costing.js';
import { saveReport, submitReport } from '../core/inspections.js';
import { hydrateImages } from '../core/media.js';
import { bindMics } from '../core/capture.js';
import { STEPS_2_TO_7 } from './site-report-steps.js';

const S1 = [
  ['customer', 'Company / Customer'], ['site', 'Site / Project'], ['address', 'Full Address'], ['blockUnit', 'Block / Level / Unit'],
  ['viewedBy', 'Viewed By'], ['viewDate', 'Date of Viewing', 'date'], ['contactPerson', 'Contact Person'], ['contactNo', 'Contact No. / Email'],
  ['timeIn', 'Time In', 'time'], ['timeOut', 'Time Out', 'time'],
];

const step1 = {
  title: 'General details',
  render(rep) {
    const { site } = findSite(rep.siteId);
    const picked = new Map(rep.shutters.filter(s => s.shutterId).map(s => [s.shutterId, s]));
    const finding = s => html`<div class="find with-mic"><input type="text" name="find_${s.key}" data-find="${s.key}" placeholder="Fault found on ${s.tag}" value="${s.finding || ''}"><button type="button" class="mic" data-mic="find_${s.key}">🎤</button></div>`;
    return html`
      <div class="grid g2">${S1.map(([k, label, type]) => field({ name: `s1_${k}`, label, type: type || 'text', value: rep.s1[k], cls: ['address', 'customer'].includes(k) ? 'spanall' : '' }))}
        ${field({ name: 'refNo', label: 'Report / Ref. No.', value: rep.no, readonly: true })}</div>
      <div class="m-section">Shutters at this site <span class="tag info">screen only</span></div>
      <p class="small muted" style="margin:0 0 6px">Tick the shutters you inspected. They fill “Shutter Location” on the form and later become the estimate lines.</p>
      ${site?.shutters?.length > 4 ? html`<input type="search" class="m-search" id="shq" placeholder="Search shutters: tag, location">` : ''}
      <div id="shList">${(site?.shutters || []).filter(s => s.status !== 'Inactive').map(s => {
        const p = picked.get(s.id);
        return html`<label class="shutter ${p ? 'on' : ''}" data-text="${`${s.tag} ${s.location}`.toLowerCase()}"><input type="checkbox" data-pick="${s.id}" ${p ? 'checked' : ''}>
          <span class="grow"><b style="color:var(--blue-600)">${s.tag}</b> ${s.location}<br><span class="small muted">${productName(s.productId)} · ${fmtNum(s.width)} × ${fmtNum(s.height)} ${s.unit}${s.motor ? ` · ${s.motor}` : ''}</span>
          ${p ? finding(p) : ''}</span><span class="size">${s.sizeCode}</span></label>`;
      })}</div>
      ${rep.shutters.filter(s => s.isNew).map(s => html`<div class="shutter on"><span class="grow"><span class="tag">new</span> <b>${s.tag}</b> ${s.location}<br>
        <span class="small muted">${productName(s.productId)} · ${fmtNum(s.width)} × ${fmtNum(s.height)} ${s.unit} · joins the register on submit</span>${finding(s)}</span>
        <span class="size">${s.sizeCode}</span><button type="button" class="btn link small" data-drop="${s.key}">✕</button></div>`)}
      <button type="button" class="add-dashed" id="addSh">+ Add a new shutter</button>
      <div class="field" style="margin-top:10px"><div class="field-label">Shutter Location (printed in section 1)</div><div class="m-card small" id="locText">${rep.shutters.map(s => `${s.tag} ${s.location}`).join('; ') || '—'}</div></div>`;
  },
  read(body, rep) {
    const d = readForm(body);
    const s1 = { ...rep.s1 };
    S1.forEach(([k]) => { s1[k] = d[`s1_${k}`] ?? s1[k]; });
    const shutters = rep.shutters.map(s => ({ ...s, finding: d[`find_${s.key}`] ?? s.finding }));
    return { s1, shutters };
  },
  bind(body, rep, ctx) {
    const { site } = findSite(rep.siteId);
    $$('[data-pick]', body).forEach(cb => cb.addEventListener('change', () => {
      const sh = site.shutters.find(s => s.id === cb.dataset.pick);
      const shutters = cb.checked
        ? [...rep.shutters, { key: sh.id, shutterId: sh.id, tag: sh.tag, location: sh.location, productId: sh.productId, width: sh.width, height: sh.height, unit: sh.unit, sizeCode: sh.sizeCode, motor: sh.motor, finding: '' }]
        : rep.shutters.filter(s => s.shutterId !== sh.id);
      ctx.save({ shutters }); ctx.repaint();
    }));
    $$('[data-drop]', body).forEach(b => b.addEventListener('click', () => { ctx.save({ shutters: rep.shutters.filter(s => s.key !== b.dataset.drop) }); ctx.repaint(); }));
    $('#shq', body)?.addEventListener('input', e => { const t = e.target.value.toLowerCase(); $$('#shList .shutter', body).forEach(r => { r.style.display = r.dataset.text.includes(t) ? '' : 'none'; }); });
    $('#addSh', body).addEventListener('click', () => newShutter(site, rep, ctx));
  },
};

function newShutter(site, rep, ctx) {
  const tag = nextShutterTag({ shutters: [...(site?.shutters || []), ...rep.shutters.filter(s => s.isNew)] });
  const sizeOf = d => classifySize(toMetres(d.width, d.unit), toMetres(d.height, d.unit), sizes());
  openModal({
    title: 'Add a new shutter',
    body: html`<div class="grid g2">
      ${field({ name: 'tag', label: 'Tag', value: tag, required: true })}${field({ name: 'location', label: 'Location', required: true, placeholder: 'e.g. Back door' })}
      ${field({ name: 'productId', label: 'Type', type: 'select', options: products().map(p => ({ value: p.id, label: p.name })), value: products()[0]?.id, required: true, cls: 'spanall' })}
      ${field({ name: 'width', label: 'Width', type: 'number', step: '0.01', required: true })}${field({ name: 'height', label: 'Height', type: 'number', step: '0.01', required: true })}
      ${field({ name: 'unit', label: 'Unit', type: 'select', options: [{ value: 'm', label: 'metres' }, { value: 'ft', label: 'feet' }], value: 'm', blank: false })}
      <div class="field"><div class="field-label">Size class</div><b id="szOut" style="padding:6px 0">—</b></div>
      ${field({ name: 'motor', label: 'Motor (make / model)' })}${field({ name: 'serial', label: 'Serial no.' })}</div>`,
    onOpen: b => b.addEventListener('input', () => { $('#szOut', b).textContent = sizeOf(readForm(b)) || '—'; }),
    actions: [{ label: 'Cancel' }, { label: 'Add shutter', kind: 'primary', onClick: b => {
      const d = readForm(b);
      if (!markInvalid(b, ['tag', 'location', 'productId', 'width', 'height'].filter(n => d[n] === '' || d[n] == null))) return false;
      ctx.save({ shutters: [...rep.shutters, { key: store.uid('new_'), shutterId: null, isNew: true, ...d, sizeCode: sizeOf(d), finding: '' }] });
      ctx.repaint();
    } }],
  });
}

// Shared with the web editor (web/report-view.js), so the phone and the office fill the same report.
export const STEPS = [step1, ...STEPS_2_TO_7];

function submittedView(page, rep) {
  page.body.innerHTML = String(html`<div class="note" style="margin-bottom:10px">${rep.no} was submitted ${fmtDateTime(rep.submittedAt)}. The office sees it on the web.</div>
    <div class="m-section">Shutters inspected</div>${rep.shutters.map(s => html`<div class="m-card small"><b>${s.tag}</b> ${s.location} · ${s.sizeCode}${s.finding ? html`<br>${s.finding}` : ''}</div>`)}
    <div class="m-section">Photos</div>${rep.photos.length ? html`<div class="photos">${rep.photos.map(p => html`<div class="photo"><img data-media="${p}" alt="Photo"></div>`)}</div>` : html`<div class="muted small">No photos</div>`}
    <div class="m-section">Signed by ${rep.s7.name}</div>${rep.s7.signatureId ? html`<img class="sig-img" data-media="${rep.s7.signatureId}" alt="Signature">` : ''}`);
  page.setFoot(html`<a class="btn" href="#/m/jobs">Back to My jobs</a>`);
  hydrateImages(page.body);
}

export function mReport(page, id, stepStr) {
  const rep = store.get('siteReports', id);
  const insp = rep && store.get('inspections', rep.inspectionId);
  if (!rep || !auth.seesInspection(insp)) { page.setTitle('Site viewing report', 'm/jobs'); page.body.innerHTML = '<div class="empty">Report not found.</div>'; return; }
  page.setTitle(`${rep.no}`, `m/job/${insp.id}`);
  if (rep.status === 'Submitted') return submittedView(page, rep);
  if (!auth.can('inspection', 'edit', 'mobile')) { page.body.innerHTML = '<div class="empty">Only the technician fills in the report.</div>'; return; }

  const n = Math.min(7, Math.max(1, parseInt(stepStr, 10) || 1));
  const step = STEPS[n - 1];
  const ctx = {
    save(patch) { Object.assign(rep, patch); saveReport(rep.id, patch); },
    repaint() { paint(); },
  };
  const flush = async () => {
    ctx.save(step.read(page.body, rep));
    if (step.leave) ctx.save(await step.leave(page.body, rep));
  };

  function paint() {
    page.body.innerHTML = String(html`
      <div class="step-row"><span><b>Step ${n} of 7</b> · ${n}. ${step.title}</span><span>${rep.no}</span></div>
      <div class="steps">${STEPS.map((s, i) => html`<a href="#/m/report/${rep.id}/${i + 1}" data-jump="${i + 1}" class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}" title="${i + 1}. ${s.title}"></a>`)}</div>
      <form id="stepForm" onsubmit="return false">${step.render(rep)}</form>`);
    const form = $('#stepForm', page.body);
    step.bind?.(form, rep, ctx);
    bindMics(form);
    hydrateImages(form);
    const autosave = debounce(() => ctx.save(step.read(form, rep)), 400);
    form.addEventListener('input', autosave);
    form.addEventListener('change', () => ctx.save(step.read(form, rep)));
    $$('[data-jump]', page.body).forEach(a => a.addEventListener('click', async e => { e.preventDefault(); await flush(); go(`m/report/${rep.id}/${a.dataset.jump}`); }));
  }
  paint();

  const foot = page.setFoot(html`<button class="btn" id="prev">${n > 1 ? '← Back' : '← Job'}</button>
    ${n < 7 ? html`<button class="btn primary" id="next">Next: ${STEPS[n].title}</button>` : html`<button class="btn primary" id="submit">Submit report</button>`}`);
  $('#prev', foot).onclick = async () => { await flush(); go(n > 1 ? `m/report/${rep.id}/${n - 1}` : `m/job/${insp.id}`); };
  $('#next', foot)?.addEventListener('click', async () => { await flush(); go(`m/report/${rep.id}/${n + 1}`); page.body.scrollTop = 0; });
  $('#submit', foot)?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    await flush();
    const problems = submitReport(rep.id);
    if (problems.length) {
      btn.disabled = false;
      btn.textContent = 'Submit report';
      openModal({ title: 'Not ready to submit', body: html`<ul>${problems.map(p => html`<li>${p}</li>`)}</ul>`, actions: [{ label: 'OK', kind: 'primary' }] });
      return;
    }
    toast(`${rep.no} submitted · the office can see it now`);
    go('m/jobs');
  });
}
