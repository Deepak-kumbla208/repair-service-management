// Authorization Workflow Master (Admin Setup): the approval rules for quotations and jobs. A condition is picked from a
// list of facts and its description is written from it; levels 1, 2, 3 and more, one person of the level's role decides;
// only roles with the Approve right on that menu can be chosen. "Test a document" previews the levels a real document
// would need with the rule as it stands on the screen. Transaction Setup shows the same rules ("merging").
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, toast, chipGroup } from '../core/ui.js';
import { vsOptions } from '../core/lookups.js';
import { DOC_TYPES, FACTS, OPS, JOB_TYPES, describeRule, levelsWith, factsOf, matches, approverRoles, activeUsersOf, saveRule } from '../core/workflow.js';
import { pageHead } from './shell.js';
import { changesCard } from './admin-company.js';
import { render } from '../app.js';

const SEL_KEY = 'rsmRuleSel';
const state = { tab: 'all', draft: null, testId: '' };
const roleName = code => store.findOne('roles', r => r.code === code)?.name || code;
const fact = key => FACTS.find(f => f.key === key) || FACTS[0];
const blank = docType => ({ id: '', code: '', name: '', docType, level: 1, roleCode: approverRoles(docType)[0]?.code || '', condition: { field: 'total', op: 'gt', value: '' }, active: true });
const fromRule = r => ({ ...structuredClone(r), condition: r.condition ? { ...r.condition } : { field: 'all', op: '', value: '' } });

function valueInput(c) {
  const f = fact(c.field);
  if (f.type === 'all') return '';
  const ops = OPS[f.type] || [];
  const op = html`<select name="op">${ops.map(([k, l]) => html`<option value="${k}" ${k === c.op ? 'selected' : ''}>${l}</option>`)}</select>`;
  if (f.type === 'money' || f.type === 'pct') return html`${op} <input type="number" name="value" value="${c.value ?? ''}" style="width:100px" step="0.01">${f.type === 'pct' ? ' %' : ''}`;
  if (f.type === 'term') return html`${op} <select name="value">${vsOptions('PAYMENT_TERMS').map(o => html`<option value="${o.value}" ${o.value === c.value ? 'selected' : ''}>${o.label}</option>`)}</select>`;
  if (f.type === 'jobType') return html`${op} <select name="value">${JOB_TYPES.map(o => html`<option value="${o.value}" ${o.value === c.value ? 'selected' : ''}>${o.label}</option>`)}</select>`;
  return html`<select name="value"><option value="true" ${c.value !== false ? 'selected' : ''}>yes</option><option value="false" ${c.value === false ? 'selected' : ''}>no (existing customer)</option></select>`;
}

function editor(d, edit) {
  const roles = approverRoles(d.docType);
  return html`<form class="props form-lines" id="rf" onsubmit="return false">
    <div class="form-sec">${d.id ? `Rule · ${d.code}` : 'New rule'}</div>
    <div class="field"><label for="r-code">Code <span class="req">*</span></label><input type="text" id="r-code" name="code" value="${d.code}" ${edit ? '' : 'readonly'}></div>
    <div class="field"><label>Applies to</label>${chipGroup('docType', Object.entries(DOC_TYPES).map(([value, x]) => ({ value, label: x.label })), d.docType, !edit || !!d.id)}
      ${d.docType === 'job' ? html`<div class="hint">Job rules are checked when the customer accepts with a payment term other than Immediate that differs from the quotation's.</div>` : ''}</div>
    <div class="field"><label>When</label><div class="ro" style="flex-wrap:wrap;gap:4px"><select name="field" ${edit ? '' : 'disabled'}>${FACTS.map(f => html`<option value="${f.key}" ${f.key === d.condition.field ? 'selected' : ''}>${f.label}${f.type === 'pct' ? ' %' : ''}</option>`)}</select>
      <span id="val">${valueInput(d.condition)}</span></div></div>
    <div class="field"><label>Reads as</label><div class="ro"><b id="reads">${describeRule({ ...d, condition: d.condition.field === 'all' ? null : d.condition })}</b></div></div>
    <div class="field"><label>Level</label>${chipGroup('level', [1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) })), d.level, !edit)}</div>
    <div class="field"><label for="r-role">Approver role</label><select id="r-role" name="roleCode" ${edit ? '' : 'disabled'}>${roles.map(r => html`<option value="${r.code}" ${r.code === d.roleCode ? 'selected' : ''}>${r.name}</option>`)}</select>
      <div class="hint">Roles with Approve on ${DOC_TYPES[d.docType].label === 'Job' ? 'Job Execution' : 'Sales Quotation'}: ${roles.map(r => r.name).join(', ') || 'none'} · any one person of the role decides</div></div>
    <div class="field"><label for="r-name">Rule name</label><input type="text" id="r-name" name="name" value="${d.name}" placeholder="Optional; the description is used" ${edit ? '' : 'readonly'}></div>
    <div class="field"><label>Active</label>${chipGroup('active', [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], String(d.active !== false), !edit)}</div>
    ${edit ? html`<div class="row" style="margin-top:10px"><button type="button" class="btn primary" id="saveRule">Save rule</button>${d.id ? html`<button type="button" class="btn" id="newRule">New rule</button>` : ''}</div>` : ''}</form>`;
}

// The draft as a rule object (for "Reads as" and the test preview).
const asRule = d => ({ ...d, level: Number(d.level), active: d.active !== false && d.active !== 'false',
  condition: d.condition.field === 'all' ? null : { ...d.condition, value: ['money', 'pct'].includes(fact(d.condition.field).type) ? Number(d.condition.value) : fact(d.condition.field).type === 'bool' ? d.condition.value !== false && d.condition.value !== 'false' : d.condition.value } });

function testCard(d) {
  const docs = d.docType === 'job' ? store.list('jobs', j => j.status !== 'Cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15)
    : store.list('quotations', q => q.status !== 'Superseded').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15);
  const doc = docs.find(x => x.id === state.testId) || docs[0];
  if (!doc) return '';
  const rules = store.list('approvalRules').filter(r => r.id !== d.id);
  const draftRule = { ...asRule(d), id: d.id || 'draft', code: d.code || 'NEW' };
  const levels = levelsWith([...rules, draftRule], d.docType, doc);
  const facts = factsOf(d.docType, doc);
  const draftHits = draftRule.active && matches(draftRule, facts);
  const label = x => d.docType === 'job' ? `${x.no} · ${x.customer} · ${x.paymentTerm}` : `${x.no} Rev ${x.rev} · ${x.customer} · ${Number(x.total).toFixed(2)}`;
  return html`<div class="card"><div class="card-head"><h2>Test a document</h2><select id="testDoc">${docs.map(x => html`<option value="${x.id}" ${x.id === doc.id ? 'selected' : ''}>${label(x)}</option>`)}</select></div>
    ${levels.length ? html`<div class="lvl">${levels.map((l, i) => html`${i ? html`<span class="arrow">→</span>` : ''}<div class="s"><span class="muted small">Level ${l.level}</span><b>${roleName(l.roleCode)}</b><span class="small">${l.rules.map(r => r.code).join(' + ')}</span></div>`)}</div>`
      : html`<div class="muted">No approval needed: no active rule matches.</div>`}
    <p class="mini-note">With the rule on the left as it stands now: ${draftHits ? 'it applies to this document' : 'it does not apply to this document'}${facts.marginPct != null ? ` (margin on price ${facts.marginPct} %)` : ''}. Saving changes the next submissions only.</p></div>`;
}

export function renderRules(el) {
  const edit = auth.can('authWorkflow', 'edit');
  const rules = store.list('approvalRules').sort((a, b) => a.docType.localeCompare(b.docType) * -1 || a.level - b.level || a.code.localeCompare(b.code));
  const sel = sessionStorage.getItem(SEL_KEY);
  if (sel) { const r = rules.find(x => x.id === sel); if (r) { state.draft = fromRule(r); state.tab = r.docType; } sessionStorage.removeItem(SEL_KEY); }
  if (!state.draft) state.draft = rules[0] ? fromRule(rules[0]) : blank('quotation');
  const d = state.draft;
  const shown = rules.filter(r => state.tab === 'all' || r.docType === state.tab);
  const warn = rules.filter(r => r.active && !activeUsersOf(r.roleCode).length);
  const audit = store.list('audit', a => a.coll === 'approvalRules').sort((a, b) => b.at.localeCompare(a.at));

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    ${pageHead({ crumb: 'Admin Setup', title: 'Authorization Workflow Master', sub: 'Approval rules · levels 1, 2, 3 and more · the same rules show on each Transaction Setup page',
      actions: edit ? html`<button class="btn primary" id="add">+ New rule</button>` : '' })}
    <div class="etabs"><button data-tab="all" class="${state.tab === 'all' ? 'on' : ''}">All (${rules.length})</button>${Object.entries(DOC_TYPES).map(([k, x]) => html`<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${x.label} (${rules.filter(r => r.docType === k).length})</button>`)}</div>
    <div class="e2">
      ${editor(d, edit)}
      <div class="e2-main">
        <div class="card"><table class="tbl"><thead><tr><th>Active</th><th>Code</th><th>Rule</th><th>Applies to</th><th class="num">Level</th><th>Approver</th></tr></thead><tbody>
          ${shown.map(r => html`<tr class="click ${r.id === d.id ? 'sel' : ''}" data-rule="${r.id}"><td>${r.active ? '✓' : html`<span class="muted">off</span>`}</td><td>${r.code}</td><td>${describeRule(r)}</td><td>${DOC_TYPES[r.docType]?.label || r.docType}</td><td class="num">${r.level}</td><td>${roleName(r.roleCode)}</td></tr>`)}
        </tbody></table><p class="mini-note">Rules on the same level become one task for that level's role. Nobody decides a task for a document they submitted.</p></div>
        ${warn.length ? html`<div class="note warn">${warn.map(r => html`<div>${r.code}: no active user has the role ${roleName(r.roleCode)}; its tasks wait for the Admin, who cannot decide documents they submitted. Add a user with this role in User Role.</div>`)}</div>` : ''}
        <div id="test">${testCard(d)}</div>
        ${changesCard(audit)}
      </div>
    </div></div>`);

  const form = $('#rf', el);
  const readDraft = () => {
    const f = Object.fromEntries(new FormData(form));
    const field = f.field || d.condition.field;
    const changedField = field !== d.condition.field;
    Object.assign(d, { code: f.code ?? d.code, name: f.name ?? d.name, docType: f.docType || d.docType, level: Number(f.level || d.level), roleCode: f.roleCode || d.roleCode, active: (f.active ?? String(d.active)) !== 'false' });
    if (changedField) { const t = fact(field).type; d.condition = { field, op: OPS[t]?.[0]?.[0] || '', value: t === 'bool' ? true : t === 'term' ? 'IMMEDIATE' : t === 'jobType' ? 'REPAIR' : '' }; }
    else d.condition = { field, op: f.op ?? d.condition.op, value: f.value ?? d.condition.value };
    return changedField;
  };
  const refresh = () => {
    if (readDraft()) $('#val', el).innerHTML = String(valueInput(d.condition));
    $('#reads', el).textContent = describeRule(asRule(d));
    $('#test', el).innerHTML = String(testCard(d));
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', e => {
    if (e.target.name === 'docType') { const nd = blank(e.target.value); state.draft = { ...nd, code: d.code, name: d.name }; render(); return; }
    refresh();
  });
  el.addEventListener('change', e => { if (e.target.id === 'testDoc') { state.testId = e.target.value; $('#test', el).innerHTML = String(testCard(d)); } });
  on(el, 'click', '[data-tab]', (e, b) => { state.tab = b.dataset.tab; render(); });
  on(el, 'click', '[data-rule]', (e, tr) => { state.draft = fromRule(store.get('approvalRules', tr.dataset.rule)); render(); });
  $('#add', el)?.addEventListener('click', () => { state.draft = blank(state.tab === 'job' ? 'job' : 'quotation'); render(); });
  $('#newRule', el)?.addEventListener('click', () => { state.draft = blank(d.docType); render(); });
  $('#saveRule', el)?.addEventListener('click', () => {
    readDraft();
    const r = asRule(d);
    const res = saveRule(d.id || null, { ...r, condition: r.condition || { field: 'all' } });
    if (res.error) { toast(res.error, 'bad'); return; }
    state.draft = fromRule(res.rule);
    toast(`Rule ${res.rule.code} saved: it applies from the next submission`); render();
  });
}
