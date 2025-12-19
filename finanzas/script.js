/* Finanzas – Suite A33 · Fase 3A
   - Contabilidad básica con IndexedDB (finanzas-db)
   - Diario + Estados financieros
   - Compras a proveedor + Proveedores
   - Exportación Excel (XLSX)

   ⚠️ Cambios mínimos: ahora el Tablero muestra "Costo cortesías (POS)" como desglose,
   sin alterar el cálculo de resultado (ya está incluido dentro de costos/gastos).
*/

(function () {

  /* ---------- Helpers DOM ---------- */

  const $ = (sel) => document.querySelector(sel);

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function fmtCurrency(num) {
    const n = Number(num || 0);
    return n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2400);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function monthRange(year, month) {
    const start = `${year}-${pad2(month)}-01`;
    const endDate = new Date(year, month, 0); // último día del mes
    const end = `${endDate.getFullYear()}-${pad2(endDate.getMonth() + 1)}-${pad2(endDate.getDate())}`;
    return { start, end };
  }

  /* ---------- IndexedDB (Finanzas) ---------- */

  const FIN_DB = 'a33-finanzas';
  const FIN_VER = 4;

  let finDB = null;

  function openFinDB() {
    if (finDB) return Promise.resolve(finDB);

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(FIN_DB, FIN_VER);

      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;

        if (!db.objectStoreNames.contains('accounts')) {
          const st = db.createObjectStore('accounts', { keyPath: 'code' });
          st.createIndex('tipo', 'tipo', { unique: false });
        }

        if (!db.objectStoreNames.contains('journal_entries')) {
          const st = db.createObjectStore('journal_entries', { keyPath: 'id' });
          st.createIndex('fecha', 'fecha', { unique: false });
          st.createIndex('tipo', 'tipo', { unique: false });
          st.createIndex('evento', 'evento', { unique: false });
          st.createIndex('origen', 'origen', { unique: false });
        }

        if (!db.objectStoreNames.contains('journal_lines')) {
          const st = db.createObjectStore('journal_lines', { keyPath: 'id' });
          st.createIndex('entryId', 'entryId', { unique: false });
          st.createIndex('accountCode', 'accountCode', { unique: false });
        }

        if (!db.objectStoreNames.contains('proveedores')) {
          db.createObjectStore('proveedores', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('compras')) {
          db.createObjectStore('compras', { keyPath: 'id' });
        }
      };

      req.onsuccess = (ev) => {
        finDB = ev.target.result;
        resolve(finDB);
      };

      req.onerror = () => reject(req.error);
    });
  }

  function txp(store, mode, fn) {
    return openFinDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const st = tx.objectStore(store);
      const out = fn(st, tx);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function getAll(store) {
    return txp(store, 'readonly', st => new Promise((resolve, reject) => {
      const req = st.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  function put(store, obj) {
    return txp(store, 'readwrite', st => new Promise((resolve, reject) => {
      const req = st.put(obj);
      req.onsuccess = () => resolve(obj);
      req.onerror = () => reject(req.error);
    }));
  }

  function del(store, key) {
    return txp(store, 'readwrite', st => new Promise((resolve, reject) => {
      const req = st.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    }));
  }

  /* ---------- Cuentas base ---------- */

  const DEFAULT_ACCOUNTS = [
    { code: '1100', name: 'Caja (C$)', tipo: 'activo' },
    { code: '1110', name: 'Caja (USD)', tipo: 'activo' },
    { code: '1200', name: 'Banco', tipo: 'activo' },
    { code: '1500', name: 'Inventario (Producto terminado)', tipo: 'activo' },
    { code: '1510', name: 'Inventario (Otros productos)', tipo: 'activo' },

    { code: '2100', name: 'Cuentas por pagar', tipo: 'pasivo' },

    { code: '4100', name: 'Ventas', tipo: 'ingreso' },
    { code: '4200', name: 'Otros ingresos', tipo: 'ingreso' },

    { code: '5100', name: 'Costo de ventas', tipo: 'costo' },

    { code: '6100', name: 'Gastos de operación', tipo: 'gasto' },
    { code: '6105', name: 'Cortesías / Promoción', tipo: 'gasto' }
  ];

  function getTipoCuenta(acc) {
    return (acc.tipo || '').toLowerCase().trim();
  }

  /* ---------- Lectura consolidada (caches) ---------- */

  async function loadAllData() {
    await openFinDB();

    // 1) cuentas
    let accounts = await getAll('accounts');
    if (!accounts || accounts.length === 0) {
      for (const acc of DEFAULT_ACCOUNTS) {
        await put('accounts', acc);
      }
      accounts = await getAll('accounts');
    }

    const accountsMap = new Map();
    for (const a of accounts) accountsMap.set(String(a.code), a);

    // 2) asientos + líneas
    const entries = await getAll('journal_entries');
    const lines = await getAll('journal_lines');

    const linesByEntry = new Map();
    for (const ln of lines) {
      const k = ln.entryId;
      if (!linesByEntry.has(k)) linesByEntry.set(k, []);
      linesByEntry.get(k).push(ln);
    }

    // 3) proveedores/compras
    const proveedores = await getAll('proveedores');
    const compras = await getAll('compras');

    return { accounts, accountsMap, entries, lines, linesByEntry, proveedores, compras };
  }

  /* ---------- Eventos (se toman del POS vía localStorage si existe) ---------- */

  function readPOSEvents() {
    // Intento leer listado de eventos del POS si existe
    // (sin romper si no existe)
    try {
      const raw = localStorage.getItem('a33_pos_eventos');
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // arr de objetos {id,nombre,...} o strings
      const names = arr.map(e => (typeof e === 'string' ? e : (e.nombre || e.name || '')).trim()).filter(Boolean);
      return [...new Set(names)];
    } catch (e) {
      return [];
    }
  }

  function displayEventLabel(ev) {
    const t = (ev || '').trim();
    if (!t) return '';
    return t;
  }

  function displayEventLabelOrDefault(ev) {
    const t = (ev || '').trim();
    return t ? t : '—';
  }

  /* ---------- Filtros comunes ---------- */

  function matchEvent(entry, eventFilter) {
    const ev = (entry.evento || '').trim();
    if (!eventFilter || eventFilter === 'ALL') return true;
    if (eventFilter === 'NONE') return !ev;
    return ev === eventFilter;
  }

  function isCortesiaPOSEntry(entry) {
    // Intentamos ser estrictos para no mezclar con asientos manuales.
    const origen = String(entry.origen || '').trim().toLowerCase();
    if (origen !== 'pos') return false;

    // Flags directos (si existen)
    if (entry.isCourtesy === true || entry.courtesy === true || entry.esCortesia === true) return true;

    const meta = entry.meta || entry.metadata || entry.extra || null;
    if (meta && (meta.isCourtesy === true || meta.courtesy === true || meta.esCortesia === true)) return true;

    const entryType = String(entry.entryType || entry.posType || entry.tipoPos || '').toLowerCase();
    if (entryType.includes('cort')) return true;

    const desc = String(entry.descripcion || entry.detalle || entry.concepto || '').toLowerCase();
    if (desc.includes('cortes')) return true;
    if (desc.includes('courtesy')) return true;

    return false;
  }

  function filterEntriesByDateAndEvent(entries, { desde, hasta, evento }) {
    return entries.filter(e => {
      const f = e.fecha || e.date || '';
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (!matchEvent(e, evento)) return false;
      return true;
    });
  }

  /* ---------- Cálculos: resultados y balances ---------- */

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

  function calcCostoCortesiasForFilter(data, filtros) {
    const { accountsMap, entries, linesByEntry } = data;
    const subsetAll = filterEntriesByDateAndEvent(entries, filtros);

    const subset = subsetAll.filter(e => {
      if (isCortesiaPOSEntry(e)) return true;

      // Heurística segura: asiento POS sin ingresos (4xxx), pero con costo/gasto y contrapartida a inventario (15xx).
      const origen = String(e.origen || '').trim().toLowerCase();
      if (origen !== 'pos') return false;

      const lines = linesByEntry.get(e.id) || [];
      let hasIngreso = false;
      let hasCostoOGasto = false;
      let hasInventario = false;

      for (const ln of lines) {
        const acc = accountsMap.get(String(ln.accountCode));
        if (!acc) continue;
        const tipo = getTipoCuenta(acc);
        const code = String(ln.accountCode || '');

        if (tipo === 'ingreso') hasIngreso = true;
        if (tipo === 'costo' || tipo === 'gasto') hasCostoOGasto = true;

        // Inventarios / existencias suelen vivir en 15xx en esta suite (1500 / 1510).
        if (code.startsWith('15')) hasInventario = true;
      }

      return (!hasIngreso && hasCostoOGasto && hasInventario);
    });

    let costoCortesias = 0;

    for (const e of subset) {
      const lines = linesByEntry.get(e.id) || [];
      for (const ln of lines) {
        const acc = accountsMap.get(String(ln.accountCode));
        if (!acc) continue;
        const tipo = getTipoCuenta(acc);
        if (tipo !== 'costo' && tipo !== 'gasto') continue;

        const debe = Number(ln.debe || 0);
        const haber = Number(ln.haber || 0);
        costoCortesias += (debe - haber);
      }
    }

    return costoCortesias;
  }

  // Agrupa por evento en un rango de fechas
  function calcResultadosByEventInRange(data, desde, hasta) {
    const { accountsMap, entries, linesByEntry } = data;
    const map = new Map(); // key: nombreEvento, value: {ingresos, costos, gastos}

    for (const e of entries) {
      const f = e.fecha || e.date || '';
      if (desde && f < desde) continue;
      if (hasta && f > hasta) continue;

      const ev = (e.evento || '').trim() || '—';
      if (!map.has(ev)) map.set(ev, { ingresos: 0, costos: 0, gastos: 0 });

      const agg = map.get(ev);
      const lines = linesByEntry.get(e.id) || [];
      for (const ln of lines) {
        const acc = accountsMap.get(String(ln.accountCode));
        if (!acc) continue;
        const tipo = getTipoCuenta(acc);
        const debe = Number(ln.debe || 0);
        const haber = Number(ln.haber || 0);

        if (tipo === 'ingreso') agg.ingresos += (haber - debe);
        else if (tipo === 'costo') agg.costos += (debe - haber);
        else if (tipo === 'gasto') agg.gastos += (debe - haber);
      }
    }

    return map;
  }

  function calcSaldosByAccountUntilDate(data, corteISO, eventFilter) {
    const { entries, linesByEntry } = data;
    const subset = entries.filter(e => {
      const f = e.fecha || e.date || '';
      if (corteISO && f > corteISO) return false;
      if (!matchEvent(e, eventFilter)) return false;
      return true;
    });

    const saldoByCode = new Map();

    for (const e of subset) {
      const lines = linesByEntry.get(e.id) || [];
      for (const ln of lines) {
        const code = String(ln.accountCode);
        const debe = Number(ln.debe || 0);
        const haber = Number(ln.haber || 0);
        const prev = saldoByCode.get(code) || 0;
        saldoByCode.set(code, prev + (debe - haber));
      }
    }

    return saldoByCode;
  }

  function calcCajaBancoUntilDate(data, corteISO) {
    const saldo = calcSaldosByAccountUntilDate(data, corteISO, 'ALL');

    const cajaC = Number(saldo.get('1100') || 0);
    const cajaU = Number(saldo.get('1110') || 0);
    const banco = Number(saldo.get('1200') || 0);

    return { caja: (cajaC + cajaU), banco };
  }

  /* ---------- UI: navegación tabs ---------- */

  function setActiveView(viewId) {
    document.querySelectorAll('.fin-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.fin-tab-btn').forEach(b => b.classList.remove('active'));

    const view = document.getElementById(viewId);
    if (view) view.classList.add('active');

    const btn = document.querySelector(`.fin-tab-btn[data-view="${viewId}"]`);
    if (btn) btn.classList.add('active');
  }

  function setActiveSubView(subId) {
    document.querySelectorAll('.fin-subview').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.fin-subtab-btn').forEach(b => b.classList.remove('active'));

    const v = document.getElementById(subId);
    if (v) v.classList.add('active');

    const btn = document.querySelector(`.fin-subtab-btn[data-subview="${subId}"]`);
    if (btn) btn.classList.add('active');
  }

  /* ---------- Render: combos (mes/año/evento) ---------- */

  function ensureMesAnioSelects() {
    const mesSel = $('#tab-mes');
    const anioSel = $('#tab-anio');
    if (mesSel && mesSel.options.length === 0) {
      for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = pad2(m);
        opt.textContent = pad2(m);
        mesSel.appendChild(opt);
      }
    }
    if (anioSel && anioSel.options.length === 0) {
      const y = new Date().getFullYear();
      for (let i = y - 3; i <= y + 1; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = String(i);
        anioSel.appendChild(opt);
      }
    }
  }

  function fillEventSelect(selectEl, events) {
    if (!selectEl) return;
    const current = selectEl.value || 'ALL';
    selectEl.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'ALL';
    optAll.textContent = 'Todos';
    selectEl.appendChild(optAll);

    const optNone = document.createElement('option');
    optNone.value = 'NONE';
    optNone.textContent = 'Sin evento';
    selectEl.appendChild(optNone);

    for (const ev of events) {
      const opt = document.createElement('option');
      opt.value = ev;
      opt.textContent = ev;
      selectEl.appendChild(opt);
    }

    selectEl.value = [...selectEl.options].some(o => o.value === current) ? current : 'ALL';
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

    const costoCortesias = calcCostoCortesiasForFilter(data, {
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
    const tabCor = $('#tab-cortesias');
    const tabGas = $('#tab-gastos');
    const tabRes = $('#tab-resultado');
    const tabCaja = $('#tab-caja');
    const tabBanco = $('#tab-banco');

    const tabBruta = document.getElementById('tab-bruta');

    if (tabIng) tabIng.textContent = `C$ ${fmtCurrency(ingresos)}`;
    if (tabCos) tabCos.textContent = `C$ ${fmtCurrency(costos)}`;
    if (tabCor) tabCor.textContent = `C$ ${fmtCurrency(costoCortesias)}`;
    if (tabBruta) tabBruta.textContent = `C$ ${fmtCurrency(bruta)}`;
    if (tabGas) tabGas.textContent = `C$ ${fmtCurrency(gastos)}`;
    if (tabRes) tabRes.textContent = `C$ ${fmtCurrency(neta)}`;
    if (tabCaja) tabCaja.textContent = `C$ ${fmtCurrency(caja)}`;
    if (tabBanco) tabBanco.textContent = `C$ ${fmtCurrency(banco)}`;
  }

  /* ---------- Render: Diario y Ajustes ---------- */

  function getSupplierLabelFromEntry(e, data) {
    // Compra: intenta resolver proveedor
    const provId = e?.meta?.proveedorId || e?.proveedorId || null;
    if (!provId) return '—';
    const p = (data.proveedores || []).find(x => x.id === provId);
    return p ? (p.nombre || '—') : '—';
  }

  function renderDiario(data) {
    const tbody = $('#diario-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const tipoFilter = ($('#filtro-tipo')?.value) || 'todos';
    const eventoFilter = ($('#filtro-evento-diario')?.value) || 'ALL';
    const origenFilter = ($('#filtro-origen')?.value) || 'todos';
    const proveedorFilter = (document.getElementById('filtro-proveedor')?.value) || 'todos';

    const { entries, linesByEntry } = data;

    const sorted = [...entries].sort((a, b) => {
      const fa = a.fecha || a.date || '';
      const fb = b.fecha || b.date || '';
      if (fa !== fb) return fa.localeCompare(fb);
      return String(a.id).localeCompare(String(b.id));
    });

    for (const e of sorted) {
      const tipoMov = e.tipo || '—';
      const tipo = (tipoMov || '').toLowerCase();
      if (tipoFilter !== 'todos' && tipo !== tipoFilter) continue;

      const origen = e.origen || 'Manual';
      if (origenFilter !== 'todos' && origen !== origenFilter) continue;

      if (!matchEvent(e, eventoFilter)) continue;

      // filtro proveedor
      if (proveedorFilter !== 'todos') {
        const provId = e?.meta?.proveedorId || e?.proveedorId || '';
        if (String(provId) !== String(proveedorFilter)) continue;
      }

      const lines = linesByEntry.get(e.id) || [];
      let totalDebe = 0;
      let totalHaber = 0;
      for (const ln of lines) {
        totalDebe += Number(ln.debe || 0);
        totalHaber += Number(ln.haber || 0);
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
      <td>${e.fecha || e.date || ''}</td>
      <td>${e.descripcion || ''}</td>
      <td>${tipoMov}</td>
      <td>${displayEventLabel((e.evento || '').trim()) || '—'}</td>
      <td>${getSupplierLabelFromEntry(e, data)}</td>
      <td>${origen}</td>
      <td class="num">C$ ${fmtCurrency(totalDebe)}</td>
      <td class="num">C$ ${fmtCurrency(totalHaber)}</td>
      <td><button type="button" class="btn-link ver-detalle" data-id="${e.id}">Ver detalle</button></td>
    `;
      tbody.appendChild(tr);
    }
  }

  /* ---------- Render: Estados financieros ---------- */

  function renderEstadoResultados(data) {
    const desde = $('#er-desde')?.value || '';
    const hasta = $('#er-hasta')?.value || '';
    const evento = $('#er-evento')?.value || 'ALL';

    const { ingresos, costos, gastos } = calcResultadosForFilter(data, { desde, hasta, evento });
    const bruta = ingresos - costos;
    const neta = bruta - gastos;

    const elIng = $('#er-ingresos');
    const elCos = $('#er-costos');
    const elGas = $('#er-gastos');
    const elBru = $('#er-bruta');
    const elNet = $('#er-neta');

    if (elIng) elIng.textContent = `C$ ${fmtCurrency(ingresos)}`;
    if (elCos) elCos.textContent = `C$ ${fmtCurrency(costos)}`;
    if (elGas) elGas.textContent = `C$ ${fmtCurrency(gastos)}`;
    if (elBru) elBru.textContent = `C$ ${fmtCurrency(bruta)}`;
    if (elNet) elNet.textContent = `C$ ${fmtCurrency(neta)}`;

    // tabla por evento dentro del rango
    const tbody = $('#er-eventos-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const map = calcResultadosByEventInRange(data, desde, hasta);
    const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [ev, agg] of rows) {
      const br = agg.ingresos - agg.costos;
      const net = br - agg.gastos;

      const tr = document.createElement('tr');
      tr.innerHTML = `
      <td>${ev}</td>
      <td class="num">C$ ${fmtCurrency(agg.ingresos)}</td>
      <td class="num">C$ ${fmtCurrency(agg.costos)}</td>
      <td class="num">C$ ${fmtCurrency(agg.gastos)}</td>
      <td class="num">C$ ${fmtCurrency(net)}</td>
    `;
      tbody.appendChild(tr);
    }
  }

  function renderBalance(data) {
    const corte = $('#bg-fecha')?.value || todayISO();
    const evento = $('#bg-evento')?.value || 'ALL';

    const saldoBy = calcSaldosByAccountUntilDate(data, corte, evento);

    const tbody = $('#bg-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = [...saldoBy.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const [code, saldo] of rows) {
      const acc = data.accountsMap.get(String(code));
      const name = acc ? acc.name : '(Cuenta)';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${code} · ${name}</td>
        <td class="num">C$ ${fmtCurrency(saldo)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  /* ---------- Proveedores (CRUD) ---------- */

  function genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function renderProveedores(data) {
    const tbody = document.getElementById('proveedores-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const provs = (data.proveedores || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    for (const p of provs) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.nombre || ''}</td>
        <td>${p.telefono || '—'}</td>
        <td>${p.nota || '—'}</td>
        <td class="fin-actions-cell">
          <div class="fin-actions">
            <button type="button" class="btn-small btn-edit-prov" data-id="${p.id}">Editar</button>
            <button type="button" class="btn-danger btn-del-prov" data-id="${p.id}">Eliminar</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  function fillProveedorSelect(selectEl, proveedores) {
    if (!selectEl) return;
    const curr = selectEl.value || '';
    selectEl.innerHTML = '';

    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Selecciona...';
    selectEl.appendChild(opt0);

    const provs = (proveedores || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    for (const p of provs) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nombre || '';
      selectEl.appendChild(opt);
    }

    selectEl.value = [...selectEl.options].some(o => o.value === curr) ? curr : '';
  }

  /* ---------- Compras ---------- */

  function normalizeEventForPurchases() {
    const el = document.getElementById('compra-evento');
    const v = el ? el.value : 'ALL';
    if (!v || v === 'ALL') return '';
    if (v === 'NONE') return '';
    return v;
  }

  async function handleCompraSubmit(ev) {
    ev.preventDefault();
    const proveedorId = document.getElementById('compra-proveedor')?.value || '';
    const descripcion = document.getElementById('compra-descripcion')?.value || '';
    const fecha = document.getElementById('compra-fecha')?.value || todayISO();
    const monto = Number(document.getElementById('compra-monto')?.value || 0);
    const tipoCompra = document.getElementById('compra-tipo')?.value || 'inventario';

    if (!proveedorId) return toast('Selecciona un proveedor.');
    if (!monto || monto <= 0) return toast('Monto inválido.');

    // Guardar compra (registro)
    const compra = {
      id: genId('compra'),
      proveedorId,
      descripcion,
      fecha,
      monto,
      tipoCompra,
      evento: normalizeEventForPurchases()
    };

    // Crear asiento contable (simple)
    const entryId = genId('je');
    const entry = {
      id: entryId,
      fecha,
      descripcion: `Compra: ${descripcion || '—'}`,
      tipo: 'egreso',
      evento: normalizeEventForPurchases(),
      origen: 'Manual',
      origenId: null,
      totalDebe: monto,
      totalHaber: monto,

      // Metadata compras
      entryType: 'purchase',
      meta: {
        proveedorId,
        compraId: compra.id,
        tipoCompra
      }
    };

    const lines = [];

    // Inventario o gasto
    if (tipoCompra === 'inventario') {
      lines.push({
        id: genId('jl'),
        entryId,
        accountCode: '1500',
        debe: monto,
        haber: 0
      });
    } else {
      lines.push({
        id: genId('jl'),
        entryId,
        accountCode: '6100',
        debe: monto,
        haber: 0
      });
    }

    // Contrapartida: CxP
    lines.push({
      id: genId('jl'),
      entryId,
      accountCode: '2100',
      debe: 0,
      haber: monto
    });

    await put('compras', compra);
    await put('journal_entries', entry);

    for (const ln of lines) await put('journal_lines', ln);

    toast('Compra registrada.');

    // limpiar
    document.getElementById('compra-descripcion').value = '';
    document.getElementById('compra-monto').value = '0';

    // refresh
    init();
  }

  /* ---------- Modal detalle ---------- */

  function openDetalleModal(entryId, data) {
    const modal = document.getElementById('modal-detalle');
    if (!modal) return;
    modal.classList.add('open');

    const entry = (data.entries || []).find(e => e.id === entryId);
    const lines = data.linesByEntry.get(entryId) || [];

    const meta = document.getElementById('detalle-meta');
    const tbody = document.getElementById('detalle-lines');

    if (meta) {
      const ev = displayEventLabelOrDefault(entry?.evento || '');
      const origen = entry?.origen || 'Manual';
      meta.innerHTML = `
        <p><strong>Fecha:</strong> ${entry?.fecha || entry?.date || ''}</p>
        <p><strong>Descripción:</strong> ${entry?.descripcion || ''}</p>
        <p><strong>Tipo:</strong> ${entry?.tipo || '—'}</p>
        <p><strong>Evento:</strong> ${ev}</p>
        <p><strong>Origen:</strong> ${origen}</p>
      `;
    }

    if (tbody) {
      tbody.innerHTML = '';
      for (const ln of lines) {
        const acc = data.accountsMap.get(String(ln.accountCode));
        const name = acc ? acc.name : '(Cuenta)';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${ln.accountCode}</td>
          <td>${name}</td>
          <td class="num">C$ ${fmtCurrency(ln.debe)}</td>
          <td class="num">C$ ${fmtCurrency(ln.haber)}</td>
        `;
        tbody.appendChild(tr);
      }
    }
  }

  function closeDetalleModal() {
    const modal = document.getElementById('modal-detalle');
    if (!modal) return;
    modal.classList.remove('open');
  }

  /* ---------- Exportación Excel ---------- */

  function exportToXLSX(filename, sheets) {
    try {
      const wb = XLSX.utils.book_new();
      for (const s of sheets) {
        const ws = XLSX.utils.aoa_to_sheet(s.data);
        XLSX.utils.book_append_sheet(wb, ws, s.name || 'Hoja');
      }
      XLSX.writeFile(wb, filename);
    } catch (e) {
      toast('No se pudo exportar (XLSX).');
    }
  }

  function exportTablero(data) {
    const mes = $('#tab-mes')?.value || pad2(new Date().getMonth() + 1);
    const anio = $('#tab-anio')?.value || String(new Date().getFullYear());
    const evento = $('#tab-evento')?.value || 'ALL';

    const { start, end } = monthRange(Number(anio), Number(mes));

    const { ingresos, costos, gastos } = calcResultadosForFilter(data, { desde: start, hasta: end, evento });
    const costoCortesias = calcCostoCortesiasForFilter(data, { desde: start, hasta: end, evento });

    const bruta = ingresos - costos;
    const neta = bruta - gastos;

    const aoa = [
      ['Suite A33 – Tablero Finanzas'],
      ['Mes', mes, 'Año', anio, 'Evento', (evento === 'ALL' ? 'Todos' : (evento === 'NONE' ? 'Sin evento' : evento))],
      [],
      ['Ingresos', ingresos],
      ['Costos', costos],
      ['Costo cortesías (POS)', costoCortesias],
      ['Margen bruto', bruta],
      ['Gastos', gastos],
      ['Resultado neto', neta]
    ];

    exportToXLSX(`Tablero_Finanzas_${anio}-${mes}.xlsx`, [{ name: 'Tablero', data: aoa }]);
  }

  function exportDiario(data) {
    const tipoFilter = ($('#filtro-tipo')?.value) || 'todos';
    const eventoFilter = ($('#filtro-evento-diario')?.value) || 'ALL';
    const origenFilter = ($('#filtro-origen')?.value) || 'todos';
    const proveedorFilter = (document.getElementById('filtro-proveedor')?.value) || 'todos';

    const { entries, linesByEntry } = data;

    const aoa = [
      ['Fecha', 'Descripción', 'Tipo', 'Evento', 'Proveedor', 'Origen', 'Debe', 'Haber']
    ];

    const sorted = [...entries].sort((a, b) => {
      const fa = a.fecha || a.date || '';
      const fb = b.fecha || b.date || '';
      if (fa !== fb) return fa.localeCompare(fb);
      return String(a.id).localeCompare(String(b.id));
    });

    for (const e of sorted) {
      const tipoMov = e.tipo || '—';
      const tipo = (tipoMov || '').toLowerCase();
      if (tipoFilter !== 'todos' && tipo !== tipoFilter) continue;

      const origen = e.origen || 'Manual';
      if (origenFilter !== 'todos' && origen !== origenFilter) continue;

      if (!matchEvent(e, eventoFilter)) continue;

      if (proveedorFilter !== 'todos') {
        const provId = e?.meta?.proveedorId || e?.proveedorId || '';
        if (String(provId) !== String(proveedorFilter)) continue;
      }

      const lines = linesByEntry.get(e.id) || [];
      let totalDebe = 0;
      let totalHaber = 0;
      for (const ln of lines) {
        totalDebe += Number(ln.debe || 0);
        totalHaber += Number(ln.haber || 0);
      }

      aoa.push([
        e.fecha || e.date || '',
        e.descripcion || '',
        tipoMov,
        displayEventLabelOrDefault(e.evento || ''),
        getSupplierLabelFromEntry(e, data),
        origen,
        totalDebe,
        totalHaber
      ]);
    }

    exportToXLSX(`Diario_Finanzas.xlsx`, [{ name: 'Diario', data: aoa }]);
  }

  function exportER(data) {
    const desde = $('#er-desde')?.value || '';
    const hasta = $('#er-hasta')?.value || '';
    const evento = $('#er-evento')?.value || 'ALL';

    const { ingresos, costos, gastos } = calcResultadosForFilter(data, { desde, hasta, evento });
    const bruta = ingresos - costos;
    const neta = bruta - gastos;

    const aoa = [
      ['Suite A33 – Estado de Resultados'],
      ['Desde', desde || '(sin)', 'Hasta', hasta || '(sin)', 'Evento', (evento === 'ALL' ? 'Todos' : (evento === 'NONE' ? 'Sin evento' : evento))],
      [],
      ['Ingresos', ingresos],
      ['Costos', costos],
      ['Margen bruto', bruta],
      ['Gastos', gastos],
      ['Resultado neto', neta]
    ];

    exportToXLSX(`Estado_Resultados.xlsx`, [{ name: 'ER', data: aoa }]);
  }

  function exportBG(data) {
    const corte = $('#bg-fecha')?.value || todayISO();
    const evento = $('#bg-evento')?.value || 'ALL';

    const saldoBy = calcSaldosByAccountUntilDate(data, corte, evento);

    const aoa = [
      ['Suite A33 – Balance General'],
      ['Fecha corte', corte, 'Evento', (evento === 'ALL' ? 'Todos' : (evento === 'NONE' ? 'Sin evento' : evento))],
      [],
      ['Cuenta', 'Saldo']
    ];

    const rows = [...saldoBy.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const [code, saldo] of rows) {
      const acc = data.accountsMap.get(String(code));
      const name = acc ? acc.name : '(Cuenta)';
      aoa.push([`${code} · ${name}`, saldo]);
    }

    exportToXLSX(`Balance_General.xlsx`, [{ name: 'Balance', data: aoa }]);
  }

  /* ---------- Init + eventos ---------- */

  async function init() {
    const data = await loadAllData();

    // selects base
    ensureMesAnioSelects();

    // eventos (desde POS si existe)
    const events = readPOSEvents();

    fillEventSelect($('#tab-evento'), events);
    fillEventSelect($('#filtro-evento-diario'), events);
    fillEventSelect($('#er-evento'), events);
    fillEventSelect($('#bg-evento'), events);
    fillEventSelect($('#compra-evento'), events);

    // proveedores
    renderProveedores(data);
    fillProveedorSelect(document.getElementById('compra-proveedor'), data.proveedores);

    // defaults fechas estados
    if ($('#er-hasta') && !$('#er-hasta').value) $('#er-hasta').value = todayISO();
    if ($('#er-desde') && !$('#er-desde').value) {
      const d = new Date();
      d.setDate(1);
      $('#er-desde').value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
    if ($('#bg-fecha') && !$('#bg-fecha').value) $('#bg-fecha').value = todayISO();
    if ($('#compra-fecha') && !$('#compra-fecha').value) $('#compra-fecha').value = todayISO();

    // render
    renderTablero(data);
    renderDiario(data);
    renderEstadoResultados(data);
    renderBalance(data);

    // listeners navegación tabs
    document.querySelectorAll('.fin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveView(btn.getAttribute('data-view'));
      });
    });
    document.querySelectorAll('.fin-subtab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveSubView(btn.getAttribute('data-subview'));
      });
    });

    // filtros Tablero
    ['tab-mes', 'tab-anio', 'tab-evento'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => renderTablero(data));
    });

    // filtros Diario
    ['filtro-tipo', 'filtro-evento-diario', 'filtro-proveedor', 'filtro-origen'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => renderDiario(data));
    });

    // filtros Estados
    ['er-desde', 'er-hasta', 'er-evento'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => renderEstadoResultados(data));
    });
    ['bg-fecha', 'bg-evento'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => renderBalance(data));
    });

    // export
    document.getElementById('btn-export-tablero')?.addEventListener('click', () => exportTablero(data));
    document.getElementById('btn-export-diario')?.addEventListener('click', () => exportDiario(data));
    document.getElementById('btn-export-er')?.addEventListener('click', () => exportER(data));
    document.getElementById('btn-export-bg')?.addEventListener('click', () => exportBG(data));

    // compras
    document.getElementById('form-compra')?.addEventListener('submit', handleCompraSubmit);

    // proveedores CRUD
    document.getElementById('form-proveedor')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nombre = document.getElementById('prov-nombre')?.value?.trim() || '';
      const telefono = document.getElementById('prov-telefono')?.value?.trim() || '';
      const nota = document.getElementById('prov-nota')?.value?.trim() || '';
      if (!nombre) return toast('Nombre requerido.');

      const prov = { id: genId('prov'), nombre, telefono, nota };
      await put('proveedores', prov);
      toast('Proveedor guardado.');

      document.getElementById('prov-nombre').value = '';
      document.getElementById('prov-telefono').value = '';
      document.getElementById('prov-nota').value = '';

      init();
    });

    document.getElementById('proveedores-tbody')?.addEventListener('click', async (ev) => {
      const btnDel = ev.target.closest('.btn-del-prov');
      const btnEdit = ev.target.closest('.btn-edit-prov');

      if (btnDel) {
        const id = btnDel.getAttribute('data-id');
        if (!id) return;
        if (!confirm('¿Eliminar proveedor?')) return;
        await del('proveedores', id);
        toast('Proveedor eliminado.');
        init();
      }

      if (btnEdit) {
        const id = btnEdit.getAttribute('data-id');
        if (!id) return;
        const p = (data.proveedores || []).find(x => x.id === id);
        if (!p) return;

        const nuevoNombre = prompt('Nombre proveedor:', p.nombre || '');
        if (nuevoNombre === null) return;

        const nuevoTelefono = prompt('Teléfono (opcional):', p.telefono || '');
        if (nuevoTelefono === null) return;

        const nuevaNota = prompt('Nota (opcional):', p.nota || '');
        if (nuevaNota === null) return;

        p.nombre = (nuevoNombre || '').trim();
        p.telefono = (nuevoTelefono || '').trim();
        p.nota = (nuevaNota || '').trim();

        await put('proveedores', p);
        toast('Proveedor actualizado.');
        init();
      }
    });

    // detalle modal (diario)
    document.getElementById('diario-tbody')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.ver-detalle');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;
      openDetalleModal(id, data);
    });

    document.getElementById('btn-cerrar-modal')?.addEventListener('click', closeDetalleModal);
    document.getElementById('modal-detalle')?.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'modal-detalle') closeDetalleModal();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(() => toast('Error iniciando Finanzas.'));
  });

})();
