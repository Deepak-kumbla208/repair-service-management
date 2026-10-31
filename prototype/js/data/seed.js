// Demo data for both companies: profile, roles, users, menu access, number series, masters and sample enquiries.
import { MENUS, ACTIONS } from './menus.js';
import { singaporeMasters, uaeMasters } from './seed-masters.js';

const DSH = 'co_dsh';
const GDD = 'co_gdd';

const COMPANIES = [
  { id: DSH, tenantId: DSH, code: 'DSH', name: 'Demo Shutters Pte Ltd', country: 'Singapore', currency: 'SGD',
    taxLabel: 'GST', taxRegLabel: 'GST Reg. No.', taxRegNo: 'M9-0000000-0', chargesTax: true, defaultTaxCode: 'SR9',
    regLabel: 'UEN', regNo: '200000000D', address: 'Blk 10 Demo Road, #01-01, Singapore 100010',
    tel: '+65 6000 0000', mobile: '+65 8000 0000', email: 'sales@demo-shutters.example', inspectionTargetHours: 2, placeholders: ['taxRegNo', 'regNo'] },
  { id: GDD, tenantId: GDD, code: 'GDD', name: 'Gulf Demo Doors LLC', country: 'United Arab Emirates', currency: 'AED',
    taxLabel: 'VAT', taxRegLabel: 'TRN', taxRegNo: '100000000000003', chargesTax: true, defaultTaxCode: 'VAT5',
    regLabel: 'Trade licence', regNo: '000000', address: 'Office 12, Demo Business Centre, Al Quoz, Dubai, UAE',
    tel: '+971 4 000 0000', mobile: '+971 50 000 0000', email: 'sales@gulf-demo-doors.example', inspectionTargetHours: 2, placeholders: ['taxRegNo', 'regNo'] },
];

const ROLES = [
  ['ADMIN', 'Admin', 'Everything, including setup'],
  ['OPS', 'Operations Executive', 'Enquiries, inspections, estimates, quotations, scheduling, invoices'],
  ['APR', 'Approver', 'Counter-checks quotations; approves non-immediate payment terms'],
  ['TECH', 'Technician', 'Own jobs on the phone'],
  ['MGT', 'Management', 'Read-only view of everything'],
];

// Menu access per role: [channel, actions, scope]
const V = ['view'];
const VP = ['view', 'print'];
const RW = ['view', 'create', 'edit', 'cancel', 'print'];
const MASTERS = MENUS.filter(m => m.group === 'Master').map(m => m.key);
const DOCS = ['estimation', 'quotation', 'job', 'amcContract', 'amcScheduling', 'closure', 'invoice', 'payment'];

function accessFor(role) {
  const a = {};
  const set = (keys, channel, actions, scope = 'all') => [].concat(keys).forEach(k => { a[k] = { channel, actions, scope }; });
  if (role === 'ADMIN') set(MENUS.map(m => m.key), 'both', ACTIONS);
  if (role === 'OPS') {
    set('dashboard', 'both', V);
    set(MASTERS, 'web', V);
    set('customer', 'both', RW);
    set('enquiry', 'both', RW);
    set('inspection', 'web', RW);
    set(DOCS, 'web', RW);
  }
  if (role === 'APR') {
    set('dashboard', 'both', V);
    set(['customer', 'enquiry', 'estimation', 'amcContract', 'invoice', 'payment', 'closure'], 'web', V);
    set('inspection', 'web', VP);
    set('quotation', 'both', ['view', 'approve', 'print']);
    set('job', 'web', ['view', 'approve']);
  }
  if (role === 'TECH') {
    set('dashboard', 'mobile', V);
    set(['inspection', 'job', 'amcExecution'], 'mobile', ['view', 'edit'], 'own');
    set('item', 'mobile', V);
  }
  if (role === 'MGT') {
    set('dashboard', 'both', V);
    set(MASTERS, 'web', V);
    set(['inspection', ...DOCS, 'amcExecution'], 'web', VP);
    set('enquiry', 'both', VP);
  }
  return a;
}

function rolesAndAccess(t) {
  const roles = ROLES.map(([code, name, description]) => ({ id: `rol_${t}_${code}`, tenantId: t, code, name, description, status: 'Active' }));
  const menuAccess = [];
  roles.forEach(r => Object.entries(accessFor(r.code)).forEach(([menu, x]) =>
    menuAccess.push({ id: `acc_${r.id}_${menu}`, tenantId: t, roleId: r.id, menu, ...x })));
  return { roles, menuAccess };
}

const USERS = [
  [DSH, 'admin', 'Admin', 'ADMIN', null, 'All menus, web and phone'],
  [DSH, 'viji', 'Viji', 'OPS', 1, 'Enquiries and inspections · web and phone'],
  [DSH, 'priya', 'Priya', 'APR', 2, 'Counter-checks quotations'],
  [DSH, 'techA', 'Technician A', 'TECH', 3, 'Zone A (also B) · phone only'],
  [DSH, 'techB', 'Technician B', 'TECH', 4, 'Zone C (also D) · phone only'],
  [DSH, 'mgmt', 'Management', 'MGT', 5, 'Read-only, all transactions'],
  [GDD, 'gadmin', 'Admin', 'ADMIN', null, 'All menus, web and phone'],
];

const SERIES = [['ENQ', 'Enquiry'], ['SVR', 'Site viewing report'], ['EST', 'Estimate'], ['QT', 'Quotation'], ['JOB', 'Job'], ['AMC', 'AMC contract'], ['INV', 'Invoice'], ['RCPT', 'Receipt']];

function series(t, used) {
  const year = new Date().getFullYear();
  return SERIES.map(([docType, name]) => ({ id: `ser_${t}_${docType}`, tenantId: t, docType, name, prefix: docType, padding: 4, reset: 'Yearly', lastByYear: { [year]: used[docType] || 0 } }));
}

// Times relative to now, so the sample data always looks recent.
function at(daysAgo, hh, mm) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}
const hist = (...steps) => steps.map(([status, iso, by, note]) => ({ status, at: iso, by, note: note || '' }));

function enquiry(t, n, d) {
  const year = new Date().getFullYear();
  return { id: `enq_${t}_${n}`, tenantId: t, no: `ENQ-${year}-${String(n).padStart(4, '0')}`, remarks: '', attachments: [], createdAt: d.receivedAt, updatedAt: d.receivedAt, createdBy: d.recordedBy, ...d };
}

function sampleTransactions(cust) {
  const viji = 'usr_co_dsh_viji';
  const abc = cust.find(c => c.code === 'CUS-0002');
  const retail = cust.find(c => c.code === 'CUS-0003');
  const fromCustomer = c => ({ customerId: c.id, customerName: c.name, contactId: c.contacts[0].id, contactName: c.contacts[0].name, mobile: c.contacts[0].mobile, email: c.contacts[0].email, siteId: c.sites[0].id, siteName: c.sites[0].name, zoneId: c.sites[0].zoneId });

  const e1At = at(2, 9, 5), e2At = at(1, 15, 40), e2Assigned = at(1, 16, 10);
  const e1 = enquiry(DSH, 1, { receivedAt: e1At, channel: 'CALL', type: 'AMC', enquiryStatus: 'WARM', priority: 'LOW', siteInspection: 'NO', recordedBy: viji,
    description: 'Annual maintenance contract for the 13 roller shutters at the main warehouse. BOQ to follow by email.', ...fromCustomer(abc),
    status: 'BOQ study', stage: 'New', statusHistory: hist(['BOQ study', e1At, viji, 'AMC enquiry: BOQ study']) });
  const e2 = enquiry(DSH, 2, { receivedAt: e2At, channel: 'WHATSAPP', type: 'REPAIR', enquiryStatus: 'HOT', priority: 'MEDIUM', siteInspection: 'YES', recordedBy: viji,
    description: 'Shop-front shutter stuck halfway; cannot close it at night.', ...fromCustomer(retail), inspectionId: `ins_${DSH}_2`,
    status: 'Inspection assigned', stage: 'Inspection', statusHistory: hist(['Waiting for inspection', e2At, viji], ['Inspection assigned', e2Assigned, viji, 'Technician B']) });
  const visit = new Date(); visit.setDate(visit.getDate() + 1); visit.setHours(10, 0, 0, 0);
  const i2 = { id: `ins_${DSH}_2`, tenantId: DSH, enquiryId: e2.id, zoneId: e2.zoneId, technicianId: `emp_${DSH}_4`, visitAt: visit.toISOString(), confirmedBy: 'WhatsApp', notes: 'Customer confirmed by WhatsApp', assignedAt: e2Assigned, assignedBy: viji,
    status: 'Assigned', statusHistory: hist(['To assign', e2At, viji], ['Assigned', e2Assigned, viji, 'Technician B']), createdAt: e2At, updatedAt: e2Assigned };
  return { enquiries: [e1, e2], inspections: [i2] };
}

function gulfTransactions(cust) {
  const by = 'usr_co_gdd_gadmin';
  const c = cust[0];
  const recv = at(0, Math.max(0, new Date().getHours() - 3), 0);
  const e = enquiry(GDD, 1, { receivedAt: recv, channel: 'CALL', type: 'REPAIR', enquiryStatus: 'HOT', priority: 'HIGH', siteInspection: 'YES', recordedBy: by,
    description: 'Gate 2 motorised shutter makes a loud noise and stops halfway.', customerId: c.id, customerName: c.name, contactId: c.contacts[0].id, contactName: c.contacts[0].name,
    mobile: c.contacts[0].mobile, email: c.contacts[0].email, siteId: c.sites[0].id, siteName: c.sites[0].name, zoneId: c.sites[0].zoneId, inspectionId: `ins_${GDD}_1`,
    status: 'Waiting for inspection', stage: 'Inspection', statusHistory: hist(['Waiting for inspection', recv, by]) });
  const i = { id: `ins_${GDD}_1`, tenantId: GDD, enquiryId: e.id, zoneId: e.zoneId, technicianId: '', visitAt: null, confirmedBy: '', notes: '', status: 'To assign', statusHistory: hist(['To assign', recv, by]), createdAt: recv, updatedAt: recv };
  return { enquiries: [e], inspections: [i] };
}

export function buildSeed() {
  const out = { companies: COMPANIES, users: [], roles: [], menuAccess: [], series: [], audit: [], siteReports: [], enquiries: [], inspections: [] };
  const sg = singaporeMasters(DSH);
  const ae = uaeMasters(GDD);
  for (const coll of Object.keys(sg)) out[coll] = [...sg[coll], ...ae[coll]];
  [DSH, GDD].forEach(t => {
    const ra = rolesAndAccess(t);
    out.roles.push(...ra.roles);
    out.menuAccess.push(...ra.menuAccess);
  });
  out.users = USERS.map(([t, login, name, roleCode, empNo, hint]) => ({
    id: `usr_${t}_${login}`, tenantId: t, login, name, roleId: `rol_${t}_${roleCode}`, employeeId: empNo ? `emp_${t}_${empNo}` : null, hint, status: 'Active',
  }));
  const sgTx = sampleTransactions(sg.customers);
  const aeTx = gulfTransactions(ae.customers);
  out.enquiries = [...sgTx.enquiries, ...aeTx.enquiries];
  out.inspections = [...sgTx.inspections, ...aeTx.inspections];
  out.series = [...series(DSH, { ENQ: 2 }), ...series(GDD, { ENQ: 1 })];
  return out;
}
