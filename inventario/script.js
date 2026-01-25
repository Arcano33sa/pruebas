const STORAGE_KEY_INVENTARIO = "arcano33_inventario";

const LIQUIDS = [
  { id: "vino",   nombre: "Vino" },
  { id: "vodka",  nombre: "Vodka" },
  { id: "jugo",   nombre: "Jugo" },
  { id: "sirope", nombre: "Sirope" },
  { id: "agua",   nombre: "Agua pura" },
];

const BOTTLES = [
  { id: "pulso", nombre: "Pulso 250 ml" },
  { id: "media", nombre: "Media 375 ml" },
  { id: "djeba", nombre: "Djeba 750 ml" },
  { id: "litro", nombre: "Litro 1000 ml" },
  { id: "galon", nombre: "Galón 3750 ml" },
];

const FINISHED = [
  { id: "pulso", nombre: "Pulso 250 ml (listo)" },
  { id: "media", nombre: "Media 375 ml (lista)" },
  { id: "djeba", nombre: "Djeba 750 ml (lista)" },
  { id: "litro", nombre: "Litro 1000 ml (lista)" },
  { id: "galon", nombre: "Galón 3750 ml (lista)" },
];


function $(id) {
  return document.getElementById(id);
}

function defaultInventario() {
  const inv = {
    liquids: {},
    bottles: {},
    finished: {},
  };
  LIQUIDS.forEach((l) => {
    inv.liquids[l.id] = { stock: 0, max: 0 };
  });
  BOTTLES.forEach((b) => {
    inv.bottles[b.id] = { stock: 0 };
  });
  FINISHED.forEach((p) => {
    inv.finished[p.id] = { stock: 0 };
  });
  return inv;
}

function parseNumber(value) {
  const n = parseFloat(String(value).replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

// ------------------------------
// Integridad dura (Etapa 1)
// - No aceptar NaN/Infinity/strings raras al guardar.
// - Bloquear negativos donde no aplique.
// - Errores visibles (no silenciosos).
// ------------------------------

function safeAlert(msg){
  try{ alert(String(msg || 'Error')); }catch(_){ console.error(String(msg || 'Error')); }
}

// ------------------------------
// Anti-pisadas multi-módulo (Etapa 2)
// - Releer antes de guardar
// - Merge conservador por campo editado
// - Conflicto si otro módulo cambió lo mismo (rev/updatedAt)
// ------------------------------

let INV_BASE_SNAPSHOT = null;
let INV_BASE_REV = null;
let INV_BASE_UPDATED_AT = null;

function deepClone(obj){
  try{ return JSON.parse(JSON.stringify(obj ?? null)); }catch(_){ return obj; }
}

function readInventarioShared(){
  if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
    return A33Storage.sharedRead(STORAGE_KEY_INVENTARIO, defaultInventario(), 'local');
  }
  if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
    const data = A33Storage.sharedGet(STORAGE_KEY_INVENTARIO, defaultInventario(), 'local');
    return { data, meta: { rev: 0, updatedAt: null, writer: '' } };
  }
  return { data: null, meta: { rev: 0, updatedAt: null, writer: '' } };
}

function readInventarioMetaRaw(){
  const mk = STORAGE_KEY_INVENTARIO + '__meta';
  try{
    const m = (window.A33Storage && typeof A33Storage.getJSON === 'function')
      ? A33Storage.getJSON(mk, null, 'local')
      : null;
    if (m && typeof m === 'object'){
      const rev = Number.isFinite(+m.rev) ? Math.trunc(+m.rev) : 0;
      const updatedAt = (typeof m.updatedAt === 'string') ? m.updatedAt : null;
      const writer = (typeof m.writer === 'string') ? m.writer : '';
      return { rev, updatedAt, writer };
    }
  }catch(_){ }
  return { rev: 0, updatedAt: null, writer: '' };
}

function writeInventarioMetaRaw(nextRev, writer){
  const mk = STORAGE_KEY_INVENTARIO + '__meta';
  const out = {
    rev: Number.isFinite(nextRev) ? Math.trunc(nextRev) : 0,
    updatedAt: (new Date()).toISOString(),
    writer: String(writer || 'inventario')
  };
  try{ A33Storage.setItem(mk, JSON.stringify(out), 'local'); }catch(_){ }
  try{
    if (window.A33Storage && A33Storage._sharedState) {
      A33Storage._sharedState[STORAGE_KEY_INVENTARIO] = { ...out, readAt: Date.now() };
    }
  }catch(_){ }
  return out;
}

function trackInventarioBase(inv, meta){
  try{
    INV_BASE_SNAPSHOT = deepClone(inv);
    INV_BASE_REV = (meta && Number.isFinite(+meta.rev)) ? Math.trunc(+meta.rev) : 0;
    INV_BASE_UPDATED_AT = (meta && meta.updatedAt) ? String(meta.updatedAt) : null;
  }catch(_){ }
}

function getField(inv, section, id, field){
  try{
    const sec = (inv && inv[section] && typeof inv[section] === 'object') ? inv[section] : null;
    const it = sec && sec[id] && typeof sec[id] === 'object' ? sec[id] : null;
    if (!it) return undefined;
    const v = it[field];
    return (typeof v === 'number') ? v : parseNumber(v);
  }catch(_){ return undefined; }
}

function collectEdits(base, local){
  const edits = [];
  const baseL = (base && base.liquids && typeof base.liquids === 'object') ? base.liquids : {};
  const localL = (local && local.liquids && typeof local.liquids === 'object') ? local.liquids : {};
  const idsL = new Set([...Object.keys(baseL), ...Object.keys(localL)]);
  idsL.forEach((id)=>{
    const bStock = getField(base, 'liquids', id, 'stock');
    const lStock = getField(local, 'liquids', id, 'stock');
    if (bStock !== lStock) edits.push({ section:'liquids', id, field:'stock', value:lStock });
    const bMax = getField(base, 'liquids', id, 'max');
    const lMax = getField(local, 'liquids', id, 'max');
    if (bMax !== lMax) edits.push({ section:'liquids', id, field:'max', value:lMax });
  });

  const baseB = (base && base.bottles && typeof base.bottles === 'object') ? base.bottles : {};
  const localB = (local && local.bottles && typeof local.bottles === 'object') ? local.bottles : {};
  const idsB = new Set([...Object.keys(baseB), ...Object.keys(localB)]);
  idsB.forEach((id)=>{
    const bStock = getField(base, 'bottles', id, 'stock');
    const lStock = getField(local, 'bottles', id, 'stock');
    if (bStock !== lStock) edits.push({ section:'bottles', id, field:'stock', value:lStock });
  });

  return edits;
}

function applyEditsToCurrent(cur, edits){
  const out = deepClone(cur);
  if (!out || typeof out !== 'object') return out;
  if (!out.liquids || typeof out.liquids !== 'object') out.liquids = {};
  if (!out.bottles || typeof out.bottles !== 'object') out.bottles = {};
  if (!out.finished || typeof out.finished !== 'object') out.finished = {};

  edits.forEach((e)=>{
    if (!e || !e.section || !e.id || !e.field) return;
    if (!out[e.section] || typeof out[e.section] !== 'object') out[e.section] = {};
    if (!out[e.section][e.id] || typeof out[e.section][e.id] !== 'object') out[e.section][e.id] = {};
    out[e.section][e.id][e.field] = e.value;
  });
  return out;
}

function sharedCommitInventarioConservative(localInv){
  // Releer justo antes de guardar
  const r = readInventarioShared();
  const cur = (r && r.data && typeof r.data === 'object') ? r.data : defaultInventario();
  const meta = (r && r.meta && typeof r.meta === 'object') ? r.meta : { rev:0, updatedAt:null, writer:'' };
  const curRev = Number.isFinite(+meta.rev) ? Math.trunc(+meta.rev) : 0;

  if (INV_BASE_SNAPSHOT == null){
    trackInventarioBase(cur, meta);
  }

  const base = INV_BASE_SNAPSHOT || defaultInventario();
  const baseRev = Number.isFinite(+INV_BASE_REV) ? Math.trunc(+INV_BASE_REV) : 0;
  const edits = collectEdits(base, localInv);

  if (!edits.length){
    // Nada cambió vs base; re-sincronizar base y salir.
    trackInventarioBase(cur, meta);
    return { ok:true, data: cur, message:'' };
  }

  // Conflicto: otro módulo/pestaña cambió lo MISMO desde nuestra lectura.
  if (curRev !== baseRev){
    for (const e of edits){
      const baseVal = getField(base, e.section, e.id, e.field);
      const curVal = getField(cur, e.section, e.id, e.field);
      if (baseVal !== curVal){
        return {
          ok:false,
          data: cur,
          message:'Se detectaron cambios recientes en inventario. Recarga y reintenta (para evitar corrupción).'
        };
      }
    }
  }

  const finalData = applyEditsToCurrent(cur, edits);
  const v2 = validateBeforeSave(finalData);
  if (!v2.ok) return { ok:false, data: cur, message: v2.message || 'No se pudo guardar el inventario.' };

  // Anti-race: revisar rev justo antes de escribir
  const metaNow = readInventarioMetaRaw();
  if (Number.isFinite(+metaNow.rev) && Math.trunc(+metaNow.rev) !== curRev){
    return {
      ok:false,
      data: cur,
      message:'Se detectaron cambios recientes. Recarga y vuelve a intentar.'
    };
  }

  // Escribir data + meta (sin sharedSet para poder BLOQUEAR en conflicto)
  try{
    const ok = A33Storage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(finalData ?? null), 'local');
    if (!ok){
      return { ok:false, data: cur, message:'No se pudo guardar el inventario (storage lleno o bloqueado).' };
    }
  }catch(err){
    return { ok:false, data: cur, message:'No se pudo guardar el inventario (error de storage).' };
  }

  const metaWritten = writeInventarioMetaRaw(curRev + 1, 'inventario');
  trackInventarioBase(finalData, metaWritten);
  return { ok:true, data: finalData, message:'' };
}

function toFiniteNumber(value){
  const s = String(value ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function toNonNegativeNumber(value){
  const n = toFiniteNumber(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

function toNonNegativeInt(value){
  const n = toFiniteNumber(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  if (!Number.isInteger(n)) return NaN;
  return n;
}

function isValidDateKey(dateKey){
  if (typeof dateKey !== 'string') return false;
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(dateKey);
  if (!m) return false;
  const d = new Date(dateKey + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  // Validación estricta (evita 2026-02-31)
  const [y, mo, da] = dateKey.split('-').map(x => parseInt(x, 10));
  return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === mo && d.getUTCDate() === da;
}

function validateBeforeSave(inv){
  if (!inv || typeof inv !== 'object'){
    return { ok:false, message:'Inventario inválido: estructura vacía o corrupta.' };
  }

  // Si existe dateKey (por compatibilidad futura), validarlo.
  if (Object.prototype.hasOwnProperty.call(inv, 'dateKey') && inv.dateKey != null){
    if (!isValidDateKey(String(inv.dateKey))){
      return { ok:false, message:'Fecha inválida: dateKey debe ser YYYY-MM-DD.' };
    }
  }

  // Estructura mínima
  if (!inv.liquids || typeof inv.liquids !== 'object'){
    return { ok:false, message:'Inventario inválido: falta sección "liquids".' };
  }
  if (!inv.bottles || typeof inv.bottles !== 'object'){
    return { ok:false, message:'Inventario inválido: falta sección "bottles".' };
  }
  if (!inv.finished || typeof inv.finished !== 'object'){
    // finished puede existir por otros módulos; si no está, no bloqueamos: compat.
    inv.finished = inv.finished || {};
  }

  // Validar valores que este módulo edita
  for (const id of Object.keys(inv.liquids)){
    const it = inv.liquids[id];
    if (!it || typeof it !== 'object') return { ok:false, message:`Inventario inválido: "liquids.${id}" corrupto.` };
    if (!Number.isFinite(it.stock) || it.stock < 0) return { ok:false, message:`Valor inválido en ${id}: stock debe ser número >= 0.` };
    if (!Number.isFinite(it.max) || it.max < 0) return { ok:false, message:`Valor inválido en ${id}: máximo debe ser número >= 0.` };
  }
  for (const id of Object.keys(inv.bottles)){
    const it = inv.bottles[id];
    if (!it || typeof it !== 'object') return { ok:false, message:`Inventario inválido: "bottles.${id}" corrupto.` };
    if (!Number.isFinite(it.stock) || it.stock < 0) return { ok:false, message:`Valor inválido en ${id}: stock de botellas debe ser número >= 0.` };
    // Botellas: unidad entera (sin fracciones)
    if (!Number.isInteger(it.stock)) return { ok:false, message:`Valor inválido en ${id}: el stock de botellas debe ser entero.` };
  }

  return { ok:true, message:'' };
}

function markA33Num(input, { defaultValue = '0', mode = 'decimal' } = {}) {
  try {
    if (!input || !(input instanceof HTMLInputElement)) return;
    if (input.readOnly || input.disabled) return;
    input.classList.add('a33-num');
    input.dataset.a33Default = String(defaultValue);
    input.inputMode = mode;
  } catch (e) {}
}

// ------------------------------
// Inventario — Etapa 3 (iPad-first + rendimiento)
// - Sin scroll horizontal en iPad (tarjetas via CSS + data-labels en celdas)
// - Render incremental (sin rehacer listas completas)
// - Paginación simple ("Cargar más")
// - Estados visibles: cargando / guardando / sin resultados / errores
// ------------------------------

const INV_UI = {
  // suficientemente alto para mostrar todo por defecto (sin filtros)
  pageSize: 9999,
  pages: { liquids: 1, bottles: 1, finished: 1 },
};

const INV_VIEW = {
  liquids: { tbodyId: "inv-liquidos-body", emptyId: "inv-liquidos-empty", moreId: "inv-liquidos-more" },
  bottles: { tbodyId: "inv-botellas-body", emptyId: "inv-botellas-empty", moreId: "inv-botellas-more" },
  finished: { tbodyId: "inv-productos-body", emptyId: "inv-productos-empty", moreId: "inv-productos-more" },
};

const INV_ROW_CACHE = {
  liquids: new Map(),
  bottles: new Map(),
  finished: new Map(),
};

function debounce(fn, waitMs) {
  let t = null;
  return function debounced(...args) {
    try { if (t) clearTimeout(t); } catch (e) {}
    t = setTimeout(() => fn.apply(null, args), waitMs);
  };
}

function setStatus(text, kind = "info", { sticky = false, timeoutMs = 2200 } = {}) {
  const el = $("inv-status");
  if (!el) return;
  const msg = String(text || "");
  el.textContent = msg;
  el.classList.remove("inv-status--info", "inv-status--ok", "inv-status--warn", "inv-status--error");
  el.classList.add(`inv-status--${kind}`);

  if (!sticky && msg) {
    setTimeout(() => {
      // limpiar solo si no cambió
      if (el.textContent === msg) {
        el.textContent = "";
        el.classList.remove("inv-status--info", "inv-status--ok", "inv-status--warn", "inv-status--error");
        el.classList.add("inv-status--info");
      }
    }, timeoutMs);
  }
}

function applyView(section) {
  const view = INV_VIEW[section];
  const cache = INV_ROW_CACHE[section];
  if (!view || !cache) return;

  const page = INV_UI.pages[section] || 1;
  const limit = INV_UI.pageSize * page;

  const defs = section === "liquids" ? LIQUIDS : (section === "bottles" ? BOTTLES : FINISHED);

  let matched = 0;
  defs.forEach((d) => {
    const row = cache.get(d.id);
    if (!row || !row.tr) return;
    matched += 1;
    row.tr.hidden = matched > limit;
  });

  const emptyEl = $(view.emptyId);
  if (emptyEl) emptyEl.hidden = matched > 0;

  const moreEl = $(view.moreId);
  if (moreEl) moreEl.hidden = matched <= limit;
}

function applyAllViews() {
  applyView("liquids");
  applyView("bottles");
  applyView("finished");
}

function wireViewControls() {
  // Solo paginación ("Cargar más"). Sin buscador.
  ["liquids", "bottles", "finished"].forEach((section) => {
    const view = INV_VIEW[section];
    if (!view) return;
    const more = $(view.moreId);
    if (!more) return;
    more.addEventListener("click", () => {
      INV_UI.pages[section] = (INV_UI.pages[section] || 1) + 1;
      applyView(section);
    });
  });
}

function tdLabel(td, label) {
  try { td.setAttribute("data-label", label); } catch (e) {}
  return td;
}

function ensureLiquidoRow(tbody, def) {
  const id = def.id;
  let row = INV_ROW_CACHE.liquids.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "liquids";
  tr.dataset.rowId = id;

  const tdNombre = tdLabel(document.createElement("td"), "Ingrediente");
  tdNombre.textContent = def.nombre;
  tr.appendChild(tdNombre);

  const tdStock = tdLabel(document.createElement("td"), "Stock actual (ml)");
  const inputStock = document.createElement("input");
  inputStock.type = "number";
  inputStock.step = "0.01";
  inputStock.min = "0";
  inputStock.dataset.id = id;
  inputStock.dataset.kind = "liquid-stock";
  markA33Num(inputStock, { defaultValue: "0", mode: "decimal" });
  tdStock.appendChild(inputStock);
  tr.appendChild(tdStock);

  const tdMax = tdLabel(document.createElement("td"), "Stock máximo (ml)");
  const inputMax = document.createElement("input");
  inputMax.type = "number";
  inputMax.step = "0.01";
  inputMax.min = "0";
  inputMax.dataset.id = id;
  inputMax.dataset.kind = "liquid-max";
  markA33Num(inputMax, { defaultValue: "0", mode: "decimal" });
  tdMax.appendChild(inputMax);
  tr.appendChild(tdMax);

  const tdPct = tdLabel(document.createElement("td"), "% restante");
  tdPct.textContent = "—";
  tr.appendChild(tdPct);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  const tdAcciones = tdLabel(document.createElement("td"), "Acciones");
  tdAcciones.className = "td-actions";
  const divAcc = document.createElement("div");
  divAcc.className = "inv-actions";

  const btnEntrada = document.createElement("button");
  btnEntrada.type = "button";
  btnEntrada.textContent = "+";
  btnEntrada.title = "Entrada";
  btnEntrada.setAttribute("aria-label", "Entrada");
  btnEntrada.className = "btn-secondary btn-mini";
  btnEntrada.dataset.action = "entrada";
  btnEntrada.dataset.id = id;
  btnEntrada.dataset.kind = "liquid";

  const btnSalida = document.createElement("button");
  btnSalida.type = "button";
  btnSalida.textContent = "−";
  btnSalida.title = "Salida";
  btnSalida.setAttribute("aria-label", "Salida");
  btnSalida.className = "btn-danger btn-mini";
  btnSalida.dataset.action = "salida";
  btnSalida.dataset.id = id;
  btnSalida.dataset.kind = "liquid";

  divAcc.appendChild(btnEntrada);
  divAcc.appendChild(btnSalida);
  tdAcciones.appendChild(divAcc);
  tr.appendChild(tdAcciones);

  tbody.appendChild(tr);

  row = { tr, inputStock, inputMax, tdPct, statusSpan };
  INV_ROW_CACHE.liquids.set(id, row);
  return row;
}

function updateLiquidoRow(inv, id) {
  const row = INV_ROW_CACHE.liquids.get(id);
  if (!row) return;

  const info = (inv && inv.liquids && inv.liquids[id]) ? inv.liquids[id] : { stock: 0, max: 0 };
  const stock = parseNumber(info.stock);
  const max = parseNumber(info.max);

  if (document.activeElement !== row.inputStock) row.inputStock.value = Number.isFinite(stock) ? stock : 0;
  if (document.activeElement !== row.inputMax) row.inputMax.value = Number.isFinite(max) ? max : 0;

  const pct = max > 0 ? (stock / max) * 100 : 0;
  row.tdPct.textContent = max > 0 ? pct.toFixed(1) + " %" : "—";

  const estado = calcularEstadoLiquido({ stock, max });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}

function ensureBottleRow(tbody, def) {
  const id = def.id;
  let row = INV_ROW_CACHE.bottles.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "bottles";
  tr.dataset.rowId = id;
	  

  const tdNombre = tdLabel(document.createElement("td"), "Presentación");
  tdNombre.textContent = def.nombre;
  tr.appendChild(tdNombre);

  const tdStock = tdLabel(document.createElement("td"), "Stock actual (unid.)");
  const inputStock = document.createElement("input");
  inputStock.type = "number";
  inputStock.step = "1";
  inputStock.min = "0";
  inputStock.dataset.id = id;
  inputStock.dataset.kind = "bottle-stock";
  markA33Num(inputStock, { defaultValue: "0", mode: "numeric" });
  tdStock.appendChild(inputStock);
  tr.appendChild(tdStock);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  const tdAcciones = tdLabel(document.createElement("td"), "Acciones");
  tdAcciones.className = "td-actions";
  const divAcc = document.createElement("div");
  divAcc.className = "inv-actions";

  const btnEntrada = document.createElement("button");
  btnEntrada.type = "button";
  btnEntrada.textContent = "+";
  btnEntrada.title = "Entrada";
  btnEntrada.setAttribute("aria-label", "Entrada");
  btnEntrada.className = "btn-secondary btn-mini";
  btnEntrada.dataset.action = "entrada";
  btnEntrada.dataset.id = id;
  btnEntrada.dataset.kind = "bottle";

  const btnSalida = document.createElement("button");
  btnSalida.type = "button";
  btnSalida.textContent = "−";
  btnSalida.title = "Salida";
  btnSalida.setAttribute("aria-label", "Salida");
  btnSalida.className = "btn-danger btn-mini";
  btnSalida.dataset.action = "salida";
  btnSalida.dataset.id = id;
  btnSalida.dataset.kind = "bottle";

  divAcc.appendChild(btnEntrada);
  divAcc.appendChild(btnSalida);
  tdAcciones.appendChild(divAcc);
  tr.appendChild(tdAcciones);

  tbody.appendChild(tr);

  row = { tr, inputStock, statusSpan };
  INV_ROW_CACHE.bottles.set(id, row);
  return row;
}

function updateBottleRow(inv, id) {
  const row = INV_ROW_CACHE.bottles.get(id);
  if (!row) return;

  const info = (inv && inv.bottles && inv.bottles[id]) ? inv.bottles[id] : { stock: 0 };
  const stock = parseNumber(info.stock);

  if (document.activeElement !== row.inputStock) row.inputStock.value = Number.isFinite(stock) ? stock : 0;

  const estado = calcularEstadoBotella({ stock });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}

function ensureFinishedRow(tbody, def) {
  const id = def.id;
  let row = INV_ROW_CACHE.finished.get(id);
  if (row && row.tr && row.tr.parentElement !== tbody) {
    tbody.appendChild(row.tr);
    return row;
  }
  if (row) return row;

  const tr = document.createElement("tr");
  tr.dataset.section = "finished";
  tr.dataset.rowId = id;
	  

  const tdNombre = tdLabel(document.createElement("td"), "Presentación");
  tdNombre.textContent = def.nombre;
  tr.appendChild(tdNombre);

  const tdStock = tdLabel(document.createElement("td"), "Stock (unid.)");
  tdStock.textContent = "0";
  tr.appendChild(tdStock);

  const tdEstado = tdLabel(document.createElement("td"), "Estado");
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-chip status-neutral";
  statusSpan.textContent = "—";
  tdEstado.appendChild(statusSpan);
  tr.appendChild(tdEstado);

  tbody.appendChild(tr);

  row = { tr, tdStock, statusSpan };
  INV_ROW_CACHE.finished.set(id, row);
  return row;
}

function updateFinishedRow(inv, id) {
  const row = INV_ROW_CACHE.finished.get(id);
  if (!row) return;

  const info = (inv && inv.finished && inv.finished[id]) ? inv.finished[id] : { stock: 0 };
  const stock = parseNumber(info.stock);

  row.tdStock.textContent = Number.isFinite(stock) ? stock.toFixed(0) : "0";

  const estado = calcularEstadoProductoTerminado({ stock });
  row.statusSpan.className = "status-chip " + estado.className;
  row.statusSpan.textContent = estado.label;
}



function loadInventario() {
  try {
    // Contrato compartido (anti-pisadas + data vieja segura)
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
      const r = A33Storage.sharedRead(STORAGE_KEY_INVENTARIO, defaultInventario(), 'local');
      const data = (r && r.data && typeof r.data === 'object') ? r.data : defaultInventario();
      const meta = (r && r.meta && typeof r.meta === 'object') ? r.meta : { rev:0, updatedAt:null, writer:'' };
      trackInventarioBase(data, meta);
      return data;
    }
    if (window.A33Storage && typeof A33Storage.sharedGet === 'function'){
      const data = A33Storage.sharedGet(STORAGE_KEY_INVENTARIO, defaultInventario());
      if (data && typeof data === 'object') return data;
      return defaultInventario();
    }

    // Fallback legacy
    const raw = A33Storage.getItem(STORAGE_KEY_INVENTARIO);
    let data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object") data = defaultInventario();

    if (!data.liquids) data.liquids = {};
    if (!data.bottles) data.bottles = {};
    if (!data.finished) data.finished = {};

    LIQUIDS.forEach((l) => {
      if (!data.liquids[l.id]) data.liquids[l.id] = { stock: 0, max: 0 };
      if (typeof data.liquids[l.id].stock !== "number") data.liquids[l.id].stock = parseNumber(data.liquids[l.id].stock || 0);
      if (typeof data.liquids[l.id].max !== "number") data.liquids[l.id].max = parseNumber(data.liquids[l.id].max || 0);
    });
    BOTTLES.forEach((b) => {
      if (!data.bottles[b.id]) data.bottles[b.id] = { stock: 0 };
      if (typeof data.bottles[b.id].stock !== "number") data.bottles[b.id].stock = parseNumber(data.bottles[b.id].stock || 0);
    });
    FINISHED.forEach((p) => {
      if (!data.finished[p.id]) data.finished[p.id] = { stock: 0 };
      if (typeof data.finished[p.id].stock !== "number") data.finished[p.id].stock = parseNumber(data.finished[p.id].stock || 0);
    });

    return data;
  } catch (e) {
    console.error("Error leyendo inventario", e);
    safeAlert('Error leyendo inventario. Se cargó un inventario por defecto para evitar corrupción.');
    return defaultInventario();
  }
}

function saveInventario(inv) {
  // Validaciones duras antes de persistir
  const v = validateBeforeSave(inv);
  if (!v.ok){
    safeAlert(v.message);
    return false;
  }

  try{
    if (window.A33Storage && typeof A33Storage.sharedRead === 'function'){
      const r = sharedCommitInventarioConservative(inv);
      if (!r || !r.ok){
        safeAlert((r && r.message) ? r.message : 'No se pudo guardar el inventario.');
        return false;
      }
      // Sincronizar objeto en memoria con lo realmente guardado (incluye cambios de otros módulos)
      if (r.data && typeof r.data === 'object'){
        inv.liquids = r.data.liquids;
        inv.bottles = r.data.bottles;
        inv.finished = r.data.finished;
      }
      return true;
    }
    if (window.A33Storage && typeof A33Storage.sharedSet === 'function'){
      const r = A33Storage.sharedSet(STORAGE_KEY_INVENTARIO, inv, { source: 'inventario' });
      if (r && r.ok === false){
        safeAlert(r.message || 'No se pudo guardar el inventario.');
        return false;
      }
      // track base best-effort
      try{ trackInventarioBase(inv, A33Storage.sharedGetMeta ? A33Storage.sharedGetMeta(STORAGE_KEY_INVENTARIO, 'local') : { rev:0, updatedAt:null, writer:'' }); }catch(_){ }
      return true;
    }
  }catch(err){
    console.error('Error guardando inventario (sharedSet)', err);
    safeAlert('No se pudo guardar el inventario (error de storage).');
    return false;
  }

  // Fallback legacy
  try{
    const ok = A33Storage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(inv));
    if (!ok) safeAlert('No se pudo guardar el inventario (storage lleno o bloqueado).');
    return !!ok;
  }catch(err){
    console.error('Error guardando inventario (legacy)', err);
    safeAlert('No se pudo guardar el inventario (error de storage).');
    return false;
  }
}

function calcularEstadoLiquido(liq) {
  const stock = parseNumber(liq.stock);
  const max = parseNumber(liq.max);
  if (max <= 0) {
    if (stock <= 0) {
      return { label: "Sin stock", className: "status-neutral" };
    }
    return { label: "Sin máximo definido", className: "status-neutral" };
  }
  const pct = (stock / max) * 100;
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (pct <= 20) {
    return { label: `Bajo (${pct.toFixed(1)}%)`, className: "status-warn" };
  }
  return { label: `OK (${pct.toFixed(1)}%)`, className: "status-ok" };
}

function calcularEstadoBotella(b) {
  const stock = parseNumber(b.stock);
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (stock <= 10) {
    return { label: `Bajo (${stock} unid.)`, className: "status-warn" };
  }
  return { label: `OK (${stock} unid.)`, className: "status-ok" };
}

function renderLiquidos(inv) {
  const tbody = $("inv-liquidos-body");
  if (!tbody) return;

  LIQUIDS.forEach((l) => {
    ensureLiquidoRow(tbody, l);
    // setear valores
    updateLiquidoRow(inv, l.id);
  });

  applyView("liquids");
}



function renderBotellas(inv) {
  const tbody = $("inv-botellas-body");
  if (!tbody) return;

  BOTTLES.forEach((b) => {
    ensureBottleRow(tbody, b);
    updateBottleRow(inv, b.id);
  });

  applyView("bottles");
}



function attachListeners(inv) {
  const liquidosBody = $("inv-liquidos-body");
  const botellasBody = $("inv-botellas-body");

  const commitSave = (section, id) => {
    setStatus("Guardando…", "info", { sticky: true });
    const ok = saveInventario(inv);
    if (!ok) {
      setStatus("Error al guardar. Se recargó el inventario.", "error", { sticky: true });
      const fresh = loadInventario();
      inv.liquids = fresh.liquids;
      inv.bottles = fresh.bottles;
      inv.finished = fresh.finished;
      renderLiquidos(inv);
      renderBotellas(inv);
      renderProductosTerminados(inv);
      applyAllViews();
      return false;
    }
    setStatus("Guardado.", "ok", { timeoutMs: 900 });
    if (section === "liquids") updateLiquidoRow(inv, id);
    if (section === "bottles") updateBottleRow(inv, id);
    if (section === "finished") updateFinishedRow(inv, id);
    applyView(section);
    return true;
  };

  const scheduleSave = debounce((section, id) => commitSave(section, id), 220);

  if (liquidosBody) {
    liquidosBody.addEventListener("change", (e) => {
      const target = e.target;
      if (!target.dataset || !target.dataset.kind) return;
      const id = target.dataset.id;
      const kind = target.dataset.kind;

      if (!inv.liquids || !inv.liquids[id]) {
        safeAlert(`Inventario inválido: no existe el ítem "${id}".`);
        updateLiquidoRow(inv, id);
        return;
      }

      if (kind === "liquid-stock") {
        const n = toNonNegativeNumber(target.value);
        if (!Number.isFinite(n)) {
          safeAlert("Cantidad inválida: debe ser un número real >= 0.");
          updateLiquidoRow(inv, id);
          return;
        }
        inv.liquids[id].stock = n;
        updateLiquidoRow(inv, id);
        scheduleSave("liquids", id);
      }

      if (kind === "liquid-max") {
        const n = toNonNegativeNumber(target.value);
        if (!Number.isFinite(n)) {
          safeAlert("Máximo inválido: debe ser un número real >= 0.");
          updateLiquidoRow(inv, id);
          return;
        }
        inv.liquids[id].max = n;
        updateLiquidoRow(inv, id);
        scheduleSave("liquids", id);
      }
    });

    liquidosBody.addEventListener("click", handleAccion);
  }

  if (botellasBody) {
    botellasBody.addEventListener("change", (e) => {
      const target = e.target;
      if (!target.dataset || !target.dataset.kind) return;
      const id = target.dataset.id;
      const kind = target.dataset.kind;

      if (!inv.bottles || !inv.bottles[id]) {
        safeAlert(`Inventario inválido: no existe el ítem "${id}".`);
        updateBottleRow(inv, id);
        return;
      }

      if (kind === "bottle-stock") {
        const n = toNonNegativeInt(target.value);
        if (!Number.isFinite(n)) {
          safeAlert("Cantidad inválida: debe ser un entero >= 0.");
          updateBottleRow(inv, id);
          return;
        }
        inv.bottles[id].stock = n;
        updateBottleRow(inv, id);
        scheduleSave("bottles", id);
      }
    });

    botellasBody.addEventListener("click", handleAccion);
  }

  function handleAccion(e) {
    const target = e.target;
    if (!target.dataset || !target.dataset.action) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const kind = target.dataset.kind;

    const etiqueta = kind === "liquid" ? "ml" : "unidades";
    const msg =
      action === "entrada"
        ? `Cantidad de ${etiqueta} para ENTRADA en ${id}:`
        : `Cantidad de ${etiqueta} para SALIDA en ${id}:`;

    const valStr = window.prompt(msg);
    if (valStr == null) return;

    const cantidad = (kind === "bottle") ? toNonNegativeInt(valStr) : toNonNegativeNumber(valStr);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      safeAlert("Cantidad inválida: debe ser un número real > 0 (y entero para botellas).");
      return;
    }

    if (kind === "liquid") {
      const item = inv.liquids[id] || { stock: 0, max: 0 };
      if (action === "entrada") {
        item.stock = parseNumber(item.stock) + cantidad;
      } else {
        const next = parseNumber(item.stock) - cantidad;
        if (next < 0) {
          safeAlert(`Operación bloqueada: la salida dejaría el stock de ${id} en negativo.`);
          return;
        }
        item.stock = next;
      }
      inv.liquids[id] = item;
      updateLiquidoRow(inv, id);
      commitSave("liquids", id);
      return;
    }

    if (kind === "bottle") {
      const item = inv.bottles[id] || { stock: 0 };
      if (action === "entrada") {
        item.stock = parseNumber(item.stock) + cantidad;
      } else {
        const next = parseNumber(item.stock) - cantidad;
        if (next < 0) {
          safeAlert(`Operación bloqueada: la salida dejaría el stock de ${id} en negativo.`);
          return;
        }
        item.stock = next;
      }
      item.stock = Math.trunc(item.stock);
      inv.bottles[id] = item;
      updateBottleRow(inv, id);
      commitSave("bottles", id);
      return;
    }
  }
}



function buildAlertLines(inv) {
  const lines = [];

  // Líquidos en alerta (<=20% del máximo definido)
  LIQUIDS.forEach((l) => {
    const info = inv.liquids[l.id] || { stock: 0, max: 0 };
    const stock = parseNumber(info.stock);
    const max = parseNumber(info.max);
    if (max > 0) {
      const pct = (stock / max) * 100;
      if (pct <= 20) {
        lines.push(`• ${l.nombre}: ${stock.toFixed(0)} ml (${pct.toFixed(1)}% restante)`);
      }
    }
  });

  // Botellas en alerta (<=10 unidades)
  BOTTLES.forEach((b) => {
    const info = inv.bottles[b.id] || { stock: 0 };
    const stock = parseNumber(info.stock);
    if (stock <= 10) {
      lines.push(`• ${b.nombre}: ${stock.toFixed(0)} botellas`);
    }
  });

  // Producto terminado en alerta (<=10 unidades)
  FINISHED.forEach((p) => {
    const info = (inv.finished && inv.finished[p.id]) || { stock: 0 };
    const stock = parseNumber(info.stock);
    if (stock <= 10) {
      lines.push(`• ${p.nombre}: ${stock.toFixed(0)} botellas listas`);
    }
  });

  return lines;
}


function calcularEstadoProductoTerminado(item) {
  const stock = parseNumber(item.stock);
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (stock <= 10) {
    return { label: `Bajo (${stock} unid.)`, className: "status-warn" };
  }
  return { label: `OK (${stock} unid.)`, className: "status-ok" };
}

function renderProductosTerminados(inv) {
  const tbody = $("inv-productos-body");
  if (!tbody) return;

  FINISHED.forEach((pDef) => {
		ensureFinishedRow(tbody, pDef);
    updateFinishedRow(inv, pDef.id);
  });

  applyView("finished");
}





function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js?v=4.20.13")
      .catch((err) => console.error("SW error", err));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setStatus("Cargando…", "info", { sticky: true });

  const inv = loadInventario();

  renderLiquidos(inv);
  renderBotellas(inv);
  renderProductosTerminados(inv);

  wireViewControls();
  attachListeners(inv);
  applyAllViews();
  // Si no hubo alertas, dejar señal corta de listo
  const statusEl = $("inv-status");
  if (statusEl && !statusEl.textContent) {
    setStatus("Listo.", "ok", { timeoutMs: 900 });
  }

  registerServiceWorker();
});

