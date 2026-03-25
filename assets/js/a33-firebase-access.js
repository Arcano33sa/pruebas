(function(global){
  'use strict';

  const ACCESS_EVENT = 'a33:access-state';
  const DEFAULT_WORKSPACE_ID = 'default';
  const DEFAULT_REGION = 'us-central1';

  const ROLE_META = {
    admin: {
      label: 'Admin',
      description: 'Opera la administración privilegiada de la suite y gestiona usuarios.',
      permissions: [
        'suite.use',
        'config.view',
        'users.view',
        'users.manage',
        'roles.assign',
        'backup.manage',
        'firebase.admin',
        'sales.use',
        'agenda.use',
        'finance.use',
        'purchases.use',
        'reports.view',
        'inventory.use',
        'production.use',
        'lots.use',
        'pedidos.use',
        'center.view',
        'sandbox.use',
        'catalog.view'
      ]
    },
    ventas: {
      label: 'Ventas',
      description: 'Opera ventas y flujos comerciales sin privilegios administrativos.',
      permissions: [
        'suite.use',
        'sales.use',
        'agenda.use',
        'customers.view',
        'inventory.use',
        'production.use',
        'lots.use',
        'pedidos.use',
        'center.view',
        'reports.view',
        'catalog.view'
      ]
    },
    finanzas: {
      label: 'Finanzas',
      description: 'Opera módulos contables y de control financiero.',
      permissions: [
        'suite.use',
        'finance.use',
        'purchases.use',
        'reports.view',
        'center.view',
        'catalog.view'
      ]
    },
    consulta: {
      label: 'Consulta',
      description: 'Acceso de lectura y operación ligera, sin privilegios de administración.',
      permissions: [
        'suite.use',
        'reports.view',
        'center.view',
        'catalog.view'
      ]
    }
  };

  const STATUS_META = {
    active: { label: 'Activo' },
    inactive: { label: 'Inactivo' },
    pending: { label: 'Pendiente' }
  };

  const state = {
    firebaseReady: false,
    authReady: false,
    firestoreReady: false,
    functionsReady: false,
    functionsRegion: DEFAULT_REGION,
    user: null,
    tokenClaims: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
    profile: null,
    profileMissing: false,
    role: '',
    status: '',
    permissions: [],
    isAdmin: false,
    loadingProfile: false,
    backendHealth: 'idle',
    backendMessage: 'Backend administrativo aún no verificado.',
    canBootstrap: false,
    bootstrapBusy: false,
    lastError: '',
    lastBackendError: '',
    adminBackendVersion: '',
    lastHealthcheckAt: '',
    unsubProfile: null
  };

  function safeString(value){
    return String(value == null ? '' : value).trim();
  }

  function dedupePermissions(list){
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((item) => {
      const key = safeString(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    return out;
  }

  function getRoleMeta(role){
    const key = safeString(role).toLowerCase();
    return ROLE_META[key] || ROLE_META.consulta;
  }

  function getPermissionsForRole(role, explicit){
    const base = dedupePermissions(getRoleMeta(role).permissions);
    const explicitList = dedupePermissions(explicit);
    return dedupePermissions(base.concat(explicitList));
  }

  function getFirebaseState(){
    return global.A33Firebase && typeof global.A33Firebase.getState === 'function'
      ? global.A33Firebase.getState()
      : null;
  }

  function getAuth(){
    return global.A33Firebase && typeof global.A33Firebase._unsafeGetAuth === 'function'
      ? global.A33Firebase._unsafeGetAuth()
      : null;
  }

  function getDb(){
    return global.A33Firebase && typeof global.A33Firebase._unsafeGetDb === 'function'
      ? global.A33Firebase._unsafeGetDb()
      : null;
  }

  function getFunctions(){
    return global.A33Firebase && typeof global.A33Firebase._unsafeGetFunctions === 'function'
      ? global.A33Firebase._unsafeGetFunctions()
      : null;
  }

  function getCurrentWorkspaceId(){
    const profileWorkspace = safeString(state.profile && state.profile.workspaceId);
    if (profileWorkspace) return profileWorkspace;
    const claimWorkspace = safeString(state.tokenClaims && state.tokenClaims.workspaceId);
    return claimWorkspace || DEFAULT_WORKSPACE_ID;
  }

  function snapshot(){
    return {
      firebaseReady: !!state.firebaseReady,
      authReady: !!state.authReady,
      firestoreReady: !!state.firestoreReady,
      functionsReady: !!state.functionsReady,
      functionsRegion: safeString(state.functionsRegion || DEFAULT_REGION) || DEFAULT_REGION,
      user: state.user ? Object.assign({}, state.user) : null,
      tokenClaims: state.tokenClaims ? Object.assign({}, state.tokenClaims) : null,
      workspaceId: getCurrentWorkspaceId(),
      profile: state.profile ? Object.assign({}, state.profile) : null,
      profileMissing: !!state.profileMissing,
      role: safeString(state.role || ''),
      roleLabel: getRoleMeta(state.role).label,
      status: safeString(state.status || ''),
      statusLabel: STATUS_META[safeString(state.status || '').toLowerCase()]?.label || 'Sin estado',
      permissions: dedupePermissions(state.permissions),
      isAdmin: !!state.isAdmin,
      loadingProfile: !!state.loadingProfile,
      backendHealth: safeString(state.backendHealth || 'idle') || 'idle',
      backendMessage: safeString(state.backendMessage || ''),
      canBootstrap: !!state.canBootstrap,
      bootstrapBusy: !!state.bootstrapBusy,
      managementReady: !!(state.isAdmin && state.functionsReady && state.backendHealth === 'ready'),
      lastError: safeString(state.lastError || ''),
      lastBackendError: safeString(state.lastBackendError || ''),
      adminBackendVersion: safeString(state.adminBackendVersion || ''),
      lastHealthcheckAt: safeString(state.lastHealthcheckAt || '')
    };
  }

  function decorateAuthChip(){
    try{
      const span = document.querySelector('#a33-auth-chip span');
      if (!span) return;
      if (!state.user){
        span.textContent = 'Modo local';
        return;
      }
      if (state.profile){
        const role = getRoleMeta(state.profile.role).label;
        const status = STATUS_META[safeString(state.profile.status || '').toLowerCase()]?.label || 'Pendiente';
        span.textContent = role + ' · ' + status;
        return;
      }
      if (state.canBootstrap){
        span.textContent = 'Bootstrap inicial pendiente';
        return;
      }
      if (state.backendHealth === 'ready'){
        span.textContent = 'Perfil pendiente';
        return;
      }
      span.textContent = 'Sesión activa';
    }catch(_){ }
  }

  function emit(){
    const detail = snapshot();
    decorateAuthChip();
    try{
      global.dispatchEvent(new CustomEvent(ACCESS_EVENT, { detail }));
    }catch(_){ }
    return detail;
  }

  function setState(patch){
    Object.assign(state, patch || {});
    return emit();
  }

  function normalizeProfile(payload, uid, claims){
    const data = (payload && typeof payload === 'object') ? payload : {};
    const role = safeString(data.role || claims.role || 'consulta').toLowerCase() || 'consulta';
    const status = safeString(data.status || claims.status || 'pending').toLowerCase() || 'pending';
    const workspaceId = safeString(data.workspaceId || claims.workspaceId || DEFAULT_WORKSPACE_ID) || DEFAULT_WORKSPACE_ID;
    return {
      uid: safeString(data.uid || uid),
      workspaceId,
      name: safeString(data.name || data.displayName || claims.name || ''),
      email: safeString(data.email || claims.email || ''),
      role,
      status,
      permissions: getPermissionsForRole(role, data.permissions),
      createdAt: safeString(data.createdAt || ''),
      updatedAt: safeString(data.updatedAt || ''),
      lastAdminMutationAt: safeString(data.lastAdminMutationAt || ''),
      createdBy: safeString(data.createdBy || ''),
      updatedBy: safeString(data.updatedBy || ''),
      authProvider: safeString(data.authProvider || ''),
      profileVersion: Number.isFinite(Number(data.profileVersion)) ? Number(data.profileVersion) : 1
    };
  }

  function stopProfileListener(){
    if (typeof state.unsubProfile === 'function'){
      try{ state.unsubProfile(); }catch(_){ }
    }
    state.unsubProfile = null;
  }

  function mapCallableError(error){
    const code = safeString(error && error.code ? error.code : '').toLowerCase();
    const message = safeString(error && error.message ? error.message : '');
    const joined = [code, message].join(' ').toLowerCase();
    if (joined.includes('not-found') || joined.includes('404')) return 'Backend administrativo no desplegado todavía.';
    if (code === 'functions/unauthenticated' || code === 'unauthenticated') return 'Debes iniciar sesión para usar el backend administrativo.';
    if (code === 'functions/permission-denied' || code === 'permission-denied') return 'Tu sesión no tiene privilegios administrativos para esta acción.';
    if (code === 'functions/failed-precondition' || code === 'failed-precondition') return message || 'La operación aún no cumple las condiciones necesarias.';
    if (code === 'functions/already-exists' || code === 'already-exists') return message || 'Ya existe un usuario con ese correo.';
    if (code === 'functions/invalid-argument' || code === 'invalid-argument') return message || 'La solicitud no pasó la validación.';
    return message || 'No se pudo completar la operación administrativa.';
  }

  async function getCurrentTokenClaims(forceRefresh){
    const auth = getAuth();
    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (!user || typeof user.getIdTokenResult !== 'function') return null;
    try{
      const tokenResult = await user.getIdTokenResult(!!forceRefresh);
      return tokenResult && tokenResult.claims ? tokenResult.claims : null;
    }catch(error){
      console.warn('[Suite A33] No se pudieron leer claims de Firebase.', error);
      return null;
    }
  }

  async function verifyBackendHealth(force){
    const functions = getFunctions();
    const auth = getAuth();
    const user = auth && auth.currentUser ? auth.currentUser : null;

    if (!functions || typeof functions.httpsCallable !== 'function' || !user){
      return setState({
        backendHealth: state.functionsReady ? 'idle' : 'sdk-missing',
        backendMessage: state.functionsReady
          ? 'Backend administrativo listo para verificarse cuando haya sesión.'
          : 'Functions todavía no está disponible en esta sesión.',
        canBootstrap: false,
        lastBackendError: state.functionsReady ? '' : 'functions-sdk-missing'
      });
    }

    if (!force && state.backendHealth === 'ready' && state.lastHealthcheckAt) return snapshot();

    setState({
      backendHealth: 'checking',
      backendMessage: 'Verificando backend administrativo…',
      lastBackendError: ''
    });

    try{
      const callable = functions.httpsCallable('a33AdminHealthcheck');
      const response = await callable({ workspaceId: getCurrentWorkspaceId() });
      const data = response && response.data && typeof response.data === 'object' ? response.data : {};
      return setState({
        backendHealth: 'ready',
        backendMessage: safeString(data.message || 'Backend administrativo desplegado y respondiendo.'),
        canBootstrap: !!data.currentUserCanBootstrap,
        adminBackendVersion: safeString(data.backendVersion || ''),
        lastBackendError: '',
        lastHealthcheckAt: new Date().toISOString()
      });
    }catch(error){
      const message = mapCallableError(error);
      const missing = /no desplegado|no desplegada|not[- ]found|404/i.test(message);
      return setState({
        backendHealth: missing ? 'missing' : 'error',
        backendMessage: message,
        canBootstrap: false,
        lastBackendError: safeString(error && (error.code || error.message) ? (error.code || error.message) : message),
        lastHealthcheckAt: new Date().toISOString()
      });
    }
  }

  function attachProfileListener(user, claims){
    stopProfileListener();

    const db = getDb();
    const workspaceId = safeString(claims && claims.workspaceId) || DEFAULT_WORKSPACE_ID;
    if (!db || typeof db.collection !== 'function' || !user || !user.uid){
      return setState({
        profile: null,
        profileMissing: true,
        role: safeString(claims && claims.role || ''),
        status: safeString(claims && claims.status || ''),
        permissions: getPermissionsForRole(claims && claims.role, []),
        isAdmin: safeString(claims && claims.role).toLowerCase() === 'admin' && safeString(claims && claims.status).toLowerCase() === 'active',
        loadingProfile: false,
        workspaceId
      });
    }

    setState({ loadingProfile: true, workspaceId, lastError: '' });

    const ref = db.collection('workspaces').doc(workspaceId).collection('members').doc(user.uid);
    state.unsubProfile = ref.onSnapshot((snap) => {
      if (snap && snap.exists){
        const profile = normalizeProfile(snap.data(), user.uid, claims || {});
        setState({
          profile,
          profileMissing: false,
          role: profile.role,
          status: profile.status,
          permissions: getPermissionsForRole(profile.role, profile.permissions),
          isAdmin: profile.role === 'admin' && profile.status === 'active',
          loadingProfile: false,
          lastError: '',
          workspaceId: profile.workspaceId || workspaceId
        });
      } else {
        const role = safeString(claims && claims.role || '').toLowerCase();
        const status = safeString(claims && claims.status || '').toLowerCase();
        setState({
          profile: null,
          profileMissing: true,
          role,
          status,
          permissions: getPermissionsForRole(role, []),
          isAdmin: role === 'admin' && status === 'active',
          loadingProfile: false,
          lastError: '',
          workspaceId
        });
      }
      verifyBackendHealth(false).catch(() => {});
    }, (error) => {
      const role = safeString(claims && claims.role || '').toLowerCase();
      const status = safeString(claims && claims.status || '').toLowerCase();
      setState({
        profile: null,
        profileMissing: true,
        role,
        status,
        permissions: getPermissionsForRole(role, []),
        isAdmin: role === 'admin' && status === 'active',
        loadingProfile: false,
        lastError: safeString(error && error.message ? error.message : 'No se pudo leer el perfil del usuario.'),
        workspaceId
      });
      verifyBackendHealth(false).catch(() => {});
    });
  }

  async function syncFromEnvironment(forceToken){
    const fb = getFirebaseState() || {};
    const auth = getAuth();
    const user = auth && auth.currentUser ? auth.currentUser : null;

    state.firebaseReady = safeString(fb.status || '') === 'ready';
    state.authReady = !!fb.authReady;
    state.firestoreReady = !!fb.firestoreReady;
    state.functionsReady = !!fb.functionsReady;
    state.functionsRegion = safeString(fb.functionsRegion || DEFAULT_REGION) || DEFAULT_REGION;

    if (!user){
      stopProfileListener();
      return setState({
        user: null,
        tokenClaims: null,
        workspaceId: DEFAULT_WORKSPACE_ID,
        profile: null,
        profileMissing: false,
        role: '',
        status: '',
        permissions: [],
        isAdmin: false,
        loadingProfile: false,
        backendHealth: state.functionsReady ? 'idle' : 'sdk-missing',
        backendMessage: state.functionsReady
          ? 'Inicia sesión para verificar el backend administrativo.'
          : 'Functions todavía no está disponible en esta sesión.',
        canBootstrap: false,
        lastError: ''
      });
    }

    const claims = await getCurrentTokenClaims(!!forceToken) || {};
    const nextUser = {
      uid: safeString(user.uid),
      email: safeString(user.email),
      displayName: safeString(user.displayName)
    };

    setState({
      user: nextUser,
      tokenClaims: Object.assign({}, claims),
      workspaceId: safeString(claims.workspaceId || DEFAULT_WORKSPACE_ID) || DEFAULT_WORKSPACE_ID,
      role: safeString(claims.role || '').toLowerCase(),
      status: safeString(claims.status || '').toLowerCase(),
      permissions: getPermissionsForRole(claims.role, []),
      isAdmin: safeString(claims.role || '').toLowerCase() === 'admin' && safeString(claims.status || '').toLowerCase() === 'active',
      lastError: ''
    });

    attachProfileListener(user, claims);
    verifyBackendHealth(false).catch(() => {});
    return snapshot();
  }

  async function bootstrapAdmin(){
    const functions = getFunctions();
    if (!functions || typeof functions.httpsCallable !== 'function'){
      throw new Error('Functions todavía no está disponible.');
    }
    setState({ bootstrapBusy: true, lastBackendError: '', backendMessage: 'Preparando admin inicial…' });
    try{
      const callable = functions.httpsCallable('a33BootstrapWorkspaceAdmin');
      const response = await callable({ workspaceId: getCurrentWorkspaceId() });
      await syncFromEnvironment(true);
      await verifyBackendHealth(true)
      return response && response.data ? response.data : {};
    }catch(error){
      const message = mapCallableError(error);
      setState({ lastBackendError: message, backendMessage: message });
      throw new Error(message);
    }finally{
      setState({ bootstrapBusy: false });
    }
  }

  async function listUsers(){
    const db = getDb();
    const workspaceId = getCurrentWorkspaceId();
    if (!db || typeof db.collection !== 'function'){
      return state.profile ? [Object.assign({}, state.profile)] : [];
    }

    if (!(state.isAdmin && state.permissions.includes('users.view'))){
      return state.profile ? [Object.assign({}, state.profile)] : [];
    }

    const snap = await db.collection('workspaces').doc(workspaceId).collection('members').orderBy('name').limit(250).get();
    return snap.docs.map((doc) => normalizeProfile(doc.data(), doc.id, state.tokenClaims || {}));
  }

  async function saveUser(payload){
    const functions = getFunctions();
    if (!functions || typeof functions.httpsCallable !== 'function'){
      throw new Error('Functions todavía no está disponible.');
    }
    if (!(state.isAdmin && state.permissions.includes('users.manage'))){
      throw new Error('Tu sesión no tiene permisos para administrar usuarios.');
    }
    if (state.backendHealth !== 'ready'){
      await verifyBackendHealth(true);
      if (state.backendHealth !== 'ready') throw new Error(state.backendMessage || 'Backend administrativo no disponible.');
    }

    const input = (payload && typeof payload === 'object') ? Object.assign({}, payload) : {};
    input.workspaceId = getCurrentWorkspaceId();

    try{
      const callable = functions.httpsCallable('a33AdminUpsertUser');
      const response = await callable(input);
      await syncFromEnvironment(false);
      return response && response.data ? response.data : {};
    }catch(error){
      throw new Error(mapCallableError(error));
    }
  }

  async function deleteUser(uid){
    const functions = getFunctions();
    if (!functions || typeof functions.httpsCallable !== 'function'){
      throw new Error('Functions todavía no está disponible.');
    }
    if (!(state.isAdmin && state.permissions.includes('users.manage'))){
      throw new Error('Tu sesión no tiene permisos para borrar usuarios.');
    }
    if (!safeString(uid)) throw new Error('UID inválido.');
    try{
      const callable = functions.httpsCallable('a33AdminDeleteUser');
      const response = await callable({ uid: safeString(uid), workspaceId: getCurrentWorkspaceId() });
      await syncFromEnvironment(false);
      return response && response.data ? response.data : {};
    }catch(error){
      throw new Error(mapCallableError(error));
    }
  }

  function can(permission){
    return dedupePermissions(state.permissions).includes(safeString(permission));
  }

  function canAny(list){
    return dedupePermissions(list).some((permission) => can(permission));
  }

  function canAll(list){
    return dedupePermissions(list).every((permission) => can(permission));
  }

  const api = {
    stateEvent: ACCESS_EVENT,
    getState: snapshot,
    getRoleOptions(){
      return Object.keys(ROLE_META).map((key) => ({
        key,
        label: ROLE_META[key].label,
        description: ROLE_META[key].description,
        permissions: dedupePermissions(ROLE_META[key].permissions)
      }));
    },
    getRoleMeta,
    getPermissionsForRole,
    can,
    canAny,
    canAll,
    refresh(forceToken){
      return syncFromEnvironment(!!forceToken);
    },
    verifyBackend(force){
      return verifyBackendHealth(!!force);
    },
    bootstrapAdmin,
    listUsers,
    saveUser,
    deleteUser
  };

  global.A33Access = api;

  function start(){
    syncFromEnvironment(false).catch((error) => {
      console.warn('[Suite A33] No se pudo iniciar la capa de acceso.', error);
    });

    global.addEventListener('a33:firebase-status', () => {
      syncFromEnvironment(false).catch(() => {});
    });
    global.addEventListener('a33:auth-state', () => {
      syncFromEnvironment(false).catch(() => {});
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
