// Finanzas – Suite A33 · Fase 3A + Fase 4.2 + Fase 4.3.1 + Fase 4.3.2 + Fase 4.4
// Contabilidad básica: diario, tablero, ER, BG
// + Rentabilidad por presentación (lectura POS)
// + Comparativo de eventos (lectura Finanzas)
// + Flujo de Caja simple
// + Exportar todos los reportes a Excel (.xls compatible).

const FIN_DB_NAME = 'finanzasDB';
const FIN_DB_VERSION = 1;
let finDB = null;
let finCachedData = null; // {accounts, accountsMap, entries, lines, linesByEntry}

// POS: lectura de ventas (solo lectura, sin tocar nada del POS)
const POS_DB_NAME = 'a33-pos';
let posDB = null;

const $ = (sel) => document.querySelector(sel);

/* ---------- IndexedDB helpers: Finanzas ---------- */

function openFinDB() {
  return new Promise((resolve, reject) => {
    if (finDB) return resolve(finDB);

    const req = indexedDB.open(FIN_DB_NAME, FIN_DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'code' });
      }

      if (!db.objectStoreNames.contains('journalEntries')) {
        db.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('journalLines')) {
        db.createObjectStore('journalLines', { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = () => {
      finDB = req.result;
      resolve(finDB);
    };
    req.onerror = () => reject(req.error);
  });
}

function finTx(storeName, mode = 'readonly') {
  const tx = finDB.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function finGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function finAdd(storeName, val) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readwrite');
    const req = store.add(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finPut(storeName, val) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readwrite');
    const req = store.put(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- IndexedDB helpers: POS (solo lectura) ---------- */

function openPosDB() {
  return new Promise((resolve, reject) => {
    if (posDB) return resolve(posDB);
    let req;
    try {
      // Sin versión: abre la base existente sin disparar onupgradeneeded
      req = indexedDB.open(POS_DB_NAME);
    } catch (err) {
      console.warn('No se pudo abrir la base de datos del POS', err);
      return resolve(null);
    }
    req.onsuccess = () => {
      posDB = req.result;
      resolve(posDB);
    };
    req.onerror = () => {
      console.warn('Error al abrir a33-pos desde Finanzas', req.error);
      resolve(null); // tratamos como sin datos
    };
  });
}

function posTx(storeName, mode = 'readonly') {
  if (!posDB) throw new Error('POS DB no inicializada');
  const tx = posDB.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function getAllPosSales() {
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) {
      resolve([]);
      return;
    }
    let store;
    try {
      store = posTx('sales', 'readonly');
    } catch (err) {
      console.warn('Store sales no encontrada en a33-pos', err);
      resolve([]);
      return;
    }
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => {
      console.warn('No se pudieron leer las ventas del POS', req.error);
      resolve([]);
    };
  });
}

/* ---------- Catálogo de cuentas base ---------- */

const BASE_ACCOUNTS = [
  // 1xxx Activos
  { code: '1100', nombre: 'Caja general', tipo: 'activo', systemProtected: true },
  { code: '1110', nombre: 'Caja eventos', tipo: 'activo', systemProtected: true },
  { code: '1200', nombre: 'Banco', tipo: 'activo', systemProtected: true },
  { code: '1300', nombre: 'Clientes (crédito)', tipo: 'activo', systemProtected: true },
  { code: '1310', nombre: 'Deudores varios', tipo: 'activo', systemProtected: true },
  { code: '1400', nombre: 'Inventario insumos líquidos', tipo: 'activo', systemProtected: true },
  { code: '1410', nombre: 'Inventario insumos de empaque', tipo: 'activo', systemProtected: true },
  { code: '1500', nombre: 'Inventario producto terminado A33', tipo: 'activo', systemProtected: true },
  { code: '1900', nombre: 'Otros activos', tipo: 'activo', systemProtected: false },

  // 2xxx Pasivos
  { code: '2100', nombre: 'Proveedores de insumos', tipo: 'pasivo', systemProtected: true },
  { code: '2110', nombre: 'Proveedores de servicios y eventos', tipo: 'pasivo', systemProtected: true },
  { code: '2200', nombre: 'Acreedores varios', tipo: 'pasivo', systemProtected: true },
  { code: '2900', nombre: 'Otros pasivos', tipo: 'pasivo', systemProtected: false },

  // 3xxx Patrimonio
  { code: '3100', nombre: 'Capital aportado A33', tipo: 'patrimonio', systemProtected: true },
  { code: '3200', nombre: 'Aportes adicionales del dueño', tipo: 'patrimonio', systemProtected: true },
  { code: '3300', nombre: 'Retiros del dueño', tipo: 'patrimonio', systemProtected: true },
  { code: '3900', nombre: 'Resultados acumulados', tipo: 'patrimonio', systemProtected: true },

  // 4xxx Ingresos
  { code: '4100', nombre: 'Ingresos por ventas Arcano 33 (general)', tipo: 'ingreso', systemProtected: true },
  { code: '4200', nombre: 'Ingresos por otros productos', tipo: 'ingreso', systemProtected: false },
  { code: '4210', nombre: 'Ingresos por talleres / workshop', tipo: 'ingreso', systemProtected: false },

  // 5xxx Costos de venta
  { code: '5100', nombre: 'Costo de ventas Arcano 33 (general)', tipo: 'costo', systemProtected: true },

  // 6xxx Gastos de operación
  { code: '6100', nombre: 'Gastos de eventos – generales', tipo: 'gasto', systemProtected: true },
  { code: '6105', nombre: 'Gastos de publicidad y marketing', tipo: 'gasto', systemProtected: true },
  { code: '6106', nombre: 'Impuesto cuota fija', tipo: 'gasto', systemProtected: true },
  { code: '6110', nombre: 'Servicios (luz/agua/teléfono, etc.)', tipo: 'gasto', systemProtected: true },
  { code: '6120', nombre: 'Gastos de delivery / envíos', tipo: 'gasto', systemProtected: true },
  { code: '6130', nombre: 'Gastos varios A33', tipo: 'gasto', systemProtected: true },

  // 7xxx Otros ingresos/gastos
  { code: '7100', nombre: 'Otros ingresos varios', tipo: 'ingreso', systemProtected: false },
  { code: '7200', nombre: 'Otros gastos varios', tipo: 'gasto', systemProtected: false }
];

function inferTipoFromCode(code) {
  const c = String(code || '').charAt(0);
  if (c === '1') return 'activo';
  if (c === '2') return 'pasivo';
  if (c === '3') return 'patrimonio';
  if (c === '4') return 'ingreso';
  if (c === '5') return 'costo';
  if (c === '6') return 'gasto';
  return 'otro';
}

function getTipoCuenta(acc) {
  return acc.tipo || inferTipoFromCode(acc.code);
}

async function ensureBaseAccounts() {
  await openFinDB();
  const existing = await finGetAll('accounts');
  const byCode = new Map(existing.map(a => [String(a.code), a]));

  for (const base of BASE_ACCOUNTS) {
    const codeStr = String(base.code);
    const current = byCode.get(codeStr);
    if (!current) {
      await finAdd('accounts', {
        code: codeStr,
        nombre: base.nombre,
        tipo: base.tipo,
        systemProtected: !!base.systemProtected
      });
    } else {
      // Refuerza tipo y systemProtected si falta
      let changed = false;
      if (!current.tipo) {
        current.tipo = base.tipo;
        changed = true;
      }
      if (base.systemProtected && !current.systemProtected) {
        current.systemProtected = true;
        changed = true;
      }
      if (changed) {
        await finPut('accounts', current);
      }
    }
  }
}

/* ---------- Utilidades de fechas, texto y formato ---------- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function monthRange(year, month) {
  // month: 1–12
  const y = Number(year);
  const m = Number(month);
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { start, end };
}

function prevDateStr(dateStr) {
  if (!dateStr) return todayStr();
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function fmtCurrency(v) {
  const n = Number(v || 0);
  return n.toLocaleString('es-NI', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function normStr(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Periodo actual del Estado de Resultados (se reutiliza en Rentabilidad, Comparativo y Flujo de Caja)
function getPeriodoERActual() {
  const modoSel = $('#er-modo');
  const mesSel = $('#er-mes');
  const anioSel = $('#er-anio');
  const desdeInput = $('#er-desde');
  const hastaInput = $('#er-hasta');

  const modo = modoSel ? modoSel.value : 'mes';
  let desde;
  let hasta;

  if (modo === 'mes') {
    const mes = mesSel?.value || pad2(new Date().getMonth() + 1);
    const anio = anioSel?.value || String(new Date().getFullYear());
    const range = monthRange(Number(anio), Number(mes));
    desde = range.start;
    hasta = range.end;
  } else {
    desde = (desdeInput?.value) || todayStr();
    hasta = (hastaInput?.value) || desde;
    if (hasta < desde) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }
  }

  return { modo, desde, hasta };
}

/* ---------- Carga y estructura de datos ---------- */

async function getAllFinData() {
  await openFinDB();
  const [accounts, entries, lines] = await Promise.all([
    finGetAll('accounts'),
    finGetAll('journalEntries'),
    finGetAll('journalLines')
  ]);

  const accountsMap = new Map();
  for (const acc of accounts) {
    accountsMap.set(String(acc.code), acc);
  }

  const linesByEntry = new Map();
  for (const ln of lines) {
    const idEntry = ln.idEntry;
    if (!linesByEntry.has(idEntry)) linesByEntry.set(idEntry, []);
    linesByEntry.get(idEntry).push(ln);
  }

  return { accounts, accountsMap, entries, lines, linesByEntry };
}

function buildEventList(entries) {
  const set = new Set();
  for (const e of entries) {
    const name = (e.evento || '').trim();
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

function matchEvent(entry, eventFilter) {
  const ev = (entry.evento || '').trim();
  if (!eventFilter || eventFilter === 'ALL') return true;
  if (eventFilter === 'NONE') return !ev;
  return ev === eventFilter;
}

function filterEntriesByDateAndEvent(entries, { desde, hasta, evento }) {
  return entries.filter(e => {
    const f = e.fecha || '';
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    if (!matchEvent(e, evento)) return false;
    return true;
  });
}

/* ---------- Cálculos: resultados, balances y flujo de caja ---------- */

function calcResultadosForFilter(data, filtros) {
  const { accountsMap, entries, linesByEntry } = data;
  const subset = filterEntriesByDateAndEvent(entries, filtros);

  let ingresos = 0;
  let costos = 0;
  let gastos = 0;

  for (const e of subset) {
    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const acc = accountsMap.get(String(ln.accountCode));
      if (!acc) continue;
      const tipo = getTipoCuenta(acc);
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);

      if (tipo === 'ingreso') {
        ingresos += (haber - debe);
      } else if (tipo === 'costo') {
        costos += (debe - haber);
      } else if (tipo === 'gasto') {
        gastos += (debe - haber);
      }
    }
  }

  return { ingresos, costos, gastos };
}

// Agrupa por evento en un rango de fechas
function calcResultadosByEventInRange(data, desde, hasta) {
  const { accountsMap, entries, linesByEntry } = data;
  const map = new Map(); // key: nombreEvento, value: {ingresos, costos, gastos}

  for (const e of entries) {
    const f = e.fecha || '';
    if (desde && f < desde) continue;
    if (hasta && f > hasta) continue;

    const eventName = (e.evento || '').trim() || 'Sin evento';
    if (!map.has(eventName)) {
      map.set(eventName, { ingresos: 0, costos: 0, gastos: 0 });
    }
    const bucket = map.get(eventName);

    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const acc = accountsMap.get(String(ln.accountCode));
      if (!acc) continue;
      const tipo = getTipoCuenta(acc);
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);

      if (tipo === 'ingreso') {
        bucket.ingresos += (haber - debe);
      } else if (tipo === 'costo') {
        bucket.costos += (debe - haber);
      } else if (tipo === 'gasto') {
        bucket.gastos += (debe - haber);
      }
    }
  }

  return map;
}

function calcBalanceGroupsUntilDate(data, corte) {
  const { accountsMap, entries, linesByEntry } = data;
  const cutoff = corte || todayStr();

  let activos = 0;
  let pasivos = 0;
  let patrimonio = 0;

  for (const e of entries) {
    const f = e.fecha || '';
    if (f && f > cutoff) continue;
    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const acc = accountsMap.get(String(ln.accountCode));
      if (!acc) continue;
      const tipo = getTipoCuenta(acc);
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);

      if (tipo === 'activo') {
        activos += (debe - haber);
      } else if (tipo === 'pasivo') {
        pasivos += (haber - debe);
      } else if (tipo === 'patrimonio') {
        patrimonio += (haber - debe);
      }
    }
  }

  return { activos, pasivos, patrimonio };
}

function calcCajaBancoUntilDate(data, corte) {
  const { entries, linesByEntry } = data;
  const cutoff = corte || todayStr();
  let caja = 0;
  let banco = 0;

  for (const e of entries) {
    const f = e.fecha || '';
    if (f && f > cutoff) continue;
    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);
      const delta = (debe - haber);
      const code = String(ln.accountCode);

      if (code === '1100' || code === '1110') {
        caja += delta;
      } else if (code === '1200') {
        banco += delta;
      }
    }
  }

  return { caja, banco };
}

// Flujo de Caja: periodo (desde/hasta) usando Caja/Banco y si hay cuentas de patrimonio
function calcFlujoCajaPeriodo(data, desde, hasta) {
  const { entries, linesByEntry } = data;
  const corteInicial = prevDateStr(desde);
  const saldosIniciales = calcCajaBancoUntilDate(data, corteInicial);
  const saldoInicial = saldosIniciales.caja + saldosIniciales.banco;

  let entradasOperacion = 0;
  let salidasOperacion = 0;
  let entradasAportes = 0;
  let salidasRetiros = 0;

  for (const e of entries) {
    const f = e.fecha || '';
    if (f < desde || f > hasta) continue;

    const lines = linesByEntry.get(e.id) || [];
    const hasPatrimonio = lines.some(ln => String(ln.accountCode).startsWith('3'));

    let deltaCajaBanco = 0;
    for (const ln of lines) {
      const code = String(ln.accountCode);
      if (code === '1100' || code === '1110' || code === '1200') {
        const debe = Number(ln.debe || 0);
        const haber = Number(ln.haber || 0);
        deltaCajaBanco += (debe - haber);
      }
    }

    if (deltaCajaBanco === 0) continue;

    if (hasPatrimonio) {
      if (deltaCajaBanco > 0) {
        entradasAportes += deltaCajaBanco;
      } else {
        salidasRetiros += -deltaCajaBanco;
      }
    } else {
      if (deltaCajaBanco > 0) {
        entradasOperacion += deltaCajaBanco;
      } else {
        salidasOperacion += -deltaCajaBanco;
      }
    }
  }

  const entradasTotales = entradasOperacion + entradasAportes;
  const salidasTotales = salidasOperacion + salidasRetiros;
  const saldoFinal = saldoInicial + entradasTotales - salidasTotales;

  return {
    saldoInicial,
    entradasOperacion,
    salidasOperacion,
    entradasAportes,
    salidasRetiros,
    entradasTotales,
    salidasTotales,
    saldoFinal
  };
}

/* ---------- Rentabilidad por presentación (lectura POS) ---------- */

const RENTAB_PRESENTACIONES = [
  { id: 'pulso', label: 'Pulso 250 ml' },
  { id: 'media', label: 'Media 375 ml' },
  { id: 'djeba', label: 'Djeba 750 ml' },
  { id: 'litro', label: 'Litro 1000 ml' },
  { id: 'galon', label: 'Galón 3800 ml' }
];

function mapProductNameToPresIdFromPOS(name) {
  const n = normStr(name);
  if (!n) return null;
  if (n.includes('pulso')) return 'pulso';
  if (n.includes('media')) return 'media';
  if (n.includes('djeba')) return 'djeba';
  if (n.includes('litro')) return 'litro';
  if (n.includes('galon') || n.includes('galón')) return 'galon';
  return null;
}

function matchEventPOS(sale, eventFilter) {
  const ev = (sale.eventName || '').toString().trim();
  if (!eventFilter || eventFilter === 'ALL') return true;
  if (eventFilter === 'NONE') return !ev;
  return ev === eventFilter;
}

function ensureRentabUI() {
  const subER = document.getElementById('sub-er');
  if (!subER) return null;
  let section = document.getElementById('rentab-presentacion');
  if (section) return section;

  const wrapper = document.createElement('section');
  wrapper.id = 'rentab-presentacion';
  wrapper.className = 'fin-subsection';

  wrapper.innerHTML = `
    <header class="fin-section-header fin-section-header--sub">
      <h3>Rentabilidad por presentación</h3>
      <p>
        Usa los mismos filtros de arriba (Periodo y Evento) para ver botellas, ingresos, costo y margen
        por Pulso, Media, Djeba, Litro y Galón.
      </p>
    </header>
    <div class="fin-table-wrapper">
      <table class="fin-table" id="rentab-table">
        <thead>
          <tr>
            <th>Presentación</th>
            <th>Botellas vendidas</th>
            <th>Ingresos</th>
            <th>Costo de venta</th>
            <th>Margen</th>
            <th>% Margen</th>
          </tr>
        </thead>
        <tbody id="rentab-tbody">
          <tr>
            <td colspan="6">Sin datos de ventas del POS para el periodo/evento seleccionado.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button type="button" id="btn-export-rentab" class="btn-link">
      Exportar rentabilidad a Excel
    </button>
  `;
  subER.appendChild(wrapper);
  return wrapper;
}

function renderRentabilidadPresentacion(/* dataFinanzas */) {
  (async () => {
    const section = ensureRentabUI();
    if (!section) return;
    const tbody = document.getElementById('rentab-tbody');
    if (!tbody) return;

    const { desde, hasta } = getPeriodoERActual();
    const eventoSel = document.getElementById('er-evento');
    const evento = (eventoSel && eventoSel.value) ? eventoSel.value : 'ALL';

    const ventas = await getAllPosSales();

    if (!ventas || !ventas.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">No hay ventas registradas en el POS para calcular rentabilidad.</td>
        </tr>
      `;
      return;
    }

    const agg = {};
    for (const s of ventas) {
      const fecha = s.date || '';
      if (fecha && desde && fecha < desde) continue;
      if (fecha && hasta && fecha > hasta) continue;
      if (!matchEventPOS(s, evento)) continue;

      const courtesy = !!s.courtesy;
      if (courtesy) continue; // Por ahora, cortesías fuera de la rentabilidad

      const presId = mapProductNameToPresIdFromPOS(s.productName || '');
      if (!presId) continue;

      if (!agg[presId]) {
        agg[presId] = {
          botellas: 0,
          ingresos: 0,
          costo: 0
        };
      }
      const group = agg[presId];

      const qty = Number(s.qty || 0); // devoluciones vienen con signo negativo
      const total = Number(s.total || 0); // devoluciones ajustan ingresos
      const lineCost = (typeof s.lineCost === 'number')
        ? Number(s.lineCost || 0)
        : Number(s.costPerUnit || 0) * qty;

      group.botellas += qty;
      group.ingresos += total;
      group.costo += lineCost;
    }

    tbody.innerHTML = '';

    let tieneDatos = false;
    for (const def of RENTAB_PRESENTACIONES) {
      const data = agg[def.id] || { botellas: 0, ingresos: 0, costo: 0 };
      const botellas = data.botellas;
      const ingresos = data.ingresos;
      const costo = data.costo;
      const margen = ingresos - costo;
      const margenPct = ingresos !== 0 ? (margen / ingresos) * 100 : 0;

      if (botellas !== 0 || ingresos !== 0 || costo !== 0) {
        tieneDatos = true;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${def.label}</td>
        <td class="num">${botellas.toFixed(0)}</td>
        <td class="num">C$ ${fmtCurrency(ingresos)}</td>
        <td class="num">C$ ${fmtCurrency(costo)}</td>
        <td class="num">C$ ${fmtCurrency(margen)}</td>
        <td class="num">${margenPct.toFixed(1)}%</td>
      `;
      tbody.appendChild(tr);
    }

    if (!tieneDatos) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">Sin movimientos de ventas (no cortesías) para el periodo/evento seleccionado.</td>
        </tr>
      `;
    }

    const btnExportRentab = document.getElementById('btn-export-rentab');
    if (btnExportRentab && !btnExportRentab.dataset.bound) {
      btnExportRentab.addEventListener('click', () => {
        exportRentabToExcel();
      });
      btnExportRentab.dataset.bound = '1';
    }
  })().catch(err => {
    console.error('Error calculando rentabilidad por presentación', err);
  });
}

/* ---------- Comparativo de eventos (solo Finanzas) ---------- */

function ensureComparativoEventosUI() {
  const subER = document.getElementById('sub-er');
  if (!subER) return null;
  let section = document.getElementById('comp-eventos');
  if (section) return section;

  const wrapper = document.createElement('section');
  wrapper.id = 'comp-eventos';
  wrapper.className = 'fin-subsection';

  wrapper.innerHTML = `
    <header class="fin-section-header fin-section-header--sub">
      <h3>Comparativo de eventos</h3>
      <p>
        Usa el mismo periodo de arriba (mes o rango de fechas).
        Muestra por evento: ingresos, costos de venta, gastos, resultado y % de margen.
      </p>
    </header>
    <div class="fin-table-wrapper">
      <table class="fin-table" id="comp-eventos-table">
        <thead>
          <tr>
            <th>Evento</th>
            <th>Ingresos</th>
            <th>Costo de venta</th>
            <th>Gastos</th>
            <th>Resultado</th>
            <th>% Margen</th>
          </tr>
        </thead>
        <tbody id="comp-eventos-tbody">
          <tr>
            <td colspan="6">Sin asientos registrados para el periodo seleccionado.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button type="button" id="btn-export-comp-eventos" class="btn-link">
      Exportar comparativo de eventos a Excel
    </button>
  `;
  subER.appendChild(wrapper);
  return wrapper;
}

function renderComparativoEventos(data) {
  const section = ensureComparativoEventosUI();
  if (!section || !data) return;
  const tbody = document.getElementById('comp-eventos-tbody');
  if (!tbody) return;

  const { desde, hasta } = getPeriodoERActual();
  const map = calcResultadosByEventInRange(data, desde, hasta);

  tbody.innerHTML = '';

  if (!map || map.size === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">Sin asientos registrados para el periodo seleccionado.</td>
      </tr>
    `;
    return;
  }

  // Orden: primero eventos con nombre, luego "Sin evento"
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === 'Sin evento') return 1;
    if (b === 'Sin evento') return -1;
    return a.localeCompare(b, 'es');
  });

  let totalIngresos = 0;
  let totalCostos = 0;
  let totalGastos = 0;
  let totalResultado = 0;

  for (const evName of keys) {
    const vals = map.get(evName);
    const ingresos = vals.ingresos;
    const costos = vals.costos;
    const gastos = vals.gastos;
    const resultado = ingresos - costos - gastos;
    const margenPct = ingresos !== 0 ? (resultado / ingresos) * 100 : 0;

    totalIngresos += ingresos;
    totalCostos += costos;
    totalGastos += gastos;
    totalResultado += resultado;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${evName}</td>
      <td class="num">C$ ${fmtCurrency(ingresos)}</td>
      <td class="num">C$ ${fmtCurrency(costos)}</td>
      <td class="num">C$ ${fmtCurrency(gastos)}</td>
      <td class="num">C$ ${fmtCurrency(resultado)}</td>
      <td class="num">${margenPct.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  }

  // Fila de totales
  const margenTotalPct = totalIngresos !== 0
    ? (totalResultado / totalIngresos) * 100
    : 0;

  const trTotal = document.createElement('tr');
  trTotal.classList.add('fin-row-strong');
  trTotal.innerHTML = `
    <td>Total</td>
    <td class="num">C$ ${fmtCurrency(totalIngresos)}</td>
    <td class="num">C$ ${fmtCurrency(totalCostos)}</td>
    <td class="num">C$ ${fmtCurrency(totalGastos)}</td>
    <td class="num">C$ ${fmtCurrency(totalResultado)}</td>
    <td class="num">${margenTotalPct.toFixed(1)}%</td>
  `;
  tbody.appendChild(trTotal);

  const btnExportComp = document.getElementById('btn-export-comp-eventos');
  if (btnExportComp && !btnExportComp.dataset.bound) {
    btnExportComp.addEventListener('click', () => {
      exportComparativoEventosToExcel();
    });
    btnExportComp.dataset.bound = '1';
  }
}

/* ---------- UI: helpers ---------- */

function showToast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function fillMonthYearSelects() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const months = [
    '01', '02', '03', '04', '05', '06',
    '07', '08', '09', '10', '11', '12'
  ];
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const tabMes = $('#tab-mes');
  const erMes = $('#er-mes');
  const tabAnio = $('#tab-anio');
  const erAnio = $('#er-anio');

  if (tabMes) tabMes.innerHTML = '';
  if (erMes) erMes.innerHTML = '';

  months.forEach((m, idx) => {
    if (tabMes) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = monthNames[idx];
      tabMes.appendChild(opt);
    }
    if (erMes) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = monthNames[idx];
      erMes.appendChild(opt);
    }
  });

  // Años: desde currentYear - 2 hasta currentYear + 1
  const years = [];
  for (let y = currentYear - 2; y <= currentYear + 1; y++) years.push(String(y));

  if (tabAnio) tabAnio.innerHTML = '';
  if (erAnio) erAnio.innerHTML = '';

  years.forEach(y => {
    if (tabAnio) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      tabAnio.appendChild(opt);
    }
    if (erAnio) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      erAnio.appendChild(opt);
    }
  });

  if (tabMes) tabMes.value = pad2(currentMonth);
  if (erMes) erMes.value = pad2(currentMonth);
  if (tabAnio) tabAnio.value = String(currentYear);
  if (erAnio) erAnio.value = String(currentYear);

  const bgFecha = $('#bg-fecha');
  if (bgFecha && !bgFecha.value) {
    bgFecha.value = todayStr();
  }

  const erDesde = $('#er-desde');
  const erHasta = $('#er-hasta');
  if (erDesde && erHasta) {
    const { start, end } = monthRange(currentYear, currentMonth);
    erDesde.value = start;
    erHasta.value = end;
  }

  const movFecha = $('#mov-fecha');
  if (movFecha && !movFecha.value) {
    movFecha.value = todayStr();
  }
}

function updateEventFilters(entries) {
  const eventos = buildEventList(entries);
  const selects = [
    $('#tab-evento'),
    $('#filtro-evento-diario'),
    $('#er-evento')
  ];

  selects.forEach(sel => {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'ALL';
    optAll.textContent = 'Todos los eventos';
    sel.appendChild(optAll);

    const optNone = document.createElement('option');
    optNone.value = 'NONE';
    optNone.textContent = 'Sin evento';
    sel.appendChild(optNone);

    eventos.forEach(ev => {
      const opt = document.createElement('option');
      opt.value = ev;
      opt.textContent = ev;
      sel.appendChild(opt);
    });

    if (prev && Array.from(sel.options).some(o => o.value === prev)) {
      sel.value = prev;
    } else {
      sel.value = 'ALL';
    }
  });
}

function fillCuentaSelect(data) {
  const sel = $('#mov-cuenta');
  if (!sel || !data) return;
  const tipoMov = ($('#mov-tipo')?.value) || 'ingreso';

  const cuentas = [...data.accounts].sort((a, b) =>
    String(a.code).localeCompare(String(b.code))
  );

  sel.innerHTML = '<option value="">Seleccione cuenta…</option>';

  for (const acc of cuentas) {
    const tipo = getTipoCuenta(acc);
    let permitido = false;

    if (tipoMov === 'ingreso') {
      permitido = (tipo === 'ingreso');
    } else if (tipoMov === 'egreso') {
      permitido = (tipo === 'gasto' || tipo === 'costo');
    } else {
      // ajuste: permitimos todas
      permitido = true;
    }

    if (!permitido) continue;

    const opt = document.createElement('option');
    opt.value = String(acc.code);
    opt.textContent = `${acc.code} – ${acc.nombre}`;
    sel.appendChild(opt);
  }
}

/* ---------- Render: Tablero ---------- */

function renderTablero(data) {
  const mesSel = $('#tab-mes');
  const anioSel = $('#tab-anio');
  const eventoSel = $('#tab-evento');
  if (!mesSel || !anioSel || !eventoSel) return;

  const mes = mesSel.value || pad2(new Date().getMonth() + 1);
  const anio = anioSel.value || String(new Date().getFullYear());
  const { start, end } = monthRange(Number(anio), Number(mes));
  const eventFilter = eventoSel.value || 'ALL';

  const { ingresos, costos, gastos } = calcResultadosForFilter(data, {
    desde: start,
    hasta: end,
    evento: eventFilter
  });

  const bruta = ingresos - costos;
  const neta = bruta - gastos;

  const corte = end;
  const { caja, banco } = calcCajaBancoUntilDate(data, corte);

  const tabIng = $('#tab-ingresos');
  const tabCos = $('#tab-costos');
  const tabGas = $('#tab-gastos');
  const tabRes = $('#tab-resultado');
  const tabCaja = $('#tab-caja');
  const tabBanco = $('#tab-banco');

  if (tabIng) tabIng.textContent = `C$ ${fmtCurrency(ingresos)}`;
  if (tabCos) tabCos.textContent = `C$ ${fmtCurrency(costos)}`;
  if (tabGas) tabGas.textContent = `C$ ${fmtCurrency(gastos)}`;
  if (tabRes) tabRes.textContent = `C$ ${fmtCurrency(neta)}`;
  if (tabCaja) tabCaja.textContent = `C$ ${fmtCurrency(caja)}`;
  if (tabBanco) tabBanco.textContent = `C$ ${fmtCurrency(banco)}`;
}

/* ---------- Render: Diario y Ajustes ---------- */

function renderDiario(data) {
  const tbody = $('#diario-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const tipoFilter = ($('#filtro-tipo')?.value) || 'todos';
  const eventoFilter = ($('#filtro-evento-diario')?.value) || 'ALL';
  const origenFilter = ($('#filtro-origen')?.value) || 'todos';

  const { entries, linesByEntry } = data;

  const sorted = [...entries].sort((a, b) => {
    const fa = a.fecha || '';
    const fb = b.fecha || '';
    if (fa === fb) return (a.id || 0) - (b.id || 0);
    return fa.localeCompare(fb);
  });

  for (const e of sorted) {
    const tipoMov = e.tipoMovimiento || '';
    const origen = e.origen || 'Manual';

    if (tipoFilter !== 'todos' && tipoMov !== tipoFilter) continue;
    if (!matchEvent(e, eventoFilter)) continue;
    if (origenFilter !== 'todos' && origen !== origenFilter) continue;

    const lines = linesByEntry.get(e.id) || [];
    let totalDebe = 0;
    let totalHaber = 0;
    for (const ln of lines) {
      totalDebe += Number(ln.debe || 0);
      totalHaber += Number(ln.haber || 0);
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.fecha || ''}</td>
      <td>${e.descripcion || ''}</td>
      <td>${tipoMov}</td>
      <td>${(e.evento || '').trim() || '—'}</td>
      <td>${origen}</td>
      <td class="num">C$ ${fmtCurrency(totalDebe)}</td>
      <td class="num">C$ ${fmtCurrency(totalHaber)}</td>
      <td><button type="button" class="btn-link ver-detalle" data-id="${e.id}">Ver detalle</button></td>
    `;
    tbody.appendChild(tr);
  }
}

function openDetalleModal(entryId) {
  if (!finCachedData) return;
  const { entries, linesByEntry, accountsMap } = finCachedData;
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;

  const modal = $('#detalle-modal');
  const meta = $('#detalle-meta');
  const tbody = $('#detalle-tbody');
  if (!modal || !meta || !tbody) return;

  meta.innerHTML = `
    <p><strong>Fecha:</strong> ${entry.fecha || ''}</p>
    <p><strong>Descripción:</strong> ${entry.descripcion || ''}</p>
    <p><strong>Tipo:</strong> ${entry.tipoMovimiento || ''}</p>
    <p><strong>Evento:</strong> ${(entry.evento || '').trim() || '—'}</p>
    <p><strong>Origen:</strong> ${entry.origen || 'Manual'}</p>
  `;

  tbody.innerHTML = '';
  const lines = linesByEntry.get(entry.id) || [];
  for (const ln of lines) {
    const acc = accountsMap.get(String(ln.accountCode));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ln.accountCode}</td>
      <td>${acc ? acc.nombre : ''}</td>
      <td class="num">C$ ${fmtCurrency(ln.debe || 0)}</td>
      <td class="num">C$ ${fmtCurrency(ln.haber || 0)}</td>
    `;
    tbody.appendChild(tr);
  }

  modal.classList.add('open');
}

function closeDetalleModal() {
  const modal = $('#detalle-modal');
  if (modal) modal.classList.remove('open');
}

/* ---------- Render: Estado de Resultados ---------- */

function renderEstadoResultados(data) {
  const eventoSel = $('#er-evento');
  const { desde, hasta } = getPeriodoERActual();
  const evento = eventoSel?.value || 'ALL';

  const { ingresos, costos, gastos } = calcResultadosForFilter(data, {
    desde,
    hasta,
    evento
  });

  const bruta = ingresos - costos;
  const neta = bruta - gastos;

  const elIng = $('#er-ingresos');
  const elCos = $('#er-costos');
  const elGas = $('#er-gastos');
  const elBruta = $('#er-bruta');
  const elNeta = $('#er-neta');

  if (elIng) elIng.textContent = `C$ ${fmtCurrency(ingresos)}`;
  if (elCos) elCos.textContent = `C$ ${fmtCurrency(costos)}`;
  if (elGas) elGas.textContent = `C$ ${fmtCurrency(gastos)}`;
  if (elBruta) elBruta.textContent = `C$ ${fmtCurrency(bruta)}`;
  if (elNeta) elNeta.textContent = `C$ ${fmtCurrency(neta)}`;
}

/* ---------- Render: Balance General ---------- */

function renderBalanceGeneral(data) {
  const corteInput = $('#bg-fecha');
  const corte = corteInput?.value || todayStr();
  const { activos, pasivos, patrimonio } = calcBalanceGroupsUntilDate(data, corte);
  const cuadre = activos - (pasivos + patrimonio);

  const elA = $('#bg-activos');
  const elP = $('#bg-pasivos');
  const elPt = $('#bg-patrimonio');
  const elC = $('#bg-cuadre');

  if (elA) elA.textContent = `C$ ${fmtCurrency(activos)}`;
  if (elP) elP.textContent = `C$ ${fmtCurrency(pasivos)}`;
  if (elPt) elPt.textContent = `C$ ${fmtCurrency(patrimonio)}`;
  if (elC) elC.textContent = `C$ ${fmtCurrency(cuadre)}`;
}

/* ---------- Render: Flujo de Caja ---------- */

function renderFlujoCaja(data) {
  const tbody = $('#fc-tbody');
  if (!tbody || !data) return;

  const { desde, hasta } = getPeriodoERActual();
  if (!desde || !hasta) {
    tbody.innerHTML = `
      <tr><td colspan="2">Periodo no válido para calcular flujo de caja.</td></tr>
    `;
    return;
  }

  const r = calcFlujoCajaPeriodo(data, desde, hasta);

  tbody.innerHTML = `
    <tr>
      <td>Saldo inicial (Caja + Banco)</td>
      <td class="num">C$ ${fmtCurrency(r.saldoInicial)}</td>
    </tr>
    <tr>
      <td>Entradas de efectivo – Operación</td>
      <td class="num">C$ ${fmtCurrency(r.entradasOperacion)}</td>
    </tr>
    <tr>
      <td>Salidas de efectivo – Operación</td>
      <td class="num">C$ ${fmtCurrency(r.salidasOperacion)}</td>
    </tr>
    <tr>
      <td>Entradas por aportes del dueño / capital</td>
      <td class="num">C$ ${fmtCurrency(r.entradasAportes)}</td>
    </tr>
    <tr>
      <td>Salidas por retiros del dueño</td>
      <td class="num">C$ ${fmtCurrency(r.salidasRetiros)}</td>
    </tr>
    <tr>
      <td>Entradas totales de efectivo</td>
      <td class="num">C$ ${fmtCurrency(r.entradasTotales)}</td>
    </tr>
    <tr>
      <td>Salidas totales de efectivo</td>
      <td class="num">C$ ${fmtCurrency(r.salidasTotales)}</td>
    </tr>
    <tr class="fin-row-strong">
      <td>Saldo final (Caja + Banco)</td>
      <td class="num">C$ ${fmtCurrency(r.saldoFinal)}</td>
    </tr>
  `;
}

/* ---------- Exportar a Excel (.xls compatible) ---------- */

function exportTableToExcel(table, filenameBase) {
  if (!table) {
    alert('No se encontró la tabla para exportar.');
    return;
  }
  const tbody = table.querySelector('tbody');
  if (tbody && !tbody.children.length) {
    alert('No hay datos para exportar.');
    return;
  }

  const filename = `${filenameBase}.xls`;

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
        <x:Name>Hoja1</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
      </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      <meta charset="UTF-8">
    </head>
    <body>
      ${table.outerHTML}
    </body>
    </html>
  `;

  const blob = new Blob([html], {
    type: 'application/vnd.ms-excel;charset=utf-8;'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Estado de Resultados: generamos una tabla simple en memoria
function exportEstadoResultadosToExcel(data) {
  if (!data) {
    alert('Datos de Finanzas no listos para exportar.');
    return;
  }
  const eventoSel = $('#er-evento');
  const { desde, hasta } = getPeriodoERActual();
  const evento = eventoSel?.value || 'ALL';

  const { ingresos, costos, gastos } = calcResultadosForFilter(data, {
    desde,
    hasta,
    evento
  });

  const bruta = ingresos - costos;
  const neta = bruta - gastos;

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Concepto</th>
        <th>Monto (C$)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Ingresos (4xxx)</td>
        <td class="num">${fmtCurrency(ingresos)}</td>
      </tr>
      <tr>
        <td>Costos de venta (5xxx)</td>
        <td class="num">${fmtCurrency(costos)}</td>
      </tr>
      <tr>
        <td>Gastos de operación (6xxx)</td>
        <td class="num">${fmtCurrency(gastos)}</td>
      </tr>
      <tr>
        <td>Utilidad bruta</td>
        <td class="num">${fmtCurrency(bruta)}</td>
      </tr>
      <tr>
        <td>Utilidad neta</td>
        <td class="num">${fmtCurrency(neta)}</td>
      </tr>
    </tbody>
  `;

  exportTableToExcel(table, 'Estado_Resultados_A33');
}

function exportDiarioToExcel() {
  const table = document.querySelector('#view-diario .fin-table');
  if (!table) {
    alert('No se encontró la tabla del Diario.');
    return;
  }
  const tbody = document.getElementById('diario-tbody');
  if (!tbody || !tbody.children.length) {
    alert('No hay movimientos en el Diario para exportar.');
    return;
  }
  exportTableToExcel(table, 'Diario_Finanzas_A33');
}

function exportBalanceGeneralToExcel() {
  const table = document.querySelector('#sub-bg .fin-table');
  if (!table) {
    alert('No se encontró la tabla del Balance General.');
    return;
  }
  exportTableToExcel(table, 'Balance_General_A33');
}

function exportRentabToExcel() {
  const table = document.getElementById('rentab-table');
  if (!table) {
    alert('No se encontró la tabla de rentabilidad.');
    return;
  }
  exportTableToExcel(table, 'Rentabilidad_por_presentacion_A33');
}

function exportComparativoEventosToExcel() {
  const table = document.getElementById('comp-eventos-table');
  if (!table) {
    alert('No se encontró la tabla del comparativo de eventos.');
    return;
  }
  exportTableToExcel(table, 'Comparativo_eventos_A33');
}

function exportFlujoCajaToExcel() {
  const table = document.getElementById('fc-table');
  if (!table) {
    alert('No se encontró la tabla de Flujo de Caja.');
    return;
  }
  exportTableToExcel(table, 'Flujo_Caja_A33');
}

/* ---------- Guardar movimiento manual ---------- */

async function guardarMovimientoManual() {
  if (!finCachedData) {
    await refreshAllFin();
  }

  const fecha = $('#mov-fecha')?.value || todayStr();
  const tipo = $('#mov-tipo')?.value || 'ingreso';
  const medio = $('#mov-medio')?.value || 'caja';
  const montoRaw = $('#mov-monto')?.value || '0';
  const cuentaCode = $('#mov-cuenta')?.value || '';
  const evento = ($('#mov-evento')?.value || '').trim();
  const descripcion = ($('#mov-descripcion')?.value || '').trim();

  const monto = parseFloat(montoRaw.replace(',', '.'));

  if (!fecha) {
    alert('Ingresa la fecha del movimiento.');
    return;
  }
  if (!cuentaCode) {
    alert('Selecciona la cuenta principal.');
    return;
  }
  if (!(monto > 0)) {
    alert('El monto debe ser mayor que cero.');
    return;
  }

  const cajaCode = medio === 'banco' ? '1200' : '1100';
  let debeCode;
  let haberCode;

  if (tipo === 'ingreso') {
    // DEBE: Caja/Banco · HABER: cuenta ingreso
    debeCode = cajaCode;
    haberCode = cuentaCode;
  } else if (tipo === 'egreso') {
    // DEBE: cuenta gasto/costo · HABER: Caja/Banco
    debeCode = cuentaCode;
    haberCode = cajaCode;
  } else {
    // Ajuste simple: cuenta seleccionada contra Caja/Banco (asumimos aumento en la cuenta)
    debeCode = cuentaCode;
    haberCode = cajaCode;
  }

  const entry = {
    fecha,
    descripcion: descripcion || `Movimiento ${tipo}`,
    tipoMovimiento: tipo,
    evento,
    origen: 'Manual',
    origenId: null,
    totalDebe: monto,
    totalHaber: monto
  };

  await openFinDB();
  const entryId = await finAdd('journalEntries', entry);

  const lineDebe = {
    idEntry: entryId,
    accountCode: debeCode,
    debe: monto,
    haber: 0
  };
  const lineHaber = {
    idEntry: entryId,
    accountCode: haberCode,
    debe: 0,
    haber: monto
  };

  await finAdd('journalLines', lineDebe);
  await finAdd('journalLines', lineHaber);

  // Limpia campos clave
  const montoInput = $('#mov-monto');
  const descInput = $('#mov-descripcion');
  const eventoInput = $('#mov-evento');
  if (montoInput) montoInput.value = '';
  if (descInput) descInput.value = '';
  if (eventoInput) eventoInput.value = evento; // suele repetirse por evento

  showToast('Movimiento guardado en el Diario');
  await refreshAllFin();
}

/* ---------- Tabs y eventos UI ---------- */

function setupTabs() {
  const buttons = document.querySelectorAll('.fin-tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.fin-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.fin-view').forEach(sec => {
        sec.classList.toggle('active', sec.id === `view-${view}`);
      });
    });
  });
}

function setupEstadosSubtabs() {
  const btns = document.querySelectorAll('.fin-subtab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.subview;
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.fin-subview').forEach(sec => {
        sec.classList.toggle('active', sec.id === `sub-${view}`);
      });
    });
  });
}

function setupModoERToggle() {
  const modoSel = $('#er-modo');
  const contMes = $('#er-filtros-mes');
  const contRango = $('#er-filtros-rango');
  if (!modoSel || !contMes || !contRango) return;

  const update = () => {
    const modo = modoSel.value;
    if (modo === 'mes') {
      contMes.classList.remove('hidden');
      contRango.classList.add('hidden');
    } else {
      contMes.classList.add('hidden');
      contRango.classList.remove('hidden');
    }
  };

  modoSel.addEventListener('change', () => {
    update();
    if (finCachedData) {
      renderEstadoResultados(finCachedData);
      renderRentabilidadPresentacion(finCachedData);
      renderComparativoEventos(finCachedData);
      renderFlujoCaja(finCachedData);
    }
  });

  update();
}

function setupFilterListeners() {
  // Tablero
  ['tab-mes', 'tab-anio', 'tab-evento'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (finCachedData) renderTablero(finCachedData);
    });
  });

  // Diario
  ['filtro-tipo', 'filtro-evento-diario', 'filtro-origen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (finCachedData) renderDiario(finCachedData);
    });
  });

  const movTipo = $('#mov-tipo');
  if (movTipo) {
    movTipo.addEventListener('change', () => {
      if (finCachedData) fillCuentaSelect(finCachedData);
    });
  }

  const btnGuardar = $('#mov-guardar');
  if (btnGuardar) {
    btnGuardar.addEventListener('click', () => {
      guardarMovimientoManual().catch(err => {
        console.error('Error guardando movimiento', err);
        alert('No se pudo guardar el movimiento en Finanzas.');
      });
    });
  }

  // Estados de Resultados + Rentabilidad + Comparativo eventos + Flujo de Caja
  ['er-mes', 'er-anio', 'er-desde', 'er-hasta', 'er-evento'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (finCachedData) {
        renderEstadoResultados(finCachedData);
        renderRentabilidadPresentacion(finCachedData);
        renderComparativoEventos(finCachedData);
        renderFlujoCaja(finCachedData);
      }
    });
  });

  // Balance
  const bgFecha = $('#bg-fecha');
  if (bgFecha) {
    bgFecha.addEventListener('change', () => {
      if (finCachedData) renderBalanceGeneral(finCachedData);
    });
  }

  // Detalle modal
  const cerrar = $('#detalle-cerrar');
  const modal = $('#detalle-modal');
  if (cerrar) cerrar.addEventListener('click', closeDetalleModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDetalleModal();
    });
  }

  // Delegación Ver detalle
  const diarioTbody = $('#diario-tbody');
  if (diarioTbody) {
    diarioTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.ver-detalle');
      if (!btn) return;
      const id = Number(btn.dataset.id || '0');
      if (id && finCachedData) openDetalleModal(id);
    });
  }
}

function setupExportButtons() {
  const btnDiario = $('#btn-export-diario');
  if (btnDiario) {
    btnDiario.addEventListener('click', () => {
      exportDiarioToExcel();
    });
  }

  const btnER = $('#btn-export-er');
  if (btnER) {
    btnER.addEventListener('click', () => {
      if (!finCachedData) {
        alert('Datos de Finanzas no listos para exportar.');
        return;
      }
      exportEstadoResultadosToExcel(finCachedData);
    });
  }

  const btnBG = $('#btn-export-bg');
  if (btnBG) {
    btnBG.addEventListener('click', () => {
      exportBalanceGeneralToExcel();
    });
  }

  const btnFC = $('#btn-export-fc');
  if (btnFC) {
    btnFC.addEventListener('click', () => {
      exportFlujoCajaToExcel();
    });
  }
}

/* ---------- Ciclo principal ---------- */

async function refreshAllFin() {
  finCachedData = await getAllFinData();
  const data = finCachedData;
  updateEventFilters(data.entries);
  fillCuentaSelect(data);
  renderTablero(data);
  renderDiario(data);
  renderEstadoResultados(data);
  renderBalanceGeneral(data);
  renderFlujoCaja(data);
  renderRentabilidadPresentacion(data);
  renderComparativoEventos(data);
}

async function initFinanzas() {
  try {
    await openFinDB();
    await ensureBaseAccounts();
    fillMonthYearSelects();
    setupTabs();
    setupEstadosSubtabs();
    setupModoERToggle();
    setupFilterListeners();
    setupExportButtons();
    await refreshAllFin();
  } catch (err) {
    console.error('Error inicializando Finanzas A33', err);
    alert('No se pudo inicializar el módulo de Finanzas.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initFinanzas().catch(err => {
    console.error('Error en initFinanzas', err);
  });
});
