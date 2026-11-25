// Data saved before products of every trade (25 Nov 2026) gets the new masters once per company, so the user's own
// browser data keeps working without a reset (storage stays v8). Every step only adds what is missing, so it also
// completes data upgraded by the first version of this change, and never undoes the user's own edits:
// - Product Size: size sets by code (old sizes join Width × height), with their sizes;
// - the Unit of Measure master, and the Value Set lists Product Group, Costing Method and Check List (missing values
//   added; the first version's group names follow the client's business activities);
// - every saved product without a costing method becomes "Shutters & doors · By size · Width × height" (so every saved
//   price stays); the Singapore demo company gets the products and the parts and materials of the new trades;
// - the AMC check list items get their check list, plus the drafts of the new lists;
// - Menu Access: each role gets the Unit of Measure master with the rights it has on Product Size;
// - technicians get the product groups they work on; the AMC term about "the shutters listed" says "products".
// Then (productsData 3): the demo company is "Demo Engineering Pte Ltd" (user, 25 Nov 2026; documents already issued
// keep the letterhead they were issued with) and the check list of shutters and doors is called "Shutters & doors".
// Then (productsData 4): AMC and General Servicing estimates saved before size sets get today's Labour_Matrix keys
// ("S" → "WH:S", same numbers), so editing them later keeps their counts (flaw audit #1).
// The company record keeps the step reached; fresh demo data starts at 4.
import * as store from './store.js';
import * as auth from './auth.js';
import { sizeSets as seedSets, oneFigureSizes, uoms as seedUoms, valueSets as seedValueSets, tradeProducts, tradeItems, PRODUCT_DEFAULTS } from '../data/seed-masters.js';
import { valueSets as amcValueSets } from '../data/seed-amc.js';
import { keyedMatrix, needsKeying } from './amc-estimates.js';

const strip = ({ id, tenantId, createdAt, updatedAt, status, ...r }) => r;
const quiet = { status: 'Active', silent: true };
// Technicians' groups in the demo data (first version → now).
const SEED_GROUPS = { emp_co_dsh_3: ['SHD', 'PLB', 'MEW'], emp_co_dsh_4: ['SHD', 'ELP', 'LPS', 'SPS'] };
// Group names of the first version that now follow the client's business activities, and the products that moved.
const OLD_LABELS = { ELP: ['Electrical panels', 'LV/MV panels & switchgear'], LPS: ['Lightning & surge', 'Lightning protection'] };
const MOVED = { SPD: ['LPS', 'SPS'], PUB: ['SUB', 'PUB'], BIM: ['SUB', 'BIM'] };

export function upgradeProducts() {
  const co = auth.company();
  if (!co || co.productsData >= 4) return;
  if (!(co.productsData >= 2)) addProductMasters(co);
  if (!(co.productsData >= 3)) rename(co);
  store.list('estimates', e => e.kind === 'AMC' && needsKeying(e)).forEach(e => { const k = keyedMatrix(e); store.update('estimates', e.id, { matrix: k.matrix, sites: k.sites }, false); });
  store.update('companies', co.id, { productsData: 4 }, false);
}

const OLD_NAME = 'Demo Shutters Pte Ltd', NEW_NAME = 'Demo Engineering Pte Ltd';
function rename(co) {
  const mail = v => (typeof v === 'string' ? v.replaceAll('demo-shutters.example', 'demo-engineering.example') : v);
  if (co.name === OLD_NAME) store.update('companies', co.id, { name: NEW_NAME, email: mail(co.email), dpo: mail(co.dpo) }, `Company renamed ${NEW_NAME}`);
  store.list('employees', e => /demo-shutters\.example/.test(e.email || '')).forEach(e => store.update('employees', e.id, { email: mail(e.email) }, false));
  const cl = store.findOne('valueSets', v => v.code === 'CHECK_LIST');
  if (cl?.values.some(v => v.code === 'GENERAL' && v.label === 'General')) store.update('valueSets', cl.id, { values: cl.values.map(v => (v.code === 'GENERAL' && v.label === 'General' ? { ...v, label: 'Shutters & doors' } : v)) }, false);
}

function addProductMasters(co) {
  const t = co.id;
  const singapore = co.country === 'Singapore';

  // Size sets by code; sizes saved before size sets join the first one; missing sizes of the seeded sets are added.
  const sets = Object.fromEntries(store.list('sizeSets').map(s => [s.code, s.id]));
  seedSets(t).filter(s => !sets[s.code]).forEach(s => { sets[s.code] = store.insert('sizeSets', strip(s), { status: 'Active', note: `Size set ${s.code} added` }).id; });
  store.list('sizes').filter(z => !z.setId).forEach(z => store.update('sizes', z.id, { setId: sets.WH }, false));
  const haveSize = new Set(store.list('sizes').map(z => `${z.setId}|${z.code}`));
  oneFigureSizes(t).forEach(z => { const setId = sets[z.setId.split('_').pop()]; if (setId && !haveSize.has(`${setId}|${z.code}`)) store.insert('sizes', { ...strip(z), setId }, quiet); });
  const setOf = id => (id ? sets[id.split('_').pop()] || '' : '');

  const haveUom = new Set(store.list('uoms').map(u => u.code));
  seedUoms(t).filter(u => !haveUom.has(u.code)).forEach(u => store.insert('uoms', strip(u), quiet));

  // Value lists: missing lists, and missing values of the product lists.
  const seedVs = seedValueSets(t);
  ['PRODUCT_GROUP', 'COSTING_METHOD', 'CHECK_LIST'].forEach(code => {
    const want = seedVs.find(v => v.code === code);
    const cur = store.findOne('valueSets', v => v.code === code);
    if (!cur) { store.insert('valueSets', strip(want), { status: 'Active', note: `Value list ${want.name} added` }); return; }
    const values = cur.values.map(v => (code === 'PRODUCT_GROUP' && OLD_LABELS[v.code]?.[0] === v.label ? { ...v, label: OLD_LABELS[v.code][1] } : v));
    want.values.filter(w => !values.some(v => v.code === w.code)).forEach(w => values.push({ ...w, order: values.length + 1 }));
    // The seeded values in the seed's order (the client's activities), the user's own after them.
    const rank = v => { const i = want.values.findIndex(w => w.code === v.code); return i < 0 ? want.values.length + (v.order || 0) : i; };
    values.sort((a, b) => rank(a) - rank(b)).forEach((v, i) => { v.order = i + 1; });
    store.update('valueSets', cur.id, { values }, false);
  });

  // The AMC check list: old items are the General list; the drafts of the other lists are added.
  const cl = store.findOne('valueSets', v => v.code === 'AMC_CHECKLIST');
  const draft = amcValueSets(t).find(v => v.code === 'AMC_CHECKLIST')?.values || [];
  if (cl) {
    const codes = new Set(cl.values.map(v => v.code));
    const values = [...cl.values.map(v => ({ ...v, list: v.list || 'GENERAL' })), ...draft.filter(v => v.list !== 'GENERAL' && !codes.has(v.code)).map((v, i) => ({ ...v, order: cl.values.length + i + 1 }))];
    store.update('valueSets', cl.id, { values }, false);
  }

  // Products: saved ones keep their prices (by size, Width × height); first-version products move to their activity's
  // group; the water heater gets its own check list; Singapore gets the new trades' products.
  store.list('products').filter(p => !p.costedBy).forEach(p => store.update('products', p.id, { ...PRODUCT_DEFAULTS, sizeSetId: sets.WH }, false));
  store.list('products').forEach(p => {
    const move = MOVED[p.code];
    if (move && p.groupCode === move[0]) store.update('products', p.id, { groupCode: move[1] }, false);
    if (p.code === 'WH' && p.costedBy === 'HOURS' && p.checklist === 'GENERAL') store.update('products', p.id, { checklist: 'HEATER' }, false);
  });
  if (singapore) {
    const codes = new Set(store.list('products').map(p => p.code));
    tradeProducts(t).filter(p => !codes.has(p.code)).forEach(p => store.insert('products', { ...strip(p), sizeSetId: setOf(p.sizeSetId) }, { status: 'Active', note: `Product ${p.code} added` }));
  }
  // The first version's "Submissions & design" group is left with no product: switched off.
  const pg = store.findOne('valueSets', v => v.code === 'PRODUCT_GROUP');
  if (pg?.values.some(v => v.code === 'SUB' && v.active) && !store.list('products', p => p.groupCode === 'SUB').length) {
    store.update('valueSets', pg.id, { values: pg.values.map(v => (v.code === 'SUB' ? { ...v, active: false } : v)) }, false);
  }

  // Parts and materials: the saved ones are door and shutter parts; Singapore gets the new trades' parts.
  store.list('items').filter(i => !i.groupCode).forEach(i => store.update('items', i.id, { groupCode: 'SHD' }, false));
  if (singapore) {
    const codes = new Set(store.list('items').map(i => i.code));
    tradeItems(t).filter(i => !codes.has(i.code)).forEach(i => store.insert('items', strip(i), quiet));
  }

  // Menu Access: the Unit of Measure master, with each role's rights on Product Size.
  store.list('menuAccess', a => a.menu === 'size').forEach(a => {
    if (!store.findOne('menuAccess', x => x.roleId === a.roleId && x.menu === 'uom')) store.insert('menuAccess', { ...strip(a), menu: 'uom' }, quiet);
  });

  // Technicians: the groups they work on (the demo technicians get theirs; others doors and shutters).
  const firstVersion = { emp_co_dsh_3: 'SHD,PLB', emp_co_dsh_4: 'SHD,ELP,LPS' };
  store.list('employees', e => e.type === 'Technician').forEach(e => {
    if (!e.groups) store.update('employees', e.id, { groups: SEED_GROUPS[e.id] || ['SHD'] }, false);
    else if (SEED_GROUPS[e.id] && e.groups.join(',') === firstVersion[e.id]) store.update('employees', e.id, { groups: SEED_GROUPS[e.id] }, false);
  });

  store.list('terms', x => /maintenance of the shutters listed/.test(x.text || '')).forEach(x => store.update('terms', x.id, { text: x.text.replace('maintenance of the shutters listed', 'maintenance of the products listed') }, false));
}
