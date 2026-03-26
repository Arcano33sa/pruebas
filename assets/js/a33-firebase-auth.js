(function(g){
  'use strict';

  const EVENT_NAME = 'a33-auth-state';
  let ensurePromise = null;
  let unsubscribeAuth = null;
  let currentState = null;

  function nowIso(){
    return new Date().toISOString();
  }

  function clone(obj){
    try{ return JSON.parse(JSON.stringify(obj || {})); }
    catch(_){ return {}; }
  }

  function safeText(value){
    return String(value == null ? '' : value).trim();
  }

  function getFirebaseStatus(){
    try{
      if (g.A33Firebase && typeof g.A33Firebase.getStatusSync === 'function'){
        return g.A33Firebase.getStatusSync();
      }
    }catch(_){ }
    return {
      code: 'placeholder',
      label: 'Pendiente de configuración',
      message: 'Firebase base aún no está disponible.',
      hasRealConfig: false,
      services: { appPrepared:false, authPrepared:false, firestorePrepared:false },
      warnings: [],
      error: null,
      checkedAt: nowIso()
    };
  }

  function buildBaseState(){
    const firebase = getFirebaseStatus();
    let code = 'idle';
    let label = 'Acceso en espera';
    let message = 'La base de acceso está en espera.';

    if (!firebase.hasRealConfig){
      code = 'needs-config';
      label = 'Config pendiente';
      message = 'Completa la configuración de Firebase en este navegador para activar el acceso real.';
    }else if (firebase.code === 'error'){
      code = 'firebase-error';
      label = 'Firebase con error';
      message = firebase.message || 'Firebase reportó un problema al preparar Auth.';
    }else if (!firebase.services || !firebase.services.authPrepared){
      code = 'boot-needed';
      label = 'Lista para iniciar';
      message = 'La base está lista; falta levantar Auth para revisar o abrir sesión.';
    }else{
      code = 'signed-out';
      label = 'Sin sesión';
      message = 'No hay una sesión activa en este navegador.';
    }

    return {
      code,
      label,
      message,
      isAuthenticated: false,
      isBusy: false,
      authReady: !!(firebase.services && firebase.services.authPrepared),
      persistence: 'LOCAL',
      user: null,
      error: null,
      checkedAt: nowIso(),
      firebase: {
        code: firebase.code || 'placeholder',
        label: firebase.label || 'Pendiente de configuración',
        message: firebase.message || '',
        hasRealConfig: !!firebase.hasRealConfig,
        warnings: Array.isArray(firebase.warnings) ? firebase.warnings.slice() : [],
        checkedAt: firebase.checkedAt || nowIso(),
        error: firebase.error ? clone(firebase.error) : null,
        projectId: safeText(firebase.projectId),
        authDomain: safeText(firebase.authDomain)
      }
    };
  }

  function mergeState(partial){
    const base = buildBaseState();
    const prev = currentState && typeof currentState === 'object' ? currentState : {};
    const next = {
      ...base,
      ...prev,
      ...(partial || {}),
      checkedAt: nowIso(),
      firebase: {
        ...(base.firebase || {}),
        ...((prev.firebase && typeof prev.firebase === 'object') ? prev.firebase : {}),
        ...(((partial || {}).firebase && typeof (partial || {}).firebase === 'object') ? (partial || {}).firebase : {})
      }
    };
    currentState = next;
    emitState();
    return clone(currentState);
  }

  function emitState(){
    try{
      if (typeof g.dispatchEvent === 'function' && typeof CustomEvent === 'function'){
        g.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: clone(currentState) }));
      }
    }catch(_){ }
  }

  function formatUser(user){
    if (!user) return null;
    const uid = safeText(user.uid);
    return {
      uid,
      uidShort: uid ? (uid.length > 12 ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : uid) : '',
      email: safeText(user.email),
      displayName: safeText(user.displayName),
      emailVerified: !!user.emailVerified,
      isAnonymous: !!user.isAnonymous,
      createdAt: safeText(user.metadata && user.metadata.creationTime),
      lastLoginAt: safeText(user.metadata && user.metadata.lastSignInTime)
    };
  }

  function mapAuthError(error){
    const code = safeText(error && error.code);
    const rawMessage = safeText(error && error.message) || 'No se pudo completar la operación de acceso.';
    const joined = `${code} ${rawMessage}`.toLowerCase();

    if (!code && /unauthorized-domain/.test(joined)){
      return {
        code: 'auth/unauthorized-domain',
        message: 'Este dominio todavía no está autorizado en Firebase Authentication. Agrégalo en Authorized domains.'
      };
    }

    const map = {
      'auth/invalid-email': 'El correo no tiene un formato válido.',
      'auth/missing-password': 'Escribe la contraseña para iniciar sesión.',
      'auth/missing-email': 'Escribe el correo para iniciar sesión.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/wrong-password': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'No existe un usuario con ese correo.',
      'auth/user-disabled': 'Ese usuario está deshabilitado en Firebase.',
      'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un momento y vuelve a intentar.',
      'auth/network-request-failed': 'No hubo conexión suficiente para validar el acceso.',
      'auth/operation-not-allowed': 'El proveedor Email/Password aún no está habilitado en Firebase Authentication.',
      'auth/unauthorized-domain': 'Este dominio todavía no está autorizado en Firebase Authentication. Agrégalo en Authorized domains.',
      'sdk/load-failed': 'No se pudo cargar el SDK de Firebase. Revisa conexión, caché o políticas de red.'
    };

    return {
      code: code || 'auth/error',
      message: map[code] || rawMessage || 'No se pudo completar la operación de acceso.'
    };
  }

  async function prepareAuthInfrastructure(options){
    const opts = options && typeof options === 'object' ? options : {};
    if (ensurePromise) return ensurePromise;

    ensurePromise = (async () => {
      if (!g.A33Firebase || typeof g.A33Firebase.boot !== 'function'){
        return mergeState({
          code: 'firebase-missing',
          label: 'Firebase no disponible',
          message: 'La base Firebase no está cargada en esta página.',
          isBusy: false,
          authReady: false,
          user: null,
          isAuthenticated: false,
          error: { code:'firebase/missing', message:'La base Firebase no está disponible.' }
        });
      }

      const firebaseStatus = await g.A33Firebase.boot();
      const firebase = getFirebaseStatus();

      if (!firebaseStatus || !firebaseStatus.hasRealConfig){
        return mergeState({
          code: 'needs-config',
          label: 'Config pendiente',
          message: 'Completa la configuración de Firebase en este navegador antes de intentar entrar.',
          isBusy: false,
          authReady: false,
          user: null,
          isAuthenticated: false,
          error: null,
          firebase
        });
      }

      if (firebaseStatus.code === 'error'){
        const mapped = mapAuthError(firebaseStatus.error || firebaseStatus);
        return mergeState({
          code: 'firebase-error',
          label: 'Firebase con error',
          message: mapped.message,
          isBusy: false,
          authReady: false,
          user: null,
          isAuthenticated: false,
          error: mapped,
          firebase
        });
      }

      const auth = g.A33Firebase.getAuth && g.A33Firebase.getAuth();
      const modules = g.A33Firebase.getModules && g.A33Firebase.getModules();
      const authMod = modules && modules.auth;

      if (!auth || !authMod){
        return mergeState({
          code: 'firebase-error',
          label: 'Auth no preparado',
          message: 'Firebase no pudo preparar Authentication correctamente.',
          isBusy: false,
          authReady: false,
          user: null,
          isAuthenticated: false,
          error: { code:'auth/not-ready', message:'Firebase no pudo preparar Authentication correctamente.' },
          firebase
        });
      }

      try{
        await authMod.setPersistence(auth, authMod.browserLocalPersistence);
      }catch(error){
        const mapped = mapAuthError(error);
        return mergeState({
          code: 'error',
          label: 'Persistencia con error',
          message: mapped.message,
          isBusy: false,
          authReady: true,
          user: null,
          isAuthenticated: false,
          error: mapped,
          firebase
        });
      }

      if (!unsubscribeAuth){
        unsubscribeAuth = authMod.onAuthStateChanged(auth, (user) => {
          const firebaseNext = getFirebaseStatus();
          if (user){
            mergeState({
              code: 'authenticated',
              label: 'Sesión activa',
              message: 'Sesión iniciada y persistente en este navegador.',
              isBusy: false,
              authReady: true,
              user: formatUser(user),
              isAuthenticated: true,
              error: null,
              firebase: {
                ...((currentState && currentState.firebase) || {}),
                ...firebaseNext
              }
            });
            return;
          }
          mergeState({
            code: 'signed-out',
            label: 'Sin sesión',
            message: 'No hay una sesión activa en este navegador.',
            isBusy: false,
            authReady: true,
            user: null,
            isAuthenticated: false,
            error: null,
            firebase: {
              ...((currentState && currentState.firebase) || {}),
              ...firebaseNext
            }
          });
        }, (error) => {
          const mapped = mapAuthError(error);
          mergeState({
            code: 'error',
            label: 'Error de sesión',
            message: mapped.message,
            isBusy: false,
            authReady: true,
            user: null,
            isAuthenticated: false,
            error: mapped,
            firebase: {
              ...((currentState && currentState.firebase) || {}),
              ...getFirebaseStatus()
            }
          });
        });
      }

      if (opts && opts.skipStateSync){
        return mergeState({
          authReady: true,
          isBusy: false,
          error: null,
          firebase
        });
      }

      if (auth.currentUser){
        return mergeState({
          code: 'authenticated',
          label: 'Sesión activa',
          message: 'Sesión iniciada y persistente en este navegador.',
          isBusy: false,
          authReady: true,
          user: formatUser(auth.currentUser),
          isAuthenticated: true,
          error: null,
          firebase
        });
      }

      return mergeState({
        code: 'signed-out',
        label: 'Sin sesión',
        message: 'No hay una sesión activa en este navegador.',
        isBusy: false,
        authReady: true,
        user: null,
        isAuthenticated: false,
        error: null,
        firebase
      });
    })().finally(() => {
      ensurePromise = null;
    });

    return ensurePromise;
  }

  async function refresh(){
    return prepareAuthInfrastructure({ skipStateSync:false });
  }

  async function signIn(email, password){
    const safeEmail = safeText(email).toLowerCase();
    const safePassword = String(password == null ? '' : password);

    if (!safeEmail || !safePassword){
      const mapped = { code:'auth/missing-credentials', message:'Escribe correo y contraseña para iniciar sesión.' };
      const state = mergeState({
        code: 'error',
        label: 'Faltan datos',
        message: mapped.message,
        isBusy: false,
        error: mapped,
        isAuthenticated: false,
        user: null
      });
      return { ok:false, error:mapped, state };
    }

    mergeState({
      code: 'signing-in',
      label: 'Entrando…',
      message: 'Validando credenciales con Firebase…',
      isBusy: true,
      error: null,
      isAuthenticated: false,
      user: null
    });

    const baseState = await prepareAuthInfrastructure({ skipStateSync:true });
    if (!baseState || !baseState.authReady){
      return { ok:false, error: baseState && baseState.error ? baseState.error : { code:'auth/not-ready', message:'Auth no está listo para iniciar sesión.' }, state:getStatusSync() };
    }

    try{
      const auth = g.A33Firebase.getAuth && g.A33Firebase.getAuth();
      const modules = g.A33Firebase.getModules && g.A33Firebase.getModules();
      const authMod = modules && modules.auth;
      await authMod.setPersistence(auth, authMod.browserLocalPersistence);
      const credential = await authMod.signInWithEmailAndPassword(auth, safeEmail, safePassword);
      const state = mergeState({
        code: 'authenticated',
        label: 'Sesión activa',
        message: 'Sesión iniciada y persistente en este navegador.',
        isBusy: false,
        authReady: true,
        isAuthenticated: true,
        user: formatUser(credential.user),
        error: null,
        firebase: getFirebaseStatus()
      });
      return { ok:true, user:clone(state.user), state };
    }catch(error){
      const mapped = mapAuthError(error);
      const state = mergeState({
        code: 'error',
        label: 'No se pudo iniciar sesión',
        message: mapped.message,
        isBusy: false,
        authReady: true,
        isAuthenticated: false,
        user: null,
        error: mapped,
        firebase: getFirebaseStatus()
      });
      return { ok:false, error:mapped, state };
    }
  }

  async function signOut(){
    const baseState = await prepareAuthInfrastructure({ skipStateSync:true });
    if (!baseState || !baseState.authReady){
      return { ok:false, error: baseState && baseState.error ? baseState.error : { code:'auth/not-ready', message:'Auth no está listo para cerrar sesión.' }, state:getStatusSync() };
    }

    if (!baseState.isAuthenticated && !(baseState.user && baseState.user.email)){
      const state = mergeState({
        code: 'signed-out',
        label: 'Sin sesión',
        message: 'No hay una sesión activa que cerrar.',
        isBusy: false,
        isAuthenticated: false,
        user: null,
        error: null,
        firebase: getFirebaseStatus()
      });
      return { ok:true, state };
    }

    mergeState({
      code: 'signing-out',
      label: 'Cerrando…',
      message: 'Cerrando la sesión actual…',
      isBusy: true,
      error: null
    });

    try{
      const auth = g.A33Firebase.getAuth && g.A33Firebase.getAuth();
      const modules = g.A33Firebase.getModules && g.A33Firebase.getModules();
      const authMod = modules && modules.auth;
      await authMod.signOut(auth);
      const state = mergeState({
        code: 'signed-out',
        label: 'Sin sesión',
        message: 'La sesión se cerró correctamente en este navegador.',
        isBusy: false,
        authReady: true,
        isAuthenticated: false,
        user: null,
        error: null,
        firebase: getFirebaseStatus()
      });
      return { ok:true, state };
    }catch(error){
      const mapped = mapAuthError(error);
      const state = mergeState({
        code: 'error',
        label: 'No se pudo cerrar sesión',
        message: mapped.message,
        isBusy: false,
        authReady: true,
        error: mapped,
        firebase: getFirebaseStatus()
      });
      return { ok:false, error:mapped, state };
    }
  }

  async function reset(){
    try{
      if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
    }catch(_){ }
    unsubscribeAuth = null;
    ensurePromise = null;
    currentState = null;
    return mergeState({
      code: buildBaseState().code,
      label: buildBaseState().label,
      message: buildBaseState().message,
      isBusy: false,
      isAuthenticated: false,
      user: null,
      error: null,
      authReady: buildBaseState().authReady,
      firebase: buildBaseState().firebase
    });
  }

  function getStatusSync(){
    if (!currentState){
      currentState = buildBaseState();
    }
    return clone(currentState);
  }

  currentState = buildBaseState();

  g.A33Auth = {
    EVENT_NAME,
    getStatusSync,
    refresh,
    signIn,
    signOut,
    reset,
    mapAuthError
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
