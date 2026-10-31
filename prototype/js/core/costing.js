// Calculations only (no screen code), so results can be checked against the team lead's Excel.
// Stretch 1: shutter size rule and labour hourly rates. Stretch 2 adds the estimate calculations.

export const FT_TO_M = 0.3048;
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
