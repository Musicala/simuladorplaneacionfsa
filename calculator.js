'use strict';

/**
 * calculator.js — FSA · Simulador 2026 (Mar–Nov)
 * Cálculo interno (NO mostrar desglose al cliente).
 *
 * Objetivo de esta versión:
 * ✅ Mantener compatibilidad con el app.js actual (mismos campos clave)
 * ✅ Agregar “paso por paso” (montos de % y subtotales)
 * ✅ Desglose estimado por docente (por contratos + sueltas)
 * ✅ Dejar todo listo para que Admin muestre: “X%, cuánto es, y total con eso”
 */

export const CFG = {
  MONTHS: 9,
  ROUND_UP_STEP: 1000,

  // Factor: 4h clase = 6h contrato (incluye admin/academ + huecos + almuerzo etc.)
  CONTRACT_FACTOR: 1.5,

  // Nómina fija operación (3 cargos)
  FIXED_PAYROLL_MONTHLY: 10603892,
  PAYROLL_PCT_BY_WEEKLY_CLASS_HOURS: [
    { gt: 119, pct: 0.70 },
    { gt: 79,  pct: 0.60 },
    { gt: 39,  pct: 0.50 },
    { gt: -Infinity, pct: 0.40 }, // mínimo
  ],

  // Costos fijos extra mensuales (siempre completos)
  EXTRA_FIXED_MONTHLY: 1768753,

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
  SUPERVISOR_VISIT_COST: 60580,
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

function clamp01(x){
  const v = nnum(x);
  if (v < 0) return 0;
  if (v > 0.99) return 0.99; // evitamos div por 0
  return v;
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

function roundMoney(n){
  // Para cálculos internos NO redondeamos a miles, pero sí a entero COP
  return Math.round(nnum(n));
}

/**
 * Asigna contratos para cubrir horas CONTRATADAS semanales.
 * Estrategia simple: usar 34, luego 30, luego 28, luego 24.
 * Lo que quede (<24) => horas sueltas.
 *
 * ✅ Mejora: devuelve breakdown y “lista de docentes” estimada
 */
export function estimateTeachersCost(weeklyContractHours){
  let remaining = Math.max(0, nnum(weeklyContractHours));

  let teachers = 0;
  let monthlyCost = 0;

  const breakdown = []; // [{contractHours, count, monthlyEach, total, label}]
  const teachersList = []; // [{label, contractHours, monthly, type:'contract'|'loose'}]

  const contracts = (CFG.TEACHER_CONTRACTS || [])
    .map(c => ({ hours: nnum(c.hours), monthly: nnum(c.monthly) }))
    .filter(c => c.hours > 0 && c.monthly > 0);

  // Orden (por si alguien mueve CFG)
  contracts.sort((a,b) => b.hours - a.hours);

  // Contratos por bloque
  for (const c of contracts){
    if (remaining <= 0) break;

    const count = Math.floor(remaining / c.hours);
    if (count > 0){
      const total = count * c.monthly;

      teachers += count;
      monthlyCost += total;
      remaining -= count * c.hours;

      breakdown.push({
        contractHours: c.hours,
        count,
        monthlyEach: c.monthly,
        total,
        label: `${c.hours}h/sem`,
      });

      // “Docente 1..N” estimado para admin
      for (let i = 0; i < count; i++){
        teachersList.push({
          label: `Docente ${teachersList.length + 1}`,
          type: 'contract',
          contractHours: c.hours,
          monthly: c.monthly,
        });
      }
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

    breakdown.push({
      contractHours: 0,
      count: 1,
      monthlyEach: nnum(CFG.LOOSE_HOURLY_COST),
      total: looseMonthly,
      label: `Horas sueltas (${Math.round(looseHours)}h/sem)`,
    });

    teachersList.push({
      label: `Docente ${teachersList.length + 1}`,
      type: 'loose',
      contractHours: looseHours, // horas sueltas/semana (no contrato)
      monthly: looseMonthly,
      note: `Suelta: ${Math.round(looseHours)}h/sem × ${moneyCOP(CFG.LOOSE_HOURLY_COST)}/h`,
    });
  }

  // Totales “bonitos”
  const contractsHoursAssigned = (breakdown || [])
    .filter(b => b.contractHours > 0)
    .reduce((a,b) => a + (nnum(b.contractHours) * nnum(b.count)), 0);

  return {
    teachers,
    monthlyCost: roundMoney(monthlyCost),
    looseHours: nnum(looseHours),
    looseMonthly: roundMoney(looseMonthly),

    // ✅ nuevos para Admin
    breakdown: breakdown.map(b => ({
      ...b,
      total: roundMoney(b.total),
      monthlyEach: roundMoney(b.monthlyEach),
    })),
    teachersList: teachersList.map(t => ({
      ...t,
      monthly: roundMoney(t.monthly),
      contractHours: nnum(t.contractHours),
    })),

    // “sanity”
    contractsHoursAssigned: nnum(contractsHoursAssigned),
    remainingHoursAfterBlocks: nnum(remaining),
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
  const jornadasWeek = weeklyClassHours / 4; // 4h clase = 1 día completo (2 jornadas)
  const contractFactor = nnum(CFG.CONTRACT_FACTOR) || 1.5;
  const weeklyContractHours = weeklyClassHours * contractFactor;

  // Docentes (costo mensual según horas de contrato)
  const teachersInfo = estimateTeachersCost(weeklyContractHours);

  // Nómina fija imputada por escala (según horas de clase semanales)
  const payrollPct = getPayrollPct(weeklyClassHours);
  const fixedPayrollBase = nnum(CFG.FIXED_PAYROLL_MONTHLY);
  const fixedPayroll = fixedPayrollBase * payrollPct;

  // Supervisión (promedio mensual)
  const months = Math.max(1, nnum(CFG.MONTHS) || 9);
  const visitsYear = jornadasWeek * nnum(CFG.VISIT_MONTHS_PER_YEAR);
  const supervisionVisitCost = nnum(CFG.SUPERVISOR_VISIT_COST);
  const supervisionTotalPeriod = visitsYear * supervisionVisitCost;
  const supervisionMonthlyAvg = supervisionTotalPeriod / months;

  // Extras fijos
  const extraFixedMonthly = nnum(CFG.EXTRA_FIXED_MONTHLY);

  // Costo interno mensual (lo que realmente cuesta operar)
  const internalMonthly =
    nnum(teachersInfo.monthlyCost) +
    fixedPayroll +
    extraFixedMonthly +
    supervisionMonthlyAvg;

  /* =========================
     PASO A PASO (Error + Margen + Retención)
     Importante:
     - Margen aquí se aplica como: price = cost / (1 - margin)
       (no cost * (1+margin))
========================= */

  // Error (colchón)
  const errorPct = clamp01(CFG.ERROR_PCT);
  const errorAmount = internalMonthly * errorPct;
  const withError = internalMonthly + errorAmount;

  // Margen final
  const marginPct = clamp01(CFG.FINAL_MARGIN);
  const priceMonthlyRaw = withError / (1 - marginPct);

  // “margen en $” equivalente (lo que queda por encima de withError)
  const marginAmount = priceMonthlyRaw - withError;

  // Retención aplicada sobre factura
  const retentionPct = clamp01(CFG.RETENTION_PCT);
  const priceMonthlyAfterRetentionRaw = priceMonthlyRaw / (1 - retentionPct);

  // “retención en $” (sobre la factura necesaria, cuánto te descuentan aprox)
  const retentionAmountRaw = priceMonthlyAfterRetentionRaw - priceMonthlyRaw;

  // Redondeo comercial hacia arriba (lo que se factura)
  const priceMonthly = ceilToStep(priceMonthlyAfterRetentionRaw, CFG.ROUND_UP_STEP);
  const totalPeriod = priceMonthly * months;

  // Neto recibido estimado después de retención (aprox, desde el redondeado)
  const netMonthlyAfterRetentionApprox = priceMonthly * (1 - retentionPct);

  // Retención aprox sobre el valor redondeado (para mostrar “paso por paso” consistente con lo facturado)
  const retentionAmountRoundedApprox = priceMonthly - netMonthlyAfterRetentionApprox;

  // Paso por paso listo para UI Admin (sin obligarte a recalcular nada en app.js)
  const _steps = {
    inputs: {
      weeklyClassHours: nnum(weeklyClassHours),
      contractFactor,
      weeklyContractHours: nnum(weeklyContractHours),
      jornadasWeek: nnum(jornadasWeek),
      months,
    },

    teachers: {
      teachersEstimated: teachersInfo.teachers,
      weeklyContractHours: nnum(weeklyContractHours),
      monthlyCost: roundMoney(teachersInfo.monthlyCost),
      breakdown: teachersInfo.breakdown,
      teachersList: teachersInfo.teachersList,
      looseHours: nnum(teachersInfo.looseHours),
      looseMonthly: roundMoney(teachersInfo.looseMonthly),
    },

    fixedPayroll: {
      baseMonthly: roundMoney(fixedPayrollBase),
      pctApplied: nnum(payrollPct),
      amount: roundMoney(fixedPayroll),
    },

    supervision: {
      jornadasWeek: nnum(jornadasWeek),
      visitMonthsPerYear: nnum(CFG.VISIT_MONTHS_PER_YEAR),
      visitCost: roundMoney(supervisionVisitCost),
      visitsYear: nnum(visitsYear),
      totalPeriod: roundMoney(supervisionTotalPeriod),
      monthlyAvg: roundMoney(supervisionMonthlyAvg),
    },

    internal: {
      extraFixedMonthly: roundMoney(extraFixedMonthly),
      internalMonthly: roundMoney(internalMonthly),
    },

    error: {
      pct: errorPct,
      amount: roundMoney(errorAmount),
      totalWithError: roundMoney(withError),
    },

    margin: {
      pct: marginPct,
      amount: roundMoney(marginAmount),
      priceMonthlyRaw: roundMoney(priceMonthlyRaw),
    },

    retention: {
      pct: retentionPct,
      amountRaw: roundMoney(retentionAmountRaw),
      priceMonthlyAfterRetentionRaw: roundMoney(priceMonthlyAfterRetentionRaw),

      // “real” vs “facturado redondeado”
      billedMonthlyRounded: roundMoney(priceMonthly),
      netMonthlyAfterRetentionApprox: roundMoney(netMonthlyAfterRetentionApprox),
      retentionAmountRoundedApprox: roundMoney(retentionAmountRoundedApprox),
    },

    totals: {
      priceMonthly: roundMoney(priceMonthly),
      totalPeriod: roundMoney(totalPeriod),
    },
  };

  return {
    weeklyClassHours,
    jornadasWeek,
    weeklyContractHours,

    teachers: teachersInfo.teachers,
    _teachersDetail: teachersInfo, // interno legacy/compat

    // Precio a facturar (incluye retención)
    priceMonthly,
    totalPeriod,

    // Internos útiles (para debug / validación) — compat con tu app.js
    _internal: {
      // Nómina fija
      payrollPct,
      fixedPayroll: roundMoney(fixedPayroll),
      fixedPayrollBase: roundMoney(fixedPayrollBase),

      // Extras
      extraFixedMonthly: roundMoney(extraFixedMonthly),

      // Supervisión
      supervisionMonthlyAvg: roundMoney(supervisionMonthlyAvg),
      supervisionTotalPeriod: roundMoney(supervisionTotalPeriod),
      visitsYear: nnum(visitsYear),

      // Costos
      internalMonthly: roundMoney(internalMonthly),

      // Error
      errorPct,
      errorAmount: roundMoney(errorAmount),
      withError: roundMoney(withError),

      // Margen
      marginPct,
      marginAmount: roundMoney(marginAmount),
      priceMonthlyRaw: roundMoney(priceMonthlyRaw),

      // Retención
      retentionPct,
      retentionAmountRaw: roundMoney(retentionAmountRaw),
      priceMonthlyAfterRetentionRaw: roundMoney(priceMonthlyAfterRetentionRaw),

      // Neto aprox (redondeado)
      netMonthlyAfterRetentionApprox: roundMoney(netMonthlyAfterRetentionApprox),
      retentionAmountRoundedApprox: roundMoney(retentionAmountRoundedApprox),

      // Meta
      months,
      roundUpStep: nnum(CFG.ROUND_UP_STEP),
      contractFactor,
    },

    // ✅ Nuevo: todo el “paso por paso” empaquetado para Admin (UI friendly)
    _steps,
  };
}
