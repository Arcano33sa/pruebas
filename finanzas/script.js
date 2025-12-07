// Finanzas A33 · Fase 1
// Mini contabilidad manual usando IndexedDB, sin tocar POS / Inventario / Lotes.

(function(){
  const DB_NAME = 'a33-finanzas';
  const DB_VERSION = 1;

  let db = null;
  let accounts = [];
  let accountsByCode = {};
  let entries = [];
  let lines = [];

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

    // 7xxx Otros ingresos / gastos
    { code: '7100', name: 'Otros ingresos varios', type: 'ingreso', systemProtected: false },
    { code: '7200', name: 'Otros gastos varios', type: 'gasto', systemProtected: false }
  ];

  document.addEventListener('DOMContentLoaded', init);

  function init(){
    setupTabs();
    setupSubtabs();
    setupHashRouting();

    openDB()
      .then(database => {
        db = database;
        return ensureAccountsSeeded();
      })
      .then(() => reloadData())
      .then(() => {
        initForm();
        initFilters();
        applyInitialTabFromHash();
      })
      .catch(err => {
        console.error('[Finanzas] Error al inicializar', err);
        const errEl = document.getElementById('finanzas-error');
        if (errEl) errEl.style.display = 'block';
      });
  }

  // --- UI helpers ---

  function setupTabs(){
    const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    const panels = Array.from(document.querySelectorAll('.tab-panel'));

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        activateTab(tab);
      });
    });

    function activateTab(tab){
      tabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
      panels.forEach(p => p.classList.toggle('active', p.id === tab));
      const hashBase = 'tab=' + tab;
      if (!location.hash.includes(hashBase)){
        location.hash = hashBase;
      }
    }

    // Exponer para uso interno
    window.__finanzasActivateTab = activateTab;
  }

  function setupSubtabs(){
    const subtabButtons = Array.from(document.querySelectorAll('.subtab-btn'));
    const subpanels = Array.from(document.querySelectorAll('.subtab-panel'));

    subtabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = btn.getAttribute('data-subtab');
        subtabButtons.forEach(b => b.classList.toggle('active', b.getAttribute('data-subtab') === sub));
        subpanels.forEach(p => {
          const id = p.id.replace('subtab-', '');
          p.classList.toggle('active', id === sub);
        });
      });
    });
  }

  function setupHashRouting(){
    window.addEventListener('hashchange', applyInitialTabFromHash);
  }

  function applyInitialTabFromHash(){
    const hash = location.hash || '';
    const match = hash.match(/tab=([a-z]+)/i);
    const target = match ? match[1] : 'tablero';
    if (window.__finanzasActivateTab){
      window.__finanzasActivateTab(target);
    }
  }

  // --- IndexedDB ---

  function openDB(){
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)){
        return reject(new Error('Este navegador no soporta IndexedDB.'));
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const upgradeDb = event.target.result;

        if (!upgradeDb.objectStoreNames.contains('accounts')){
          const store = upgradeDb.createObjectStore('accounts', { keyPath: 'code' });
          store.createIndex('type', 'type', { unique: false });
        }
        if (!upgradeDb.objectStoreNames.contains('journalEntries')){
          const store = upgradeDb.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('tipo', 'tipoMovimiento', { unique: false });
        }
        if (!upgradeDb.objectStoreNames.contains('journalLines')){
          const store = upgradeDb.createObjectStore('journalLines', { keyPath: 'id', autoIncrement: true });
          store.createIndex('entryId', 'entryId', { unique: false });
          store.createIndex('accountCode', 'accountCode', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      request.onerror = (event) => {
        reject(event.target.error || new Error('No se pudo abrir la base de datos de Finanzas.'));
      };
    });
  }

  function ensureAccountsSeeded(){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readonly');
      const store = tx.objectStore('accounts');
      const req = store.getAll();
      req.onsuccess = (ev) => {
        const existing = ev.target.result || [];
        if (existing.length > 0){
          accounts = existing;
          buildAccountsByCode();
          resolve();
          return;
        }
        // Sembrar catálogo base
        const seedTx = db.transaction('accounts', 'readwrite');
        const seedStore = seedTx.objectStore('accounts');
        DEFAULT_ACCOUNTS.forEach(acc => seedStore.put(acc));
        seedTx.oncomplete = () => {
          const tx2 = db.transaction('accounts', 'readonly');
          const store2 = tx2.objectStore('accounts');
          const req2 = store2.getAll();
          req2.onsuccess = (ev2) => {
            accounts = ev2.target.result || [];
            buildAccountsByCode();
            resolve();
          };
          req2.onerror = (e2) => reject(e2.target.error);
        };
        seedTx.onerror = (e) => reject(e.target.error);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function buildAccountsByCode(){
    accountsByCode = {};
    accounts.forEach(acc => {
      accountsByCode[acc.code] = acc;
    });
  }

  function reloadData(){
    if (!db) return Promise.resolve();
    return Promise.all([
      loadEntries(),
      loadLines()
    ]).then(() => {
      renderAll();
    });
  }

  function loadEntries(){
    return new Promise((resolve, reject) => {
      const tx = db.transaction('journalEntries', 'readonly');
      const store = tx.objectStore('journalEntries');
      const req = store.getAll();
      req.onsuccess = (ev) => {
        entries = (ev.target.result || []).sort((a,b) => (a.date || '').localeCompare(b.date || ''));
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

  // --- Formulario Diario ---

  function initForm(){
    const dateInput = document.getElementById('movement-date');
    const typeSelect = document.getElementById('movement-type');
    const accountSelect = document.getElementById('movement-account');
    const form = document.getElementById('journal-form');

    if (dateInput){
      const today = new Date();
      dateInput.value = formatDateInput(today);
    }

    if (typeSelect && accountSelect){
      typeSelect.addEventListener('change', () => {
        populateAccountOptions();
      });
      populateAccountOptions();
    }

    if (form){
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        handleJournalSubmit();
      });
    }
  }

  function populateAccountOptions(){
    const typeSelect = document.getElementById('movement-type');
    const accountSelect = document.getElementById('movement-account');
    if (!typeSelect || !accountSelect) return;

    const tipo = typeSelect.value;
    let allowedTypes = [];

    if (tipo === 'ingreso'){
      allowedTypes = ['ingreso'];
    } else if (tipo === 'egreso'){
      // Gastos de operación y costos de venta
      allowedTypes = ['gasto', 'costo'];
    } else {
      // Ajuste: permitir todas excepto las de caja/banco que se controlan por "Medio"
      allowedTypes = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'];
    }

    const options = accounts
      .filter(acc => allowedTypes.includes(acc.type) && !['1100','1110','1200'].includes(acc.code))
      .sort((a,b) => a.code.localeCompare(b.code));

    accountSelect.innerHTML = '';
    options.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.code;
      opt.textContent = acc.code + ' · ' + acc.name;
      accountSelect.appendChild(opt);
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
        // DEBE: Gasto/Costos, HABER: Caja/Banco
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
        // Ajuste simple: mismo patrón que egreso pero marcado como tipo "ajuste"
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
    };

    tx.oncomplete = () => {
      // Reset rápido del formulario
      if (amountInput) amountInput.value = '';
      if (descriptionInput) descriptionInput.value = '';
      // Evento se mantiene para facilitar múltiples movimientos del mismo evento
      reloadData();
    };

    tx.onerror = (e) => {
      console.error('[Finanzas] Error al guardar movimiento', e.target.error);
      alert('Ocurrió un error al guardar el movimiento.');
    };
  }

  function resolveCashAccount(medio, evento){
    const hasEvent = evento && evento.trim().length > 0;
    if (medio === 'caja'){
      return hasEvent ? '1110' : '1100';
    }
    if (medio === 'banco'){
      return '1200';
    }
    return null;
  }

  // --- Filtros y render ---

  function initFilters(){
    const today = new Date();
    const monthKey = formatMonthKeyFromDate(today);

    const dashMonth = document.getElementById('dashboard-month');
    const erMonth = document.getElementById('er-month');
    const bgDate = document.getElementById('bg-date');

    if (dashMonth) dashMonth.value = monthKey;
    if (erMonth) erMonth.value = monthKey;
    if (bgDate) bgDate.value = formatDateInput(today);

    if (dashMonth) dashMonth.addEventListener('change', renderDashboard);
    if (erMonth) erMonth.addEventListener('change', renderEstadoResultados);
    if (bgDate) bgDate.addEventListener('change', renderBalanceGeneral);

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

  function renderDashboard(){
    const dashMonth = document.getElementById('dashboard-month');
    if (!dashMonth) return;
    const monthKey = dashMonth.value || formatMonthKeyFromDate(new Date());

    const { lines: monthLines, lastDateOfMonth } = getLinesForMonth(monthKey);

    let totalIngresos = 0;
    let totalEgresos = 0;

    monthLines.forEach(line => {
      const acc = accountsByCode[line.accountCode];
      if (!acc) return;
      const type = acc.type;
      if (type === 'ingreso'){
        totalIngresos += (toNumber(line.haber) - toNumber(line.debe));
      } else if (type === 'gasto' || type === 'costo'){
        totalEgresos += (toNumber(line.debe) - toNumber(line.haber));
      }
    });

    const resultado = totalIngresos - totalEgresos;

    const balances = computeBalancesAt(lastDateOfMonth);

    const saldoCaja = (balances['1100'] || 0) + (balances['1110'] || 0);
    const saldoBanco = balances['1200'] || 0;

    setText('dash-ingresos', formatCurrency(totalIngresos));
    setText('dash-egresos', formatCurrency(totalEgresos));
    setText('dash-resultado', formatCurrency(resultado));
    setText('dash-caja', formatCurrency(saldoCaja));
    setText('dash-banco', formatCurrency(saldoBanco));
  }

  function renderJournalTable(){
    const body = document.getElementById('journal-table-body');
    const detail = document.getElementById('journal-detail');
    if (!body) return;

    body.innerHTML = '';

    if (!entries.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'empty-row';
      td.textContent = 'Aún no hay movimientos registrados.';
      tr.appendChild(td);
      body.appendChild(tr);
      if (detail) detail.style.display = 'none';
      return;
    }

    entries.slice().reverse().forEach(entry => {
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

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrapper';

    const table = document.createElement('table');
    table.className = 'data-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Cuenta</th><th>Nombre</th><th>Debe</th><th>Haber</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    entryLines.forEach(line => {
      const acc = accountsByCode[line.accountCode] || { code: line.accountCode, name: '(Cuenta desconocida)' };
      const tr = document.createElement('tr');

      const tdCode = document.createElement('td');
      tdCode.textContent = acc.code;
      tr.appendChild(tdCode);

      const tdName = document.createElement('td');
      tdName.textContent = acc.name;
      tr.appendChild(tdName);

      const tdDebe = document.createElement('td');
      tdDebe.textContent = formatCurrency(line.debe || 0);
      tr.appendChild(tdDebe);

      const tdHaber = document.createElement('td');
      tdHaber.textContent = formatCurrency(line.haber || 0);
      tr.appendChild(tdHaber);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    detail.appendChild(tableWrap);

    detail.style.display = 'block';
  }

  function renderEstadoResultados(){
    const erMonth = document.getElementById('er-month');
    const body = document.getElementById('er-body');
    if (!erMonth || !body) return;

    const monthKey = erMonth.value || formatMonthKeyFromDate(new Date());

    const { lines: monthLines } = getLinesForMonth(monthKey);

    const perAccount = {};

    monthLines.forEach(line => {
      const acc = accountsByCode[line.accountCode];
      if (!acc) return;

      const type = acc.type;
      if (type !== 'ingreso' && type !== 'gasto' && type !== 'costo') return;

      if (!perAccount[acc.code]){
        perAccount[acc.code] = { account: acc, amount: 0 };
      }

      if (type === 'ingreso'){
        perAccount[acc.code].amount += (toNumber(line.haber) - toNumber(line.debe));
      } else {
        // gastos y costos
        perAccount[acc.code].amount += (toNumber(line.debe) - toNumber(line.haber));
      }
    });

    const accountsArr = Object.values(perAccount);

    body.innerHTML = '';
    if (!accountsArr.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'empty-row';
      td.textContent = 'Aún no hay movimientos para este periodo.';
      tr.appendChild(td);
      body.appendChild(tr);

      setText('er-total-ingresos', formatCurrency(0));
      setText('er-total-costos', formatCurrency(0));
      setText('er-total-gastos', formatCurrency(0));
      setText('er-resultado', formatCurrency(0));
      return;
    }

    let totalIngresos = 0;
    let totalCostos = 0;
    let totalGastos = 0;

    // Ordenar por código
    accountsArr.sort((a,b) => a.account.code.localeCompare(b.account.code));

    accountsArr.forEach(item => {
      const acc = item.account;
      const amount = item.amount;

      const tr = document.createElement('tr');

      const tdCode = document.createElement('td');
      tdCode.textContent = acc.code;
      tr.appendChild(tdCode);

      const tdName = document.createElement('td');
      tdName.textContent = acc.name;
      tr.appendChild(tdName);

      const tdType = document.createElement('td');
      tdType.textContent = humanAccountType(acc.type);
      tr.appendChild(tdType);

      const tdAmount = document.createElement('td');
      tdAmount.textContent = formatCurrency(amount);
      tr.appendChild(tdAmount);

      body.appendChild(tr);

      if (acc.type === 'ingreso'){
        totalIngresos += amount;
      } else if (acc.type === 'costo'){
        totalCostos += amount;
      } else if (acc.type === 'gasto'){
        totalGastos += amount;
      }
    });

    const resultado = totalIngresos - totalCostos - totalGastos;

    setText('er-total-ingresos', formatCurrency(totalIngresos));
    setText('er-total-costos', formatCurrency(totalCostos));
    setText('er-total-gastos', formatCurrency(totalGastos));
    setText('er-resultado', formatCurrency(resultado));
  }

  function renderBalanceGeneral(){
    const bgDate = document.getElementById('bg-date');
    if (!bgDate) return;

    const cutoff = bgDate.value || formatDateInput(new Date());
    const balances = computeBalancesAt(cutoff);

    const activosTbody = document.getElementById('bg-body-activos');
    const pasivosTbody = document.getElementById('bg-body-pasivos');
    const patrimonioTbody = document.getElementById('bg-body-patrimonio');

    if (!activosTbody || !pasivosTbody || !patrimonioTbody) return;

    activosTbody.innerHTML = '';
    pasivosTbody.innerHTML = '';
    patrimonioTbody.innerHTML = '';

    let totalActivos = 0;
    let totalPasivos = 0;
    let totalPatrimonio = 0;

    const codes = Object.keys(balances).sort();

    const makeRow = (tbody, acc, saldo) => {
      const tr = document.createElement('tr');
      const tdCode = document.createElement('td');
      tdCode.textContent = acc.code;
      tr.appendChild(tdCode);
      const tdName = document.createElement('td');
      tdName.textContent = acc.name;
      tr.appendChild(tdName);
      const tdSaldo = document.createElement('td');
      tdSaldo.textContent = formatCurrency(saldo);
      tr.appendChild(tdSaldo);
      tbody.appendChild(tr);
    };

    codes.forEach(code => {
      const saldo = balances[code];
      const acc = accountsByCode[code];
      if (!acc) return;
      if (Math.abs(saldo) < 0.005) return; // evitar ruido

      if (acc.type === 'activo'){
        makeRow(activosTbody, acc, saldo);
        totalActivos += saldo;
      } else if (acc.type === 'pasivo'){
        makeRow(pasivosTbody, acc, saldo);
        totalPasivos += saldo;
      } else if (acc.type === 'patrimonio'){
        makeRow(patrimonioTbody, acc, saldo);
        totalPatrimonio += saldo;
      }
    });

    if (!activosTbody.children.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'empty-row';
      td.textContent = 'Sin movimientos aún.';
      tr.appendChild(td);
      activosTbody.appendChild(tr);
    }
    if (!pasivosTbody.children.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'empty-row';
      td.textContent = 'Sin movimientos aún.';
      tr.appendChild(td);
      pasivosTbody.appendChild(tr);
    }
    if (!patrimonioTbody.children.length){
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'empty-row';
      td.textContent = 'Sin movimientos aún.';
      tr.appendChild(td);
      patrimonioTbody.appendChild(tr);
    }

    setText('bg-total-activos', formatCurrency(totalActivos));
    setText('bg-total-pasivos', formatCurrency(totalPasivos));
    setText('bg-total-patrimonio', formatCurrency(totalPatrimonio));
  }

  // --- Cálculos de líneas / balances ---

  function getLinesForMonth(monthKey){
    const allowedIds = new Set();
    const safeKey = monthKey || formatMonthKeyFromDate(new Date());

    let year = 0;
    let month = 0;
    try {
      const parts = safeKey.split('-');
      year = Number(parts[0]) || 0;
      month = Number(parts[1]) || 0;
    } catch {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const lastDate = new Date(year, month, 0);
    const lastDateStr = formatDateInput(lastDate);

    entries.forEach(e => {
      if (!e.date) return;
      if (e.date.slice(0,7) === safeKey){
        allowedIds.add(e.id);
      }
    });

    const monthLines = lines.filter(l => allowedIds.has(l.entryId));

    return { lines: monthLines, lastDateOfMonth: lastDateStr };
  }

  function computeBalancesAt(cutoffDateStr){
    const cutoff = cutoffDateStr || formatDateInput(new Date());
    const isoCutoff = cutoff;

    const allowedIds = new Set();
    entries.forEach(e => {
      if (!e.date) return;
      if (e.date <= isoCutoff){
        allowedIds.add(e.id);
      }
    });

    const balances = {};

    lines.forEach(line => {
      if (!allowedIds.has(line.entryId)) return;
      const acc = accountsByCode[line.accountCode];
      if (!acc) return;

      const type = acc.type;
      const debe = toNumber(line.debe);
      const haber = toNumber(line.haber);

      if (!balances[acc.code]) balances[acc.code] = 0;

      if (type === 'activo' || type === 'gasto' || type === 'costo'){
        balances[acc.code] += (debe - haber);
      } else if (type === 'pasivo' || type === 'patrimonio' || type === 'ingreso'){
        balances[acc.code] += (haber - debe);
      } else {
        balances[acc.code] += (debe - haber);
      }
    });

    return balances;
  }

  // --- Utilidades varias ---

  function formatCurrency(value){
    const n = Number(value) || 0;
    try {
      return 'C$ ' + n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e){
      return 'C$ ' + n.toFixed(2);
    }
  }

  function round2(value){
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function toNumber(v){
    return Number(v) || 0;
  }

  function setText(id, text){
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function formatDateInput(date){
    const d = (date instanceof Date) ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatMonthKeyFromDate(date){
    const d = (date instanceof Date) ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  function capitalize(str){
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

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
