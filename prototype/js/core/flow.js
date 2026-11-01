// Transaction-wise workflow of an enquiry (the "Workflow" button): one box per transaction,
// with the current one marked "now". Stretch 2 fills the repair boxes after the site inspection; Stretch 3 the AMC
// boxes (contract, visits, instalment invoices, payment, contract closure). General Servicing uses the job boxes.
import * as store from './store.js';
import { empName } from './lookups.js';
import { contractFor, contractProgress } from './contracts.js';
import { fmtDate } from './ui.js';

const FLOWS = {
  REPAIR: ['enquiry', 'inspection', 'estimation', 'quotation', 'job', 'invoice', 'payment', 'closure'],
  AMC: ['enquiry', 'inspection', 'estimation', 'quotation', 'amcContract', 'amcVisits', 'invoice', 'payment', 'contractClosure'],
  GS: ['enquiry', 'inspection', 'estimation', 'quotation', 'job', 'invoice', 'payment', 'closure'],
};
const NAMES = {
  enquiry: 'Enquiry', inspection: 'Site inspection', estimation: 'Estimation', quotation: 'Quotation', job: 'Job',
  amcContract: 'AMC contract', amcVisits: 'AMC visits', invoice: 'Invoice', payment: 'Payment', closure: 'Job closure', contractClosure: 'Contract closure',
};

const latest = (coll, enqId) => store.list(coll, r => r.enquiryId === enqId && r.status !== 'Superseded').sort((a, b) => (b.rev || 0) - (a.rev || 0))[0] || null;
const paidOf = inv => store.list('payments', p => p.invoiceId === inv.id).reduce((t, p) => t + Number(p.amount || 0), 0);
const money = n => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// state: done | now | next | skip
export function stagesFor(enq) {
  const steps = (FLOWS[enq.type] || FLOWS.REPAIR).map(key => ({ key, name: NAMES[key], doc: '', status: '', state: 'next', route: null }));
  const by = key => steps.find(s => s.key === key);
  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const report = insp?.reportId ? store.get('siteReports', insp.reportId) : null;

  Object.assign(steps[0], { doc: enq.no, status: enq.status === 'Cancelled' ? 'Cancelled' : 'Registered', state: 'done', route: `enquiries/${enq.id}` });
  if (enq.status === 'Cancelled') {
    steps.slice(1).forEach(s => { s.state = 'skip'; });
    return steps;
  }

  const si = steps[1];
  if (enq.siteInspection !== 'YES' || !insp || insp.status === 'Cancelled') {
    Object.assign(si, { state: 'skip', status: enq.type === 'REPAIR' ? 'Not needed' : 'Optional · not needed' });
  } else if (report?.status === 'Submitted') {
    Object.assign(si, { state: 'done', doc: report.no, status: 'Report received', route: `reports/${report.id}` });
  } else {
    const who = insp.technicianId ? empName(insp.technicianId) : '';
    Object.assign(si, {
      state: 'now', route: `inspections/${insp.id}`,
      doc: report ? report.no : who ? `Technician: ${who}` : 'Not assigned yet',
      status: report ? 'Report in progress' : who ? 'Visit booked' : 'Waiting for technician',
    });
    return steps;
  }

  // Later boxes (repair): each is done, now, or still to come.
  const est = latest('estimates', enq.id);
  const q = latest('quotations', enq.id);
  const job = store.list('jobs', j => j.enquiryId === enq.id)[0] || null;
  const inv = job?.invoiceId ? store.get('invoices', job.invoiceId) : null;
  const set = (key, data) => Object.assign(by(key) || {}, data);
  const now = key => { set(key, { state: 'now' }); return steps; };

  if (!est) { set('estimation', { status: enq.type === 'REPAIR' ? 'Waiting for estimate' : 'BOQ study' }); return now('estimation'); }
  set('estimation', { doc: `${est.no} Rev ${est.rev}`, route: `estimates/${est.id}`, status: est.status === 'Draft' ? 'Being prepared' : 'Done', state: est.status === 'Draft' ? 'now' : 'done' });
  if (est.status === 'Draft' && !q) return steps;
  if (!q) return now('quotation');
  const qDone = q.status === 'Accepted';
  set('quotation', { doc: `${q.no} Rev ${q.rev}`, route: `quotations/${q.id}`, status: q.status === 'Submitted' ? 'Counter-check' : q.status, state: qDone ? 'done' : ['Rejected'].includes(q.status) ? 'skip' : 'now' });
  if (q.status === 'Rejected') { steps.slice(steps.indexOf(by('quotation')) + 1).forEach(s => { s.state = 'skip'; }); return steps; }
  if (est.status === 'Draft') set('estimation', { state: 'now', status: 'Revision being prepared' });
  if (!qDone) return steps;
  if (enq.type === 'AMC') return amcStages(enq, steps, set, now);

  if (job?.status === 'Cancelled') {
    set('job', { doc: job.no, route: `jobs/${job.id}`, status: 'Cancelled', state: 'skip' });
    steps.slice(steps.indexOf(by('job')) + 1).forEach(s => { s.state = 'skip'; });
    return steps;
  }
  const jobDone = job && (job.workDone?.signedAt || ['Completed & documented', 'Closed'].includes(job.status));
  set('job', { doc: job?.no || '', route: job ? `jobs/${job.id}` : null, status: job ? job.status : '', state: jobDone ? 'done' : 'now' });
  if (inv) {
    set('invoice', { doc: inv.no || 'Draft', route: `invoices/${inv.id}`, status: inv.status, state: inv.status === 'Posted' ? 'done' : 'now' });
    if (inv.status === 'Posted') {
      const paid = paidOf(inv);
      const full = paid + 0.004 >= inv.total;
      set('payment', { doc: full ? 'Paid' : paid ? `Paid ${money(paid)}` : 'Not paid', route: `invoices/${inv.id}`, status: full ? 'Paid in full' : `Balance ${money(inv.total - paid)}`, state: full ? 'done' : jobDone ? 'now' : 'next' });
    }
  } else if (jobDone) set('invoice', { state: 'now', status: 'To raise' });
  if (job) set('closure', { route: `closure/${job.id}`, doc: job.status === 'Closed' ? job.no : '', status: job.status === 'Closed' ? 'Closed' : job.status === 'Completed & documented' ? 'Documented · waiting for payment' : '', state: job.status === 'Closed' ? 'done' : job.status === 'Completed & documented' ? 'now' : 'next' });
  if (jobDone && !steps.some(s => s.state === 'now') && job.status !== 'Closed') set('closure', { state: 'now', status: 'To review' });
  return steps;
}

// AMC after acceptance: the contract (Draft → Active), its visits, its instalment invoices and payments, and closure.
function amcStages(enq, steps, set, now) {
  const c = contractFor(enq.id) || store.list('contracts', x => x.enquiryId === enq.id)[0];
  if (!c) return now('amcContract');
  const route = `contracts/${c.id}`;
  if (c.status === 'Cancelled') {
    set('amcContract', { doc: c.no, route, status: 'Cancelled', state: 'skip' });
    ['amcVisits', 'invoice', 'payment', 'contractClosure'].forEach(k => set(k, { state: 'skip' }));
    return steps;
  }
  const p = contractProgress(c);
  set('amcContract', { doc: c.no, route, status: c.status === 'Draft' ? 'Draft · to activate' : `${c.status} · ends ${fmtDate(c.end)}`, state: c.status === 'Draft' ? 'now' : 'done' });
  if (c.status === 'Draft') return steps;
  const allVisits = p.done >= p.visits;
  set('amcVisits', { doc: `${p.done} of ${p.visits} done`, route: 'amc-scheduling', status: p.next ? `Next: visit ${p.next.n} of ${p.next.of} · ${p.next.status}` : 'All done', state: allVisits ? 'done' : 'now' });
  const allBilled = p.posted >= p.lines;
  set('invoice', { doc: `${p.posted} of ${p.lines} posted`, route, status: allBilled ? 'All instalments posted' : 'From the billing plan', state: allBilled ? 'done' : 'now' });
  const paidAll = p.posted > 0 && p.balance <= 0.004 && allBilled;
  set('payment', { doc: p.posted ? `Paid ${money(p.paid)}` : 'Nothing due yet', route, status: p.balance > 0.004 ? `Balance ${money(p.balance)}` : 'Nothing owed', state: paidAll ? 'done' : p.posted ? 'now' : 'next' });
  set('contractClosure', { doc: c.status === 'Closed' ? c.no : '', route, status: c.status === 'Closed' ? 'Closed' : c.status === 'Active' ? `Closes after ${fmtDate(c.end)}` : c.status,
    state: c.status === 'Closed' ? 'done' : allVisits && paidAll ? 'now' : 'next' });
  return steps;
}

export const currentStage = enq => stagesFor(enq).find(s => s.state === 'now') || null;
