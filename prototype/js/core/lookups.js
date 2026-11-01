// Read helpers over the masters: value lists (code stored, description shown), zones, staff, products, sites.
import * as store from './store.js';

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

// Choices for an enquiry item line: shutter types (Product master) and materials (Material/Item master).
// The value keeps the source: "prd:<id>" or "itm:<id>".
export function itemChoices() {
  return [
    { group: 'Shutter types', options: products().map(p => ({ value: `prd:${p.id}`, label: p.name })) },
    { group: 'Parts & materials', options: items().map(i => ({ value: `itm:${i.id}`, label: i.name })) },
  ];
}
// What a picked product brings to its line, from its master: the unit and the details shown under it.
// Shutter types are counted in Nos and sized on site; parts and materials carry code, spec, unit, rate and lead time.
export function productInfo(ref) {
  if (!ref) return null;
  const id = ref.slice(4);
  if (ref.startsWith('prd:')) {
    const p = store.get('products', id);
    return p && { kind: 'shutter', code: p.code, unit: 'Nos' };
  }
  const it = store.get('items', id);
  return it && { kind: 'part', code: it.code, category: it.category || '', spec: it.spec || '', unit: it.unit || 'Nos', rate: Number(it.rate) || 0,
    placeholder: !!it.placeholders?.includes('rate'), leadDays: Number(it.leadDays) || 0 };
}
export const unitOf = ref => productInfo(ref)?.unit || '';
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
