// Admin Setup in Stretch 1: read-only views of the seeded company profile, number series, roles and
// menu access (editing screens come in Stretch 3), plus the "coming in a later stretch" page.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, placeholderTag } from '../core/ui.js';
import { MENUS, GROUPS, menuByKey, ACTIONS } from '../data/menus.js';
import { pageHead } from './shell.js';

const LATER = {
  estimation: 'Repair estimates with the team lead\'s tabs, job or line costing, revisions.',
  quotation: 'Quotations from the estimate, the approver\'s counter-check, revisions, acceptance by PO.',
  job: 'Scheduling board, invoice at scheduling for immediate payment, phone job steps, Work Done form.',
  closure: 'Review of all linked documents; closes itself when the invoice is fully paid.',
  invoice: 'Tax invoice layout, gapless numbers on posting, print preview.',
  payment: 'Cash, cheque, bank transfer or PayNow; partial payments; ageing; follow-up log.',
  amcContract: 'AMC contract with sites, covered shutters, visit plan and billing plan.',
  amcScheduling: 'Calendar of planned visits by month and zone.',
  amcExecution: 'Checklist per shutter on the phone; a failed item creates a repair enquiry.',
  authWorkflow: 'Editing screen for the approval rules. The engine and its preset rules are already working (see Transaction Setup).',
};

export function renderSoon(el, key) {
  const m = menuByKey(key);
  el.innerHTML = String(html`<div class="page">${pageHead({ crumb: m?.group || '', title: m?.label || key })}
    <div class="card" style="max-width:640px"><span class="tag info">${m?.stretch === 3.5 ? 'Stretch 3 Part B' : `Stretch ${m?.stretch || 2}`}</span>
    <p style="margin-top:8px">${LATER[key] || 'This screen is built in a later stretch.'}</p>
    <p class="muted">The menu is already here so that roles and menu access can be set up for it.</p></div></div>`);
}

const note = html`<div class="note" style="margin-bottom:10px">Read-only in Stretch 1: this is the seeded setup. The editing screen comes in Stretch 3 Part B.</div>`;

function companySetup(c) {
  const row = (k, label) => html`<div><div class="k">${label}</div><div class="v">${c[k] === true ? 'Yes' : c[k] === false ? 'No' : c[k]} ${c.placeholders?.includes(k) ? placeholderTag('dummy') : ''}</div></div>`;
  return html`<div class="card"><div class="kv">${row('name', 'Company name')}${row('country', 'Country')}${row('currency', 'Currency')}
    ${row('regLabel', 'Registration label')}${row('regNo', 'Registration no.')}${row('taxLabel', 'Tax label')}${row('chargesTax', 'Charges tax')}
    ${row('taxRegLabel', 'Tax number label')}${row('taxRegNo', 'Tax number')}${row('defaultTaxCode', 'Default tax code')}
    ${row('address', 'Address')}${row('tel', 'Tel')}${row('mobile', 'Mobile')}${row('email', 'Email')}${row('inspectionTargetHours', 'Site inspection target (hours)')}</div></div>`;
}

function transactionSetup() {
  const year = new Date().getFullYear();
  const d = auth.company().txDefaults || {};
  const label = (set, v) => store.findOne('valueSets', x => x.code === set)?.values.find(x => x.code === v)?.label || v;
  return html`<div class="card" style="margin-bottom:10px"><div class="card-head"><h2>Defaults for new estimates and quotations</h2></div><div class="kv">
      <div><div class="k">Costing Level</div><div class="v">${label('COSTING_LEVEL', d.costingLevel)}</div></div><div><div class="k">Shared Costs</div><div class="v">${label('SHARED_COSTS', d.sharedCosts)}</div></div>
      <div><div class="k">Overheads</div><div class="v">${d.overheadPct} % of direct cost</div></div><div><div class="k">Margin</div><div class="v">${label('MARGIN_BASIS', d.marginBasis)} ${d.marginPct} %</div></div>
      <div><div class="k">Quotation validity</div><div class="v">${d.quoteValidityDays} days (Terms master, term 6)</div></div></div></div>
    <div class="card" style="margin-bottom:10px"><div class="card-head"><h2>Approval rules</h2><span class="muted small">preset; the editing screen is the Authorization Workflow Master (Stretch 3 Part B)</span></div>
      <div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Rule</th><th>When</th><th>Level</th><th>Approver role</th></tr></thead><tbody>
        ${store.list('approvalRules').map(r => html`<tr><td>${r.name}</td><td class="wrap">${r.when}</td><td>${r.level}</td><td>${store.findOne('roles', x => x.code === r.roleCode)?.name || r.roleCode}</td></tr>`)}</tbody></table></div></div>
    <div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Document</th><th>Prefix</th><th>Format</th><th>Reset</th><th>Last number ${year}</th></tr></thead><tbody>
    ${store.list('series').map(s => html`<tr><td>${s.name}</td><td>${s.prefix}</td><td>${s.prefix}-${year}-${'0'.repeat(s.padding - 1)}1</td><td>${s.reset}</td><td>${s.lastByYear[year] || 0}</td></tr>`)}
  </tbody></table></div>`;
}

function userRoles() {
  const users = store.all('users');
  return html`<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Code</th><th>Role</th><th>What it does</th><th>Users</th></tr></thead><tbody>
    ${store.list('roles').map(r => html`<tr><td>${r.code}</td><td>${r.name}</td><td class="wrap">${r.description}</td><td>${users.filter(u => u.roleId === r.id).map(u => u.name).join(', ') || '—'}</td></tr>`)}
  </tbody></table></div>`;
}

function menuAccess() {
  const roles = store.list('roles');
  const access = store.list('menuAccess');
  const ch = { web: 'Web', mobile: 'Mobile', both: 'Both' };
  const short = a => a.actions.length === ACTIONS.length ? 'all actions' : a.actions.join(', ');
  return html`<p class="muted" style="margin-bottom:8px">Each cell: where the menu shows (Web / Mobile / Both), the actions allowed, and "own" when the role sees only records assigned to it.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Menu</th>${roles.map(r => html`<th>${r.name}</th>`)}</tr></thead><tbody>
    ${GROUPS.map(g => html`<tr><td colspan="${roles.length + 1}" class="strong" style="background:var(--page)">${g}</td></tr>
      ${MENUS.filter(m => m.group === g).map(m => html`<tr><td>${m.label}</td>${roles.map(r => {
        const a = access.find(x => x.roleId === r.id && x.menu === m.key);
        return html`<td class="small">${a ? html`<b>${ch[a.channel]}</b> · ${short(a)}${a.scope === 'own' ? ' · own' : ''}` : html`<span class="muted">—</span>`}</td>`;
      })}</tr>`)}`)}
  </tbody></table></div>`;
}

export function renderAdmin(el, key) {
  const m = menuByKey(key);
  const body = { companySetup: () => companySetup(auth.company()), transactionSetup, userRole: userRoles, menuAccess }[key];
  if (!body) return renderSoon(el, key);
  el.innerHTML = String(html`<div class="page">${pageHead({ crumb: 'Admin Setup', title: m.label })}${note}${body()}</div>`);
}
