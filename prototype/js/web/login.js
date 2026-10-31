// Login screen with demo users (no passwords in the prototype). Choose the company and the view
// (Web or Mobile) first; the Mobile choice shows the login inside the phone frame.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html, $$, confirmBox } from '../core/ui.js';
import { resetDemo } from '../app.js';

const initials = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function choices(coId, view) {
  const companies = store.all('companies');
  const roles = store.all('roles');
  const users = store.all('users').filter(u => u.tenantId === coId);
  const co = companies.find(c => c.id === coId);
  return html`
    <div class="field-label" style="margin-bottom:4px">Company</div>
    <div class="seg" style="margin-bottom:12px">${companies.map(c => html`<button data-co="${c.id}" class="${c.id === coId ? 'on' : ''}">${c.name}</button>`)}</div>
    <div class="field-label" style="margin-bottom:4px">Open in</div>
    <div class="seg"><button data-view="web" class="${view === 'web' ? 'on' : ''}">Web (office)</button><button data-view="mobile" class="${view === 'mobile' ? 'on' : ''}">Mobile (phone)</button></div>
    <p class="muted small" style="margin:12px 0 0">${co.country} · ${co.currency}. Each company has its own users, masters and data. Pick a user to log in:</p>
    <div class="user-grid">${users.map(u => {
      const r = roles.find(x => x.id === u.roleId);
      return html`<button class="user-card" data-user="${u.id}"><span class="avatar">${initials(u.name)}</span>
        <span><b>${u.name}</b><br><span class="small muted">${r?.name} · ${u.hint}</span></span></button>`;
    })}</div>
    <p style="margin-top:16px"><button class="btn link" id="reset">Reset demo data</button></p>`;
}

export function renderLogin(app) {
  const companies = store.all('companies');
  const coId = companies.some(c => c.id === sessionStorage.getItem('rsmLoginCompany')) ? sessionStorage.getItem('rsmLoginCompany') : companies[0].id;
  const view = sessionStorage.getItem('rsmLoginView') === 'mobile' ? 'mobile' : 'web';

  if (view === 'web') {
    app.innerHTML = String(html`<div class="login">
      <aside class="login-side">
        <div class="brand" style="color:#fff;width:auto"><span class="brand-mark" style="background:#185FA5">RSM</span> Repair &amp; Service Management</div>
        <h1>Enquiry to payment, for repair and maintenance companies</h1>
        <ul><li>Repair, AMC and General Servicing jobs</li><li>Web for the office, phone for technicians</li><li>Menus and data follow each user's role</li></ul>
        <p class="small" style="margin-top:auto">Prototype with sample test data. Data stays in this browser; nothing is sent anywhere.</p>
      </aside>
      <main class="login-main"><div class="login-card"><h1 style="margin-bottom:14px">Log in as a demo user</h1>${choices(coId, view)}</div></main>
    </div>`);
  } else {
    app.innerHTML = String(html`<div class="mobile-stage"><div class="phone">
      <div class="m-head"><div class="m-status"><span>9:41</span><span>▂▄▆ ▮</span></div><div class="m-titlebar"><h1>Repair &amp; Service · Log in</h1></div></div>
      <div class="m-body m-login">${choices(coId, view)}</div>
    </div></div>`);
  }

  $$('[data-co]', app).forEach(b => b.onclick = () => { sessionStorage.setItem('rsmLoginCompany', b.dataset.co); renderLogin(app); });
  $$('[data-view]', app).forEach(b => b.onclick = () => { sessionStorage.setItem('rsmLoginView', b.dataset.view); renderLogin(app); });
  $$('[data-user]', app).forEach(b => b.onclick = () => {
    auth.login(b.dataset.user, view);
    location.hash = view === 'mobile' ? '#/m/home' : '#/home';
  });
  app.querySelector('#reset').onclick = async () => {
    if (await confirmBox('Reset demo data', 'All changes and photos will be removed and the sample data restored.', 'Reset')) resetDemo();
  };
}
