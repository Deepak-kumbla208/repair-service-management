// Enquiry rules: numbering, first status by type, the site-inspection hand-off,
// the register's automatic columns and the 1–2 hour inspection target.
import * as store from './store.js';
import { quickCreate, addSite } from './customers.js';

export const ENQ_STATUSES = ['Waiting for inspection', 'Inspection assigned', 'Report in progress', 'Inspected', 'BOQ study', 'Waiting for estimate', 'Cancelled'];

// Enquiry Type decides the next step: Repair goes to site inspection; AMC and General Servicing go to BOQ study
// (site inspection optional, decided by the "Site Inspection" Yes / No column).
function firstStatus(type, needsInspection) {
  if (needsInspection) return 'Waiting for inspection';
  return type === 'REPAIR' ? 'Waiting for estimate' : 'BOQ study';
}

function openInspection(enq) {
  const insp = store.insert('inspections', { enquiryId: enq.id, zoneId: enq.zoneId, technicianId: '', visitAt: null, confirmedBy: '', notes: '' },
    { status: 'To assign', note: `Site inspection opened for ${enq.no}` });
  store.update('enquiries', enq.id, { inspectionId: insp.id }, false);
  return insp;
}

function resolveSite(customer, data, newSite) {
  if (newSite) return addSite(customer.id, newSite);
  return (store.get('customers', customer.id).sites || []).find(s => s.id === data.siteId);
}

// data: register fields; newCustomer / newSite: quick-created from the form.
export function saveNewEnquiry(data, { newCustomer, newSite } = {}) {
  let customer, site, contactId = data.contactId;
  if (newCustomer) {
    const r = quickCreate({ ...newCustomer, site: newSite });
    customer = r.customer; site = r.site; contactId = r.contact.id;
  } else {
    customer = store.get('customers', data.customerId);
    site = resolveSite(customer, data, newSite);
  }
  const needsInspection = data.siteInspection === 'YES';
  const no = store.nextNumber('ENQ', data.receivedAt);
  const enq = store.insert('enquiries', {
    ...data, no, contactId, customerId: customer.id, customerName: customer.name, siteId: site.id, siteName: site.name, zoneId: site.zoneId,
    recordedBy: store.currentActor(), stage: needsInspection ? 'Inspection' : 'New', inspectionId: null,
  }, { status: firstStatus(data.type, needsInspection), note: `${no} registered` });
  if (needsInspection) openInspection(enq);
  return store.get('enquiries', enq.id);
}

export function saveEnquiryChanges(id, data, { newSite } = {}) {
  const enq = store.get('enquiries', id);
  const customer = store.get('customers', enq.customerId);
  const site = resolveSite(customer, data, newSite) || customer.sites.find(s => s.id === enq.siteId);
  store.update('enquiries', id, { ...data, customerId: enq.customerId, siteId: site.id, siteName: site.name, zoneId: site.zoneId }, `Edited ${enq.no}`);

  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  const open = insp && insp.status !== 'Cancelled';
  if (data.siteInspection === 'YES' && !open) {
    openInspection(store.get('enquiries', id));
    store.setStatus('enquiries', id, 'Waiting for inspection', 'Site inspection added');
  } else if (data.siteInspection !== 'YES' && open && insp.status === 'To assign') {
    store.setStatus('inspections', insp.id, 'Cancelled', 'Site inspection not needed');
    store.setStatus('enquiries', id, firstStatus(data.type, false), 'Site inspection not needed');
  } else if (open && insp.zoneId !== site.zoneId) {
    store.update('inspections', insp.id, { zoneId: site.zoneId }, false);
  }
  return store.get('enquiries', id);
}

// Register columns 17–26 are filled from the linked documents (Stretch 2 adds quotation, job, invoice, payment).
export function laterColumns() {
  return {
    quotationDate: '', quotationStatus: 'Not Quoted', quotationValue: '', jobStatus: '', workCompletion: '',
    workCompletionDate: '', invoiceDate: '', invoiceNo: '', invoiceValue: '', paymentReceived: '',
  };
}

// Inspection clock: flow step 3 says the site inspection should be done within 1–2 hours of the call.
// state: ok (under half the target) | warn | bad (over target); done = report submitted.
export function inspectionClock(enq, company, now = Date.now()) {
  const insp = enq.inspectionId ? store.get('inspections', enq.inspectionId) : null;
  if (!insp || insp.status === 'Cancelled') return null;
  const target = (company?.inspectionTargetHours || 2) * 3600000;
  const start = new Date(enq.receivedAt).getTime();
  const report = insp.reportId ? store.get('siteReports', insp.reportId) : null;
  if (report?.status === 'Submitted') {
    const took = new Date(report.submittedAt).getTime() - start;
    return { done: true, took, target, state: took <= target ? 'ok' : 'bad' };
  }
  const elapsed = now - start;
  return { done: false, elapsed, target, left: target - elapsed, state: elapsed > target ? 'bad' : elapsed > target / 2 ? 'warn' : 'ok' };
}

export const isToday = (iso, now = new Date()) => !!iso && new Date(iso).toDateString() === now.toDateString();
