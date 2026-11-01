// Customer rules: next code, duplicate check (by mobile and email), quick-create from an enquiry,
// sites, and the shutter register kept at each site.
import * as store from './store.js';
import { classifySize, toMetres } from './costing.js';
import { sizes } from './lookups.js';

export const digits = s => String(s || '').replace(/\D/g, '');
const sameMobile = (a, b) => digits(a).length >= 7 && digits(a).slice(-8) === digits(b).slice(-8);
const sameEmail = (a, b) => !!a && a.trim().toLowerCase() === String(b || '').trim().toLowerCase();

export const primaryContact = c => (c?.contacts || []).find(x => x.primary) || c?.contacts?.[0] || null;

export function nextCode(coll, prefix, padding = 4) {
  const nums = store.list(coll).map(r => parseInt(String(r.code || '').replace(prefix, ''), 10)).filter(n => !isNaN(n));
  return `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(padding, '0')}`;
}

// Possible duplicates: same mobile or email on the customer or any of its contacts, or the same name.
export function findDuplicates({ name, mobile, email }, excludeId) {
  const hits = [];
  for (const c of store.list('customers')) {
    if (c.id === excludeId) continue;
    const people = [{ mobile: c.phone, email: c.email }, ...(c.contacts || [])];
    let reason = '';
    if (mobile && people.some(p => sameMobile(mobile, p.mobile))) reason = `same mobile ${mobile}`;
    else if (email && people.some(p => sameEmail(email, p.email))) reason = `same email ${email}`;
    else if (name && name.trim().length > 3 && c.name.toLowerCase() === name.trim().toLowerCase()) reason = 'same name';
    if (reason) hits.push({ customer: c, reason });
  }
  return hits;
}

export function quickCreate({ name, contactName, mobile, email, site }) {
  const code = nextCode('customers', 'CUS-');
  const contact = { id: store.uid('con_'), name: contactName || name, designation: '', mobile: mobile || '', email: email || '', primary: true };
  const customer = store.insert('customers', {
    code, name, uen: '', taxRegistered: false, phone: mobile || '', email: email || '', address: site?.address || '',
    contacts: [contact], sites: [], status: 'Active', quickCreated: true,
  }, { note: `Quick-created ${code} from a new enquiry` });
  const s = site ? addSite(customer.id, site) : null;
  return { customer: store.get('customers', customer.id), contact, site: s };
}

export function addSite(customerId, { name, address, blockUnit, postal, zoneId, access }) {
  const c = store.get('customers', customerId);
  const site = { id: store.uid('sit_'), code: `S${(c.sites || []).length + 1}`, name, address: address || name, blockUnit: blockUnit || '', postal: postal || '', zoneId: zoneId || '', access: access || '', shutters: [] };
  store.update('customers', customerId, { sites: [...(c.sites || []), site] }, `Added site ${name} to ${c.code}`);
  return site;
}

// Build a shutter register entry; sizes are kept in metres and classified by the one size rule. Without a measured
// width and height the size tapped on site (sizeCode) is kept.
export function makeShutter({ tag, location, productId, width, height, unit = 'm', motor = '', serial = '', installDate = '', sizeCode = '' }, source = 'Manual') {
  const widthM = toMetres(width, unit), heightM = toMetres(height, unit);
  return { id: store.uid('sht_'), tag, location, productId, width, height, unit, widthM, heightM, sizeCode: classifySize(widthM, heightM, sizes()) || sizeCode, motor, serial, installDate, status: 'Active', source };
}

export function nextShutterTag(site, prefix = 'RS-') {
  const nums = (site.shutters || []).map(s => parseInt(String(s.tag).replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
  return `${prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

export function addShutters(customerId, siteId, shutters, note) {
  const c = store.get('customers', customerId);
  const sites = c.sites.map(s => (s.id === siteId ? { ...s, shutters: [...(s.shutters || []), ...shutters] } : s));
  store.update('customers', customerId, { sites }, note || `Added ${shutters.length} shutter(s) to the shutter register`);
}

export const shutterCount = c => (c.sites || []).reduce((n, s) => n + (s.shutters || []).length, 0);
