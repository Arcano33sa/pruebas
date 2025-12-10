// --- IndexedDB helpers POS
const DB_NAME = 'a33-pos';
const DB_VER = 20; // schema estable
let db;

// --- Finanzas: conexión a finanzasDB para asientos automáticos
const FIN_DB_NAME = 'finanzasDB';
const FIN_DB_VER = 1;
let finDb;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('products')) {
        const os = d.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_name', 'name', { unique: true });
      }
      if (!d.objectStoreNames.contains('events')) {
        const os2 = d.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        os2.createIndex('by_name', 'name', { unique: true });
      }
      if (!d.objectStoreNames.contains('sales')) {
        const os3 = d.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
        os3.createIndex('by_date', 'date', { unique: false });
        os3.createIndex('by_event', 'eventId', { unique: false });
      } else {
        try { e.target.transaction.objectStore('sales').createIndex('by_date','date'); } catch {}
        try { e.target.transaction.objectStore('sales').createIndex('by_event','eventId'); } catch {}
      }
      if (!d.objectStoreNames.contains('inventory')) {
        const inv = d.createObjectStore('inventory', { keyPath: 'id', autoIncrement: true });
        inv.createIndex('by_event', 'eventId', { unique: false });
      } else {
        try { e.target.transaction.objectStore('inventory').createIndex('by_event','eventId'); } catch {}
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('pettyCash')) {
        d.createObjectStore('pettyCash', { keyPath: 'eventId' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// --- Finanzas: helpers para abrir finanzasDB y crear/borrar asientos
function openFinanzasDB() {
  return new Promise((resolve, reject) => {
    if (finDb) return resolve(finDb);
    const req = indexedDB.open(FIN_DB_NAME, FIN_DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('accounts')) {
        const accStore = d.createObjectStore('accounts', { keyPath: 'code' });
        accStore.createIndex('type', 'type', { unique: false });
      }
      if (!d.objectStoreNames.contains('journalEntries')) {
        const entriesStore = d.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
        entriesStore.createIndex('date', 'date', { unique: false });
        entriesStore.createIndex('tipoMovimiento', 'tipoMovimiento', { unique: false });
        entriesStore.createIndex('evento', 'evento', { unique: false });
        entriesStore.createIndex('origen', 'origen', { unique: false });
      } else {
        const entriesStore = e.target.transaction.objectStore('journalEntries');
        try { entriesStore.createIndex('date', 'date', { unique: false }); } catch(e){}
        try { entriesStore.createIndex('tipoMovimiento', 'tipoMovimiento', { unique: false }); } catch(e){}
        try { entriesStore.createIndex('evento', 'evento', { unique: false }); } catch(e){}
        try { entriesStore.createIndex('origen', 'origen', { unique: false }); } catch(e){}
      }
    };
    req.onsuccess = () => { finDb = req.result; resolve(finDb); };
    req.onerror = () => reject(req.error);
  });
}

function finTx(name, mode='readonly'){ return finDb.transaction(name, mode).objectStore(name); }

function finPut(osName, val){
  return new Promise((resolve, reject)=>{
    try{
      const store = finTx(osName,'readwrite');
      const r = store.put(val);
      r.onsuccess = ()=>resolve(r.result);
      r.onerror = ()=>reject(r.error);
    }catch(e){
      console.error('Error en finPut', e);
      reject(e);
    }
  });
}
function finGetAll(osName){
  return new Promise((resolve, reject)=>{
    try{
      const store = finTx(osName,'readonly');
      const r = store.getAll();
      r.onsuccess = ()=>resolve(r.result||[]);
      r.onerror = ()=>reject(r.error);
    }catch(e){
      console.error('Error en finGetAll', e);
      reject(e);
    }
  });
}
function finDelete(osName, key){
  return new Promise((resolve, reject)=>{
    try{
      const store = finTx(osName,'readwrite');
      const r = store.delete(key);
      r.onsuccess = ()=>resolve();
      r.onerror = ()=>reject(r.error);
    }catch(e){
      console.error('Error en finDelete', e);
      reject(e);
    }
  });
}

async function ensureFinanzasDB() {
  try {
    await openFinanzasDB();
  } catch (e) {
    console.error('No se pudo abrir finanzasDB para asientos automáticos', e);
    throw e;
  }
}

// Mapea forma de pago del POS a cuenta contable
function mapSaleToCuentaCobro(sale) {
  const pay = sale.payment || 'efectivo';
  if (pay === 'efectivo') return '1100';   // Caja
  if (pay === 'transferencia') return '1200'; // Banco
  if (pay === 'credito') return '1300';    // Clientes
  return '1200'; // Otros métodos similares a banco
}

// Crea/actualiza asiento automático en Finanzas por una venta / devolución del POS
async function createJournalEntryForSalePOS(sale) {
  try {
    if (!sale) return;
    // Cortesías: por ahora NO se contabilizan ingresos ni costo de venta
    if (sale.courtesy) return;

    await ensureFinanzasDB();

    const saleId = sale.id != null ? sale.id : null;

    // Importe de ingreso (venta neta)
    const amount = Math.abs(Number(sale.total)||0);
    if (!amount) return;

    const fecha = sale.date || new Date().toISOString().slice(0,10);
    const evento = sale.eventName || (sale.eventId != null ? `Evento ${sale.eventId}` : 'POS');
    const tipoMovimiento = 'venta-pos';
    const origen = 'A33 POS';

    const cuentaVentas = '4100'; // Ingresos por Ventas
    const cuentaCobro = mapSaleToCuentaCobro(sale);

    const entries = await finGetAll('journalEntries');
    const existing = entries.find(e=> e.origenId === saleId && e.tipoMovimiento === tipoMovimiento);
    const entry = existing || { id: undefined };

    entry.date = fecha;
    entry.tipoMovimiento = tipoMovimiento;
    entry.evento = evento;
    entry.origen = origen;
    entry.origenId = saleId;
    entry.details = [
      { account: cuentaCobro, type: 'debit', amount },
      { account: cuentaVentas, type: 'credit', amount }
    ];

    const id = await finPut('journalEntries', entry);
    entry.id = id;
  } catch (e) {
    console.error('Error creando asiento automático para venta POS', e);
  }
}

// Elimina asiento automático vinculado a una venta POS
async function deleteFinanzasEntriesForSalePOS(saleId){
  try{
    await ensureFinanzasDB();
  }catch(e){
    console.error('No se puede abrir finanzasDB para borrar asientos de venta POS', e);
    return;
  }
  try{
    const all = await finGetAll('journalEntries');
    const toDelete = all.filter(x=>x.origenId===saleId && x.tipoMovimiento==='venta-pos');
    for (const row of toDelete){
      await finDelete('journalEntries', row.id);
    }
  }catch(e){
    console.error('Error borrando asientos contables para venta POS', e);
  }
}

// --- Inventario central: helper para actualizar uso de insumos por venta POS ---
// Esta función fue pensada para conectar POS con inventario de producto terminado
// a nivel central. Aquí asumimos que sale tiene products con quantity y que
// existe inventario central en otro módulo.
function applyFinishedFromSalePOS(sale, factor=1){
  try{
    if (!sale || !sale.items) return;
    // Aquí se podría sumar/restar inventario central, pero por ahora solo se deja el hook.
  }catch(e){
    console.error('Error en applyFinishedFromSalePOS', e);
  }
}

function tx(name, mode='readonly'){ return db.transaction(name, mode).objectStore(name); }
function getAll(name){ return new Promise((res,rej)=>{ const r=tx(name).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
function put(name, val){ return new Promise((res,rej)=>{ const r=tx(name,'readwrite').put(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function del(name, key){ 
  return new Promise((resolve, reject)=>{ 
    if (name === 'sales'){
      try{
        const store = tx('sales','readwrite');
        const getReq = store.get(key);
        getReq.onsuccess = ()=>{
          const sale = getReq.result;
          let finPromise = Promise.resolve();

          if (sale){
            try{
              applyFinishedFromSalePOS(sale, -1); // revertir efecto de la venta en inventario central
            }catch(e){
              console.error('Error revertiendo inventario central al eliminar venta', e);
            }

            const saleId = (sale.id != null) ? sale.id : key;
            finPromise = deleteFinanzasEntriesForSalePOS(saleId).catch(err=>{
              console.error('Error eliminando asientos contables vinculados a la venta', err);
            });
          }

          finPromise.then(()=>{
            const delReq = store.delete(key);
            delReq.onsuccess = ()=>resolve();
            delReq.onerror = ()=>reject(delReq.error);
          });
        };
        getReq.onerror = ()=>{
          const delReq = store.delete(key);
          delReq.onsuccess = ()=>resolve();
          delReq.onerror = ()=>reject(delReq.error);
        };
      }catch(e){
        console.error('Error en del(sales,key)', e);
        resolve();
      }
    } else {
      const store = tx(name,'readwrite');
      const r = store.delete(key);
      r.onsuccess = ()=>resolve();
      r.onerror = ()=>reject(r.error);
    }
  });
}

// --- Caja Chica: helpers y denominaciones
const NIO_DENOMS = [1,5,10,20,50,100,200,1000];
const USD_DENOMS = [1,5,10,20,50,100];

function normalizePettySection(section){
  const nio = {};
  const usd = {};

  NIO_DENOMS.forEach(d=>{
    const k = String(d);
    const v = section && section.nio && section.nio[k];
    const num = Number(v);
    nio[k] = (!Number.isFinite(num) || num < 0) ? 0 : num;
  });

  USD_DENOMS.forEach(d=>{
    const k = String(d);
    const v = section && section.usd && section.usd[k];
    const num = Number(v);
    usd[k] = (!Number.isFinite(num) || num < 0) ? 0 : num;
  });

  const totalNio = NIO_DENOMS.reduce((sum,d)=> sum + d * (nio[String(d)]||0), 0);
  const totalUsd = USD_DENOMS.reduce((sum,d)=> sum + d * (usd[String(d)]||0), 0);

  return {
    nio,
    usd,
    totalNio,
    totalUsd,
    savedAt: section && section.savedAt ? section.savedAt : null
  };
}

async function getPettyCash(eventId){
  if (eventId == null) return null;
  if (!db) await openDB();

  return new Promise((resolve, reject)=>{
    try{
      const store = tx('pettyCash','readonly');
      const req = store.get(eventId);
      req.onsuccess = ()=>{
        let pc = req.result;
        if (!pc){
          pc = {
            eventId,
            initial: normalizePettySection(null),
            movements: [],
            finalCount: null
          };
        } else {
          pc.initial = normalizePettySection(pc.initial);
          if (!Array.isArray(pc.movements)) pc.movements = [];
          pc.finalCount = pc.finalCount ? normalizePettySection(pc.finalCount) : null;
        }
        resolve(pc);
      };
      req.onerror = ()=>reject(req.error);
    }catch(err){
      console.error('Error getPettyCash', err);
      resolve({
        eventId,
        initial: normalizePettySection(null),
        movements: [],
        finalCount: null
      });
    }
  });
}

async function savePettyCash(pc){
  if (!pc || pc.eventId == null) return;
  if (!db) await openDB();

  return new Promise((resolve, reject)=>{
    try{
      const store = tx('pettyCash','readwrite');
      const cleaned = {
        eventId: pc.eventId,
        initial: pc.initial ? normalizePettySection(pc.initial) : normalizePettySection(null),
        movements: Array.isArray(pc.movements) ? pc.movements.slice() : [],
        finalCount: pc.finalCount ? normalizePettySection(pc.finalCount) : null
      };
      const req = store.put(cleaned);
      req.onsuccess = ()=>resolve();
      req.onerror = ()=>reject(req.error);
    }catch(err){
      console.error('Error savePettyCash', err);
      resolve();
    }
  });
}

function computePettyCashSummary(pc){
  const base = {
    nio: { initial:0, entradas:0, salidas:0, teorico:0, final:null, diferencia:null },
    usd: { initial:0, entradas:0, salidas:0, teorico:0, final:null, diferencia:null }
  };
  if (!pc) return base;

  const initial = pc.initial ? normalizePettySection(pc.initial) : normalizePettySection(null);
  const finalCount = pc.finalCount ? normalizePettySection(pc.finalCount) : null;

  const res = {
    nio: {
      initial: initial.totalNio || 0,
      entradas: 0,
      salidas: 0,
      teorico: 0,
      final: finalCount ? (finalCount.totalNio || 0) : null,
      diferencia: null
    },
    usd: {
      initial: initial.totalUsd || 0,
      entradas: 0,
      salidas: 0,
      teorico: 0,
      final: finalCount ? (finalCount.totalUsd || 0) : null,
      diferencia: null
    }
  };

  if (Array.isArray(pc.movements)){
    for (const m of pc.movements){
      if (!m || typeof m.amount === 'undefined') continue;
      const amt = Number(m.amount) || 0;
      if (!amt) continue;

      const isNio = m.currency === 'NIO';
      const isUsd = m.currency === 'USD';
      if (!isNio && !isUsd) continue;

      const target = isNio ? res.nio : res.usd;
      if (m.type === 'entrada') target.entradas += amt;
      else if (m.type === 'salida') target.salidas += amt;
    }
  }

  res.nio.teorico = res.nio.initial + res.nio.entradas - res.nio.salidas;
  res.usd.teorico = res.usd.initial + res.usd.entradas - res.usd.salidas;

  if (res.nio.final != null){
    res.nio.diferencia = res.nio.final - res.nio.teorico;
  }
  if (res.usd.final != null){
    res.usd.diferencia = res.usd.final - res.usd.teorico;
  }

  return res;
}

async function setMeta(key, value){ return put('meta', {id:key, value}); }
async function getMeta(key){
  const all = await getAll('meta');
  const row = all.find(x=>x.id===key);
  return row ? row.value : null;
}

// Normalizar nombres
function normName(s){ return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

const RECETAS_KEY = 'arcano33_recetas_v1';

const STORAGE_KEY_INVENTARIO = 'arcano33_inventario';

function invParseNumberPOS(value){
  const n = parseFloat(String(value).replace(',','.'));
  return Number.isFinite(n) ? n : 0;
}

// --- UI helpers
function $(sel){ return document.querySelector(sel); }
function $$(sel){ return Array.from(document.querySelectorAll(sel)); }

// --- Estado global POS
let productos = [];
let eventos = [];
let ventas = [];
let inventarioMovs = [];
let inventarioCache = [];
let currentEventId = null;

// --- Carga inicial
async function init(){
  await openDB();
  await loadAllData();
  bindPOSUI();
  setTab('venta');
}

// Carga productos, eventos, ventas, inventario y meta
async function loadAllData(){
  productos = await getAll('products');
  eventos = await getAll('events');
  ventas = await getAll('sales');
  inventarioMovs = await getAll('inventory');
  currentEventId = await getMeta('currentEventId');
  rebuildInventarioCache();
  renderProductsSelect();
  renderEventosList();
  refreshEventUI();
  renderVentasResumen();
}

// --- Inventario cacheado por evento y producto
function rebuildInventarioCache(){
  const cache = {};
  for (const mov of inventarioMovs){
    const key = `${mov.eventId||'global'}|${mov.productId||'?'}`;
    if (!cache[key]) cache[key] = { eventId: mov.eventId||null, productId: mov.productId||null, quantity:0 };
    cache[key].quantity += invParseNumberPOS(mov.quantity||0) * (mov.type==='entrada' ? 1 : -1);
  }
  inventarioCache = Object.values(cache);
}

// --- Tabs
function setTab(name){
  $$('.tab').forEach(el=> el.style.display='none');
  const target = document.getElementById('tab-'+name);
  if (target) target.style.display='block';
  $$('.tabbar button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`.tabbar button[data-tab="${name}"]`);
  if (btn) btn.classList.add('active');
  if (name==='resumen') renderVentasResumen();
  if (name==='productos') renderProductsTable();
  if (name==='eventos') renderEventosList();
  if (name==='inventario') renderInventarioTabla();
}

// --- Event UI (evento activo, select de evento, etc.)
async function refreshEventUI(){
  const sel = $('#sale-event');
  const evs = eventos.slice().sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  const cur = currentEventId;

  sel.innerHTML = '<option value="">— Selecciona evento —</option>';
  for (const ev of evs){
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = ev.name + (ev.closedAt ? ' (cerrado)' : '');
    sel.appendChild(opt);
  }
  if (cur) sel.value = cur;
  else sel.value = '';

  const status = $('#event-status');
  const evCur = evs.find(e=> cur && e.id == cur);
  if (evCur && evCur.closedAt) {
    status.style.display='block';
    status.textContent = `Evento cerrado el ${new Date(evCur.closedAt).toLocaleString()}. Puedes reabrirlo o crear/activar otro.`;
  } else {
    status.style.display='none';
  }
  $('#btn-reopen-event').style.display = (evCur && evCur.closedAt) ? 'inline-block' : 'none';

  const invSel = $('#inv-event');
  if (invSel){
    invSel.innerHTML = '<option value="">Todos</option>';
    for (const ev of evs){
      const opt = document.createElement('option');
      opt.value = ev.id;
      opt.textContent = ev.name;
      invSel.appendChild(opt);
    }
  }

  $('#current-event-label').textContent = evCur ? evCur.name : 'Sin evento activo';
}

// --- Binding de UI principal
function bindPOSUI(){
  $$('.tabbar button').forEach(btn=>{
    btn.addEventListener('click', ()=> setTab(btn.dataset.tab));
  });

  // Productos
  const formProd = $('#form-producto');
  if (formProd){
    formProd.addEventListener('submit', onAddProducto);
  }
  $('#product-search')?.addEventListener('input', renderProductsTable);

  // Eventos
  $('#form-evento')?.addEventListener('submit', onAddEvento);
  $('#btn-reopen-event')?.addEventListener('click', onReopenEvento);
  $('#event-search')?.addEventListener('input', renderEventosList);

  // Ventas
  $('#sale-event')?.addEventListener('change', onChangeSaleEvent);
  $('#sale-product')?.addEventListener('change', onChangeSaleProduct);
  $('#sale-qty')?.addEventListener('input', recomputeTotal);
  $('#sale-price')?.addEventListener('input', recomputeTotal);
  $('#sale-add-item')?.addEventListener('click', onAddItemToSale);
  $('#sale-finish')?.addEventListener('click', onFinishSale);
  $('#sale-clear')?.addEventListener('click', clearVentaActual);
  $('#sale-payment')?.addEventListener('change', e=>{
    ventaActual.payment = e.target.value;
  });

  // Inventario
  $('#form-inventario')?.addEventListener('submit', onAddInventarioMov);
  $('#inv-event')?.addEventListener('change', renderInventarioTabla);
}

// --- Normalizar nombres
function normText(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

// --- Productos
let ventaActual = {
  items: [],
  total: 0,
  payment: 'efectivo'
};

function renderProductsSelect(){
  const sel = $('#sale-product');
  if (!sel) return;
  sel.innerHTML = '';
  productos.forEach(p=>{
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (C$ ${Number(p.price||0).toFixed(2)})`;
    sel.appendChild(opt);
  });
  if (productos.length){
    sel.value = productos[0].id;
    $('#sale-price').value = Number(productos[0].price||0).toFixed(2);
  }
}

function renderProductsTable(){
  const tbody = $('#products-tbody');
  if (!tbody) return;
  const term = normText($('#product-search')?.value||'');
  tbody.innerHTML = '';
  productos
    .filter(p=> !term || normText(p.name).includes(term))
    .forEach(p=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>C$ ${Number(p.price||0).toFixed(2)}</td>
        <td>${p.category||''}</td>
      `;
      tbody.appendChild(tr);
    });
}

async function onAddProducto(ev){
  ev.preventDefault();
  const name = $('#product-name').value.trim();
  const price = invParseNumberPOS($('#product-price').value);
  const category = $('#product-category').value.trim() || 'General';

  if (!name || !price){
    alert('Nombre y precio son obligatorios');
    return;
  }

  const exists = productos.some(p=> normText(p.name)===normText(name));
  if (exists){
    alert('Ya existe un producto con ese nombre');
    return;
  }

  const prod = { name, price, category };
  const id = await put('products', prod);
  prod.id = id;
  productos.push(prod);
  $('#product-name').value = '';
  $('#product-price').value = '';
  $('#product-category').value = '';
  renderProductsSelect();
  renderProductsTable();
}

// --- Eventos
async function onAddEvento(ev){
  ev.preventDefault();
  const name = $('#event-name').value.trim();
  const date = $('#event-date').value || new Date().toISOString().slice(0,10);
  const location = $('#event-location').value.trim();
  const notes = $('#event-notes').value.trim();
  if (!name){
    alert('Nombre del evento obligatorio');
    return;
  }
  const evObj = { name, date, location, notes, closedAt:null };
  const id = await put('events', evObj);
  evObj.id = id;
  eventos.push(evObj);
  $('#event-name').value = '';
  $('#event-date').value = '';
  $('#event-location').value = '';
  $('#event-notes').value = '';
  renderEventosList();
  refreshEventUI();
}

function renderEventosList(){
  const tbody = $('#events-tbody');
  if (!tbody) return;
  const term = normText($('#event-search')?.value||'');
  tbody.innerHTML = '';
  const list = eventos
    .filter(e=> !term || normText(e.name).includes(term))
    .sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  for (const ev of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ev.name}</td>
      <td>${ev.date||''}</td>
      <td>${ev.location||''}</td>
      <td>${ev.closedAt ? 'Cerrado' : 'Abierto'}</td>
      <td>
        <button class="btn-small" data-action="activar" data-id="${ev.id}">Activar</button>
        ${ev.closedAt ? `<button class="btn-small" data-action="reabrir" data-id="${ev.id}">Reabrir</button>` : `<button class="btn-small" data-action="cerrar" data-id="${ev.id}">Cerrar</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('button[data-action]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = parseInt(btn.dataset.id,10);
      const action = btn.dataset.action;
      const ev = eventos.find(x=>x.id===id);
      if (!ev) return;

      if (action==='activar'){
        currentEventId = id;
        await setMeta('currentEventId', id);
        refreshEventUI();
        alert('Evento activado para ventas');
      } else if (action==='cerrar'){
        if (!confirm('¿Cerrar este evento?')) return;
        ev.closedAt = new Date().toISOString();
        await put('events', ev);
        renderEventosList();
        refreshEventUI();
      } else if (action==='reabrir'){
        ev.closedAt = null;
        await put('events', ev);
        renderEventosList();
        refreshEventUI();
      }
    });
  });
}

async function onReopenEvento(){
  if (!currentEventId) return;
  const ev = eventos.find(e=>e.id===currentEventId);
  if (!ev) return;
  ev.closedAt = null;
  await put('events', ev);
  renderEventosList();
  refreshEventUI();
}

async function onChangeSaleEvent(e){
  const val = e.target.value;
  currentEventId = val ? parseInt(val,10) : null;
  await setMeta('currentEventId', currentEventId);
  refreshEventUI();
}

// --- Ventas
function onChangeSaleProduct(){
  const prodId = parseInt($('#sale-product').value||'0',10);
  const prod = productos.find(p=>p.id===prodId);
  if (prod){
    $('#sale-price').value = Number(prod.price||0).toFixed(2);
  }
  recomputeTotal();
}

function recomputeTotal(){
  const qty = invParseNumberPOS($('#sale-qty').value);
  const price = invParseNumberPOS($('#sale-price').value);
  const total = qty * price;
  $('#sale-total').textContent = `Total: C$ ${total.toFixed(2)}`;
}

function clearVentaActual(){
  ventaActual.items = [];
  ventaActual.total = 0;
  ventaActual.payment = $('#sale-payment')?.value || 'efectivo';
  $('#sale-qty').value = '';
  $('#sale-notes').value = '';
  $('#sale-items-tbody').innerHTML = '';
  $('#sale-total').textContent = 'Total: C$ 0.00';
}

function onAddItemToSale(){
  const prodId = parseInt($('#sale-product').value||'0',10);
  const qty = invParseNumberPOS($('#sale-qty').value);
  const price = invParseNumberPOS($('#sale-price').value);
  if (!prodId || !qty || !price){
    alert('Producto, cantidad y precio son obligatorios');
    return;
  }
  const prod = productos.find(p=>p.id===prodId);
  if (!prod){
    alert('Producto no encontrado');
    return;
  }
  const existing = ventaActual.items.find(it=>it.productId===prodId && it.price===price);
  if (existing){
    existing.quantity += qty;
  } else {
    ventaActual.items.push({
      productId: prodId,
      name: prod.name,
      price,
      quantity: qty
    });
  }
  renderVentaActualItems();
  $('#sale-qty').value = '';
  recomputeTotal();
}

function renderVentaActualItems(){
  const tbody = $('#sale-items-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let total = 0;
  ventaActual.items.forEach((it, idx)=>{
    const subtotal = it.price * it.quantity;
    total += subtotal;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${it.name}</td>
      <td>${it.quantity}</td>
      <td>C$ ${it.price.toFixed(2)}</td>
      <td>C$ ${subtotal.toFixed(2)}</td>
      <td><button class="btn-small btn-danger" data-idx="${idx}">X</button></td>
    `;
    tbody.appendChild(tr);
  });
  ventaActual.total = total;
  $('#sale-total').textContent = `Total: C$ ${total.toFixed(2)}`;

  tbody.querySelectorAll('button[data-idx]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = parseInt(btn.dataset.idx,10);
      ventaActual.items.splice(idx,1);
      renderVentaActualItems();
    });
  });
}

async function onFinishSale(){
  if (!currentEventId){
    alert('Debes seleccionar un evento para registrar ventas');
    return;
  }
  if (!ventaActual.items.length){
    alert('No hay items en la venta');
    return;
  }

  const date = new Date().toISOString().slice(0,10);
  const notes = $('#sale-notes').value.trim();
  const payment = $('#sale-payment').value || 'efectivo';

  const sale = {
    date,
    eventId: currentEventId,
    items: ventaActual.items.map(it=>({
      productId: it.productId,
      name: it.name,
      price: it.price,
      quantity: it.quantity
    })),
    total: ventaActual.total,
    payment,
    notes,
    courtesy: false
  };

  const id = await put('sales', sale);
  sale.id = id;
  ventas.push(sale);

  try{
    applyFinishedFromSalePOS(sale, +1);
  }catch(e){
    console.error('Error aplicando inventario central desde venta POS', e);
  }

  try{
    await createJournalEntryForSalePOS(sale);
  }catch(e){
    console.error('Error creando asiento contable automático desde venta POS', e);
  }

  clearVentaActual();
  renderVentasResumen();
  renderInventarioTabla();
  alert('Venta registrada');
}

// --- Resumen de ventas por evento
function renderVentasResumen(){
  const tbody = $('#summary-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const byEvent = {};
  for (const v of ventas){
    const key = v.eventId || 'sin';
    if (!byEvent[key]) byEvent[key] = { total:0, count:0 };
    byEvent[key].total += Number(v.total||0);
    byEvent[key].count += 1;
  }
  Object.keys(byEvent).forEach(key=>{
    const info = byEvent[key];
    const ev = eventos.find(e=>e.id===Number(key));
    const name = ev ? ev.name : 'Sin evento';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${name}</td>
      <td>${info.count}</td>
      <td>C$ ${info.total.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- Inventario movimientos
async function onAddInventarioMov(ev){
  ev.preventDefault();
  const eventIdStr = $('#inv-event-mov').value;
  const prodIdStr = $('#inv-product-mov').value;
  const qty = invParseNumberPOS($('#inv-qty').value);
  const type = $('#inv-type').value || 'entrada';
  const notes = $('#inv-notes').value.trim();

  if (!eventIdStr || !prodIdStr || !qty){
    alert('Evento, producto y cantidad obligatorios');
    return;
  }
  const eventId = parseInt(eventIdStr,10);
  const productId = parseInt(prodIdStr,10);
  const evObj = eventos.find(e=>e.id===eventId);
  const prod = productos.find(p=>p.id===productId);
  if (!evObj || !prod){
    alert('Evento o producto inválido');
    return;
  }

  const mov = {
    eventId,
    eventName: evObj.name,
    productId,
    productName: prod.name,
    quantity: qty,
    type,
    notes
  };

  const id = await put('inventory', mov);
  mov.id = id;
  inventarioMovs.push(mov);
  rebuildInventarioCache();
  renderInventarioTabla();

  $('#inv-qty').value = '';
  $('#inv-notes').value = '';
}

function renderInventarioTabla(){
  const tbody = $('#inv-tbody');
  if (!tbody) return;
  const eventIdStr = $('#inv-event')?.value || '';
  const eventId = eventIdStr ? parseInt(eventIdStr,10) : null;
  tbody.innerHTML = '';

  const list = inventarioCache.filter(row=> !eventId || row.eventId===eventId);
  for (const row of list){
    const ev = eventos.find(e=>e.id===row.eventId);
    const prod = productos.find(p=>p.id===row.productId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ev ? ev.name : 'Global'}</td>
      <td>${prod ? prod.name : 'Desconocido'}</td>
      <td>${row.quantity}</td>
    `;
    tbody.appendChild(tr);
  }
}

// --- Inicio
document.addEventListener('DOMContentLoaded', ()=>{
  init().catch(err=>{
    console.error('Error inicializando POS', err);
  });
});
