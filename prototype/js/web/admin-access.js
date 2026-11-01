// Menu Access (Admin Setup): one role at a time. Each menu offers only the rights its screens check, Mobile only
// where a phone screen exists, Own only where work is assigned to a person. Before saving, the page says what the
// change will do (core/setup.js accessImpact). It writes the same access rows every page, phone tab and search check.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $, on, toast } from '../core/ui.js';
import { MENUS, GROUPS, MENU_RULES, ACTION_LABELS } from '../data/menus.js';
import { accessOf, accessImpact, saveAccess, describeAccess, isAdminRole } from '../core/setup.js';
import { pageHead } from './shell.js';
import { changesCard } from './admin-company.js';
import { render } from '../app.js';

const state = { roleId: '', draft: null, q: '' };
const COLS = ['view', 'create', 'edit', 'approve', 'print'];
const CHANNELS = [['', 'None'], ['web', 'Web'], ['mobile', 'Mobile'], ['both', 'Both']];

function row(m, cur, saved, locked) {
  const rules = MENU_RULES[m.key] || { actions: ['view'] };
  const changed = describeAccess(cur) !== describeAccess(saved);
  const chan = CHANNELS.filter(([v]) => !v || v === 'web' || rules.phone);
  return html`<tr class="${changed ? 'changed' : ''}" data-menu="${m.key}">
    <td>${m.label}${changed ? html` <span class="pill amber">changed</span>` : ''}${!rules.phone ? html` <span class="muted small">web only</span>` : ''}</td>
    <td><span class="chan">${chan.map(([v, l]) => html`<button type="button" class="${!v ? 'off' : ''} ${(cur?.channel || '') === v ? 'on' : ''}" data-ch="${v}" ${locked ? 'disabled' : ''}>${l}</button>`)}</span></td>
    ${COLS.map(a => rules.actions.includes(a)
      ? html`<td><input type="checkbox" data-act="${a}" ${cur?.actions.includes(a) ? 'checked' : ''} ${!cur || locked || a === 'view' ? 'disabled' : ''} aria-label="${ACTION_LABELS[a]}"></td>`
      : html`<td class="na" title="Not used by this menu">·</td>`)}
    <td>${rules.own ? html`<select data-scope ${!cur || locked ? 'disabled' : ''}><option value="all" ${cur?.scope !== 'own' ? 'selected' : ''}>All</option><option value="own" ${cur?.scope === 'own' ? 'selected' : ''}>Own</option></select>` : html`<span class="na">·</span>`}</td>
    ${changed ? html`<td class="small muted" style="text-align:left">was ${describeAccess(saved)}</td>` : html`<td></td>`}</tr>`;
}

export function renderMenuAccess(el) {
  const roles = store.list('roles', r => r.status !== 'Inactive');
  if (!roles.some(r => r.id === state.roleId)) { state.roleId = (roles.find(r => r.code === 'TECH') || roles[0]).id; state.draft = null; }
  const role = store.get('roles', state.roleId);
  const saved = accessOf(role.id);
  if (!state.draft) state.draft = structuredClone(saved);
  const draft = state.draft;
  const locked = isAdminRole(role) || !auth.can('menuAccess', 'edit');
  const changes = MENUS.filter(m => describeAccess(draft[m.key]) !== describeAccess(saved[m.key])).length;
  const { problems, effects } = changes ? accessImpact(role.id, draft) : { problems: [], effects: [] };
  const users = store.list('users', u => u.roleId === role.id && u.status !== 'Inactive');
  const terms = state.q.toLowerCase();
  const shown = MENUS.filter(m => !terms || m.label.toLowerCase().includes(terms));

  el.innerHTML = String(html`<div class="page" style="max-width:1500px">
    ${pageHead({ crumb: 'Admin Setup', title: 'Menu Access', sub: `${auth.company().name} · ${roles.length} roles · ${MENUS.length} menus`,
      actions: locked ? '' : html`<div class="row">${changes ? html`<button class="btn" id="discard">Discard</button>` : ''}<button class="btn primary" id="save" ${changes && !problems.length ? '' : 'disabled'}>${changes ? `Save ${changes} change${changes > 1 ? 's' : ''}` : 'Save'}</button></div>` })}
    <div class="row" style="margin-bottom:10px;gap:6px"><span class="chips">${roles.map(r => html`<label class="chip"><input type="radio" name="role" value="${r.id}" ${r.id === role.id ? 'checked' : ''}><span>${r.name}${isAdminRole(r) ? ' 🔒' : ''}</span></label>`)}</span>
      <span class="grow"></span><input type="search" class="search" id="q" placeholder="Search menus…" value="${state.q}" style="width:200px"></div>
    <div class="split" style="grid-template-columns:minmax(0,1fr) 320px">
      <div class="tbl-wrap" style="max-height:none"><table class="tbl mx"><thead><tr><th>Menu</th><th>Shows on</th>${COLS.map(a => html`<th>${ACTION_LABELS[a]}</th>`)}<th>Data</th><th></th></tr></thead><tbody>
        ${GROUPS.map(g => { const ms = shown.filter(m => m.group === g); return ms.length ? html`<tr class="grp"><td colspan="9">${g}</td></tr>${ms.map(m => row(m, draft[m.key], saved[m.key], locked))}` : ''; })}
      </tbody></table><p class="mini-note">A dot: the menu does not use that right. Cancelling is part of Edit. "Own": the role sees only work assigned to its users.</p></div>
      <div>
        ${isAdminRole(role) ? html`<div class="note">The Admin role is locked: it always has every menu, on the web and the phone.</div>` : ''}
        ${changes ? html`<div class="card" style="border-color:${problems.length ? '#F09595' : '#F0D9AE'}"><div class="card-head"><h2>Saving ${changes > 1 ? 'these changes' : 'this change'} will</h2></div>
          <ul class="chk">${problems.map(p => html`<li><span class="wn" style="color:var(--red)">✕</span><span>${p}</span></li>`)}${effects.map(x => html`<li><span class="wn">!</span><span>${x}</span></li>`)}
            ${!problems.length && !effects.length ? html`<li><span class="ok">✓</span><span>Change the rights of ${users.length} user${users.length === 1 ? '' : 's'} at once.</span></li>` : ''}</ul></div>` : ''}
        <div class="card"><div class="card-head"><h2>${role.name}</h2></div><div class="small">${role.description}</div>
          <div class="muted small" style="margin-top:6px">${users.length} active user${users.length === 1 ? '' : 's'}: ${users.map(u => u.name).join(', ') || 'none'}</div></div>
        ${changesCard(store.list('audit', a => a.coll === 'menuAccess' && a.summary.startsWith(`Menu Access · ${role.name} ·`)).sort((a, b) => b.at.localeCompare(a.at)))}
      </div>
    </div></div>`);

  const menuOf = t => t.closest('[data-menu]')?.dataset.menu;
  on(el, 'change', '[name=role]', (e, r) => { state.roleId = r.value; state.draft = null; render(); });
  on(el, 'click', '[data-ch]', (e, b) => {
    const key = menuOf(b), v = b.dataset.ch, rules = MENU_RULES[key] || { actions: ['view'] };
    if (!v) delete draft[key];
    else draft[key] = draft[key] ? { ...draft[key], channel: v } : { channel: v, actions: ['view'], scope: rules.own && store.list('menuAccess', a => a.roleId === role.id && a.scope === 'own').length ? 'own' : 'all' };
    render();
  });
  on(el, 'change', '[data-act]', (e, c) => {
    const key = menuOf(c), a = c.dataset.act, x = draft[key];
    x.actions = c.checked ? [...new Set([...x.actions, a])] : x.actions.filter(y => y !== a);
    render();
  });
  on(el, 'change', '[data-scope]', (e, s) => { draft[menuOf(s)].scope = s.value; render(); });
  $('#q', el).addEventListener('change', e => { state.q = e.target.value; render(); });
  $('#discard', el)?.addEventListener('click', () => { state.draft = null; render(); });
  $('#save', el)?.addEventListener('click', () => {
    const err = saveAccess(role.id, draft);
    if (err) { toast(err, 'bad'); return; }
    state.draft = null; toast(`Menu Access saved for ${role.name}`); render();
  });
}
