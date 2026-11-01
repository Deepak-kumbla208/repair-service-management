// Stretch 2 sample data: the preset approval rules and a Kosmic repair enquiry whose site report is already in,
// so the money side (estimate → quotation → job → invoice → payment) can be shown right after "Reset demo data".

// Preset approval rules (the engine in core/workflow.js; edited in the Authorization Workflow Master).
// Each rule adds an approval level for a document when its condition is true. Rules on the same level are one task.
export function approvalRules(t) {
  const rule = (code, docType, name, when, level, roleCode, condition = null) =>
    ({ id: `rul_${t}_${code}`, tenantId: t, code, name, docType, when, level, roleCode, condition, mode: 'any', active: true });
  return [
    rule('QT_CHECK', 'quotation', 'Quotation counter-check', 'Every quotation', 1, 'APR'),
    rule('PAY_TERM', 'quotation', 'Payment term not immediate', 'Payment term is not Immediate', 1, 'APR', { field: 'paymentTerm', op: 'neq', value: 'IMMEDIATE' }),
    rule('QT_HIGH', 'quotation', 'Quotation over 10,000', 'Total with tax over 10,000', 2, 'MGT', { field: 'total', op: 'gt', value: 10000 }),
    // A payment term changed when the customer accepts (not Immediate) is approved before the job is scheduled.
    rule('JOB_TERM', 'job', 'Payment term changed at acceptance', 'Payment term is not Immediate', 1, 'APR', { field: 'paymentTerm', op: 'neq', value: 'IMMEDIATE' }),
  ];
}

// Defaults for new transactions (edited in Transaction Setup).
export const TX_DEFAULTS = { costingLevel: 'JOB', sharedCosts: 'SPREAD', overheadPct: 20, marginBasis: 'MARKUP', marginPct: 20, quoteValidityDays: 7, defaultPaymentTerm: 'IMMEDIATE' };

const hist = (...steps) => steps.map(([status, iso, by, note]) => ({ status, at: iso, by, note: note || '' }));
const localDate = iso => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ENQ-…-0003: Kosmic, RS-1 motor and RS-2 springs (the team lead's sample job), inspected by Technician A.
// at(daysAgo, hh, mm) gives a time relative to now, so the sample always looks recent.
export function kosmicRepair(t, cust, at) {
  const ops = `usr_${t}_ops`;
  const k = cust.find(c => c.code === 'CUS-0001');
  const site = k.sites[0], con = k.contacts[0];
  const year = new Date().getFullYear();
  const [rs1, rs2] = site.shutters;
  const recv = at(1, 16, 20), assigned = at(1, 16, 30), visit = at(1, 16, 45), timeIn = at(1, 16, 50), done = at(1, 17, 30);
  const enqId = `enq_${t}_3`, inspId = `ins_${t}_3`, repId = `svr_${t}_1`, tech = `emp_${t}_3`;
  const findings = 'RS-1 motor needs replacing; RS-2 jammed, springs worn';
  const enquiry = {
    id: enqId, tenantId: t, no: `ENQ-${year}-0003`, receivedAt: recv, channel: 'EMAIL', channelOther: '', type: 'REPAIR', enquiryStatus: 'HOT', priority: 'HIGH',
    siteInspection: 'YES', recordedBy: ops, remarks: '', attachments: [],
    lines: [{ itemRef: '', itemName: '', qty: null, description: 'RS-1 front shop shutter motor not working; RS-2 side godown shutter jammed.' }],
    description: 'RS-1 front shop shutter motor not working; RS-2 side godown shutter jammed.',
    customerId: k.id, customerName: k.name, contactId: con.id, contactName: con.name, mobile: con.mobile, email: con.email,
    siteId: site.id, siteName: site.name, zoneId: site.zoneId, inspectionId: inspId, stage: 'Inspection', status: 'Inspected',
    statusHistory: hist(['Waiting for inspection', recv, ops], ['Inspection assigned', assigned, ops, 'Technician A'], ['Report in progress', timeIn, `usr_${t}_techA`, `SVR-${year}-0001`], ['Inspected', done, ops, `SVR-${year}-0001 received on paper`]),
    createdAt: recv, updatedAt: done, createdBy: ops,
  };
  const inspection = {
    id: inspId, tenantId: t, enquiryId: enqId, zoneId: site.zoneId, technicianId: tech, visitAt: visit, confirmedBy: 'Phone', notes: '', assignedAt: assigned, assignedBy: ops, reportId: repId,
    status: 'Report submitted', statusHistory: hist(['To assign', recv, ops], ['Assigned', assigned, ops, 'Technician A'], ['Report in progress', timeIn, ops], ['Report submitted', done, ops]),
    createdAt: recv, updatedAt: done,
  };
  // Job scope: the enquiry line names RS-1 and RS-2, so its row links both customer products.
  const rowKey = `ask_${t}_k1`;
  const picked = (s, finding) => ({ key: s.id, shutterId: s.id, tag: s.tag, location: s.location, productId: s.productId, width: s.width, height: s.height, unit: s.unit, sizeCode: s.sizeCode, motor: s.motor, finding, rowKey });
  const report = {
    id: repId, tenantId: t, no: `SVR-${year}-0001`, inspectionId: inspId, enquiryId: enqId, technicianId: tech, customerId: k.id, siteId: site.id,
    s1: { customer: k.name, site: site.name, address: site.address, blockUnit: site.blockUnit, viewedBy: 'Technician A', viewDate: localDate(visit), contactPerson: con.name,
      contactNo: `${con.mobile} / ${con.email}`, timeIn: hhmm(timeIn), timeOut: hhmm(done) },
    shutters: [picked(rs1, 'Motor not working, needs replacing'), picked(rs2, 'Jammed; springs worn')],
    asked: [{ key: rowKey, n: 1, text: enquiry.description, desc: enquiry.description, done: true, note: '', productId: rs1.productId, qty: 2, location: '', sizeCode: '',
      width: null, height: null, unit: 'm', linkIds: [rs1.id, rs2.id] }],
    s2: { supplyInstall: false, repair: true, replace: true, motor: true, dismantle: false, servicing: false, other: '',
      description: 'Supply and install a 400 kg single phase motor on RS-1; release the RS-2 jam and replace the springs.', findings },
    s3: { zoneId: site.zoneId, persons: 2, days: 1, hoursPerDay: 6, remarks: '', normal: true, afterHours: false, weekend: false, phased: false },
    s4: { ladder: true, scaffolding: false, scaffoldSets: '', scissor: false, scissorNos: '', boom: false, hoist: false, welding: false, grinding: false, powerTools: true, other: '', maxHeight: 3, providedBy: 'Contractor', rentalDuration: '', others: '' },
    s5: { rows: [
      { name: 'Motor 400 kg single phase', spec: '400 kg, single phase', qty: 1, unit: 'Nos', remarks: '', itemId: `itm_${t}_3`, shutterKey: rs1.id },
      { name: 'Tension spring', spec: '', qty: 2, unit: 'Nos', remarks: '', itemId: `itm_${t}_4`, shutterKey: rs2.id },
    ], consumables: '' },
    s6: { normalAccess: true, restricted: false, permit: false, safetyDocs: false, protection: false, barricade: false, remarks: '' },
    photos: [],
    s7: { name: 'Technician A', designation: 'Technician', signatureId: null, date: localDate(done) },
    paper: true, submittedAt: done, status: 'Submitted', statusHistory: hist(['Draft', timeIn, ops], ['Submitted', done, ops]),
    createdAt: timeIn, updatedAt: done, createdBy: ops,
  };
  return { enquiry, inspection, report };
}
