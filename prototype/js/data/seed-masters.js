// Masters for the two demo companies. Demo Engineering uses the team lead's sample rates and data
// (company name, address and UEN are dummies); Gulf Demo Doors is made up.
import { classifySize, toMetres } from '../core/costing.js';

const T0 = new Date().toISOString();
const base = (tenantId, id, data) => ({ id, tenantId, status: 'Active', createdAt: T0, updatedAt: T0, ...data });

// The client's business activities as product groups (plus doors and shutters), and the AMC check lists products use.
export const PRODUCT_GROUPS = [['SHD', 'Shutters & doors'], ['PLB', 'Plumbing & sanitary'], ['MEW', 'M&E works'], ['ELP', 'LV/MV panels & switchgear'],
  ['LPS', 'Lightning protection'], ['SPS', 'Surge protection'], ['PUB', 'PUB submissions'], ['BIM', 'BIM services']];
export const CHECK_LISTS = [['GENERAL', 'Shutters & doors'], ['PUMP', 'Pump'], ['DB', 'DB panel'], ['SPD', 'SPD'], ['EARTH', 'Earth pit'], ['TANK', 'Water tank'], ['VALVE', 'Valve'],
  ['GREASE', 'Grease trap'], ['HEATER', 'Water heater'], ['AIRCON', 'Aircon'], ['FAN', 'Fan'], ['GEN', 'Generator'], ['MVSG', 'MV switchgear'], ['LPS', 'Lightning protection system']];

// ---------- Value Set Master: the register's 7 lists plus the lists added in the plan review ----------
const VALUE_SETS = [
  ['PRIORITY', 'Priority', 'User', ['High', 'Medium', 'Low']],
  ['ENQ_STATUS', 'Enquiry Status', 'User', ['Hot', 'Warm', 'Cold']],
  ['ENQ_CHANNEL', 'Enquiry Channel', 'User', ['Call', 'Email', 'WhatsApp', 'Other']],
  ['ENQ_TYPE', 'Enquiry Type', 'System', [['REPAIR', 'Repair'], ['AMC', 'AMC'], ['GS', 'General Servicing']]],
  ['JOB_STATUS', 'Job Status', 'Extensible', ['Confirmed', 'Pending', 'Cancelled']],
  ['QUOT_STATUS', 'Quotation Status', 'Extensible', ['Quoted', 'Not Quoted']],
  ['YES_NO', 'Yes / No', 'System', ['Yes', 'No']],
  ['COSTING_LEVEL', 'Costing Level', 'System', ['Job', 'Line']],
  ['SHARED_COSTS', 'Shared Costs', 'System', [['SPREAD', 'Spread into lines'], ['OWN_LINE', 'Show as own line']]],
  ['PAYMENT_TERMS', 'Payment Terms', 'Extensible', [['IMMEDIATE', 'Immediate'], ['D7', '7 days'], ['D15', '15 days'], ['D30', '30 days']]],
  ['WORK_COMPLETION', 'Work Completion Status', 'System', [['NOT_STARTED', 'Not started'], ['IN_PROGRESS', 'In progress'], ['COMPLETED', 'Completed']]],
  ['PAYMENT_RECEIVED', 'Payment Received', 'System', [['NOT_PAID', 'Not paid'], ['PARTLY', 'Partly paid'], ['PAID', 'Paid']]],
  ['STAGE', 'Stage (hidden, for the dashboard)', 'System', ['New', 'Assessment', 'Quoted', 'Won', 'Lost']],
  ['MARGIN_BASIS', 'Margin Basis', 'System', [['MARKUP', 'Markup on cost'], ['MARGIN', 'Margin on price']]],
  ['OVERHEAD_BASIS', 'Overhead Basis', 'System', [['PCT', '% of direct cost'], ['FIXED', 'Fixed amount']]],
  ['PAYMENT_METHOD', 'Payment Method', 'Extensible', [['CASH', 'Cash'], ['CHEQUE', 'Cheque'], ['BANK', 'Bank transfer'], ['PAYNOW', 'PayNow']]],
  ['ACCEPT_METHOD', 'Acceptance Method', 'Extensible', [['PO', 'Purchase order'], ['SIGNED', 'Signed quotation'], ['EMAIL', 'Email'], ['WHATSAPP', 'WhatsApp']]],
  ['WORK_DONE', 'Work Done Status', 'System', [['DONE', 'Done'], ['PARTLY', 'Partly done'], ['NOT_DONE', 'Not done']]],
  // Site viewing report findings: Urgent = not safe to use. The third item marks the default.
  ['FINDING_PRIORITY', 'Finding Priority', 'System', [['URGENT', 'Urgent', false], ['NORMAL', 'Normal', true], ['LATER', 'Can wait', false]]],
  // Why a quotation line is not wanted (Record acceptance, later work).
  ['NOT_WANTED_REASON', 'Not Wanted Reason', 'Extensible', [['PRICE', 'Price too high'], ['OTHER_CO', 'Another company'], ['NOT_NEEDED', 'Not needed'], ['OTHER', 'Other']]],
  // Products of every trade in one Product master (user, 25 Nov 2026): their group, how each is costed, and the AMC
  // check list it uses.
  // The groups follow the client's business activities, plus doors and shutters.
  ['PRODUCT_GROUP', 'Product Group', 'Extensible', PRODUCT_GROUPS],
  ['COSTING_METHOD', 'Costing Method', 'System', [['SIZE', 'By size'], ['HOURS', 'Standard hours'], ['FIXED', 'Fixed price']]],
  ['CHECK_LIST', 'Check List', 'Extensible', CHECK_LISTS],
];

// inactive: value codes switched off for this company (e.g. PayNow outside Singapore).
export function valueSets(t, inactive = []) {
  return VALUE_SETS.map(([code, name, access, vals]) => base(t, `vs_${t}_${code}`, {
    code, name, access,
    values: vals.map((v, i) => {
      const [c, label, def] = Array.isArray(v) ? v : [v.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), v];
      return { code: c, label, order: i + 1, isDefault: def ?? (i === 0 && code !== 'ENQ_STATUS'), active: !inactive.includes(`${code}.${c}`) };
    }),
  }));
}

// ---------- Product Size: size sets, each with its sizes ----------
// Width × height (the first set, one rule in metres; AMC hours from Labour_Matrix, repair hours market-based) and
// one-figure sets for the new trades (made-up hours, to be replaced by the company's own job times).
export function sizeSets(t) {
  return [['WH', 'Width × height', 'WH', 'm'], ['KW', 'Motor power', 'ONE', 'kW'], ['AMP', 'Rated current', 'ONE', 'A'],
    ['COOL', 'Cooling capacity', 'ONE', 'kW'], ['KVA', 'Generator power', 'ONE', 'kVA'], ['TANK', 'Tank capacity', 'ONE', 'm³']]
    .map(([code, name, measure, unit], i) => base(t, `set_${t}_${code}`, { code, name, measure, unit, order: i + 1 }));
}
// [code, name, up to, servicing h, servicing extra workers, their h, repair h, repair extra workers, their h], per set.
const ONE_FIGURE = {
  KW: [['S', 'Small', 2.2, 0.5, 0, 0, 2, 0, 0], ['M', 'Medium', 7.5, 1, 0, 0, 3, 0, 0], ['L', 'Large', 15, 1.5, 0, 0, 4, 1, 4], ['XL', 'Extra Large', null, 2.5, 1, 2.5, 6, 2, 6]],
  AMP: [['S', 'Small', 100, 0.5, 0, 0, 2, 0, 0], ['M', 'Medium', 400, 1, 0, 0, 4, 0, 0], ['L', 'Large', null, 3, 0, 0, 8, 1, 8]],
  COOL: [['S', 'Small', 3.5, 0.75, 0, 0, 1.5, 0, 0], ['M', 'Medium', 7, 1, 0, 0, 2, 0, 0], ['L', 'Large', 14, 1.5, 0, 0, 3, 0, 0], ['XL', 'Extra Large', null, 2.5, 0, 0, 5, 1, 5]],
  KVA: [['S', 'Small', 50, 2, 0, 0, 4, 0, 0], ['M', 'Medium', 200, 3, 0, 0, 6, 0, 0], ['L', 'Large', 500, 4, 0, 0, 8, 1, 8], ['XL', 'Extra Large', null, 6, 1, 6, 12, 2, 12]],
  TANK: [['S', 'Small', 5, 2, 0, 0, 3, 0, 0], ['M', 'Medium', 20, 4, 0, 0, 5, 0, 0], ['L', 'Large', 50, 6, 0, 0, 8, 1, 8], ['XL', 'Extra Large', null, 8, 1, 8, 12, 2, 12]],
};
export function oneFigureSizes(t) {
  return Object.entries(ONE_FIGURE).flatMap(([set, rows]) => rows.map(([code, name, maxValue, amcTeamHrs, amcExtraWorkers, amcExtraHrs, repairTeamHrs, repairExtraWorkers, repairExtraHrs], i) =>
    base(t, `siz_${t}_${set}_${code}`, { setId: `set_${t}_${set}`, code, name, order: i + 1, maxValue, amcTeamHrs, amcExtraWorkers, amcExtraHrs, repairTeamHrs, repairExtraWorkers, repairExtraHrs, tags: { repairTeamHrs: 'made-up' } })));
}
// ---------- Unit of Measure: the code is what documents print ("15 m", "2 Nos") ----------
export function uoms(t) {
  return [['Nos', 'Numbers', 'Yes'], ['Set', 'Set', 'Yes'], ['pcs', 'Pieces', 'Yes'], ['Lot', 'Lot', 'Yes'], ['Floor', 'Floor', 'Yes'], ['Can', 'Can', 'Yes'], ['Roll', 'Roll', 'Yes'],
    ['m', 'Metre', 'No'], ['ft', 'Foot', 'No', 'm', 0.3048], ['m²', 'Square metre', 'No'], ['kg', 'Kilogram', 'No'], ['kW', 'Kilowatt', 'No'], ['A', 'Ampere', 'No'], ['h', 'Hour', 'No'],
    ['kVA', 'Kilovolt-ampere', 'No'], ['m³', 'Cubic metre', 'No'], ['Point', 'Point', 'Yes']]
    .map(([code, name, whole, convertsTo, factor], i) => base(t, `uom_${t}_${i + 1}`, { code, name, whole, convertsTo: convertsTo || '', factor: factor || null, order: i + 1 }));
}
function sizes(t) {
  return [
    ['S', 'Small', 3, 3, 0.5, 0, 0, 2, 0, 0],
    ['M', 'Medium', 5, 4, 1, 0, 0, 3, 0, 0],
    ['L', 'Large', 7, 5, 1.5, 1, 1.5, 4, 1, 4],
    ['XL', 'Extra Large', null, null, 2.5, 2, 2.5, 6, 2, 6],
  ].map(([code, name, maxWidth, maxHeight, amcTeamHrs, amcExtraWorkers, amcExtraHrs, repairTeamHrs, repairExtraWorkers, repairExtraHrs], i) =>
    base(t, `siz_${t}_${code}`, { setId: `set_${t}_WH`, code, name, order: i + 1, maxWidth, maxHeight, amcTeamHrs, amcExtraWorkers, amcExtraHrs, repairTeamHrs, repairExtraWorkers, repairExtraHrs, tags: { repairTeamHrs: 'market-based' } }));
}

// ---------- Product: every trade in one list (user, 25 Nov 2026) ----------
// Doors and shutters are costed by size (Width × height); allTrades adds the client's new trades (made-up hours and
// prices, to be replaced by the company's own).
export const PRODUCT_DEFAULTS = { groupCode: 'SHD', costedBy: 'SIZE', unit: 'Nos', keep: 'Yes', checklist: 'GENERAL', repairHrs: null, servHrs: null, extraWorkers: null, extraHrs: null, price: null };
export function products(t, allTrades = false) {
  const doors = [['RS', 'Rolling shutter'], ['CS', 'Collapsible shutter'], ['SF', 'Sliding / folding'], ['SD', 'Sectional door'], ['MR', 'Motorised rolling']]
    .map(([code, name]) => base(t, `prd_${t}_${code}`, { code, name, description: '', ...PRODUCT_DEFAULTS, sizeSetId: `set_${t}_WH` }));
  if (!allTrades) return doors;
  return [...doors, ...tradeProducts(t)];
}
// The client's business activities (user, 25 Nov 2026), one group each.
// [code, name, group, costedBy, size set, unit, repair h, servicing h, extra workers, extra h, price, keep, check list, description]
export const TRADE_PRODUCTS = [
  // 1. Plumbing and sanitary installation, replacement and maintenance
  ['BP', 'Booster pump', 'PLB', 'SIZE', 'KW', 'Nos', null, null, null, null, null, 'Yes', 'PUMP', 'Booster / transfer pump set'],
  ['SEP', 'Sump / sewage ejector pump', 'PLB', 'SIZE', 'KW', 'Nos', null, null, null, null, null, 'Yes', 'PUMP', ''],
  ['WT', 'Water storage tank', 'PLB', 'SIZE', 'TANK', 'Nos', null, null, null, null, null, 'Yes', 'TANK', 'Cleaning, repair and yearly inspection'],
  ['WH', 'Water heater', 'PLB', 'HOURS', '', 'Nos', 1.5, 0.5, 0, 0, null, 'Yes', 'HEATER', ''],
  ['SAN', 'Sanitary fitting (tap, WC, basin)', 'PLB', 'HOURS', '', 'Nos', 0.5, null, 0, 0, null, 'No', '', ''],
  ['PIPE', 'Water / sanitary pipework', 'PLB', 'HOURS', '', 'm', 0.3, null, 0, 0, null, 'No', '', 'Per metre laid or replaced'],
  ['VLV', 'Valve / backflow preventer', 'PLB', 'HOURS', '', 'Nos', 1, 0.25, 0, 0, null, 'Yes', 'VALVE', ''],
  ['GT', 'Grease trap', 'PLB', 'HOURS', '', 'Nos', 2, 1, 0, 0, null, 'Yes', 'GREASE', ''],
  ['DRN', 'Drain choke clearing', 'PLB', 'HOURS', '', 'Nos', 1.5, null, 0, 0, null, 'No', '', ''],
  // 2. M&E installation and maintenance works (residential, condominium, industrial)
  ['AC', 'Air-conditioning unit', 'MEW', 'SIZE', 'COOL', 'Nos', null, null, null, null, null, 'Yes', 'AIRCON', 'Split unit or fan coil unit'],
  ['FAN', 'Ventilation / exhaust fan', 'MEW', 'SIZE', 'KW', 'Nos', null, null, null, null, null, 'Yes', 'FAN', ''],
  ['GEN', 'Standby generator', 'MEW', 'SIZE', 'KVA', 'Nos', null, null, null, null, null, 'Yes', 'GEN', ''],
  ['LTP', 'Lighting point', 'MEW', 'HOURS', '', 'Point', 0.5, null, 0, 0, null, 'No', '', ''],
  ['PWP', 'Power point / socket', 'MEW', 'HOURS', '', 'Point', 0.5, null, 0, 0, null, 'No', '', ''],
  ['CBL', 'Cable / wiring run', 'MEW', 'HOURS', '', 'm', 0.1, null, 0, 0, null, 'No', '', 'Per metre, with conduit or trunking'],
  // 3. Supply and installation of LV and MV electrical panels and switchgear
  ['DB', 'Distribution board', 'ELP', 'SIZE', 'AMP', 'Nos', null, null, null, null, null, 'Yes', 'DB', ''],
  ['LVS', 'LV switchboard / main switchboard', 'ELP', 'SIZE', 'AMP', 'Nos', null, null, null, null, null, 'Yes', 'DB', ''],
  ['MVS', 'MV switchgear (22 kV)', 'ELP', 'HOURS', '', 'Nos', 8, 4, 1, 8, null, 'Yes', 'MVSG', 'Ring main unit or MV panel; licensed HV electrical worker'],
  ['CAP', 'Capacitor bank (power factor)', 'ELP', 'HOURS', '', 'Nos', 3, 1, 0, 0, null, 'Yes', 'DB', ''],
  ['TSC', 'Thermal scan of a panel', 'ELP', 'HOURS', '', 'Nos', 0.5, null, 0, 0, null, 'No', '', 'Infrared scan with a short report'],
  // 4. Design, supply and installation of lightning protection systems
  ['LPS', 'Lightning protection system', 'LPS', 'HOURS', '', 'Nos', 6, 3, 0, 0, null, 'Yes', 'LPS', 'Whole building: air terminals, conductors, earthing'],
  ['AT', 'Air terminal / finial', 'LPS', 'HOURS', '', 'Nos', 1, null, 0, 0, null, 'No', '', ''],
  ['LPT', 'Lightning conductor tape', 'LPS', 'HOURS', '', 'm', 0.1, null, 0, 0, null, 'No', '', 'Copper tape, per metre fitted'],
  ['EP', 'Earth pit', 'LPS', 'HOURS', '', 'Nos', 1.5, 0.5, 0, 0, null, 'Yes', 'EARTH', 'Lightning protection earth pit'],
  ['LPD', 'Lightning protection design and drawings', 'LPS', 'FIXED', '', 'Lot', null, null, null, null, 1500, 'No', '', 'Risk assessment and layout drawings'],
  // 5. Supply and installation of surge protection systems
  ['SPD', 'Surge protection device (power)', 'SPS', 'HOURS', '', 'Nos', 1, 0.25, 0, 0, null, 'Yes', 'SPD', 'Type 1 or Type 2, at the switchboard or DB'],
  ['SPDD', 'Surge protection device (data / telephone)', 'SPS', 'HOURS', '', 'Nos', 0.5, 0.25, 0, 0, null, 'Yes', 'SPD', ''],
  // 6. Services for PUB submissions
  ['PUB', 'Sanitary plan submission (PUB)', 'PUB', 'FIXED', '', 'Lot', null, null, null, null, 800, 'No', '', 'Preparing and submitting the sanitary plan to PUB'],
  ['WSP', 'Water service plan submission (PUB)', 'PUB', 'FIXED', '', 'Lot', null, null, null, null, 600, 'No', '', ''],
  ['SDP', 'Sewer / drainage plan submission (PUB)', 'PUB', 'FIXED', '', 'Lot', null, null, null, null, 900, 'No', '', ''],
  ['CCA', 'Completion certificate application (PUB)', 'PUB', 'FIXED', '', 'Lot', null, null, null, null, 400, 'No', '', ''],
  // 7. BIM services
  ['BIM', 'BIM model', 'BIM', 'FIXED', '', 'Floor', null, null, null, null, 1200, 'No', '', 'BIM model, per floor'],
  ['MEPC', 'MEP coordination / clash check', 'BIM', 'FIXED', '', 'Floor', null, null, null, null, 1500, 'No', '', 'Per floor'],
  ['ABM', 'As-built model and drawings', 'BIM', 'FIXED', '', 'Lot', null, null, null, null, 2000, 'No', '', ''],
];
export function tradeProducts(t) {
  return TRADE_PRODUCTS.map(([code, name, groupCode, costedBy, set, unit, repairHrs, servHrs, extraWorkers, extraHrs, price, keep, checklist, description]) => base(t, `prd_${t}_${code}`, {
    code, name, description, groupCode, costedBy, sizeSetId: set ? `set_${t}_${set}` : '', unit, repairHrs, servHrs, extraWorkers, extraHrs, price, keep, checklist,
    tags: costedBy === 'FIXED' ? { price: 'made-up' } : costedBy === 'HOURS' ? { repairHrs: 'made-up' } : {} }));
}

// ---------- Material/Item: parts and materials of every trade, grouped like the products ----------
// [code, name, spec, unit, rate, wastage %, lead days, consumable, group]. Doors and shutters: the team lead's sample
// rates; the rest are made-up placeholders.
export const TRADE_ITEMS = [
  ['ITM-011', 'Pump mechanical seal', 'to suit the pump model', 'Nos', 120, 0, 5, false, 'PLB'], ['ITM-012', 'Pump pressure switch', '', 'Nos', 85, 0, 3, false, 'PLB'],
  ['ITM-013', 'Pump bearing set', '', 'Set', 60, 0, 5, false, 'PLB'], ['ITM-014', 'Pressure gauge', '0–10 bar', 'Nos', 45, 0, 2, false, 'PLB'],
  ['ITM-015', 'Gate valve', 'brass, 25 mm', 'Nos', 38, 0, 2, false, 'PLB'], ['ITM-016', 'Non-return valve', '25 mm', 'Nos', 42, 0, 2, false, 'PLB'],
  ['ITM-017', 'Float valve', 'for water tanks', 'Nos', 55, 0, 3, false, 'PLB'], ['ITM-018', 'PPR water pipe', '25 mm', 'm', 6.5, 5, 2, false, 'PLB'],
  ['ITM-019', 'uPVC sanitary pipe', '100 mm', 'm', 14, 5, 2, false, 'PLB'], ['ITM-020', 'WC cistern / flush valve set', '', 'Set', 95, 0, 3, false, 'PLB'],
  ['ITM-021', 'Basin mixer tap', '', 'Nos', 110, 0, 3, false, 'PLB'], ['ITM-022', 'Water heater element', '3 kW', 'Nos', 75, 0, 5, false, 'PLB'],
  ['ITM-023', 'Thread seal tape', '', 'Roll', 1.5, 0, 0, true, 'PLB'], ['ITM-024', 'Solvent cement', 'for uPVC', 'Can', 12, 0, 0, true, 'PLB'],
  ['ITM-025', 'Refrigerant R32', '', 'kg', 35, 0, 2, true, 'MEW'], ['ITM-026', 'Aircon fan motor', '', 'Nos', 160, 0, 7, false, 'MEW'],
  ['ITM-027', 'Aircon run capacitor', '', 'Nos', 25, 0, 2, false, 'MEW'], ['ITM-028', 'Aircon filter set', '', 'Set', 30, 0, 2, false, 'MEW'],
  ['ITM-029', 'Exhaust fan motor', '0.37 kW', 'Nos', 180, 0, 7, false, 'MEW'], ['ITM-030', 'LED batten', '1.2 m', 'Nos', 28, 0, 2, false, 'MEW'],
  ['ITM-031', 'Switched socket outlet', '13 A', 'Nos', 12, 0, 1, false, 'MEW'], ['ITM-032', 'PVC cable', '2.5 mm²', 'm', 1.8, 10, 1, false, 'MEW'],
  ['ITM-033', 'PVC conduit', '20 mm', 'm', 2.2, 10, 1, false, 'MEW'], ['ITM-034', 'Generator battery', '12 V', 'Nos', 220, 0, 3, false, 'MEW'],
  ['ITM-035', 'Generator oil and filter kit', '', 'Set', 150, 0, 3, false, 'MEW'],
  ['ITM-036', 'MCB', '20 A single pole', 'Nos', 15, 0, 2, false, 'ELP'], ['ITM-037', 'RCCB', '63 A, 30 mA', 'Nos', 95, 0, 3, false, 'ELP'],
  ['ITM-038', 'MCCB', '250 A', 'Nos', 650, 0, 10, false, 'ELP'], ['ITM-039', 'Copper busbar', '25 × 5 mm', 'm', 85, 5, 5, false, 'ELP'],
  ['ITM-040', 'Cable lug set', '', 'Set', 25, 0, 1, true, 'ELP'], ['ITM-041', 'Panel door lock', '', 'Nos', 18, 0, 2, false, 'ELP'],
  ['ITM-042', 'Circuit label set', '', 'Set', 10, 0, 0, true, 'ELP'], ['ITM-043', 'PFC capacitor', '25 kVAr', 'Nos', 320, 0, 10, false, 'ELP'],
  ['ITM-044', 'Copper conductor tape', '25 × 3 mm', 'm', 18, 5, 5, false, 'LPS'], ['ITM-045', 'Air terminal', '1 m', 'Nos', 65, 0, 5, false, 'LPS'],
  ['ITM-046', 'Tape clip / saddle', '', 'Nos', 2.5, 5, 3, false, 'LPS'], ['ITM-047', 'Test clamp', '', 'Nos', 22, 0, 3, false, 'LPS'],
  ['ITM-048', 'Earth rod', '1.2 m, copper-bonded', 'Nos', 45, 0, 5, false, 'LPS'], ['ITM-049', 'Earth pit chamber with cover', '', 'Nos', 85, 0, 5, false, 'LPS'],
  ['ITM-050', 'Earth enhancement compound', '', 'kg', 6, 0, 3, true, 'LPS'],
  ['ITM-051', 'SPD Type 2', '3-phase, 40 kA', 'Nos', 380, 0, 7, false, 'SPS'], ['ITM-052', 'SPD Type 1+2', '3-phase', 'Nos', 850, 0, 10, false, 'SPS'],
  ['ITM-053', 'SPD for data / telephone line', '', 'Nos', 95, 0, 7, false, 'SPS'], ['ITM-054', 'SPD back-up fuse set', '', 'Set', 60, 0, 3, false, 'SPS'],
];
export const tradeItems = (t, from = 11) => TRADE_ITEMS.map(([code, name, spec, unit, rate, wastage, leadDays, consumable, groupCode], i) =>
  base(t, `itm_${t}_${from + i}`, { code, name, spec, unit, rate, wastage, leadDays, category: consumable ? 'Consumable' : 'Spare part', groupCode, placeholders: ['rate'] }));

const QUOTE_TERMS = [
  'This quotation is based on a visual inspection only. A full assessment is not possible until the product has been opened and tested.',
  'Any additional parts needing repair or replacement will be communicated to the customer before work proceeds. Additional work will start only after the customer’s official confirmation.',
  '{company} reserves the right to revise this quotation if further faults are found after inspection.',
  'Customers with a valid Maintenance Contract with {company} receive priority service and discounted charges.',
  'The quoted price covers normal office hours (8:30 am to 5:30 pm). Work after 5:30 pm is charged at 1.5 times the quoted rate.',
  'This quotation is valid for {validity} days from the date of issue.',
];

function terms(t, invoiceTerms) {
  const q = QUOTE_TERMS.map((text, i) => base(t, `trm_${t}_Q${i + 1}`, { code: `QT-0${i + 1}`, title: `Quotation term ${i + 1}`, docType: 'Quotation', order: i + 1, text, isDefault: true }));
  const inv = invoiceTerms.map(([text, ph], i) => base(t, `trm_${t}_I${i + 1}`, { code: `INV-0${i + 1}`, title: `Invoice term ${i + 1}`, docType: 'Invoice', order: i + 1, text, isDefault: true, placeholders: ph ? ['text'] : [] }));
  return [...q, ...inv];
}

// Customer product (register entry) of a door or shutter: width × height in metres, sized by the Width × height set.
function shutter(t, siteId, n, [tag, location, productCode, w, h, unit, motor], sizeRows) {
  const widthM = toMetres(w, unit), heightM = toMetres(h, unit);
  return { id: `sht_${siteId}_${n}`, tag, location, productId: `prd_${t}_${productCode}`, width: w, height: h, unit, widthM, heightM, sizeCode: classifySize(widthM, heightM, sizeRows), motor: motor || '', serial: '', installDate: '', status: 'Active', source: 'Sample data' };
}

export function customer(t, code, data, sites, sizeRows) {
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

// A made-up condominium with products of the new trades (user, 25 Nov 2026): a car park shutter (Width × height), a
// booster pump (Motor power), a distribution board (Rated current), a surge protection device, three earth pits (no
// size) and two aircon units (Cooling capacity).
function mixedCustomer(t, sizeRows) {
  const c = customer(t, 'CUS-0010', { name: 'Demo Towers MCST', uen: '', taxRegistered: false, paymentTerm: 'D30', phone: '9890 1234', email: 'agent@demo-towers.example', address: '8 Demo Rise',
    contacts: [{ id: `con_${t}_10`, name: 'Managing Agent', designation: 'Condominium management', mobile: '9890 1234', email: 'agent@demo-towers.example', primary: true }] },
  [{ name: 'Demo Towers condominium', address: '8 Demo Rise', zone: 'A', access: 'Plant rooms: key at the guard house', shutters: [['RS-1', 'Car park side gate', 'RS', 3, 2.8, 'm', '']] }], sizeRows);
  const site = c.sites[0];
  const p = (n, tag, location, code, sizeCode, measure, motor = '') => ({ id: `sht_${site.id}_${n}`, tag, location, productId: `prd_${t}_${code}`, width: null, height: null, unit: 'm', widthM: null, heightM: null,
    measure, sizeCode, motor, serial: '', installDate: '', status: 'Active', source: 'Sample data' });
  site.shutters.push(p(2, 'BP-1', 'Pump room, basement 1', 'BP', 'M', 5.5, 'AquaDemo CR5'), p(3, 'DB-1', 'Riser, level 1', 'DB', 'S', 100), p(4, 'SPD-1', 'Main switch room', 'SPD', '', null),
    p(5, 'EP-1', 'Ground, east', 'EP', '', null), p(6, 'EP-2', 'Ground, west', 'EP', '', null), p(7, 'EP-3', 'Ground, south', 'EP', '', null),
    p(8, 'AC-1', 'Guard house', 'AC', 'S', 3.5), p(9, 'AC-2', 'Management office', 'AC', 'M', 7));
  return c;
}

// ---------- Demo Engineering Pte Ltd (Singapore) ----------
export function singaporeMasters(t) {
  const sizeRows = sizes(t); // the Width × height set, used to size the sample register
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
      base(t, `emp_${t}_1`, { code: 'EMP-001', name: 'Operations Executive', designation: 'Operations Executive', type: 'Office', mainZoneId: '', extraZoneIds: [], skills: '', mobile: '8000 0001', email: 'ops@demo-engineering.example' }),
      base(t, `emp_${t}_2`, { code: 'EMP-002', name: 'Approver', designation: 'Approver', type: 'Office', mainZoneId: '', extraZoneIds: [], skills: '', mobile: '8000 0002', email: 'approver@demo-engineering.example' }),
      base(t, `emp_${t}_3`, { code: 'EMP-003', name: 'Technician A', designation: 'Technician', type: 'Technician', mainZoneId: `zon_${t}_A`, extraZoneIds: [`zon_${t}_B`], skills: 'Rolling, motor work', groups: ['SHD', 'PLB', 'MEW'], mobile: '8000 0003', email: '' }),
      base(t, `emp_${t}_4`, { code: 'EMP-004', name: 'Technician B', designation: 'Technician', type: 'Technician', mainZoneId: `zon_${t}_C`, extraZoneIds: [`zon_${t}_D`], skills: 'Rolling, collapsible, sectional; LEW', groups: ['SHD', 'ELP', 'LPS', 'SPS'], mobile: '8000 0004', email: '' }),
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
    products: products(t, true),
    sizeSets: sizeSets(t),
    uoms: uoms(t),
    items: [
      ['ITM-001', 'Bolt nut', 'M10', 'Nos', 10, 0, 0], ['ITM-002', 'Motor 500 kg single phase', '500 kg, single phase', 'Nos', 1110, 0, 7],
      ['ITM-003', 'Motor 400 kg single phase', '400 kg, single phase', 'Nos', 950, 0, 7, true], ['ITM-004', 'Tension spring', '', 'Nos', 85, 0, 3, true],
      ['ITM-005', 'Guide rail', 'Galvanised', 'm', 45, 5, 3, true], ['ITM-006', 'Lock set', '', 'Set', 60, 0, 2, true],
      ['ITM-007', 'Bottom bar', '', 'm', 40, 5, 3, true], ['ITM-008', 'Shutter slat', '0.8 mm', 'm²', 35, 10, 5, true],
      ['ITM-009', 'Lubricant spray', '', 'Can', 12, 0, 0, true], ['ITM-010', 'Remote control', '2-button', 'Nos', 75, 0, 3, true],
    ].map(([code, name, spec, unit, rate, wastage, leadDays, ph], i) => base(t, `itm_${t}_${i + 1}`, { code, name, spec, unit, rate, wastage, leadDays, category: i === 8 ? 'Consumable' : 'Spare part', groupCode: 'SHD', placeholders: ph ? ['rate'] : [] }))
      .concat(tradeItems(t)),
    sizes: [...sizeRows, ...oneFigureSizes(t)],
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
      mixedCustomer(t, sizeRows),
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
      base(t, `emp_${t}_1`, { code: 'EMP-001', name: 'Technician G1', designation: 'Technician', type: 'Technician', mainZoneId: `zon_${t}_C`, extraZoneIds: [`zon_${t}_D`], skills: 'Rolling', groups: ['SHD'], mobile: '050 000 0001', email: '' }),
    ],
    equipment: [base(t, `eqp_${t}_1`, { code: 'EQ-01', name: 'Scissor Lift', ownership: 'Rented', basis: 'Day', rate: 900, supplier: '', placeholders: ['rate'] })],
    labour: [
      ['LAB-R1', 'Standard Team (1+1)', 'Repair', 'Skilled', 9000], ['LAB-R2', 'Additional Worker', 'Repair', 'Semi-skilled', 4000],
      ['LAB-A1', 'Standard Team (1+1)', 'AMC', 'Skilled', 8500], ['LAB-A2', 'Additional Worker', 'AMC', 'Semi-skilled', 3500],
    ].map(([code, name, rateSet, skill, monthly], i) => base(t, `lab_${t}_${i + 1}`, { code, name, rateSet, skill, monthly, days: 26, hours: 8, otMultiplier: 1.5, placeholders: ['monthly'] })),
    products: products(t),
    sizeSets: sizeSets(t),
    uoms: uoms(t),
    items: [['ITM-001', 'Tension spring', '', 'Nos', 300], ['ITM-002', 'Motor 500 kg single phase', '', 'Nos', 3900]]
      .map(([code, name, spec, unit, rate], i) => base(t, `itm_${t}_${i + 1}`, { code, name, spec, unit, rate, wastage: 0, leadDays: 5, category: 'Spare part', groupCode: 'SHD', placeholders: ['rate'] })),
    sizes: [...sizeRows, ...oneFigureSizes(t)],
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
