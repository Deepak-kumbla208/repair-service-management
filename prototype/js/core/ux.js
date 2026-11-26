// UX audit (26 Nov 2026). Two things live here:
// 1. The four changes that need the team lead's agreement (wave 3). Each is a switch in Company Setup → "Working
//    style", on by default, so the old behaviour is one click away:
//      jobPage         one page per job holding every document as a section (off: one page per document)
//      plainMenus      menu names in plain words (off: the names in the team lead's menu file)
//      autoLeave       the app gives the leave-site OK itself when its checks pass (off: the office always decides)
//      approvalByRule  a quotation is approved only over a limit or with a payment term that is not Immediate
//                      (off: every quotation is counter-checked)
// 2. The warning before leaving a page with unsaved work (finding 15).
import * as store from './store.js';
import * as auth from './auth.js';

export const UX_DEFAULTS = { jobPage: true, plainMenus: true, autoLeave: true, approvalByRule: true, approvalLimit: 5000 };
export const UX_SWITCHES = [
  { key: 'jobPage', label: 'One page per job', on: 'Every document of a job (site report, estimate, quotation, job, invoice) is a section of one page.', off: 'Each document opens on its own page, under its own menu.' },
  { key: 'plainMenus', label: 'Menu names in plain words', on: 'Enquiries, Estimates, Jobs and schedule, Maintenance contracts (AMC), Drop-down lists, Approval rules …', off: 'The names in the menu file: Sales Enquiry, Estimation, Job Execution, AMC Contract, Value Set Master …' },
  { key: 'autoLeave', label: 'Leave-site OK given by the app', on: 'The technician may leave when the checks pass (form signed, photos taken, payment recorded). The office is asked only when one fails.', off: 'The office gives the OK for every job before the technician leaves.' },
  { key: 'approvalByRule', label: 'Approval only when a rule asks for it', on: 'A quotation goes to the Approver only when its total is over the limit below or its payment term is not Immediate.', off: 'Every quotation is checked by the Approver before it is sent.' },
];
// The sample data (and its 12 months of history) is built the way the flow chart has it: every quotation approved,
// every leave-site OK given by the office. The working style applies to what people do after that.
let building = false;
export const buildingSamples = on => { building = !!on; };
export const ux = (c = auth.company()) => ({ ...UX_DEFAULTS, ...(c?.ux || {}), ...(building ? { approvalByRule: false, autoLeave: false } : {}) });
export function saveUx(patch) {
  const c = auth.company();
  const next = { ...ux(c), ...patch };
  const words = UX_SWITCHES.filter(s => s.key in patch && ux(c)[s.key] !== next[s.key]).map(s => `${s.label}: ${next[s.key] ? 'on' : 'off'}`);
  if ('approvalLimit' in patch && Number(ux(c).approvalLimit) !== Number(next.approvalLimit)) words.push(`Approval limit: ${next.approvalLimit}`);
  store.update('companies', c.id, { ux: next }, words.length ? `Working style · ${words.join(', ')}` : false);
  return next;
}

// ---------- Unsaved work ----------
let dirtyHash = '';
export const isDirty = () => !!dirtyHash;
export const dirtyAt = () => dirtyHash;
export const clearDirty = () => { dirtyHash = ''; };
export const setDirty = () => { dirtyHash = location.hash; };
// Any typing or change inside root marks the page as holding unsaved work; saving (or Cancel) calls clearDirty().
// Search boxes and list filters are not work to lose.
export function trackDirty(root) {
  if (!root || root.dataset.dirtyTracked) return;
  root.dataset.dirtyTracked = '1';
  const mark = e => { if (e.isTrusted !== false && !e.target.closest?.('[data-nodirty], .filters, #uxCard, input[type=search]')) setDirty(); };
  root.addEventListener('input', mark);
  root.addEventListener('change', mark);
}
// Every page with a Save button is watched (called by the web shell after each draw): typing marks it, a Save that
// leaves no error on the page clears it, and so does Cancel.
export function watchSaves(content) {
  const save = content.querySelector('.page-head #save, .page-head #saveBtn');
  const page = save?.closest('.page');
  if (!page || page.dataset.dirtyTracked) return;
  trackDirty(page);
  save.addEventListener('click', () => setTimeout(() => { if (!content.querySelector('.err[data-err], .invalid') && !document.querySelector('.toast.bad')) clearDirty(); }, 0));
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-discard], .page-head a.btn, .page-head button.btn');
    if (b && (b.matches('[data-discard]') || /^(cancel|discard)/i.test(b.textContent.trim()))) clearDirty();
  }, true);
}
