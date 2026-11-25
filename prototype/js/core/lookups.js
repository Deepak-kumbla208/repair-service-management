// Read helpers over the masters: value lists (code stored, description shown), zones, staff, products, sites.
import * as store from './store.js';
import { costingOf, setOfProduct, isTwoFigure, uoms } from './products.js';

const active = r => r.status !== 'Inactive';

export function valueSet(code) {
  return store.findOne('valueSets', v => v.code === code);
}
export function vsOptions(code) {
  const set = valueSet(code);
  return (set?.values || []).filter(v => v.active).sort((a, b) => a.order - b.order).map(v => ({ value: v.code, label: v.label }));
}
export function vsLabel(code, value) {
  if (!value) return '';
  return valueSet(code)?.values.find(v => v.code === value)?.label || value;
}
export const vsDefault = code => valueSet(code)?.values.find(v => v.isDefault && v.active)?.code || '';

export const zones = () => store.list('zones', active).sort((a, b) => a.code.localeCompare(b.code));
export const zoneLabel = id => { const z = store.get('zones', id); return z ? `${z.code} · ${z.name}` : ''; };
export const zoneCode = id => store.get('zones', id)?.code || '';

export const employees = () => store.list('employees', active);
export const technicians = () => employees().filter(e => e.type === 'Technician');
export const empName = id => store.get('employees', id)?.name || '';

export const products = () => store.list('products', active);
export const productName = id => store.get('products', id)?.name || '';
export const items = () => store.list('items', active);
export const sizes = () => store.list('sizes');

// Choices for an enquiry item line: products (Product master) under their group's heading, then parts and materials
// (Material/Item master). The value keeps the source: "prd:<id>" or "itm:<id>".
export function itemChoices() {
  const groups = vsOptions('PRODUCT_GROUP');
  const all = products().sort((a, b) => a.name.localeCompare(b.name));
  const heads = [...groups.map(g => ({ code: g.value, label: g.label })), { code: '', label: 'Products' }];
  const out = heads.map(g => ({ group: g.label, options: all.filter(p => (p.groupCode || '') === g.code || (!g.code && !groups.some(x => x.value === p.groupCode)))
    .map(p => ({ value: `prd:${p.id}`, label: p.name })) })).filter(g => g.options.length);
  // Parts and materials under their group too ("Parts · Plumbing & sanitary"); a part with no group comes last.
  const parts = [...groups.map(g => ({ code: g.value, label: `Parts · ${g.label}` })), { code: '', label: 'Parts & materials' }]
    .map(g => ({ group: g.label, options: items().filter(i => (i.groupCode || '') === g.code || (!g.code && !groups.some(x => x.value === i.groupCode))).sort((a, b) => a.name.localeCompare(b.name))
      .map(i => ({ value: `itm:${i.id}`, label: i.name })) })).filter(g => g.options.length);
  return [...out, ...parts];
}
// What a picked product brings to its line, from its master: the unit and the details shown under it.
// A product says how it is costed (by size, standard hours or a fixed price); parts and materials carry code, spec,
// unit, rate and lead time.
export function productInfo(ref) {
  if (!ref) return null;
  const id = ref.slice(4);
  if (ref.startsWith('prd:')) {
    const p = store.get('products', id);
    if (!p) return null;
    const set = setOfProduct(p);
    return { kind: 'product', costedBy: costingOf(p), code: p.code, unit: p.unit || 'Nos', setName: set?.name || '', setUnit: set?.unit || '', twoFigure: isTwoFigure(set),
      repairHrs: Number(p.repairHrs) || 0, price: Number(p.price) || 0, group: vsLabel('PRODUCT_GROUP', p.groupCode) };
  }
  const it = store.get('items', id);
  return it && { kind: 'part', code: it.code, category: it.category || '', spec: it.spec || '', unit: it.unit || 'Nos', rate: Number(it.rate) || 0,
    placeholder: !!it.placeholders?.includes('rate'), leadDays: Number(it.leadDays) || 0 };
}
export const unitOf = ref => productInfo(ref)?.unit || '';
// Units of the Unit of Measure master, for a pick list (a unit saved before it was in the master stays offered).
export const unitOptions = (keep = '') => { const list = uoms().map(u => u.code); return keep && !list.includes(keep) ? [keep, ...list] : list; };
export function itemName(ref) {
  if (!ref) return '';
  const [kind, id] = [ref.slice(0, 3), ref.slice(4)];
  return (kind === 'prd' ? store.get('products', id) : store.get('items', id))?.name || '';
}

export function findSite(siteId) {
  for (const c of store.list('customers')) {
    const site = (c.sites || []).find(s => s.id === siteId);
    if (site) return { customer: c, site };
  }
  return { customer: null, site: null };
}

// Term texts hold {company}; it is replaced by the company name from Company Setup.
export const withCompany = (text, company) => String(text || '').replaceAll('{company}', company?.name || '');
