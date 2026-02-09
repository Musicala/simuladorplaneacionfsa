'use strict';

/* ============================================================================
   storage.js — Escenarios Simulador FSA

   Mejoras:
   ✅ Presets iniciales (solo primera carga)
   ✅ No reaparecen si usuario borra todo
   ✅ Backwards compatible total
   ✅ Sin cambiar API existente
============================================================================ */

const KEY = 'fsa_sim_2026_scenarios_v1';

/* ============================================================================
   PRESETS INICIALES
   👉 Solo aparecen si NO existe nada guardado en localStorage
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

    // 🧠 PRIMERA VEZ → devolver presets
    if(raw === null){
      return structuredCloneSafe(DEFAULT_SCENARIOS);
    }

    const arr = JSON.parse(raw);

    return Array.isArray(arr) ? arr : [];

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
  // ⚠️ Guardamos array vacío para evitar que vuelvan presets
  saveScenarios([]);
}

export function uid(prefix='scn'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

/* ============================================================================
   Utils
============================================================================ */

function structuredCloneSafe(obj){
  try{
    return structuredClone(obj);
  }catch{
    return JSON.parse(JSON.stringify(obj));
  }
}
