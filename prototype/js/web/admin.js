// Admin Setup pages (Stretch 3 Part B): Company Setup, Transaction Setup, User Role, Menu Access and the
// Authorization Workflow Master. Each page checks its own Edit right; without it the page is read-only.
import { html } from '../core/ui.js';
import { menuByKey } from '../data/menus.js';
import { renderCompanySetup } from './admin-company.js';
import { renderTxSetup } from './admin-tx.js';
import { renderUserRole } from './admin-users.js';
import { renderMenuAccess } from './admin-access.js';
import { renderRules } from './admin-rules.js';
import { pageHead } from './shell.js';

const PAGES = { companySetup: renderCompanySetup, transactionSetup: renderTxSetup, userRole: renderUserRole, menuAccess: renderMenuAccess, authWorkflow: renderRules };

export function renderAdmin(el, key) {
  if (PAGES[key]) return PAGES[key](el);
  return renderSoon(el, key);
}

export function renderSoon(el, key) {
  const m = menuByKey(key);
  el.innerHTML = String(html`<div class="page">${pageHead({ crumb: m?.group || '', title: m?.label || key })}
    <div class="card" style="max-width:640px"><p>This screen is not part of the prototype.</p></div></div>`);
}
