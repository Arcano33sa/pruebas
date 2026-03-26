(function(g){
  'use strict';

  const LAST_STATE_KEY = 'a33_guard_last_state_v1';
  const LAST_NEXT_KEY = 'a33_guard_pending_next_v1';

  function safeText(value){
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value){
    return safeText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clone(obj){
    try{ return JSON.parse(JSON.stringify(obj || {})); }
    catch(_){ return {}; }
  }

  function getAuthStatus(){
    try{
      if (g.A33Auth && typeof g.A33Auth.getStatusSync === 'function'){
        return g.A33Auth.getStatusSync();
      }
    }catch(_){ }
    return {
      code: 'signed-out',
      label: 'Sin sesión',
      message: 'No hay una sesión activa en este navegador.',
      isAuthenticated: false,
      isBusy: false,
      authReady: false,
      user: null,
      error: null
    };
  }

  function getWorkspaceStatus(){
    try{
      if (g.A33Workspace && typeof g.A33Workspace.getStatusSync === 'function'){
        return g.A33Workspace.getStatusSync();
      }
    }catch(_){ }
    return {
      code: 'idle',
      label: 'Contexto pendiente',
      message: 'El contexto real todavía no está listo.',
      hasContext: false,
      isBusy: false,
      workspace: null,
      membership: null,
      role: '',
      error: null
    };
  }

  function getFirebaseStatus(){
    try{
      if (g.A33Firebase && typeof g.A33Firebase.getStatusSync === 'function'){
        return g.A33Firebase.getStatusSync();
      }
    }catch(_){ }
    return {
      code: 'placeholder',
      label: 'Config pendiente',
      message: 'Firebase todavía no está listo en esta página.',
      hasRealConfig: false,
      services: { appPrepared:false, authPrepared:false, firestorePrepared:false },
      error: null
    };
  }

  function getCurrentRelativeUrl(){
    const path = safeText(g.location && g.location.pathname);
    const search = safeText(g.location && g.location.search);
    const hash = safeText(g.location && g.location.hash);
    return `${path || '/'}${search}${hash}`;
  }

  function normalizeNext(value){
    const raw = safeText(value);
    if (!raw) return '';
    try{
      const url = new URL(raw, g.location.href);
      if (url.origin !== g.location.origin) return '';
      return `${url.pathname}${url.search}${url.hash}`;
    }catch(_){
      return '';
    }
  }

  function getQueryParams(){
    try{ return new URLSearchParams(g.location.search || ''); }
    catch(_){ return new URLSearchParams(); }
  }

  function readLastState(){
    try{
      const raw = g.localStorage ? g.localStorage.getItem(LAST_STATE_KEY) : '';
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    }catch(_){
      return null;
    }
  }

  function writeLastState(state){
    try{
      if (!g.localStorage) return;
      g.localStorage.setItem(LAST_STATE_KEY, JSON.stringify(state || {}));
    }catch(_){ }
  }

  function writePendingNext(next){
    const safeNext = normalizeNext(next);
    try{
      if (!g.sessionStorage) return;
      if (safeNext) g.sessionStorage.setItem(LAST_NEXT_KEY, safeNext);
      else g.sessionStorage.removeItem(LAST_NEXT_KEY);
    }catch(_){ }
  }

  function readPendingNext(){
    try{
      const fromQuery = normalizeNext(getQueryParams().get('next'));
      if (fromQuery) return fromQuery;
      if (!g.sessionStorage) return '';
      return normalizeNext(g.sessionStorage.getItem(LAST_NEXT_KEY));
    }catch(_){
      return '';
    }
  }

  function clearPendingNext(){
    writePendingNext('');
  }

  function getReason(auth, workspace, requireContext){
    const firebase = getFirebaseStatus();
    if (!firebase.hasRealConfig) return 'needs-config';
    if (!auth || !auth.isAuthenticated || !auth.user) return 'signed-out';
    if (requireContext && (!workspace || !workspace.hasContext)){
      const code = safeText(workspace && workspace.code);
      if (code === 'no-membership') return 'no-context';
      return 'no-context';
    }
    return 'ok';
  }

  function buildStateSnapshot(options = {}){
    const auth = getAuthStatus();
    const workspace = getWorkspaceStatus();
    const requireContext = options.requireContext !== false;
    const reason = getReason(auth, workspace, requireContext);
    const authorized = reason === 'ok';
    return {
      checkedAt: new Date().toISOString(),
      requireContext,
      reason,
      authorized,
      auth: clone(auth),
      workspace: clone(workspace),
      firebase: clone(getFirebaseStatus())
    };
  }

  function persistState(options = {}){
    const snapshot = buildStateSnapshot(options);
    writeLastState(snapshot);
    return snapshot;
  }

  function reasonMeta(reason){
    const map = {
      'signed-out': {
        title: 'Acceso requerido',
        message: 'Inicia sesión para entrar a la Suite y abrir sus módulos.',
        button: 'Abrir acceso',
        section: 'firebase-base'
      },
      'needs-config': {
        title: 'Configurar acceso',
        message: 'Firebase todavía no quedó listo en este navegador. Sin esa base, la puerta no abre.',
        button: 'Revisar acceso',
        section: 'firebase-base'
      },
      'no-context': {
        title: 'Contexto pendiente',
        message: 'La sesión existe, pero falta un contexto válido del espacio compartido para operar módulos.',
        button: 'Preparar contexto',
        section: 'workspace-context'
      }
    };
    return map[reason] || {
      title: 'Acceso pendiente',
      message: 'Hace falta validar la sesión o el contexto antes de entrar.',
      button: 'Revisar acceso',
      section: 'firebase-base'
    };
  }

  function cleanHomeUrl(homeUrl){
    try{
      const url = new URL(homeUrl || '/index.html', g.location.href);
      return url;
    }catch(_){
      return new URL('/index.html', g.location.origin);
    }
  }

  function redirectHome(homeUrl, reason){
    const home = cleanHomeUrl(homeUrl);
    const current = getCurrentRelativeUrl();
    if (normalizeNext(current)) home.searchParams.set('next', current);
    if (safeText(reason)) home.searchParams.set('guard', reason);
    writePendingNext(current);
    g.location.replace(home.toString());
  }

  function cleanupHomeQuery(homeUrl){
    try{
      const next = readPendingNext();
      if (next) return;
      const url = cleanHomeUrl(homeUrl);
      const current = new URL(g.location.href);
      if (current.pathname !== url.pathname) return;
      if (!current.searchParams.has('guard') && !current.searchParams.has('next')) return;
      current.searchParams.delete('guard');
      current.searchParams.delete('next');
      const cleaned = `${current.pathname}${current.search}${current.hash}`;
      g.history.replaceState({}, '', cleaned);
    }catch(_){ }
  }

  function openGuardSection(reason, overrideSection){
    const section = safeText(overrideSection) || reasonMeta(reason).section || 'firebase-base';
    try{
      if (typeof g.showConfigurationHome === 'function'){
        g.showConfigurationHome({ initialSection: section });
        return true;
      }
    }catch(_){ }
    return false;
  }

  function ensureGuardStyle(){
    if (document.getElementById('a33-route-guard-style')) return;
    const style = document.createElement('style');
    style.id = 'a33-route-guard-style';
    style.textContent = `
      html.a33-guard-pending body{ visibility:hidden; }
      .a33-route-guard{ position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center; padding:1rem; background:rgba(0,0,0,0.84); backdrop-filter:blur(10px); }
      .a33-route-guard[hidden]{ display:none !important; }
      .a33-route-guard__card{ width:min(640px,100%); background:linear-gradient(180deg,rgba(20,20,20,0.97),rgba(8,8,8,0.98)); border:1px solid rgba(221,191,100,0.35); border-radius:24px; box-shadow:0 20px 60px rgba(0,0,0,0.6); color:#fefefe; padding:1.35rem 1.15rem; }
      .a33-route-guard__kicker{ font-size:0.74rem; letter-spacing:0.12em; text-transform:uppercase; color:#ddbf64; margin:0 0 0.4rem; }
      .a33-route-guard__title{ margin:0 0 0.5rem; font-size:1.35rem; }
      .a33-route-guard__copy{ margin:0; color:#d0d0d0; line-height:1.45; }
      .a33-route-guard__meta{ margin-top:0.85rem; display:grid; gap:0.55rem; }
      .a33-route-guard__pill{ display:inline-flex; width:max-content; max-width:100%; align-items:center; gap:0.35rem; padding:0.3rem 0.7rem; border-radius:999px; background:rgba(0,0,0,0.5); border:1px solid rgba(221,191,100,0.35); color:#ddbf64; font-size:0.78rem; }
      .a33-route-guard__actions{ margin-top:1rem; display:flex; flex-wrap:wrap; gap:0.6rem; }
      .a33-route-guard__btn{ border:none; border-radius:999px; padding:0.65rem 1rem; cursor:pointer; font-size:0.88rem; }
      .a33-route-guard__btn--primary{ background:#7b1818; color:#fff; }
      .a33-route-guard__btn--ghost{ background:transparent; color:#fefefe; border:1px solid rgba(255,255,255,0.18); }
      .a33-route-guard__note{ margin-top:0.9rem; font-size:0.8rem; color:#aaaaaa; }
    `;
    document.head.appendChild(style);
  }

  function getGuardRoot(){
    let root = document.getElementById('a33-route-guard');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'a33-route-guard';
    root.className = 'a33-route-guard';
    root.hidden = true;
    document.body.appendChild(root);
    return root;
  }

  function showHomeOverlay(options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    ensureGuardStyle();
    const reason = safeText(opts.reason) || 'signed-out';
    const meta = reasonMeta(reason);
    const snapshot = buildStateSnapshot({ requireContext: opts.requireContext !== false });
    const auth = snapshot.auth || {};
    const workspace = snapshot.workspace || {};
    const next = normalizeNext(opts.next || readPendingNext());
    const workspaceName = safeText(workspace && workspace.workspace && (workspace.workspace.name || workspace.workspace.id));
    const email = safeText(auth && auth.user && auth.user.email);
    const root = getGuardRoot();
    root.innerHTML = `
      <div class="a33-route-guard__card" role="dialog" aria-modal="true" aria-labelledby="a33-route-guard-title">
        <div class="a33-route-guard__kicker">Guard global de acceso</div>
        <h2 class="a33-route-guard__title" id="a33-route-guard-title">${escapeHtml(meta.title)}</h2>
        <p class="a33-route-guard__copy">${escapeHtml(opts.message || meta.message)}</p>
        <div class="a33-route-guard__meta">
          <span class="a33-route-guard__pill">${escapeHtml(email || 'Sin sesión válida')}</span>
          <span class="a33-route-guard__pill">${escapeHtml(workspaceName || 'Sin contexto válido')}</span>
          ${next ? `<span class="a33-route-guard__pill">Destino pendiente: ${escapeHtml(next)}</span>` : ''}
        </div>
        <div class="a33-route-guard__actions">
          <button type="button" class="a33-route-guard__btn a33-route-guard__btn--primary" data-a33-guard-open="1">${escapeHtml(meta.button)}</button>
          <button type="button" class="a33-route-guard__btn a33-route-guard__btn--ghost" data-a33-guard-refresh="1">Revisar de nuevo</button>
        </div>
        <div class="a33-route-guard__note">La app volverá al destino pendiente apenas la sesión y el contexto queden válidos.</div>
      </div>
    `;
    root.hidden = false;
    const openBtn = root.querySelector('[data-a33-guard-open]');
    if (openBtn){
      openBtn.onclick = () => {
        const opened = openGuardSection(reason, opts.section);
        if (!opened){
          try{ g.location.hash = '#configuracion'; }catch(_){ }
        }
      };
    }
    const refreshBtn = root.querySelector('[data-a33-guard-refresh]');
    if (refreshBtn){
      refreshBtn.onclick = async () => {
        refreshBtn.disabled = true;
        try{
          if (g.A33Auth && typeof g.A33Auth.refresh === 'function') await g.A33Auth.refresh();
          if (g.A33Workspace && typeof g.A33Workspace.refresh === 'function') await g.A33Workspace.refresh({ forceEnsure:false });
        }catch(_){
        }finally{
          refreshBtn.disabled = false;
        }
      };
    }
    document.documentElement.classList.remove('a33-guard-pending');
  }

  function hideOverlay(){
    const root = document.getElementById('a33-route-guard');
    if (root) root.hidden = true;
  }

  async function primeAuthAndWorkspace(requireContext){
    try{
      if (g.A33Firebase && typeof g.A33Firebase.boot === 'function') await g.A33Firebase.boot();
    }catch(_){ }
    try{
      if (g.A33Auth && typeof g.A33Auth.refresh === 'function') await g.A33Auth.refresh();
    }catch(_){ }
    try{
      if (requireContext !== false && g.A33Workspace && typeof g.A33Workspace.refresh === 'function'){
        await g.A33Workspace.refresh({ forceEnsure:false });
      }
    }catch(_){ }
    return persistState({ requireContext: requireContext !== false });
  }

  async function maybeReturnToPendingTarget(options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    const params = getQueryParams();
    const fromQuery = normalizeNext(params.get('next'));
    const allowStored = !!opts.allowStored;
    const next = normalizeNext(opts.next || fromQuery || (allowStored ? readPendingNext() : ''));
    if (!next) return false;
    const current = getCurrentRelativeUrl();
    if (next === current) return false;
    clearPendingNext();
    g.location.replace(next);
    return true;
  }

  async function boot(options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    const page = safeText(opts.page) || 'module';
    const requireContext = opts.requireContext !== false;
    const homeUrl = safeText(opts.homeUrl) || '/index.html';
    const immediate = persistState({ requireContext });

    if (page === 'home'){
      ensureGuardStyle();
      const initialReason = immediate.reason;
      if (initialReason === 'ok'){
        document.documentElement.classList.remove('a33-guard-pending');
        hideOverlay();
      }else{
        showHomeOverlay({ reason: initialReason, requireContext, next: readPendingNext() });
      }
    }

    const finalState = await primeAuthAndWorkspace(requireContext);
    const reason = finalState.reason;

    if (page === 'home'){
      if (reason === 'ok'){
        document.documentElement.classList.remove('a33-guard-pending');
        hideOverlay();
        cleanupHomeQuery(homeUrl);
        await maybeReturnToPendingTarget({ allowStored:false });
      }else{
        showHomeOverlay({ reason, requireContext, next: readPendingNext() });
      }
    }else{
      if (reason === 'ok'){
        document.documentElement.classList.remove('a33-guard-pending');
      }else{
        redirectHome(homeUrl, reason);
      }
    }

    return clone(finalState);
  }

  function canEnter(options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    const requireContext = opts.requireContext !== false;
    const state = persistState({ requireContext });
    return !!state.authorized;
  }

  function navigate(next, options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    const requireContext = opts.requireContext !== false;
    const homeUrl = safeText(opts.homeUrl) || '/index.html';
    const safeNext = normalizeNext(next);
    if (!safeNext) return false;
    const state = persistState({ requireContext });
    if (state.authorized){
      g.location.href = safeNext;
      return true;
    }
    writePendingNext(safeNext);
    if ((safeText(opts.page) || '') === 'home'){
      showHomeOverlay({ reason: state.reason, requireContext, next: safeNext });
      openGuardSection(state.reason, opts.section);
      return false;
    }
    redirectHome(homeUrl, state.reason);
    return false;
  }

  function bindReactivity(options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    const page = safeText(opts.page) || 'module';
    const requireContext = opts.requireContext !== false;
    const homeUrl = safeText(opts.homeUrl) || '/index.html';

    const rerun = async () => {
      const state = persistState({ requireContext });
      if (page === 'home'){
        if (state.authorized){
          document.documentElement.classList.remove('a33-guard-pending');
          hideOverlay();
          cleanupHomeQuery(homeUrl);
          await maybeReturnToPendingTarget({ allowStored:false });
        }else{
          showHomeOverlay({ reason: state.reason, requireContext, next: readPendingNext() });
        }
        return;
      }
      if (!state.authorized){
        redirectHome(homeUrl, state.reason);
      }
    };

    try{
      const authEventName = (g.A33Auth && g.A33Auth.EVENT_NAME) || 'a33-auth-state';
      const workspaceEventName = (g.A33Workspace && g.A33Workspace.EVENT_NAME) || 'a33-workspace-state';
      g.addEventListener(authEventName, () => { rerun().catch(() => {}); });
      g.addEventListener(workspaceEventName, () => { rerun().catch(() => {}); });
    }catch(_){ }
  }

  g.A33RouteGuard = {
    boot,
    bindReactivity,
    canEnter,
    navigate,
    persistState,
    readLastState,
    readPendingNext,
    clearPendingNext,
    openGuardSection
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
