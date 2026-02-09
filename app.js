'use strict';

import { computeScenario, moneyCOP } from './calculator.js';
import { loadScenarios, addScenario, removeScenario, clearAll, uid } from './storage.js';
// ✅ Horario estimado (vista referencial, 1 semana)
import { buildEstimatedSchedule, renderEstimatedSchedule } from './schedule.js';

/* ============================================================================
   app.js — FSA · Simulador 2026 (Mar–Nov)

   Mejoras reales (y sin romper lo que ya sirve):
   ✅ computeScenario() UNA sola vez por update (consistencia)
   ✅ DEBUG por URL: ?debug=1
   ✅ update() micro-debounce (requestAnimationFrame)
   ✅ KPI nuevo: Horas reales docentes (contrato) #kpiContractHours
   ✅ scheduleView id mismatch tolerante (#scheduleView vs #viewSchedule)
   ✅ Errores visibles en schedule (hint)
   ✅ schedule no colapsa (minHeight)
   ✅ Delegación de eventos sólida + normalización
   ✅ VIEW STATE limpio: document.body.dataset.view = 'quote'|'schedule'
      (para CSS: body[data-view="schedule"] #summaryCard{display:none})

   ✅ ADMIN PRO (nuevo):
   ✅ Usa res._steps (si existe) para mostrar:
      - % y montos (error, margen, retención)
      - subtotales paso a paso
      - desglose estimado por docentes (contratos + sueltas)
============================================================================ */

/* ========================= DEBUG ========================= */
const DEBUG = (() => {
  try {
    const p = new URLSearchParams(location.search);
    const v = (p.get('debug') || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  } catch {
    return false;
  }
})();
function dlog(...a){ if (DEBUG) console.log(...a); }
function dwarn(...a){ if (DEBUG) console.warn(...a); }

/* ========================= Config ========================= */
const DEFAULT_CENTER_NAMES = [
  'ARROYO','BETANIA','JERUSALEN','LUCERO','SANTO_DOMINGO','PM_A','PM_B','GMMMC','ACAPULCO','SAN_JUAN'
];
const HOURS_STEP = 4;
const LS_VIEW_KEY = 'fsa_sim_view_v1';

/* ========================= State ========================= */
let centers = DEFAULT_CENTER_NAMES.map(name => ({ name, hours: 0 }));
let currentView = 'quote';
let lastComputed = null;

/* ========================= Helpers ========================= */
function qs(sel, root = document){ return root.querySelector(sel); }
function qsa(sel, root = document){ return Array.from(root.querySelectorAll(sel)); }
function escapeHtml(str){
  return String(str ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'", '&#039;');
}
function normalizeName(name){
  const n = String(name ?? '').trim();
  if (!n) return '';
  return n.toUpperCase().replace(/\s+/g, '_');
}
function clampHours(n){
  const v = Math.max(0, Number(n || 0));
  return Math.round(v / HOURS_STEP) * HOURS_STEP;
}
function fmt(n){
  return new Intl.NumberFormat('es-CO').format(Math.round(Number(n || 0)));
}
function pctFmt01(p01){
  const v = Number(p01 || 0) * 100;
  // sin decimales para que no se vea como un Excel triste
  return `${Math.round(v)}%`;
}
function pctFmt100(p100){
  const v = Number(p100 || 0);
  return `${Math.round(v)}%`;
}
function getTotalWeeklyHours(list = centers){
  return (list || []).reduce((acc, c) => acc + (Number(c?.hours) || 0), 0);
}
function safeClone(obj){
  try { return structuredClone(obj); }
  catch { return JSON.parse(JSON.stringify(obj)); }
}
function hasViews(){ return qsa('[data-view]').length > 0; }
function safeLSGet(key, fallback=null){
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}
function safeLSSet(key, val){
  try { localStorage.setItem(key, val); }
  catch {}
}

/* ========================= DOM refs ========================= */
const el = {
  centersList: qs('#centersList'),

  // KPIs (existentes)
  kpiHours: qs('#kpiHours'),
  kpiJornadas: qs('#kpiJornadas'),
  kpiTeachers: qs('#kpiTeachers'),
  kpiMonthly: qs('#kpiMonthly'),
  kpiTotal: qs('#kpiTotal'),

  // ✅ NUEVO KPI
  kpiContractHours: qs('#kpiContractHours'),

  btnAddCenter: qs('#btnAddCenter'),
  btnSaveScenario: qs('#btnSaveScenario'),
  btnScenarios: qs('#btnScenarios'),
  btnPrint: qs('#btnPrint'),

  dlg: qs('#dlgScenarios'),
  btnCloseDlg: qs('#btnCloseDlg'),
  scenarioName: qs('#scenarioName'),
  btnConfirmSave: qs('#btnConfirmSave'),
  scenariosList: qs('#scenariosList'),
  btnClearAll: qs('#btnClearAll'),

  emptyState: qs('#emptyState'),

  // Views nav
  btnViewQuote: qs('#btnViewQuote'),
  btnViewSchedule: qs('#btnViewSchedule'),

  // Schedule view (tolerante a IDs)
  scheduleView: qs('#scheduleView') || qs('#viewSchedule'),
  scheduleTable: qs('#scheduleTable'),
  scheduleRoster: qs('#scheduleRoster'),
  scheduleWarnings: qs('#scheduleWarnings'),
};

/* ========================= Empty state (Resumen) ========================= */
function setEmptySummaryState(isEmpty){
  const emptyText = '—';
  if (el.emptyState) el.emptyState.style.display = isEmpty ? 'block' : 'none';

  if (isEmpty){
    if (el.kpiHours) el.kpiHours.textContent = emptyText;
    if (el.kpiContractHours) el.kpiContractHours.textContent = emptyText;
    if (el.kpiJornadas) el.kpiJornadas.textContent = emptyText;
    if (el.kpiTeachers) el.kpiTeachers.textContent = emptyText;
    if (el.kpiMonthly) el.kpiMonthly.textContent = emptyText;
    if (el.kpiTotal) el.kpiTotal.textContent = emptyText;
  }
}

/* ========================= Schedule: hint/error helpers ========================= */
function ensureScheduleHint(){
  if (!el.scheduleView) return null;
  let hint = el.scheduleView.querySelector('#scheduleHint');
  if (hint) return hint;

  hint = document.createElement('div');
  hint.id = 'scheduleHint';
  hint.className = 'hint';
  hint.style.display = 'none';
  hint.setAttribute('role', 'alert');

  const head = el.scheduleView.querySelector('.card-head');
  if (head && head.parentElement){
    head.parentElement.insertBefore(hint, head.nextElementSibling);
  } else {
    el.scheduleView.insertBefore(hint, el.scheduleView.firstChild);
  }
  return hint;
}
function showScheduleHint(html){
  const hint = ensureScheduleHint();
  if (!hint) return;
  hint.style.display = 'block';
  hint.innerHTML = html;
}
function clearScheduleHint(){
  const hint = el.scheduleView?.querySelector('#scheduleHint');
  if (!hint) return;
  hint.style.display = 'none';
  hint.textContent = '';
}

/* ========================= Views (Cotizador / Horario) ========================= */
function setAriaCurrent(btn, on){
  if (!btn) return;
  if (on) btn.setAttribute('aria-current', 'page');
  else btn.removeAttribute('aria-current');
}
function setView(viewKey){
  currentView = viewKey;

  // ✅ Estado visual limpio (para CSS)
  try { document.body.dataset.view = viewKey; } catch {}

  const viewNodes = qsa('[data-view]');
  if (viewNodes.length){
    for (const node of viewNodes){
      node.hidden = node.dataset.view !== viewKey;
    }
  }

  setAriaCurrent(el.btnViewQuote, viewKey === 'quote');
  setAriaCurrent(el.btnViewSchedule, viewKey === 'schedule');
  safeLSSet(LS_VIEW_KEY, viewKey);

  // Render schedule cuando entras
  if (viewKey === 'schedule') renderSchedule(lastComputed);
}
function initViewNav(){
  if (el.btnViewQuote){
    el.btnViewQuote.addEventListener('click', () => setView('quote'));
  }
  if (el.btnViewSchedule){
    el.btnViewSchedule.addEventListener('click', () => setView('schedule'));
  }

  let saved = safeLSGet(LS_VIEW_KEY, 'quote') || 'quote';
  if (saved !== 'schedule' && saved !== 'quote') saved = 'quote';
  if (saved === 'schedule' && !(qs('#scheduleView') || qs('#viewSchedule'))) saved = 'quote';

  setView(saved);
}

/* ========================= Render ========================= */
function renderCenters(){
  if (!el.centersList) return;

  el.centersList.innerHTML = centers.map((c, idx) => {
    const h = clampHours(c.hours);
    const jornadas = h / 4;

    return `
      <article class="center" data-idx="${idx}">
        <div class="center-row">
          <div>
            <h3>${escapeHtml(c.name)}</h3>
            <div class="meta">${jornadas} jornada(s) · ${h}h/semana</div>
          </div>

          <div class="center-actions">
            <div class="stepper" role="group" aria-label="Horas por semana">
              <button class="icon-btn" data-act="dec" type="button" aria-label="Disminuir">−</button>
              <div class="val"><span>${h}</span>h</div>
              <button class="icon-btn" data-act="inc" type="button" aria-label="Aumentar">+</button>
            </div>

            <button class="icon-btn" data-act="del" type="button" aria-label="Eliminar centro">🗑</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

/* ========================= ADMIN helpers (pretty) ========================= */
function adminLine(label, valueHtml, hintHtml=''){
  return `
    <div class="admin__kv">
      <div class="admin__k">
        ${escapeHtml(label)}
        ${hintHtml ? `<div class="admin__hint">${hintHtml}</div>` : ``}
      </div>
      <div class="admin__v">${valueHtml}</div>
    </div>
  `;
}
function adminMoney(n){ return escapeHtml(moneyCOP(Number(n || 0))); }
function adminNum(n){ return escapeHtml(fmt(Number(n || 0))); }
function adminPct01(p01){ return escapeHtml(pctFmt01(Number(p01 || 0))); }
function adminPct100(p100){ return escapeHtml(pctFmt100(Number(p100 || 0))); }

function renderAdminPretty(res){
  const pretty = document.getElementById('adminPretty');
  if (!pretty) return;

  const internal = res?._internal || {};
  const steps = res?._steps || null;

  // Fallbacks cuando no existe _steps (por si alguien no actualiza calculator.js)
  const payrollPct01 = (steps?.fixedPayroll?.pctApplied ?? internal.payrollPct ?? 0);
  const retentionPct01 = (steps?.retention?.pct ?? internal.retentionPct ?? 0);
  const errorPct01 = (steps?.error?.pct ?? internal.errorPct ?? 0.01);
  const marginPct01 = (steps?.margin?.pct ?? internal.marginPct ?? internal.finalMargin ?? 0.06);

  const fixedPayroll = (steps?.fixedPayroll?.amount ?? internal.fixedPayroll ?? 0);
  const extraFixedMonthly = (steps?.internal?.extraFixedMonthly ?? internal.extraFixedMonthly ?? 0);
  const supervisionMonthlyAvg = (steps?.supervision?.monthlyAvg ?? internal.supervisionMonthlyAvg ?? 0);
  const internalMonthly = (steps?.internal?.internalMonthly ?? internal.internalMonthly ?? 0);

  const errorAmount = (steps?.error?.amount ?? internal.errorAmount ?? (Number(internalMonthly||0) * Number(errorPct01||0)));
  const withError = (steps?.error?.totalWithError ?? internal.withError ?? 0);

  const priceMonthlyRaw = (steps?.margin?.priceMonthlyRaw ?? internal.priceMonthlyRaw ?? 0);
  const marginAmount = (steps?.margin?.amount ?? internal.marginAmount ?? (Number(priceMonthlyRaw||0) - Number(withError||0)));

  const priceMonthlyAfterRetentionRaw = (steps?.retention?.priceMonthlyAfterRetentionRaw ?? internal.priceMonthlyAfterRetentionRaw ?? 0);
  const retentionAmountRaw = (steps?.retention?.amountRaw ?? internal.retentionAmountRaw ?? (Number(priceMonthlyAfterRetentionRaw||0) - Number(priceMonthlyRaw||0)));

  const netMonthlyAfterRetentionApprox = (steps?.retention?.netMonthlyAfterRetentionApprox ?? internal.netMonthlyAfterRetentionApprox ?? 0);

  const a = [];

  // 1) Totales operativos
  a.push(`
    <div class="admin__card">
      <h4>Totales</h4>
      ${adminLine('Horas clase/semana', adminNum(res.weeklyClassHours))}
      ${adminLine('Horas contrato/semana', adminNum(res.weeklyContractHours), `<span class="muted">Factor aplicado</span>`)}
      ${adminLine('Jornadas/semana', adminNum(res.jornadasWeek), `<span class="muted">1 jornada visible = 4h clase</span>`)}
      ${adminLine('Docentes estimados', adminNum(res.teachers))}
    </div>
  `);

  // 2) Facturación (lo que ve el cliente)
  a.push(`
    <div class="admin__card">
      <h4>Facturación</h4>
      ${adminLine('Mensual (cliente)', adminMoney(res.priceMonthly))}
      ${adminLine('Total periodo', adminMoney(res.totalPeriod))}
      ${adminLine('Retención %', adminPct01(retentionPct01))}
      ${adminLine('Mensual neto aprox', adminMoney(netMonthlyAfterRetentionApprox), `<span class="muted">Desde el valor facturado redondeado</span>`)}
    </div>
  `);

  // 3) Desglose docentes (estimado)
  const t = steps?.teachers || null;
  if (t){
    const rows = [];
    const bd = Array.isArray(t.breakdown) ? t.breakdown : [];
    if (bd.length){
      for (const b of bd){
        // contratos tienen contractHours>0, sueltas contractHours=0
        const label = b.contractHours > 0
          ? `${b.count} × ${b.contractHours}h/sem`
          : `${escapeHtml(b.label || 'Horas sueltas')}`;

        const hint = b.contractHours > 0
          ? `<span class="muted">${escapeHtml(moneyCOP(b.monthlyEach))} c/u</span>`
          : `<span class="muted">${escapeHtml(moneyCOP(b.monthlyEach))} por hora</span>`;

        rows.push(adminLine(label, adminMoney(b.total), hint));
      }
    } else {
      rows.push(`<div class="hint">No hay breakdown detallado (actualiza calculator.js).</div>`);
    }

    // Mini roster (Docente 1..N)
    let rosterHtml = '';
    const list = Array.isArray(t.teachersList) ? t.teachersList : [];
    if (list.length){
      rosterHtml = `
        <div class="admin__mini">
          <div class="admin__miniTitle">Docente por docente (estimado)</div>
          <div class="admin__miniGrid">
            ${list.map(x => {
              const kind = x.type === 'loose'
                ? `Suelta (${Math.round(Number(x.contractHours||0))}h/sem)`
                : `Contrato ${Math.round(Number(x.contractHours||0))}h/sem`;
              return `
                <div class="admin__pill">
                  <div class="admin__pillK">${escapeHtml(x.label)}</div>
                  <div class="admin__pillS muted">${escapeHtml(kind)}</div>
                  <div class="admin__pillV">${escapeHtml(moneyCOP(x.monthly || 0))}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    a.push(`
      <div class="admin__card">
        <h4>Docentes (estimado)</h4>
        ${adminLine('Costo docentes mensual', adminMoney(t.monthlyCost))}
        <div class="admin__subgrid">
          <div class="admin__sub">
            <div class="admin__subTitle">Desglose</div>
            ${rows.join('')}
          </div>
        </div>
        ${rosterHtml}
      </div>
    `);
  } else {
    // fallback mínimo con lo que haya
    const td = res?._teachersDetail || {};
    a.push(`
      <div class="admin__card">
        <h4>Docentes (estimado)</h4>
        ${adminLine('Costo docentes mensual', adminMoney(td.monthlyCost || 0), `<span class="muted">Sin breakdown (actualiza calculator.js)</span>`)}
        ${adminLine('Horas sueltas/semana', adminNum(td.looseHours || 0))}
        ${adminLine('Costo sueltas mensual', adminMoney(td.looseMonthly || 0))}
      </div>
    `);
  }

  // 4) Costos internos
  a.push(`
    <div class="admin__card">
      <h4>Costos internos</h4>
      ${adminLine('Nómina fija (base)', adminMoney(steps?.fixedPayroll?.baseMonthly ?? internal.fixedPayrollBase ?? 0))}
      ${adminLine('Porcentaje imputado', adminPct01(payrollPct01))}
      ${adminLine('Nómina fija imputada', adminMoney(fixedPayroll))}
      ${adminLine('Fijos extra', adminMoney(extraFixedMonthly))}
      ${adminLine('Supervisión prom.', adminMoney(supervisionMonthlyAvg))}
      ${adminLine('Operación mensual (subtotal)', adminMoney(internalMonthly))}
    </div>
  `);

  // 5) Pipeline paso por paso (lo que ustedes quieren: % → monto → subtotal)
  a.push(`
    <div class="admin__card">
      <h4>Paso a paso (pipeline)</h4>

      <div class="admin__step">
        <div class="admin__stepTitle">1) Subtotal interno</div>
        ${adminLine('Subtotal interno mensual', adminMoney(internalMonthly), `<span class="muted">Docentes + nómina fija imputada + extras + supervisión</span>`)}
      </div>

      <div class="admin__step">
        <div class="admin__stepTitle">2) Error / colchón</div>
        ${adminLine(`Error (${pctFmt01(errorPct01)})`, adminMoney(errorAmount), `<span class="muted">${escapeHtml(moneyCOP(internalMonthly))} × ${escapeHtml(pctFmt01(errorPct01))}</span>`)}
        ${adminLine('Subtotal + error', adminMoney(withError))}
      </div>

      <div class="admin__step">
        <div class="admin__stepTitle">3) Margen</div>
        ${adminLine(`Margen objetivo (${pctFmt01(marginPct01)})`, adminMoney(marginAmount), `<span class="muted">Equivalente: precio_raw − (subtotal+error)</span>`)}
        ${adminLine('Precio mensual RAW (sin retención)', adminMoney(priceMonthlyRaw), `<span class="muted">(subtotal+error) ÷ (1 − margen)</span>`)}
      </div>

      <div class="admin__step">
        <div class="admin__stepTitle">4) Retención</div>
        ${adminLine(`Retención (${pctFmt01(retentionPct01)})`, adminMoney(retentionAmountRaw), `<span class="muted">Factura necesaria − precio_raw</span>`)}
        ${adminLine('Factura RAW + retención', adminMoney(priceMonthlyAfterRetentionRaw), `<span class="muted">precio_raw ÷ (1 − retención)</span>`)}
        ${adminLine('Factura mensual (redondeada)', adminMoney(res.priceMonthly), `<span class="muted">Redondeo comercial hacia arriba</span>`)}
        ${adminLine('Neto aprox recibido', adminMoney(netMonthlyAfterRetentionApprox), `<span class="muted">factura_redondeada × (1 − retención)</span>`)}
      </div>
    </div>
  `);

  // 6) Detalle técnico (para comparar con tu UI previa)
  a.push(`
    <div class="admin__card">
      <h4>Detalle técnico</h4>
      ${adminLine('Error %', adminPct01(errorPct01))}
      ${adminLine('Error $', adminMoney(errorAmount))}
      ${adminLine('Subtotal+Error', adminMoney(withError))}
      ${adminLine('Margen %', adminPct01(marginPct01))}
      ${adminLine('Margen $ (equivalente)', adminMoney(marginAmount))}
      ${adminLine('Raw facturación (sin retención)', adminMoney(priceMonthlyRaw))}
      ${adminLine('Retención %', adminPct01(retentionPct01))}
      ${adminLine('Raw + retención', adminMoney(priceMonthlyAfterRetentionRaw))}
    </div>
  `);

  pretty.innerHTML = a.join('');
}

function renderSummary(res){
  const totalWeekly = getTotalWeeklyHours();
  if (totalWeekly <= 0){
    setEmptySummaryState(true);
    return;
  }
  setEmptySummaryState(false);

  if (!res){
    if (el.kpiHours) el.kpiHours.textContent = '—';
    if (el.kpiContractHours) el.kpiContractHours.textContent = '—';
    if (el.kpiJornadas) el.kpiJornadas.textContent = '—';
    if (el.kpiTeachers) el.kpiTeachers.textContent = '—';
    if (el.kpiMonthly) el.kpiMonthly.textContent = '—';
    if (el.kpiTotal) el.kpiTotal.textContent = '—';

    // ⭐ ADMIN DEBUG PANEL (si existe)
    if (DEBUG){
      const panel = document.getElementById('adminPanel');
      const debug = document.getElementById('adminDebug');
      if(panel && debug){
        document.body.classList.add('admin-mode');
        debug.textContent = JSON.stringify({ result: res, centers }, null, 2);
      }
    }
    return;
  }

  if (el.kpiHours) el.kpiHours.textContent = fmt(res.weeklyClassHours);
  if (el.kpiContractHours) el.kpiContractHours.textContent = fmt(res.weeklyContractHours);
  if (el.kpiJornadas) el.kpiJornadas.textContent = fmt(res.jornadasWeek);
  if (el.kpiTeachers) el.kpiTeachers.textContent = fmt(res.teachers);
  if (el.kpiMonthly) el.kpiMonthly.textContent = moneyCOP(res.priceMonthly);
  if (el.kpiTotal) el.kpiTotal.textContent = moneyCOP(res.totalPeriod);

  /* ⭐ ADMIN DEBUG PANEL (NO TOCA NADA EXISTENTE) */
  if (DEBUG){
    const panel = document.getElementById('adminPanel');
    const pretty = document.getElementById('adminPretty');
    const debug = document.getElementById('adminDebug');
    const btnCopy = document.getElementById('btnAdminCopy');
    const btnToggle = document.getElementById('btnAdminToggle');
    const rawWrap = document.getElementById('adminRawWrap');

    if(panel && debug){
      document.body.classList.add('admin-mode');

      // 1) Raw JSON
      const payload = { result: res, centers };
      debug.textContent = JSON.stringify(payload, null, 2);

      // 2) Pretty inspector PRO (usa _steps si existe)
      if (pretty){
        try{
          renderAdminPretty(res);
        }catch(err){
          console.error('[adminPretty] Error renderizando', err);
          pretty.innerHTML = `
            <div class="hint">
              <strong>Error renderizando Admin:</strong> ${escapeHtml(err?.message || String(err))}
            </div>
          `;
        }
      }

      // 3) Copy + toggle (una sola vez)
      if (btnCopy && !btnCopy.dataset.bound){
        btnCopy.dataset.bound = '1';
        btnCopy.addEventListener('click', async () => {
          try{
            await navigator.clipboard.writeText(debug.textContent || '');
            btnCopy.textContent = 'Copiado ✅';
            setTimeout(()=> btnCopy.textContent = 'Copiar JSON', 900);
          }catch{
            btnCopy.textContent = 'No se pudo copiar';
            setTimeout(()=> btnCopy.textContent = 'Copiar JSON', 900);
          }
        });
      }

      if (btnToggle && rawWrap && !btnToggle.dataset.bound){
        btnToggle.dataset.bound = '1';
        btnToggle.addEventListener('click', () => {
          const isHidden = rawWrap.classList.contains('hidden');
          rawWrap.classList.toggle('hidden', !isHidden);
          btnToggle.setAttribute('aria-expanded', String(isHidden));
          btnToggle.textContent = isHidden ? 'Ocultar JSON crudo' : 'Ver JSON crudo';
        });
      }
    }
  }
}

/* ========================= Schedule view ========================= */
function resolveScheduleEls(){
  el.scheduleView = el.scheduleView || qs('#scheduleView') || qs('#viewSchedule');
  el.scheduleTable = el.scheduleTable || qs('#scheduleTable');
  el.scheduleRoster = el.scheduleRoster || qs('#scheduleRoster');
  el.scheduleWarnings = el.scheduleWarnings || qs('#scheduleWarnings');
}

function renderSchedule(res){
  // Si hay sistema de views, solo pinta cuando estás en schedule
  if (hasViews() && currentView !== 'schedule') return;

  resolveScheduleEls();

  dlog('[schedule] renderSchedule', {
    currentView,
    scheduleView: !!el.scheduleView,
    scheduleTable: !!el.scheduleTable,
    scheduleWarnings: !!el.scheduleWarnings,
    scheduleRoster: !!el.scheduleRoster,
  });

  if (!el.scheduleView){
    dwarn('[schedule] No existe scheduleView (#scheduleView o #viewSchedule).');
    return;
  }

  // Evita colapso del layout por grids raros
  try { el.scheduleView.style.minHeight = '240px'; } catch {}

  if (!el.scheduleTable){
    showScheduleHint(`<strong>Error:</strong> No encuentro <code>#scheduleTable</code> en el HTML.`);
    return;
  }

  clearScheduleHint();

  const totalWeekly = getTotalWeeklyHours();
  if (totalWeekly <= 0){
    if (el.scheduleWarnings) el.scheduleWarnings.innerHTML = '';
    el.scheduleTable.innerHTML = `<div class="hint">Ajusta horas por centro para ver una propuesta de distribución.</div>`;
    if (el.scheduleRoster) el.scheduleRoster.innerHTML = '';
    return;
  }

  try{
    const teachersCount = Number(res?.teachers || 0);
    const schedule = buildEstimatedSchedule(centers, {
      teachersCount,
      weekLabel: 'Semana (referencial)',
    });
    renderEstimatedSchedule(schedule, el.scheduleTable, el.scheduleRoster, el.scheduleWarnings);
  }catch(err){
    console.error('[schedule] Error renderizando horario', err);
    showScheduleHint(`<strong>Error:</strong> ${escapeHtml(err?.message || String(err))}`);
  }
}

/* ========================= Update loop (micro-debounce) ========================= */
let rafToken = 0;

function updateNow(){
  rafToken = 0;

  // Normaliza de una (sin sorpresas)
  centers = centers.map(c => ({
    name: normalizeName(c?.name) || 'CENTRO',
    hours: clampHours(c?.hours),
  }));

  // computeScenario UNA vez
  let res = null;
  try{
    res = computeScenario(centers);
  }catch(err){
    console.error('[computeScenario] falló', err);
    res = null;
  }

  lastComputed = res;

  renderCenters();
  renderSummary(res);
  renderSchedule(res);
}

function update(){
  if (rafToken) return;
  rafToken = requestAnimationFrame(updateNow);
}

/* ========================= Centers interactions (delegación) ========================= */
if (el.centersList){
  el.centersList.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const card = e.target.closest('.center');
    if (!card) return;

    const idx = Number(card.dataset.idx);
    if (!Number.isFinite(idx) || !centers[idx]) return;

    const act = btn.dataset.act;
    if (!act) return;

    if (act === 'inc'){
      centers[idx].hours = clampHours(centers[idx].hours + HOURS_STEP);
      update();
    } else if (act === 'dec'){
      centers[idx].hours = clampHours(centers[idx].hours - HOURS_STEP);
      update();
    } else if (act === 'del'){
      centers.splice(idx, 1);
      if (centers.length === 0){
        centers = DEFAULT_CENTER_NAMES.map(name => ({ name, hours: 0 }));
      }
      update();
    }
  });
}

/* ========================= Top actions ========================= */
if (el.btnAddCenter){
  el.btnAddCenter.addEventListener('click', () => {
    const name = prompt('Nombre del nuevo centro:');
    const normalized = normalizeName(name);
    if (!normalized) return;

    const exists = centers.some(c => normalizeName(c.name) === normalized);
    if (exists){
      alert('Ese centro ya existe.');
      return;
    }

    centers.push({ name: normalized, hours: 0 });
    update();
  });
}

if (el.btnPrint){
  el.btnPrint.addEventListener('click', () => window.print());
}

/* ========================= Scenarios modal ========================= */
function openDlg(focusName=false){
  if (!el.dlg) return;
  renderScenarios();
  el.dlg.showModal();
  if (focusName && el.scenarioName) el.scenarioName.focus();
}

if (el.btnScenarios){
  el.btnScenarios.addEventListener('click', () => openDlg(false));
}

if (el.btnCloseDlg && el.dlg){
  el.btnCloseDlg.addEventListener('click', () => el.dlg.close());
}

if (el.btnSaveScenario){
  el.btnSaveScenario.addEventListener('click', () => {
    if (el.scenarioName) el.scenarioName.value = '';
    openDlg(true);
  });
}

if (el.scenarioName){
  el.scenarioName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){
      e.preventDefault();
      saveScenario();
    }
  });
}

if (el.btnConfirmSave){
  el.btnConfirmSave.addEventListener('click', saveScenario);
}

function saveScenario(){
  if (!el.scenarioName) return;

  const name =
    (el.scenarioName.value || '').trim() ||
    `Escenario ${new Date().toLocaleString('es-CO')}`;

  // Usa el último cálculo si existe
  let res = lastComputed;
  if (!res){
    try { res = computeScenario(centers); } catch { res = null; }
  }

  const scn = {
    id: uid(),
    name,
    createdAt: new Date().toISOString(),
    centers: safeClone(centers),
    summary: {
      weeklyClassHours: res?.weeklyClassHours ?? 0,
      weeklyContractHours: res?.weeklyContractHours ?? 0,
      jornadasWeek: res?.jornadasWeek ?? 0,
      teachers: res?.teachers ?? 0,
      priceMonthly: res?.priceMonthly ?? 0,
      totalPeriod: res?.totalPeriod ?? 0,
    }
  };

  addScenario(scn);
  el.scenarioName.value = '';
  renderScenarios();
}

if (el.btnClearAll){
  el.btnClearAll.addEventListener('click', () => {
    if (!confirm('¿Borrar todos los escenarios guardados?')) return;
    clearAll();
    renderScenarios();
  });
}

function renderScenarios(){
  if (!el.scenariosList) return;

  const list = loadScenarios();
  if (!list.length){
    el.scenariosList.innerHTML = `<div class="hint">No hay escenarios guardados todavía.</div>`;
    return;
  }

  el.scenariosList.innerHTML = list.map(s => {
    const d = new Date(s.createdAt);

    const sub = [
      `${(s.summary?.weeklyClassHours ?? 0)}h/sem`,
      (s.summary?.weeklyContractHours != null
        ? `${(s.summary?.weeklyContractHours ?? 0)}h contrato`
        : null),
      `${(s.summary?.jornadasWeek ?? 0)} jornadas`,
      `${(s.summary?.teachers ?? 0)} docentes`,
      `Mensual: ${moneyCOP(s.summary?.priceMonthly ?? 0)}`,
      `Total: ${moneyCOP(s.summary?.totalPeriod ?? 0)}`,
    ].filter(Boolean).join(' · ');

    return `
      <div class="scenario" data-id="${escapeHtml(s.id)}">
        <div>
          <p class="name">${escapeHtml(s.name)}</p>
          <p class="sub">${escapeHtml(d.toLocaleString('es-CO'))} · ${escapeHtml(sub)}</p>
        </div>
        <div class="actions">
          <button class="btn btn-ghost small" data-act="load" type="button">Cargar</button>
          <button class="btn btn-ghost small" data-act="duplicate" type="button">Duplicar</button>
          <button class="btn btn-danger small" data-act="delete" type="button">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');
}

if (el.scenariosList){
  el.scenariosList.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const row = e.target.closest('.scenario');
    if (!row) return;

    const act = btn.dataset.act;
    const id = row.dataset.id;
    if (!act || !id) return;

    const list = loadScenarios();
    const scn = list.find(x => x.id === id);
    if (!scn) return;

    if (act === 'load'){
      centers = safeClone(scn.centers || []);
      if (!centers.length){
        centers = DEFAULT_CENTER_NAMES.map(name => ({ name, hours: 0 }));
      }
      if (el.dlg) el.dlg.close();
      update();
    } else if (act === 'duplicate'){
      addScenario({
        ...scn,
        id: uid(),
        name: `${scn.name} (copia)`,
        createdAt: new Date().toISOString(),
      });
      renderScenarios();
    } else if (act === 'delete'){
      removeScenario(id);
      renderScenarios();
    }
  });
}

/* ========================= Init ========================= */
initViewNav();
update();
