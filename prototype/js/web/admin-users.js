// User Role (Admin Setup): Users and Roles. A role that sees only its own work needs each user linked to an employee;
// deactivating a user first moves their open inspections, jobs and visits; the Admin role is locked and the last active
// Admin cannot be deactivated. New users appear on the login screen at once (no passwords in the prototype).
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, toast, chipGroup, fmtDateTime, pill } from '../core/ui.js';
import { technicians, zoneCode } from '../core/lookups.js';
import { saveUser, saveRole, needsEmployee, openWorkOf, moveWork, isAdminRole, DASHBOARDS } from '../core/setup.js';
import { pageHead } from './shell.js';
import { changesCard } from './admin-company.js';
import { render } from '../app.js';

const TAB_KEY = 'rsmUserTab';
const state = { userId: '', roleId: '', moving: null };

function userForm(u, edit) {
  const roles = store.list('roles', r => r.status !== 'Inactive' || r.id === u?.roleId);
  const emps = store.list('employees', e => e.status !== 'Inactive');
  const roleId = u?.roleId || roles.find(r => r.code === 'TECH')?.id || roles[0]?.id;
  const ro = !edit || (u && isAdminRole(store.get('roles', u.roleId)) && u.id === auth.user().id);
  return html`<form class="card form-lines fcols" id="uf" onsubmit="return false">
    <div class="form-sec">${u ? `User · ${u.name}` : 'New user'}</div>
    <div class="field"><label for="u-name">Name <span class="req">*</span></label><input type="text" id="u-name" name="name" value="${u?.name || ''}" ${!edit ? 'readonly' : ''}></div>
    <div class="field"><label for="u-role">Role <span class="req">*</span></label><select id="u-role" name="roleId" ${ro ? 'disabled' : ''}>${roles.map(r => html`<option value="${r.id}" ${r.id === roleId ? 'selected' : ''}>${r.name}</option>`)}</select>
      <div class="hint" id="roleHint"></div></div>
    <div class="field"><label for="u-emp">Employee</label><select id="u-emp" name="employeeId" ${!edit ? 'disabled' : ''}><option value="">—</option>${emps.map(e => html`<option value="${e.id}" ${e.id === u?.employeeId ? 'selected' : ''}>${e.code} · ${e.name}${e.mainZoneId ? ` · Zone ${zoneCode(e.mainZoneId)}` : ''}</option>`)}</select>
      <div class="hint" id="empHint"></div></div>
    <div class="field"><label>Status</label>${chipGroup('status', ['Active', 'Inactive'], u?.status || 'Active', !edit || (u && u.id === auth.user().id))}</div>
    ${edit ? html`<div class="row" style="margin-top:10px"><button type="button" class="btn primary" id="saveUser">Save user</button>${u ? html`<button type="button" class="btn" id="newUser">New user</button>` : ''}</div>` : ''}
    <p class="mini-note">No passwords in the prototype: users log in by choosing their card on the login screen.</p></form>`;
}

function movingCard(m) {
  const techs = technicians().filter(t => t.id !== m.employeeId);
  const movable = m.work.filter(x => x.movable), stuck = m.work.filter(x => !x.movable);
  return html`<div class="card" style="border-color:#F0D9AE"><div class="card-head"><h2>${m.name} has open work</h2><span class="muted small">move it before deactivating</span></div>
    <table class="tbl"><thead><tr><th>Work</th><th>Site</th><th>Date</th><th>Move to</th></tr></thead><tbody>
      ${m.work.map((x, i) => html`<tr><td>${x.what}</td><td>${x.site} ${x.zoneId ? html`<span class="zone-chip">${zoneCode(x.zoneId)}</span>` : ''}</td><td>${x.at ? fmtDateTime(x.at).slice(0, 11) : '—'}</td>
        <td>${x.movable ? html`<select data-move="${i}">${techs.map(t => html`<option value="${t.id}" ${t.mainZoneId === x.zoneId ? 'selected' : ''}>${t.name} · Zone ${zoneCode(t.mainZoneId)}</option>`)}</select>` : html`<span class="muted small">${x.why}: finish it first</span>`}</td></tr>`)}
    </tbody></table>
    <div class="row" style="margin-top:8px">${movable.length && !stuck.length ? html`<button class="btn primary" id="doMove">Move ${movable.length} and deactivate</button>` : ''}<button class="btn" id="noMove">Keep the user active</button>
      ${stuck.length ? html`<span class="muted small">${stuck.length} item${stuck.length > 1 ? 's' : ''} must be finished first.</span>` : ''}</div></div>`;
}

function roleForm(r, edit) {
  const roles = store.list('roles');
  const locked = isAdminRole(r);
  return html`<form class="card form-lines fcols" id="rf" onsubmit="return false">
    <div class="form-sec">${r ? `Role · ${r.name}` : 'New role'}</div>
    <div class="field"><label for="r-code">Code <span class="req">*</span></label><input type="text" id="r-code" name="code" value="${r?.code || ''}" ${!edit || locked ? 'readonly' : ''}></div>
    <div class="field"><label for="r-name">Role <span class="req">*</span></label><input type="text" id="r-name" name="name" value="${r?.name || ''}" ${!edit ? 'readonly' : ''}></div>
    <div class="field"><label for="r-desc">What it does</label><input type="text" id="r-desc" name="description" value="${r?.description || ''}" ${!edit ? 'readonly' : ''}></div>
    <div class="field"><label>Dashboard</label>${chipGroup('dashboard', DASHBOARDS, r?.dashboard || 'work', !edit)}</div>
    ${r ? '' : html`<div class="field"><label for="r-copy">Copy access from</label><select id="r-copy" name="copyFrom">${roles.map(x => html`<option value="${x.id}">${x.name}</option>`)}</select><div class="hint">Change it later in Menu Access</div></div>`}
    <div class="field"><label>Status</label>${chipGroup('status', ['Active', 'Inactive'], r?.status || 'Active', !edit || locked)}</div>
    ${edit ? html`<div class="row" style="margin-top:10px"><button type="button" class="btn primary" id="saveRole">Save role</button>${r ? html`<button type="button" class="btn" id="newRole">New role</button>` : ''}</div>` : ''}
    ${locked ? html`<p class="mini-note">The Admin role is locked: it always has every menu.</p>` : ''}</form>`;
}

export function renderUserRole(el) {
  const edit = auth.can('userRole', 'edit');
  const tab = sessionStorage.getItem(TAB_KEY) === 'roles' ? 'roles' : 'users';
  const users = store.list('users'), roles = store.list('roles');
  const u = users.find(x => x.id === state.userId) || null;
  const r = roles.find(x => x.id === state.roleId) || null;
  const roleName = id => store.get('roles', id)?.name || '—';
  const audit = store.list('audit', a => (a.coll === 'users' || a.coll === 'roles') && a.action !== 'login').sort((a, b) => b.at.localeCompare(a.at));

  el.innerHTML = String(html`<div class="page">
    ${pageHead({ crumb: 'Admin Setup', title: 'User Role', sub: `${auth.company().name} · ${users.length} users · ${roles.length} roles` })}
    <div class="etabs"><button data-tab="users" class="${tab === 'users' ? 'on' : ''}">Users (${users.length})</button><button data-tab="roles" class="${tab === 'roles' ? 'on' : ''}">Roles (${roles.length})</button></div>
    <div class="stack">
        ${tab === 'users' ? html`${state.moving ? movingCard(state.moving) : ''}
          <div class="card"><table class="tbl"><thead><tr><th>User</th><th>Role</th><th>Employee</th><th>Works on</th><th>Status</th></tr></thead><tbody>
            ${users.map(x => { const e = x.employeeId ? store.get('employees', x.employeeId) : null; return html`<tr class="click ${x.id === state.userId ? 'sel' : ''}" data-user="${x.id}">
              <td>${x.name}</td><td>${roleName(x.roleId)}${isAdminRole(store.get('roles', x.roleId)) ? ' 🔒' : ''}</td><td>${e ? `${e.code} · ${e.name}` : html`<span class="muted">—</span>`}</td><td>${x.hint || ''}</td><td>${pill(x.status || 'Active', x.status === 'Inactive' ? '' : 'green')}</td></tr>`; })}
          </tbody></table></div>`
        : html`<div class="card"><table class="tbl"><thead><tr><th>Code</th><th>Role</th><th>What it does</th><th>Dashboard</th><th class="num">Users</th><th>Status</th></tr></thead><tbody>
            ${roles.map(x => html`<tr class="click ${x.id === state.roleId ? 'sel' : ''}" data-role="${x.id}"><td>${x.code}</td><td>${x.name}${isAdminRole(x) ? ' 🔒' : ''}</td><td class="wrap">${x.description}</td>
              <td>${DASHBOARDS.find(d => d.value === x.dashboard)?.label || '—'}</td><td class="num">${users.filter(y => y.roleId === x.id && y.status !== 'Inactive').length}</td><td>${pill(x.status || 'Active', x.status === 'Inactive' ? '' : 'green')}</td></tr>`)}
          </tbody></table><p class="mini-note">"+ New role" copies the menu access of a role you pick; a role in use can be made inactive only when no active user has it.</p></div>`}
        ${tab === 'users' ? userForm(u, edit) : roleForm(r, edit)}
        ${changesCard(audit)}
    </div></div>`);

  const hints = () => {
    const f = $('#uf', el);
    if (!f) return;
    const rid = $('[name=roleId]', f).value;
    $('#roleHint', el).textContent = store.get('roles', rid)?.description || '';
    $('#empHint', el).textContent = needsEmployee(rid) ? 'Needed: this role sees only its own work' : 'Optional';
  };
  hints();
  $('#uf', el)?.addEventListener('change', hints);
  on(el, 'click', '[data-tab]', (e, b) => { sessionStorage.setItem(TAB_KEY, b.dataset.tab); state.moving = null; render(); });
  on(el, 'click', '[data-user]', (e, tr) => { state.userId = tr.dataset.user; state.moving = null; render(); });
  on(el, 'click', '[data-role]', (e, tr) => { state.roleId = tr.dataset.role; render(); });
  $('#newUser', el)?.addEventListener('click', () => { state.userId = ''; state.moving = null; render(); });
  $('#newRole', el)?.addEventListener('click', () => { state.roleId = ''; render(); });
  $('#saveUser', el)?.addEventListener('click', () => {
    const f = $('#uf', el);
    const data = { name: $('[name=name]', f).value, roleId: $('[name=roleId]', f).value, employeeId: $('[name=employeeId]', f).value, status: $('[name=status]:checked', f)?.value || 'Active' };
    const res = saveUser(u?.id || null, data);
    if (res.work) { state.moving = { userId: u.id, name: u.name, employeeId: u.employeeId, work: res.work, data }; render(); return; }
    if (res.error) { toast(res.error, 'bad'); return; }
    state.userId = res.user.id; state.moving = null;
    toast(u ? `${res.user.name} saved` : `${res.user.name} added: the card is on the login screen`); render();
  });
  $('#doMove', el)?.addEventListener('click', () => {
    const m = state.moving;
    const picks = [...el.querySelectorAll('[data-move]')].map(s => ({ item: m.work[Number(s.dataset.move)], to: s.value }));
    picks.forEach(p => moveWork([p.item], p.to));
    const res = saveUser(m.userId, m.data);
    if (res.error) { toast(res.error, 'bad'); state.moving = res.work ? { ...m, work: res.work } : null; render(); return; }
    state.moving = null; toast(`Work moved; ${m.name} is inactive`); render();
  });
  $('#noMove', el)?.addEventListener('click', () => { state.moving = null; render(); });
  $('#saveRole', el)?.addEventListener('click', () => {
    const f = $('#rf', el);
    const data = { code: $('[name=code]', f).value, name: $('[name=name]', f).value, description: $('[name=description]', f).value, dashboard: $('[name=dashboard]:checked', f)?.value, status: $('[name=status]:checked', f)?.value || 'Active' };
    const res = saveRole(r?.id || null, data, $('[name=copyFrom]', f)?.value || '');
    if (res.error) { toast(res.error, 'bad'); return; }
    state.roleId = res.role.id; toast(r ? `${res.role.name} saved` : `${res.role.name} added: set its menus in Menu Access`); render();
  });
}
