// Global search (Ctrl+K): looks across the tool but only returns what the user's role may open
// in the current view (web or phone), and only their own jobs for "own" data scope.
import * as store from './store.js';
import * as auth from './auth.js';
import { vsLabel, zoneLabel, empName } from './lookups.js';
import { MENUS, routeOf } from '../data/menus.js';

const MASTER_SOURCES = [
  ['transport', 'zones', z => `Zone ${z.code} · ${z.name}`, z => z.vehicle],
  ['employee', 'employees', e => `${e.name}`, e => `${e.code} · ${e.designation}`],
  ['equipment', 'equipment', e => e.name, e => `${e.code} · ${e.ownership}`],
  ['labour', 'labour', l => `${l.name} (${l.rateSet})`, l => l.code],
  ['product', 'products', p => p.name, p => `${p.code} · factor ${p.factor}`],
  ['item', 'items', i => i.name, i => `${i.code} · ${i.spec || i.unit}`],
  ['size', 'sizes', s => `${s.code} · ${s.name}`, () => 'Shutter size'],
  ['valueset', 'valueSets', v => v.name, v => v.values.map(x => x.label).join(', ')],
  ['tax', 'taxes', t => t.name, t => `${t.code} · ${t.rate}%`],
  ['terms', 'terms', t => t.title, t => `${t.code} · ${t.docType}`],
];

export function globalSearch(query, channel = auth.view()) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hit = (...parts) => { const text = parts.flat().filter(Boolean).join(' ').toLowerCase(); return terms.every(t => text.includes(t)); };
  const mobile = channel === 'mobile';
  const can = key => auth.can(key, 'view', channel);
  const groups = [];
  const add = (group, items) => { if (items.length) groups.push({ group, items: items.slice(0, 6), more: Math.max(0, items.length - 6) }); };

  if (can('enquiry')) {
    add('Enquiries', store.list('enquiries')
      .filter(e => hit(e.no, e.customerName, e.contactName, e.mobile, e.email, e.siteName, e.description))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map(e => ({ icon: '✎', title: `${e.no} · ${e.customerName}`, sub: `${vsLabel('ENQ_TYPE', e.type)} · ${e.status}`, route: mobile ? `m/enquiry/${e.id}` : `enquiries/${e.id}` })));
  }

  if (can('inspection')) {
    const own = auth.scope('inspection') === 'own';
    const rows = store.list('inspections').filter(i => auth.seesInspection(i) && i.status !== 'Cancelled').map(i => ({ i, e: store.get('enquiries', i.enquiryId), r: i.reportId ? store.get('siteReports', i.reportId) : null }));
    add(own ? 'My jobs' : 'Site inspections', rows
      .filter(({ i, e, r }) => hit(e.no, e.customerName, e.siteName, empName(i.technicianId), r?.no, 'site inspection'))
      .map(({ i, e, r }) => ({ icon: '⌖', title: `${r ? r.no : 'Site inspection'} · ${e.customerName}`, sub: `${e.no} · ${e.siteName} · ${i.status}`, route: mobile ? `m/job/${i.id}` : `inspections/${i.id}` })));
  }

  if (can('customer') && !mobile) {
    const customers = store.list('customers');
    add('Customers', customers
      .filter(c => hit(c.code, c.name, c.uen, c.phone, c.email, (c.contacts || []).map(p => [p.name, p.mobile, p.email])))
      .map(c => ({ icon: '☷', title: c.name, sub: `${c.code} · ${(c.contacts || [])[0]?.name || ''} · ${c.phone || ''}`, route: `master/customer/${c.id}` })));
    const sites = [];
    customers.forEach(c => (c.sites || []).forEach(s => {
      const shutters = (s.shutters || []).filter(sh => hit(sh.tag, sh.location, sh.serial));
      if (hit(s.name, s.address, s.blockUnit, zoneLabel(s.zoneId)) || shutters.length) {
        const list = shutters.length ? shutters.slice(0, 3).map(sh => `${sh.tag} ${sh.location}`).join(', ') : `${(s.shutters || []).length} shutters`;
        sites.push({ icon: '⌂', title: s.name, sub: `${c.name} · ${zoneLabel(s.zoneId)} · ${list}`, route: `master/customer/${c.id}` });
      }
    }));
    add('Sites and shutters', sites);
  }

  if (!mobile) {
    MASTER_SOURCES.filter(([key]) => can(key)).forEach(([key, coll, title, sub]) => {
      const label = MENUS.find(m => m.key === key).label;
      add(label, store.list(coll).filter(r => hit(r.code, title(r), sub(r))).map(r => ({ icon: '≡', title: title(r), sub: sub(r), route: `master/${key}/${r.id}` })));
    });
    add('Pages', MENUS.filter(m => can(m.key) && hit(m.label, m.group)).map(m => ({ icon: '→', title: m.label, sub: m.group, route: routeOf(m) })));
  } else {
    add('Pages', auth.mobileTabs().filter(t => hit(t.label)).map(t => ({ icon: '→', title: t.label, sub: 'Phone', route: t.route })));
  }
  return groups;
}

