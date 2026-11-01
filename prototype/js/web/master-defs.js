// Field definitions for the generic master screens (every master has a Code and a Name).
// Customer has its own screen (customer.js) because of contacts, sites and the shutter register.
import { zones, zoneLabel, zoneCode } from '../core/lookups.js';
import { hourlyRate, otRate, round2 } from '../core/costing.js';

const zoneOptions = () => zones().map(z => ({ value: z.id, label: `${z.code} · ${z.name}` }));

// Field: {name, label, type, options, required, hint, cls, money, unit}
// Column: [field name or function, header, {money}]
export const DEFS = {
  employee: {
    coll: 'employees', title: 'Employee / Technician', codePrefix: 'EMP-', codePad: 3,
    note: 'Used to assign site inspections and jobs by zone; technicians log in to the phone.',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true },
      { name: 'designation', label: 'Designation' }, { name: 'type', label: 'Type', type: 'select', options: ['Office', 'Technician'], required: true },
      { name: 'mainZoneId', label: 'Main zone', type: 'select', options: zoneOptions }, { name: 'skills', label: 'Skills' },
      { name: 'extraZoneIds', label: 'Extra zones', type: 'multi', options: zoneOptions, cls: 'spanall' },
      { name: 'mobile', label: 'Mobile', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
    ],
    columns: [['code', 'Code'], ['name', 'Name'], ['designation', 'Designation'], ['type', 'Type'], [r => zoneLabel(r.mainZoneId), 'Main zone'],
      [r => (r.extraZoneIds || []).map(zoneCode).join(', '), 'Extra zones'], ['skills', 'Skills'], ['mobile', 'Mobile']],
    search: r => [r.code, r.name, r.designation, r.skills, r.mobile, r.email, zoneLabel(r.mainZoneId)],
  },
  transport: {
    coll: 'zones', title: 'Transport', codePrefix: '', note: 'Zones are kept here (no separate Zone master). Repair and AMC have separate hourly rates.',
    fields: [
      { name: 'code', label: 'Zone code', required: true }, { name: 'name', label: 'Zone name', required: true }, { name: 'distance', label: 'Distance range / area' },
      { name: 'vehicle', label: 'Vehicle type' }, { name: 'repairRate', label: 'Repair rate per hour', type: 'number', money: true, required: true },
      { name: 'amcRate', label: 'AMC rate per hour', type: 'number', money: true, required: true },
      { name: 'roundTripHours', label: 'Default round-trip hours', type: 'number', step: '0.25', hint: 'Travel time per visit, used by the estimates' },
    ],
    columns: [['code', 'Zone'], ['name', 'Name'], ['distance', 'Distance range'], ['vehicle', 'Vehicle'], ['repairRate', 'Repair rate / h', { money: true }],
      ['amcRate', 'AMC rate / h', { money: true }], ['roundTripHours', 'Round trip (h)']],
    search: r => [r.code, r.name, r.distance, r.vehicle],
  },
  equipment: {
    coll: 'equipment', title: 'Equipment', codePrefix: 'EQ-', codePad: 2, note: 'Access equipment used on jobs (not customer assets).',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'supplier', label: 'Supplier' },
      { name: 'ownership', label: 'Ownership', type: 'select', options: ['Owned', 'Rented'], required: true },
      { name: 'basis', label: 'Rate basis', type: 'select', options: ['Day', 'Hour', 'Trip'], required: true },
      { name: 'rate', label: 'Rate per unit', type: 'number', money: true, required: true },
    ],
    columns: [['code', 'Code'], ['name', 'Name'], ['ownership', 'Ownership'], ['basis', 'Rate basis'], ['rate', 'Rate', { money: true }], ['supplier', 'Supplier']],
    search: r => [r.code, r.name, r.ownership, r.supplier],
  },
  labour: {
    coll: 'labour', title: 'Labour', codePrefix: 'LAB-', note: 'Repair and AMC rate sets. Hourly rate = monthly cost ÷ days per month ÷ hours per day; OT rate = hourly × 1.5.',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Trade / role', required: true },
      { name: 'rateSet', label: 'Rate set', type: 'select', options: ['Repair', 'AMC'], required: true },
      { name: 'skill', label: 'Skill level', type: 'select', options: ['Skilled', 'Semi-skilled', 'Unskilled'] },
      { name: 'monthly', label: 'Monthly cost', type: 'number', money: true, required: true },
      { name: 'days', label: 'Days per month', type: 'number', required: true }, { name: 'hours', label: 'Hours per day', type: 'number', required: true },
      { name: 'otMultiplier', label: 'OT multiplier', type: 'number', step: '0.1' },
    ],
    computed: [
      ['Rate per hour', r => round2(hourlyRate(r.monthly, r.days, r.hours)), { money: true }],
      ['OT rate per hour', r => round2(otRate(hourlyRate(r.monthly, r.days, r.hours), r.otMultiplier || 1.5)), { money: true }],
    ],
    columns: [['code', 'Code'], ['name', 'Trade / role'], ['rateSet', 'Rate set'], ['skill', 'Skill'], ['monthly', 'Monthly cost', { money: true }],
      [r => round2(hourlyRate(r.monthly, r.days, r.hours)), 'Rate / h', { money: true }], [r => round2(otRate(hourlyRate(r.monthly, r.days, r.hours), r.otMultiplier || 1.5)), 'OT rate / h', { money: true }]],
    search: r => [r.code, r.name, r.rateSet, r.skill],
  },
  product: {
    coll: 'products', title: 'Product', codePrefix: '', note: 'Shutter types and their labour factors (from the repair estimator).',
    fields: [{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Shutter type', required: true },
      { name: 'factor', label: 'Labour factor', type: 'number', step: '0.05', required: true }, { name: 'description', label: 'Description', type: 'textarea', cls: 'spanall' }],
    columns: [['code', 'Code'], ['name', 'Shutter type'], ['factor', 'Labour factor'], ['description', 'Description']],
    search: r => [r.code, r.name, r.description],
  },
  item: {
    coll: 'items', title: 'Material/Item', codePrefix: 'ITM-', codePad: 3, note: 'Technicians pick these in the site report materials table.',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Item', required: true }, { name: 'spec', label: 'Specification / grade' },
      { name: 'unit', label: 'Unit', type: 'select', options: ['Nos', 'Set', 'pcs', 'm', 'm²', 'kg', 'Can', 'Roll'], required: true },
      { name: 'rate', label: 'Rate per unit', type: 'number', money: true }, { name: 'wastage', label: 'Wastage %', type: 'number' },
      { name: 'leadDays', label: 'Lead time (days)', type: 'number' }, { name: 'category', label: 'Category', type: 'select', options: ['Spare part', 'Consumable'] },
    ],
    columns: [['code', 'Code'], ['name', 'Item'], ['spec', 'Spec / grade'], ['unit', 'Unit'], ['rate', 'Rate', { money: true }], ['wastage', 'Wastage %'], ['leadDays', 'Lead time (days)'], ['category', 'Category']],
    search: r => [r.code, r.name, r.spec, r.category],
  },
  size: {
    coll: 'sizes', title: 'Shutter Size', codePrefix: '',
    note: 'One rule in metres: a shutter gets the smallest size whose width and height both fit (blank = no limit). Feet are converted. AMC hours are from the AMC Labour_Matrix; repair hours are market-based.',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'order', label: 'Order', type: 'number', required: true },
      { name: 'maxWidth', label: 'Max width (m)', type: 'number', step: '0.1' }, { name: 'maxHeight', label: 'Max height (m)', type: 'number', step: '0.1' }, { type: 'gap' },
      { name: 'amcTeamHrs', label: 'AMC: team hours per shutter', type: 'number', step: '0.25' }, { name: 'amcExtraWorkers', label: 'AMC: extra workers', type: 'number' },
      { name: 'amcExtraHrs', label: 'AMC: extra worker hours', type: 'number', step: '0.25' },
      { name: 'repairTeamHrs', label: 'Repair: team hours', type: 'number', step: '0.25' }, { name: 'repairExtraWorkers', label: 'Repair: extra workers', type: 'number' },
      { name: 'repairExtraHrs', label: 'Repair: extra worker hours', type: 'number', step: '0.25' },
    ],
    columns: [['code', 'Size'], ['name', 'Name'], [r => (r.maxWidth == null ? 'larger' : `≤ ${r.maxWidth} m`), 'Width'], [r => (r.maxHeight == null ? 'larger' : `≤ ${r.maxHeight} m`), 'Height'],
      ['amcTeamHrs', 'AMC team h'], ['amcExtraWorkers', 'AMC extra workers'], ['repairTeamHrs', 'Repair team h'], ['repairExtraWorkers', 'Repair extra workers'], ['repairExtraHrs', 'Repair extra h']],
    search: r => [r.code, r.name],
    sort: (a, b) => a.order - b.order,
  },
  valueset: {
    coll: 'valueSets', title: 'Value Set Master', codePrefix: '',
    note: 'Dropdown lists. Screens show the description; the code is stored. System lists keep their codes; Extensible lists can get new values; User lists can change freely.',
    fields: [
      { name: 'code', label: 'List code', required: true }, { name: 'name', label: 'List name', required: true },
      { name: 'access', label: 'Access level', type: 'select', options: ['System', 'Extensible', 'User'], required: true },
      { name: 'values', label: 'Values', type: 'table', cls: 'spanall', columns: [['code', 'Code'], ['label', 'Description'], ['order', 'Order', 'number'], ['isDefault', 'Default', 'checkbox'], ['active', 'Active', 'checkbox']] },
    ],
    columns: [['code', 'Code'], ['name', 'List'], ['access', 'Access'], [r => r.values.filter(v => v.active).map(v => v.label).join(', '), 'Values']],
    search: r => [r.code, r.name, r.values.map(v => `${v.code} ${v.label}`)],
  },
  tax: {
    coll: 'taxes', title: 'Tax', codePrefix: '', note: 'Tax codes with rates and effective dates; used by estimation, quotation and invoice. Whether the company charges tax is set in Company Setup.',
    fields: [
      { name: 'code', label: 'Tax code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'rate', label: 'Rate %', type: 'number', step: '0.01', required: true },
      { name: 'from', label: 'Effective from', type: 'date', required: true }, { name: 'to', label: 'Effective to', type: 'date' },
      { name: 'category', label: 'Category', type: 'select', options: ['Standard-rated', 'Zero-rated', 'Exempt'] },
    ],
    columns: [['code', 'Code'], ['name', 'Name'], [r => `${r.rate}%`, 'Rate'], ['from', 'From'], ['to', 'To'], ['category', 'Category']],
    search: r => [r.code, r.name, r.category],
  },
  terms: {
    coll: 'terms', title: 'Terms', codePrefix: '', nameField: 'title', note: 'The texts. Which terms go on each document, and in which order, is set in Transaction Setup. {company} becomes the company name; {validity} the quotation validity days.',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'title', label: 'Title', required: true },
      { name: 'docType', label: 'Document type', type: 'select', options: ['Quotation', 'AMC', 'Invoice'], required: true },
      { name: 'text', label: 'Text', type: 'textarea', cls: 'spanall', required: true },
    ],
    columns: [['code', 'Code'], ['docType', 'Document'], ['text', 'Text', { wrap: true, company: true }]],
    search: r => [r.code, r.title, r.docType, r.text],
    sort: (a, b) => a.docType.localeCompare(b.docType) || a.order - b.order,
  },
};
