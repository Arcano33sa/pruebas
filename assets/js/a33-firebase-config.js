(function(global){
  'use strict';

  const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const OPTIONAL_KEYS = ['storageBucket', 'messagingSenderId', 'measurementId', 'functionsRegion'];
  const PLACEHOLDER_VALUES = new Set([
    '',
    'PENDIENTE',
    'PENDIENTE_API_KEY',
    'PENDIENTE_AUTH_DOMAIN',
    'PENDIENTE_PROJECT_ID',
    'PENDIENTE_APP_ID'
  ]);

  const embeddedConfig = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
    storageBucket: '',
    messagingSenderId: '',
    measurementId: '',
    functionsRegion: 'us-central1'
  };

  function detectConfigFilePath(){
    try{
      const current = document.currentScript;
      if (current && current.src){
        return new URL(current.src, global.location && global.location.href ? global.location.href : undefined).pathname;
      }
    }catch(_){ }

    try{
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--){
        const src = scripts[i] && scripts[i].src ? String(scripts[i].src) : '';
        if (!src) continue;
        if (src.indexOf('a33-firebase-config.js') !== -1){
          return new URL(src, global.location && global.location.href ? global.location.href : undefined).pathname;
        }
      }
    }catch(_){ }

    return '/assets/js/a33-firebase-config.js';
  }

  function cleanString(value){
    return String(value == null ? '' : value).trim();
  }

  function sanitizeConfig(input){
    const source = (input && typeof input === 'object') ? input : {};
    const out = {};
    REQUIRED_KEYS.concat(OPTIONAL_KEYS).forEach((key) => {
      const value = cleanString(source[key]);
      if (value) out[key] = value;
    });
    return out;
  }

  function isRealValue(value){
    const clean = cleanString(value);
    return !!clean && !PLACEHOLDER_VALUES.has(clean.toUpperCase());
  }

  function hasRealConfig(input){
    const cfg = sanitizeConfig(input);
    return REQUIRED_KEYS.every((key) => isRealValue(cfg[key]));
  }

  function getRuntimeOverride(){
    try{
      if (global.__A33_FIREBASE_RUNTIME_CONFIG__ && typeof global.__A33_FIREBASE_RUNTIME_CONFIG__ === 'object'){
        return global.__A33_FIREBASE_RUNTIME_CONFIG__;
      }
    }catch(_){ }
    return null;
  }

  const api = {
    configFile: detectConfigFilePath(),
    requiredKeys: REQUIRED_KEYS.slice(),
    optionalKeys: OPTIONAL_KEYS.slice(),
    placeholders: Array.from(PLACEHOLDER_VALUES),
    sanitizeConfig,
    hasRealConfig,
    getConfig(){
      const runtime = getRuntimeOverride();
      return sanitizeConfig(runtime || embeddedConfig);
    },
    getEmbeddedConfig(){
      return sanitizeConfig(embeddedConfig);
    },
    getStatus(){
      const runtime = getRuntimeOverride();
      const source = runtime || embeddedConfig;
      return {
        hasRealConfig: hasRealConfig(source),
        usingRuntimeOverride: !!runtime,
        requiredKeys: REQUIRED_KEYS.slice(),
        optionalKeys: OPTIONAL_KEYS.slice(),
        configFile: api.configFile
      };
    }
  };

  global.A33FirebaseConfig = api;
})(window);
