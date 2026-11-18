export type GrowthIndicator = 'PESO_EDAD' | 'LONGITUD_TALLA_EDAD' | 'IMC_EDAD' | 'PESO_LONGITUD' | 'PESO_TALLA';
export type GrowthCurveSex = 'MASCULINO' | 'FEMENINO';
export type Lms = { x: number; l: number; m: number; s: number };
export type GrowthResult = { z: number; percentile: number | null; classification: string; state: 'EVALUABLE' | 'IMPLAUSIBLE'; detail: string | null };

const P5_Z = -1.6448536269514729;
const P95_Z = 1.6448536269514722;

/** Abramowitz-Stegun approximation; sufficient for displayed WHO percentile conversion. */
export function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1; const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export function lmsZ(value: number, lms: Lms): number {
  const base = lms.l === 0 ? Math.log(value / lms.m) / lms.s : (Math.pow(value / lms.m, lms.l) - 1) / (lms.s * lms.l);
  if (base > 3) { const z3 = lms.m * Math.pow(1 + lms.l * lms.s * 3, 1 / lms.l); const z2 = lms.m * Math.pow(1 + lms.l * lms.s * 2, 1 / lms.l); return 3 + (value - z3) / (z3 - z2); }
  if (base < -3) { const z3 = lms.m * Math.pow(1 + lms.l * lms.s * -3, 1 / lms.l); const z2 = lms.m * Math.pow(1 + lms.l * lms.s * -2, 1 / lms.l); return -3 - (z3 - value) / (z2 - z3); }
  return base;
}

export function interpolatedLms(rows: Lms[], x: number): Lms | null {
  const exact = rows.find(row => Math.abs(row.x - x) < 0.00001); if (exact) return exact;
  const lower = rows.filter(row => row.x < x).sort((a, b) => b.x - a.x)[0]; const upper = rows.filter(row => row.x > x).sort((a, b) => a.x - b.x)[0];
  if (!lower || !upper) return null;
  const portion = (x - lower.x) / (upper.x - lower.x);
  return { x, l: lower.l + (upper.l - lower.l) * portion, m: lower.m + (upper.m - lower.m) * portion, s: lower.s + (upper.s - lower.s) * portion };
}

export function correctedLengthCm(tallaCm: number, ageDays: number, type: 'LONGITUD' | 'TALLA'): number {
  if (type === 'TALLA' && ageDays < 731) return tallaCm + 0.7;
  if (type === 'LONGITUD' && ageDays >= 731) return tallaCm - 0.7;
  return tallaCm;
}

export function evaluateGrowth(indicator: GrowthIndicator, value: number, lms: Lms): GrowthResult {
  const z = lmsZ(value, lms);
  // WHO Anthro plausibility limits: WAZ [-6,+5], HAZ [-6,+6],
  // and WHZ/BAZ [-5,+5].  The bounds are inclusive.
  const range = indicator === 'PESO_EDAD' ? [-6, 5] : indicator === 'LONGITUD_TALLA_EDAD' ? [-6, 6] : [-5, 5];
  if (!Number.isFinite(z) || z < range[0] || z > range[1]) return { z, percentile: null, classification: 'NO_EVALUABLE', state: 'IMPLAUSIBLE', detail: `Valor fuera del rango de plausibilidad OMS para ${indicator}.` };
  const classification = z < P5_Z ? 'BAJO_P5' : z > P95_Z ? 'ALTO_P95' : 'ADECUADO';
  // OMS no publica percentiles por encima de |Z| 3; preserve that limit instead of inventing precision.
  return { z, percentile: Math.abs(z) <= 3 ? normalCdf(z) * 100 : null, classification, state: 'EVALUABLE', detail: Math.abs(z) <= 3 ? null : 'Puntuación Z extrema; OMS no publica percentil fuera de ±3.' };
}
