// Approval engine and task list. Preset rules (data/seed-stretch2.js) decide which approval levels a document needs:
// every matching rule adds its level, and rules on the same level become one task for that level's role.
// Approving moves to the next level (or finishes); returning stops with a comment.
// The same task list carries the technician's leave-site requests for the Operations Executive.
// Editing the rules is the Stretch 3 "Authorization Workflow Master" screen.
import * as store from './store.js';
import * as auth from './auth.js';

const TEST = {
  eq: (a, b) => a === b, neq: (a, b) => a !== b,
  gt: (a, b) => Number(a) > Number(b), gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b), lte: (a, b) => Number(a) <= Number(b),
};
const matches = (rule, doc) => !rule.condition || !!TEST[rule.condition.op]?.(doc[rule.condition.field], rule.condition.value);

// The levels a document needs, lowest first: [{ level, roleCode, rules: [{ code, name }] }]
export function levelsFor(docType, doc) {
  const rules = store.list('approvalRules', r => r.active && r.docType === docType && matches(r, doc));
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
export function startApproval(docType, doc, info) {
  const levels = levelsFor(docType, doc);
  const task = levels.length ? openLevel(docType, doc, levels[0], info) : null;
  return { levels, task };
}

export function openLevel(docType, doc, lvl, info) {
  return openTask({
    kind: 'approval', docType, docId: doc.id, docNo: info.docNo, title: info.title, customer: info.customer || '', amount: info.amount ?? null,
    level: lvl.level, roleCode: lvl.roleCode, roleName: roleName(lvl.roleCode), rules: lvl.rules,
  });
}

// decision: 'approve' | 'return'. Returns the closed task, or null when it was already closed
// (a second tap or a stale page), so the decision is never applied twice.
export function closeTask(taskId, decision, comment = '') {
  const t = store.get('tasks', taskId);
  if (!t || t.status !== 'Open') return null;
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
