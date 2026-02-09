'use strict';

/* ============================================================================
   storage.js — Escenarios Simulador FSA

   Mejoras:
   ✅ Presets iniciales (solo primera carga real)
   ✅ Presets vienen completos: createdAt + summary (para que el modal muestre valores)
   ✅ Migración silenciosa: escenarios viejos sin createdAt/summary se enriquecen
   ✅ No reaparecen presets si usuario borra todo (queda [] guardado)
   ✅ Backwards compatible total
============================================================================ */

import { computeScenario } from './calculator.js';

const KEY = 'fsa_sim_2026_scenarios_v1';

/* ============================================================================
   PRESETS INICIALES
   👉 Solo aparecen si NO existe nada guardado (localStorage.getItem(KEY) === null)
============================================================================ */

const DEFAULT_SCENARIOS = [
  {
    id: 'preset_basico',
    name: 'Preset Básico (Referencia)',
    centers: [
      { name:'ARROYO', hours:4 },
      { name:'BETANIA', hours:4 },
      { name:'JERUSALEN', hours:4 },
      { name:'LUCERO', hours:4 },
      { name:'SANTO_DOMINGO', hours:4 },
      { name:'PM_A', hours:4 },
      { name:'PM_B', hours:4 },
      { name:'GMMMC', hours:4 },
      { name:'ACAPULCO', hours:4 },
      { name:'SAN_JUAN', hours:4 }
    ]
  },
  {
    id: 'preset_medio',
    name: 'Preset Medio (Balanceado)',
    centers: [
      { name:'ARROYO', hours:8 },
      { name:'BETANIA', hours:8 },
      { name:'JERUSALEN', hours:8 },
      { name:'LUCERO', hours:8 },
      { name:'SANTO_DOMINGO', hours:8 },
      { name:'PM_A', hours:8 },
      { name:'PM_B', hours:8 },
      { name:'GMMMC', hours:8 },
      { name:'ACAPULCO', hours:8 },
      { name:'SAN_JUAN', hours:8 }
    ]
  },
  {
    id: 'preset_alto',
    name: 'Preset Alto (Operación Amplia)',
    centers: [
      { name:'ARROYO', hours:16 },
      { name:'BETANIA', hours:12 },
      { name:'JERUSALEN', hours:20 },
      { name:'LUCERO', hours:20 },
      { name:'SANTO_DOMINGO', hours:20 },
      { name:'PM_A', hours:4 },
      { name:'PM_B', hours:12 },
      { name:'GMMMC', hours:8 },
      { name:'ACAPULCO', hours:4 },
      { name:'SAN_JUAN', hours:4 }
    ]
  }
];

/* ============================================================================
   CORE STORAGE
============================================================================ */

export function loadScenarios(){
  try{
    const raw = localStorage.getItem(KEY);

    // 🧠 Primera vez real (no existe la key) → seed + guardar
    if (raw === null){
      const seeded = seedDefaultsOnce();
      saveScenarios(seeded);
      return seeded;
    }

    const arr = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(arr) ? arr : [];

    // ✅ Migración silenciosa: completa campos faltantes para que el modal muestre valores
    const migrated = migrateIfNeeded(list);
    if (migrated.changed){
      saveScenarios(migrated.list);
      return migrated.list;
    }

    return list;
  }catch{
    return [];
  }
}

export function saveScenarios(list){
  localStorage.setItem(KEY, JSON.stringify(list || []));
}

export function addScenario(scn){
  const list = loadScenarios();
  list.unshift(scn);
  saveScenarios(list);
  return list;
}

export function removeScenario(id){
  const list = loadScenarios().filter(s => s.id !== id);
  saveScenarios(list);
  return list;
}

export function clearAll(){
  // ⚠️ Guardamos [] para que NO vuelvan presets (raw ya no será null)
  saveScenarios([]);
}

export function uid(prefix='scn'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

/* ============================================================================
   Seed + Migrate helpers
============================================================================ */

function seedDefaultsOnce(){
  const nowISO = new Date().toISOString();

  // Presets “completos” (para que renderScenarios en app.js no muestre ceros)
  return DEFAULT_SCENARIOS.map((p, idx) => {
    const centers = normalizeCenters(p.centers || []);
    const summary = computeSummarySafe(centers);

    return {
      id: p.id || `preset_${idx+1}`,
      name: String(p.name || `Preset ${idx+1}`),
      createdAt: nowISO,
      centers: structuredCloneSafe(centers),
      summary
    };
  });
}

function migrateIfNeeded(list){
  let changed = false;

  const out = (list || [])
    .filter(Boolean)
    .map((s) => {
      // si no es objeto, bótalo
      if (typeof s !== 'object') { changed = true; return null; }

      // Asegura shape mínima
      const id = String(s.id || '');
      const name = String(s.name || '');
      const centers = normalizeCenters(Array.isArray(s.centers) ? s.centers : []);

      if (!id || !name){
        // si viene mal formado, lo dejamos igual pero marcamos cambio (para limpieza)
        // y evitamos reventar UI
        changed = true;
      }

      // createdAt
      let createdAt = s.createdAt;
      if (!createdAt){
        createdAt = new Date().toISOString();
        changed = true;
      }

      // summary (lo que el modal usa para mostrar valores) :contentReference[oaicite:2]{index=2}
      let summary = s.summary;
      if (!summary || typeof summary !== 'object'){
        summary = computeSummarySafe(centers);
        changed = true;
      } else {
        // completa campos faltantes sin destruir los existentes
        const base = computeSummarySafe(centers);
        const merged = {
          weeklyClassHours: summary.weeklyClassHours ?? base.weeklyClassHours,
          weeklyContractHours: summary.weeklyContractHours ?? base.weeklyContractHours,
          jornadasWeek: summary.jornadasWeek ?? base.jornadasWeek,
          teachers: summary.teachers ?? base.teachers,
          priceMonthly: summary.priceMonthly ?? base.priceMonthly,
          totalPeriod: summary.totalPeriod ?? base.totalPeriod,
        };
        // si faltaba algo, marcamos cambio
        if (
          merged.weeklyClassHours !== summary.weeklyClassHours ||
          merged.weeklyContractHours !== summary.weeklyContractHours ||
          merged.jornadasWeek !== summary.jornadasWeek ||
          merged.teachers !== summary.teachers ||
          merged.priceMonthly !== summary.priceMonthly ||
          merged.totalPeriod !== summary.totalPeriod
        ){
          summary = merged;
          changed = true;
        }
      }

      // si centers estaban raros, los normalizamos
      // (sin esto, computeScenario puede portarse raro)
      if (centersChanged(s.centers, centers)) changed = true;

      return {
        ...s,
        id: s.id ?? id,
        name: s.name ?? name,
        createdAt,
        centers: structuredCloneSafe(centers),
        summary,
      };
    })
    .filter(Boolean);

  return { list: out, changed };
}

/* ============================================================================
   Summary / centers utilities
============================================================================ */

function computeSummarySafe(centers){
  try{
    const res = computeScenario(centers);
    return {
      weeklyClassHours: res?.weeklyClassHours ?? sumHours(centers),
      weeklyContractHours: res?.weeklyContractHours ?? 0,
      jornadasWeek: res?.jornadasWeek ?? approxJornadas(sumHours(centers)),
      teachers: res?.teachers ?? 0,
      priceMonthly: res?.priceMonthly ?? 0,
      totalPeriod: res?.totalPeriod ?? 0,
    };
  }catch{
    const h = sumHours(centers);
    return {
      weeklyClassHours: h,
      weeklyContractHours: 0,
      jornadasWeek: approxJornadas(h),
      teachers: 0,
      priceMonthly: 0,
      totalPeriod: 0,
    };
  }
}

function normalizeCenters(centers){
  return (centers || [])
    .map(c => ({
      name: String(c?.name || '').trim(),
      hours: Math.max(0, Number(c?.hours || 0))
    }))
    .filter(c => c.name);
}

function sumHours(centers){
  return (centers || []).reduce((acc, c) => acc + (Number(c?.hours) || 0), 0);
}

// Tu UI habla de “jornadas” como 4h visibles (bloques de 4) :contentReference[oaicite:3]{index=3}
function approxJornadas(weeklyHours){
  return Math.round((Number(weeklyHours || 0) / 4) * 100) / 100;
}

function centersChanged(oldCenters, newCenters){
  try{
    if (!Array.isArray(oldCenters)) return true;
    if (oldCenters.length !== newCenters.length) return true;
    for (let i = 0; i < oldCenters.length; i++){
      const a = oldCenters[i], b = newCenters[i];
      if (String(a?.name || '') !== String(b?.name || '')) return true;
      if (Number(a?.hours || 0) !== Number(b?.hours || 0)) return true;
    }
    return false;
  }catch{
    return true;
  }
}

function structuredCloneSafe(obj){
  try{
    return structuredClone(obj);
  }catch{
    return JSON.parse(JSON.stringify(obj));
  }
}
