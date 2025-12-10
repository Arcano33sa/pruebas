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
        entriesStore.createIndex('origenId', 'origenId', { unique: false });
      }
      if (!d.objectStoreNames.contains('journalLines')) {
        const linesStore = d.createObjectStore('journalLines', { keyPath: 'id', autoIncrement: true });
        linesStore.createIndex('entryId', 'entryId', { unique: false });
        linesStore.createIndex('accountCode', 'accountCode', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      finDb = e.target.result;
      resolve(finDb);
    };
    req.onerror = () => {
      console.error('Error abriendo finanzasDB desde POS', req.error);
      reject(req.error);
    };
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

// Obtiene el costo unitario desde finanzas (tablas de costos por presentación)
function getCostoUnitarioProducto(productName) {
  // Esta función se apoya en la lógica de costos que vive en Finanzas.
  // Para no romper nada, la dejamos como estaba: intenta leer de localStorage
  // o algún cache de costos definido por el módulo Finanzas.
  try {
    const costosRaw = localStorage.getItem('finA33_costos_presentaciones');
    if (!costosRaw) return 0;
    const costos = JSON.parse(costosRaw);
    if (!Array.isArray(costos)) return 0;
    const found = costos.find(c => c && c.nombrePresentacion === productName);
    if (!found) return 0;
    const n = Number(found.costoUnitario);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    console.error('Error obteniendo costo unitario de producto', e);
    return 0;
  }
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
    const amount = Math.abs(Number(sale.total) || 0);

    // Costo de venta basado en costo por presentación
    let unitCost = 0;
    if (typeof sale.costPerUnit === 'number' && sale.costPerUnit > 0) {
      unitCost = sale.costPerUnit;
    } else {
      unitCost = getCostoUnitarioProducto(sale.productName || '');
    }
    const qtyAbs = Math.abs(Number(sale.qty) || 0);
    const amountCost = unitCost > 0 && qtyAbs > 0 ? unitCost * qtyAbs : 0;

    // Si no hay ni ingreso ni costo, no hay nada que registrar
    if (!amount && !amountCost) return;

    const cashAccount = mapSaleToCuentaCobro(sale);
    const evento = sale.eventName || '';
    const descripcionBase = sale.productName || 'Venta POS';
    const descripcion = sale.isReturn
      ? `Devolución POS - ${descripcionBase}`
      : `Venta POS - ${descripcionBase}`;

    // Para devoluciones lo marcamos como "ajuste" para diferenciarlo visualmente
    const tipoMovimiento = sale.isReturn ? 'ajuste' : 'ingreso';

    const totalsDebe = amount + amountCost;
    const totalsHaber = amount + amountCost;

    // Buscar si ya existe un asiento para este origen/origenId
    let existingEntry = null;
    if (saleId != null) {
      await new Promise((resolve) => {
        const txRead = finDb.transaction(['journalEntries'], 'readonly');
        const storeRead = txRead.objectStore('journalEntries');
        const req = storeRead.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          existingEntry = list.find(
            (e) => e && e.origen === 'POS' && e.origenId === saleId
          ) || null;
        };
        txRead.oncomplete = () => resolve();
        txRead.onerror = () => resolve();
      });
    }

    let entryId = existingEntry ? existingEntry.id : null;

    // Insertar o actualizar journalEntries
    await new Promise((resolve) => {
      const txWrite = finDb.transaction(['journalEntries'], 'readwrite');
      const storeWrite = txWrite.objectStore('journalEntries');

      if (existingEntry) {
        existingEntry.fecha = sale.date;
        existingEntry.date = sale.date;
        existingEntry.descripcion = descripcion;
        existingEntry.tipoMovimiento = tipoMovimiento;
        existingEntry.evento = evento;
        existingEntry.origen = 'POS';
        existingEntry.origenId = saleId;
        existingEntry.totalDebe = totalsDebe;
        existingEntry.totalHaber = totalsHaber;
        storeWrite.put(existingEntry);
      } else {
        const entry = {
          fecha: sale.date,   // campo que Finanzas espera
          date: sale.date,    // compatibilidad con índices previos
          descripcion,
          tipoMovimiento,
          evento,
          origen: 'POS',
          origenId: saleId,
          totalDebe: totalsDebe,
          totalHaber: totalsHaber
        };
        const reqAdd = storeWrite.add(entry);
        reqAdd.onsuccess = (ev) => {
          entryId = ev.target.result;
        };
      }

      txWrite.oncomplete = () => {
        if (!entryId && existingEntry && existingEntry.id != null) {
          entryId = existingEntry.id;
        }
        resolve();
      };
      txWrite.onerror = (e) => {
        console.error('Error guardando asiento automático desde POS', e && e.target && e.target.error);
        resolve();
      };
    });

    // Borrar líneas contables anteriores asociadas a esta entrada
    if (entryId != null) {
      await new Promise((resolve) => {
        const txDel = finDb.transaction(['journalLines'], 'readwrite');
        const storeDel = txDel.objectStore('journalLines');
        const reqLines = storeDel.getAll();
        reqLines.onsuccess = () => {
          const lines = reqLines.result || [];
          lines
            .filter((l) => l && l.entryId === entryId)
            .forEach((l) => {
              try {
                storeDel.delete(l.id);
              } catch (err) {
                console.error('Error borrando línea contable POS existente', err);
              }
            });
        };
        txDel.oncomplete = () => resolve();
        txDel.onerror = () => resolve();
      });
    }

    // Crear nuevas líneas (ingreso + costo de venta si aplica)
    await new Promise((resolve) => {
      const txLines = finDb.transaction(['journalLines'], 'readwrite');
      const storeLines = txLines.objectStore('journalLines');

      const addLine = (accountCode, type, amount) => {
        if (!amount) return;
        const line = {
          entryId,
          accountCode,
          type,
          amount
        };
        storeLines.add(line);
      };

      // Ingreso
      addLine(cashAccount, 'debe', amount);
      addLine('4100', 'haber', amount); // Ventas

      // Costo de venta si aplica
      if (amountCost) {
        addLine('5100', 'debe', amountCost);  // Costo de Ventas
        addLine('1105', 'haber', amountCost); // Inventario de Producto Terminado
      }

      txLines.oncomplete = () => resolve();
      txLines.onerror = () => {
        console.error('Error guardando líneas contables POS');
        resolve();
      };
    });
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
    await new Promise((resolve)=>{
      const tx = finDb.transaction(['journalEntries','journalLines'],'readwrite');
      const entries = tx.objectStore('journalEntries');
      const lines = tx.objectStore('journalLines');

      const reqE = entries.getAll();
      reqE.onsuccess = () => {
        const list = reqE.result || [];
        list.filter(e=> e && e.origen === 'POS' && e.origenId === saleId)
          .forEach(e=>{
            try{
              entries.delete(e.id);
              const reqL = lines.getAll();
              reqL.onsuccess = () => {
                const allLines = reqL.result || [];
                allLines.filter(l=> l && l.entryId === e.id)
                  .forEach(l=>{
                    try{ lines.delete(l.id); }catch(err2){ console.error('Error borrando línea contable al eliminar venta POS', err2); }
                  });
              };
            }catch(err){
              console.error('Error borrando asiento contable al eliminar venta POS', err);
            }
          });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }catch(e){
    console.error('Error general borrando asientos contables para venta POS', e);
  }
}

// --- Inventario central: helper para actualizar uso de insumos por venta POS ---
function applyFinishedFromSalePOS(sale, factor=1){
  try{
    if (!sale || !sale.items) return;
    // Hook: aquí podrías conectar con el inventario central si quisieras
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

// ----------------------
// Lógica POS original
// ----------------------

// (A partir de aquí sigue exactamente tu código original de POS:
// helpers de UI, estado global, ventas, inventario, resumen, etc.)
// ...
// Al final del archivo:
document.addEventListener('DOMContentLoaded', init);
