// Guided demo (Stretch 3 Part B): three walkthroughs for the team lead (Repair, AMC, General Servicing). Each step says
// whom to log in as and what to click; "Go" logs in as that user, in the right view, and opens the right record. A small
// bar at the bottom of the screen keeps the step in view. The walkthroughs use the stage samples of the demo data.
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import { html } from '../core/ui.js';

const KEY = 'rsmGuide';
const OPS = 'usr_co_dsh_ops', APR = 'usr_co_dsh_approver', TA = 'usr_co_dsh_techA', TB = 'usr_co_dsh_techB';
const latest = (coll, enqId) => store.list(coll, r => r.enquiryId === enqId).sort((a, b) => (b.rev || 0) - (a.rev || 0) || b.createdAt.localeCompare(a.createdAt))[0];
const taskOf = (docType, id, kind = 'approval') => store.findOne('tasks', t => t.docType === docType && t.docId === id && t.kind === kind && t.status === 'Open');
const enqRoute = id => `enquiries/${id}`;
const est = id => { const e = latest('estimates', id); return e ? `estimates/${e.id}` : enqRoute(id); };
const qt = id => { const q = latest('quotations', id); return q ? `quotations/${q.id}` : est(id); };
const approve = id => { const q = latest('quotations', id), t = q && taskOf('quotation', q.id); return t ? `tasks/${t.id}` : 'tasks'; };
const job = id => store.findOne('jobs', j => j.enquiryId === id && j.status !== 'Cancelled');
const gsEnq = () => store.findOne('enquiries', e => e.type === 'GS' && e.customerName.startsWith('Demo Cafe') && !e.fromService && e.status !== 'Closed')?.id
  || store.findOne('enquiries', e => e.type === 'GS' && e.customerName.startsWith('Demo Cafe'))?.id;
const contract = id => store.findOne('contracts', c => c.enquiryId === id && c.status !== 'Cancelled');
const visit1 = id => { const c = contract(id); return c && store.list('amcVisits', v => v.contractId === c.id).sort((a, b) => a.n - b.n)[0]; };

// Each step: who, view, what to do, and where "Go" opens (worked out after logging in, from the data as it is then).
const FLOWS = {
  repair: { title: 'Repair', sub: 'enquiry → site report → estimate → quotation → job → payment → closed', steps: [
    { who: OPS, text: 'Open the Kosmic enquiry (site report received) and click "Create estimate".', route: () => enqRoute('enq_co_dsh_3') },
    { who: OPS, text: 'Check the estimate (2,057.83 with GST), click "Create quotation", then "Submit for check".', route: () => est('enq_co_dsh_3') },
    { who: APR, text: 'As the Approver, look at the automatic checks and click "Approve".', route: () => approve('enq_co_dsh_3') },
    { who: OPS, text: 'Click "Send to customer", then "Record acceptance" with a PO number: the job is made.', route: () => qt('enq_co_dsh_3') },
    { who: OPS, text: 'On the job, click "Schedule": the invoice is raised at once because payment is immediate.', route: () => { const j = job('enq_co_dsh_3'); return j ? `jobs/${j.id}` : 'jobs'; } },
    { who: TA, view: 'mobile', text: 'On Technician A\'s phone: On my way → Check in → Works done → Feedback → Sign-off → Payment → Ask the office to leave.', route: () => { const j = job('enq_co_dsh_3'); return j ? `m/rjob/${j.id}` : 'm/jobs'; } },
    { who: OPS, text: 'As the office, give the OK to leave in My tasks.', route: () => { const j = job('enq_co_dsh_3'), t = j && taskOf('job', j.id, 'leaveSite'); return t ? `tasks/${t.id}` : 'tasks'; } },
    { who: TA, view: 'mobile', text: 'Back on the phone: "Check out".', route: () => { const j = job('enq_co_dsh_3'); return j ? `m/rjob/${j.id}/leave` : 'm/jobs'; } },
    { who: OPS, text: 'Job Closure: click "Completed & documented" (it closes, being paid). Then use Linked documents to walk back to the enquiry.', route: () => { const j = job('enq_co_dsh_3'); return j ? `closure/${j.id}` : 'closure'; } },
  ] },
  amc: { title: 'AMC contract', sub: 'BOQ → estimate → quotation → contract → visit → failed item → instalment', steps: [
    { who: OPS, text: 'Open ABC Industries\' AMC enquiry (13 shutters) and click "Create estimate": 5,993.44 with GST, as the Excel.', route: () => enqRoute('enq_co_dsh_1') },
    { who: OPS, text: 'Click "Create quotation", then "Submit for check".', route: () => est('enq_co_dsh_1') },
    { who: APR, text: 'As the Approver, click "Approve" (a 30-day term is approved with it).', route: () => approve('enq_co_dsh_1') },
    { who: OPS, text: '"Send to customer", then "Record acceptance" with a PO: the contract is made as a draft.', route: () => qt('enq_co_dsh_1') },
    { who: OPS, text: 'On the contract, set the start date to today and click "Activate": 4 visits and 12 instalments.', route: () => { const c = contract('enq_co_dsh_1'); return c ? `contracts/${c.id}` : 'contracts'; } },
    { who: OPS, text: 'AMC Scheduling: search "ABC" and click "Confirm & assign" on visit 1 of 4.', route: () => 'amc-scheduling' },
    { who: TA, view: 'mobile', text: 'On Technician A\'s phone (My jobs → Upcoming): On my way → Check in → the check list (fail one item, with a photo) → Sign-off → Check out.', route: () => { const v = visit1('enq_co_dsh_1'); return v ? `m/visit/${v.id}` : 'm/jobs'; } },
    { who: OPS, text: 'AMC Execution: open the visit, see the repair enquiry the failed item made, click "Checked & filed".', route: () => { const v = visit1('enq_co_dsh_1'); return v ? `amc-visits/${v.id}` : 'amc-visits'; } },
    { who: OPS, text: 'Open the first instalment (Draft invoice in Linked documents), "Post invoice", then "Record payment".', route: () => { const c = contract('enq_co_dsh_1'), i = c && store.list('invoices', x => x.contractId === c.id && x.status !== 'Cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]; return i ? `invoices/${i.id}` : 'invoices'; } },
    { who: OPS, text: 'The contract page counts visits done, instalments and money paid; "Workflow" shows the whole AMC.', route: () => { const c = contract('enq_co_dsh_1'); return c ? `contracts/${c.id}` : 'contracts'; } },
  ] },
  gs: { title: 'General Servicing', sub: 'one-off service, paid on site', steps: [
    { who: OPS, text: 'Open Demo Cafe\'s servicing enquiry: "Create estimate", "Create quotation", "Submit for check".', route: () => enqRoute(gsEnq()) },
    { who: APR, text: 'As the Approver, click "Approve".', route: () => approve(gsEnq()) },
    { who: OPS, text: '"Send to customer", then "Record acceptance": a General Servicing job is made.', route: () => qt(gsEnq()) },
    { who: OPS, text: 'On the job, click "Schedule" (payment is immediate, so the invoice is raised).', route: () => { const j = job(gsEnq()); return j ? `jobs/${j.id}` : 'jobs'; } },
    { who: TB, view: 'mobile', text: 'On Technician B\'s phone: the check list ("All pass"), sign-off, payment on site, check out.', route: () => { const j = job(gsEnq()); return j ? `m/gjob/${j.id}` : 'm/jobs'; } },
    { who: OPS, text: 'Job Closure: "Completed & documented"; it closes because it is paid.', route: () => { const j = job(gsEnq()); return j ? `closure/${j.id}` : 'closure'; } },
    { who: OPS, text: 'The enquiry register shows the whole row filled in; the enquiry\'s Workflow shows every box done.', route: () => enqRoute(gsEnq()) },
  ] },
};

const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
const write = g => (g ? sessionStorage.setItem(KEY, JSON.stringify(g)) : sessionStorage.removeItem(KEY));
export const startGuide = flow => write({ flow, step: 0 });

// The card on the login page.
export function guideCard() {
  return html`<div class="card guide-card"><div class="card-head"><h2>Guided demo</h2><span class="muted small">3 walkthroughs · about 10 minutes each</span></div>
    <table class="tbl"><tbody>${Object.entries(FLOWS).map(([k, f]) => html`<tr><td class="w"><b>${f.title}</b><br><span class="muted small">${f.sub}</span></td><td class="num">${f.steps.length} steps</td>
      <td style="text-align:right"><button class="btn small primary" data-guide="${k}">Start</button></td></tr>`)}</tbody></table>
    <p class="mini-note">Each step says whom to log in as; "Go" does it for you. Your data stays in this browser and nobody else sees your changes; "Reset demo data" starts again from the beginning.</p></div>`;
}

// Log in as the step's user and open its page.
export function goStep() {
  const g = read(); if (!g) return;
  const s = FLOWS[g.flow].steps[g.step];
  auth.login(s.who, s.view || 'web');
  location.hash = `#/${s.route()}`;
}

// The bar at the bottom of the screen (web, phone and login), drawn after every render.
export function drawGuideBar() {
  let bar = document.getElementById('guideBar');
  const g = read();
  if (!g || !FLOWS[g.flow]) { bar?.remove(); return; }
  const f = FLOWS[g.flow], s = f.steps[g.step];
  const who = store.all('users').find(u => u.id === s.who)?.name || '';
  if (!bar) { bar = document.createElement('div'); bar.id = 'guideBar'; bar.className = 'guide-bar'; document.body.appendChild(bar); }
  bar.innerHTML = String(html`<div class="grow"><b>Guided demo · ${f.title} · step ${g.step + 1} of ${f.steps.length}</b><br>
    <span>${who}${s.view === 'mobile' ? ' (phone)' : ''}: ${s.text}</span></div>
    <button class="btn small" data-g="back" ${g.step ? '' : 'disabled'}>Back</button><button class="btn small primary" data-g="go">Go</button>
    <button class="btn small" data-g="next">${g.step < f.steps.length - 1 ? 'Next' : 'Finish'}</button><button class="btn small link" data-g="stop" title="Stop the guided demo">✕</button>`);
  bar.onclick = e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    const a = b.dataset.g;
    if (a === 'stop' || (a === 'next' && g.step >= f.steps.length - 1)) { write(null); bar.remove(); return; }
    if (a === 'go') return goStep();
    write({ ...g, step: g.step + (a === 'next' ? 1 : -1) });
    drawGuideBar();
  };
}
