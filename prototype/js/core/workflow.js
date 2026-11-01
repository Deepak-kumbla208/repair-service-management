// Approval engine and task list. The rules (Authorization Workflow Master) decide which approval levels a document
// needs: every matching rule adds its level, and rules on the same level become one task for that level's role; any
// one person of that role decides. Approving moves to the next level (or finishes); returning stops with a comment.
// Nobody decides a task for a document they submitted. The same task list carries the technician's leave-site
// requests and the renewal reminders for the Operations Executive.
import * as store from './store.js';
import * as auth from './auth.js';
import { vsLabel } from './lookups.js';

const TEST = {
  eq: (a, b) => a === b, neq: (a, b) => a !== b,
  gt: (a, b) => Number(a) > Number(b), gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b), lte: (a, b) => Number(a) <= Number(b),
};

// The documents that ask for approval in the flows, and the menu whose Approve right their approvers need.
export const DOC_TYPES = { quotation: { label: 'Quotation', menu: 'quotation' }, job: { label: 'Job', menu: 'job' } };
// What a rule can test (picked from a list; no field names to type). Each document type works the facts out.
export const FACTS = [
  { key: 'all', label: 'Every document', type: 'all' },
  { key: 'total', label: 'Total with tax', type: 'money' },
  { key: 'subtotal', label: 'Total before tax', type: 'money' },
  { key: 'marginPct', label: 'Margin on price', type: 'pct' },
  { key: 'paymentTerm', label: 'Payment term', type: 'term' },
  { key: 'jobType', label: 'Job type', type: 'jobType' },
  { key: 'newCustomer', label: 'New customer', type: 'bool' },
];
export const OPS = {
  money: [['gt', 'over'], ['gte', 'at least'], ['lt', 'below']],
  pct: [['lt', 'below'], ['lte', 'at most'], ['gt', 'over']],
  term: [['neq', 'is not'], ['eq', 'is']],
  jobType: [['eq', 'is'], ['neq', 'is not']],
  bool: [['eq', 'is']],
};
export const JOB_TYPES = [{ value: 'REPAIR', label: 'Repair' }, { value: 'AMC', label: 'AMC' }, { value: 'GS', label: 'General Servicing' }];
const providers = {};
export const registerFacts = (docType, fn) => { providers[docType] = fn; };
export const factsOf = (docType, doc) => ({ ...doc, ...(providers[docType]?.(doc) || {}) });

const fmt = n => Number(n).toLocaleString('en-SG', { maximumFractionDigits: 2 });
// The rule's description, written from its condition, e.g. "Margin on price below 15 %".
export function describeRule(rule) {
  const c = rule.condition;
  const doc = DOC_TYPES[rule.docType]?.label.toLowerCase() || 'document';
  if (!c || c.field === 'all') return rule.docType === 'job' ? 'Every payment-term change at acceptance' : `Every ${doc}`;
  const f = FACTS.find(x => x.key === c.field);
  if (!f) return rule.when || '';
  const op = (OPS[f.type] || []).find(([k]) => k === c.op)?.[1] || c.op;
  if (f.type === 'money') return `${f.label} ${op} ${fmt(c.value)}`;
  if (f.type === 'pct') return `${f.label} ${op} ${fmt(c.value)} %`;
  if (f.type === 'term') return `${f.label} ${op} ${vsLabel('PAYMENT_TERMS', c.value) || c.value}`;
  if (f.type === 'jobType') return `${f.label} ${op} ${JOB_TYPES.find(j => j.value === c.value)?.label || c.value}`;
  if (f.type === 'bool') return c.value ? 'New customer' : 'Existing customer';
  return rule.when || '';
}

export const matches = (rule, facts) => !rule.condition || rule.condition.field === 'all' || !!TEST[rule.condition.op]?.(facts[rule.condition.field], rule.condition.value);

// The levels a document needs, lowest first: [{ level, roleCode, rules: [{ code, name }] }]
export const levelsFor = (docType, doc) => levelsWith(store.list('approvalRules'), docType, doc);
// The same with a given set of rules ("Test a document" previews unsaved changes).
export function levelsWith(allRules, docType, doc) {
  const facts = factsOf(docType, doc);
  const rules = allRules.filter(r => r.active && r.docType === docType && matches(r, facts));
  return [...new Set(rules.map(r => r.level))].sort((a, b) => a - b).map(level => {
    const rs = rules.filter(r => r.level === level);
    return { level, roleCode: rs[0].roleCode, rules: rs.map(r => ({ code: r.code, name: r.name })) };
  });
}

const roleName = code => store.findOne('roles', r => r.code === code)?.name || code;

export function openTask(data) {
  return store.insert('tasks', { comment: '', doneAt: null, doneBy: null, ...data }, { status: 'Open', note: `Task: ${data.title}` });
}

// Start the approvals for a document. Returns { levels, task } (task is null when no rule applies).
// info.submittedBy: who submitted the document (that person cannot decide its tasks).
export function startApproval(docType, doc, info) {
  const levels = levelsFor(docType, doc);
  const task = levels.length ? openLevel(docType, doc, levels[0], info) : null;
  return { levels, task };
}

export function openLevel(docType, doc, lvl, info) {
  return openTask({
    kind: 'approval', docType, docId: doc.id, docNo: info.docNo, title: info.title, customer: info.customer || '', amount: info.amount ?? null,
    level: lvl.level, roleCode: lvl.roleCode, roleName: roleName(lvl.roleCode), rules: lvl.rules, submittedBy: info.submittedBy || store.currentActor(),
  });
}

// Why the logged-in user may not decide a task ('' when they may).
export const cannotDecide = t => (t?.kind === 'approval' && t.submittedBy && t.submittedBy === store.currentActor() ? 'You submitted this document, so you cannot decide it. It waits for another person of this role.' : '');

// decision: 'approve' | 'return'. Returns the closed task, or null when it was already closed (a second tap or a
// stale page) or the user may not decide it, so the decision is never applied twice or by the submitter.
export function closeTask(taskId, decision, comment = '') {
  const t = store.get('tasks', taskId);
  if (!t || t.status !== 'Open' || cannotDecide(t)) return null;
  store.update('tasks', taskId, { comment, doneAt: new Date().toISOString(), doneBy: store.currentActor(), decision }, false);
  store.setStatus('tasks', taskId, decision === 'return' ? 'Returned' : 'Done', comment);
  return store.get('tasks', taskId);
}

export function cancelTasksFor(docType, docId, note = 'No longer needed') {
  store.list('tasks', t => t.docType === docType && t.docId === docId && t.status === 'Open').forEach(t => store.setStatus('tasks', t.id, 'Cancelled', note));
}

// Open tasks for the logged-in user: tasks for their role (Admin sees every task).
export function myTasks() {
  const r = auth.role();
  if (!r) return [];
  return store.list('tasks', t => t.status === 'Open' && (r.code === 'ADMIN' || t.roleCode === r.code))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export const myTaskCount = () => myTasks().length;
export const tasksFor = (docType, docId) => store.list('tasks', t => t.docType === docType && t.docId === docId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
export const openTaskFor = (docType, docId, kind = 'approval') => store.findOne('tasks', t => t.docType === docType && t.docId === docId && t.kind === kind && t.status === 'Open');

// ---------- Rules (Authorization Workflow Master) ----------
// Roles that can be named on a rule: those with the Approve right on the document's menu.
export const approverRoles = docType => store.list('roles', r => r.status !== 'Inactive' && store.list('menuAccess', a => a.roleId === r.id && a.menu === DOC_TYPES[docType]?.menu && a.actions.includes('approve')).length);
export const activeUsersOf = roleCode => store.list('users', u => u.status !== 'Inactive' && store.get('roles', u.roleId)?.code === roleCode);

// Save a rule (id null = new). Returns { error } or { rule }. Open tasks keep their levels: the change applies from
// the next submission.
export function saveRule(id, { code, name, docType, level, roleCode, condition, active }) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,16}$/.test(code)) return { error: 'The code is 2 to 16 capital letters, digits or _.' };
  if (store.list('approvalRules', r => r.code === code && r.id !== id).length) return { error: `The code ${code} is already used.` };
  if (!DOC_TYPES[docType]) return { error: 'Pick the document.' };
  if (!(Number(level) >= 1)) return { error: 'Pick a level.' };
  if (!approverRoles(docType).some(r => r.code === roleCode)) return { error: `Pick a role with the Approve right on ${DOC_TYPES[docType].label}.` };
  // Rules on the same level become one task, so a level has one role.
  const other = store.findOne('approvalRules', r => r.id !== id && r.active && r.docType === docType && r.level === Number(level) && r.roleCode !== roleCode);
  if (other && active !== false) return { error: `Level ${level} already goes to ${roleName(other.roleCode)} (rule ${other.code}). Pick that role or another level.` };
  const f = condition?.field && FACTS.find(x => x.key === condition.field);
  if (f && f.type !== 'all' && f.type !== 'bool' && (condition.value === '' || condition.value == null)) return { error: 'Fill in the value of the condition.' };
  const cond = !f || f.type === 'all' ? null : { field: f.key, op: condition.op, value: ['money', 'pct'].includes(f.type) ? Number(condition.value) : f.type === 'bool' ? condition.value === true || condition.value === 'true' : condition.value };
  const data = { code, docType, level: Number(level), roleCode, condition: cond, active: active !== false, mode: 'any' };
  data.when = describeRule(data);
  data.name = String(name || '').trim() || data.when;
  if (id) {
    const before = store.get('approvalRules', id);
    return { rule: store.update('approvalRules', id, data, `Rule ${code}: ${before.when || before.name} · level ${before.level} ${roleName(before.roleCode)}${before.active ? '' : ' (off)'} → ${data.when} · level ${data.level} ${roleName(roleCode)}${data.active ? '' : ' (off)'}`) };
  }
  return { rule: store.insert('approvalRules', data, { note: `Rule ${code} added: ${data.when} · level ${data.level} ${roleName(roleCode)}` }) };
}
