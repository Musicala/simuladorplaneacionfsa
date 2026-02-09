'use strict';

const KEY = 'fsa_sim_2026_scenarios_v1';

export function loadScenarios(){
  try{
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
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
  saveScenarios([]);
}

export function uid(prefix='scn'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}
