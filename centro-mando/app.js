/*
  Suite A33 v4.20.4 — Centro de Mando (OPERATIVO v1)

  Fuentes reales (descubiertas en /pos/app.js dentro de esta ZIP):
  - DB_NAME: 'a33-pos'
  - Stores: meta, events, sales, pettyCash, products, inventory, banks
  - Meta key del evento actual: id='currentEventId' (value = number|null)

  Regla clave: NO inventar números.
  Si no se puede leer/calcular fácil y seguro, mostrar “—” + “No disponible”.
*/

// --- Constantes (descubiertas, no adivinadas)
const POS_DB_NAME = 'a33-pos';
const LS_FOCUS_KEY = 'a33_cmd_focusEventId';
const SAFE_SCAN_LIMIT = 4000; // seguridad: evitar loops gigantes

// --- DOM helpers
const $ = (id)=> document.getElementById(id);

function todayYMD(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function ymdAddDays(ymd, delta){
  try{
    const [y,m,d] = ymd.split('-').map(n=>parseInt(n,10));
    const dt = new Date(y, (m||1)-1, d||1);
    dt.setDate(dt.getDate() + delta);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth()+1).padStart(2,'0');
    const dd = String(dt.getDate()).padStart(2,'0');
    return `${yy}-${mm}-${dd}`;
  }catch(_){
    return ymd;
  }
}

function fmtMoneyNIO(n){
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  // 2 decimales, sin locales raros (consistencia iPad)
  const s = n.toFixed(2);
  // separador de miles simple
  const parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `C$ ${parts.join('.')}`;
}

function safeStr(x){
  const s = (x == null) ? '' : String(x);
  return s.trim();
}

function uniq(arr){
  const out = [];
  const s = new Set();
  for (const it of (Array.isArray(arr) ? arr : [])){
    const k = String(it);
    if (s.has(k)) continue;
    s.add(k);
    out.push(it);
  }
  return out;
}

// --- IDB helpers (robustos)
async function openPosDB(opts){
  const timeoutMs = (opts && opts.timeoutMs) ? opts.timeoutMs : 3500;

  return new Promise((resolve, reject)=>{
    let done = false;
    let req;
    const fail = (err)=>{
      if (done) return;
      done = true;
      reject(err instanceof Error ? err : new Error(String(err || 'Error abriendo IndexedDB')));
    };
    const ok = (db)=>{
      if (done) return;
      done = true;
      resolve(db);
    };

    const t = setTimeout(()=>{
      // No bloquea la suite: fallamos y mostramos “No disponible”
      fail(new Error('Timeout abriendo IndexedDB del POS'));
    }, timeoutMs);

    try{
      req = indexedDB.open(POS_DB_NAME);
    }catch(err){
      clearTimeout(t);
      fail(err);
      return;
    }

    req.onerror = ()=>{ clearTimeout(t); fail(req.error || new Error('IndexedDB error')); };
    req.onblocked = ()=>{
      // No es fatal, pero suele indicar otro tab viejo abierto.
      console.warn('Centro de Mando: open blocked. Cierra otras pestañas de Suite A33.');
    };
    req.onsuccess = ()=>{
      clearTimeout(t);
      const db = req.result;
      try{
        db.onversionchange = ()=>{
          try{ db.close(); }catch(_){ }
        };
      }catch(_){ }
      ok(db);
    };
  });
}

function hasStore(db, name){
  try{
    return !!(db && db.objectStoreNames && db.objectStoreNames.contains(name));
  }catch(_){
    return false;
  }
}

function tx(db, storeName, mode){
  return db.transaction(storeName, mode || 'readonly').objectStore(storeName);
}

async function idbGet(db, storeName, key){
  if (!db || !hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const req = tx(db, storeName, 'readonly').get(key);
      req.onsuccess = ()=> resolve(req.result ?? null);
      req.onerror = ()=>{ console.warn('idbGet error', storeName, req.error); resolve(null); };
    }catch(err){
      console.warn('idbGet exception', storeName, err);
      resolve(null);
    }
  });
}

async function idbPut(db, storeName, value){
  if (!db || !hasStore(db, storeName)) return false;
  return new Promise((resolve)=>{
    try{
      const tr = db.transaction(storeName, 'readwrite');
      tr.oncomplete = ()=> resolve(true);
      tr.onerror = ()=>{ console.warn('idbPut tx error', storeName, tr.error); resolve(false); };
      tr.onabort = ()=>{ console.warn('idbPut tx abort', storeName, tr.error); resolve(false); };
      tr.objectStore(storeName).put(value);
    }catch(err){
      console.warn('idbPut exception', storeName, err);
      resolve(false);
    }
  });
}

async function idbGetAll(db, storeName){
  if (!db || !hasStore(db, storeName)) return [];
  return new Promise((resolve)=>{
    try{
      const req = tx(db, storeName, 'readonly').getAll();
      req.onsuccess = ()=> resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = ()=>{ console.warn('idbGetAll error', storeName, req.error); resolve([]); };
    }catch(err){
      console.warn('idbGetAll exception', storeName, err);
      resolve([]);
    }
  });
}

async function idbGetAllByIndex(db, storeName, indexName, keyRange){
  if (!db || !hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const store = tx(db, storeName, 'readonly');
      if (!store.indexNames || !store.indexNames.contains(indexName)) return resolve(null);
      const idx = store.index(indexName);
      const req = idx.getAll(keyRange);
      req.onsuccess = ()=> resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = ()=>{ console.warn('idbGetAllByIndex error', storeName, indexName, req.error); resolve(null); };
    }catch(err){
      console.warn('idbGetAllByIndex exception', storeName, indexName, err);
      resolve(null);
    }
  });
}

async function idbCountByIndex(db, storeName, indexName, keyRange){
  if (!db || !hasStore(db, storeName)) return null;
  return new Promise((resolve)=>{
    try{
      const store = tx(db, storeName, 'readonly');
      if (!store.indexNames || !store.indexNames.contains(indexName)) return resolve(null);
      const idx = store.index(indexName);
      const req = idx.count(keyRange);
      req.onsuccess = ()=> resolve(typeof req.result === 'number' ? req.result : null);
      req.onerror = ()=>{ console.warn('idbCountByIndex error', storeName, indexName, req.error); resolve(null); };
    }catch(err){
      console.warn('idbCountByIndex exception', storeName, indexName, err);
      resolve(null);
    }
  });
}

// --- POS meta helpers
async function getMeta(db, key){
  const row = await idbGet(db, 'meta', key);
  return row ? row.value : null;
}

async function setMeta(db, key, value){
  return idbPut(db, 'meta', { id: key, value });
}

// --- Checklist helpers (estructura real en POS: ev.checklistTemplate + ev.days[YYYY-MM-DD].checklistState)
function computeChecklistProgress(ev, dayKey){
  if (!ev || typeof ev !== 'object') return { ok:false, text:'—', checked:null, total:null, reason:'No disponible' };

  const tpl = (ev.checklistTemplate && typeof ev.checklistTemplate === 'object') ? ev.checklistTemplate : null;
  if (!tpl) return { ok:false, text:'—', checked:null, total:null, reason:'No disponible' };

  const arr = (x)=> Array.isArray(x) ? x : [];
  const total = arr(tpl.pre).length + arr(tpl.evento).length + arr(tpl.cierre).length;
  if (!(total > 0)) return { ok:false, text:'—', checked:0, total:0, reason:'Sin plantilla' };

  const day = (ev.days && typeof ev.days === 'object') ? ev.days[dayKey] : null;
  const st = (day && day.checklistState && typeof day.checklistState === 'object') ? day.checklistState : null;
  const checkedIds = st ? uniq(st.checkedIds) : [];
  const checked = checkedIds.length;
  return { ok:true, text:`${checked}/${total}`, checked, total, reason:'' };
}

function hasPettyDayActivity(day){
  if (!day || typeof day !== 'object') return false;
  if (day.initial && day.initial.savedAt) return true;
  if (day.finalCount && day.finalCount.savedAt) return true;
  if (Array.isArray(day.movements) && day.movements.length) return true;
  if (day.fxRate != null) return true;
  return false;
}

// --- State
const state = {
  db: null,
  events: [],
  eventsById: new Map(),
  focusId: null,
  focusEvent: null,
  today: todayYMD(),
  currentAlerts: [],
};

// --- UI render
function setText(id, text){
  const el = $(id);
  if (!el) return;
  el.textContent = (text == null || text === '') ? '—' : String(text);
}

function setHidden(id, hidden){
  const el = $(id);
  if (!el) return;
  el.hidden = !!hidden;
}

function setDisabled(id, disabled){
  const el = $(id);
  if (!el) return;
  el.disabled = !!disabled;
}

function renderRadarBasics(){
  setText('radarEvents', state.events.length ? String(state.events.length) : (state.db ? '0' : '—'));
  setText('radarEventName', state.focusEvent ? (safeStr(state.focusEvent.name) || '—') : '—');
  // productos sin stock: intencionalmente “—” (cálculo no trivial)
  setText('radarNoStock', '—');
}

function renderFocusHint(){
  const ev = state.focusEvent;
  if (!ev){
    setText('focusHint', '—');
    setText('navNote', 'Selecciona un evento para habilitar navegación contextual.');
    return;
  }
  const g = safeStr(ev.groupName);
  const created = safeStr(ev.createdAt);
  const parts = [];
  if (g) parts.push(`Grupo: ${g}`);
  if (created) parts.push(`Creado: ${created.slice(0,10)}`);
  setText('focusHint', parts.length ? parts.join(' · ') : 'Evento listo.');
  setText('navNote', `Navegación enfocada en: ${safeStr(ev.name) || '—'}`);
}

function renderEmpty(){
  setHidden('emptyState', state.events.length > 0);
  // si no hay eventos, escondemos el resto para no mostrar “—” por todos lados
  setHidden('todayPanel', state.events.length === 0);
  setHidden('alerts', true);
}

function clearMetricsToDash(){
  setText('salesToday', '—');
  setText('salesTodaySub', '—');
  setText('salesTodayHint', 'No disponible');
  setText('pettyState', '—');
  setText('pettyDayState', '—');
  setText('pettyHint', 'No disponible');
  setText('checklistProgress', '—');
  setText('checklistHint', 'No disponible');
  setText('topProducts', '—');
  setText('topHint', '—');
  setText('topProductsHint', 'No disponible');
  setText('radarUnclosed', '—');
}

function renderAlerts(alerts){
  const wrap = $('alerts');
  const list = $('alertList');
  if (!wrap || !list) return;

  // null => ocultar completamente el bloque
  if (alerts === null){
    wrap.hidden = true;
    list.innerHTML = '';
    state.currentAlerts = [];
    return;
  }

  const arr = Array.isArray(alerts) ? alerts : [];
  // snapshot en memoria (para diff en "Sincronizar")
  state.currentAlerts = arr.map(a=> (a && typeof a === 'object') ? ({...a}) : a);

  list.innerHTML = '';
  wrap.hidden = false;

  if (!arr.length){
    list.innerHTML = '<div class="cmd-muted">Sin alertas accionables.</div>';
    return;
  }

  for (const a of arr){
    const row = document.createElement('div');
    row.className = 'cmd-alert';
    if (a && a.key) row.dataset.key = String(a.key);
    row.innerHTML = `
      <div class="cmd-alert-ic">${a.icon}</div>
      <div class="cmd-alert-main">
        <div class="cmd-alert-title">${a.title}</div>
        <div class="cmd-alert-sub">${a.sub}</div>
      </div>
      <button class="cmd-btn" type="button" data-tab="${a.tab}">${a.cta}</button>
    `;
    const btn = row.querySelector('button[data-tab]');
    if (btn){
      btn.addEventListener('click', ()=> navigateToPOS(a.tab));
    }
    list.appendChild(row);
  }
}

function renderTop3(items){
  const el = $('topProducts');
  if (!el) return;
  if (!Array.isArray(items) || !items.length){
    el.textContent = '—';
    return;
  }
  el.innerHTML = '';
  items.slice(0,3).forEach((it, idx)=>{
    const span = document.createElement('span');
    span.textContent = `${idx+1}. ${it.name} · ${it.qty}`;
    el.appendChild(span);
  });
}

// --- Data compute
async function computeSalesToday(eventId, dayKey){
  const db = state.db;
  if (!db || !hasStore(db, 'sales')) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };

  // Preferir índice by_date (más liviano: solo “hoy”)
  let rows = await idbGetAllByIndex(db, 'sales', 'by_date', IDBKeyRange.only(dayKey));

  if (rows === null){
    // No hay index by_date, fallback (potencialmente pesado)
    const c = await idbCountByIndex(db, 'sales', 'by_event', IDBKeyRange.only(eventId));
    if (typeof c === 'number' && c > SAFE_SCAN_LIMIT) {
      return { ok:false, total:null, count:null, top:null, reason:'No disponible' };
    }
    const allByEvent = await idbGetAllByIndex(db, 'sales', 'by_event', IDBKeyRange.only(eventId));
    if (allByEvent === null) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };
    rows = allByEvent.filter(r => r && String(r.date||'') === dayKey);
  }

  if (!Array.isArray(rows)) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };
  if (rows.length > SAFE_SCAN_LIMIT) return { ok:false, total:null, count:null, top:null, reason:'No disponible' };

  const filtered = rows.filter(r => r && Number(r.eventId) === Number(eventId));
  let total = 0;
  const topMap = new Map();
  for (const s of filtered){
    total += Number(s.total || 0);
    const name = safeStr(s.productName) || 'N/D';
    const q = Number(s.qty || 0);
    // para Top: contar solo ventas (qty > 0)
    if (q > 0){
      topMap.set(name, (topMap.get(name) || 0) + q);
    }
  }
  const top = Array.from(topMap.entries())
    .map(([name, qty])=>({ name, qty }))
    .sort((a,b)=> (b.qty - a.qty))
    .slice(0,3);

  return { ok:true, total, count: filtered.length, top, reason:'' };
}

async function computePettyStatus(ev, dayKey){
  const db = state.db;
  if (!db || !ev){
    return { ok:false, enabled:null, dayState:null, fxMissing:null, fxKnown:false, closedAt:null, reason:'No disponible' };
  }

  const enabled = !!ev.pettyEnabled;
  if (!enabled){
    return { ok:true, enabled:false, dayState:'No aplica', fxMissing:false, fxKnown:false, closedAt:null, reason:'' };
  }

  // POS (esta ZIP): T/C persistente por evento (ev.fxRate). Fallback: legado en Caja Chica (day.fxRate).
  const fxEventRaw = Number(ev.fxRate || 0);
  const fxEvent = (Number.isFinite(fxEventRaw) && fxEventRaw > 0) ? fxEventRaw : null;

  // Si no hay store de Caja Chica, NO inventar el estado del día ni el T/C legado.
  if (!hasStore(db, 'pettyCash')){
    const fxKnown = (fxEvent != null);
    // Si solo tenemos el valor por evento y existe, NO falta. Si no existe, es desconocido.
    const fxMissing = fxKnown ? false : null;
    return { ok:false, enabled:true, dayState:null, fxMissing, fxKnown, closedAt:null, pcDay:null, fxSource: fxKnown ? 'event' : 'unknown', reason:'No disponible' };
  }

  let pc = null;
  try{ pc = await idbGet(db, 'pettyCash', Number(ev.id)); }catch(_){ pc = null; }
  if (!pc || !pc.days || typeof pc.days !== 'object'){
    const fxKnown = (fxEvent != null);
    const fxMissing = fxKnown ? false : null;
    return { ok:false, enabled:true, dayState:null, fxMissing, fxKnown, closedAt:null, pcDay:null, fxSource: fxKnown ? 'event' : 'unknown', reason:'No disponible' };
  }

  const day = pc.days[dayKey];
  if (!day || typeof day !== 'object'){
    const fxKnown = (fxEvent != null);
    const fxMissing = fxKnown ? false : null;
    return { ok:false, enabled:true, dayState:null, fxMissing, fxKnown, closedAt:null, pcDay:null, fxSource: fxKnown ? 'event' : 'unknown', reason:'No disponible' };
  }

  const closedAt = day.closedAt || null;
  const dayState = closedAt ? 'Cerrado' : 'Abierto';

  const fxDayRaw = (day.fxRate != null) ? Number(day.fxRate) : NaN;
  const fxDay = (Number.isFinite(fxDayRaw) && fxDayRaw > 0) ? fxDayRaw : null;

  const fxEffective = (fxEvent != null) ? fxEvent : fxDay;
  const fxKnown = true; // tenemos day (y/o event), así que podemos determinar si falta.
  const fxMissing = !(fxEffective && fxEffective > 0);
  const fxSource = (fxEvent != null) ? 'event' : (fxDay != null ? 'pettyCash' : 'none');

  return { ok:true, enabled:true, dayState, fxMissing, fxKnown, closedAt, pcDay: day, fxSource, reason:'' };
}

async function computeUnclosed7d(ev, pcDayKey){
  if (!ev || !ev.pettyEnabled) return { ok:true, value:'—', reason:'' };
  const db = state.db;
  if (!db || !hasStore(db, 'pettyCash')) return { ok:false, value:'—', reason:'No disponible' };

  const pc = await idbGet(db, 'pettyCash', Number(ev.id));
  if (!pc || !pc.days || typeof pc.days !== 'object') return { ok:false, value:'—', reason:'No disponible' };

  // últimos 7 días incluyendo hoy
  let cnt = 0;
  for (let i = 0; i < 7; i++){
    const d = ymdAddDays(pcDayKey, -i);
    const day = pc.days[d];
    if (!day || typeof day !== 'object') continue;
    // Contar solo si hay actividad (evitar “inventar”)
    if (!hasPettyDayActivity(day)) continue;
    if (!day.closedAt) cnt += 1;
  }
  return { ok:true, value: String(cnt), reason:'' };
}

// --- Alertas (motor + Sincronizar)
const ALERT_LABELS = {
  'petty-open': 'Caja Chica: día abierto',
  'fx-missing': 'Tipo de cambio vacío hoy',
  'checklist-incomplete': 'Checklist hoy incompleto',
  'inventory-critical': 'Inventario crítico',
};

function labelForAlertKey(k){
  try{ return ALERT_LABELS[k] || String(k || '—'); }catch(_){ return '—'; }
}

function buildActionableAlerts(ev, dayKey, pc){
  const alerts = [];
  const unavailable = [];

  // 1) Caja Chica activa y hoy NO está cerrado (solo con señal real)
  if (pc && pc.enabled === true){
    if (pc.ok){
      if (pc.dayState === 'Abierto'){
        alerts.push({
          key: 'petty-open',
          icon: '🔓',
          title: 'Caja Chica activa y hoy NO está cerrado',
          sub: `Hoy (${dayKey}): día abierto en Caja Chica`,
          cta: 'Ir a Caja Chica',
          tab: 'caja'
        });
      }
    } else {
      // No se pudo leer el día (no inventar)
      unavailable.push({ key: 'petty-open', label: labelForAlertKey('petty-open'), reason: pc.reason || 'No disponible' });
    }

    // 2) Tipo de cambio vacío hoy (POS actual: ev.fxRate; fallback legado: day.fxRate)
    if (pc.fxKnown === true){
      if (pc.fxMissing === true){
        alerts.push({
          key: 'fx-missing',
          icon: '💱',
          title: 'Tipo de cambio vacío hoy',
          sub: `Hoy (${dayKey}): falta tipo de cambio`,
          cta: 'Ir a Caja Chica',
          tab: 'caja'
        });
      }
    } else {
      // No se puede evaluar con seguridad (store/campo faltante)
      unavailable.push({ key: 'fx-missing', label: labelForAlertKey('fx-missing'), reason: pc.reason || 'No disponible' });
    }
  }

  // 3) Checklist hoy incompleto (solo si existe plantilla)
  if (ev && ev.checklistTemplate && typeof ev.checklistTemplate === 'object'){
    const chk = computeChecklistProgress(ev, dayKey);
    if (chk && chk.ok && typeof chk.checked === 'number' && typeof chk.total === 'number' && chk.total > 0){
      if (chk.checked < chk.total){
        alerts.push({
          key: 'checklist-incomplete',
          icon: '✅',
          title: 'Checklist hoy incompleto',
          sub: `Hoy (${dayKey}): ${chk.checked}/${chk.total}`,
          cta: 'Abrir Checklist',
          tab: 'checklist'
        });
      }
    } else if (chk && !chk.ok){
      unavailable.push({ key: 'checklist-incomplete', label: labelForAlertKey('checklist-incomplete'), reason: chk.reason || 'No disponible' });
    }
  }

  // 4) Inventario crítico — v1: no hay cálculo “fácil/seguro” en esta ZIP
  unavailable.push({ key: 'inventory-critical', label: labelForAlertKey('inventory-critical'), reason: 'No disponible' });

  return { alerts, unavailable };
}

function getRenderedAlertKeys(){
  try{
    const arr = Array.isArray(state.currentAlerts) ? state.currentAlerts : [];
    return arr.map(a=> (a && a.key) ? String(a.key) : '').filter(Boolean);
  }catch(_){
    return [];
  }
}

function diffAlertKeys(beforeKeys, afterKeys){
  const b = new Set(Array.isArray(beforeKeys) ? beforeKeys : []);
  const a = new Set(Array.isArray(afterKeys) ? afterKeys : []);
  const hidden = [];
  const pending = [];
  const added = [];
  for (const k of b){ if (!a.has(k)) hidden.push(k); else pending.push(k); }
  for (const k of a){ if (!b.has(k)) added.push(k); }
  return { hidden, pending, added };
}

function showToast(msg, ms){
  const el = $('cmdToast');
  if (!el) return;
  el.textContent = String(msg || '');
  el.hidden = false;
  try{ clearTimeout(state.__toastT); }catch(_){ }
  state.__toastT = setTimeout(()=>{ el.hidden = true; }, Math.max(700, ms || 1800));
}

function showSyncReport(payload){
  const modal = $('syncReport');
  const body = $('syncReportBody');
  const title = $('syncReportTitle');
  if (!modal || !body || !title) return;

  const escMap = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
  const esc = (s)=> String(s ?? '').replace(/[&<>"']/g, (c)=> escMap[c] || c);

  title.textContent = (payload && payload.title) ? String(payload.title) : 'Resumen';

  const msg = (payload && payload.message)
    ? `<div class="cmd-muted">${esc(payload.message)}</div>`
    : '';

  const section = (h, items, fmt)=>{
    if (!Array.isArray(items) || items.length === 0) return '';
    const li = items.map(x=> `<li>${fmt ? fmt(x) : esc(x)}</li>`).join('');
    return `<h4>${esc(h)}</h4><ul>${li}</ul>`;
  };

  const hidden = (payload && payload.hidden) ? payload.hidden : [];
  const pending = (payload && payload.pending) ? payload.pending : [];
  const added = (payload && payload.added) ? payload.added : [];
  const unavailable = (payload && payload.unavailable) ? payload.unavailable : [];

  const fmtKey = (k)=> esc(labelForAlertKey(k));
  const fmtUn = (u)=>{
    const key = u && (u.key || u.id) ? String(u.key || u.id) : '';
    const label = (u && u.label) ? String(u.label) : labelForAlertKey(key);
    const reason = (u && u.reason) ? String(u.reason) : 'No disponible';
    return `${esc(label)} <span class="cmd-muted">— ${esc(reason)}</span>`;
  };

  body.innerHTML =
    msg +
    section('Ocultadas (resueltas)', hidden, fmtKey) +
    section('Siguen pendientes', pending, fmtKey) +
    section('Nuevas', added, fmtKey) +
    section('No disponibles (—)', unavailable, fmtUn);

  modal.hidden = false;
}

function hideSyncReport(){
  const modal = $('syncReport');
  if (modal) modal.hidden = true;
}

async function syncAlerts(){
  const btn = $('btnSyncAlerts');
  const focusId = state.focusId;

  if (!focusId){
    showToast('No hay evento enfocado.', 2000);
    showSyncReport({ title:'Resumen', message:'No hay eventos disponibles.' });
    return;
  }

  const before = getRenderedAlertKeys();

  if (btn) btn.disabled = true;
  showToast('Sincronizando…', 1200);

  try{
    // Fecha local actual (evita quedarse “ayer” en iPad PWA)
    state.today = todayYMD();
    const dayKey = state.today;

    // Asegurar DB abierta
    if (!state.db){
      state.db = await openPosDB({ timeoutMs: 3500 });
    }

    // Releer evento REAL del store 'events'
    let evFresh = null;
    if (state.db && hasStore(state.db, 'events')){
      try{ evFresh = await idbGet(state.db, 'events', Number(focusId)); }catch(_){ }
    }
    const ev = (evFresh && typeof evFresh === 'object') ? evFresh : state.focusEvent;

    // Respetar evento enfocado
    if (state.focusId !== focusId){
      showToast('El evento enfocado cambió. Intenta de nuevo.', 2200);
      return;
    }

    // Recalcular señales (solo lectura)
    let pc;
    try{
      pc = await computePettyStatus(ev, dayKey);
    }catch(err){
      pc = { ok:false, enabled: (ev && ev.pettyEnabled) ? true : null, reason:'No disponible' };
    }

    const al = buildActionableAlerts(ev, dayKey, pc);
    renderAlerts(al.alerts);

    const after = (al.alerts || []).map(a=> a && a.key ? String(a.key) : '').filter(Boolean);
    const diff = diffAlertKeys(before, after);

    const noChange = diff.hidden.length === 0 && diff.added.length === 0 && (before.join('|') === after.join('|'));
    if (noChange){
      showSyncReport({ title:'Resumen', message:'Sin cambios. Todo sigue igual.', unavailable: al.unavailable || [] });
    } else {
      showSyncReport({ title:'Resumen', hidden: diff.hidden, pending: diff.pending, added: diff.added, unavailable: al.unavailable || [] });
    }

    // Refrescar cache en memoria
    if (evFresh && state.eventsById && state.eventsById.set){
      try{ state.eventsById.set(Number(focusId), evFresh); }catch(_){ }
      state.focusEvent = evFresh;
    }
  }catch(err){
    console.warn('Sincronizar: error', err);
    showSyncReport({
      title:'Resumen',
      message:'No disponible.',
      unavailable:[
        { key:'petty-open', label: labelForAlertKey('petty-open'), reason:'No disponible' },
        { key:'fx-missing', label: labelForAlertKey('fx-missing'), reason:'No disponible' },
        { key:'checklist-incomplete', label: labelForAlertKey('checklist-incomplete'), reason:'No disponible' },
        { key:'inventory-critical', label: labelForAlertKey('inventory-critical'), reason:'No disponible' },
      ]
    });
  }finally{
    if (btn) btn.disabled = false;
  }
}



// --- Navigation
async function navigateToPOS(tab){
  const ev = state.focusEvent;
  if (!ev || !state.db) return;
  try{
    await setMeta(state.db, 'currentEventId', Number(ev.id));
  }catch(_){ }
  const t = safeStr(tab) || 'vender';
  window.location.href = `../pos/index.html?tab=${encodeURIComponent(t)}`;
}

// --- Picker
function eventSortKey(ev){
  // Preferir updatedAt, luego createdAt, luego id (todos reales del objeto)
  const u = Number(ev.updatedAt || 0);
  if (u) return u;
  const c = safeStr(ev.createdAt);
  if (c) {
    const ts = Date.parse(c);
    if (isFinite(ts)) return ts;
  }
  return Number(ev.id || 0);
}

function filterEvents(query){
  const q = safeStr(query).toLowerCase();
  if (!q) return state.events.slice(0, 40);
  return state.events
    .filter(ev => {
      const name = safeStr(ev.name).toLowerCase();
      const group = safeStr(ev.groupName).toLowerCase();
      return name.includes(q) || group.includes(q);
    })
    .slice(0, 40);
}

function renderEventList(query){
  const list = $('eventList');
  if (!list) return;
  const items = filterEvents(query);
  list.innerHTML = '';

  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'cmd-item';
    empty.innerHTML = `<div class="cmd-item-title">Sin resultados</div><div class="cmd-item-sub">Prueba otro término.</div>`;
    list.appendChild(empty);
    return;
  }

  for (const ev of items){
    const row = document.createElement('div');
    const selected = state.focusId != null && Number(state.focusId) === Number(ev.id);
    row.className = 'cmd-item' + (selected ? ' cmd-item-selected' : '');
    const g = safeStr(ev.groupName);
    row.innerHTML = `
      <div class="cmd-item-title">${safeStr(ev.name) || '—'}</div>
      <div class="cmd-item-sub">${g ? ('Grupo: ' + g) : 'Sin grupo'}</div>
    `;
    row.addEventListener('click', ()=> setFocusEvent(Number(ev.id)));
    list.appendChild(row);
  }
}

function showEventList(){
  const list = $('eventList');
  if (!list) return;
  list.hidden = false;
}

function hideEventList(){
  const list = $('eventList');
  if (!list) return;
  list.hidden = true;
}

async function setFocusEvent(eventId){
  const id = Number(eventId);
  if (!id || !state.eventsById.has(id)) return;
  state.focusId = id;
  state.focusEvent = state.eventsById.get(id) || null;

  // Persistencia: meta + localStorage (robusto)
  try{ localStorage.setItem(LS_FOCUS_KEY, String(id)); }catch(_){ }
  try{
    if (state.db && hasStore(state.db, 'meta')){
      await setMeta(state.db, 'currentEventId', id);
    }
  }catch(err){
    console.warn('No se pudo persistir currentEventId en meta', err);
  }

  // UI
  const input = $('eventSearch');
  if (input) input.value = safeStr(state.focusEvent.name) || '';
  renderEventList('');
  hideEventList();
  renderFocusHint();
  renderRadarBasics();

  await refreshAll();
}

// --- Main refresh
async function refreshAll(){
  clearMetricsToDash();
  renderAlerts(null);

  const ev = state.focusEvent;
  if (!ev || !state.db) {
    setDisabled('btnGoSell', true);
    setDisabled('btnGoCaja', true);
    setDisabled('btnGoResumen', true);
    setDisabled('btnGoChecklist', true);
    setDisabled('btnOpenChecklist', true);
    return;
  }

  setDisabled('btnGoSell', false);
  setDisabled('btnGoResumen', false);
  setDisabled('btnGoChecklist', false);
  setDisabled('btnOpenChecklist', false);

  const dk = state.today;

  // Checklist
  const chk = computeChecklistProgress(ev, dk);
  setText('checklistProgress', chk.text);
  setText('checklistHint', chk.ok ? 'Hoy' : chk.reason);

  // Caja chica
  const pc = await computePettyStatus(ev, dk);
  if (pc.ok && pc.enabled === false){
    setText('pettyState', 'No aplica');
    setText('pettyDayState', '—');
    setText('pettyHint', 'Caja Chica desactivada en este evento.');
    setDisabled('btnGoCaja', true);
  } else if (pc.ok && pc.enabled === true){
    setText('pettyState', 'Activa');
    setText('pettyDayState', pc.dayState || '—');
    setText('pettyHint', pc.dayState ? `Día ${dk}: ${pc.dayState}` : 'No disponible');
    setDisabled('btnGoCaja', false);
  } else if (pc.enabled === true){
    // enabled pero no se pudo leer
    setText('pettyState', 'Activa');
    setText('pettyDayState', '—');
    setText('pettyHint', pc.reason || 'No disponible');
    setDisabled('btnGoCaja', false);
  } else {
    setText('pettyState', '—');
    setText('pettyDayState', '—');
    setText('pettyHint', pc.reason || 'No disponible');
    setDisabled('btnGoCaja', true);
  }

  // Ventas hoy + Top productos
  const sales = await computeSalesToday(Number(ev.id), dk);
  if (sales.ok){
    setText('salesToday', fmtMoneyNIO(sales.total));
    setText('salesTodaySub', (typeof sales.count === 'number') ? (`Registros: ${sales.count}`) : '—');
    setText('salesTodayHint', dk);
    // Top
    if (Array.isArray(sales.top) && sales.top.length){
      renderTop3(sales.top);
      setText('topHint', 'Top 3');
      setText('topProductsHint', dk);
    } else {
      renderTop3([]);
      setText('topHint', '—');
      setText('topProductsHint', 'Sin datos hoy');
    }
  } else {
    setText('salesToday', '—');
    setText('salesTodaySub', '—');
    setText('salesTodayHint', sales.reason || 'No disponible');
    renderTop3([]);
    setText('topHint', '—');
    setText('topProductsHint', 'No disponible');
  }

  // Radar unclosed 7d
  const unc = await computeUnclosed7d(ev, dk);
  setText('radarUnclosed', (unc && unc.ok) ? unc.value : '—');

  // Alertas accionables (solo con señal real)
  const al = buildActionableAlerts(ev, dk, pc);
  renderAlerts(al.alerts);
}

// --- Init
async function init(){
  // Header: hoy
  setText('cmdToday', state.today);

  // Buttons
  const bind = (id, tab)=>{
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', ()=> navigateToPOS(tab));
  };
  bind('btnGoSell', 'vender');
  bind('btnGoCaja', 'caja');
  bind('btnGoResumen', 'resumen');
  bind('btnGoChecklist', 'checklist');
  bind('btnOpenChecklist', 'checklist');

  // Alertas accionables: Sincronizar (pastilla)
  const syncBtn = $('btnSyncAlerts');
  if (syncBtn){
    syncBtn.addEventListener('click', syncAlerts);
  }

  // Modal resumen: cerrar con overlay / botón / Aceptar
  const syncModal = $('syncReport');
  if (syncModal){
    syncModal.addEventListener('click', (e)=>{
      const t = e.target;
      if (!t) return;
      const hit = (t.matches && t.matches('[data-close="1"]')) || (t.closest && t.closest('[data-close="1"]'));
      if (hit) hideSyncReport();
    });
  }
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') hideSyncReport();
  });

  // Picker events
  const input = $('eventSearch');
  const btn = $('eventPickerBtn');
  const list = $('eventList');

  if (input){
    // iOS/Keychain + UX: el input suele estar prellenado con el evento actual.
    // Si filtramos con ese texto al abrir, parece que "solo existe" un evento.
    // Regla operativa: al abrir (focus) mostramos TODOS; al escribir, filtramos.
    input.addEventListener('focus', ()=>{
      renderEventList('');
      showEventList();
      try{ input.select(); }catch(_){ }
    });
    input.addEventListener('input', ()=>{ renderEventList(input.value); showEventList(); });
    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape') hideEventList();
    });
  }
  if (btn){
    btn.addEventListener('click', ()=>{
      if (!list) return;
      if (list.hidden){
        // Al abrir por botón, mostrar TODO (sin filtrar por el evento actual prellenado)
        renderEventList('');
        showEventList();
        try{ input && input.focus(); }catch(_){ }
        try{ input && input.select(); }catch(_){ }
      } else {
        hideEventList();
      }
    });
  }
  document.addEventListener('click', (e)=>{
    const picker = $('eventPicker');
    if (!picker || !list) return;
    if (!picker.contains(e.target)) hideEventList();
  });

  clearMetricsToDash();
  renderAlerts(null);

  // Open DB
  let db;
  try{
    db = await openPosDB({ timeoutMs: 3500 });
    state.db = db;
  }catch(err){
    console.warn('Centro de Mando: no se pudo abrir DB del POS', err);
    // Sin DB: dejar todo en “No disponible”, pero nunca bloquear la suite.
    state.db = null;
    state.events = [];
    state.eventsById = new Map();
    renderRadarBasics();
    renderEmpty();
    return;
  }

  // Load events
  try{
    const evs = await idbGetAll(db, 'events');
    state.events = Array.isArray(evs) ? evs.slice() : [];
    state.events.sort((a,b)=> eventSortKey(b) - eventSortKey(a));
    state.eventsById = new Map(state.events.map(e=> [Number(e.id), e]));
  }catch(err){
    console.warn('Centro de Mando: error cargando eventos', err);
    state.events = [];
    state.eventsById = new Map();
  }

  renderRadarBasics();
  renderEmpty();
  if (!state.events.length){
    return;
  }

  // Default focus: POS currentEventId → localStorage → más reciente
  let focusId = null;
  try{
    focusId = await getMeta(db, 'currentEventId');
  }catch(_){ }
  if (!focusId){
    try{
      const raw = localStorage.getItem(LS_FOCUS_KEY);
      const parsed = parseInt(raw || '0', 10);
      if (parsed) focusId = parsed;
    }catch(_){ }
  }
  if (!focusId || !state.eventsById.has(Number(focusId))){
    focusId = Number(state.events[0].id);
  }

  // Pre-render list
  if (input) input.value = safeStr(state.eventsById.get(Number(focusId))?.name || '');
  renderEventList('');
  hideEventList();

  await setFocusEvent(Number(focusId));
}

document.addEventListener('DOMContentLoaded', init);
