// Analítica A33 · Fase 1 (solo lectura)
// Lee datos desde IndexedDB del POS (a33-pos) y muestra resumen, eventos y presentaciones.

(function(){
  const DB_NAME = 'a33-pos';
  const DB_VER = 19;
  let db = null;
  let sales = [];
  let events = [];
  let products = [];

  document.addEventListener('DOMContentLoaded', init);

  async function init(){
    setupTabs();
    setupPeriodFilter();

    try {
      await openDB();
      const [s, e, p] = await Promise.all([
        getAll('sales'),
        getAll('events'),
        getAll('products')
      ]);
      sales = Array.isArray(s) ? s : [];
      events = Array.isArray(e) ? e : [];
      products = Array.isArray(p) ? p : [];
      recompute();
    } catch (err) {
      console.error('Error al inicializar Analítica', err);
      const errEl = document.getElementById('analytics-error');
      if (errEl) errEl.style.display = 'block';
    }
  }

  function openDB(){
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        return reject(new Error('IndexedDB no disponible'));
      }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onerror = () => reject(req.error || new Error('No se pudo abrir la base de datos'));
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onupgradeneeded = (e) => {
        // No creamos ni modificamos nada aquí: el esquema lo define el POS.
        console.warn('Analítica: onupgradeneeded llamado. Asegúrate de haber abierto antes el POS para inicializar el esquema.');
        db = e.target.result;
      };
    });
  }

  function getAll(storeName){
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error('DB no inicializada'));
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error || new Error('Error al leer ' + storeName));
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- UI helpers ---

  function setupTabs(){
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        tabs.forEach(b => b.classList.toggle('active', b === btn));
        contents.forEach(sec => {
          sec.classList.toggle('active', sec.id === 'tab-' + target);
        });
      });
    });
  }

  function setupPeriodFilter(){
    const periodSelect = document.getElementById('period-select');
    const customBox = document.getElementById('custom-range');
    const fromInput = document.getElementById('date-from');
    const toInput = document.getElementById('date-to');

    if (!periodSelect) return;

    periodSelect.addEventListener('change', () => {
      const val = periodSelect.value;
      if (val === 'custom') {
        if (customBox) customBox.style.display = 'block';
      } else {
        if (customBox) customBox.style.display = 'none';
      }
      recompute();
    });

    if (fromInput) fromInput.addEventListener('change', recompute);
    if (toInput) toInput.addEventListener('change', recompute);
  }

  function getCurrentRange(){
    const periodSelect = document.getElementById('period-select');
    const fromInput = document.getElementById('date-from');
    const toInput = document.getElementById('date-to');

    const today = new Date();
    let from = null;
    let to = null;

    const val = periodSelect ? periodSelect.value : '30d';
    if (val === '30d') {
      to = today;
      from = addDays(today, -29);
    } else if (val === '90d') {
      to = today;
      from = addDays(today, -89);
    } else if (val === 'ytd') {
      to = today;
      from = new Date(today.getFullYear(), 0, 1);
    } else if (val === 'all') {
      from = null;
      to = null;
    } else if (val === 'custom') {
      const fromVal = fromInput && fromInput.value ? new Date(fromInput.value + 'T00:00:00') : null;
      const toVal = toInput && toInput.value ? new Date(toInput.value + 'T23:59:59') : null;
      from = fromVal;
      to = toVal;
    }

    return { from, to };
  }

  function addDays(date, delta){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + delta);
    return d;
  }

  function parseSaleDate(str){
    if (!str) return null;
    // Se espera formato YYYY-MM-DD
    const parts = String(str).split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d);
  }

  function saleInRange(sale, range){
    const { from, to } = range;
    const d = parseSaleDate(sale.date);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function mapPresentation(productName){
    if (!productName) return null;
    const n = String(productName).toLowerCase();
    if (n.includes('pulso')) return 'pulso';
    if (n.includes('media')) return 'media';
    if (n.includes('djeba')) return 'djeba';
    if (n.includes('litro')) return 'litro';
    if (n.includes('galón') || n.includes('galon')) return 'galon';
    return null;
  }

  function formatCurrency(value){
    const n = Number(value) || 0;
    try {
      return 'C$ ' + n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return 'C$ ' + n.toFixed(2);
    }
  }

  function formatPercent(value){
    const n = Number(value) || 0;
    return n.toFixed(1) + '%';
  }

  function formatMonthKey(key){
    if (!key) return '-';
    const [y, m] = key.split('-');
    const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const idx = parseInt(m, 10) - 1;
    const label = monthNames[idx] || key;
    return label + ' ' + y;
  }

  // --- Recompute & sections ---

  function recompute(){
    if (!Array.isArray(sales) || !sales.length) {
      // Limpia las vistas pero no muestra error si simplemente no hay ventas.
      updateResumen([]);
      updateEventos([], events);
      updatePresentaciones([]);
      return;
    }

    const range = getCurrentRange();
    const filteredSales = sales.filter(s => saleInRange(s, range));
    updateResumen(filteredSales);
    updateEventos(filteredSales, events);
    updatePresentaciones(filteredSales);
  }

  function updateResumen(filteredSales){
    const kpiTotalVentas = document.getElementById('kpi-total-ventas');
    const kpiTotalBotellas = document.getElementById('kpi-total-botellas');
    const kpiDetalleBotellas = document.getElementById('kpi-detalle-botellas');
    const kpiEventos = document.getElementById('kpi-eventos');
    const kpiTicket = document.getElementById('kpi-ticket-promedio');
    const tbody = document.getElementById('tbody-resumen-mensual');

    if (!tbody) return;

    // Agrupar por mes: YYYY-MM
    const byMonth = new Map();
    let totalVentas = 0;
    let totalEventosSet = new Set();
    let sumTicketsPagados = 0;
    let countTicketsPagados = 0;

    const totalPres = { pulso:0, media:0, djeba:0, litro:0, galon:0 };

    for (const s of filteredSales){
      const d = parseSaleDate(s.date);
      if (!d) continue;
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (!byMonth.has(key)) {
        byMonth.set(key, {
          ventas: 0,
          events: new Set(),
          pres: { pulso:0, media:0, djeba:0, litro:0, galon:0 },
          sumTicketsPagados: 0,
          countTicketsPagados: 0
        });
      }
      const bucket = byMonth.get(key);

      const total = Number(s.total) || 0;
      const qty = Number(s.qty) || 0;
      const finalQty = s.isReturn ? -qty : qty;
      const presId = mapPresentation(s.productName);

      bucket.ventas += total;
      totalVentas += total;

      if (s.eventId != null) {
        bucket.events.add(s.eventId);
        totalEventosSet.add(s.eventId);
      }

      if (presId && bucket.pres[presId] != null) {
        bucket.pres[presId] += finalQty;
        totalPres[presId] += finalQty;
      }

      if (total > 0) {
        bucket.sumTicketsPagados += total;
        bucket.countTicketsPagados += 1;
        sumTicketsPagados += total;
        countTicketsPagados += 1;
      }
    }

    // Actualizar KPIs globales
    const totalBotellasGlobal = Object.values(totalPres).reduce((a,b)=>a+b,0);
    if (kpiTotalVentas) kpiTotalVentas.textContent = formatCurrency(totalVentas);
    if (kpiTotalBotellas) kpiTotalBotellas.textContent = String(totalBotellasGlobal);
    if (kpiEventos) kpiEventos.textContent = String(totalEventosSet.size);
    const ticketPromedioGlobal = countTicketsPagados ? (sumTicketsPagados / countTicketsPagados) : 0;
    if (kpiTicket) kpiTicket.textContent = formatCurrency(ticketPromedioGlobal);

    if (kpiDetalleBotellas) {
      kpiDetalleBotellas.textContent =
        'Pulso ' + (totalPres.pulso||0) + ' · ' +
        'Media ' + (totalPres.media||0) + ' · ' +
        'Djeba ' + (totalPres.djeba||0) + ' · ' +
        'Litro ' + (totalPres.litro||0) + ' · ' +
        'Galón ' + (totalPres.galon||0);
    }

    // Tabla mensual
    tbody.innerHTML = '';
    const sortedKeys = Array.from(byMonth.keys()).sort(); // ascendente por defecto
    const labels = [];
    const values = [];

    for (const key of sortedKeys){
      const bucket = byMonth.get(key);
      labels.push(formatMonthKey(key));
      values.push(bucket.ventas);

      const tr = document.createElement('tr');
      const ticketPromMes = bucket.countTicketsPagados ? (bucket.sumTicketsPagados / bucket.countTicketsPagados) : 0;

      tr.innerHTML = [
        '<td>' + formatMonthKey(key) + '</td>',
        '<td>' + formatCurrency(bucket.ventas) + '</td>',
        '<td>' + (bucket.pres.pulso || 0) + '</td>',
        '<td>' + (bucket.pres.media || 0) + '</td>',
        '<td>' + (bucket.pres.djeba || 0) + '</td>',
        '<td>' + (bucket.pres.litro || 0) + '</td>',
        '<td>' + (bucket.pres.galon || 0) + '</td>',
        '<td>' + bucket.events.size + '</td>',
        '<td>' + formatCurrency(ticketPromMes) + '</td>'
      ].join('');
      tbody.appendChild(tr);
    }

    drawBarChart('chart-mensual-ventas', labels, values, { maxBars: 12 });
  }

  function updateEventos(filteredSales, events){
    const tbody = document.getElementById('tbody-eventos');
    const selectOrden = document.getElementById('orden-eventos');
    if (!tbody) return;

    const byEvent = new Map();
    let totalVentasPeriodo = 0;

    for (const s of filteredSales){
      const total = Number(s.total) || 0;
      const qty = Number(s.qty) || 0;
      const finalQty = s.isReturn ? -qty : qty;

      const eventId = s.eventId != null ? s.eventId : 'sin-evento';
      const eventName = s.eventName || 'General';

      if (!byEvent.has(eventId)) {
        byEvent.set(eventId, {
          id: eventId,
          name: eventName,
          ventas: 0,
          ventasPagadas: 0,
          botellas: 0,
          ticketsPagados: 0
        });
      }
      const bucket = byEvent.get(eventId);
      bucket.ventas += total;
      bucket.botellas += finalQty;
      totalVentasPeriodo += total;

      if (total > 0) {
        bucket.ventasPagadas += total;
        bucket.ticketsPagados += 1;
      }
    }

    // Enriquecer con info de estado desde events[]
    for (const ev of events || []){
      const id = ev.id;
      if (id == null) continue;
      const bucket = byEvent.get(id);
      if (bucket) {
        bucket.closedAt = ev.closedAt;
        bucket.eventNameFull = ev.name;
      }
    }

    // Convertir a arreglo
    let rows = Array.from(byEvent.values());

    // Orden
    const criterio = selectOrden ? selectOrden.value : 'ventas';
    rows.sort((a,b) => {
      if (criterio === 'botellas') {
        return (b.botellas||0) - (a.botellas||0);
      } else if (criterio === 'ticket') {
        const aT = a.ticketsPagados ? a.ventasPagadas/a.ticketsPagados : 0;
        const bT = b.ticketsPagados ? b.ventasPagadas/b.ticketsPagados : 0;
        return bT - aT;
      }
      // ventas
      return (b.ventas||0) - (a.ventas||0);
    });

    // Actualizar tabla
    tbody.innerHTML = '';
    const labels = [];
    const values = [];

    for (const ev of rows){
      const ticketProm = ev.ticketsPagados ? (ev.ventasPagadas / ev.ticketsPagados) : 0;
      const perc = totalVentasPeriodo ? (ev.ventas / totalVentasPeriodo * 100) : 0;
      const estado = ev.closedAt ? 'Cerrado' : 'Abierto';
      const nombre = ev.eventNameFull || ev.name || 'General';

      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + escapeHtml(nombre) + '</td>',
        '<td>' + estado + '</td>',
        '<td>' + formatCurrency(ev.ventas) + '</td>',
        '<td>' + (ev.botellas || 0) + '</td>',
        '<td>' + formatCurrency(ticketProm) + '</td>',
        '<td>' + formatPercent(perc) + '</td>'
      ].join('');
      tbody.appendChild(tr);

      labels.push(nombre);
      values.push(ev.ventas);
    }

    // Top N para el gráfico
    const MAX = 10;
    const topLabels = labels.slice(0, MAX);
    const topValues = values.slice(0, MAX);
    drawBarChart('chart-eventos-ventas', topLabels, topValues, { horizontal: true });

    if (selectOrden) {
      selectOrden.onchange = () => updateEventos(filteredSales, events);
    }
  }

  function updatePresentaciones(filteredSales){
    const tbody = document.getElementById('tbody-presentaciones');
    if (!tbody) return;

    const presAgg = {
      pulso: { id:'pulso', label:'Pulso', unidades:0, ventas:0 },
      media: { id:'media', label:'Media', unidades:0, ventas:0 },
      djeba: { id:'djeba', label:'Djeba', unidades:0, ventas:0 },
      litro: { id:'litro', label:'Litro', unidades:0, ventas:0 },
      galon: { id:'galon', label:'Galón', unidades:0, ventas:0 }
    };

    let totalVentas = 0;

    for (const s of filteredSales){
      const presId = mapPresentation(s.productName);
      if (!presId || !presAgg[presId]) continue;
      const qty = Number(s.qty) || 0;
      const finalQty = s.isReturn ? -qty : qty;
      const total = Number(s.total) || 0;

      presAgg[presId].unidades += finalQty;
      presAgg[presId].ventas += total;
      totalVentas += total;
    }

    const rows = Object.values(presAgg);
    tbody.innerHTML = '';

    const labels = [];
    const values = [];

    for (const row of rows){
      if (row.unidades === 0 && row.ventas === 0) continue;
      const perc = totalVentas ? (row.ventas / totalVentas * 100) : 0;
      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + row.label + '</td>',
        '<td>' + row.unidades + '</td>',
        '<td>' + formatCurrency(row.ventas) + '</td>',
        '<td>' + formatPercent(perc) + '</td>'
      ].join('');
      tbody.appendChild(tr);

      labels.push(row.label);
      values.push(row.ventas);
    }

    drawBarChart('chart-pres-ventas', labels, values, {});
  }

  // --- Simple bar chart renderer (canvas) ---

  function drawBarChart(canvasId, labels, values, opts){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxBars = opts && opts.maxBars ? opts.maxBars : null;
    let dataLabels = labels.slice();
    let dataValues = values.slice();

    if (maxBars && dataValues.length > maxBars){
      dataLabels = dataLabels.slice(-maxBars);
      dataValues = dataValues.slice(-maxBars);
    }

    const width = canvas.clientWidth || 400;
    const height = canvas.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, width, height);

    // Sin datos
    const hasData = dataValues.some(v => Math.abs(v) > 0.0001);
    if (!hasData){
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sin datos en este periodo', width/2, height/2);
      return;
    }

    const margin = { top: 18, right: 10, bottom: 40, left: 50 };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    const maxVal = Math.max(...dataValues, 0);
    const minVal = Math.min(...dataValues, 0);
    const useHorizontal = opts && opts.horizontal;

    if (!useHorizontal){
      // Barras verticales
      const base = minVal < 0 ? minVal : 0;
      const scale = chartH / (maxVal - base || 1);
      const zeroY = margin.top + chartH - (0 - base) * scale;
      const n = dataValues.length;
      const barSpace = chartW / (n || 1);
      const barWidth = Math.max(12, barSpace * 0.6);

      // Eje X
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(margin.left, zeroY);
      ctx.lineTo(width - margin.right, zeroY);
      ctx.stroke();

      ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';

      dataValues.forEach((val, i) => {
        const barHeight = (val - base) * scale;
        const x = margin.left + barSpace * i + (barSpace - barWidth)/2;
        const y = zeroY - barHeight;

        ctx.fillStyle = 'rgba(221,191,100,0.9)';
        if (val < 0){
          ctx.fillStyle = 'rgba(123,24,24,0.9)';
        }
        ctx.fillRect(x, Math.min(y, zeroY), barWidth, Math.abs(barHeight));

        const lbl = dataLabels[i];
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const labelY = height - 10;
        ctx.save();
        ctx.translate(x + barWidth/2, labelY);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(lbl, 0, 0);
        ctx.restore();
      });
    } else {
      // Barras horizontales
      const base = minVal < 0 ? minVal : 0;
      const scale = chartW / (maxVal - base || 1);
      const n = dataValues.length;
      const barSpace = chartH / (n || 1);
      const barHeight = Math.max(10, barSpace * 0.6);

      ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'right';

      dataValues.forEach((val, i) => {
        const barW = (val - base) * scale;
        const y = margin.top + barSpace * i + (barSpace - barHeight)/2;
        const x = margin.left;

        ctx.fillStyle = 'rgba(221,191,100,0.9)';
        if (val < 0){
          ctx.fillStyle = 'rgba(123,24,24,0.9)';
        }
        ctx.fillRect(x, y, Math.abs(barW), barHeight);

        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'right';
        ctx.fillText(dataLabels[i], x - 4, y + barHeight*0.7);
      });
    }
  }

  function escapeHtml(str){
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

})();
