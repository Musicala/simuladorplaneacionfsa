'use strict';

/**
 * schedule.js — Horario estimado (referencial) · 1 semana (Lun–Sáb)
 *
 * ✅ Regla base:
 * - 1 celda (Docente × Día) = 1 Centro TODO el día (visual).
 * - Día completo visual = 2 jornadas (mañana + tarde) por defecto.
 * - Si un centro requiere 1 jornada en un día (ej: GMMMC martes/jueves), igual “bloquea” el día visualmente,
 *   pero cuenta 1 jornada real.
 *
 * ✅ Lo que pediste (reglas del mundo real):
 * 1) “Sticky center”: si un docente entra a un centro, se queda la mayor racha consecutiva posible.
 * 2) Restricciones fijas:
 *    - ACAPULCO: sábado 2 jornadas sí o sí.
 *    - GMMMC: sábado 2 jornadas, martes 1 jornada, jueves 1 jornada.
 *
 * ✅ FIX CRÍTICO:
 * - Guardamos por día: day.byTeacher[teacherId] = { center, jornadas }
 *   (sin pisar docentes).
 *
 * ✅ Mejora crítica vs tu versión:
 * - Para centros con reglas fijas, el “costo” en días se calcula por los días del plan fijo realmente usados,
 *   NO por ceil(jornadas/2). Ej: GMMMC 4 jornadas = 3 días ocupados (mar, jue, sáb).
 */

/* =========================
   Constants
========================= */
const WEEK_DAYS = [
  { key: 'mon', label: 'Lunes',     blocks: [{ key: 'b1', label: '9–11' }, { key: 'b2', label: '2–4' }] },
  { key: 'tue', label: 'Martes',    blocks: [{ key: 'b1', label: '9–11' }, { key: 'b2', label: '2–4' }] },
  { key: 'wed', label: 'Miércoles', blocks: [{ key: 'b1', label: '9–11' }, { key: 'b2', label: '2–4' }] },
  { key: 'thu', label: 'Jueves',    blocks: [{ key: 'b1', label: '9–11' }, { key: 'b2', label: '2–4' }] },
  { key: 'fri', label: 'Viernes',   blocks: [{ key: 'b1', label: '9–11' }, { key: 'b2', label: '2–4' }] },
  { key: 'sat', label: 'Sábado',    blocks: [{ key: 'b1', label: '8–10' }, { key: 'b2', label: '10–12' }] },
];

const DAYS_PER_WEEK = WEEK_DAYS.length; // 6

// Semántica:
// - jornada = 2 horas (un bloque)
// - día completo = 2 jornadas = 4 horas (visual)
const HOURS_PER_JORNADA = 2;
const JORNADAS_PER_DAY = 2;
const HOURS_PER_DAY = HOURS_PER_JORNADA * JORNADAS_PER_DAY; // 4

// Heurística SOLO si app.js no pasa teachersCount
// (carga objetivo por docente en días a la semana)
const TEACHER_DAYS_TARGET = 4;

/** Restricciones especiales (centros fijos) */
const FIXED_RULES = {
  ACAPULCO: [
    { dayKey: 'sat', jornadas: 2 }, // día completo
  ],
  GMMMC: [
    { dayKey: 'tue', jornadas: 1 },
    { dayKey: 'thu', jornadas: 1 },
    { dayKey: 'sat', jornadas: 2 },
  ],
};

/* =========================
   Public API
========================= */

/**
 * Construye un horario estimado para 1 semana.
 *
 * @param {Array<{name:string, hours:number}>} centers
 * @param {object} [opts]
 * @param {number} [opts.teachersCount]
 * @param {string} [opts.weekLabel]
 * @returns {object} schedule
 */
export function buildEstimatedSchedule(centers, opts = {}) {
  const warnings = [];
  const weekLabel = String(opts.weekLabel || 'Semana (referencial)').trim();

  // 1) Normaliza centros (solo > 0)
  const cleaned = (centers || [])
    .map(c => ({
      name: normalizeName(c?.name),
      hours: Math.max(0, Number(c?.hours || 0)),
    }))
    .filter(c => c.name && c.hours > 0);

  // 2) Demanda base: jornadasNeeded = ceil(hours / 2)
  //    - Normal: se trabaja por días completos (2 jornadas visuales).
  //    - Fijos: se trabaja por el plan fijo (días específicos), y los días ocupados se calculan por ese plan.
  const demand = cleaned
    .map(c => {
      const jornadasNeeded = Math.max(0, Math.ceil(c.hours / HOURS_PER_JORNADA));
      const isFixed = !!FIXED_RULES[c.name];

      if (!isFixed) {
        // Normal: días completos
        const daysNeeded = Math.max(0, Math.ceil(jornadasNeeded / JORNADAS_PER_DAY));
        const roundedJornadas = daysNeeded * JORNADAS_PER_DAY;
        const roundingExtra = Math.max(0, roundedJornadas - jornadasNeeded);

        return {
          name: c.name,
          hours: c.hours,
          jornadasNeeded,
          daysNeeded,              // días visuales ocupados
          roundedJornadas,         // por redondeo a días completos
          roundingExtraJornadas: roundingExtra,
          isFixed: false,
          fixedPlanMaxJ: 0,
          fixedDaysCost: 0,
        };
      }

      // Fijo: el costo en días depende de cuántos días del plan fijo se usan para cubrir jornadasNeeded.
      const plan = FIXED_RULES[c.name] ? FIXED_RULES[c.name].slice() : [];
      const maxPlanJ = plan.reduce((a, x) => a + (Number(x.jornadas || 0)), 0);

      // Simula consumo de jornadas para contar días ocupados reales (aunque sea 1 jornada)
      let remainingJ = jornadasNeeded;
      let fixedDaysCost = 0;

      for (const slot of plan) {
        if (remainingJ <= 0) break;
        const cap = clampJornadas(slot.jornadas);
        const used = Math.min(cap, remainingJ);
        if (used > 0) fixedDaysCost += 1; // día ocupado visualmente
        remainingJ -= used;
      }

      // Si pidió más que lo que el plan permite, igual el plan completo ocupa sus días; lo extra queda pendiente.
      // fixedDaysCost ya representa los días usados del plan para cubrir lo posible (máximo: plan.length).
      // Para reportes, daysNeeded = fixedDaysCost (no ceil(j/2)).
      return {
        name: c.name,
        hours: c.hours,
        jornadasNeeded,
        daysNeeded: fixedDaysCost,
        roundedJornadas: jornadasNeeded, // no “redondeamos” por día completo en fijos: manda el plan
        roundingExtraJornadas: 0,
        isFixed: true,
        fixedPlanMaxJ: maxPlanJ,
        fixedDaysCost,
      };
    })
    .filter(x => x.jornadasNeeded > 0);

  // Demanda total de días visuales ocupados (crítico para docentes)
  const requiredDays = demand.reduce((a, x) => a + (x.daysNeeded || 0), 0);
  const requiredJornadas = demand.reduce((a, x) => a + (x.jornadasNeeded || 0), 0);
  const roundingExtraTotal = demand.reduce((a, x) => a + (x.roundingExtraJornadas || 0), 0);

  if (requiredDays <= 0) {
    return {
      meta: {
        requiredDays: 0,
        requiredJornadas: 0,
        totalCapacityDays: 0,
        totalCapacityJornadas: 0,
        overflowDays: 0,
        overflowJornadas: 0,
        hasOverflow: false,
        teachersCount: 0,
        weekLabel,
        mode: 'single_week',
      },
      week: makeEmptyWeek(weekLabel),
      teachers: [],
      warnings: [],
      unassigned: [],
    };
  }

  // 3) Docentes: prioridad a lo que diga app.js
  let teachersCount = Number(opts.teachersCount);
  if (!Number.isFinite(teachersCount) || teachersCount <= 0) {
    teachersCount = Math.max(1, Math.ceil(requiredDays / TEACHER_DAYS_TARGET));
  }

  const totalCapacityDays = teachersCount * DAYS_PER_WEEK;
  const totalCapacityJornadas = totalCapacityDays * JORNADAS_PER_DAY;

  const overflowDays = Math.max(0, requiredDays - totalCapacityDays);
  const overflowJornadas = overflowDays * JORNADAS_PER_DAY;
  const hasOverflow = overflowDays > 0;

  warnings.push('Semana única: distribución referencial en 1 semana (Lun–Sáb).');
  warnings.push('Regla visual: 1 celda (Docente×Día) = 1 Centro ese día.');
  warnings.push('Sticky center: un docente se queda en un centro el mayor número de días seguidos posible.');
  warnings.push(`Capacidad semanal: ${teachersCount} docente(s) × 6 días = ${totalCapacityDays} día(s) = ${totalCapacityJornadas} jornada(s) visuales.`);
  warnings.push(`Demanda: ${requiredDays} día(s) ocupados visualmente · ~${requiredJornadas} jornada(s) reales.`);
  if (roundingExtraTotal) {
    warnings.push(`Centros normales redondeados a días completos: +${roundingExtraTotal} jornada(s) visuales.`);
  }
  warnings.push('Reglas fijas: ACAPULCO sábado 2j. GMMMC: martes 1j, jueves 1j, sábado 2j.');
  if (hasOverflow) warnings.push(`Pendiente por capacidad: faltan ${overflowDays} día(s) (${overflowJornadas} jornada(s) visuales) por ubicar.`);

  // 4) Semana + docentes
  const week = makeEmptyWeek(weekLabel);

  const teachers = Array.from({ length: teachersCount }, (_, i) => {
    const id = nextTeacherId(i);
    return {
      id,
      label: `Docente ${id}`,
      assignments: [],
      loadDays: 0,
      freeDays: WEEK_DAYS.map(d => d.key),
    };
  });

  // Tracking: jornadas asignadas por centro (para reportes)
  const assignedByCenterJornadas = new Map();

  // 5) Primero: asignación de centros con reglas fijas
  const fixedCenters = demand.filter(d => d.isFixed);

  for (const d of fixedCenters) {
    const plan = (FIXED_RULES[d.name] ? FIXED_RULES[d.name].slice() : []);
    if (!plan.length) continue;

    let remainingJ = Math.max(0, d.jornadasNeeded);

    // Escoge 1 docente ideal que pueda tomar la mayor parte del plan (continuidad)
    const planDays = plan.map(p => p.dayKey);
    const preferredTeacher = pickTeacherForSpecificDays(teachers, planDays);

    // Asignar siguiendo el plan fijo (en orden del plan), hasta cubrir lo requerido
    for (const p of plan) {
      if (remainingJ <= 0) break;

      const j = Math.min(clampJornadas(p.jornadas), remainingJ);

      // Intento 1: docente preferido
      const ok = assignSpecificDay(week, preferredTeacher, p.dayKey, d.name, j);
      if (ok) {
        remainingJ -= j;
        assignedByCenterJornadas.set(d.name, (assignedByCenterJornadas.get(d.name) || 0) + j);
        continue;
      }

      // Fallback: buscar otro docente disponible ese día
      const t2 = pickTeacherForSpecificDays(teachers, [p.dayKey]);
      const ok2 = t2 ? assignSpecificDay(week, t2, p.dayKey, d.name, j) : false;

      if (ok2) {
        remainingJ -= j;
        assignedByCenterJornadas.set(d.name, (assignedByCenterJornadas.get(d.name) || 0) + j);
      }
      // Si falla, se quedará pendiente (se reporta luego)
    }

    if (remainingJ > 0) {
      warnings.push(`⚠️ ${d.name}: quedaron ${remainingJ} jornada(s) pendientes por restricciones fijas (días ocupados o falta de docentes).`);
    }

    // Aviso si pidió más jornadas que las posibles por plan fijo
    const maxPlanJ = d.fixedPlanMaxJ || plan.reduce((a, x) => a + clampJornadas(x.jornadas), 0);
    if (d.jornadasNeeded > maxPlanJ) {
      warnings.push(`⚠️ ${d.name}: se solicitaron ${d.jornadasNeeded} jornada(s) pero el plan fijo máximo es ${maxPlanJ}. El excedente queda pendiente.`);
    }
  }

  // 6) Pool de centros normales (sin reglas fijas) con “días completos” (2 jornadas por día)
  const normalDemand = demand
    .filter(d => !d.isFixed)
    .map(d => ({
      name: d.name,
      remainingDays: Math.max(0, Number(d.daysNeeded || 0)), // días completos
      jornadasNeeded: d.jornadasNeeded,
      roundedJornadas: d.roundedJornadas,
    }))
    .filter(x => x.remainingDays > 0);

  // Orden: más demandante primero (y nombre como desempate)
  normalDemand.sort((a, b) => b.remainingDays - a.remainingDays || a.name.localeCompare(b.name));

  // 7) Asignación “sticky center”: por centro, asignar la mayor racha consecutiva posible a un docente
  for (const c of normalDemand) {
    let remaining = c.remainingDays;

    while (remaining > 0) {
      const pick = pickTeacherBestConsecutiveRun(teachers);
      if (!pick || !pick.teacher) break;

      const t = pick.teacher;
      const run = pick.runDays;
      if (!run.length) break;

      const chunk = Math.min(remaining, run.length);

      for (let i = 0; i < chunk; i++) {
        const dayKey = run[i];

        // seguridad: el run viene de freeDays, pero igual validamos
        if (!t.freeDays.includes(dayKey)) continue;

        assignDayInWeek(week, t, dayKey, c.name, 2);
        removeFreeDay(t, dayKey);
        t.loadDays++;
        assignedByCenterJornadas.set(c.name, (assignedByCenterJornadas.get(c.name) || 0) + 2);
      }

      remaining -= chunk;
    }
  }

  // 8) Unassigned: calculado en jornadas (más exacto con parciales)
  const unassigned = demand
    .map(d => {
      const assignedJ = assignedByCenterJornadas.get(d.name) || 0;
      const remainingJ = Math.max(0, d.jornadasNeeded - assignedJ);
      if (!remainingJ) return null;

      // Días pendientes (visual): si son normales, tiende a ser ceil(remainingJ/2), si son fijos es más “depende”
      // Para reporte, dejamos ceil(remainingJ/2) como referencia.
      return {
        center: d.name,
        remainingJornadas: remainingJ,
        remainingDays: Math.max(0, Math.ceil(remainingJ / JORNADAS_PER_DAY)),
        remainingHours: remainingJ * HOURS_PER_JORNADA,
      };
    })
    .filter(Boolean);

  if (unassigned.length) {
    const preview = unassigned
      .slice(0, 10)
      .map(x => `${x.center} (${x.remainingJornadas}j)`)
      .join(', ');
    warnings.push(`Centros pendientes: ${preview}${unassigned.length > 10 ? '…' : ''}`);
  }

  // 9) Ordena assignments por día (para render/summary)
  for (const t of teachers) {
    t.assignments.sort((a, b) => dayIndexOf(a.dayKey) - dayIndexOf(b.dayKey));
  }

  return {
    meta: {
      requiredDays,
      requiredJornadas,
      totalCapacityDays,
      totalCapacityJornadas,
      overflowDays,
      overflowJornadas,
      hasOverflow,
      teachersCount,
      weekLabel,
      mode: 'single_week',
    },
    week,
    teachers: teachers.map(t => ({
      id: t.id,
      label: t.label,
      assignments: t.assignments.slice(),
    })),
    warnings,
    unassigned,
  };
}

/**
 * Render helper — 1 semana (SOLO 1 tabla: docentes x días)
 */
export function renderEstimatedSchedule(schedule, tableEl, rosterEl, warnEl) {
  if (!tableEl) return;

  const week = schedule?.week;
  const teachers = Array.isArray(schedule?.teachers) ? schedule.teachers : [];
  const days = Array.isArray(week?.days) ? week.days : [];
  const weekLabel = schedule?.meta?.weekLabel || week?.label || 'Semana (referencial)';

  // Warnings
  if (warnEl) {
    const w = Array.isArray(schedule?.warnings) ? schedule.warnings : [];
    const u = Array.isArray(schedule?.unassigned) ? schedule.unassigned : [];

    let html = '';

    if (w.length) {
      html += `
        <div class="hint">
          <strong>Atención:</strong>
          <ul style="margin:8px 0 0; padding-left:18px;">
            ${w.map(x => `<li>${escapeHtml(x)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    if (u.length) {
      html += `
        <div class="hint" style="margin-top:10px;">
          <strong>Pendientes:</strong>
          <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:8px;">
            ${u.map(x => `
              <span class="sched-pill">
                <span class="sched-pill-strong">${escapeHtml(x.center)}</span>
                <span class="sched-pill-dot">·</span>
                <span>${escapeHtml(String(x.remainingJornadas))} j</span>
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }

    warnEl.innerHTML = html;
  }

  // Estados vacíos
  if (!week || !days.length) {
    tableEl.innerHTML = `<div class="hint">Ajusta horas por centro para ver una propuesta.</div>`;
    if (rosterEl) rosterEl.innerHTML = '';
    return;
  }

  if (!teachers.length) {
    tableEl.innerHTML = `<div class="hint">No hay docentes asignados todavía.</div>`;
    if (rosterEl) rosterEl.innerHTML = '';
    return;
  }

  // dayKey -> teacherId -> {center, jornadas}
  const dayTeacher = buildDayTeacherLookup(week);

  // Tabla principal (docentes x días)
  tableEl.innerHTML = `
    <div class="week-block">
      <div class="week-title">${escapeHtml(weekLabel)} · Distribución por docente</div>

      <div class="sched-scroll" role="region" aria-label="Distribución por docente" tabindex="0">
        <table class="sched sched-teachers" role="table" aria-label="Distribución por docente">
          <thead>
            <tr>
              <th scope="col">Docente</th>
              ${days.map(d => `<th scope="col">${escapeHtml(d.label)}</th>`).join('')}
            </tr>
          </thead>

          <tbody>
            ${teachers.map(t => `
              <tr>
                <th scope="row">${escapeHtml(t.label)}</th>
                ${days.map(d => {
                  const tMap = dayTeacher.get(d.key) || new Map();
                  const info = tMap.get(t.id); // {center, jornadas} o string legacy
                  const center = typeof info === 'string' ? info : info?.center;
                  const jornadas = typeof info === 'string' ? 2 : (info?.jornadas ?? 2);

                  return `
                    <td>
                      ${center
                        ? `<span class="sched-pill">
                             <span class="sched-pill-strong">${escapeHtml(center)}</span>
                             ${jornadas !== 2 ? `<span class="sched-pill-dot">·</span><span>${escapeHtml(String(jornadas))}j</span>` : ``}
                           </span>`
                        : `<span class="sched-empty">—</span>`
                      }
                    </td>
                  `;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Resumen por docente
  if (rosterEl) {
    const summary = buildTeacherSummary(teachers);

    rosterEl.innerHTML = summary.length
      ? `
        <div class="roster-list">
          ${summary.map(s => `
            <div class="roster-item">
              <div class="roster-top">
                <strong>${escapeHtml(s.label)}</strong>
                <span class="roster-meta">${escapeHtml(String(s.jornadas))} jornada(s)</span>
              </div>
              <div class="roster-centers">
                ${s.centers.length
                  ? s.centers.map(c => `
                      <span class="sched-pill">
                        <span class="sched-pill-strong">${escapeHtml(c.name)}</span>
                        <span class="sched-pill-dot">·</span>
                        <span>${escapeHtml(String(c.jornadas))} j</span>
                      </span>
                    `).join('')
                  : `<span class="sched-empty">—</span>`
                }
              </div>
            </div>
          `).join('')}
        </div>
      `
      : `<div class="hint">Sin datos para resumen.</div>`;
  }
}

/* =========================
   Assignment helpers
========================= */

/**
 * ✅ Fuente de verdad: day.byTeacher[teacherId] = { center, jornadas }
 * (Compat: si alguien guardó strings antes, igual lo leemos.)
 */
function assignDayInWeek(week, teacher, dayKey, centerName, jornadas = 2) {
  if (!week || !teacher || !dayKey || !centerName) return false;

  const d = (week.days || []).find(x => x.key === dayKey);
  if (!d) return false;

  if (!d.byTeacher) d.byTeacher = Object.create(null);
  d.byTeacher[teacher.id] = { center: centerName, jornadas: clampJornadas(jornadas) };

  teacher.assignments.push({
    dayKey,
    dayLabel: d.label,
    center: centerName,
    jornadas: clampJornadas(jornadas),
  });

  return true;
}

/**
 * Asigna un día específico (si el docente tiene ese día libre).
 * Ojo: también “bloquea” el día visualmente aunque jornadas=1.
 */
function assignSpecificDay(week, teacher, dayKey, centerName, jornadas) {
  if (!teacher) return false;
  if (!teacher.freeDays.includes(dayKey)) return false;

  const ok = assignDayInWeek(week, teacher, dayKey, centerName, jornadas);
  if (!ok) return false;

  removeFreeDay(teacher, dayKey);
  teacher.loadDays++;
  return true;
}

/* =========================
   Teacher picking (Sticky center)
========================= */

function pickTeacherForSpecificDays(teachers, dayKeys) {
  const keys = (dayKeys || []).filter(Boolean);
  if (!keys.length) return null;

  // Preferimos quien tenga TODOS los días disponibles.
  const candidatesAll = teachers
    .filter(t => keys.every(k => t.freeDays.includes(k)))
    .sort((a, b) => a.loadDays - b.loadDays || a.id.localeCompare(b.id));

  if (candidatesAll.length) return candidatesAll[0];

  // Fallback: quien tenga más días disponibles del plan
  const candidatesSome = teachers
    .map(t => ({ t, score: keys.reduce((acc, k) => acc + (t.freeDays.includes(k) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.loadDays - b.t.loadDays || a.t.id.localeCompare(b.t.id));

  return candidatesSome[0]?.t || null;
}

/**
 * Escoge el docente con mejor racha consecutiva de días libres.
 * Devuelve { teacher, runDays } donde runDays es un array de dayKeys consecutivos.
 */
function pickTeacherBestConsecutiveRun(teachers) {
  let best = null;

  for (const t of teachers) {
    const run = bestConsecutiveRunDays(t.freeDays);
    if (!run.length) continue;

    if (!best) {
      best = { teacher: t, runDays: run };
      continue;
    }

    // Preferimos mayor racha; si empatan, menor carga; si empatan, orden alfabético.
    if (run.length > best.runDays.length) {
      best = { teacher: t, runDays: run };
      continue;
    }

    if (run.length === best.runDays.length) {
      if (t.loadDays < best.teacher.loadDays) {
        best = { teacher: t, runDays: run };
      } else if (t.loadDays === best.teacher.loadDays && t.id.localeCompare(best.teacher.id) < 0) {
        best = { teacher: t, runDays: run };
      }
    }
  }

  return best;
}

/**
 * Calcula la mejor racha consecutiva de un set de dayKeys (en orden semana).
 * Retorna los dayKeys de la racha (ej: ['mon','tue','wed']).
 */
function bestConsecutiveRunDays(freeDays) {
  const set = new Set(freeDays || []);
  if (!set.size) return [];

  let best = [];
  let cur = [];

  for (let i = 0; i < WEEK_DAYS.length; i++) {
    const k = WEEK_DAYS[i].key;
    if (set.has(k)) {
      cur.push(k);
      if (cur.length > best.length) best = cur.slice();
    } else {
      cur = [];
    }
  }

  return best;
}

function removeFreeDay(teacher, dayKey) {
  const i = teacher.freeDays.indexOf(dayKey);
  if (i >= 0) teacher.freeDays.splice(i, 1);
}

/* =========================
   Builders
========================= */

function makeEmptyWeek(label) {
  return {
    label,
    days: makeEmptyWeekDays(),
  };
}

function makeEmptyWeekDays() {
  return WEEK_DAYS.map(d => ({
    key: d.key,
    label: d.label,

    // Fuente de verdad para tabla (Docente×Día)
    byTeacher: Object.create(null),

    // Bloques quedan como referencia (no se usan para pintar tabla)
    blocks: d.blocks.map(b => ({
      key: b.key,
      label: b.label,
    })),
  }));
}

/* =========================
   Lookup helpers
========================= */

function buildDayTeacherLookup(week) {
  // dayKey -> (teacherId -> {center, jornadas})
  const lookup = new Map();

  for (const d of week?.days || []) {
    const tMap = new Map();

    const bt = d?.byTeacher || {};
    for (const [teacherId, v] of Object.entries(bt)) {
      if (!teacherId) continue;

      if (typeof v === 'string') {
        // legacy compat
        tMap.set(teacherId, { center: v, jornadas: 2 });
      } else if (v && v.center) {
        tMap.set(teacherId, { center: v.center, jornadas: clampJornadas(v.jornadas) });
      }
    }

    lookup.set(d.key, tMap);
  }

  return lookup;
}

function buildTeacherSummary(teachers) {
  const out = (teachers || []).map(t => {
    const centerCounts = new Map();

    for (const a of t.assignments || []) {
      if (!a?.center) continue;
      const j = clampJornadas(a.jornadas ?? 2);
      centerCounts.set(a.center, (centerCounts.get(a.center) || 0) + j);
    }

    const centers = Array.from(centerCounts.entries())
      .map(([name, jornadas]) => ({ name, jornadas }))
      .sort((a, b) => b.jornadas - a.jornadas || a.name.localeCompare(b.name));

    const jornadas = (t.assignments || []).reduce((acc, a) => acc + clampJornadas(a?.jornadas ?? 2), 0);
    const days = (t.assignments || []).length;

    return {
      id: t.id,
      label: t.label,
      days,
      jornadas,
      centers,
    };
  });

  out.sort((a, b) => b.jornadas - a.jornadas || a.label.localeCompare(b.label));
  return out;
}

/* =========================
   Tiny utils
========================= */

function normalizeName(name) {
  return String(name ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

function dayIndexOf(dayKey) {
  return WEEK_DAYS.findIndex(d => d.key === dayKey);
}

function nextTeacherId(idx) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (idx < letters.length) return letters[idx];
  const a = Math.floor(idx / letters.length) - 1;
  const b = idx % letters.length;
  return letters[a] + letters[b];
}

function clampJornadas(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 2;
  return Math.max(1, Math.min(2, Math.round(v)));
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
