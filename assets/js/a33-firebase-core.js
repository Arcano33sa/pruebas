(function(g){
  'use strict';

  const SDK_VERSION = '12.11.0';
  const APP_NAME = 'suite-a33-core';
  const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1']);

  let cachedStatus = null;
  let bootPromise = null;
  let appRef = null;
  let authRef = null;
  let dbRef = null;
  let appModRef = null;
  let authModRef = null;
  let firestoreModRef = null;

  function nowIso(){
    return new Date().toISOString();
  }

  function clone(obj){
    try{ return JSON.parse(JSON.stringify(obj || {})); }
    catch(_){ return {}; }
  }

  function getLocationInfo(){
    try{
      const loc = g.location || {};
      return {
        protocol: String(loc.protocol || ''),
        host: String(loc.hostname || ''),
        origin: String(loc.origin || ''),
        href: String(loc.href || '')
      };
    }catch(_){
      return { protocol:'', host:'', origin:'', href:'' };
    }
  }

  function isLocalHost(host, protocol){
    const safeHost = String(host || '').trim().toLowerCase();
    const safeProtocol = String(protocol || '').trim().toLowerCase();
    return safeProtocol === 'file:' || LOCAL_HOSTS.has(safeHost);
  }

  function shouldWarnAboutHost(currentHost, authDomain, protocol){
    const host = String(currentHost || '').trim().toLowerCase();
    const auth = String(authDomain || '').trim().toLowerCase();
    if (!host) return false;
    if (isLocalHost(host, protocol)) return false;
    if (!auth) return true;
    if (host === auth) return false;
    if (/\.(web\.app|firebaseapp\.com)$/.test(host)) return false;
    return true;
  }

  function classifySourceLabel(source){
    if (source === 'embedded') return 'Embebida en el proyecto';
    if (source === 'runtime-local') return 'Runtime local';
    return 'Placeholder seguro';
  }

  function buildBaseStatus(){
    const cfgApi = g.A33FirebaseConfig;
    const info = cfgApi && typeof cfgApi.describeConfig === 'function'
      ? cfgApi.describeConfig()
      : { source:'placeholder', config:{}, missingKeys:['apiKey','authDomain','projectId','appId'], hasRealConfig:false };

    const locationInfo = getLocationInfo();
    const config = info.config || {};
    const warnings = [];
    if (isLocalHost(locationInfo.host, locationInfo.protocol)){
      warnings.push('Prueba local detectada: Firebase real se validará mejor cuando la suite corra bajo un dominio o localhost servido.');
    }
    if (shouldWarnAboutHost(locationInfo.host, config.authDomain, locationInfo.protocol)){
      warnings.push('Antes del login real, agrega el dominio actual a Authorized domains en Firebase Authentication.');
    }

    const code = info.hasRealConfig ? 'ready-to-init' : (info.source === 'placeholder' ? 'placeholder' : 'missing-config');
    const message = info.hasRealConfig
      ? 'La configuración real ya está completa. La base puede inicializar App, Auth y Firestore sin activar todavía el login real.'
      : 'Falta la configuración real de Firebase. Nada se rompe: la Suite sigue operando en local y queda lista para la siguiente etapa.';

    return {
      code,
      label: code === 'ready-to-init' ? 'Lista para inicializar' : 'Pendiente de configuración',
      message,
      configSource: info.source,
      configSourceLabel: classifySourceLabel(info.source),
      config,
      missingKeys: Array.isArray(info.missingKeys) ? info.missingKeys.slice() : [],
      hasRealConfig: !!info.hasRealConfig,
      services: {
        appPrepared: !!appRef,
        authPrepared: !!authRef,
        firestorePrepared: !!dbRef
      },
      sdk: {
        version: SDK_VERSION,
        loaded: false
      },
      runtime: {
        currentHost: locationInfo.host || '(sin host)',
        currentOrigin: locationInfo.origin || '(sin origin)',
        protocol: locationInfo.protocol || ''
      },
      warnings,
      error: null,
      checkedAt: nowIso(),
      projectId: String(config.projectId || ''),
      authDomain: String(config.authDomain || '')
    };
  }

  function setStatus(next){
    cachedStatus = {
      ...buildBaseStatus(),
      ...(next || {}),
      checkedAt: nowIso()
    };
    return clone(cachedStatus);
  }

  async function loadSdkModules(){
    const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
    const [appMod, authMod, firestoreMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`)
    ]);
    appModRef = appMod;
    authModRef = authMod;
    firestoreModRef = firestoreMod;
    return { appMod, authMod, firestoreMod };
  }

  function classifyError(error){
    const code = String((error && error.code) || '').trim();
    const message = String((error && error.message) || error || '').trim();
    const joined = `${code} ${message}`.toLowerCase();

    if (joined.includes('unauthorized-domain')){
      return {
        code: code || 'auth/unauthorized-domain',
        message: 'Firebase respondió con dominio no autorizado. Agrega el dominio actual a Authorized domains antes del login real.'
      };
    }
    if (joined.includes('failed to fetch dynamically imported module') || joined.includes('importing a module script failed') || joined.includes('load failed')){
      return {
        code: code || 'sdk/load-failed',
        message: 'No se pudo cargar el SDK web de Firebase. Revisa conexión, políticas de red o modo offline.'
      };
    }
    return {
      code: code || 'firebase/init-error',
      message: message || 'No se pudo inicializar la base de Firebase.'
    };
  }

  async function boot(){
    const base = buildBaseStatus();
    if (!base.hasRealConfig){
      return setStatus(base);
    }
    if (bootPromise) return bootPromise;

    bootPromise = (async () => {
      setStatus({
        ...base,
        code: 'loading',
        label: 'Inicializando base Firebase',
        message: 'Preparando Firebase App, Auth y Firestore sin activar todavía el login real.'
      });

      try{
        const { appMod, authMod, firestoreMod } = await loadSdkModules();
        const existing = Array.isArray(appMod.getApps())
          ? appMod.getApps().find((item) => item && item.name === APP_NAME)
          : null;
        appRef = existing || appMod.initializeApp(base.config, APP_NAME);
        authRef = authMod.getAuth(appRef);
        dbRef = firestoreMod.getFirestore(appRef);

        return setStatus({
          ...base,
          code: 'ready',
          label: 'Base Firebase operativa',
          message: 'Firebase App quedó inicializada y Auth + Firestore ya están preparados para la etapa siguiente.',
          services: {
            appPrepared: true,
            authPrepared: true,
            firestorePrepared: true
          },
          sdk: {
            version: SDK_VERSION,
            loaded: true
          },
          projectId: String(base.config.projectId || ''),
          authDomain: String(base.config.authDomain || ''),
          error: null
        });
      }catch(error){
        const clean = classifyError(error);
        bootPromise = null;
        return setStatus({
          ...base,
          code: 'error',
          label: 'Diagnóstico con error',
          message: clean.message,
          sdk: {
            version: SDK_VERSION,
            loaded: false
          },
          error: clean,
          services: {
            appPrepared: !!appRef,
            authPrepared: !!authRef,
            firestorePrepared: !!dbRef
          }
        });
      }
    })();

    return bootPromise;
  }

  async function refreshStatus(options = {}){
    const attemptBoot = !!(options && options.attemptBoot);
    if (attemptBoot) return boot();
    return setStatus(buildBaseStatus());
  }

  async function reset(){
    bootPromise = null;
    try{
      if (appRef && appModRef && typeof appModRef.deleteApp === 'function'){
        await appModRef.deleteApp(appRef);
      }
    }catch(_){ }
    appRef = null;
    authRef = null;
    dbRef = null;
    cachedStatus = buildBaseStatus();
    return clone(cachedStatus);
  }

  function getStatusSync(){
    if (!cachedStatus){
      cachedStatus = buildBaseStatus();
    }
    return clone(cachedStatus);
  }

  g.A33Firebase = {
    sdkVersion: SDK_VERSION,
    getStatusSync,
    refreshStatus,
    boot,
    reset,
    getApp(){ return appRef || null; },
    getAuth(){ return authRef || null; },
    getFirestore(){ return dbRef || null; },
    getModules(){
      return {
        app: appModRef || null,
        auth: authModRef || null,
        firestore: firestoreModRef || null
      };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
