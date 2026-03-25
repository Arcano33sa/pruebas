(function(global){
  'use strict';

  const ACCESS_EVENT = 'a33:access-state';
  const AUTH_EVENT = 'a33:auth-state';
  const STYLE_ID = 'a33-module-access-style';
  const OVERLAY_ID = 'a33-module-access-overlay';
  const HOME_NOTE_ID = 'a33-module-access-home-note';

  const RULES = {
    configuracion: {
      key: 'configuracion',
      label: 'Configuración',
      anyOf: ['config.view'],
      pathHints: ['/configuracion/'],
      linkHints: ['configuracion/index.html']
    },
    finanzas: {
      key: 'finanzas',
      label: 'Finanzas',
      anyOf: ['finance.use'],
      pathHints: ['/finanzas/'],
      linkHints: ['finanzas/index.html']
    },
    pos: {
      key: 'pos',
      label: 'POS',
      anyOf: ['sales.use'],
      pathHints: ['/pos/'],
      linkHints: ['pos/index.html']
    },
    agenda: {
      key: 'agenda',
      label: 'Agenda',
      anyOf: ['agenda.use'],
      pathHints: ['/agenda/'],
      linkHints: ['agenda/index.html']
    },
    pedidos: {
      key: 'pedidos',
      label: 'Pedidos',
      anyOf: ['pedidos.use', 'sales.use'],
      pathHints: ['/pedidos/'],
      linkHints: ['pedidos/index.html']
    },
    inventario: {
      key: 'inventario',
      label: 'Inventario',
      anyOf: ['inventory.use'],
      pathHints: ['/inventario/'],
      linkHints: ['inventario/index.html']
    },
    calculadora: {
      key: 'calculadora',
      label: 'Calculadora de Producción',
      anyOf: ['production.use'],
      pathHints: ['/calculadora/'],
      linkHints: ['calculadora/index.html']
    },
    lotes: {
      key: 'lotes',
      label: 'Control de Lotes',
      anyOf: ['lots.use'],
      pathHints: ['/lotes/'],
      linkHints: ['lotes/index.html']
    },
    analitica: {
      key: 'analitica',
      label: 'Analítica',
      anyOf: ['reports.view'],
      pathHints: ['/analitica/'],
      linkHints: ['analitica/index.html']
    },
    centro: {
      key: 'centro',
      label: 'Centro de Mando',
      anyOf: ['center.view'],
      pathHints: ['/centro-mando/', '/centro_mando/'],
      linkHints: ['centro-mando/index.html', 'centro_mando/index.html']
    },
    calculadora_temporal: {
      key: 'calculadora_temporal',
      label: 'Calculadora Temporal',
      anyOf: ['sandbox.use'],
      pathHints: ['/calculadora_temporal/'],
      linkHints: ['calculadora_temporal/index.html']
    },
    calculadora_a33: {
      key: 'calculadora_a33',
      label: 'Calculadora A33',
      anyOf: ['production.use'],
      pathHints: ['/calculadora_a33/'],
      linkHints: ['calculadora_a33/index.html']
    }
  };

  const runtime = {
    auth: null,
    access: null,
    overlay: null,
    currentRule: null,
    currentModuleKey: null,
    initialized: false
  };

  function safeString(value){
    return String(value == null ? '' : value).trim();
  }

  function safeArray(value){
    return Array.isArray(value) ? value : [];
  }

  function getAuthState(){
    try{
      return global.A33Auth && typeof global.A33Auth.getState === 'function'
        ? global.A33Auth.getState()
        : null;
    }catch(_){
      return null;
    }
  }

  function getAccessState(){
    try{
      return global.A33Access && typeof global.A33Access.getState === 'function'
        ? global.A33Access.getState()
        : null;
    }catch(_){
      return null;
    }
  }

  function isHome(){
    return !runtime.currentRule;
  }

  function detectRuleFromPath(){
    const pathname = safeString(global.location && global.location.pathname).toLowerCase();
    const values = Object.values(RULES);
    for (let i = 0; i < values.length; i += 1){
      const rule = values[i];
      if (safeArray(rule.pathHints).some((hint) => pathname.includes(hint))) return rule;
    }
    return null;
  }

  function detectRuleFromLink(link){
    const href = safeString(link).toLowerCase();
    if (!href) return null;
    const values = Object.values(RULES);
    for (let i = 0; i < values.length; i += 1){
      const rule = values[i];
      if (safeArray(rule.linkHints).some((hint) => href.includes(hint))) return rule;
    }
    return null;
  }

  function ensureStyles(){
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.a33-module-access-locked{ overflow:hidden !important; }
      .a33-module-access-overlay{
        position:fixed;
        inset:0;
        z-index:2147482500;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:clamp(16px, 3vw, 28px);
        background:radial-gradient(circle at top, rgba(18,18,18,0.82) 0%, rgba(0,0,0,0.94) 62%, rgba(0,0,0,0.98) 100%);
        backdrop-filter:blur(10px);
      }
      .a33-module-access-overlay[hidden]{ display:none !important; }
      .a33-module-access-card{
        width:min(100%, 480px);
        border-radius:24px;
        border:1px solid rgba(221,191,100,0.28);
        box-shadow:0 22px 48px rgba(0,0,0,0.42);
        background:linear-gradient(180deg, rgba(20,20,20,0.98), rgba(8,8,8,0.98));
        color:#fefefe;
        padding:24px 22px 20px;
      }
      .a33-module-access-kicker{
        display:inline-flex;
        align-items:center;
        gap:8px;
        font-size:0.73rem;
        text-transform:uppercase;
        letter-spacing:0.12em;
        color:#ddbf64;
        margin-bottom:12px;
      }
      .a33-module-access-kicker::before{
        content:'';
        width:8px;
        height:8px;
        border-radius:999px;
        background:#7b1818;
        box-shadow:0 0 0 4px rgba(123,24,24,0.2);
      }
      .a33-module-access-title{
        font-size:1.28rem;
        line-height:1.2;
        margin:0 0 8px;
      }
      .a33-module-access-copy{
        color:#d0d0d0;
        font-size:0.94rem;
        line-height:1.5;
        margin:0 0 10px;
      }
      .a33-module-access-meta{
        color:#ddbf64;
        font-size:0.82rem;
        line-height:1.45;
        margin:0 0 16px;
      }
      .a33-module-access-actions{
        display:flex;
        gap:10px;
        flex-wrap:wrap;
      }
      .a33-module-access-btn{
        border:none;
        border-radius:999px;
        padding:11px 16px;
        font-weight:700;
        cursor:pointer;
      }
      .a33-module-access-btn--primary{
        background:#7b1818;
        color:#fff;
      }
      .a33-module-access-btn--ghost{
        background:transparent;
        color:#fefefe;
        border:1px solid rgba(255,255,255,0.18);
      }
      .a33-module-access-home-note{
        margin:0.9rem 0 0.3rem;
        padding:0.75rem 0.9rem;
        border-radius:16px;
        border:1px solid rgba(221,191,100,0.22);
        background:rgba(0,0,0,0.28);
        color:#e8d8a2;
        font-size:0.83rem;
        line-height:1.45;
      }
      .a33-card-denied{
        display:none !important;
      }
      @media (max-width: 640px){
        .a33-module-access-card{ padding:20px 18px 18px; }
        .a33-module-access-title{ font-size:1.14rem; }
        .a33-module-access-actions > *{ width:100%; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay(){
    if (runtime.overlay) return runtime.overlay;
    ensureStyles();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'a33-module-access-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="a33-module-access-card" role="dialog" aria-modal="true" aria-labelledby="a33-module-access-title">
        <div class="a33-module-access-kicker">Acceso por rol</div>
        <h1 id="a33-module-access-title" class="a33-module-access-title">Verificando acceso…</h1>
        <p id="a33-module-access-copy" class="a33-module-access-copy">Estamos revisando los permisos efectivos de tu sesión.</p>
        <p id="a33-module-access-meta" class="a33-module-access-meta"></p>
        <div class="a33-module-access-actions">
          <button id="a33-module-access-home" class="a33-module-access-btn a33-module-access-btn--primary" type="button">Volver al inicio</button>
          <button id="a33-module-access-refresh" class="a33-module-access-btn a33-module-access-btn--ghost" type="button">Reintentar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#a33-module-access-home').addEventListener('click', () => {
      const target = safeString(global.location && global.location.origin)
        ? global.location.origin + '/index.html'
        : '/index.html';
      global.location.href = target;
    });
    overlay.querySelector('#a33-module-access-refresh').addEventListener('click', () => {
      global.location.reload();
    });
    runtime.overlay = overlay;
    return overlay;
  }

  function setOverlayState(mode, title, copy, meta){
    const overlay = ensureOverlay();
    overlay.hidden = false;
    document.body.classList.add('a33-module-access-locked');
    const titleEl = overlay.querySelector('#a33-module-access-title');
    const copyEl = overlay.querySelector('#a33-module-access-copy');
    const metaEl = overlay.querySelector('#a33-module-access-meta');
    const refreshBtn = overlay.querySelector('#a33-module-access-refresh');
    if (titleEl) titleEl.textContent = safeString(title || 'Acceso restringido');
    if (copyEl) copyEl.textContent = safeString(copy || 'No puedes entrar a esta zona con tu rol actual.');
    if (metaEl) metaEl.textContent = safeString(meta || '');
    if (refreshBtn) refreshBtn.hidden = mode === 'denied';
  }

  function hideOverlay(){
    if (!runtime.overlay) return;
    runtime.overlay.hidden = true;
    document.body.classList.remove('a33-module-access-locked');
  }

  function permissionSet(access){
    return new Set(safeArray(access && access.permissions));
  }

  function hasAnyPermission(access, list){
    const perms = permissionSet(access);
    if (perms.has('module.all')) return true;
    return safeArray(list).some((item) => perms.has(safeString(item)));
  }

  function roleDescriptor(access){
    if (!access) return '';
    const role = safeString(access.roleLabel || access.role || 'Sin rol');
    const status = safeString(access.statusLabel || access.status || 'Sin estado');
    return role && status ? role + ' · ' + status : role || status;
  }

  function isRuleAllowed(rule, auth, access){
    if (!rule) return true;

    const authMode = safeString(auth && auth.mode).toLowerCase();
    if (authMode === 'local' || !(auth && auth.authEnabled)) return true;

    if (!auth || auth.loading || !auth.authResolved) return null;
    if (!auth.user) return null;
    if (!access) return null;
    if (access.loadingProfile) return null;
    if (access.canBootstrap && rule.key === 'configuracion') return true;
    if (safeString(access.status).toLowerCase() !== 'active') return false;
    if (!safeArray(access.permissions).length) return false;
    return hasAnyPermission(access, rule.anyOf);
  }

  function isPendingAccess(auth, access){
    const authMode = safeString(auth && auth.mode).toLowerCase();
    if (authMode === 'local' || !(auth && auth.authEnabled)) return false;
    if (!auth || auth.loading || !auth.authResolved) return true;
    if (!auth.user) return true;
    if (!access) return true;
    return !!access.loadingProfile;
  }

  function renderHomeNote(allowedCount, totalCount, access){
    const homeView = document.getElementById('home-view');
    if (!homeView) return;
    let note = document.getElementById(HOME_NOTE_ID);
    if (!note){
      note = document.createElement('div');
      note.id = HOME_NOTE_ID;
      note.className = 'a33-module-access-home-note';
      homeView.insertBefore(note, homeView.children[1] || null);
    }

    const auth = runtime.auth;
    const authMode = safeString(auth && auth.mode).toLowerCase();
    if (authMode === 'local' || !(auth && auth.authEnabled)){
      note.textContent = 'Modo local activo. La suite muestra todos los módulos disponibles en este dispositivo.';
      return;
    }

    if (access && access.canBootstrap){
      note.textContent = 'Tu sesión puede activar el admin inicial. Por ahora se muestra solo la zona necesaria para completar ese arranque serio.';
      return;
    }

    if (allowedCount <= 0){
      note.textContent = 'Tu sesión está autenticada, pero no tiene módulos operativos habilitados todavía. Pide a un Admin que ajuste tu rol o tus permisos.';
      return;
    }

    note.textContent = `${roleDescriptor(access) || 'Acceso activo'} · Se muestran ${allowedCount} de ${totalCount} módulos habilitados para tu perfil.`;
  }

  function filterHomeCards(){
    const cards = Array.from(document.querySelectorAll('[data-link]'));
    if (!cards.length) return;

    if (isPendingAccess(runtime.auth, runtime.access)){
      cards.forEach((card) => {
        card.classList.remove('a33-card-denied');
        card.hidden = false;
      });
      document.querySelectorAll('.menu-section').forEach((section) => {
        section.hidden = false;
      });
      renderHomeNote(0, 0, null);
      const note = document.getElementById(HOME_NOTE_ID);
      if (note) note.textContent = 'Verificando acceso de tu sesión para ordenar los módulos disponibles…';
      return;
    }

    let totalKnown = 0;
    let allowedKnown = 0;

    cards.forEach((card) => {
      const rule = detectRuleFromLink(card.getAttribute('data-link'));
      if (!rule){
        card.classList.remove('a33-card-denied');
        card.hidden = false;
        return;
      }
      totalKnown += 1;
      const allowed = isRuleAllowed(rule, runtime.auth, runtime.access);
      const show = allowed === true;
      if (show) allowedKnown += 1;
      card.classList.toggle('a33-card-denied', !show);
      card.hidden = !show;
    });

    document.querySelectorAll('.menu-section').forEach((section) => {
      const visibleCards = section.querySelectorAll('article.card:not(.a33-card-denied)').length;
      section.hidden = visibleCards === 0;
    });

    renderHomeNote(allowedKnown, totalKnown, runtime.access);
  }

  function enforceRoute(){
    if (isHome()){
      hideOverlay();
      filterHomeCards();
      return;
    }

    const allowed = isRuleAllowed(runtime.currentRule, runtime.auth, runtime.access);
    if (allowed === null){
      setOverlayState(
        'loading',
        'Verificando acceso…',
        `Estamos revisando si tu sesión puede entrar a ${runtime.currentRule.label}.`,
        roleDescriptor(runtime.access)
      );
      return;
    }

    if (allowed === true){
      hideOverlay();
      return;
    }

    setOverlayState(
      'denied',
      'Acceso limitado',
      `Tu rol actual no tiene permiso para entrar a ${runtime.currentRule.label}.`,
      `${roleDescriptor(runtime.access)}${roleDescriptor(runtime.access) ? ' · ' : ''}Pide a un Admin que ajuste tu acceso si esta zona te corresponde.`
    );
  }

  function syncState(){
    runtime.auth = getAuthState();
    runtime.access = getAccessState();
    enforceRoute();
  }

  function start(){
    if (runtime.initialized) return;
    runtime.initialized = true;
    runtime.currentRule = detectRuleFromPath();
    runtime.currentModuleKey = runtime.currentRule ? runtime.currentRule.key : 'home';
    if (!isHome()) setOverlayState('loading', 'Verificando acceso…', 'Estamos revisando los permisos efectivos de tu sesión.', '');
    syncState();
    global.addEventListener(ACCESS_EVENT, (event) => {
      runtime.access = event && event.detail ? event.detail : getAccessState();
      enforceRoute();
    });
    global.addEventListener(AUTH_EVENT, (event) => {
      runtime.auth = event && event.detail ? event.detail : getAuthState();
      enforceRoute();
    });
  }

  global.A33ModuleAccess = {
    getCurrentRule(){
      return runtime.currentRule ? Object.assign({}, runtime.currentRule) : null;
    },
    refresh(){
      syncState();
      return {
        auth: runtime.auth,
        access: runtime.access,
        currentRule: runtime.currentRule
      };
    }
  };

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
