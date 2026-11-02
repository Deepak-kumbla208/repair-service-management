// Calculations only (no screen code), so results can be checked against the team lead's Excel.
// Stretch 1: shutter size rule and labour rates. Stretch 2: the Repair estimate (Excel tabs Labour, Transport,
// Materials, Equipment, Overhead_Margin and Summary), Job / Line costing and money rounding. Stretch 3: the AMC estimate
// (also used for General Servicing) and the billing-plan instalments.

export const FT_TO_M = 0.3048;
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Qty and rate of a priced row: the row's own quantity when the amount splits into whole cents (2 × 116.50 = 233.00),
// otherwise one, so Qty × Rate always equals the Amount.
export function qtyRate(amount, qty) {
  const q = Number(qty) || 1;
  return q > 1 && Math.round(round2(amount) * 100) % q === 0 ? { qty: q, rate: round2(amount / q) } : { qty: 1, rate: round2(amount) };
}
const num = v => Number(v) || 0;
const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0);

export const toMetres = (value, unit) => (value == null || value === '' ? null : unit === 'ft' ? Number(value) * FT_TO_M : Number(value));

// One size rule (PLAN.md, decision A4): a shutter gets the smallest size whose width AND height both fit.
// sizes: Shutter Size master rows with maxWidth / maxHeight in metres (blank = no limit, e.g. XL).
export function classifySize(widthM, heightM, sizes) {
  if (!widthM || !heightM) return '';
  const ordered = [...sizes].filter(s => s.status !== 'Inactive').sort((a, b) => a.order - b.order);
  const fit = ordered.find(s => (s.maxWidth == null || widthM <= s.maxWidth + 1e-9) && (s.maxHeight == null || heightM <= s.maxHeight + 1e-9));
  return fit ? fit.code : '';
}

// Hourly rate = monthly cost ÷ days per month ÷ hours per day (Labour sheet, row 27).
export const hourlyRate = (monthly, days = 26, hours = 8) => (days && hours ? Number(monthly || 0) / days / hours : 0);
// OT rate = hourly × 1.5 (Labour sheet, row 28).
export const otRate = (hourly, multiplier = 1.5) => Number(hourly || 0) * multiplier;

// Total man-hours on the Site Viewing Report, section 3.
export const manHours = (persons, days, hoursPerDay) => Number(persons || 0) * Number(days || 0) * Number(hoursPerDay || 0);

// ---------- Repair labour from the shutters (rate card, PLAN.md) ----------
// Hours for one shutter: the Shutter Size master's repair hours × qty (no factor by shutter type: user, 2 Nov 2026).
// Returns { teamHrs, extraWorkers, extraHrs } so the Labour tab can count labour once.
export function shutterLabour(size, qty = 1) {
  if (!size) return { teamHrs: 0, extraWorkers: 0, extraHrs: 0 };
  const q = num(qty) || 1;
  return {
    teamHrs: round2(num(size.repairTeamHrs) * q),
    extraWorkers: num(size.repairExtraWorkers),
    extraHrs: round2(num(size.repairExtraHrs) * q),
  };
}

// ---------- One row of each Excel tab ----------
// Labour: Basic = Team × Hrs × Rate; OT = OT Hours × OT Rate; Total = Basic + OT.
export function labourRow(r) {
  const basic = num(r.team) * num(r.hrs) * num(r.rate);
  const ot = num(r.otHrs) * num(r.otRate);
  return { basic, ot, total: basic + ot };
}
// Transport: Total = No. of Hrs × Fixed Charge per Hr (No. of Hrs = trips × the zone's round trip, a screen helper).
export const transportRow = r => num(r.hrs) * num(r.rate);
// Materials: Total Qty = Qty × (1 + Wastage); Amount = Total Qty × Rate. Wastage is kept as a percentage.
export function materialRow(r) {
  const totalQty = num(r.qty) * (1 + num(r.wastage) / 100);
  return { totalQty, amount: totalQty * num(r.rate) };
}
// Equipment: Amount = Qty × Duration × Rate.
export const equipmentRow = r => num(r.qty) * num(r.duration) * num(r.rate);

// Overheads: each row is a % of direct cost or a fixed amount (Overhead_Margin sheet, rows 6–15).
export const pctOverhead = rows => sum(rows || [], r => (r.basis === 'FIXED' ? 0 : num(r.value) / 100));
export const fixedOverhead = rows => sum(rows || [], r => (r.basis === 'FIXED' ? num(r.value) : 0));

// Margin (Overhead_Margin D23): "Markup on Cost" = cost × %; otherwise margin on price = cost ÷ (1 − %) − cost.
export function marginAmount(basis, pct, cost) {
  const m = num(pct) / 100;
  if (basis === 'MARGIN') return m < 1 ? cost / (1 - m) - cost : 0;
  return cost * m;
}

// Direct cost of each tab, optionally only the rows of one line (lineKey), or the shared rows (lineKey '').
function heads(est, pick = () => true) {
  return {
    labour: sum((est.labour || []).filter(pick), r => labourRow(r).total),
    transport: sum((est.transport || []).filter(pick), transportRow),
    materials: sum((est.materials || []).filter(pick), r => materialRow(r).amount),
    equipment: sum((est.equipment || []).filter(pick), equipmentRow),
  };
}
const headsTotal = h => h.labour + h.transport + h.materials + h.equipment;

// ---------- The Summary sheet ----------
// est: { labour, transport, materials, equipment, overheads, marginBasis, marginPct, taxRate, lines, costingLevel, sharedCosts }
export function summarize(est, zones = []) {
  const h = heads(est);
  const direct = headsTotal(h);
  const overhead = direct * pctOverhead(est.overheads) + fixedOverhead(est.overheads);
  const cbm = direct + overhead;
  const margin = marginAmount(est.marginBasis, est.marginPct, cbm);
  const sell = cbm + margin;
  const subtotal = round2(sell);
  const taxRate = num(est.taxRate);
  const tax = round2(subtotal * taxRate / 100);
  const pctOf = v => (sell ? v / sell : 0);
  const transportByZone = zones.map(z => ({ zoneId: z.id, label: `Zone ${z.code} · ${z.name}`, cost: sum((est.transport || []).filter(r => r.zoneId === z.id), transportRow) }));
  const zoned = sum(transportByZone, z => z.cost);
  return {
    heads: h, direct, overhead, cbm, margin, sell, subtotal, taxRate, tax, total: round2(subtotal + tax),
    pct: { labour: pctOf(h.labour), transport: pctOf(h.transport), materials: pctOf(h.materials), equipment: pctOf(h.equipment), direct: pctOf(direct), overhead: pctOf(overhead), cbm: pctOf(cbm), margin: pctOf(margin) },
    markupPct: cbm ? (margin / cbm) * 100 : 0,
    marginOnPricePct: sell ? (margin / sell) * 100 : 0,
    transportByZone, transportOther: h.transport - zoned,
    lines: linePrices(est, subtotal),
  };
}

// ---------- Job / Line costing (PLAN.md "Job cost and line cost") ----------
// Every row carries a lineKey; a row with no line is a shared cost (transport trip, scissor lift, fixed overhead).
// SPREAD: shared costs are divided over the lines by each line's direct cost. OWN_LINE: they become their own line.
// Either way the total equals Job costing: line prices are rounded and the left-over cent goes on the biggest line.
export function linePrices(est, subtotal) {
  const lines = est.lines || [];
  const keys = new Set(lines.map(l => l.key));
  const p = pctOverhead(est.overheads), fixed = fixedOverhead(est.overheads);
  const sharedDirect = headsTotal(heads(est, r => !keys.has(r.lineKey)));
  const own = lines.map(l => ({ key: l.key, description: l.description, direct: headsTotal(heads(est, r => r.lineKey === l.key)) }));
  const priceOf = (direct, extraOverhead) => {
    const cost = direct + direct * p + extraOverhead;
    return { cost, price: cost + marginAmount(est.marginBasis, est.marginPct, cost) };
  };
  let out;
  if (est.sharedCosts === 'OWN_LINE') {
    out = own.map(l => ({ ...l, shared: 0, ...priceOf(l.direct, 0) }));
    if (sharedDirect || fixed) out.push({ key: '_shared', description: est.sharedLabel || 'Transport & mobilisation', direct: sharedDirect, shared: 0, ...priceOf(sharedDirect, fixed), isShared: true });
  } else {
    const base = sum(own, l => l.direct);
    out = own.map(l => {
      const w = base ? l.direct / base : 1 / (own.length || 1);
      return { ...l, shared: sharedDirect * w, ...priceOf(l.direct + sharedDirect * w, fixed * w) };
    });
  }
  return allocateCents(out, subtotal ?? round2(sum(out, l => l.price)));
}

// Round each line price to cents; any difference to the rounded total goes on the biggest line.
export function allocateCents(lines, total) {
  if (!lines.length) return [];
  const out = lines.map(l => ({ ...l, rounded: round2(l.price) }));
  const diff = round2(total - sum(out, l => l.rounded));
  if (diff) {
    const big = out.reduce((b, l) => (l.price > b.price ? l : b), out[0]);
    big.rounded = round2(big.rounded + diff);
  }
  return out;
}

// GST on a subtotal that is already rounded to cents.
export function taxTotals(subtotal, taxRate) {
  const s = round2(subtotal);
  const tax = round2(s * num(taxRate) / 100);
  return { subtotal: s, tax, total: round2(s + tax) };
}

// Payment-term days: IMMEDIATE = 0, D7 = 7, D15 = 15, D30 = 30.
export const termDays = code => (code && code.startsWith('D') ? parseInt(code.slice(1), 10) || 0 : 0);

// Ageing bucket of an unpaid amount by days past the due date.
export function ageBucket(daysOverdue) {
  if (daysOverdue <= 30) return '0–30';
  if (daysOverdue <= 60) return '31–60';
  if (daysOverdue <= 90) return '61–90';
  return '90+';
}

// ---------- AMC and General Servicing (AMC estimator Excel: Labour_Matrix, Shutters, Transport, Equipment,
// Overhead_Margin, Summary) ----------
// Billing plan: how many invoices a contract year has. ONCE = General Servicing (no contract).
export const BILLING_COUNT = { MONTHLY: 12, QUARTERLY: 4, HALF: 2, YEARLY: 1, ONCE: 1 };

// Labour_Matrix F: cost per shutter per visit = team hrs × team rate + extra workers × their hrs × extra worker rate.
export const matrixCost = (size, teamRate, extraRate) => num(size.teamHrs) * num(teamRate) + num(size.extraWorkers) * num(size.extraHrs) * num(extraRate);
// Days on site for one visit (8 working hours a day); a screen helper for the calendar, not part of the price.
export const daysOnSite = (teamHrs, hoursPerDay = 8) => Math.max(1, Math.ceil(num(teamHrs) / hoursPerDay - 1e-9));

// One row of the Shutters sheet: J total shutters, K std team hrs per visit, L labour per visit, M annual labour (L × D).
export function amcSiteRow(site, matrix) {
  const sizes = matrix?.sizes || [];
  const count = code => num(site.counts?.[code]);
  const shutters = sum(sizes, s => count(s.code));
  const hrsVisit = sum(sizes, s => count(s.code) * num(s.teamHrs));
  const perVisit = sum(sizes, s => count(s.code) * matrixCost(s, matrix.team?.rate, matrix.extra?.rate));
  return { shutters, hrsVisit, perVisit, annual: perVisit * num(site.visits), days: daysOnSite(hrsVisit) };
}

// Visits a row is used on: its site's visits, or every site's visits for a row shared by all sites.
const visitsFor = (est, siteKey) => (siteKey ? num((est.sites || []).find(s => s.key === siteKey)?.visits) : sum(est.sites || [], s => num(s.visits)));

// The AMC tabs as the generic rows summarize() uses, so overhead, margin, rounding and Line costing (one line per site)
// are the Repair estimate's own rules: labour = M (per visit × visits); transport = visits × the zone's travel hrs ×
// its rate; equipment = qty × duration per visit × visits × rate; materials = qty per visit × visits.
export function amcRows(est) {
  const zoneRow = id => (est.transport || []).find(t => t.zoneId === id);
  const labour = (est.sites || []).map(s => ({ key: `lab_${s.key}`, trade: 'AMC labour (Labour_Matrix)', team: 1, hrs: num(s.visits), rate: amcSiteRow(s, est.matrix).perVisit, otHrs: 0, otRate: 0, lineKey: s.key }));
  const transport = (est.sites || []).map(s => { const z = zoneRow(s.zoneId); return { key: `tr_${s.key}`, zoneId: s.zoneId, hrs: num(s.visits) * num(z?.hrs), rate: num(z?.rate), lineKey: s.key }; });
  const equipment = (est.equipment || []).map(r => ({ ...r, duration: num(r.duration) * visitsFor(est, r.siteKey), lineKey: r.siteKey || '' }));
  const materials = (est.materials || []).map(r => ({ ...r, qty: num(r.qty) * visitsFor(est, r.siteKey), lineKey: r.siteKey || '' }));
  const lines = (est.sites || []).map(s => { const x = amcSiteRow(s, est.matrix); return { key: s.key, tag: '', description: `${s.name}: ${x.shutters} shutter${x.shutters === 1 ? '' : 's'}, ${num(s.visits)} visit${num(s.visits) === 1 ? '' : 's'} a year` }; });
  return { labour, transport, equipment, materials, lines };
}

// Instalments of the billing plan: rounded down to cents, the left-over cents on the last one; tax on each invoice.
export function instalments(subtotal, taxRate, n = 1) {
  const s = round2(subtotal), count = Math.max(1, num(n));
  const each = Math.floor((s / count) * 100 + 1e-6) / 100;
  return Array.from({ length: count }, (_, i) => {
    const amount = i === count - 1 ? round2(s - each * (count - 1)) : each;
    const tax = round2(amount * num(taxRate) / 100);
    return { n: i + 1, of: count, amount, tax, total: round2(amount + tax) };
  });
}

// The AMC Summary sheet: cost heads, the AMC metrics (per shutter per year, per month) and the zone-wise table.
// GST is the sum of the GST on each planned invoice, so the quotation and its invoices match to the cent.
export function summarizeAmc(est, zones = []) {
  const rows = amcRows(est);
  const base = summarize({ ...est, ...rows, sharedLabel: est.sharedLabel || 'Shared equipment and materials' }, zones);
  const sites = (est.sites || []).map(s => ({ key: s.key, zoneId: s.zoneId, visits: num(s.visits), ...amcSiteRow(s, est.matrix) }));
  const shutters = sum(sites, s => s.shutters), visits = sum(sites, s => s.visits);
  const plan = instalments(base.subtotal, base.taxRate, BILLING_COUNT[est.billing] || 1);
  const tax = round2(sum(plan, p => p.tax));
  const total = round2(base.subtotal + tax);
  const zoneTable = zones.map(z => {
    const at = sites.filter(s => s.zoneId === z.id);
    const cost = sum(rows.transport.filter(t => t.zoneId === z.id), transportRow);
    return { zoneId: z.id, code: z.code, name: z.name, shutters: sum(at, s => s.shutters), visits: sum(at, s => s.visits), cost, pct: base.heads.transport ? cost / base.heads.transport : 0 };
  });
  const other = { shutters: shutters - sum(zoneTable, z => z.shutters), visits: visits - sum(zoneTable, z => z.visits), cost: base.heads.transport - sum(zoneTable, z => z.cost) };
  return {
    ...base, tax, total, sites, plan, zoneTable, zoneOther: { ...other, pct: base.heads.transport ? other.cost / base.heads.transport : 0 },
    metrics: { shutters, visits, perShutterYear: shutters ? base.sell / shutters : 0, perMonth: total / 12, perMonthEx: base.sell / 12, teamHrs: sum(sites, s => s.hrsVisit) },
  };
}
