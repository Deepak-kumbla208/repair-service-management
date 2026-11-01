// Masters for the two demo companies. Demo Shutters uses the team lead's sample rates and data
// (company name, address and UEN are dummies); Gulf Demo Doors is made up.
import { classifySize, toMetres } from '../core/costing.js';

const T0 = new Date().toISOString();
const base = (tenantId, id, data) => ({ id, tenantId, status: 'Active', createdAt: T0, updatedAt: T0, ...data });

// ---------- Value Set Master: the register's 7 lists plus the lists added in the plan review ----------
const VALUE_SETS = [
  ['PRIORITY', 'Priority', 'User', ['High', 'Medium', 'Low']],
  ['ENQ_STATUS', 'Enquiry Status', 'User', ['Hot', 'Warm', 'Cold']],
  ['ENQ_CHANNEL', 'Enquiry Channel', 'User', ['Call', 'Email', 'WhatsApp', 'Other']],
  ['ENQ_TYPE', 'Enquiry Type', 'System', [['REPAIR', 'Adhoc (Repair)'], ['AMC', 'AMC'], ['GS', 'General Servicing']]],
  ['JOB_STATUS', 'Job Status', 'Extensible', ['Confirmed', 'Pending', 'Cancelled']],
  ['QUOT_STATUS', 'Quotation Status', 'Extensible', ['Quoted', 'Not Quoted']],
  ['YES_NO', 'Yes / No', 'System', ['Yes', 'No']],
  ['COSTING_LEVEL', 'Costing Level', 'System', ['Job', 'Line']],
  ['SHARED_COSTS', 'Shared Costs', 'System', [['SPREAD', 'Spread into lines'], ['OWN_LINE', 'Show as own line']]],
  ['PAYMENT_TERMS', 'Payment Terms', 'Extensible', [['IMMEDIATE', 'Immediate'], ['D7', '7 days'], ['D15', '15 days'], ['D30', '30 days']]],
  ['WORK_COMPLETION', 'Work Completion Status', 'System', [['NOT_STARTED', 'Not started'], ['IN_PROGRESS', 'In progress'], ['COMPLETED', 'Completed']]],
  ['PAYMENT_RECEIVED', 'Payment Received', 'System', [['NOT_PAID', 'Not paid'], ['PARTLY', 'Partly paid'], ['PAID', 'Paid']]],
  ['STAGE', 'Stage (hidden, for the dashboard)', 'System', ['New', 'Inspection', 'Quoted', 'Won', 'Lost']],
  ['MARGIN_BASIS', 'Margin Basis', 'System', [['MARKUP', 'Markup on cost'], ['MARGIN', 'Margin on price']]],
  ['OVERHEAD_BASIS', 'Overhead Basis', 'System', [['PCT', '% of direct cost'], ['FIXED', 'Fixed amount']]],
  ['PAYMENT_METHOD', 'Payment Method', 'Extensible', [['CASH', 'Cash'], ['CHEQUE', 'Cheque'], ['BANK', 'Bank transfer'], ['PAYNOW', 'PayNow']]],
  ['ACCEPT_METHOD', 'Acceptance Method', 'Extensible', [['PO', 'Purchase order'], ['SIGNED', 'Signed quotation'], ['EMAIL', 'Email'], ['WHATSAPP', 'WhatsApp']]],
  ['WORK_DONE', 'Work Done Status', 'System', [['DONE', 'Done'], ['PARTLY', 'Partly done'], ['NOT_DONE', 'Not done']]],
];

// inactive: value codes switched off for this company (e.g. PayNow outside Singapore).
function valueSets(t, inactive = []) {
  return VALUE_SETS.map(([code, name, access, vals]) => base(t, `vs_${t}_${code}`, {
    code, name, access,
    values: vals.map((v, i) => {
      const [c, label] = Array.isArray(v) ? v : [v.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), v];
      return { code: c, label, order: i + 1, isDefault: i === 0 && code !== 'ENQ_STATUS', active: !inactive.includes(`${code}.${c}`) };
    }),
  }));
}

// ---------- Shutter Size: one rule in metres; AMC hours from Labour_Matrix, repair hours market-based ----------
function sizes(t) {
  return [
    ['S', 'Small', 3, 3, 0.5, 0, 0, 2, 0, 0],
    ['M', 'Medium', 5, 4, 1, 0, 0, 3, 0, 0],
    ['L', 'Large', 7, 5, 1.5, 1, 1.5, 4, 1, 4],
    ['XL', 'Extra Large', null, null, 2.5, 2, 2.5, 6, 2, 6],
  ].map(([code, name, maxWidth, maxHeight, amcTeamHrs, amcExtraWorkers, amcExtraHrs, repairTeamHrs, repairExtraWorkers, repairExtraHrs], i) =>
    base(t, `siz_${t}_${code}`, { code, name, order: i + 1, maxWidth, maxHeight, amcTeamHrs, amcExtraWorkers, amcExtraHrs, repairTeamHrs, repairExtraWorkers, repairExtraHrs, tags: { repairTeamHrs: 'market-based' } }));
}

// ---------- Product: shutter types and labour factors (Repair estimator) ----------
function products(t) {
  return [['RS', 'Rolling shutter', 1], ['CS', 'Collapsible shutter', 0.9], ['SF', 'Sliding / folding', 0.9], ['SD', 'Sectional door', 1.25], ['MR', 'Motorised rolling', 1.4]]
    .map(([code, name, factor]) => base(t, `prd_${t}_${code}`, { code, name, factor, description: '' }));
}

const QUOTE_TERMS = [
  'This quotation is based on a visual inspection only. A full assessment is not possible until the product has been opened and tested.',
  'Any additional parts needing repair or replacement will be communicated to the customer before work proceeds. Additional work will start only after the customer’s official confirmation.',
  '{company} reserves the right to revise this quotation if further faults are found after inspection.',
  'Customers with a valid Maintenance Contract with {company} receive priority service and discounted charges.',
  'The quoted price covers normal office hours (8:30 am to 5:30 pm). Work after 5:30 pm is charged at 1.5 times the quoted rate.',
  'This quotation is valid for 7 days from the date of issue.',
];

function terms(t, invoiceTerms) {
  const q = QUOTE_TERMS.map((text, i) => base(t, `trm_${t}_Q${i + 1}`, { code: `QT-0${i + 1}`, title: `Quotation term ${i + 1}`, docType: 'Quotation', order: i + 1, text, validityDays: i === 5 ? 7 : null, isDefault: true }));
  const inv = invoiceTerms.map(([text, ph], i) => base(t, `trm_${t}_I${i + 1}`, { code: `INV-0${i + 1}`, title: `Invoice term ${i + 1}`, docType: 'Invoice', order: i + 1, text, isDefault: true, placeholders: ph ? ['text'] : [] }));
  return [...q, ...inv];
}

// Shutter register entry; sizes are stored in metres and classified by the one size rule.
function shutter(t, siteId, n, [tag, location, productCode, w, h, unit, motor], sizeRows) {
  const widthM = toMetres(w, unit), heightM = toMetres(h, unit);
  return { id: `sht_${siteId}_${n}`, tag, location, productId: `prd_${t}_${productCode}`, width: w, height: h, unit, widthM, heightM, sizeCode: classifySize(widthM, heightM, sizeRows), motor: motor || '', serial: '', installDate: '', status: 'Active', source: 'Sample data' };
}

function customer(t, code, data, sites, sizeRows) {
  const id = `cus_${t}_${code}`;
  return base(t, id, {
    code, ...data,
    sites: sites.map((s, i) => {
      const siteId = `${id}_S${i + 1}`;
      return { id: siteId, code: `S${i + 1}`, name: s.name, address: s.address, blockUnit: s.blockUnit || '', postal: s.postal || '', zoneId: `zon_${t}_${s.zone}`, access: s.access || '', shutters: (s.shutters || []).map((sh, j) => shutter(t, siteId, j + 1, sh, sizeRows)) };
    }),
  });
}

// AMC sample: 13 shutters at one site (6 S, 4 M, 2 L, 1 XL), as in the AMC estimator's example row.
function warehouseShutters() {
  const spec = [['S', 6, 2.5, 2.5], ['M', 4, 4, 3.5], ['L', 2, 6, 4.5], ['XL', 1, 8, 5.5]];
  const out = [];
  spec.forEach(([, count, w, h]) => { for (let i = 0; i < count; i++) out.push([`W-${String(out.length + 1).padStart(2, '0')}`, `Loading bay ${out.length + 1}`, 'RS', w, h, 'm', '']); });
  return out;
}

// ---------- Demo Shutters Pte Ltd (Singapore) ----------
export function singaporeMasters(t) {
  const sizeRows = sizes(t);
  const zone = (code, name, distance, repairRate, amcRate, roundTripHours, ph = []) =>
    base(t, `zon_${t}_${code}`, { code, name, distance, vehicle: 'Lorry', repairRate, amcRate, roundTripHours, placeholders: ph });
  return {
    zones: [
      zone('A', 'Local', '0 – 25 km', 15, 10, 2),
      zone('B', 'Changi', '', 20, 15, 3),
      zone('C', 'CBD', '', 25, 20, 2, ['amcRate', 'roundTripHours']),
      zone('D', 'Jurong Island', '', 30, 25, 4, ['roundTripHours']),
    ],
    employees: [
      base(t, `emp_${t}_1`, { code: 'EMP-001', name: 'Operations Executive', designation: 'Operations Executive', type: 'Office', mainZoneId: '', extraZoneIds: [], skills: '', mobile: '8000 0001', email: 'ops@demo-shutters.example' }),
      base(t, `emp_${t}_2`, { code: 'EMP-002', name: 'Approver', designation: 'Approver', type: 'Office', mainZoneId: '', extraZoneIds: [], skills: '', mobile: '8000 0002', email: 'approver@demo-shutters.example' }),
      base(t, `emp_${t}_3`, { code: 'EMP-003', name: 'Technician A', designation: 'Technician', type: 'Technician', mainZoneId: `zon_${t}_A`, extraZoneIds: [`zon_${t}_B`], skills: 'Rolling, motor work', mobile: '8000 0003', email: '' }),
      base(t, `emp_${t}_4`, { code: 'EMP-004', name: 'Technician B', designation: 'Technician', type: 'Technician', mainZoneId: `zon_${t}_C`, extraZoneIds: [`zon_${t}_D`], skills: 'Rolling, collapsible, sectional', mobile: '8000 0004', email: '' }),
      base(t, `emp_${t}_5`, { code: 'EMP-005', name: 'Management', designation: 'General Manager', type: 'Office', mainZoneId: '', extraZoneIds: [], skills: '', mobile: '8000 0005', email: '' }),
      // Helpers work in the "Standard Team (1+1)" with a technician; they do not use the app.
      base(t, `emp_${t}_6`, { code: 'EMP-006', name: 'Helper 1', designation: 'Helper', type: 'Helper', mainZoneId: `zon_${t}_A`, extraZoneIds: [`zon_${t}_B`], skills: '', mobile: '8000 0006', email: '' }),
      base(t, `emp_${t}_7`, { code: 'EMP-007', name: 'Helper 2', designation: 'Helper', type: 'Helper', mainZoneId: `zon_${t}_C`, extraZoneIds: [`zon_${t}_D`], skills: '', mobile: '8000 0007', email: '' }),
    ],
    equipment: [
      ['EQ-01', 'Scissor Lift', 'Rented', 'Day', 550], ['EQ-02', 'Lorry Crane', 'Rented', 'Trip', 500], ['EQ-03', 'Scaffold', 'Rented', 'Day', 500],
      ['EQ-04', 'Boom Lift / MEWP', 'Rented', 'Day', 650, ['rate']], ['EQ-05', 'Ladder / platform ladder', 'Owned', 'Day', 0],
    ].map(([code, name, ownership, basis, rate, ph], i) => base(t, `eqp_${t}_${i + 1}`, { code, name, ownership, basis, rate, supplier: '', placeholders: ph || [] })),
    labour: [
      ['LAB-R1', 'Standard Team (1+1)', 'Repair', 'Skilled', 6700], ['LAB-R2', 'Additional Worker', 'Repair', 'Semi-skilled', 3000],
      ['LAB-A1', 'Standard Team (1+1)', 'AMC', 'Skilled', 6500], ['LAB-A2', 'Additional Worker', 'AMC', 'Semi-skilled', 2100],
    ].map(([code, name, rateSet, skill, monthly], i) => base(t, `lab_${t}_${i + 1}`, { code, name, rateSet, skill, monthly, days: 26, hours: 8, otMultiplier: 1.5 })),
    products: products(t),
    items: [
      ['ITM-001', 'Bolt nut', 'M10', 'Nos', 10, 0, 0], ['ITM-002', 'Motor 500 kg single phase', '500 kg, single phase', 'Nos', 1110, 0, 7],
      ['ITM-003', 'Motor 400 kg single phase', '400 kg, single phase', 'Nos', 950, 0, 7, true], ['ITM-004', 'Tension spring', '', 'Nos', 85, 0, 3, true],
      ['ITM-005', 'Guide rail', 'Galvanised', 'm', 45, 5, 3, true], ['ITM-006', 'Lock set', '', 'Set', 60, 0, 2, true],
      ['ITM-007', 'Bottom bar', '', 'm', 40, 5, 3, true], ['ITM-008', 'Shutter slat', '0.8 mm', 'm²', 35, 10, 5, true],
      ['ITM-009', 'Lubricant spray', '', 'Can', 12, 0, 0, true], ['ITM-010', 'Remote control', '2-button', 'Nos', 75, 0, 3, true],
    ].map(([code, name, spec, unit, rate, wastage, leadDays, ph], i) => base(t, `itm_${t}_${i + 1}`, { code, name, spec, unit, rate, wastage, leadDays, category: i === 8 ? 'Consumable' : 'Spare part', placeholders: ph ? ['rate'] : [] })),
    sizes: sizeRows,
    valueSets: valueSets(t),
    taxes: [
      base(t, `tax_${t}_SR9`, { code: 'SR9', name: 'GST standard-rated 9%', rate: 9, from: '2024-01-01', to: '', category: 'Standard-rated' }),
      base(t, `tax_${t}_SR8`, { code: 'SR8', name: 'GST standard-rated 8%', rate: 8, from: '2023-01-01', to: '2023-12-31', category: 'Standard-rated', status: 'Inactive' }),
      base(t, `tax_${t}_ZR`, { code: 'ZR', name: 'GST zero-rated', rate: 0, from: '2024-01-01', to: '', category: 'Zero-rated' }),
    ],
    // The Excel's invoice terms, adapted for Singapore (PayNow, GST, S$); [X] values are placeholders.
    terms: terms(t, [
      ['Payment is due within the payment term shown on this invoice.'],
      ['Payment can be made by cash, cheque, bank transfer or PayNow. Cheques should be drawn in favour of "{company}".'],
      ['Bank details: [account name, account number, bank and branch].', true],
      ['Late payments will attract interest at [X]% per month on the outstanding amount.', true],
      ['Cheque bounce charges of S$[amount] will apply.', true],
      ['Prices include GST at the rate shown on this invoice.'],
      ['Goods and parts supplied remain the property of {company} until full payment is received.'],
      ['Any invoice discrepancy must be reported in writing within 7 days of receipt. After this period, the invoice is treated as accepted.'],
      ['A warranty of [X] months applies to the parts and workmanship invoiced, from the date of completion. It covers the repaired or replaced parts only.', true],
      ['The warranty does not cover damage from misuse, accidents, unauthorised repairs, or natural causes.'],
      ['Replaced parts will be handed over only on request, at the time of service.'],
      ['Work carried out after 5:30 pm or outside normal office hours is charged at 1.5 times the standard rate, as quoted.'],
      ['Additional work not covered in the quotation is billed separately, after customer approval.'],
      ['All disputes are subject to the jurisdiction of the courts of Singapore.'],
      ['This is a computer-generated invoice and does not require a signature.'],
    ]),
    customers: [
      customer(t, 'CUS-0001', { name: 'Kosmic M&E Services Pte Ltd', uen: '', taxRegistered: true, paymentTerm: 'IMMEDIATE', phone: '9876 5432', email: 'facilities@kosmic.example', address: 'IMM Building, Jurong East',
        contacts: [{ id: `con_${t}_1`, name: 'Facilities Manager', designation: 'Facilities', mobile: '9876 5432', email: 'facilities@kosmic.example', primary: true }] },
      [{ name: 'IMM Building L1 Shop @ Jurong East', address: 'IMM Building, Jurong East', blockUnit: 'L1', zone: 'A',
        shutters: [['RS-1', 'Front shop', 'RS', 10, 9, 'ft', '400 kg single phase'], ['RS-2', 'Side godown', 'CS', 8, 7, 'ft', '']] }], sizeRows),
      customer(t, 'CUS-0002', { name: 'ABC Industries', uen: '', taxRegistered: true, paymentTerm: 'D30', phone: '9012 3456', email: 'admin@abc-industries.example', address: 'Main warehouse',
        contacts: [{ id: `con_${t}_2`, name: 'Admin Officer', designation: 'Admin', mobile: '9012 3456', email: 'admin@abc-industries.example', primary: true }] },
      [{ name: 'Main warehouse', address: 'Main warehouse', zone: 'A', shutters: warehouseShutters() }], sizeRows),
      customer(t, 'CUS-0003', { name: 'Demo Retail Pte Ltd', uen: '', taxRegistered: false, paymentTerm: 'D15', phone: '9123 4567', email: 'shop@demo-retail.example', address: 'Raffles Place',
        contacts: [{ id: `con_${t}_3`, name: 'Shop Manager', designation: 'Shop', mobile: '9123 4567', email: 'shop@demo-retail.example', primary: true }] },
      [{ name: 'Raffles Place shop', address: 'Raffles Place', blockUnit: '#01-12', zone: 'C', shutters: [['RS-1', 'Shop front', 'RS', 4.2, 3, 'm', '']] }], sizeRows),
      // Made-up customers in the other zones, used by the stage samples (data/seed-demo-flow.js).
      customer(t, 'CUS-0004', { name: 'Changi Demo Logistics Pte Ltd', uen: '', taxRegistered: true, paymentTerm: 'D30', phone: '9234 5678', email: 'warehouse@changi-demo.example', address: 'Cargo Complex Road, Changi',
        contacts: [{ id: `con_${t}_4`, name: 'Warehouse Supervisor', designation: 'Warehouse', mobile: '9234 5678', email: 'warehouse@changi-demo.example', primary: true }] },
      [{ name: 'Changi cargo warehouse', address: 'Cargo Complex Road, Changi', blockUnit: 'Bay 3', zone: 'B',
        shutters: [['CG-1', 'Loading bay 1', 'SD', 4, 4.5, 'm', ''], ['CG-2', 'Loading bay 2', 'MR', 6, 5, 'm', '600 kg three phase'], ['CG-3', 'Office back door', 'RS', 2.5, 2.5, 'm', '']] }], sizeRows),
      customer(t, 'CUS-0005', { name: 'Island Demo Chemicals Pte Ltd', uen: '', taxRegistered: true, paymentTerm: 'D15', phone: '9345 6789', email: 'plant@island-demo.example', address: 'Demo Avenue, Jurong Island',
        contacts: [{ id: `con_${t}_5`, name: 'Plant Engineer', designation: 'Engineering', mobile: '9345 6789', email: 'plant@island-demo.example', primary: true }] },
      [{ name: 'Jurong Island plant', address: 'Demo Avenue, Jurong Island', zone: 'D', access: 'Security pass needed at the gate',
        shutters: [['JI-1', 'Store room', 'RS', 3, 3, 'm', ''], ['JI-2', 'Fire exit', 'RS', 8, 6, 'm', ''], ['JI-3', 'Workshop', 'MR', 5, 4, 'm', '500 kg single phase']] }], sizeRows),
      customer(t, 'CUS-0006', { name: 'Demo Cafe Pte Ltd', uen: '', taxRegistered: false, paymentTerm: 'IMMEDIATE', phone: '9456 7890', email: 'hello@demo-cafe.example', address: 'Demo Street, Tanjong Pagar',
        contacts: [{ id: `con_${t}_6`, name: 'Cafe Manager', designation: 'Operations', mobile: '9456 7890', email: 'hello@demo-cafe.example', primary: true }] },
      [{ name: 'Tanjong Pagar cafe', address: 'Demo Street, Tanjong Pagar', blockUnit: '#01-05', zone: 'C',
        shutters: [['TP-1', 'Shop front', 'RS', 3.5, 2.8, 'm', ''], ['TP-2', 'Side entrance', 'CS', 2, 2.4, 'm', '']] }], sizeRows),
    ],
  };
}

// ---------- Gulf Demo Doors LLC (UAE), all made up ----------
export function uaeMasters(t) {
  const sizeRows = sizes(t);
  const zone = (code, name, repairRate, amcRate, roundTripHours) =>
    base(t, `zon_${t}_${code}`, { code, name, distance: '', vehicle: 'Pick-up', repairRate, amcRate, roundTripHours, placeholders: ['repairRate', 'amcRate', 'roundTripHours'] });
  return {
    zones: [zone('A', 'Deira', 40, 30, 2), zone('B', 'Bur Dubai', 45, 35, 2), zone('C', 'Al Quoz', 50, 40, 2), zone('D', 'Jebel Ali', 60, 50, 3)],
    employees: [
      base(t, `emp_${t}_1`, { code: 'EMP-001', name: 'Technician G1', designation: 'Technician', type: 'Technician', mainZoneId: `zon_${t}_C`, extraZoneIds: [`zon_${t}_D`], skills: 'Rolling', mobile: '050 000 0001', email: '' }),
    ],
    equipment: [base(t, `eqp_${t}_1`, { code: 'EQ-01', name: 'Scissor Lift', ownership: 'Rented', basis: 'Day', rate: 900, supplier: '', placeholders: ['rate'] })],
    labour: [
      ['LAB-R1', 'Standard Team (1+1)', 'Repair', 'Skilled', 9000], ['LAB-R2', 'Additional Worker', 'Repair', 'Semi-skilled', 4000],
      ['LAB-A1', 'Standard Team (1+1)', 'AMC', 'Skilled', 8500], ['LAB-A2', 'Additional Worker', 'AMC', 'Semi-skilled', 3500],
    ].map(([code, name, rateSet, skill, monthly], i) => base(t, `lab_${t}_${i + 1}`, { code, name, rateSet, skill, monthly, days: 26, hours: 8, otMultiplier: 1.5, placeholders: ['monthly'] })),
    products: products(t),
    items: [['ITM-001', 'Tension spring', '', 'Nos', 300], ['ITM-002', 'Motor 500 kg single phase', '', 'Nos', 3900]]
      .map(([code, name, spec, unit, rate], i) => base(t, `itm_${t}_${i + 1}`, { code, name, spec, unit, rate, wastage: 0, leadDays: 5, category: 'Spare part', placeholders: ['rate'] })),
    sizes: sizeRows,
    valueSets: valueSets(t, ['PAYMENT_METHOD.PAYNOW']),
    taxes: [
      base(t, `tax_${t}_VAT5`, { code: 'VAT5', name: 'VAT standard 5%', rate: 5, from: '2018-01-01', to: '', category: 'Standard-rated' }),
      base(t, `tax_${t}_ZR`, { code: 'ZR', name: 'VAT zero-rated', rate: 0, from: '2018-01-01', to: '', category: 'Zero-rated' }),
    ],
    terms: terms(t, [
      ['Payment is due within the payment term shown on this invoice.'],
      ['Payment can be made by cash, cheque or bank transfer. Cheques should be drawn in favour of "{company}".'],
      ['Bank details: [account name, IBAN, bank and branch].', true],
    ]),
    customers: [
      customer(t, 'CUS-0001', { name: 'Desert Demo Trading LLC', uen: '', taxRegistered: true, paymentTerm: 'IMMEDIATE', phone: '050 123 4567', email: 'warehouse@desert-demo.example', address: 'Al Quoz Industrial Area 3',
        contacts: [{ id: `con_${t}_1`, name: 'Warehouse Manager', designation: 'Warehouse', mobile: '050 123 4567', email: 'warehouse@desert-demo.example', primary: true }] },
      [{ name: 'Al Quoz warehouse', address: 'Al Quoz Industrial Area 3', zone: 'C', shutters: [['D-1', 'Gate 1', 'RS', 5, 4.5, 'm', ''], ['D-2', 'Gate 2', 'MR', 6, 4.5, 'm', '600 kg three phase']] }], sizeRows),
    ],
  };
}
