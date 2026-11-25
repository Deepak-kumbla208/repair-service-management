// Field definitions for the generic master screens (every master has a Code and a Name).
// Customer has its own screen (customer.js) because of contacts, sites and customer products; Product Size has its own
// (product-size.js) because each size set lists its sizes.
import * as store from '../core/store.js';
import { zones, zoneLabel, zoneCode, vsOptions, vsLabel, unitOptions } from '../core/lookups.js';
import { hourlyRate, otRate, round2 } from '../core/costing.js';
import { sizeSets, uoms } from '../core/products.js';

const zoneOptions = () => zones().map(z => ({ value: z.id, label: `${z.code} · ${z.name}` }));
const YES_NO = ['Yes', 'No'];
const hrs = v => (v == null || v === '' ? '' : `${Number(v)} h`);
// What a product's costing gives: its size set, its standard hours (repair / servicing) or its price.
function costText(p, company) {
  if (p.costedBy === 'HOURS') return `${hrs(p.repairHrs) || '–'} / ${hrs(p.servHrs) || '–'} per ${p.unit || 'Nos'}`;
  if (p.costedBy === 'FIXED') return `${Number(p.price || 0).toFixed(2)} per ${p.unit || 'Nos'}`;
  return store.get('sizeSets', p.sizeSetId)?.name || sizeSets()[0]?.name || '';
}

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
      { name: 'groups', label: 'Works on (product groups)', type: 'multi', options: () => vsOptions('PRODUCT_GROUP'), cls: 'spanall', hint: 'Listed first when a job or inspection has products of these groups' },
      { name: 'mobile', label: 'Mobile', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
    ],
    columns: [['code', 'Code'], ['name', 'Name'], ['designation', 'Designation'], ['type', 'Type'], [r => zoneLabel(r.mainZoneId), 'Main zone'],
      [r => (r.extraZoneIds || []).map(zoneCode).join(', '), 'Extra zones'], [r => (r.groups || []).map(g => vsLabel('PRODUCT_GROUP', g)).join(', '), 'Works on'], ['skills', 'Skills'], ['mobile', 'Mobile']],
    search: r => [r.code, r.name, r.designation, r.skills, r.mobile, r.email, zoneLabel(r.mainZoneId)],
  },
  transport: {
    coll: 'zones', title: 'Transport', codePrefix: '', note: 'Zones are kept here (no separate Zone master). Repair and AMC have separate hourly rates.',
    fields: [
      { name: 'code', label: 'Zone code', required: true }, { name: 'name', label: 'Zone name', required: true }, { name: 'distance', label: 'Distance range / area' },
      { name: 'vehicle', label: 'Vehicle type' }, { name: 'repairRate', label: 'Repair rate per hour', type: 'number', money: true, required: true },
      { name: 'amcRate', label: 'AMC rate per hour', type: 'number', money: true, required: true },
      { name: 'roundTripHours', label: 'Travel hours per trip (there and back)', type: 'number', step: '0.25', hint: 'Fills the transport hours in repair and AMC estimates' },
    ],
    columns: [['code', 'Zone'], ['name', 'Name'], ['distance', 'Distance range'], ['vehicle', 'Vehicle'], ['repairRate', 'Repair rate / h', { money: true }],
      ['amcRate', 'AMC rate / h', { money: true }], ['roundTripHours', 'Travel h per trip']],
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
    coll: 'products', title: 'Product', codePrefix: '',
    note: 'Every product of every trade. By size: the hours come from its size set in Product Size. Standard hours: no size; hours per unit typed here. Fixed price: no labour and no site details.',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Product', required: true },
      { name: 'groupCode', label: 'Group', type: 'select', options: () => vsOptions('PRODUCT_GROUP'), required: true },
      { name: 'costedBy', label: 'Costed by', type: 'select', options: () => vsOptions('COSTING_METHOD'), required: true, blank: false },
      { name: 'sizeSetId', label: 'Size set', type: 'select', options: () => sizeSets().map(z => ({ value: z.id, label: `${z.name}${z.unit ? ` (${z.unit})` : ''}` })), required: true, showIf: d => d.costedBy === 'SIZE' },
      { name: 'unit', label: 'Unit', type: 'select', options: () => unitOptions(), required: true, blank: false },
      { name: 'repairHrs', label: 'Repair hours per unit (team of 2)', type: 'number', step: '0.05', required: true, showIf: d => d.costedBy === 'HOURS' },
      { name: 'servHrs', label: 'Servicing hours per visit (AMC, General Servicing)', type: 'number', step: '0.05', showIf: d => d.costedBy === 'HOURS' },
      { name: 'extraWorkers', label: 'Repair: extra workers', type: 'number', showIf: d => d.costedBy === 'HOURS' },
      { name: 'extraHrs', label: 'Repair: hours per extra worker, per unit', type: 'number', step: '0.05', showIf: d => d.costedBy === 'HOURS' },
      { name: 'price', label: 'Price per unit', type: 'number', money: true, required: true, showIf: d => d.costedBy === 'FIXED', hint: 'Charged as it is: no overhead or markup on top' },
      { name: 'keep', label: 'Customer product', type: 'select', options: YES_NO, blank: false, showIf: d => d.costedBy !== 'FIXED', hint: 'Yes: once recorded on site it joins the site\'s Customer products (a pump, a panel); No: work only (tape by the metre)' },
      { name: 'checklist', label: 'AMC check list', type: 'select', options: () => vsOptions('CHECK_LIST'), showIf: d => d.costedBy !== 'FIXED' },
      { name: 'description', label: 'Description', type: 'textarea', cls: 'spanall' },
    ],
    defaults: () => ({ costedBy: 'SIZE', sizeSetId: sizeSets()[0]?.id || '', unit: 'Nos', keep: 'Yes', checklist: 'GENERAL' }),
    columns: [['code', 'Code'], ['name', 'Product'], [r => vsLabel('COSTING_METHOD', r.costedBy || 'SIZE'), 'Costed by'], [(r, c) => costText(r, c), 'Size set / hours / price'],
      ['unit', 'Unit'], [r => (r.costedBy === 'FIXED' ? 'No' : r.keep || 'Yes'), 'Customer product'], [r => vsLabel('CHECK_LIST', r.checklist), 'Check list']],
    groupBy: { label: r => vsLabel('PRODUCT_GROUP', r.groupCode) || 'No group', order: () => vsOptions('PRODUCT_GROUP').map(o => o.label) },
    search: r => [r.code, r.name, r.description, vsLabel('PRODUCT_GROUP', r.groupCode), vsLabel('COSTING_METHOD', r.costedBy)],
  },
  uom: {
    coll: 'uoms', title: 'Unit of Measure', codePrefix: '',
    note: 'The units every product, part and document row uses. The code is what documents print ("15 m", "2 Nos"). Whole numbers only: a quantity in this unit cannot be 1.5.',
    fields: [
      { name: 'code', label: 'Code (printed)', required: true }, { name: 'name', label: 'Name', required: true },
      { name: 'whole', label: 'Whole numbers only', type: 'select', options: YES_NO, blank: false },
      { name: 'convertsTo', label: 'Converts to', type: 'select', options: () => uoms().map(u => u.code), hint: 'e.g. 1 ft = 0.3048 m' },
      { name: 'factor', label: 'Factor', type: 'number', step: '0.0001' },
    ],
    defaults: () => ({ whole: 'Yes' }),
    columns: [['code', 'Code'], ['name', 'Name'], ['whole', 'Whole numbers only'], [r => (r.convertsTo ? `1 ${r.code} = ${r.factor} ${r.convertsTo}` : ''), 'Converts to']],
    search: r => [r.code, r.name],
    sort: (a, b) => (Number(a.order) || 99) - (Number(b.order) || 99) || String(a.code).localeCompare(String(b.code)),
  },
  item: {
    coll: 'items', title: 'Material/Item', codePrefix: 'ITM-', codePad: 3, note: 'Parts and materials of every trade, grouped like the products. Technicians pick these in the site report materials table.',
    fields: [
      { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Item', required: true },
      { name: 'groupCode', label: 'Group', type: 'select', options: () => vsOptions('PRODUCT_GROUP'), required: true }, { name: 'spec', label: 'Specification / grade' },
      { name: 'unit', label: 'Unit', type: 'select', options: () => unitOptions(), required: true },
      { name: 'rate', label: 'Rate per unit', type: 'number', money: true }, { name: 'wastage', label: 'Wastage %', type: 'number' },
      { name: 'leadDays', label: 'Lead time (days)', type: 'number' }, { name: 'category', label: 'Category', type: 'select', options: ['Spare part', 'Consumable'] },
    ],
    columns: [['code', 'Code'], ['name', 'Item'], ['spec', 'Spec / grade'], ['unit', 'Unit'], ['rate', 'Rate', { money: true }], ['wastage', 'Wastage %'], ['leadDays', 'Lead time (days)'], ['category', 'Category']],
    groupBy: { label: r => vsLabel('PRODUCT_GROUP', r.groupCode) || 'No group', order: () => vsOptions('PRODUCT_GROUP').map(o => o.label) },
    search: r => [r.code, r.name, r.spec, r.category, vsLabel('PRODUCT_GROUP', r.groupCode)],
  },
  valueset: {
    coll: 'valueSets', title: 'Value Set Master', codePrefix: '',
    note: 'Dropdown lists. Screens show the description; the code is stored. System lists keep their codes; Extensible lists can get new values; User lists can change freely.',
    fields: [
      { name: 'code', label: 'List code', required: true }, { name: 'name', label: 'List name', required: true },
      { name: 'access', label: 'Access level', type: 'select', options: ['System', 'Extensible', 'User'], required: true },
      { name: 'values', label: 'Values', type: 'table', cls: 'spanall', columns: d => [['code', 'Code'], ['label', 'Description'],
        // The AMC check list: each item names its check list (Value Set "Check List") and whom it applies to.
        ...(d.code === 'AMC_CHECKLIST' ? [['list', 'Check list'], ['applies', 'Applies (ALL / MOTOR / FIRE)'], ['hint', 'Hint']] : []),
        ['order', 'Order', 'number'], ['isDefault', 'Default', 'checkbox'], ['active', 'Active', 'checkbox']] },
    ],
    columns: [['code', 'Code'], ['name', 'List'], ['access', 'Access'], [r => r.values.filter(v => v.active).map(v => v.label).join(', '), 'Values']],
    search: r => [r.code, r.name, r.values.map(v => `${v.code} ${v.label}`)],
  },
  tax: {
    coll: 'taxes', title: 'Tax', codePrefix: '', note: 'Tax codes with rates and effective dates; used by estimation, quotation and invoice. Tax on documents (on or off) is switched in Admin Setup › Company Setup › Registration and tax.',
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
