// Admin Setup rules (Stretch 3 Part B): the company profile and the letterhead its documents keep, the working week,
// transaction settings (terms per document), users and roles, and menu access. Screens only show and collect;
// the checks live here. Depends only on the store and the login, so the rest of core/ can use it freely.
import * as store from './store.js';
import * as auth from './auth.js';
import { withCompany } from './lookups.js';
import { MENUS, MENU_RULES } from '../data/menus.js';

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asDate = d => (typeof d === 'string' ? new Date(`${d.slice(0, 10)}T00:00`) : new Date(d));

// ---------- Working week (Company Setup) ----------
// Scheduling suggestions, visit plans and "next working day" follow it. Default: Monday–Saturday, 08:30–17:30.
export function workWeek(c = auth.company()) {
  return { days: c?.workDays?.length ? c.workDays : [1, 2, 3, 4, 5, 6], start: c?.workStart ?? 8.5, end: c?.workEnd ?? 17.5 };
}
export const isWorkday = d => workWeek().days.includes(asDate(d).getDay());
export function nextWorkday(d) {
  const x = asDate(d);
  for (let i = 0; i < 7; i++) { x.setDate(x.getDate() + 1); if (isWorkday(x)) break; }
  return x;
}
// The same day when it is a working day, otherwise the next working day (as YYYY-MM-DD).
export const onWorkday = ds => (isWorkday(ds) ? ds.slice(0, 10) : dstr(nextWorkday(ds)));
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- Company profile and letterhead ----------
export const LETTERHEAD = ['name', 'address', 'regLabel', 'regNo', 'taxLabel', 'taxRegLabel', 'taxRegNo', 'chargesTax', 'tel', 'mobile', 'email', 'bank', 'payNow', 'logoId'];
// The letterhead a document keeps once it is issued (quotation sent, invoice posted, contract activated).
export const letterhead = (c = auth.company()) => Object.fromEntries(LETTERHEAD.map(k => [k, c[k] ?? '']));
// The company as a document should show it: its own copy once issued, the live profile while it is a draft.
export const issued = (doc, company) => (doc?.letterhead ? { ...company, ...doc.letterhead } : company);
export const logoSrc = c => (c?.logoId ? store.get('logos', c.logoId)?.dataUrl || '' : '');

export const COMPANY_LABELS = {
  name: 'Company name', country: 'Country', currency: 'Currency', regLabel: 'Registration label', regNo: 'Registration no.', chargesTax: 'Tax on documents',
  taxLabel: 'Tax label', taxRegLabel: 'Tax number label', taxRegNo: 'Tax number', defaultTaxCode: 'Default tax code', address: 'Address', tel: 'Tel',
  mobile: 'Mobile', email: 'Email', bank: 'Bank', payNow: 'PayNow', logoId: 'Logo', workDays: 'Working days', workStart: 'Day starts', workEnd: 'Day ends',
  dpo: 'DPO contact', inspectionTargetHours: 'Inspection target (hours)',
};
export const hasPostedInvoices = () => store.list('invoices', i => !!i.no).length > 0;
export const LOCKED_ONCE_POSTED = ['country', 'currency'];

const show = (k, v) => (k === 'workDays' ? (v || []).map(d => DAY_NAMES[d]).join(' ') : k === 'logoId' ? (v ? 'added' : 'none')
  : ['workStart', 'workEnd'].includes(k) ? fmtHours(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (v ?? '') === '' ? '—' : v);
export const fmtHours = h => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;

// Save the profile. Returns '' or the reason it was refused. Every changed field is written to the audit log.
export function saveCompany(patch) {
  const c = auth.company();
  const changed = Object.keys(patch).filter(k => JSON.stringify(patch[k]) !== JSON.stringify(c[k]));
  if (!changed.length) return '';
  if (changed.some(k => LOCKED_ONCE_POSTED.includes(k)) && hasPostedInvoices()) return 'Country and currency are locked: this company already has posted invoices.';
  if ('name' in patch && !String(patch.name).trim()) return 'The company name is needed.';
  if ('workDays' in patch && !patch.workDays.length) return 'Pick at least one working day.';
  if ('workStart' in patch || 'workEnd' in patch) {
    const s = patch.workStart ?? c.workStart ?? 8.5, e = patch.workEnd ?? c.workEnd ?? 17.5;
    if (e - s < 4) return 'The working day must be at least 4 hours long.';
  }
  const placeholders = (c.placeholders || []).filter(k => !changed.includes(k));
  store.update('companies', c.id, { ...Object.fromEntries(changed.map(k => [k, patch[k]])), placeholders },
    changed.map(k => `${COMPANY_LABELS[k] || k}: ${show(k, c[k])} → ${show(k, patch[k])}`).join('; '));
  return '';
}

export function saveLogo(dataUrl, name, size) {
  const c = auth.company();
  const logo = store.insert('logos', { dataUrl, name, size }, { silent: true });
  store.update('companies', c.id, { logoId: logo.id }, `Logo: ${name}`);
  return logo;
}
export const removeLogo = () => store.update('companies', auth.company().id, { logoId: '' }, 'Logo removed');

// Values still dummy (shown on prints) and things not set up yet: the Admin dashboard's "Setup to finish".
export function setupToFinish(c = auth.company()) {
  const out = (c.placeholders || []).map(k => ({ key: k, text: `${COMPANY_LABELS[k] || k}: ${c[k] || '—'}`, where: ['bank', 'payNow'].includes(k) ? 'on invoices' : 'on every print' }));
  if (!c.logoId) out.push({ key: 'logoId', text: 'No logo yet', where: 'prints show an empty box' });
  return out;
}

// ---------- Terms per document (Transaction Setup calls the term codes; the Terms master keeps the texts) ----------
export const TERM_DOCS = { Quotation: 'Sales Quotation', AMC: 'AMC quotation', Invoice: 'Invoice' };
export function termCodes(docType, c = auth.company()) {
  if (c?.txTerms?.[docType]) return c.txTerms[docType];
  return store.list('terms', t => t.docType === docType && t.status !== 'Inactive').sort((a, b) => (a.order || 0) - (b.order || 0)).map(t => t.code);
}
export const termsFor = docType => termCodes(docType).map(code => store.findOne('terms', t => t.code === code && t.status !== 'Inactive')).filter(Boolean);
export const termTexts = (docType, { validity } = {}) => {
  const c = auth.company();
  return termsFor(docType).map(t => withCompany(t.text, c).replaceAll('{validity}', String(validity ?? '')));
};
export function saveTermCodes(docType, codes) {
  const c = auth.company();
  const before = termCodes(docType);
  if (before.join() === codes.join()) return;
  store.update('companies', c.id, { txTerms: { ...(c.txTerms || {}), [docType]: codes } }, `${TERM_DOCS[docType]} terms: ${before.join(', ') || 'none'} → ${codes.join(', ') || 'none'}`);
}

// Transaction defaults: repair estimates and quotations in txDefaults, AMC and General Servicing in txDefaults.amc.
const TX_LABELS = { costingLevel: 'Costing level', sharedCosts: 'Shared costs', overheadPct: 'Overheads %', marginBasis: 'Margin basis', marginPct: 'Margin %',
  quoteValidityDays: 'Quotation validity days', defaultPaymentTerm: 'Default payment term', visitsPerYear: 'Visits a year', billing: 'Billing',
  periodMonths: 'Contract months', liftHeightM: 'Scissor lift above (m)', renewalDays: 'Renewal reminder days' };
export function saveTxDefaults(patch, group = '') {
  const c = auth.company();
  const cur = group ? (c.txDefaults?.[group] || {}) : (c.txDefaults || {});
  const changed = Object.keys(patch).filter(k => JSON.stringify(patch[k]) !== JSON.stringify(cur[k]));
  if (!changed.length) return;
  const next = group ? { ...c.txDefaults, [group]: { ...cur, ...patch } } : { ...c.txDefaults, ...patch };
  store.update('companies', c.id, { txDefaults: next }, `${group ? 'AMC / GS defaults' : 'Defaults'}: ${changed.map(k => `${TX_LABELS[k] || k} ${cur[k] ?? '—'} → ${patch[k]}`).join('; ')}`);
}

// ---------- Roles and users ----------
const roleRows = roleId => store.list('menuAccess', a => a.roleId === roleId);
// A role that sees only its "own" work needs each user linked to an employee (who the work is assigned to).
export const needsEmployee = roleId => roleRows(roleId).some(a => a.scope === 'own');
export const isAdminRole = r => r?.code === 'ADMIN';
const activeAdmins = () => store.list('users', u => u.status !== 'Inactive' && isAdminRole(store.get('roles', u.roleId)));

// The login card's second line, e.g. "Zone A (also B) · phone only".
export function userHint(u) {
  const rows = roleRows(u.roleId).filter(a => a.menu !== 'dashboard');
  const web = rows.some(a => a.channel !== 'mobile'), phone = rows.some(a => a.channel !== 'web');
  const emp = u.employeeId ? store.get('employees', u.employeeId) : null;
  const zone = id => store.get('zones', id)?.code || '';
  const zones = emp?.mainZoneId ? `Zone ${zone(emp.mainZoneId)}${(emp.extraZoneIds || []).length ? ` (also ${emp.extraZoneIds.map(zone).join(', ')})` : ''} · ` : '';
  return `${zones}${web && phone ? 'web and phone' : phone ? 'phone only' : 'web only'}`;
}

// Open work assigned to an employee: what must move before the user can be deactivated.
export function openWorkOf(employeeId) {
  if (!employeeId) return [];
  const out = [];
  store.list('inspections', i => i.technicianId === employeeId && ['To assign', 'Assigned', 'Report in progress'].includes(i.status)).forEach(i => {
    const e = store.get('enquiries', i.enquiryId);
    out.push({ coll: 'inspections', id: i.id, what: `Site inspection ${e?.no || ''}`, site: e?.siteName || '', zoneId: i.zoneId, at: i.visitAt, movable: i.status === 'Assigned', why: 'The report is in progress' });
  });
  store.list('jobs', j => j.technicianId === employeeId && ['Scheduled', 'On the way', 'On site'].includes(j.status)).forEach(j =>
    out.push({ coll: 'jobs', id: j.id, what: `${j.type === 'GS' ? 'GS job' : 'Repair job'} ${j.no}`, site: j.site || '', zoneId: j.zoneId, at: j.start, movable: j.status === 'Scheduled', why: 'The technician is on the way or on site' }));
  store.list('amcVisits', v => v.technicianId === employeeId && ['Scheduled', 'On the way', 'On site'].includes(v.status)).forEach(v =>
    out.push({ coll: 'amcVisits', id: v.id, what: `AMC visit ${v.contractNo} · ${v.n} of ${v.of}`, site: v.site, zoneId: v.zoneId, at: v.blocks?.[0]?.date, movable: v.status === 'Scheduled', why: 'The technician is on the way or on site' }));
  return out;
}
// Move open work to another technician (same times; the board shows any clash).
export function moveWork(items, toEmployeeId) {
  const to = store.get('employees', toEmployeeId)?.name || '';
  items.forEach(x => store.update(x.coll, x.id, { technicianId: toEmployeeId }, `Moved to ${to} (user deactivated)`));
}

// Save a user (id null = new). Returns { error } or { user }.
export function saveUser(id, { name, roleId, employeeId = '', status = 'Active' }) {
  const before = id ? store.get('users', id) : null;
  const role = store.get('roles', roleId);
  if (!String(name || '').trim()) return { error: 'The name is needed.' };
  if (!role) return { error: 'Pick a role.' };
  if (role.status === 'Inactive') return { error: `The role ${role.name} is inactive.` };
  if (needsEmployee(roleId) && !employeeId) return { error: `${role.name} sees only its own work, so the user must be linked to an employee.` };
  if (employeeId && store.list('users', u => u.id !== id && u.employeeId === employeeId && u.status !== 'Inactive').length) return { error: 'Another active user is already linked to this employee.' };
  if (before && before.status !== 'Inactive' && isAdminRole(store.get('roles', before.roleId)) && (status === 'Inactive' || !isAdminRole(role)) && activeAdmins().length <= 1) return { error: 'This is the last active Admin: it cannot be deactivated or given another role.' };
  if (before && status === 'Inactive' && store.offlineState()?.userId === before.id) return { error: `${before.name}'s phone is offline: it must go back online first, or its changes would never reach the office.` };
  if (before?.employeeId && (employeeId || '') !== before.employeeId && openWorkOf(before.employeeId).length) return { error: `${before.name} still has open work as ${store.get('employees', before.employeeId)?.name}: move it first (set the user Inactive to see it).` };
  if (before && status === 'Inactive' && before.status !== 'Inactive') {
    const left = openWorkOf(before.employeeId);
    if (left.length) return { error: `Move ${left.length} open item${left.length > 1 ? 's' : ''} first.`, work: left };
  }
  const data = { name: name.trim(), roleId, employeeId: employeeId || null, status };
  data.hint = userHint({ ...data });
  if (before) {
    const what = Object.keys(data).filter(k => k !== 'hint' && data[k] !== before[k]).map(k => `${k === 'roleId' ? 'role' : k === 'employeeId' ? 'employee' : k}: ${label(k, before[k])} → ${label(k, data[k])}`);
    return { user: store.update('users', id, data, what.length ? `User ${before.name}: ${what.join('; ')}` : false) };
  }
  const login = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'user';
  return { user: store.insert('users', { ...data, login }, { note: `User ${data.name} added (${role.name})` }) };
}
function label(k, v) {
  if (k === 'roleId') return store.get('roles', v)?.name || '—';
  if (k === 'employeeId') return v ? store.get('employees', v)?.name || v : '—';
  return v || '—';
}

export const DASHBOARDS = [{ value: 'work', label: 'Work queue' }, { value: 'approvals', label: 'Approvals' }, { value: 'management', label: 'Management' }, { value: 'phone', label: 'Phone (today\'s work)' }];

// Save a role (id null = new, copying the menu access of copyFromId). Returns { error } or { role }.
export function saveRole(id, { code, name, description = '', dashboard = 'work', status = 'Active' }, copyFromId = '') {
  const before = id ? store.get('roles', id) : null;
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,10}$/.test(code)) return { error: 'The code is 2 to 10 capital letters, digits or _.' };
  if (!String(name || '').trim()) return { error: 'The name is needed.' };
  if (store.list('roles', r => r.code === code && r.id !== id).length) return { error: `The code ${code} is already used.` };
  if (before && isAdminRole(before) && (code !== 'ADMIN' || status === 'Inactive')) return { error: 'The Admin role is locked.' };
  if (before && status === 'Inactive' && store.list('users', u => u.roleId === id && u.status !== 'Inactive').length) return { error: 'Active users still have this role.' };
  if (before && before.code !== code && store.list('approvalRules', r => r.roleCode === before.code).length) return { error: 'Approval rules use this role code; change the rules first.' };
  const data = { code, name: name.trim(), description, dashboard, status };
  if (before) return { role: store.update('roles', id, data, `Role ${before.name} updated`) };
  const role = store.insert('roles', data, { note: `Role ${data.name} added` });
  if (copyFromId) roleRows(copyFromId).forEach(a => store.insert('menuAccess', { roleId: role.id, menu: a.menu, channel: a.channel, actions: [...a.actions], scope: a.scope }, { silent: true }));
  return { role };
}

// ---------- Menu access ----------
// One role's access as { menuKey: { channel, actions, scope } } (menus set to None are left out).
export const accessOf = roleId => Object.fromEntries(roleRows(roleId).map(a => [a.menu, { channel: a.channel, actions: a.actions, scope: a.scope || 'all' }]));
const CH = { web: 'Web', mobile: 'Mobile', both: 'Both' };
export const describeAccess = x => (x ? `${CH[x.channel]} · ${x.actions.join(', ')}${x.scope === 'own' ? ' · own' : ''}` : 'None');

// What a change would do, before saving: blocking problems and plain consequences.
export function accessImpact(roleId, next) {
  const role = store.get('roles', roleId), cur = accessOf(roleId);
  const problems = [], effects = [];
  if (isAdminRole(role)) problems.push('The Admin role is locked.');
  ['quotation', 'job'].forEach(m => {
    const had = cur[m]?.actions.includes('approve'), has = next[m]?.actions.includes('approve');
    const rules = store.list('approvalRules', r => r.active && r.roleCode === role.code && r.docType === m);
    if (had && !has && rules.length) problems.push(`${MENUS.find(x => x.key === m).label}: Approve is needed by the rule${rules.length > 1 ? 's' : ''} ${rules.map(r => r.code).join(', ')}. Change the rule first.`);
  });
  const users = store.list('users', u => u.roleId === roleId && u.status !== 'Inactive');
  const emps = users.map(u => u.employeeId).filter(Boolean);
  const unlinked = users.filter(u => !u.employeeId);
  if (unlinked.length && Object.values(next).some(x => x?.scope === 'own')) problems.push(`"Own" data needs each user linked to an employee: link ${unlinked.map(u => u.name).join(', ')} in User Role first.`);
  const lost = key => (cur[key] && cur[key].channel !== 'web') && !(next[key] && next[key].channel !== 'web');
  if (lost('amcExecution')) {
    const n = store.list('amcVisits', v => emps.includes(v.technicianId) && ['Scheduled', 'On the way', 'On site'].includes(v.status)).length;
    effects.push(`AMC visits leave the phones of ${users.length} user${users.length === 1 ? '' : 's'}${n ? `, including ${n} booked visit${n > 1 ? 's' : ''}` : ''}. The office still sees them in AMC Scheduling.`);
  }
  if (lost('job')) effects.push(`Repair and GS jobs leave the phones of ${users.length} user${users.length === 1 ? '' : 's'}.`);
  if (lost('inspection')) effects.push(`Site inspections leave the phones of ${users.length} user${users.length === 1 ? '' : 's'}.`);
  MENUS.forEach(m => { if (cur[m.key] && !next[m.key]) effects.push(`${m.label} disappears for ${users.length} user${users.length === 1 ? '' : 's'}; its pages are refused.`); });
  return { problems, effects: [...new Set(effects)].slice(0, 6) };
}

// Save one role's access. next: { menuKey: { channel, actions, scope } | null }.
export function saveAccess(roleId, next) {
  const { problems } = accessImpact(roleId, next);
  if (problems.length) return problems[0];
  const role = store.get('roles', roleId), cur = accessOf(roleId);
  MENUS.forEach(m => {
    const a = cur[m.key], b = next[m.key] || null;
    if (describeAccess(a) === describeAccess(b)) return;
    const summary = `Menu Access · ${role.name} · ${m.label}: ${describeAccess(a)} → ${describeAccess(b)}`;
    const row = store.findOne('menuAccess', x => x.roleId === roleId && x.menu === m.key);
    const rules = MENU_RULES[m.key] || { actions: ['view'] };
    if (!b) { if (row) store.remove('menuAccess', row.id, summary); return; }
    const clean = { channel: rules.phone ? b.channel : 'web', actions: b.actions.filter(x => rules.actions.includes(x)), scope: rules.own ? b.scope : 'all' };
    if (!clean.actions.includes('view')) clean.actions.unshift('view');
    if (row) store.update('menuAccess', row.id, clean, summary);
    else store.insert('menuAccess', { roleId, menu: m.key, ...clean }, { note: summary });
  });
  return '';
}
