// Login session, roles and menu access. Access rows give, per role and menu:
// channel (web / mobile / both), actions (view, create, edit, cancel, approve, print) and data scope (own / all).
import * as store from './store.js';
import { MENUS, MOBILE_TABS } from '../data/menus.js';

let sess = null;

function applyContext() {
  store.setContext(sess ? { tenantId: sess.tenantId, userId: sess.userId } : {});
}

export function restore() {
  sess = store.readSession();
  if (sess && !store.all('users').some(u => u.id === sess.userId)) sess = null;
  applyContext();
  return sess;
}

export function login(userId, view = 'web') {
  const u = store.all('users').find(x => x.id === userId);
  sess = { userId, tenantId: u.tenantId, view };
  store.writeSession(sess);
  applyContext();
  store.audit('login', 'users', userId, `Logged in (${view} view)`);
}

export function logout() {
  sess = null;
  store.writeSession(null);
  applyContext();
}

export const session = () => sess;
export const view = () => sess?.view || 'web';
export function setView(v) {
  if (!sess) return;
  sess.view = v;
  store.writeSession(sess);
}

export const user = () => (sess ? store.all('users').find(u => u.id === sess.userId) : null);
export const company = () => (sess ? store.all('companies').find(c => c.id === sess.tenantId) : null);
export const role = () => (sess ? store.get('roles', user().roleId) : null);
export const employee = () => (user()?.employeeId ? store.get('employees', user().employeeId) : null);
export const userName = id => store.all('users').find(u => u.id === id)?.name || '';

function accessRow(menuKey) {
  const r = role();
  return r ? store.findOne('menuAccess', a => a.roleId === r.id && a.menu === menuKey) : null;
}

export function can(menuKey, action = 'view', channel = view()) {
  const a = accessRow(menuKey);
  if (!a || (a.channel !== 'both' && a.channel !== channel)) return false;
  return a.actions.includes(action);
}

// 'own' means the user sees only records assigned to them (technicians).
export const scope = menuKey => accessRow(menuKey)?.scope || 'all';

export const webMenus = () => MENUS.filter(m => can(m.key, 'view', 'web'));

// Tasks: approvers, and roles that confirm technicians' leave-site requests (job edit on all data).
export const hasTasks = (channel = view()) => can('quotation', 'approve', channel) || can('job', 'approve', channel) || (can('job', 'edit', channel) && scope('job') !== 'own');

export function mobileTabs() {
  return MOBILE_TABS.filter(t => (t.key === 'tasks' ? hasTasks('mobile') : !t.needs || t.needs.some(k =>
    can(k, t.action || 'view', 'mobile') && (!t.ownOnly || scope(k) === 'own'))));
}

// Users of this company whose role may do an action on a menu (web or phone), e.g. who may record an enquiry.
export function usersWhoCan(menuKey, action) {
  const t = sess?.tenantId;
  const roleIds = store.list('menuAccess', a => a.menu === menuKey && a.actions.includes(action)).map(a => a.roleId);
  return store.all('users').filter(u => u.tenantId === t && u.status !== 'Inactive' && roleIds.includes(u.roleId));
}

// Row-level check for site inspections and their reports.
export function seesInspection(insp) {
  return scope('inspection') !== 'own' || insp.technicianId === user()?.employeeId;
}
