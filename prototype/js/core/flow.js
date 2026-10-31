// Transaction-wise workflow of an enquiry (the "Workflow" button): one box per transaction,
// with the current one marked "now". Stretch 1 knows Enquiry and Site inspection; later stretches fill the rest.
import * as store from './store.js';
import { empName } from './lookups.js';

const FLOWS = {
  REPAIR: ['enquiry', 'inspection', 'estimation', 'quotation', 'job', 'invoice', 'payment', 'closure'],
  AMC: ['enquiry', 'inspection', 'estimation', 'quotation', 'amcContract', 'amcVisits', 'invoice', 'payment'],
  GS: ['enquiry', 'inspection', 'estimation', 'quotation', 'job', 'invoice', 'payment', 'closure'],
};
const NAMES = {
  enquiry: 'Enquiry', inspection: 'Site inspection', estimation: 'Estimation', quotation: 'Quotation', job: 'Job',
  amcContract: 'AMC contract', amcVisits: 'AMC visits', invoice: 'Invoice', payment: 'Payment', closure: 'Job closure',
};

// state: done | now | next | skip
export function stagesFor(enq) {
  const steps = (FLOWS[enq.type] || FLOWS.REPAIR).map(key => ({ key, name: NAMES[key], doc: '', status: '', state: 'next', route: null }));
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
  }
  if (si.state !== 'now') {
    Object.assign(steps[2], { state: 'now', status: enq.type === 'REPAIR' ? 'Waiting for estimate' : 'BOQ study' });
  }
  return steps;
}

export const currentStage = enq => stagesFor(enq).find(s => s.state === 'now') || null;
