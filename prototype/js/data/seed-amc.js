// Stretch 3 sample data for AMC and General Servicing: the draft Inspection Check List (research draft, until the team
// lead sends the real one), the billing-plan list, draft AMC terms, AMC defaults, three made-up customers, a second ABC
// site (to try several sites and zones) and fire-rated shutters.
import { customer } from './seed-masters.js';

const T0 = new Date().toISOString();
const base = (tenantId, id, data) => ({ id, tenantId, status: 'Active', createdAt: T0, updatedAt: T0, ...data });

// Transaction defaults for AMC and GS estimates (AMC Excel: overheads 10 %, markup 20 %); Transaction Setup in Part B.
export const AMC_TX = { costingLevel: 'JOB', sharedCosts: 'SPREAD', overheadPct: 10, marginBasis: 'MARKUP', marginPct: 20, visitsPerYear: 4, billing: 'MONTHLY', periodMonths: 12, renewalDays: 60, liftHeightM: 4 };

// The draft check lists. list: which check list an item belongs to (Value Set Master "Check List"; each product names
// one). GENERAL is the research note's list (section 7); applies: ALL, MOTOR (motorised) or FIRE (fire-rated).
// The other lists are short research drafts (reports/Mixed products in service software.md) until the team lead sends
// real ones.
export const CHECKLIST = [
  ['CURTAIN', 'Curtain and slats', 'dents, bent slats, corrosion, end locks, bottom rail', 'ALL'],
  ['GUIDES', 'Guide rails', 'alignment, fixings, wear strips, debris', 'ALL'],
  ['BARREL', 'Barrel, shaft and bearings', 'play, noise, retention', 'ALL'],
  ['SPRINGS', 'Springs', 'tension, balance, coils, corrosion', 'ALL'],
  ['CABLES', 'Wire ropes / cables', 'where fitted', 'ALL'],
  ['DRIVE', 'Motor and drive', 'mounting, noise, oil leaks, brake, chain and sprockets', 'MOTOR'],
  ['LIMITS', 'Limit switches and controls', 'travel limits, push buttons, key switch, remote, emergency stop', 'MOTOR'],
  ['OVERRIDE', 'Manual override and release', 'hand chain or crank', 'MOTOR'],
  ['SAFETY', 'Safety devices', 'safety edge, photocells, anti-drop brake', 'ALL'],
  ['LOCKS', 'Locks and bolts', 'locks, bolts, collapsible gate pivots and track', 'ALL'],
  ['ELECTRICAL', 'Electrical', 'wiring, isolator, control box, error codes', 'MOTOR'],
  ['FIRE', 'Fire drop test', 'release, closing speed, clear path', 'FIRE'],
  ['LABELS', 'Labels, ID plate, logbook', '', 'ALL'],
  ['P_PRESS', 'Outlet pressure within range', 'read the gauge; write the bar in the note', 'ALL', 'PUMP'],
  ['P_NOISE', 'Noise and vibration normal', '', 'ALL', 'PUMP'],
  ['P_SEALS', 'Seals and pipe joints: no leaks', '', 'ALL', 'PUMP'],
  ['P_SWITCH', 'Pressure switch / controller cuts in and out', '', 'ALL', 'PUMP'],
  ['P_MOTOR', 'Motor current and temperature normal', 'write the current (A) in the note', 'ALL', 'PUMP'],
  ['P_VALVES', 'Valves, strainer and non-return valve', '', 'ALL', 'PUMP'],
  ['D_THERMAL', 'Thermal scan: no hot spots', '', 'ALL', 'DB'],
  ['D_TIGHT', 'Terminals and busbars tight', '', 'ALL', 'DB'],
  ['D_RCCB', 'RCCB / ELCB trip test', '', 'ALL', 'DB'],
  ['D_BREAKERS', 'Breakers and isolators operate', '', 'ALL', 'DB'],
  ['D_LABELS', 'Circuit labels and schedule', '', 'ALL', 'DB'],
  ['D_CLEAN', 'Enclosure clean and dry, no damage', '', 'ALL', 'DB'],
  ['S_STATUS', 'Status indicator healthy', '', 'ALL', 'SPD'],
  ['S_CONN', 'Connections and earth lead tight', '', 'ALL', 'SPD'],
  ['S_DAMAGE', 'No burn marks or damage', '', 'ALL', 'SPD'],
  ['S_BACKUP', 'Back-up fuse / breaker healthy', '', 'ALL', 'SPD'],
  ['E_RES', 'Earth resistance 10 Ω or less', 'write the reading in the note', 'ALL', 'EARTH'],
  ['E_CHAMBER', 'Pit chamber and cover in good condition', '', 'ALL', 'EARTH'],
  ['E_BOND', 'Bonds and clamps tight, no corrosion', '', 'ALL', 'EARTH'],
  ['E_COND', 'Down conductor continuity', '', 'ALL', 'EARTH'],
  ['T_CLEAN', 'Tank clean inside, no sediment', '', 'ALL', 'TANK'],
  ['T_COVER', 'Access cover sealed and locked', '', 'ALL', 'TANK'],
  ['T_SCREEN', 'Overflow and vent screens intact', '', 'ALL', 'TANK'],
  ['T_FLOAT', 'Float valve shuts off', '', 'ALL', 'TANK'],
  ['T_LEAK', 'No leaks or corrosion', '', 'ALL', 'TANK'],
  ['V_OPERATE', 'Opens and closes fully', '', 'ALL', 'VALVE'],
  ['V_LEAK', 'No leaks at the gland and joints', '', 'ALL', 'VALVE'],
  ['V_BACKFLOW', 'Backflow test passed', 'where a backflow preventer is fitted', 'ALL', 'VALVE'],
  ['V_TAG', 'Tag / label in place', '', 'ALL', 'VALVE'],
  ['G_EMPTY', 'Grease and solids removed', '', 'ALL', 'GREASE'],
  ['G_BAFFLE', 'Baffles intact', '', 'ALL', 'GREASE'],
  ['G_COVER', 'Cover sealed, no odour', '', 'ALL', 'GREASE'],
  ['G_FLOW', 'Outlet flows freely', '', 'ALL', 'GREASE'],
  ['H_THERMO', 'Thermostat cuts in and out', '', 'ALL', 'HEATER'],
  ['H_SAFETY', 'Safety / pressure relief valve operates', '', 'ALL', 'HEATER'],
  ['H_RCCB', 'RCCB trips on test', '', 'ALL', 'HEATER'],
  ['H_LEAK', 'No leaks or corrosion', '', 'ALL', 'HEATER'],
  ['A_FILTER', 'Filters cleaned', '', 'ALL', 'AIRCON'],
  ['A_COIL', 'Coil and drain tray cleaned', '', 'ALL', 'AIRCON'],
  ['A_DRAIN', 'Drain pipe flows', '', 'ALL', 'AIRCON'],
  ['A_COOL', 'Cooling normal', 'write the supply air temperature in the note', 'ALL', 'AIRCON'],
  ['A_ELEC', 'Fan motor, capacitor and connections normal', '', 'ALL', 'AIRCON'],
  ['F_RUN', 'Runs with no unusual noise or vibration', '', 'ALL', 'FAN'],
  ['F_CLEAN', 'Blades and guard clean', '', 'ALL', 'FAN'],
  ['F_CURRENT', 'Motor current normal', 'write the current (A) in the note', 'ALL', 'FAN'],
  ['F_BELT', 'Belt and bearings in good condition', 'where fitted', 'ALL', 'FAN'],
  ['GN_FLUIDS', 'Engine oil and coolant levels', '', 'ALL', 'GEN'],
  ['GN_BATTERY', 'Battery voltage and terminals', '', 'ALL', 'GEN'],
  ['GN_RUN', 'Test run on load', 'write the minutes run in the note', 'ALL', 'GEN'],
  ['GN_FUEL', 'Fuel level, no leaks', '', 'ALL', 'GEN'],
  ['GN_ALARM', 'Control panel: no alarms', '', 'ALL', 'GEN'],
  ['M_VISUAL', 'Visual and thermal check', '', 'ALL', 'MVSG'],
  ['M_INSUL', 'Gas / insulation indicator normal', '', 'ALL', 'MVSG'],
  ['M_RELAY', 'Protection relay healthy', '', 'ALL', 'MVSG'],
  ['M_LOCK', 'Interlocks operate', '', 'ALL', 'MVSG'],
  ['M_ROOM', 'Switch room clean, dry and locked', '', 'ALL', 'MVSG'],
  ['L_TERM', 'Air terminals and conductors secure', '', 'ALL', 'LPS'],
  ['L_JOINT', 'Joints and test clamps tight', '', 'ALL', 'LPS'],
  ['L_EARTH', 'Earth readings taken at every pit', 'write the highest reading (Ω) in the note', 'ALL', 'LPS'],
  ['L_BOND', 'Bonding to roof metalwork', '', 'ALL', 'LPS'],
  ['L_DAMAGE', 'No damage or corrosion', '', 'ALL', 'LPS'],
];

export function valueSets(t) {
  return [
    base(t, `vs_${t}_BILLING`, { code: 'BILLING', name: 'AMC Billing', access: 'System',
      values: [['MONTHLY', 'Monthly'], ['QUARTERLY', 'Quarterly'], ['HALF', 'Half-yearly'], ['YEARLY', 'Yearly']].map(([code, label], i) => ({ code, label, order: i + 1, isDefault: i === 0, active: true })) }),
    base(t, `vs_${t}_AMC_CHECKLIST`, { code: 'AMC_CHECKLIST', name: 'AMC Inspection Check List (draft – team lead to replace)', access: 'Extensible', placeholders: ['values'],
      values: CHECKLIST.map(([code, label, hint, applies, list = 'GENERAL'], i) => ({ code, label, hint, applies, list, order: i + 1, isDefault: false, active: true })) }),
  ];
}

// Draft AMC quotation terms ({company} = the name in Company Setup); [X] values are placeholders.
const AMC_TERMS = [
  ['This contract covers preventive maintenance of the products listed in the schedule, at the number of visits per year stated.'],
  ['Each visit includes inspection, cleaning, adjustment and lubrication where the manufacturer allows, and a check list signed by the customer.'],
  ['Spare parts and repairs found necessary during a visit are not included. They are quoted separately and done after the customer’s approval.'],
  ['Visit dates are agreed with the customer in advance. A visit missed or postponed by the customer is not refunded.'],
  ['Breakdown call-outs between visits are charged separately. Contract customers get priority service and [X] % off repair labour.', true],
  ['The contract runs for the period stated from its start date and is billed as shown in the billing plan, in advance.'],
  ['{company} will send a renewal quotation before the contract ends.'],
  ['This quotation is valid for {validity} days from the date of issue.'],
];
function terms(t) {
  return AMC_TERMS.map(([text, ph], i) => base(t, `trm_${t}_A${i + 1}`, { code: `AMC-0${i + 1}`, title: `AMC term ${i + 1}`, docType: 'AMC', order: i + 1, text,
    isDefault: true, placeholders: ph ? ['text'] : [] }));
}

// Made-up customers for the AMC and GS stage samples.
function customers(t, sizeRows) {
  return [
    customer(t, 'CUS-0007', { name: 'Demo Bakery Pte Ltd', uen: '', taxRegistered: false, paymentTerm: 'IMMEDIATE', phone: '9567 8901', email: 'orders@demo-bakery.example', address: 'Demo Lane, Jurong East',
      contacts: [{ id: `con_${t}_7`, name: 'Bakery Owner', designation: 'Owner', mobile: '9567 8901', email: 'orders@demo-bakery.example', primary: true }] },
    [{ name: 'Jurong bakery', address: 'Demo Lane, Jurong East', blockUnit: '#01-20', zone: 'A', shutters: [['BK-1', 'Shop front', 'RS', 3.5, 2.8, 'm', ''], ['BK-2', 'Back door', 'CS', 2, 2.4, 'm', '']] }], sizeRows),
    customer(t, 'CUS-0008', { name: 'Demo Food Factory Pte Ltd', uen: '', taxRegistered: true, paymentTerm: 'D30', phone: '9678 9012', email: 'facilities@demo-food.example', address: 'Demo Crescent, Pioneer',
      contacts: [{ id: `con_${t}_8`, name: 'Facilities Executive', designation: 'Facilities', mobile: '9678 9012', email: 'facilities@demo-food.example', primary: true }] },
    [{ name: 'Pioneer food factory', address: 'Demo Crescent, Pioneer', zone: 'A', shutters: [['FF-1', 'Loading bay 1', 'MR', 5, 4.5, 'm', '500 kg single phase'],
      ['FF-2', 'Loading bay 2', 'MR', 5, 4.5, 'm', '500 kg single phase'], ['FF-3', 'Cold room', 'RS', 3, 3, 'm', ''], ['FF-4', 'Dry store', 'RS', 4, 3.5, 'm', '']] }], sizeRows),
    customer(t, 'CUS-0009', { name: 'Marina Demo Mall Pte Ltd', uen: '', taxRegistered: true, paymentTerm: 'D30', phone: '9789 0123', email: 'operations@marina-demo-mall.example', address: 'Demo Boulevard, Marina Bay',
      contacts: [{ id: `con_${t}_9`, name: 'Mall Operations Manager', designation: 'Operations', mobile: '9789 0123', email: 'operations@marina-demo-mall.example', primary: true }] },
    [{ name: 'Marina Bay mall', address: 'Demo Boulevard, Marina Bay', zone: 'C', access: 'Report to the security counter at B1',
      shutters: [['MB-1', 'Car park entrance', 'RS', 6, 3.5, 'm', ''], ['MB-2', 'Loading dock', 'MR', 7, 4.5, 'm', '600 kg three phase'], ['MB-3', 'Fire shutter, level 1', 'RS', 8, 5.5, 'm', ''],
        ['MB-4', 'Shop unit 01-10', 'RS', 3, 3, 'm', ''], ['MB-5', 'Shop unit 01-12', 'RS', 3, 3, 'm', ''], ['MB-6', 'Service corridor', 'CS', 4, 3, 'm', '']] },
    { name: 'Changi outlet', address: 'Demo Road, Changi', blockUnit: '#01-03', zone: 'B',
      shutters: [['CO-1', 'Shop front', 'RS', 4, 3, 'm', ''], ['CO-2', 'Back door', 'RS', 2.5, 2.5, 'm', ''], ['CO-3', 'Store', 'RS', 2.5, 2.5, 'm', '']] }], sizeRows),
  ];
}

// Adds the AMC data to a company's masters (in place).
export function addAmcMasters(t, m, { sampleCustomers = false } = {}) {
  m.valueSets.push(...valueSets(t));
  m.terms.push(...terms(t));
  if (!sampleCustomers) return m;
  const sizeRows = m.sizes.filter(z => z.setId === `set_${t}_WH`); // the Width × height set sizes the sample register
  m.customers.push(...customers(t, sizeRows));
  // ABC Industries: a second site in Zone B, to try an AMC over several sites and zones.
  const abc = m.customers.find(c => c.code === 'CUS-0002');
  const branch = customer(t, 'CUS-0002', { name: abc.name, contacts: [] }, [{ name: 'Changi branch', address: 'Demo Way, Changi', zone: 'B',
    shutters: [['CB-1', 'Front', 'RS', 2.5, 2.5, 'm', ''], ['CB-2', 'Side', 'RS', 2.5, 2.5, 'm', ''], ['CB-3', 'Warehouse door', 'RS', 4, 3.5, 'm', '']] }], sizeRows).sites[0];
  abc.sites.push({ ...branch, id: `${abc.id}_S2`, code: 'S2', shutters: branch.shutters.map((s, i) => ({ ...s, id: `sht_${abc.id}_S2_${i + 1}` })) });
  // Fire-rated shutters (the fire drop test applies only to them).
  const fire = { 'CUS-0005': ['JI-2'], 'CUS-0009': ['MB-3'] };
  m.customers.forEach(c => c.sites.forEach(s => s.shutters.forEach(sh => { sh.fireRated = !!fire[c.code]?.includes(sh.tag); })));
  return m;
}
