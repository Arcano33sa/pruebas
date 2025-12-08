// Finanzas A33 · Fase 2B (reportes)
// Mini contabilidad manual con:
// - Diario con origen (Manual/POS) y filtros.
// - Tablero filtrable por mes y evento.
// - Estado de Resultados filtrable por mes / rango y por evento.
// NO toca POS, Inventario, Lotes ni Pedidos.

(function(){
  const DB_NAME = 'finanzasDB';
  const DB_VERSION = 1;

  let db = null;
  let accounts = [];
  let accountsByCode = {};
  let entries = [];
  let lines = [];

  // Catálogo base de cuentas
  const DEFAULT_ACCOUNTS = [
    // 1xxx Activos
    { code: '1100', name: 'Caja general', type: 'activo', systemProtected: true },
    { code: '1110', name: 'Caja eventos', type: 'activo', systemProtected: true },
    { code: '1200', name: 'Banco', type: 'activo', systemProtected: true },
    { code: '1300', name: 'Clientes (crédito)', type: 'activo', systemProtected: true },
    { code: '1310', name: 'Deudores varios', type: 'activo', systemProtected: true },
    { code: '1400', name: 'Inventario insumos líquidos', type: 'activo', systemProtected: true },
    { code: '1410', name: 'Inventario insumos de empaque', type: 'activo', systemProtected: true },
    { code: '1500', name: 'Inventario producto terminado A33', type: 'activo', systemProtected: true },
    { code: '1900', name: 'Otros activos', type: 'activo', systemProtected: false },

    // 2xxx Pasivos
    { code: '2100', name: 'Proveedores de insumos', type: 'pasivo', systemProtected: true },
    { code: '2110', name: 'Proveedores de servicios y eventos', type: 'pasivo', systemProtected: true },
    { code: '2200', name: 'Acreedores varios', type: 'pasivo', systemProtected: true },
    { code: '2900', name: 'Otros pasivos', type: 'pasivo', systemProtected: false },

    // 3xxx Patrimonio
    { code: '3100', name: 'Capital aportado A33', type: 'patrimonio', systemProtected: true },
    { code: '3200', name: 'Aportes adicionales del dueño', type: 'patrimonio', systemProtected: true },
    { code: '3300', name: 'Retiros del dueño', type: 'patrimonio', systemProtected: true },
    { code: '3900', name: 'Resultados acumulados', type: 'patrimonio', systemProtected: true },

    // 4xxx Ingresos
    { code: '4100', name: 'Ingresos por ventas Arcano 33 (general)', type: 'ingreso', systemProtected: true },
    { code: '4200', name: 'Ingresos por otros productos', type: 'ingreso', systemProtected: false },
    { code: '4210', name: 'Ingresos por talleres / workshop', type: 'ingreso', systemProtected: false },

    // 5xxx Costos de venta
    { code: '5100', name: 'Costo de ventas Arcano 33 (general)', type: 'costo', systemProtected: true },

    // 6xxx Gastos de operación
    { code: '6100', name: 'Gastos de eventos – generales', type: 'gasto', systemProtected: true },
    { code: '6105', name: 'Gastos de publicidad y marketing', type: 'gasto', systemProtected: true },
    { code: '6106', name: 'Impuesto cuota fija', type: 'gasto', systemProtected: true },
    { code: '6110', name: 'Servicios (luz/agua/teléfono, etc.)', type: 'gasto', systemProtected: true },
    { code: '6120', name: 'Gastos de delivery / envíos', type: 'gasto', systemProtected: true },
    { code: '6130', name: 'Gastos varios A33', type: 'gasto', systemProtected: true },

    // 7xxx Otros ingresos/gastos
    { code: '7100', name: 'Otros ingresos varios', type: 'ingreso', systemProtected: false },
    { code: '7200', name: 'Otros gastos varios', type: 'gasto', systemProtected: false }
  ];

  /* ===========================
   *   IndexedDB
   * =========================== */

  function openDatabase(){
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('accounts')){
          const accountsStore = db.createObjectStore('accounts', { keyPath: 'code' });
          accountsStore.createIndex('type', 'type', { unique: false });
        }

        if (!db.objectStoreNames.contains('journalEntries')){
          const entriesStore = db.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
          entriesStore.createIndex('date', 'date', { unique: false });
          entriesStore.createIndex('type', 'tipoMovimiento', { unique: false });
          entriesStore.createIndex('evento', 'evento', { unique: false });
          entriesStore.createIndex('origen', 'origen', { unique: false });
          entriesStore.createIndex('origenId', 'origenId', { unique: false });
        }

        if (!db.objectStoreNames.contains('journalLines')){
          const linesStore = db.createObjectStore('journalLines', { keyPath: 'id', autoIncrement: true });
          linesStore.createIndex('entryId', 'entryId', { unique: false });
          linesStore.createIndex('accountCode', 'accountCode', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  function seedAccountsIfNeeded(){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      const store = tx.objectStore('accounts');
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result === 0){
          DEFAULT_ACCOUNTS.forEach(acc => store.put(acc));
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  function loadAccounts(){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readonly');
      const store = tx.objectStore('accounts');
      const req = store.getAll();
      req.onsuccess = (ev) => {
        accounts = ev.target.result || [];
        accountsByCode = {};
        accounts.forEach(a => {
          accountsByCode[a.code] = a;
        });
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function loadLines(){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('journalLines', 'readonly');
      const store = tx.objectStore('journalLines');
      const req = store.getAll();
      req.onsuccess = (ev) => {
        lines = ev.target.result || [];
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function loadEntries(){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('journalEntries', 'readonly');
      const store = tx.objectStore('journalEntries');
      const req = store.getAll();
      req.onsuccess = (ev) => {
        entries = (ev.target.result || []).sort((a,b) => (a.date || '').localeCompare(b.date || ''));
        // Normalizar origen/origenId para asientos antiguos
        entries.forEach(e => {
          if (!e.origen) e.origen = 'Manual';
          if (typeof e.origenId === 'undefined') e.origenId = null;
        });
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function reloadData(){
    if (!db) return Promise.resolve();
    return Promise.all([
      loadEntries(),
      loadLines()
    ]).then(() => {
      refreshEventFilters();
      renderAll();
    });
  }

  /* ===========================
   *   Utilidades
   * =========================== */

  function formatCurrency(value){
    const n = Number(value) || 0;
    return `C$ ${n.toLocaleString('es-NI', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function round2(n){
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function formatDateInput(date){
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatMonthKeyFromDate(date){
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function capitalize(str){
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Caja vs Banco manual (Fase 2: todavía sin POS)
  function resolveCashAccount(medium, evento){
    if (medium === 'caja'){
      return '1100';
    }
    if (medium === 'banco'){
      return '1200';
    }
    return null;
  }

  function getSelectedValue(id){
    const el = document.getElementById(id);
    return el ? el.value : null;
  }

  /* ===========================
   *   Eventos / filtros por evento
   * =========================== */

  function collectJournalEvents(){
    const set = new Set();
    (entries || []).forEach(e => {
      if (!e) return;
      const ev = (e.evento || '').trim();
      if (ev) set.add(ev);
    });
    return Array.from(set).sort((a,b) => a.localeCompare(b));
  }

  function populateEventSelect(selectId, events, options){
    const select = document.getElementById(selectId);
    if (!select) return;

    const previous = select.value;
    select.innerHTML = '';

    // Opción "Todos"
    const optAll = document.createElement('option');
    optAll.value = '__all__';
    optAll.textContent = options.allLabel || 'Todos los eventos';
    select.appendChild(optAll);

    if (options.includeNone){
      const optNone = document.createElement('option');
      optNone.value = '__none__';
      optNone.textContent = options.noneLabel || 'Sin evento';
      select.appendChild(optNone);
    }

    events.forEach(ev => {
      const opt = document.createElement('option');
      opt.value = ev;
      opt.textContent = ev;
      select.appendChild(opt);
    });

    if (previous && Array.from(select.options).some(o => o.value === previous)){
      select.value = previous;
    } else {
      select.value = '__all__';
    }
  }

  function refreshEventFilters(){
    const events = collectJournalEvents();

    // Diario
    populateEventSelect('journal-filter-event', events, {
      allLabel: 'Todos los eventos',
      includeNone: true,
      noneLabel: 'Sin evento'
    });

    // Tablero
    populateEventSelect('dashboard-event', events, {
      allLabel: 'Todos los eventos',
      includeNone: false
    });

    // Estado de Resultados
    populateEventSelect('er-event', events, {
      allLabel: 'Todos los eventos',
      includeNone: true,
      noneLabel: 'Sin evento'
    });
  }

  // Compatibilidad con nombre anterior usado en Fase 2A
  function refreshJournalFilters(){
    refreshEventFilters();
  }

  function applyJournalFilters(allEntries){
    let result = (allEntries || []).slice();

    const typeFilter = getSelectedValue('journal-filter-type') || 'todos';
    const eventFilter = getSelectedValue('journal-filter-event') || '__all__';
    const originFilter = getSelectedValue('journal-filter-origin') || '__all__';

    if (typeFilter !== 'todos'){
      result = result.filter(e => (e.tipoMovimiento || '') === typeFilter);
    }

    if (eventFilter === '__none__'){
      result = result.filter(e => !e.evento || !String(e.evento).trim());
    } else if (eventFilter !== '__all__'){
      result = result.filter(e => (e.evento || '').trim() === eventFilter);
    }

    if (originFilter !== '__all__'){
      result = result.filter(e => {
        const origen = e.origen || 'Manual';
        return origen === originFilter;
      });
    }

    return result;
  }

  /* ===========================
   *   Inicialización
   * =========================== */

  function initApp(){
    openDatabase()
      .then(() => seedAccountsIfNeeded())
      .then(() => loadAccounts())
      .then(() => reloadData())
      .then(() => {
        initNavigation();
        initJournalForm();
        initFilters();
      })
      .catch((err) => {
        console.error('[Finanzas] Error inicializando la base de datos', err);
        alert('No se pudo inicializar el módulo de Finanzas.');
      });
  }

  function initNavigation(){
    // Tabs principales
    const links = document.querySelectorAll('.nav-link[data-tab]');
    const panels = document.querySelectorAll('.tab-panel');
    links.forEach(link => {
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        const tabId = link.getAttribute('data-tab');
        links.forEach(l => l.classList.remove('nav-link-active'));
        link.classList.add('nav-link-active');
        panels.forEach(p => {
          p.classList.toggle('active', p.id === tabId);
        });
      });
    });

    // Subtabs Estados
    const subtabs = document.querySelectorAll('.subtab-btn');
    const subpanels = document.querySelectorAll('.subtab-panel');
    subtabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-subtab');
        subtabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        subpanels.forEach(p => {
          p.classList.toggle('active', p.id === `subtab-${target}`);
        });
      });
    });
  }

  function initJournalForm(){
    const form = document.getElementById('journal-form');
    if (!form) return;

    const typeSelect = document.getElementById('movement-type');
    const accountSelect = document.getElementById('movement-account');

    const today = new Date();
    const dateInput = document.getElementById('movement-date');
    if (dateInput){
      dateInput.value = formatDateInput(today);
    }

    function refreshAccountOptions(){
      if (!typeSelect || !accountSelect) return;
      const tipo = typeSelect.value;
      const allowedTypes = tipo === 'ingreso'
        ? ['ingreso']
        : (tipo === 'egreso' ? ['gasto'] : ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto', 'costo']);

      accountSelect.innerHTML = '<option value="">Selecciona una cuenta…</option>';
      accounts
        .filter(a => allowedTypes.includes(a.type))
        .forEach(acc => {
          const opt = document.createElement('option');
          opt.value = acc.code;
          opt.textContent = `${acc.code} – ${acc.name}`;
          accountSelect.appendChild(opt);
        });
    }

    refreshAccountOptions();
    if (typeSelect){
      typeSelect.addEventListener('change', refreshAccountOptions);
    }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      handleJournalSubmit();
    });
  }

  function handleJournalSubmit(){
    if (!db) return;
    const dateInput = document.getElementById('movement-date');
    const typeSelect = document.getElementById('movement-type');
    const mediumSelect = document.getElementById('movement-medium');
    const accountSelect = document.getElementById('movement-account');
    const amountInput = document.getElementById('movement-amount');
    const eventInput = document.getElementById('movement-event');
    const descriptionInput = document.getElementById('movement-description');

    const date = (dateInput && dateInput.value) ? dateInput.value : formatDateInput(new Date());
    const tipo = typeSelect ? typeSelect.value : 'ingreso';
    const medio = mediumSelect ? mediumSelect.value : 'caja';
    const accountCode = accountSelect ? accountSelect.value : null;
    const amount = Number(amountInput ? amountInput.value : 0);

    const evento = eventInput ? (eventInput.value || '').trim() : '';
    const descripcion = descriptionInput ? (descriptionInput.value || '').trim() : '';

    if (!accountCode || !amount || amount <= 0){
      alert('Por favor ingresa un monto y selecciona una cuenta válida.');
      return;
    }

    const cashAccount = resolveCashAccount(medio, evento);
    if (!cashAccount){
      alert('No se pudo determinar la cuenta de caja/banco.');
      return;
    }

    const tx = db.transaction(['journalEntries', 'journalLines'], 'readwrite');
    const entriesStore = tx.objectStore('journalEntries');
    const linesStore = tx.objectStore('journalLines');

    const entry = {
      date,
      descripcion,
      tipoMovimiento: tipo,
      evento,
      origen: 'Manual',
      origenId: null,
      totalDebe: round2(amount),
      totalHaber: round2(amount)
    };

    const addReq = entriesStore.add(entry);
    addReq.onsuccess = (ev) => {
      const entryId = ev.target.result;

      const createLine = (data) => {
        const lineReq = linesStore.add(Object.assign({ entryId }, data));
        lineReq.onerror = (e) => console.error('[Finanzas] Error al guardar línea', e.target.error);
      };

      if (tipo === 'ingreso'){
        // DEBE: Caja/Banco, HABER: Ingreso
        createLine({
          accountCode: cashAccount,
          debe: round2(amount),
          haber: 0
        });
        createLine({
          accountCode,
          debe: 0,
          haber: round2(amount)
        });
      } else if (tipo === 'egreso'){
        // DEBE: Gasto, HABER: Caja/Banco
        createLine({
          accountCode,
          debe: round2(amount),
          haber: 0
        });
        createLine({
          accountCode: cashAccount,
          debe: 0,
          haber: round2(amount)
        });
      } else {
        // Ajuste simple: mover entre caja/banco y la cuenta seleccionada
        createLine({
          accountCode,
          debe: round2(amount),
          haber: 0
        });
        createLine({
          accountCode: cashAccount,
          debe: 0,
          haber: round2(amount)
        });
      }

      tx.oncomplete = () => {
        entries.push(Object.assign({ id: entryId }, entry));
        entries.forEach(e => {
          if (!e.origen) e.origen = 'Manual';
          if (typeof e.origenId === 'undefined') e.origenId = null;
        });
        reloadData();
        if (amountInput) amountInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
      };
    };

    addReq.onerror = (e) => {
      console.error('[Finanzas] Error al guardar movimiento', e.target.error);
      alert('No se pudo guardar el movimiento.');
    };
  }

  function updateErFiltersVisibility(){
    const modeSelect = document.getElementById('er-mode');
    const monthWrapper = document.getElementById('er-month-wrapper');
    const startWrapper = document.getElementById('er-start-wrapper');
    const endWrapper = document.getElementById('er-end-wrapper');
    if (!modeSelect) return;

    const mode = modeSelect.value || 'mes';
    if (mode === 'mes'){
      if (monthWrapper) monthWrapper.style.display = '';
      if (startWrapper) startWrapper.style.display = 'none';
      if (endWrapper) endWrapper.style.display = 'none';
    } else {
      if (monthWrapper) monthWrapper.style.display = 'none';
      if (startWrapper) startWrapper.style.display = '';
      if (endWrapper) endWrapper.style.display = '';
    }
  }

  function initFilters(){
    const today = new Date();
    const monthKey = formatMonthKeyFromDate(today);

    const dashMonth = document.getElementById('dashboard-month');
    const dashEvent = document.getElementById('dashboard-event');
    const erMode = document.getElementById('er-mode');
    const erMonth = document.getElementById('er-month');
    const erStart = document.getElementById('er-start');
    const erEnd = document.getElementById('er-end');
    const erEvent = document.getElementById('er-event');
    const bgDate = document.getElementById('bg-date');

    const journalType = document.getElementById('journal-filter-type');
    const journalEvent = document.getElementById('journal-filter-event');
    const journalOrigin = document.getElementById('journal-filter-origin');

    if (dashMonth) dashMonth.value = monthKey;
    if (erMonth) erMonth.value = monthKey;

    // Rango inicial = mes actual
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if (erStart) erStart.value = formatDateInput(firstDay);
    if (erEnd) erEnd.value = formatDateInput(lastDay);

    if (bgDate) bgDate.value = formatDateInput(today);

    // Listeners
    if (dashMonth) dashMonth.addEventListener('change', renderDashboard);
    if (dashEvent) dashEvent.addEventListener('change', renderDashboard);

    if (erMode) erMode.addEventListener('change', () => {
      updateErFiltersVisibility();
      renderEstadoResultados();
    });
    if (erMonth) erMonth.addEventListener('change', renderEstadoResultados);
    if (erStart) erStart.addEventListener('change', renderEstadoResultados);
    if (erEnd) erEnd.addEventListener('change', renderEstadoResultados);
    if (erEvent) erEvent.addEventListener('change', renderEstadoResultados);

    if (bgDate) bgDate.addEventListener('change', () => {
      renderBalanceGeneral();
      renderDashboard(); // saldos se calculan hasta esa fecha
    });

    if (journalType) journalType.addEventListener('change', renderJournalTable);
    if (journalEvent) journalEvent.addEventListener('change', renderJournalTable);
    if (journalOrigin) journalOrigin.addEventListener('change', renderJournalTable);

    updateErFiltersVisibility();
    renderDashboard();
    renderEstadoResultados();
    renderBalanceGeneral();
  }

  function renderAll(){
    renderDashboard();
    renderJournalTable();
    renderEstadoResultados();
    renderBalanceGeneral();
  }

  /* ===========================
   *   Tablero Finanzas
   * =========================== */

  function renderDashboard(){
    const dashMonth = document.getElementById('dashboard-month');
    if (!dashMonth) return;
    const monthValue = dashMonth.value;

    const dashEvent = document.getElementById('dashboard-event');
    const eventFilter = dashEvent ? (dashEvent.value || '__all__') : '__all__';

    const start = monthValue ? new Date(`${monthValue}-01T00:00:00`) : new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    let ingresos = 0;
    let egresos = 0;

    entries.forEach(entry => {
      const d = new Date(entry.date || '');
      if (isNaN(d.getTime())) return;
      if (d < start || d >= end) return;

      // Filtro por evento (solo para ingresos/egresos del tablero)
      const ev = (entry.evento || '').trim();
      if (eventFilter === '__none__'){
        if (ev) return;
      } else if (eventFilter !== '__all__'){
        if (ev !== eventFilter) return;
      }

      const entryLines = lines.filter(l => String(l.entryId) === String(entry.id));
      entryLines.forEach(l => {
        const acc = accountsByCode[l.accountCode];
        if (!acc) return;
        const delta = (Number(l.debe) || 0) - (Number(l.haber) || 0);
        if (acc.type === 'ingreso'){
          ingresos += delta;
        } else if (acc.type === 'gasto'){
          egresos += delta;
        }
      });
    });

    // Saldos de Caja y Banco: se mantienen globales
    const saldoCajaCodes = ['1100', '1110'];
    const saldoBancoCodes = ['1200'];

    const bgDateInput = document.getElementById('bg-date');
    const cutoff = bgDateInput && bgDateInput.value ? new Date(bgDateInput.value + 'T23:59:59') : new Date();

    let saldoCaja = 0;
    let saldoBanco = 0;

    lines.forEach(l => {
      const entry = entries.find(e => String(e.id) === String(l.entryId));
      if (!entry) return;
      const d = new Date(entry.date || '');
      if (isNaN(d.getTime()) || d > cutoff) return;

      const acc = accountsByCode[l.accountCode];
      if (!acc) return;
      const delta = (Number(l.debe) || 0) - (Number(l.haber) || 0);

      if (saldoCajaCodes.includes(l.accountCode)){
        saldoCaja += delta;
      }
      if (saldoBancoCodes.includes(l.accountCode)){
        saldoBanco += delta;
      }
    });

    const ingresosEl = document.getElementById('dash-total-ingresos');
    const egresosEl = document.getElementById('dash-total-egresos');
    const resultadoEl = document.getElementById('dash-resultado');
    const saldoCajaEl = document.getElementById('dash-saldo-caja');
    const saldoBancoEl = document.getElementById('dash-saldo-banco');

    if (ingresosEl) ingresosEl.textContent = formatCurrency(ingresos);
    if (egresosEl) egresosEl.textContent = formatCurrency(-egresos);
    if (resultadoEl) resultadoEl.textContent = formatCurrency(ingresos + egresos);
    if (saldoCajaEl) saldoCajaEl.textContent = formatCurrency(saldoCaja);
    if (saldoBancoEl) saldoBancoEl.textContent = formatCurrency(saldoBanco);
  }

  /* ===========================
   *   Diario contable
   * =========================== */

  function renderJournalTable(){
    const body = document.getElementById('journal-table-body');
    const detail = document.getElementById('journal-detail');
    if (!body) return;

    body.innerHTML = '';

    if (!entries.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'empty-row';
      td.textContent = 'Aún no hay movimientos registrados.';
      tr.appendChild(td);
      body.appendChild(tr);
      if (detail) detail.style.display = 'none';
      return;
    }

    const ordered = entries.slice().reverse();
    const filtered = applyJournalFilters(ordered);

    if (!filtered.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'empty-row';
      td.textContent = 'No hay movimientos que coincidan con los filtros seleccionados.';
      tr.appendChild(td);
      body.appendChild(tr);
      if (detail) detail.style.display = 'none';
      return;
    }

    filtered.forEach(entry => {
      const tr = document.createElement('tr');

      const tdFecha = document.createElement('td');
      tdFecha.textContent = entry.date || '';
      tr.appendChild(tdFecha);

      const tdDesc = document.createElement('td');
      tdDesc.textContent = entry.descripcion || '';
      tr.appendChild(tdDesc);

      const tdTipo = document.createElement('td');
      tdTipo.textContent = capitalize(entry.tipoMovimiento || '');
      tr.appendChild(tdTipo);

      const tdEvento = document.createElement('td');
      tdEvento.textContent = entry.evento || '—';
      tr.appendChild(tdEvento);

      const tdOrigen = document.createElement('td');
      tdOrigen.textContent = entry.origen || 'Manual';
      tr.appendChild(tdOrigen);

      const tdDebe = document.createElement('td');
      tdDebe.textContent = formatCurrency(entry.totalDebe || 0);
      tr.appendChild(tdDebe);

      const tdHaber = document.createElement('td');
      tdHaber.textContent = formatCurrency(entry.totalHaber || 0);
      tr.appendChild(tdHaber);

      const tdAcciones = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-small';
      btn.textContent = 'Ver detalle';
      btn.addEventListener('click', () => showEntryDetail(entry.id));
      tdAcciones.appendChild(btn);
      tr.appendChild(tdAcciones);

      body.appendChild(tr);
    });
  }

  function showEntryDetail(entryId){
    const detail = document.getElementById('journal-detail');
    if (!detail) return;

    const entry = entries.find(e => String(e.id) === String(entryId));
    const entryLines = lines.filter(l => String(l.entryId) === String(entryId));

    if (!entry){
      detail.style.display = 'none';
      return;
    }

    detail.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = 'Detalle del asiento';
    detail.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'detail-grid';

    const fields = [
      ['Fecha', entry.date || ''],
      ['Tipo', capitalize(entry.tipoMovimiento || '')],
      ['Evento', entry.evento || '—'],
      ['Origen', entry.origen || 'Manual'],
      ['Total Debe', formatCurrency(entry.totalDebe || 0)],
      ['Total Haber', formatCurrency(entry.totalHaber || 0)]
    ];

    fields.forEach(([label, value]) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('div');
      lab.className = 'detail-label';
      lab.textContent = label;
      const val = document.createElement('div');
      val.className = 'detail-value';
      val.textContent = value;
      wrap.appendChild(lab);
      wrap.appendChild(val);
      meta.appendChild(wrap);
    });

    detail.appendChild(meta);

    const linesTableWrapper = document.createElement('div');
    linesTableWrapper.className = 'table-wrapper';
    const table = document.createElement('table');
    table.className = 'data-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Cuenta</th><th>Nombre</th><th>Debe</th><th>Haber</th></tr>';
    const tbody = document.createElement('tbody');

    entryLines.forEach(l => {
      const tr = document.createElement('tr');
      const acc = accountsByCode[l.accountCode] || {};
      const tdCode = document.createElement('td');
      tdCode.textContent = l.accountCode || '';
      const tdName = document.createElement('td');
      tdName.textContent = acc.name || '';
      const tdDebe = document.createElement('td');
      tdDebe.textContent = formatCurrency(l.debe || 0);
      const tdHaber = document.createElement('td');
      tdHaber.textContent = formatCurrency(l.haber || 0);
      tr.appendChild(tdCode);
      tr.appendChild(tdName);
      tr.appendChild(tdDebe);
      tr.appendChild(tdHaber);
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    linesTableWrapper.appendChild(table);
    detail.appendChild(linesTableWrapper);

    detail.style.display = 'block';
  }

  /* ===========================
   *   Estado de Resultados
   * =========================== */

  function getErDateRange(){
    const modeSelect = document.getElementById('er-mode');
    const monthInput = document.getElementById('er-month');
    const startInput = document.getElementById('er-start');
    const endInput = document.getElementById('er-end');

    const mode = modeSelect ? (modeSelect.value || 'mes') : 'mes';

    let start, endExclusive;

    if (mode === 'rango'){
      const startStr = (startInput && startInput.value) ? startInput.value : formatDateInput(new Date());
      const endStr = (endInput && endInput.value) ? endInput.value : startStr;

      start = new Date(startStr + 'T00:00:00');
      const endDate = new Date(endStr + 'T00:00:00');
      endExclusive = new Date(endDate);
      endExclusive.setDate(endExclusive.getDate() + 1);
    } else {
      const monthValue = monthInput && monthInput.value
        ? monthInput.value
        : formatMonthKeyFromDate(new Date());
      start = new Date(`${monthValue}-01T00:00:00`);
      endExclusive = new Date(start);
      endExclusive.setMonth(endExclusive.getMonth() + 1);
    }

    return { start, endExclusive };
  }

  function renderEstadoResultados(){
    const erEventSelect = document.getElementById('er-event');
    const eventFilter = erEventSelect ? (erEventSelect.value || '__all__') : '__all__';

    const { start, endExclusive } = getErDateRange();

    const movimientos = {};

    lines.forEach(l => {
      const entry = entries.find(e => String(e.id) === String(l.entryId));
      if (!entry) return;
      const d = new Date(entry.date || '');
      if (isNaN(d.getTime())) return;
      if (d < start || d >= endExclusive) return;

      const ev = (entry.evento || '').trim();
      if (eventFilter === '__none__'){
        if (ev) return;
      } else if (eventFilter !== '__all__'){
        if (ev !== eventFilter) return;
      }

      const acc = accountsByCode[l.accountCode];
      if (!acc) return;

      if (!['ingreso', 'gasto', 'costo'].includes(acc.type)) return;

      if (!movimientos[l.accountCode]){
        movimientos[l.accountCode] = { code: l.accountCode, name: acc.name, type: acc.type, total: 0 };
      }

      const delta = (Number(l.debe) || 0) - (Number(l.haber) || 0);

      if (acc.type === 'ingreso'){
        movimientos[l.accountCode].total -= delta;
      } else {
        movimientos[l.accountCode].total += delta;
      }
    });

    const ingresosList = document.getElementById('er-ingresos-list');
    const costosList = document.getElementById('er-costos-list');
    const gastosList = document.getElementById('er-gastos-list');
    const totalIngresosEl = document.getElementById('er-total-ingresos');
    const totalCostosEl = document.getElementById('er-total-costos');
    const totalGastosEl = document.getElementById('er-total-gastos');
    const resultadoEl = document.getElementById('er-resultado');

    if (ingresosList) ingresosList.innerHTML = '';
    if (costosList) costosList.innerHTML = '';
    if (gastosList) gastosList.innerHTML = '';

    let totalIngresos = 0;
    let totalCostos = 0;
    let totalGastos = 0;

    Object.values(movimientos).forEach(mov => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${mov.code} – ${mov.name}`;
      const valueSpan = document.createElement('span');
      valueSpan.textContent = formatCurrency(mov.total);

      li.appendChild(nameSpan);
      li.appendChild(valueSpan);

      if (mov.type === 'ingreso'){
        totalIngresos += mov.total;
        if (ingresosList) ingresosList.appendChild(li);
      } else if (mov.type === 'costo'){
        totalCostos += mov.total;
        if (costosList) costosList.appendChild(li);
      } else if (mov.type === 'gasto'){
        totalGastos += mov.total;
        if (gastosList) gastosList.appendChild(li);
      }
    });

    if (totalIngresosEl) totalIngresosEl.textContent = formatCurrency(totalIngresos);
    if (totalCostosEl) totalCostosEl.textContent = formatCurrency(totalCostos);
    if (totalGastosEl) totalGastosEl.textContent = formatCurrency(totalGastos);

    const resultado = totalIngresos - totalCostos - totalGastos;
    if (resultadoEl) resultadoEl.textContent = formatCurrency(resultado);
  }

  /* ===========================
   *   Balance General
   * =========================== */

  function renderBalanceGeneral(){
    const bgDateInput = document.getElementById('bg-date');
    if (!bgDateInput) return;

    const cutoff = bgDateInput.value ? new Date(bgDateInput.value + 'T23:59:59') : new Date();

    const saldos = {};

    lines.forEach(l => {
      const entry = entries.find(e => String(e.id) === String(l.entryId));
      if (!entry) return;
      const d = new Date(entry.date || '');
      if (isNaN(d.getTime()) || d > cutoff) return;

      const acc = accountsByCode[l.accountCode];
      if (!acc) return;

      if (!saldos[l.accountCode]){
        saldos[l.accountCode] = { code: l.accountCode, name: acc.name, type: acc.type, saldo: 0 };
      }

      const delta = (Number(l.debe) || 0) - (Number(l.haber) || 0);

      if (acc.type === 'activo'){
        saldos[l.accountCode].saldo += delta;
      } else if (['pasivo', 'patrimonio'].includes(acc.type)){
        saldos[l.accountCode].saldo -= delta;
      } else {
        saldos[l.accountCode].saldo += delta;
      }
    });

    const activosList = document.getElementById('bg-activos-list');
    const pasivosList = document.getElementById('bg-pasivos-list');
    const patrimonioList = document.getElementById('bg-patrimonio-list');

    const totalActivosEl = document.getElementById('bg-total-activos');
    const totalPasivosEl = document.getElementById('bg-total-pasivos');
    const totalPatrimonioEl = document.getElementById('bg-total-patrimonio');

    if (activosList) activosList.innerHTML = '';
    if (pasivosList) pasivosList.innerHTML = '';
    if (patrimonioList) patrimonioList.innerHTML = '';

    let totalActivos = 0;
    let totalPasivos = 0;
    let totalPatrimonio = 0;

    Object.values(saldos).forEach(s => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${s.code} – ${s.name}`;
      const valueSpan = document.createElement('span');
      valueSpan.textContent = formatCurrency(s.saldo);

      li.appendChild(nameSpan);
      li.appendChild(valueSpan);

      if (s.type === 'activo'){
        totalActivos += s.saldo;
        if (activosList) activosList.appendChild(li);
      } else if (s.type === 'pasivo'){
        totalPasivos += s.saldo;
        if (pasivosList) pasivosList.appendChild(li);
      } else if (s.type === 'patrimonio'){
        totalPatrimonio += s.saldo;
        if (patrimonioList) patrimonioList.appendChild(li);
      }
    });

    if (totalActivosEl) totalActivosEl.textContent = formatCurrency(totalActivos);
    if (totalPasivosEl) totalPasivosEl.textContent = formatCurrency(totalPasivos);
    if (totalPatrimonioEl) totalPatrimonioEl.textContent = formatCurrency(totalPatrimonio);
  }

  /* ===========================
   *   Misc
   * =========================== */

  document.addEventListener('DOMContentLoaded', initApp);

  function humanAccountType(type){
    switch(type){
      case 'activo': return 'Activo';
      case 'pasivo': return 'Pasivo';
      case 'patrimonio': return 'Patrimonio';
      case 'ingreso': return 'Ingreso';
      case 'gasto': return 'Gasto';
      case 'costo': return 'Costo de venta';
      default: return type || '';
    }
  }
})();
