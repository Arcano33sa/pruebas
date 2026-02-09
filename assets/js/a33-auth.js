/*
  Suite A33 — A33Auth (core)
  Autenticación simple (1 usuario) con sesión persistente.

  - 1 usuario (registro único): username + password hash (PBKDF2-SHA256)
  - Sesión: token + timestamps
    - lastActivityAt (ms)
    - expiresAt (ms) = lastActivityAt + TTL_INACTIVITY

  Nota iOS/PWA:
  - sessionStorage puede limpiarse antes de tiempo. Por defecto guardamos en localStorage.
  - Migración suave desde sesión legacy en sessionStorage.
*/

(function(){
  'use strict';

  if (!window.A33Storage){
    console.error('A33Auth requiere A33Storage.');
    return;
  }

  const LS = window.A33Storage;

  const AUTH_KEY = 'suite_a33_auth_v1';
  const PROFILE_KEY = 'suite_a33_profile_v1';
  const SESSION_KEY = 'suite_a33_session_v1';

  const LEGACY_PIN_KEY = 'suite_a33_pin';

  const TTL_INACTIVITY_MS = 72 * 60 * 60 * 1000; // 72h
  const TOUCH_MIN_INTERVAL_MS = 45 * 1000; // rate-limit escrituras de actividad

  const PBKDF2_ITERS = 150000;
  const SALT_BYTES = 16;

  // --- Utils ---
  const enc = new TextEncoder();

  function b64FromBytes(buf){
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function bytesFromB64(b64){
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function now(){ return Date.now(); }
  function randomB64(nBytes){
    const b = new Uint8Array(nBytes);
    crypto.getRandomValues(b);
    return b64FromBytes(b);
  }
  function normalizeUser(u){
    return String(u || '').trim();
  }

  async function pbkdf2Hash(password, saltBytes, iterations){
    const passKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(String(password || '')),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations: iterations
      },
      passKey,
      256
    );
    return new Uint8Array(bits);
  }

  function readAuthRecord(){
    return LS.getJSON(AUTH_KEY, null, 'local');
  }
  function writeAuthRecord(rec){
    return LS.setJSON(AUTH_KEY, rec, 'local');
  }
  function readProfile(){
    return LS.getJSON(PROFILE_KEY, { displayName: '' }, 'local') || { displayName: '' };
  }
  function writeProfile(p){
    return LS.setJSON(PROFILE_KEY, p || { displayName: '' }, 'local');
  }

  function readSessionLocal(){
    return LS.getJSON(SESSION_KEY, null, 'local');
  }
  function readSessionSession(){
    return LS.getJSON(SESSION_KEY, null, 'session');
  }
  function writeSessionLocal(sess){
    return LS.setJSON(SESSION_KEY, sess, 'local');
  }
  function writeSessionSession(sess){
    return LS.setJSON(SESSION_KEY, sess, 'session');
  }
  function clearSessionBoth(){
    try{ LS.removeItem(SESSION_KEY, 'local'); }catch(_){ }
    try{ LS.removeItem(SESSION_KEY, 'session'); }catch(_){ }
  }

  function isSessionShapeOk(s){
    // Acepta sesiones legacy: token + (expiresAt o lastActivityAt).
    if (!(s && typeof s === 'object')) return false;
    if (!s.token) return false;
    const hasExp = (s.expiresAt != null);
    const hasLA = (s.lastActivityAt != null);
    return hasExp || hasLA;
  }

  function isSessionValid(s){
    if (!isSessionShapeOk(s)) return false;
    const exp = Number(s.expiresAt);
    if (!Number.isFinite(exp) || exp <= 0) return false;
    return now() < exp;
  }

  function ensureSessionTimestamps(s, { refreshWindow=false } = {}){
    // Regla: NO renovar ventana solo por abrir la app.
    // Solo renovamos (sliding TTL) cuando refreshWindow=true (actividad real del usuario).
    if (!s || typeof s !== 'object') return null;
    const out = { ...s };
    const n = now();

    // issuedAt es informativo; no extiende la sesión.
    const issued = Number(out.issuedAt);
    if (!Number.isFinite(issued) || issued <= 0){ out.issuedAt = n; }

    if (refreshWindow){
      out.lastActivityAt = n;
      out.expiresAt = n + TTL_INACTIVITY_MS;
      return out;
    }

    const la = Number(out.lastActivityAt);
    const exp = Number(out.expiresAt);
    const laOk = Number.isFinite(la) && la > 0;
    const expOk = Number.isFinite(exp) && exp > 0;

    // Sesión legacy incompleta: preferimos forzar login antes que “revivir”.
    if (!laOk && !expOk){
      return null;
    }

    if (!laOk && expOk){
      out.lastActivityAt = exp - TTL_INACTIVITY_MS;
      return out;
    }

    if (laOk && !expOk){
      out.expiresAt = la + TTL_INACTIVITY_MS;
      return out;
    }

    // Ambos presentes: si exp quedó por detrás de lastActivityAt, corregir.
    if (exp < la){
      out.expiresAt = la + TTL_INACTIVITY_MS;
      return out;
    }

    return out;
  }

  function migrateSessionFromSessionToLocalIfNeeded(){
    // 1) Si ya hay sesión en local, asegurar timestamps mínimos.
    const curLocal = readSessionLocal();
    if (curLocal){
      const fixed = ensureSessionTimestamps(curLocal);
      if (fixed && JSON.stringify(fixed) != JSON.stringify(curLocal)){
        writeSessionLocal(fixed);
      }
      // Limpieza si está expirada.
      if (!isSessionValid(fixed || curLocal)){
        try{ LS.removeItem(SESSION_KEY, 'local'); }catch(_){ }
      }
      return;
    }

    // 2) Si no hay en local, pero existe en session (legacy), migrar si aún es válida.
    const s = readSessionSession();
    if (!s){
      return;
    }

    if (!isSessionValid(s)){
      try{ LS.removeItem(SESSION_KEY, 'session'); }catch(_){ }
      return;
    }

    const n = now();
    const migrated = {
      token: String(s.token),
      issuedAt: Number(s.issuedAt) || n,
      lastActivityAt: n,
      expiresAt: n + TTL_INACTIVITY_MS
    };

    writeSessionLocal(migrated);
    try{ LS.removeItem(SESSION_KEY, 'session'); }catch(_){ }
  }

  // Migra PIN legacy (si existe) → username/password inicial.
  // - Si PIN estaba en JSON legacy {pin,name}, tomamos ambos.
  async function migrateLegacyPinIfNeeded(){
    if (readAuthRecord()) return;
    const raw = LS.getItem(LEGACY_PIN_KEY, 'local');
    if (!raw) return;

    let pin = null;
    let name = '';
    const s = String(raw).trim();
    const onlyDigits6 = /^[0-9]{6}$/.test(s);
    if (onlyDigits6){
      pin = s;
    } else {
      try{
        const obj = JSON.parse(s);
        if (obj && typeof obj === 'object'){
          const p = String(obj.pin || '').trim();
          if (/^[0-9]{6}$/.test(p)) pin = p;
          if (obj.name) name = String(obj.name).trim();
        }
      }catch(_){ }
    }

    if (!pin) return;

    // Creamos auth con ese PIN como contraseña inicial.
    const username = 'admin';
    await A33Auth.setup({ username, password: pin, displayName: name || '' });
    // Limpiamos la key legacy (ya no se usa)
    try{ LS.removeItem(LEGACY_PIN_KEY, 'local'); }catch(_){ }
  }

  // Estado interno (por pestaña)
  let _lastTouchWriteAt = 0;


  function isConfiguredInternal(){
    const rec = readAuthRecord();
    return !!(rec && rec.username && rec.saltB64 && rec.hashB64);
  }

  function forceLoginIfNeededOnResume(){
    // No renueva TTL. Solo limpia expiración y fuerza login al volver a la app.
    try{ migrateSessionFromSessionToLocalIfNeeded(); }catch(_){ }

    // Si aún no hay credenciales, no forzar nada.
    if (!isConfiguredInternal()) return;

    const s0 = readSessionLocal();
    if (!isSessionShapeOk(s0)){
      // Si estamos en un módulo y no hay sesión, gatear.
      try{ if (document && document.getElementById && document.getElementById('lock-overlay')) return; }catch(_){ }

      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      const pn = String((typeof location !== 'undefined' && location.pathname) ? location.pathname : '');
      if (offline && (pn.indexOf('/pos/') >= 0 || pn.indexOf('pos/') >= 0)){
        try{ location.replace('./offline.html?reason=auth'); }catch(_){ }
        return;
      }

      try{ location.replace('../index.html'); }catch(_){ }
      return;
    }

    const fixed = ensureSessionTimestamps(s0);
    const s = fixed || s0;

    if (!fixed){
      clearSessionBoth();
    }

    if (!isSessionValid(s)){
      clearSessionBoth();
      // Home (menú) ya maneja lock overlay.
      try{ if (document && document.getElementById && document.getElementById('lock-overlay')) return; }catch(_){ }

      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      const pn = String((typeof location !== 'undefined' && location.pathname) ? location.pathname : '');
      if (offline && (pn.indexOf('/pos/') >= 0 || pn.indexOf('pos/') >= 0)){
        try{ location.replace('./offline.html?reason=auth'); }catch(_){ }
        return;
      }
      try{ location.replace('../index.html'); }catch(_){ }
      return;
    }

    // Guardar fix solo si fue necesario (sin renovar ventana)
    if (fixed && JSON.stringify(fixed) != JSON.stringify(s0)){
      writeSessionLocal(fixed);
    }
  }


  function touchActivityIfAuthenticatedInternal(){
    try{ migrateSessionFromSessionToLocalIfNeeded(); }catch(_){ }

    const s0 = readSessionLocal();
    if (!isSessionShapeOk(s0)) return false;

    const fixed = ensureSessionTimestamps(s0);
    if (!fixed){
      clearSessionBoth();
      return false;
    }

    const s = fixed;
    if (!isSessionValid(s)){
      clearSessionBoth();
      return false;
    }

    const n = now();

    // Rate-limit robusto (persistente): no escribir si la última actividad guardada es reciente.
    const prevLA = Number(s.lastActivityAt) || 0;
    if (prevLA > 0 && (n - prevLA) < TOUCH_MIN_INTERVAL_MS) return true;
    if ((n - _lastTouchWriteAt) < TOUCH_MIN_INTERVAL_MS) return true;
    _lastTouchWriteAt = n;

    const next = ensureSessionTimestamps({ ...s }, { refreshWindow:true });

    // Guardar en local (fuente de verdad). Mantener espejo en session por compat.
    const okLocal = writeSessionLocal(next);
    if (!okLocal){
      // Fallback extremo
      writeSessionSession(next);
    } else {
      // No importa si falla.
      try{ writeSessionSession(next); }catch(_){ }
    }

    return true;
  }

  function bindActivityListenersOnce(){
    if (typeof document === 'undefined') return;
    if (window.__A33_AUTH_ACTIVITY_BOUND) return;
    window.__A33_AUTH_ACTIVITY_BOUND = true;

    const handler = () => {
      try{ touchActivityIfAuthenticatedInternal(); }catch(_){ }
    };

    try{ document.addEventListener('pointerdown', handler, { passive:true, capture:true }); }catch(_){ }
    try{ document.addEventListener('click', handler, { passive:true, capture:true }); }catch(_){ }
    try{ document.addEventListener('keydown', handler, { passive:true, capture:true }); }catch(_){ }

    // “Volví a la app”: cuenta como actividad del usuario.
    try{
      document.addEventListener('visibilitychange', () => {
        try{
          if (document.visibilityState === 'visible') forceLoginIfNeededOnResume();
        }catch(_){ }
      }, { capture:true });
    }catch(_){ }

    try{ window.addEventListener('pageshow', () => { try{ forceLoginIfNeededOnResume(); }catch(_){ } }, { capture:true }); }catch(_){ }
    try{ window.addEventListener('focus', () => { try{ forceLoginIfNeededOnResume(); }catch(_){ } }, { capture:true }); }catch(_){ }
  }

  const A33Auth = {
    AUTH_KEY,
    SESSION_KEY,

    isConfigured(){
      const rec = readAuthRecord();
      return !!(rec && rec.username && rec.saltB64 && rec.hashB64);
    },

    getUsername(){
      const rec = readAuthRecord();
      return rec && rec.username ? String(rec.username) : '';
    },

    getDisplayName(){
      const p = readProfile();
      return String(p.displayName || '').trim();
    },

    setDisplayName(name){
      const p = readProfile();
      p.displayName = String(name || '').trim();
      writeProfile(p);
      return p.displayName;
    },

    async setup({ username, password, displayName } = {}){
      const u = normalizeUser(username);
      const p = String(password || '');
      if (!u) throw new Error('Usuario requerido.');
      if (p.length < 4) throw new Error('Contraseña muy corta (mínimo 4).');

      const salt = new Uint8Array(SALT_BYTES);
      crypto.getRandomValues(salt);
      const hash = await pbkdf2Hash(p, salt, PBKDF2_ITERS);

      const rec = {
        v: 1,
        username: u,
        algo: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERS,
        saltB64: b64FromBytes(salt),
        hashB64: b64FromBytes(hash),
        createdAt: new Date().toISOString()
      };
      writeAuthRecord(rec);
      if (displayName != null) this.setDisplayName(displayName);
      return true;
    },

    async verify({ username, password } = {}){
      const rec = readAuthRecord();
      if (!rec) return { ok:false, reason:'No configurado' };
      const u = normalizeUser(username);
      if (u !== String(rec.username || '')) return { ok:false, reason:'Usuario incorrecto' };
      const salt = bytesFromB64(rec.saltB64);
      const hash = await pbkdf2Hash(String(password || ''), salt, Number(rec.iterations || PBKDF2_ITERS));
      const hashB64 = b64FromBytes(hash);
      return { ok: hashB64 === String(rec.hashB64 || '') };
    },

    async login({ username, password, ttlMs } = {}){
      const res = await this.verify({ username, password });
      if (!res.ok) throw new Error('Credenciales incorrectas.');

      const ttl = Number(ttlMs || TTL_INACTIVITY_MS);
      const n = now();
      const sess = {
        token: randomB64(24),
        issuedAt: n,
        lastActivityAt: n,
        expiresAt: n + ttl
      };

      // Persistente por defecto
      const okLocal = writeSessionLocal(sess);
      if (!okLocal){
        // Fallback: no romper login si local está bloqueado.
        writeSessionSession(sess);
      } else {
        // Compat: espejo (no crítico)
        try{ writeSessionSession(sess); }catch(_){ }
      }

      _lastTouchWriteAt = n;
      return sess;
    },

    logout(){
      clearSessionBoth();
    },

    isAuthenticated(){
      try{ migrateSessionFromSessionToLocalIfNeeded(); }catch(_){ }
      const s0 = readSessionLocal();
      if (!isSessionShapeOk(s0)) return false;

      const fixed = ensureSessionTimestamps(s0);
      const s = fixed || s0;

      if (!isSessionValid(s)){
        clearSessionBoth();
        return false;
      }

      // Guardar fix solo si fue necesario (ej: lastActivityAt faltante)
      if (fixed && JSON.stringify(fixed) != JSON.stringify(s0)){
        writeSessionLocal(fixed);
      }

      return true;
    },

    // Expuesto: renovar sesión por actividad (sliding). Ya viene rate-limited.
    touchActivityIfAuthenticated(){
      return touchActivityIfAuthenticatedInternal();
    },

    async changePassword({ username, currentPassword, newPassword } = {}){
      const check = await this.verify({ username, password: currentPassword });
      if (!check.ok) throw new Error('Contraseña actual incorrecta.');
      const rec = readAuthRecord();
      const salt = new Uint8Array(SALT_BYTES);
      crypto.getRandomValues(salt);
      const hash = await pbkdf2Hash(String(newPassword || ''), salt, PBKDF2_ITERS);
      rec.iterations = PBKDF2_ITERS;
      rec.saltB64 = b64FromBytes(salt);
      rec.hashB64 = b64FromBytes(hash);
      rec.updatedAt = new Date().toISOString();
      writeAuthRecord(rec);
      // Forzar re-login
      this.logout();
      return true;
    },

    async changeUsername({ currentUsername, password, newUsername } = {}){
      const rec = readAuthRecord();
      if (!rec) throw new Error('No configurado.');
      const check = await this.verify({ username: currentUsername, password });
      if (!check.ok) throw new Error('Credenciales incorrectas.');
      const nu = normalizeUser(newUsername);
      if (!nu) throw new Error('Nuevo usuario inválido.');
      rec.username = nu;
      rec.updatedAt = new Date().toISOString();
      writeAuthRecord(rec);
      this.logout();
      return true;
    },

    // Guard para páginas de módulos
    async requireAuth({ redirectTo='../index.html' } = {}){
      await migrateLegacyPinIfNeeded();
      if (this.isConfigured() && this.isAuthenticated()) return true;

      // Offline + sin sesión: evitar bucles de redirección.
      try{
        if (typeof navigator !== 'undefined' && navigator.onLine === false){
          if (!window.__A33_OFFLINE_AUTH_SHOWN){
            window.__A33_OFFLINE_AUTH_SHOWN = true;

            const mk = (tag, attrs) => {
              const el = document.createElement(tag);
              if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
              return el;
            };

            const wrap = mk('div', { 'data-a33-offline-auth': '1', 'role': 'alert' });
            wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.65)';

            const card = mk('div');
            card.style.cssText = 'width:min(640px,100%);background:#0b0b0b;color:#f2f2f2;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif';
            card.innerHTML =
              '<div style="font-size:18px;margin:0 0 8px;font-weight:700">Sin conexión</div>' +
              '<div style="font-size:14px;line-height:1.4;color:#cfcfcf;margin:0 0 12px">No hay sesión activa y estás offline. Conectate y volvé a intentar para iniciar sesión.</div>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
                '<button id="a33OfflineRetry" style="appearance:none;border:1px solid rgba(202,168,92,.55);background:rgba(202,168,92,.14);color:#f2f2f2;padding:10px 12px;border-radius:999px;font-size:14px;cursor:pointer">Reintentar</button>' +
                '<button id="a33OfflineClose" style="appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#f2f2f2;padding:10px 12px;border-radius:999px;font-size:14px;cursor:pointer">Cerrar</button>' +
              '</div>';

            wrap.appendChild(card);
            const mount = document.body || document.documentElement;
            mount.appendChild(wrap);

            try{
              const btnR = wrap.querySelector('#a33OfflineRetry');
              const btnC = wrap.querySelector('#a33OfflineClose');
              if (btnR) btnR.addEventListener('click', () => { try{ location.reload(); }catch(_){ } });
              if (btnC) btnC.addEventListener('click', () => { try{ wrap.remove(); }catch(_){ } });
            }catch(_){ }
          }
          return false;
        }
      }catch(_){ }

      // Si no está configurado, lo llevamos al Home para setup.
      try{
        const target = redirectTo || '../index.html';
        if (location.pathname.endsWith('/index.html') && location.pathname.split('/').length <= 2){
          // Home: no redirigir
          return false;
        }
        location.href = target;
      }catch(_){ }
      return false;
    },

    // Expuesto para index.html: corre migración si aplica.
    async ensureMigrated(){
      await migrateLegacyPinIfNeeded();
      try{ migrateSessionFromSessionToLocalIfNeeded(); }catch(_){ }
      try{ bindActivityListenersOnce(); }catch(_){ }
    },

    // Hard reset solo de credenciales (no toca datos de módulos)
    resetCredentials(){
      LS.removeItem(AUTH_KEY, 'local');
      LS.removeItem(PROFILE_KEY, 'local');
      this.logout();
    }
  };

  // Bind listeners ASAP (no rompe si no hay sesión)
  try{ bindActivityListenersOnce(); }catch(_){ }
  // Migración de sesión legacy al cargar
  try{ migrateSessionFromSessionToLocalIfNeeded(); }catch(_){ }

  window.A33Auth = A33Auth;
})();
