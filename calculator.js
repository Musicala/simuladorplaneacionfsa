'use strict';

/**
 * calculator.js — FSA · Simulador 2026 (Mar–Nov)
 * Cálculo interno (NO mostrar desglose al cliente).
 *
 * Incluye:
 * ✅ Operación Mar–Nov (9 meses)
 * ✅ Factor contrato: 4h clase = 6h contrato (1.5x)
 * ✅ Nómina fija escalonada por volumen
 * ✅ Supervisión promediada mensual
 * ✅ Error 1% + Margen final (CFG.FINAL_MARGIN)
 * ✅ Retención (CFG.RETENTION_PCT) aplicada sobre la FACTURA:
 *    - Si te retienen 6%, para recibir X neto debes facturar X / (1-0.06)
 * ✅ Redondeo comercial hacia arriba (miles)
 */

export const CFG = {
  MONTHS: 9,
  ROUND_UP_STEP: 1000,

  // Factor: 4h clase = 6h contrato (incluye admin/academ + huecos + almuerzo etc.)
  CONTRACT_FACTOR: 1.5,

  // Nómina fija operación (3 cargos)
  FIXED_PAYROLL_MONTHLY: 10603892,
  PAYROLL_PCT_BY_WEEKLY_CLASS_HOURS: [
    { gt: 160, pct: 0.70 },
    { gt: 80,  pct: 0.60 },
    { gt: 40,  pct: 0.50 },
    { gt: -Infinity, pct: 0.40 }, // mínimo
  ],

  // Costos fijos extra mensuales (siempre completos)
  EXTRA_FIXED_MONTHLY: 1740970,

  // Docentes: contratos semanales -> costo mensual
  TEACHER_CONTRACTS: [
    { hours: 34, monthly: 3091008 },
    { hours: 30, monthly: 2784240 },
    { hours: 28, monthly: 2651600 },
    { hours: 24, monthly: 2341056 },
  ],

  // Horas sueltas (por hora) si no alcanza a formar contrato mínimo
  LOOSE_HOURLY_COST: 106000,

  // Supervisión
  // - 1 jornada visible = 4h clase
  // - se visita 1 vez por jornada, en 4 meses del año
  // - $40.000 por visita (2h)
  SUPERVISOR_VISIT_COST: 40000,
  VISIT_MONTHS_PER_YEAR: 4,

  // Error + margen final
  ERROR_PCT: 0.01,
  FINAL_MARGIN: 0.06,

  // ✅ Retenciones sobre la factura (lo que “se te descuenta” al pagar)
  // Ej: 0.06 = 6%
  RETENTION_PCT: 0.06,
};

/* =========================
   Utils
========================= */
function nnum(x){
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

export function ceilToStep(value, step = CFG.ROUND_UP_STEP){
  const v = nnum(value);
  const s = Math.max(1, nnum(step) || 1);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.ceil(v / s) * s;
}

export function moneyCOP(n){
  const v = Math.round(nnum(n));
  return v.toLocaleString('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 });
}

export function getPayrollPct(weeklyClassHours){
  const h = nnum(weeklyClassHours);
  for (const rule of CFG.PAYROLL_PCT_BY_WEEKLY_CLASS_HOURS){
    if (h > rule.gt) return rule.pct;
  }
  return 0.40;
}

/**
 * Asigna contratos para cubrir horas CONTRATADAS semanales.
 * Estrategia simple: usar 34, luego 30, luego 28, luego 24.
 * Lo que quede (<24) => horas sueltas.
 */
export function estimateTeachersCost(weeklyContractHours){
  let remaining = Math.max(0, nnum(weeklyContractHours));
  let teachers = 0;
  let monthlyCost = 0;

  for (const c of CFG.TEACHER_CONTRACTS){
    if (remaining <= 0) break;

    const blockHours = Math.max(0, nnum(c.hours));
    const blockMonthly = Math.max(0, nnum(c.monthly));
    if (!blockHours || !blockMonthly) continue;

    const count = Math.floor(remaining / blockHours);
    if (count > 0){
      teachers += count;
      monthlyCost += count * blockMonthly;
      remaining -= count * blockHours;
    }
  }

  // Residual < 24 => horas sueltas
  let looseHours = 0;
  let looseMonthly = 0;
  if (remaining > 0){
    looseHours = remaining;
    looseMonthly = looseHours * nnum(CFG.LOOSE_HOURLY_COST);

    // Para "docentes estimados" sumamos 1 si hay sueltas
    teachers += 1;
    monthlyCost += looseMonthly;
  }

  return {
    teachers,
    monthlyCost,
    looseHours,
    looseMonthly,
  };
}

/* =========================
   Core
========================= */
/**
 * Cálculo total del escenario.
 * Input: centers = [{name, hours}]
 * - hours = horas semanales de CLASE (lo que el cliente entiende).
 */
export function computeScenario(centers){
  const list = Array.isArray(centers) ? centers : [];

  const weeklyClassHours = list.reduce((acc, c) => acc + nnum(c?.hours), 0);
  const jornadasWeek = weeklyClassHours / 4;              // 4h clase = 1 día completo (2 jornadas)
  const weeklyContractHours = weeklyClassHours * nnum(CFG.CONTRACT_FACTOR);

  // Docentes (costo mensual según horas de contrato)
  const teachersInfo = estimateTeachersCost(weeklyContractHours);

  // Nómina fija imputada por escala (según horas de clase semanales)
  const payrollPct = getPayrollPct(weeklyClassHours);
  const fixedPayroll = nnum(CFG.FIXED_PAYROLL_MONTHLY) * payrollPct;

  // Supervisión (promedio mensual)
  const visitsYear = jornadasWeek * nnum(CFG.VISIT_MONTHS_PER_YEAR);
  const supervisionTotalPeriod = visitsYear * nnum(CFG.SUPERVISOR_VISIT_COST);
  const supervisionMonthlyAvg = supervisionTotalPeriod / nnum(CFG.MONTHS);

  // Costo interno mensual (lo que realmente cuesta operar)
  const internalMonthly =
    nnum(teachersInfo.monthlyCost) +
    fixedPayroll +
    nnum(CFG.EXTRA_FIXED_MONTHLY) +
    supervisionMonthlyAvg;

  // Error (colchón) + margen
  const withError = internalMonthly * (1 + nnum(CFG.ERROR_PCT));
  const priceMonthlyRaw = withError / (1 - nnum(CFG.FINAL_MARGIN));

  // ✅ Retención aplicada sobre factura:
  // Queremos que el "neto recibido" ≈ priceMonthlyRaw (tras margen+error)
  const retentionPct = Math.min(Math.max(0, nnum(CFG.RETENTION_PCT)), 0.99);
  const priceMonthlyAfterRetentionRaw = priceMonthlyRaw / (1 - retentionPct);

  // Redondeo comercial hacia arriba
  const priceMonthly = ceilToStep(priceMonthlyAfterRetentionRaw, CFG.ROUND_UP_STEP);
  const totalPeriod = priceMonthly * nnum(CFG.MONTHS);

  // Útil para “beneficio”/transparencia interna:
  // Neto recibido estimado después de retención (aprox, sin redondeo fino)
  const netMonthlyAfterRetentionApprox = priceMonthly * (1 - retentionPct);

  return {
    weeklyClassHours,
    jornadasWeek,
    weeklyContractHours,

    teachers: teachersInfo.teachers,
    _teachersDetail: teachersInfo, // interno

    // Precio a facturar (incluye retención)
    priceMonthly,
    totalPeriod,

    // Internos útiles (para debug / validación)
    _internal: {
      payrollPct,
      fixedPayroll,
      extraFixedMonthly: nnum(CFG.EXTRA_FIXED_MONTHLY),
      supervisionMonthlyAvg,
      internalMonthly,
      withError,

      // Antes de retención
      priceMonthlyRaw,

      // Retención
      retentionPct,
      priceMonthlyAfterRetentionRaw,
      netMonthlyAfterRetentionApprox,
    },
  };
}
