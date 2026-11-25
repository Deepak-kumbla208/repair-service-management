// Products of every trade in one Product master (user, 25 Nov 2026; mockup mockups/mixed-products.html).
// Each product is costed one of three ways (Value Set Master "Costing Method"):
//   SIZE  - it picks a size set of the Product Size master; its hours come from the size (S / M / L / XL …),
//           found from the measure taken on site (width × height, or one figure such as kW or A).
//   HOURS - no size; its own standard hours per unit (repair, and servicing per visit) × qty.
//   FIXED - a fixed price per unit (a submission, a design); no labour, no site details, never a customer product.
// Products saved before this change have no costing method: they are costed by size in the first size set
// (Width × height), so every saved document keeps its price. No screen code here.
import * as store from './store.js';
import { classifySize, toMetres, shutterLabour, round2 } from './costing.js';

const num = v => Number(v) || 0;
const active = r => r.status !== 'Inactive';

export const COSTING = { SIZE: 'SIZE', HOURS: 'HOURS', FIXED: 'FIXED' };
export const productOf = id => (id ? store.get('products', id) : null);
export const costingOf = p => (p?.costedBy || COSTING.SIZE);
export const isFixed = p => costingOf(p) === COSTING.FIXED;
// A product worked on at the site (it has a location, findings and labour).
export const isPhysical = p => !!p && !isFixed(p);
// Kept in the site's Customer products list (the register) once recorded on site.
export const keeps = p => isPhysical(p) && p.keep !== 'No';

// ---------- Size sets ----------
export const sizeSets = () => store.list('sizeSets').sort((a, b) => num(a.order) - num(b.order) || String(a.code).localeCompare(String(b.code)));
// The first set: sizes saved before size sets existed (no setId) belong to it.
export const defaultSet = () => sizeSets()[0] || null;
const setIdOf = z => z.setId || defaultSet()?.id || '';
export const setSizes = setId => store.list('sizes', z => active(z) && setIdOf(z) === setId).sort((a, b) => num(a.order) - num(b.order));
// Every size of a set, switched off ones too: a size switched off is no longer offered, but what already has it keeps
// its hours.
export const allSetSizes = setId => store.list('sizes', z => setIdOf(z) === setId).sort((a, b) => num(a.order) - num(b.order));
export function setOfProduct(p) {
  if (!p || costingOf(p) !== COSTING.SIZE) return null;
  return (p.sizeSetId && store.get('sizeSets', p.sizeSetId)) || defaultSet();
}
export const sizesOf = p => { const s = setOfProduct(p); return s ? setSizes(s.id) : []; };
export const sizeOf = (p, code) => { const s = setOfProduct(p); return code && s ? allSetSizes(s.id).find(z => z.code === code && active(z)) || allSetSizes(s.id).find(z => z.code === code) || null : null; };
export const isTwoFigure = set => (set?.measure || 'WH') === 'WH';

// The smallest size whose limit holds the measured figure (blank limit = no limit).
export function classifyValue(value, sizes) {
  if (value == null || value === '' || !(Number(value) > 0)) return '';
  const fit = [...sizes].filter(active).sort((a, b) => num(a.order) - num(b.order)).find(z => z.maxValue == null || z.maxValue === '' || Number(value) <= Number(z.maxValue) + 1e-9);
  return fit ? fit.code : '';
}
// The size of a product from what was measured: width × height (m or ft) for a two-figure set, else one figure.
export function classifyFor(p, { width, height, unit = 'm', measure } = {}) {
  const set = setOfProduct(p);
  if (!set) return '';
  const sizes = setSizes(set.id);
  return isTwoFigure(set) ? classifySize(toMetres(width, unit), toMetres(height, unit), sizes) : classifyValue(measure, sizes);
}

// "M · 4 × 3 m", "M · 5.5 kW", "S" (tapped on site), or "No size".
const fig = n => String(Math.round(num(n) * 100) / 100);
export function sizeText(e, { none = 'No size' } = {}) {
  const p = productOf(e?.productId);
  const set = setOfProduct(p);
  if (!set) return p ? none : (e?.sizeCode || '');
  const what = isTwoFigure(set)
    ? (e.width && e.height ? `${fig(e.width)} × ${fig(e.height)} ${e.unit || 'm'}` : '')
    : (e.measure ? `${fig(e.measure)} ${set.unit || ''}`.trim() : '');
  return [e.sizeCode, what].filter(Boolean).join(' · ');
}
// The limit of one size, as shown in the master and on the AMC Labour_Matrix.
export function limitText(z, set) {
  if (isTwoFigure(set)) return z.maxWidth == null ? 'larger' : `≤ ${z.maxWidth} m W × ≤ ${z.maxHeight} m H`;
  return z.maxValue == null || z.maxValue === '' ? 'above' : `≤ ${z.maxValue} ${set?.unit || ''}`.trim();
}

// ---------- Hours ----------
// Repair hours of qty units: the size's repair hours (size set), or the product's standard hours.
export function repairLabour(p, sizeCode, qty = 1) {
  const q = num(qty) || 1;
  if (costingOf(p) === COSTING.HOURS) return { teamHrs: round2(num(p.repairHrs) * q), extraWorkers: num(p.extraWorkers), extraHrs: round2(num(p.extraHrs) * q) };
  if (costingOf(p) === COSTING.FIXED) return { teamHrs: 0, extraWorkers: 0, extraHrs: 0 };
  return shutterLabour(sizeOf(p, sizeCode), q);
}

// ---------- AMC and General Servicing: the Labour_Matrix rows ----------
// One row per size of every size set (key "WH:M"), and one per product with standard servicing hours (key "P:<id>").
// Matrices saved before size sets keyed their rows by the size code alone; amcSiteRow reads either.
// Switched-off sizes and products keep their rows (inactive: true), so what is already covered keeps its hours.
export function matrixRows() {
  const sets = sizeSets();
  const sizes = sets.flatMap(set => allSetSizes(set.id).map(z => ({ key: `${set.code}:${z.code}`, code: z.code, name: z.name, setCode: set.code, setName: set.name,
    limits: limitText(z, set), teamHrs: num(z.amcTeamHrs), extraWorkers: num(z.amcExtraWorkers), extraHrs: num(z.amcExtraHrs), inactive: !active(z) || !active(set) })));
  const own = store.list('products', p => costingOf(p) === COSTING.HOURS && keeps(p)).sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .map(p => ({ key: `P:${p.id}`, code: p.code, name: p.name, setCode: '', setName: 'No size', limits: 'per product', teamHrs: num(p.servHrs), extraWorkers: 0, extraHrs: 0, inactive: !active(p) }));
  return [...sizes, ...own];
}
// The Labour_Matrix key of a customer product.
export function amcKey(e) {
  const p = productOf(e.productId);
  if (costingOf(p) === COSTING.HOURS) return `P:${p.id}`;
  if (costingOf(p) === COSTING.FIXED) return '';
  const set = setOfProduct(p);
  return set && e.sizeCode ? `${set.code}:${e.sizeCode}` : (e.sizeCode || '');
}
// A count key back to a product and size (typed counts become register entries). Old keys are plain size codes of
// the first set.
export function fromKey(key) {
  if (key.startsWith('P:')) return { productId: key.slice(2), sizeCode: '' };
  const [setCode, code] = key.includes(':') ? key.split(':') : [defaultSet()?.code, key];
  const set = sizeSets().find(s => s.code === setCode);
  const prods = store.list('products', p => active(p) && costingOf(p) === COSTING.SIZE && setOfProduct(p)?.id === set?.id);
  const pick = prods.find(p => p.code === 'RS') || prods.sort((a, b) => String(a.code).localeCompare(String(b.code)))[0];
  return { productId: pick?.id || '', sizeCode: code, set };
}

// Typed counts as text: "2 × S, 1 × M (motor power), 3 × Earth pit".
export function countText(counts) {
  const first = defaultSet()?.code;
  return Object.entries(counts || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => {
    if (k.startsWith('P:')) return `${n} × ${productOf(k.slice(2))?.name || 'product'}`;
    const [setCode, code] = k.includes(':') ? k.split(':') : [first, k];
    const set = sizeSets().find(x => x.code === setCode);
    return `${n} × ${code}${set && set.code !== first ? ` (${set.name.toLowerCase()})` : ''}`;
  }).join(', ');
}

// ---------- Tags ----------
// New customer products are tagged by product: the prefix the site already uses for that product (RS-, W-, CG-…),
// else the product code ("BP-"); numbered after the highest tag with that prefix.
export function tagMaker(site, extra = []) {
  const reg = [...(site?.shutters || []), ...extra];
  const next = {};
  return productId => {
    const p = productOf(productId);
    const mine = reg.filter(s => s.productId === productId && s.tag);
    const prefix = mine.length ? mine[mine.length - 1].tag.match(/^\D*/)[0] || `${p?.code || 'P'}-` : `${p?.code || 'P'}-`;
    if (next[prefix] == null) next[prefix] = Math.max(0, ...reg.filter(s => String(s.tag).startsWith(prefix)).map(s => parseInt(String(s.tag).slice(prefix.length), 10)).filter(n => !isNaN(n)));
    next[prefix] += 1;
    return `${prefix}${next[prefix]}`;
  };
}

// The product a new row or customer product starts with: the first of `ids` (the products this work is already about),
// else the product the site has most of, else '' (the user picks). Never a fixed product.
export function likelyProduct(ids = [], site = null, test = isPhysical) {
  const ok = id => test(productOf(id)) && productOf(id)?.status !== 'Inactive';
  const first = ids.find(ok);
  if (first) return first;
  const counts = {};
  (site?.shutters || []).filter(s => s.status !== 'Inactive' && ok(s.productId)).forEach(s => { counts[s.productId] = (counts[s.productId] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

// Where a product is already used: customer products at the sites, and documents still open (enquiries, estimates).
// Its costing, size set and "Customer product" cannot change while it is used: they would re-price what is there.
export function productUses(id) {
  const reg = store.list('customers').reduce((n, c) => n + (c.sites || []).reduce((m, s) => m + (s.shutters || []).filter(x => x.productId === id).length, 0), 0);
  const est = store.list('estimates', e => !['Superseded', 'Cancelled'].includes(e.status) && ((e.shutters || []).some(x => x.productId === id) || (e.fixed || []).some(f => f.productId === id))).length;
  const enq = store.list('enquiries', e => !['Lost', 'Cancelled', 'Closed'].includes(e.status) && (e.lines || []).some(l => l.itemRef === `prd:${id}`)).length;
  return { reg, est, enq, total: reg + est + enq };
}

// ---------- Groups and units ----------
export const groupOf = p => p?.groupCode || '';
// The product groups some work needs (technicians list the groups they work on); a fixed-price product needs none.
export const groupsOf = productIds => [...new Set(productIds.map(productOf).filter(p => isPhysical(p) && p.groupCode).map(p => p.groupCode))];
// A technician's missing groups for some work (a technician with no groups recorded is not checked).
export const missingGroups = (tech, groups) => (tech?.groups ? groups.filter(g => !tech.groups.includes(g)) : []);
export const uoms = () => store.list('uoms', active).sort((a, b) => num(a.order) - num(b.order) || String(a.code).localeCompare(String(b.code)));
export const unitOfProduct = p => p?.unit || 'Nos';
// Units that take whole numbers only (Nos, Set …); a unit not in the master is treated as whole.
export const wholeUnit = code => store.findOne('uoms', u => u.code === code)?.whole !== 'No';
