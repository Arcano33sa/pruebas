(function(global){
  'use strict';

  const FIREBASE_SDK_VERSION = '11.6.0';
  const FIREBASE_APP_NAME = 'suite-a33';
  const STATUS_EVENT = 'a33:firebase-status';

  const scriptCache = new Map();

  const state = {
    sdkVersion: FIREBASE_SDK_VERSION,
    appName: FIREBASE_APP_NAME,
    status: 'idle',
    linked: false,
    mode: 'local',
    configReady: false,
    projectId: '',
    message: 'Firebase no vinculado aún. La suite sigue operando en modo local.',
    configFile: (global.A33FirebaseConfig && global.A33FirebaseConfig.configFile) || 'pruebas/assets/js/a33-firebase-config.js',
    authReady: false,
    firestoreReady: false,
    functionsReady: false,
    functionsRegion: 'us-central1',
    firestorePersistence: 'pending',
    firestorePersistenceMessage: 'Persistencia Firestore pendiente.',
    app: null,
    auth: null,
    db: null,
    functions: null,
    lastError: ''
  };

  function snapshotState(){
    return {
      sdkVersion: state.sdkVersion,
      appName: state.appName,
      status: state.status,
      linked: state.linked,
      mode: state.mode,
      configReady: state.configReady,
      projectId: state.projectId,
      message: state.message,
      configFile: state.configFile,
      authReady: state.authReady,
      firestoreReady: state.firestoreReady,
      functionsReady: state.functionsReady,
      functionsRegion: state.functionsRegion,
      firestorePersistence: state.firestorePersistence,
      firestorePersistenceMessage: state.firestorePersistenceMessage,
      appReady: !!state.app,
      lastError: state.lastError,
      app: state.app || null,
      auth: state.auth || null,
      db: state.db || null,
      functions: state.functions || null
    };
  }

  function emit(){
    const detail = snapshotState();
    try{
      global.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail }));
    }catch(_){ }
    return detail;
  }

  function setState(patch){
    Object.assign(state, patch || {});
    return emit();
  }

  function loadScriptOnce(src){
    if (scriptCache.has(src)) return scriptCache.get(src);
    const existing = document.querySelector('script[data-a33-firebase-src="' + src.replace(/"/g, '&quot;') + '"]');
    const promise = new Promise((resolve, reject) => {
      if (existing){
        if (existing.dataset.loaded === 'true'){
          resolve(existing);
          return;
        }
        existing.addEventListener('load', () => resolve(existing), { once: true });
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar ' + src)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.a33FirebaseSrc = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve(script);
      };
      script.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.head.appendChild(script);
    });
    scriptCache.set(src, promise);
    return promise;
  }

  async function loadFirebaseCompatSdk(){
    const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';
    await loadScriptOnce(base + 'firebase-app-compat.js');
    await Promise.all([
      loadScriptOnce(base + 'firebase-auth-compat.js'),
      loadScriptOnce(base + 'firebase-firestore-compat.js'),
      loadScriptOnce(base + 'firebase-functions-compat.js')
    ]);
    if (!global.firebase || typeof global.firebase.initializeApp !== 'function'){
      throw new Error('Firebase SDK no disponible tras la carga del CDN.');
    }
    return global.firebase;
  }

  async function enableFirestorePersistence(db){
    if (!db || typeof db.enablePersistence !== 'function'){
      return {
        state: 'unavailable',
        message: 'El navegador no expone persistencia IndexedDB para Firestore.'
      };
    }

    try{
      await db.enablePersistence({ synchronizeTabs: true });
      return {
        state: 'enabled',
        message: 'Firestore quedó listo con caché offline persistente.'
      };
    }catch(error){
      const code = error && error.code ? String(error.code) : '';
      if (code === 'failed-precondition'){
        return {
          state: 'memory-only',
          message: 'Firestore inició sin persistencia compartida; otra pestaña ya tomó el candado local.'
        };
      }
      if (code === 'unimplemented'){
        return {
          state: 'unsupported',
          message: 'Este navegador no soporta persistencia offline durable para Firestore.'
        };
      }
      return {
        state: 'error',
        message: error && error.message ? String(error.message) : 'No se pudo activar la persistencia offline de Firestore.'
      };
    }
  }

  function getConfigApi(){
    return global.A33FirebaseConfig && typeof global.A33FirebaseConfig.getConfig === 'function'
      ? global.A33FirebaseConfig
      : null;
  }

  async function initialize(){
    if (state.status === 'initializing') return snapshotState();
    if (state.status === 'ready') return snapshotState();

    const configApi = getConfigApi();
    if (!configApi){
      return setState({
        status: 'disabled',
        linked: false,
        mode: 'local',
        configReady: false,
        message: 'No se encontró el archivo central de configuración Firebase. La suite sigue en modo local.',
        lastError: 'firebase-config-missing'
      });
    }

    const cfg = configApi.getConfig();
    const hasRealConfig = configApi.hasRealConfig(cfg);

    if (!hasRealConfig){
      return setState({
        status: 'disabled',
        linked: false,
        mode: 'local',
        configReady: false,
        projectId: '',
        authReady: false,
        firestoreReady: false,
        functionsReady: false,
        functionsRegion: 'us-central1',
        firestorePersistence: 'pending',
        firestorePersistenceMessage: 'Persistencia Firestore pendiente.',
        app: null,
        auth: null,
        db: null,
        functions: null,
        message: 'Firebase no vinculado aún. La suite sigue operando en modo local.',
        lastError: ''
      });
    }

    setState({
      status: 'initializing',
      linked: true,
      mode: 'firebase-pending',
      configReady: true,
      projectId: cfg.projectId || '',
      message: 'Configuración detectada. Inicializando núcleo Firebase…',
      lastError: ''
    });

    try{
      const firebaseNs = await loadFirebaseCompatSdk();
      const functionsRegion = (cfg.functionsRegion || 'us-central1').trim() || 'us-central1';
      let app = null;
      try{
        app = firebaseNs.app(FIREBASE_APP_NAME);
      }catch(_){
        app = firebaseNs.initializeApp(cfg, FIREBASE_APP_NAME);
      }

      let auth = null;
      let db = null;
      let functions = null;
      try{ auth = firebaseNs.auth(app); }catch(_){ auth = null; }
      try{ db = firebaseNs.firestore(app); }catch(_){ db = null; }
      const persistence = db ? await enableFirestorePersistence(db) : {
        state: 'unavailable',
        message: 'Firestore no estuvo disponible para habilitar caché offline.'
      };
      try{
        if (app && typeof app.functions === 'function') functions = app.functions(functionsRegion);
      }catch(_){ functions = null; }
      if (!functions){
        try{
          if (typeof firebaseNs.functions === 'function') functions = firebaseNs.functions(app, functionsRegion);
        }catch(_){ functions = null; }
      }

      state.app = app || null;
      state.auth = auth || null;
      state.db = db || null;
      state.functions = functions || null;

      return setState({
        status: 'ready',
        linked: true,
        mode: 'firebase-ready',
        configReady: true,
        projectId: cfg.projectId || '',
        authReady: !!auth,
        firestoreReady: !!db,
        functionsReady: !!functions,
        functionsRegion,
        firestorePersistence: persistence.state,
        firestorePersistenceMessage: persistence.message,
        message: 'Firebase enlazado. Authentication, Firestore y el carril de backend ya pueden coordinar el acceso serio de la suite.',
        lastError: ''
      });
    }catch(error){
      const message = error && error.message ? String(error.message) : 'No se pudo inicializar Firebase.';
      state.app = null;
      state.auth = null;
      state.db = null;
      state.functions = null;
      console.warn('[Suite A33] Firebase no pudo inicializarse; se conserva el modo local.', error);
      return setState({
        status: 'error',
        linked: true,
        mode: 'local-fallback',
        configReady: true,
        authReady: false,
        firestoreReady: false,
        functionsReady: false,
        functionsRegion: (cfg.functionsRegion || 'us-central1').trim() || 'us-central1',
        firestorePersistence: 'error',
        firestorePersistenceMessage: 'Persistencia Firestore no disponible porque la inicialización falló.',
        message: 'Se detectó configuración Firebase, pero la inicialización falló. La suite cayó con elegancia a modo local.',
        lastError: message
      });
    }
  }

  const api = {
    initialize,
    getState: snapshotState,
    refresh: initialize,
    statusEvent: STATUS_EVENT,
    _unsafeGetApp(){ return state.app || null; },
    _unsafeGetAuth(){ return state.auth || null; },
    _unsafeGetDb(){ return state.db || null; },
    _unsafeGetFunctions(){ return state.functions || null; }
  };

  global.A33Firebase = api;

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => {
      initialize().catch(() => {});
    }, { once: true });
  } else {
    initialize().catch(() => {});
  }
})(window);
