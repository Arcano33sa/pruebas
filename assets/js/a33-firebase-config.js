(function(g){
  'use strict';

  const STORAGE_KEY = 'a33_firebase_runtime_config_v1';
  const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const OPTIONAL_KEYS = ['storageBucket', 'messagingSenderId', 'measurementId'];
  const PLACEHOLDER = Object.freeze({
    apiKey: 'PENDIENTE_API_KEY',
    authDomain: 'PENDIENTE_AUTH_DOMAIN',
    projectId: 'PENDIENTE_PROJECT_ID',
    storageBucket: 'PENDIENTE_STORAGE_BUCKET',
    messagingSenderId: 'PENDIENTE_MESSAGING_SENDER_ID',
    appId: 'PENDIENTE_APP_ID',
    measurementId: ''
  });

  function clone(obj){
    try{ return JSON.parse(JSON.stringify(obj || {})); }
    catch(_){ return {}; }
  }

  function toTrimmedString(value){
    return String(value == null ? '' : value).trim();
  }

  function isPlaceholderValue(value){
    const text = toTrimmedString(value);
    if (!text) return true;
    return /^(pendiente|reemplazar|your_|xxx_|todo_|change_me|sample_|example_)/i.test(text);
  }

  function normalizeConfig(raw){
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const out = {};
    [...REQUIRED_KEYS, ...OPTIONAL_KEYS].forEach((key) => {
      out[key] = toTrimmedString(src[key]);
    });
    return out;
  }

  function getStoredRuntimeConfig(){
    try{
      if (g.A33Storage && typeof g.A33Storage.getJSON === 'function'){
        const parsed = g.A33Storage.getJSON(STORAGE_KEY, null);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      }
    }catch(_){ }
    return null;
  }

  function getEmbeddedConfig(){
    const direct = (g.A33_FIREBASE_CONFIG && typeof g.A33_FIREBASE_CONFIG === 'object') ? g.A33_FIREBASE_CONFIG : null;
    if (direct) return direct;
    const alt = (g.__A33_FIREBASE_CONFIG__ && typeof g.__A33_FIREBASE_CONFIG__ === 'object') ? g.__A33_FIREBASE_CONFIG__ : null;
    return alt || null;
  }

  function getConfigBundle(){
    const runtime = getStoredRuntimeConfig();
    if (runtime){
      return { source: 'runtime-local', config: normalizeConfig(runtime) };
    }
    const embedded = getEmbeddedConfig();
    if (embedded){
      return { source: 'embedded', config: normalizeConfig(embedded) };
    }
    return { source: 'placeholder', config: normalizeConfig(PLACEHOLDER) };
  }

  function describeConfig(){
    const bundle = getConfigBundle();
    const missingKeys = REQUIRED_KEYS.filter((key) => isPlaceholderValue(bundle.config[key]));
    return {
      source: bundle.source,
      config: clone(bundle.config),
      requiredKeys: REQUIRED_KEYS.slice(),
      optionalKeys: OPTIONAL_KEYS.slice(),
      missingKeys,
      hasRealConfig: missingKeys.length === 0
    };
  }

  function setRuntimeConfig(nextConfig){
    const normalized = normalizeConfig(nextConfig);
    try{
      if (g.A33Storage && typeof g.A33Storage.setJSON === 'function'){
        g.A33Storage.setJSON(STORAGE_KEY, normalized);
        return true;
      }
    }catch(_){ }
    return false;
  }

  function clearRuntimeConfig(){
    try{
      if (g.A33Storage && typeof g.A33Storage.removeItem === 'function'){
        g.A33Storage.removeItem(STORAGE_KEY);
        return true;
      }
    }catch(_){ }
    return false;
  }

  g.A33FirebaseConfig = {
    STORAGE_KEY,
    REQUIRED_KEYS: REQUIRED_KEYS.slice(),
    OPTIONAL_KEYS: OPTIONAL_KEYS.slice(),
    PLACEHOLDER: clone(PLACEHOLDER),
    normalizeConfig,
    isPlaceholderValue,
    getConfigBundle,
    describeConfig,
    setRuntimeConfig,
    clearRuntimeConfig
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
