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

export function findSite(siteId) {
  for (const c of store.list('customers')) {
    const site = (c.sites || []).find(s => s.id === siteId);
    if (site) return { customer: c, site };
  }
  return { customer: null, site: null };
}

// Term texts hold {company}; it is replaced by the company name from Company Setup.
export const withCompany = (text, company) => String(text || '').replaceAll('{company}', company?.name || '');
