/* Centro de Mando — Suite A33 (v4.20.4)
   Radar ligero por evento (POS).
   - No inventa números: si algo no se puede calcular fácil, muestra "—".
*/

const POS_DB = 'a33-pos';


const $ = (id) => document.getElementById(id);

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function dateAddDays(iso, delta){
  const [y,m,d] = iso.split('-').map(n => parseInt(n,10));
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate()+delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const dd = String(dt.getDate()).padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}

async function openPosDB(){
  // Centro de Mando NO crea ni migra la DB del POS.
  // Si la DB no existe o requiere upgrade, abortamos y pedimos abrir POS primero.
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = indexedDB.open(POS_DB);

    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve(req.result);
    };

    req.onerror = () => {
      if (settled) return;
      settled = true;
      reject(req.error || new Error('No se pudo abrir POS DB'));
    };

    req.onupgradeneeded = () => {
      // DB no inicializada o requiere upgrade.
      try{ req.transaction && req.transaction.abort(); }catch(_){ }
      try{ req.result && req.result.close && req.result.close(); }catch(_){ }
      if (settled) return;
      settled = true;
      reject(new Error('POS no inicializado/actualizado. Abre POS una vez y reintenta.'));
    };
  });
}

function txGetAll(db, storeName, indexName=null, keyRange=null){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const source = indexName ? store.index(indexName) : store;
    const req = keyRange ? source.getAll(keyRange) : source.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function txGet(db, storeName, key){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function txPut(db, storeName, value){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function readCurrentEventId(db){
  try{
    const rec = await txGet(db, 'meta', 'currentEventId');
    const v = rec && typeof rec.value !== 'undefined' ? rec.value : null;
    return (typeof v === 'number' || typeof v === 'string') ? v : null;
  }catch(_){
    return null;
  }
}

async function writeCurrentEventId(db, eventId){
  try{
    await txPut(db, 'meta', { id:'currentEventId', value: eventId });
  }catch(_){
    // silencioso
  }
}

function money(v){
  const n = Number(v || 0);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('es-NI', { maximumFractionDigits: 0 });
}

function safeText(v){
  return (v === null || typeof v === 'undefined' || v === '') ? '—' : String(v);
}

function setHints(lines){
  const ul = $('hints');
  if (!ul) return;
  ul.innerHTML = '';
  (lines || []).forEach(t => {
    const li = document.createElement('li');
    li.textContent = String(t);
    ul.appendChild(li);
  });
}

function setEventDetailSub(text){
  const el = $('eventDetailSub');
  if (el) el.textContent = text || '—';
}

function renderKpi(kpis){
  const grid = $('globalRadar');
  if (!grid) return;
  grid.innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="label">${k.label}</div>
      <div class="value">${k.value}</div>
      <div class="muted" style="margin-top:6px">${k.sub || ''}</div>
    </div>
  `).join('');
}

function renderFocusCards(cards){
  const wrap = $('eventCards');
  if (!wrap) return;
  wrap.innerHTML = cards.map(c => `
    <div class="tile">
      <h3>${c.title}</h3>
      <div class="muted">${c.body}</div>
    </div>
  `).join('');
}

function buildTopProducts(lines){
  // lines: [{name, qty, amount}]
  if (!lines || !lines.length) return '—';
  const top = lines.slice(0,5).map(x => `${x.name}: ${x.qty}`).join(' · ');
  return top || '—';
}

async function computeRadarGlobal(db){
  const today = todayISO();
  const start7 = dateAddDays(today, -6);

  let totalEvents = '—';
  let salesToday = '—';
  let sales7 = '—';
  let lastSale = '—';

  try{
    const events = await txGetAll(db, 'events');
    totalEvents = String(events.length);
  }catch(_){ }

  try{
    // Ventas hoy (usamos índice por fecha)
    const todaySales = await txGetAll(db, 'sales', 'by_date', IDBKeyRange.only(today));
    const tSum = todaySales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
    salesToday = money(tSum);
  }catch(_){ }

  try{
    // Ventas últimos 7 días (lowerBound)
    const recentSales = await txGetAll(db, 'sales', 'by_date', IDBKeyRange.lowerBound(start7));
    // filtrar por <= hoy, por si hay fechas futuras
    const filtered = recentSales.filter(s => (s.date || '') >= start7 && (s.date || '') <= today);
    const sum = filtered.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
    sales7 = money(sum);

    // última venta
    const latest = filtered.sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
    if (latest){
      lastSale = safeText(latest.date || '—');
    }
  }catch(_){ }

  return {
    today,
    kpis: [
      { label:'Eventos', value: totalEvents, sub:'Registrados en POS' },
      { label:'Ventas hoy', value: salesToday, sub:'C$ (total)' },
      { label:'Ventas 7 días', value: sales7, sub:'C$ (total)' },
      { label:'Última venta', value: lastSale, sub:'Fecha' },
    ]
  };
}

async function computeFocused(db, eventId){
  const today = todayISO();

  let caja = '—';
  let ventasHoy = '—';
  let top = '—';
  let inv = '—';

  // Caja Chica (si existe)
  try{
    const pc = await txGet(db, 'pettyCash', Number(eventId));
    if (pc && pc.days && pc.days[today]){
      const d = pc.days[today];
      caja = d.closedAt ? `Cerrada · ${new Date(d.closedAt).toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'})}` : 'Abierta';
    }else if (pc){
      caja = 'Sin día creado';
    }
  }catch(_){ }

  // Ventas (hoy)
  try{
    const all = await txGetAll(db, 'sales', 'by_event', Number(eventId));
    const todays = all.filter(s => (s.date||'') === today);
    const sum = todays.reduce((acc,s) => acc + (Number(s.total)||0), 0);
    ventasHoy = money(sum);

    // Top productos por qty
    const byName = new Map();
    for (const sale of todays){
      const items = Array.isArray(sale.items) ? sale.items : [];
      for (const it of items){
        const name = it.name || it.productName || it.sku || 'Producto';
        const qty = Number(it.qty || it.quantity || 0) || 0;
        const amount = Number(it.total || it.amount || 0) || 0;
        const prev = byName.get(name) || { name, qty:0, amount:0 };
        prev.qty += qty;
        prev.amount += amount;
        byName.set(name, prev);
      }
    }
    const topArr = Array.from(byName.values()).sort((a,b) => b.qty - a.qty);
    top = buildTopProducts(topArr);
  }catch(_){ }

  // Inventario crítico — si no es fácil, mostramos "—"
  // (Se deja gancho para futura mejora sin romper nada)

  return {
    today,
    cards: [
      { title:'Caja Chica', body: safeText(caja) },
      { title:'Ventas de hoy', body: ventasHoy === '—' ? '—' : `C$ ${ventasHoy}` },
      { title:'Top productos (hoy)', body: safeText(top) },
      { title:'Inventario crítico', body: safeText(inv) },
    ]
  };
}

function bindQuickButtons(eventId){
  const goSell = $('goSell');
  const goCash = $('goPetty');

  // Los tabs reales del POS son: vender | caja | checklist | etc.
  const sellUrl = `../pos/index.html?tab=vender&eventId=${encodeURIComponent(eventId||'')}`;
  const cashUrl = `../pos/index.html?tab=caja&eventId=${encodeURIComponent(eventId||'')}`;

  if (goSell) goSell.setAttribute('href', sellUrl);
  if (goCash) goCash.setAttribute('href', cashUrl);
}

async function init(){
  // Auth
  try{
    if (window.A33Auth && A33Auth.isConfigured && A33Auth.isAuthenticated){
      if (A33Auth.isConfigured() && !A33Auth.isAuthenticated()){
        window.location.href = '../index.html';
        return;
      }
    }
  }catch(_){ }

  const focusSelect = $('focusEvent');

  let db;
  try{
    db = await openPosDB();
  }catch(e){
    setHints([
      'No pude abrir la base del POS.',
      'Abre primero el módulo POS una vez (para inicializar/actualizar la DB) y vuelve a intentar.'
    ]);
    setEventDetailSub('POS no disponible');
    renderKpi([
      {label:'Eventos', value:'—', sub:'POS no disponible'},
      {label:'Ventas hoy', value:'—'},
      {label:'Ventas 7 días', value:'—'},
      {label:'Última venta', value:'—'},
    ]);
    renderFocusCards([
      {title:'Evento enfocado', body:'—'},
      {title:'Caja Chica', body:'—'},
      {title:'Ventas de hoy', body:'—'},
      {title:'Top productos', body:'—'},
    ]);
    return;
  }

  // hints base
  setHints(['Si algo no se puede calcular rápido, se muestra “—”. Mejor vacío que inventado.']);

  // Validación rápida de esquema (evita pantallas vacías si la DB se creó sin stores)
  try{
    if (!db.objectStoreNames.contains('events')){
      setHints([
        'La base del POS existe, pero no tiene los stores esperados (events).',
        'Abre el módulo POS una vez para que cree/actualice la base de datos.',
        'Si aún queda vacío, borra los datos del sitio (Safari → Avanzado → Datos de sitios web) y vuelve a abrir POS.'
      ]);
      setEventDetailSub('POS no inicializado');
      renderKpi([
        {label:'Eventos', value:'—', sub:'DB sin esquema'},
        {label:'Ventas hoy', value:'—'},
        {label:'Ventas 7 días', value:'—'},
        {label:'Última venta', value:'—'},
      ]);
      renderFocusCards([
        {title:'Evento enfocado', body:'—'},
        {title:'Caja Chica', body:'—'},
        {title:'Ventas de hoy', body:'—'},
        {title:'Top productos', body:'—'},
      ]);
      return;
    }
  }catch(_){ }

  // cargar eventos
  let events = [];
  try{ events = await txGetAll(db, 'events'); }catch(_){ events = []; }
  events = events.sort((a,b) => Number(b.updatedAt||b.createdAt||b.id||0) - Number(a.updatedAt||a.createdAt||a.id||0));

  if (!events.length){
    setHints([
      'No hay eventos aún en POS.',
      'Crea un evento en POS → pestaña Eventos, y vuelve aquí.'
    ]);
  }

  // elegir eventId enfocado
  const saved = localStorage.getItem('a33_cmd_focusEventId');
  let focusId = saved ? Number(saved) : null;
  if (!focusId || !events.some(e => Number(e.id) === Number(focusId))){
    const current = await readCurrentEventId(db);
    focusId = current ? Number(current) : (events[0] ? Number(events[0].id) : null);
  }

  // render selector
  if (focusSelect){
    focusSelect.innerHTML = `<option value="">— Selecciona —</option>` + events.map(e => {
      const nm = e.name || e.title || `Evento ${e.id}`;
      return `<option value="${e.id}">${escapeHtml(nm)}</option>`;
    }).join('');
    focusSelect.value = focusId ? String(focusId) : '';
  }

  async function refreshAll(){
    const eid = focusSelect && focusSelect.value ? Number(focusSelect.value) : null;

    // Radar global
    const radar = await computeRadarGlobal(db);
    renderKpi(radar.kpis);

    // Detalle enfocado
    if (!eid){
      setEventDetailSub('Selecciona un evento para ver el detalle.');
      renderFocusCards([
        {title:'Evento enfocado', body:'Selecciona un evento arriba.'},
        {title:'Caja Chica', body:'—'},
        {title:'Ventas de hoy', body:'—'},
        {title:'Top productos (hoy)', body:'—'},
      ]);
      bindQuickButtons('');
      return;
    }

    localStorage.setItem('a33_cmd_focusEventId', String(eid));
    await writeCurrentEventId(db, eid);

    const ev = events.find(x => Number(x.id) === Number(eid));
    const title = ev ? (ev.name || ev.title || `Evento ${eid}`) : `Evento ${eid}`;

    setEventDetailSub(`${title} · ${todayISO()}`);

    const focus = await computeFocused(db, eid);
    renderFocusCards([
      {title:'Evento enfocado', body: escapeHtml(title)},
      ...focus.cards
    ]);

    bindQuickButtons(eid);
  }

  if (focusSelect){
    focusSelect.addEventListener('change', () => { refreshAll(); });
  }

  await refreshAll();
}

function escapeHtml(str){
  return String(str || '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

window.addEventListener('DOMContentLoaded', init);
