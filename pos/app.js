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
        d.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('journalEntries')) {
        const je = d.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
        je.createIndex('by_date', 'date', { unique: false });
        je.createIndex('by_event', 'eventId', { unique: false });
      } else {
        try { e.target.transaction.objectStore('journalEntries').createIndex('by_date', 'date'); } catch {}
        try { e.target.transaction.objectStore('journalEntries').createIndex('by_event', 'eventId'); } catch {}
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
  if (pay === 'credito') return '1300'; // Cuentas por Cobrar
  return '1100';
}

// Crea asientos contables en finanzasDB a partir de una venta POS
async function createFinanzasEntriesForSalePOS(sale){
  try{
    await ensureFinanzasDB();
  }catch(e){
    console.error('No se puede crear asientos porque finanzasDB no está disponible', e);
    return;
  }
  try{
    const ventasCuenta = '4100'; // Ingresos por Ventas
    const cajaCuenta   = mapSaleToCuentaCobro(sale); // Caja / Banco / Cuentas por Cobrar
    const fecha = sale.date || new Date().toISOString().slice(0,10);
    const eventId = sale.eventId || null;
    const total = Number(sale.total)||0;
    if (!total) return;

    const entry = {
      id: undefined,
      date: fecha,
      description: `Venta POS event ${eventId||'-'}`,
      eventId: eventId,
      items: [
        { accountId: cajaCuenta, type: 'debit', amount: total },
        { accountId: ventasCuenta, type: 'credit', amount: total }
      ],
      source: 'pos-sale',
      sourceId: sale.id || null
    };
    await finPut('journalEntries', entry);
  }catch(e){
    console.error('Error creando asientos para venta POS', e);
  }
}

// Invierte efecto contable de una venta (por ejemplo, al borrar una venta)
async function deleteFinanzasEntriesForSalePOS(saleId){
  try{
    await ensureFinanzasDB();
  }catch(e){
    console.error('No se puede abrir finanzasDB para borrar asientos de venta POS', e);
    return;
  }
  try{
    const all = await finGetAll('journalEntries');
    const toDelete = all.filter(x=>x.source==='pos-sale' && x.sourceId===saleId);
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
// existe inventario central en otro módulo, pero por ahora sólo dejamos el hook.
function applyFinishedFromSalePOS(sale, factor=1){
  try{
    // Hook sin implementación detallada aquí (inventario central se maneja en otra vista).
    // Se deja la función para no romper nada del flujo existente.
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
              console.error('Error eliminando asientos contables vinculados a venta POS', err);
            });
          }

          const delReq = store.delete(key);
          delReq.onsuccess = async ()=>{
            try{
              await finPromise;
            }catch(e){
              console.error('Error esperando eliminación de asientos contables', e);
            }
            resolve();
          };
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
async function getMeta(key){ const all = await getAll('meta'); const row = all.find(x=>x.id===key); return row ? row.value : null; }

// Normalizar nombres
function normName(s){ return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

const RECETAS_KEY = 'arcano33_recetas_v1';

const DEFAULT_RECETAS = [
  {
    id: 'clasica-base',
    name: 'Clásica base',
    description: 'Receta base Arcano 33',
    litersTotal: 3.8,
    litersWine: 2.5,
    mlVodka: 250,
    litersJuice: 0.8,
    litersWater: 0.25,
    mlSyrup: 200
  }
];

function loadRecetas(){
  try{
    const raw = localStorage.getItem(RECETAS_KEY);
    if (!raw) return DEFAULT_RECETAS.slice();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_RECETAS.slice();
    return parsed;
  }catch(e){
    console.error('Error leyendo recetas', e);
    return DEFAULT_RECETAS.slice();
  }
}

function saveRecetas(recetas){
  try{
    localStorage.setItem(RECETAS_KEY, JSON.stringify(recetas));
  }catch(e){
    console.error('Error guardando recetas', e);
  }
}

// --- UI helpers
function $(sel){ return document.querySelector(sel); }
function $$(sel){ return Array.from(document.querySelectorAll(sel)); }

// --- Estado global POS
let productos = [];
let eventos = [];
let ventas = [];
let inventario = [];
let recetas = loadRecetas();

let currentSale = {
  items: [],
  total: 0,
  payment: 'efectivo'
};

// --- Inicialización
async function init(){
  await openDB();
  await loadData();
  bindEvents();
  setTab('venta');
}

// --- Carga de datos desde IndexedDB
async function loadData(){
  productos = await getAll('products');
  eventos = await getAll('events');
  ventas = await getAll('sales');
  inventario = await getAll('inventory');
  renderProductos();
  renderEventos();
  renderInventario();
  renderSummary();
  refreshEventUI();
}

// --- Manejo de pestañas
function setTab(name){
  $$('.tab').forEach(el=> el.style.display='none');
  const target = document.getElementById('tab-'+name);
  if (target) target.style.display='block';
  $$('.tabbar button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`.tabbar button[data-tab="${name}"]`);
  if (btn) btn.classList.add('active');
  if (name==='resumen') renderSummary();
  if (name==='productos') renderProductos();
  if (name==='eventos') renderEventos();
  if (name==='inventario') renderInventario();
}

// --- Eventos de UI
function bindEvents(){
  $$('.tabbar button').forEach(btn=>{
    btn.addEventListener('click', ()=> setTab(btn.dataset.tab));
  });

  $('#add-product-form').addEventListener('submit', onAddProduct);
  $('#product-search').addEventListener('input', renderProductos);

  $('#event-form').addEventListener('submit', onAddEvent);
  $('#event-search').addEventListener('input', renderEventos);

  $('#sale-add-item').addEventListener('click', onAddItemToSale);
  $('#sale-clear').addEventListener('click', clearCurrentSale);
  $('#sale-finish').addEventListener('click', finishSale);

  $('#sale-payment').addEventListener('change', e=>{
    currentSale.payment = e.target.value;
  });

  $('#sale-event').addEventListener('change', async (e)=>{
    const val = e.target.value;
    const eventId = val ? Number(val) : null;
    await setMeta('currentEventId', eventId);
    refreshEventUI();
  });

  $('#inv-event').addEventListener('change', renderInventario);
}

// --- Productos
async function onAddProduct(ev){
  ev.preventDefault();
  const name = $('#product-name').value.trim();
  const price = Number($('#product-price').value||0);
  const category = $('#product-category').value.trim() || 'General';

  if (!name || !price){
    alert('Nombre y precio son obligatorios');
    return;
  }

  if (productos.some(p=> normName(p.name)===normName(name))){
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
  renderProductos();
}

function renderProductos(){
  const term = normName($('#product-search').value||'');
  const tbody = $('#products-tbody');
  tbody.innerHTML = '';
  productos
    .filter(p=> !term || normName(p.name).includes(term))
    .forEach(p=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>C$ ${p.price.toFixed(2)}</td>
        <td>${p.category||''}</td>
      `;
      tbody.appendChild(tr);
    });
}

// --- Eventos
async function onAddEvent(ev){
  ev.preventDefault();
  const name = $('#event-name').value.trim();
  const date = $('#event-date').value || new Date().toISOString().slice(0,10);
  const notes = $('#event-notes').value.trim();

  if (!name){
    alert('El nombre del evento es obligatorio');
    return;
  }

  const evObj = { name, date, notes, status:'open' };
  const id = await put('events', evObj);
  evObj.id = id;
  eventos.push(evObj);

  $('#event-name').value = '';
  $('#event-date').value = '';
  $('#event-notes').value = '';

  renderEventos();
  refreshEventUI();
}

function renderEventos(){
  const term = normName($('#event-search').value||'');
  const tbody = $('#events-tbody');
  tbody.innerHTML = '';
  eventos
    .filter(e=> !term || normName(e.name).includes(term))
    .forEach(e=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${e.name}</td>
        <td>${e.date}</td>
        <td>${e.status==='open' ? 'Abierto' : 'Cerrado'}</td>
        <td>
          <button data-id="${e.id}" class="btn-small btn-secondary evt-active">Activar</button>
          <button data-id="${e.id}" class="btn-small btn-warning evt-close">Cerrar</button>
          <button data-id="${e.id}" class="btn-small btn-danger evt-delete">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  $$('#events-tbody .evt-active').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      await setMeta('currentEventId', id);
      refreshEventUI();
      alert('Evento activado para ventas');
    });
  });

  $$('#events-tbody .evt-close').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      const ev = eventos.find(x=>x.id===id);
      if (!ev) return;
      if (!confirm('¿Cerrar este evento?')) return;
      ev.status = 'closed';
      await put('events', ev);
      renderEventos();
      refreshEventUI();
    });
  });

  $$('#events-tbody .evt-delete').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.id);
      if (!confirm('¿Eliminar este evento y sus ventas asociadas?')) return;
      eventos = eventos.filter(x=>x.id!==id);
      await del('events', id);
      const toDelete = ventas.filter(v=>v.eventId===id);
      for (const v of toDelete){
        await del('sales', v.id);
      }
      ventas = ventas.filter(v=>v.eventId!==id);
      const invToDelete = inventario.filter(inv=>inv.eventId===id);
      for (const inv of invToDelete){
        await del('inventory', inv.id);
      }
      inventario = inventario.filter(inv=>inv.eventId!==id);

      const cur = await getMeta('currentEventId');
      if (cur===id){
        await setMeta('currentEventId', null);
      }

      renderEventos();
      renderSummary();
      renderInventario();
      refreshEventUI();
    });
  });
}

async function refreshEventUI(){
  const saleEventSelect = $('#sale-event');
  const invEventSelect = $('#inv-event');
  const currentId = await getMeta('currentEventId');

  saleEventSelect.innerHTML = '<option value="">Sin evento activo</option>';
  eventos.forEach(ev=>{
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = ev.name;
    if (currentId && ev.id===currentId) opt.selected = true;
    saleEventSelect.appendChild(opt);
  });

  invEventSelect.innerHTML = '<option value="">Todos</option>';
  eventos.forEach(ev=>{
    const opt = document.createElement('option');
    opt.value = ev.id;
    opt.textContent = ev.name;
    invEventSelect.appendChild(opt);
  });

  const evInfo = $('#current-event-info');
  const ev = eventos.find(e=>e.id===currentId);
  if (ev){
    evInfo.textContent = `Evento activo: ${ev.name} (${ev.status==='open' ? 'Abierto' : 'Cerrado'})`;
  } else {
    evInfo.textContent = 'Sin evento activo';
  }

  updateSellEnabled();
}

function updateSellEnabled(){
  const btn = $('#sale-finish');
  getMeta('currentEventId').then(cur=>{
    btn.disabled = !cur;
  });
}

// --- Ventas
function onAddItemToSale(){
  const prodSelect = $('#sale-product');
  const qtyInput = $('#sale-qty');
  const prodId = Number(prodSelect.value);
  const qty = Number(qtyInput.value||0);

  if (!prodId || !qty){
    alert('Seleccione producto y cantidad');
    return;
  }

  const prod = productos.find(p=>p.id===prodId);
  if (!prod){
    alert('Producto no encontrado');
    return;
  }

  const existing = currentSale.items.find(it=>it.productId===prodId);
  if (existing){
    existing.quantity += qty;
  } else {
    currentSale.items.push({
      productId: prodId,
      name: prod.name,
      price: prod.price,
      quantity: qty
    });
  }

  qtyInput.value = '';
  renderCurrentSale();
}

function renderCurrentSale(){
  const tbody = $('#sale-items-tbody');
  tbody.innerHTML = '';
  let total = 0;
  currentSale.items.forEach((it, idx)=>{
    const sub = it.price * it.quantity;
    total += sub;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${it.name}</td>
      <td>${it.quantity}</td>
      <td>C$ ${it.price.toFixed(2)}</td>
      <td>C$ ${sub.toFixed(2)}</td>
      <td><button data-idx="${idx}" class="btn-small btn-danger rm-item">X</button></td>
    `;
    tbody.appendChild(tr);
  });
  currentSale.total = total;
  $('#sale-total').textContent = `Total: C$ ${total.toFixed(2)}`;

  $$('#sale-items-tbody .rm-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      currentSale.items.splice(idx,1);
      renderCurrentSale();
    });
  });
}

function clearCurrentSale(){
  currentSale.items = [];
  currentSale.total = 0;
  $('#sale-total').textContent = 'Total: C$ 0.00';
  $('#sale-notes').value = '';
  renderCurrentSale();
}

async function finishSale(){
  const eventId = await getMeta('currentEventId');
  if (!eventId){
    alert('Debe haber un evento activo para registrar ventas');
    return;
  }
  if (!currentSale.items.length){
    alert('No hay productos en la venta');
    return;
  }

  const date = new Date().toISOString().slice(0,10);
  const notes = $('#sale-notes').value.trim();
  const sale = {
    date,
    eventId,
    items: currentSale.items.map(it=>({
      productId: it.productId,
      name: it.name,
      price: it.price,
      quantity: it.quantity
    })),
    total: currentSale.total,
    payment: currentSale.payment,
    notes
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
    await createFinanzasEntriesForSalePOS(sale);
  }catch(e){
    console.error('Error creando asientos contables desde venta POS', e);
  }

  clearCurrentSale();
  renderSummary();
  renderInventario();
  alert('Venta registrada');
}

// --- Inventario (por evento)
function renderInventario(){
  const eventIdStr = $('#inv-event').value;
  const eventId = eventIdStr ? Number(eventIdStr) : null;
  const tbody = $('#inv-tbody');
  tbody.innerHTML = '';

  const filtered = eventId ? inventario.filter(inv=>inv.eventId===eventId) : inventario.slice();
  filtered.forEach(inv=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${inv.eventName||''}</td>
      <td>${inv.productName||''}</td>
      <td>${inv.quantity||0}</td>
      <td>${inv.notes||''}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- Resumen
function renderSummary(){
  const tbody = $('#summary-tbody');
  tbody.innerHTML = '';

  const byEvent = {};
  ventas.forEach(v=>{
    if (!byEvent[v.eventId]) byEvent[v.eventId] = { total:0, count:0 };
    byEvent[v.eventId].total += v.total;
    byEvent[v.eventId].count += 1;
  });

  Object.keys(byEvent).forEach(eventId=>{
    const ev = eventos.find(e=>e.id===Number(eventId));
    const info = byEvent[eventId];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ev ? ev.name : ('Evento '+eventId)}</td>
      <td>${info.count}</td>
      <td>C$ ${info.total.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- Recetas (usadas para cálculo en otros módulos, aquí sólo se leen/guardan)
function renderRecetasList(){
  const tbody = $('#recetas-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  recetas.forEach((r, idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${r.description||''}</td>
      <td>${r.litersTotal||0}</td>
      <td>
        <button class="btn-small btn-secondary" data-idx="${idx}">Editar</button>
        <button class="btn-small btn-danger" data-del="${idx}">Borrar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $$('#recetas-tbody button[data-idx]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      const r = recetas[idx];
      if (!r) return;
      $('#receta-idx').value = idx;
      $('#receta-name').value = r.name;
      $('#receta-desc').value = r.description||'';
      $('#receta-total').value = r.litersTotal||0;
      $('#receta-wine').value = r.litersWine||0;
      $('#receta-vodka').value = r.mlVodka||0;
      $('#receta-juice').value = r.litersJuice||0;
      $('#receta-water').value = r.litersWater||0;
      $('#receta-syrup').value = r.mlSyrup||0;
    });
  });

  $$('#recetas-tbody button[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.del);
      if (!confirm('¿Eliminar esta receta?')) return;
      recetas.splice(idx,1);
      saveRecetas(recetas);
      renderRecetasList();
    });
  });
}

function bindRecetasForm(){
  const form = $('#receta-form');
  if (!form) return;
  form.addEventListener('submit', ev=>{
    ev.preventDefault();
    const idx = $('#receta-idx').value;
    const name = $('#receta-name').value.trim();
    if (!name){
      alert('Nombre de receta obligatorio');
      return;
    }
    const r = {
      name,
      description: $('#receta-desc').value.trim(),
      litersTotal: Number($('#receta-total').value||0),
      litersWine: Number($('#receta-wine').value||0),
      mlVodka: Number($('#receta-vodka').value||0),
      litersJuice: Number($('#receta-juice').value||0),
      litersWater: Number($('#receta-water').value||0),
      mlSyrup: Number($('#receta-syrup').value||0)
    };
    if (idx){
      recetas[Number(idx)] = Object.assign({}, recetas[Number(idx)], r);
    } else {
      recetas.push(r);
    }
    saveRecetas(recetas);
    $('#receta-idx').value = '';
    form.reset();
    renderRecetasList();
  });
}

// --- Inicio
document.addEventListener('DOMContentLoaded', ()=>{
  init().then(()=>{
    renderRecetasList();
    bindRecetasForm();
  }).catch(err=>{
    console.error('Error iniciando POS', err);
  });
});
