(function(global){
  'use strict';

  const AUTH_EVENT = 'a33:auth-state';
  const OVERLAY_ID = 'a33-auth-overlay';
  const BAR_ID = 'a33-auth-bar';
  const STYLE_ID = 'a33-auth-style';

  const runtime = {
    firebaseStatus: null,
    firebaseUnsub: null,
    authResolved: false,
    authEnabled: false,
    loading: true,
    user: null,
    accessState: null,
    mode: 'loading',
    error: '',
    elements: null
  };

  function safeText(value){
    return String(value == null ? '' : value);
  }

  function authStateSnapshot(){
    return {
      mode: runtime.mode,
      loading: !!runtime.loading,
      authEnabled: !!runtime.authEnabled,
      authResolved: !!runtime.authResolved,
      user: runtime.user ? {
        uid: safeText(runtime.user.uid || ''),
        email: safeText(runtime.user.email || ''),
        displayName: safeText(runtime.user.displayName || '')
      } : null,
      firebaseStatus: runtime.firebaseStatus && typeof runtime.firebaseStatus === 'object'
        ? Object.assign({}, runtime.firebaseStatus)
        : null,
      accessState: runtime.accessState && typeof runtime.accessState === 'object'
        ? Object.assign({}, runtime.accessState)
        : null,
      error: safeText(runtime.error || '')
    };
  }

  function emitAuthState(){
    try{
      global.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: authStateSnapshot() }));
    }catch(_){ }
  }

  function ensureStyles(){
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      body.a33-auth-locked{ overflow:hidden !important; }
      .a33-auth-overlay{
        position:fixed;
        inset:0;
        z-index:2147483000;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:clamp(16px, 3vw, 28px);
        background:radial-gradient(circle at top, rgba(27,27,27,0.96) 0%, rgba(0,0,0,0.98) 58%, rgba(0,0,0,0.995) 100%);
        backdrop-filter:blur(12px);
      }
      .a33-auth-overlay[hidden]{ display:none !important; }
      .a33-auth-card{
        width:min(100%, 460px);
        border-radius:24px;
        border:1px solid rgba(221,191,100,0.28);
        box-shadow:0 22px 44px rgba(0,0,0,0.58);
        background:linear-gradient(180deg, rgba(20,20,20,0.98), rgba(8,8,8,0.98));
        color:#fefefe;
        padding:24px 22px 20px;
      }
      .a33-auth-brand{
        display:flex;
        align-items:center;
        gap:14px;
        margin-bottom:16px;
      }
      .a33-auth-brand img{
        width:54px;
        height:54px;
        border-radius:999px;
        object-fit:contain;
        border:1px solid rgba(221,191,100,0.45);
        padding:4px;
        background:#000;
        flex:0 0 auto;
      }
      .a33-auth-brand strong{
        display:block;
        font-size:1.08rem;
        letter-spacing:0.04em;
        text-transform:uppercase;
      }
      .a33-auth-brand span{
        display:block;
        color:#bdbdbd;
        font-size:0.84rem;
        margin-top:3px;
      }
      .a33-auth-kicker{
        display:inline-flex;
        align-items:center;
        gap:8px;
        font-size:0.73rem;
        text-transform:uppercase;
        letter-spacing:0.12em;
        color:#ddbf64;
        margin-bottom:12px;
      }
      .a33-auth-kicker::before{
        content:'';
        width:8px;
        height:8px;
        border-radius:999px;
        background:#7b1818;
        box-shadow:0 0 0 4px rgba(123,24,24,0.2);
      }
      .a33-auth-title{
        font-size:1.32rem;
        line-height:1.2;
        margin:0 0 8px;
      }
      .a33-auth-copy{
        color:#c7c7c7;
        font-size:0.92rem;
        line-height:1.45;
        margin:0 0 16px;
      }
      .a33-auth-form{ display:grid; gap:12px; }
      .a33-auth-field label{
        display:block;
        margin-bottom:6px;
        font-size:0.76rem;
        text-transform:uppercase;
        letter-spacing:0.08em;
        color:#ddbf64;
      }
      .a33-auth-field input{
        width:100%;
        padding:12px 14px;
        border-radius:14px;
        border:1px solid rgba(255,255,255,0.14);
        background:#050505;
        color:#fefefe;
        font-size:0.97rem;
        outline:none;
      }
      .a33-auth-field input:focus{
        border-color:rgba(221,191,100,0.65);
        box-shadow:0 0 0 3px rgba(221,191,100,0.15);
      }
      .a33-auth-row{
        display:flex;
        gap:10px;
        align-items:center;
        justify-content:space-between;
        flex-wrap:wrap;
      }
      .a33-auth-btn{
        width:100%;
        border:none;
        border-radius:999px;
        padding:12px 16px;
        font-weight:700;
        cursor:pointer;
        background:#7b1818;
        color:#fff;
        transition:transform 0.16s ease, opacity 0.16s ease;
      }
      .a33-auth-btn:hover{ transform:translateY(-1px); }
      .a33-auth-btn:disabled{ opacity:0.65; cursor:wait; transform:none; }
      .a33-auth-note{
        font-size:0.78rem;
        line-height:1.45;
        color:#b3b3b3;
      }
      .a33-auth-status{
        min-height:22px;
        font-size:0.84rem;
        line-height:1.35;
      }
      .a33-auth-status[data-tone="error"]{ color:#ffb4ab; }
      .a33-auth-status[data-tone="info"]{ color:#d7c079; }
      .a33-auth-status[data-tone="success"]{ color:#9ee2b3; }
      .a33-auth-loading{
        display:flex;
        align-items:center;
        gap:10px;
        color:#e7d399;
        font-size:0.92rem;
      }
      .a33-auth-spinner{
        width:18px;
        height:18px;
        border-radius:999px;
        border:2px solid rgba(221,191,100,0.22);
        border-top-color:#ddbf64;
        animation:a33AuthSpin 0.8s linear infinite;
      }
      @keyframes a33AuthSpin { to { transform:rotate(360deg); } }
      .a33-auth-bar{
        position:fixed;
        top:max(12px, env(safe-area-inset-top, 0px) + 8px);
        right:max(12px, env(safe-area-inset-right, 0px) + 8px);
        z-index:2147482000;
        display:flex;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
        justify-content:flex-end;
      }
      .a33-auth-bar[hidden]{ display:none !important; }
      .a33-auth-chip,
      .a33-auth-logout{
        border-radius:999px;
        border:1px solid rgba(221,191,100,0.28);
        background:rgba(0,0,0,0.8);
        color:#fefefe;
        padding:9px 12px;
        box-shadow:0 8px 24px rgba(0,0,0,0.28);
        font-size:0.8rem;
      }
      .a33-auth-chip strong{
        display:block;
        font-size:0.8rem;
        color:#fefefe;
      }
      .a33-auth-chip span{
        display:block;
        color:#ddbf64;
        font-size:0.73rem;
        margin-top:2px;
      }
      .a33-auth-logout{
        cursor:pointer;
        padding-inline:14px;
        font-weight:700;
      }
      .a33-auth-logout:hover{ border-color:rgba(221,191,100,0.52); }
      @media (max-width: 640px){
        .a33-auth-card{ padding:20px 18px 18px; }
        .a33-auth-title{ font-size:1.18rem; }
        .a33-auth-bar{ left:12px; right:12px; justify-content:stretch; }
        .a33-auth-chip, .a33-auth-logout{ width:100%; text-align:center; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureElements(){
    if (runtime.elements) return runtime.elements;
    ensureStyles();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'a33-auth-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="a33-auth-card" role="dialog" aria-modal="true" aria-labelledby="a33-auth-title">
        <div class="a33-auth-brand">
          <img src="/icon-a33-192.png" alt="Arcano 33" />
          <div>
            <strong>Suite A33</strong>
            <span>Acceso protegido con Firebase Authentication</span>
          </div>
        </div>
        <div class="a33-auth-kicker">Acceso</div>
        <h1 id="a33-auth-title" class="a33-auth-title">Preparando acceso…</h1>
        <p id="a33-auth-copy" class="a33-auth-copy">Estamos verificando el estado de autenticación de la suite.</p>
        <div id="a33-auth-loading" class="a33-auth-loading">
          <span class="a33-auth-spinner" aria-hidden="true"></span>
          <span>Conectando con Firebase…</span>
        </div>
        <form id="a33-auth-form" class="a33-auth-form" hidden>
          <div class="a33-auth-field">
            <label for="a33-auth-email">Correo</label>
            <input id="a33-auth-email" type="email" autocomplete="email" inputmode="email" placeholder="tu@correo.com" required />
          </div>
          <div class="a33-auth-field">
            <label for="a33-auth-password">Contraseña</label>
            <input id="a33-auth-password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required />
          </div>
          <button id="a33-auth-submit" class="a33-auth-btn" type="submit">Iniciar sesión</button>
        </form>
        <div class="a33-auth-row" style="margin-top:14px;">
          <div id="a33-auth-status" class="a33-auth-status" data-tone="info"></div>
          <div id="a33-auth-note" class="a33-auth-note">Cuando Firebase no esté vinculado, la suite conservará su modo local para no romperte el día.</div>
        </div>
      </div>
    `;

    const bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.className = 'a33-auth-bar';
    bar.hidden = true;
    bar.innerHTML = `
      <div id="a33-auth-chip" class="a33-auth-chip" hidden>
        <strong>Acceso no disponible</strong>
        <span>Modo local</span>
      </div>
      <button id="a33-auth-logout" class="a33-auth-logout" type="button" hidden>Cerrar sesión</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(bar);

    const elements = {
      overlay,
      bar,
      title: overlay.querySelector('#a33-auth-title'),
      copy: overlay.querySelector('#a33-auth-copy'),
      loading: overlay.querySelector('#a33-auth-loading'),
      form: overlay.querySelector('#a33-auth-form'),
      email: overlay.querySelector('#a33-auth-email'),
      password: overlay.querySelector('#a33-auth-password'),
      submit: overlay.querySelector('#a33-auth-submit'),
      status: overlay.querySelector('#a33-auth-status'),
      note: overlay.querySelector('#a33-auth-note'),
      chip: bar.querySelector('#a33-auth-chip'),
      logout: bar.querySelector('#a33-auth-logout')
    };

    elements.form.addEventListener('submit', onSubmitLogin);
    elements.logout.addEventListener('click', onLogout);

    runtime.elements = elements;
    return elements;
  }

  function setStatus(message, tone){
    const elements = ensureElements();
    elements.status.textContent = safeText(message || '');
    elements.status.dataset.tone = tone || 'info';
  }

  function setSubmitting(isSubmitting){
    const elements = ensureElements();
    elements.submit.disabled = !!isSubmitting;
    elements.email.disabled = !!isSubmitting;
    elements.password.disabled = !!isSubmitting;
    if (isSubmitting){
      elements.submit.textContent = 'Entrando…';
    } else {
      elements.submit.textContent = 'Iniciar sesión';
    }
  }

  function lockBody(locked){
    document.body.classList.toggle('a33-auth-locked', !!locked);
  }

  function mapAuthError(error){
    const code = safeText(error && error.code ? error.code : '').toLowerCase();
    if (!code) return 'No se pudo iniciar sesión. Revisa tu conexión e inténtalo otra vez.';
    if (code === 'auth/invalid-email') return 'Ese correo no tiene buen formato.';
    if (code === 'auth/missing-password') return 'Escribe la contraseña para continuar.';
    if (code === 'auth/user-disabled') return 'Esta cuenta fue deshabilitada en Firebase Authentication.';
    if (code === 'auth/user-not-found') return 'No existe una cuenta con ese correo.';
    if (code === 'auth/wrong-password') return 'La contraseña no coincide.';
    if (code === 'auth/invalid-credential') return 'Correo o contraseña incorrectos.';
    if (code === 'auth/too-many-requests') return 'Demasiados intentos. Espera un momento y vuelve a probar.';
    if (code === 'auth/network-request-failed') return 'No hubo conexión con Firebase. Revisa internet y vuelve a intentar.';
    if (code === 'auth/operation-not-allowed') return 'Email/Password todavía no está habilitado en Firebase Console.';
    return 'No se pudo iniciar sesión: ' + code.replace(/^auth\//, '').replace(/-/g, ' ') + '.';
  }

  function describeUser(user){
    if (!user) return '';
    const email = safeText(user.email || '').trim();
    const name = safeText(user.displayName || '').trim();
    return name || email || 'Usuario autenticado';
  }

  function buildAccessGate(){
    const access = runtime.accessState && typeof runtime.accessState === 'object' ? runtime.accessState : null;
    if (!runtime.user || !access) return null;
    if (access.loadingProfile) return null;
    if (access.canBootstrap) return null;

    const status = safeText(access.status || '').toLowerCase();
    const permissions = Array.isArray(access.permissions) ? access.permissions : [];

    if (status === 'inactive') {
      return {
        title: 'Cuenta inactiva',
        copy: 'Tu perfil fue desactivado. La suite queda bloqueada hasta que un Admin vuelva a activarte.',
        statusText: 'Sesión autenticada, pero sin acceso operativo.',
        note: 'Cierra sesión o contacta al administrador del workspace.'
      };
    }

    if (access.profileMissing && !access.canBootstrap) {
      return {
        title: 'Perfil pendiente',
        copy: 'Tu sesión existe, pero todavía no tiene un perfil válido dentro del workspace.',
        statusText: 'Aún no puedes operar la suite con esta cuenta.',
        note: 'Pide a un Admin que revise tu alta, rol y estado.'
      };
    }

    if (access.profile && permissions.length && !permissions.includes('suite.use')) {
      return {
        title: 'Acceso restringido',
        copy: 'Tu cuenta no trae permiso para usar la suite en este momento.',
        statusText: 'El backend validó tu sesión, pero no te habilitó acceso operativo.',
        note: 'Pide a un Admin que ajuste tu rol o permisos.'
      };
    }

    return null;
  }

  function render(){
    const elements = ensureElements();
    const fb = runtime.firebaseStatus || {};
    const authReady = !!(fb.authReady);

    if (runtime.loading){
      runtime.mode = 'loading';
      lockBody(true);
      elements.overlay.hidden = false;
      elements.loading.hidden = false;
      elements.form.hidden = true;
      elements.bar.hidden = true;
      elements.title.textContent = 'Preparando acceso…';
      elements.copy.textContent = 'Estamos verificando el estado de autenticación de la suite.';
      setStatus('Conectando con Firebase…', 'info');
      elements.note.textContent = 'La sesión se restaurará automáticamente si ya existía una válida.';
      emitAuthState();
      return;
    }

    if (!runtime.authEnabled || !authReady){
      runtime.mode = 'local';
      lockBody(false);
      elements.overlay.hidden = true;
      elements.bar.hidden = false;
      elements.chip.hidden = false;
      elements.logout.hidden = true;
      elements.chip.querySelector('strong').textContent = fb.status === 'error' ? 'Fallback local activo' : 'Modo local activo';
      elements.chip.querySelector('span').textContent = fb.status === 'error'
        ? 'Firebase falló; la suite siguió viva.'
        : 'Firebase no vinculado todavía.';
      emitAuthState();
      return;
    }

    if (!runtime.authResolved){
      runtime.mode = 'loading';
      lockBody(true);
      elements.overlay.hidden = false;
      elements.loading.hidden = false;
      elements.form.hidden = true;
      elements.bar.hidden = true;
      elements.title.textContent = 'Validando sesión…';
      elements.copy.textContent = 'Firebase ya está listo. Solo estamos confirmando si tu sesión sigue viva.';
      setStatus('Comprobando credenciales guardadas…', 'info');
      elements.note.textContent = 'Si ya habías iniciado sesión, deberías entrar sin volver a escribir tu contraseña.';
      emitAuthState();
      return;
    }

    if (runtime.user){
      const gate = buildAccessGate();
      if (gate){
        runtime.mode = 'access-denied';
        lockBody(true);
        elements.overlay.hidden = false;
        elements.loading.hidden = true;
        elements.form.hidden = true;
        elements.bar.hidden = false;
        elements.chip.hidden = false;
        elements.logout.hidden = false;
        elements.title.textContent = gate.title;
        elements.copy.textContent = gate.copy;
        elements.chip.querySelector('strong').textContent = describeUser(runtime.user);
        elements.chip.querySelector('span').textContent = 'Acceso restringido';
        setStatus(gate.statusText, 'error');
        elements.note.textContent = gate.note;
        emitAuthState();
        return;
      }

      runtime.mode = 'authenticated';
      lockBody(false);
      elements.overlay.hidden = true;
      elements.bar.hidden = false;
      elements.chip.hidden = false;
      elements.logout.hidden = false;
      elements.chip.querySelector('strong').textContent = describeUser(runtime.user);
      elements.chip.querySelector('span').textContent = 'Sesión activa';
      emitAuthState();
      return;
    }

    runtime.mode = 'unauthenticated';
    lockBody(true);
    elements.overlay.hidden = false;
    elements.loading.hidden = true;
    elements.form.hidden = false;
    elements.bar.hidden = true;
    elements.title.textContent = 'Inicia sesión para entrar';
    elements.copy.textContent = 'La suite ya reconoce Firebase Authentication. Usa tu correo y contraseña para desbloquearla.';
    setSubmitting(false);
    if (!elements.email.value){
      try{ elements.email.value = safeText(localStorage.getItem('a33_last_login_email') || ''); }catch(_){ elements.email.value = ''; }
    }
    setStatus(runtime.error || 'Acceso protegido. Sin sesión, la suite no se abre completa.', runtime.error ? 'error' : 'info');
    elements.note.textContent = 'La sesión se mantendrá de forma persistente en este dispositivo hasta que cierres sesión.';
    requestAnimationFrame(() => {
      try{ (elements.email.value ? elements.password : elements.email).focus(); }catch(_){ }
    });
    emitAuthState();
  }

  async function setAuthPersistence(auth){
    if (!auth || typeof auth.setPersistence !== 'function') return;
    const firebaseNs = global.firebase;
    const LOCAL = firebaseNs && firebaseNs.auth && firebaseNs.auth.Auth && firebaseNs.auth.Auth.Persistence
      ? firebaseNs.auth.Auth.Persistence.LOCAL
      : null;
    if (!LOCAL) return;
    try{
      await auth.setPersistence(LOCAL);
    }catch(error){
      console.warn('[Suite A33] No se pudo fijar persistencia LOCAL en Auth.', error);
    }
  }

  function bindAuth(auth){
    if (!auth || typeof auth.onAuthStateChanged !== 'function') return;
    if (typeof runtime.firebaseUnsub === 'function') return;
    runtime.authEnabled = true;
    setAuthPersistence(auth).finally(() => {
      runtime.firebaseUnsub = auth.onAuthStateChanged((user) => {
        runtime.authResolved = true;
        runtime.user = user || null;
        runtime.error = '';
        render();
      }, (error) => {
        runtime.authResolved = true;
        runtime.user = null;
        runtime.error = mapAuthError(error);
        render();
      });
      render();
    });
  }

  async function onSubmitLogin(event){
    event.preventDefault();
    const elements = ensureElements();
    const email = safeText(elements.email.value).trim();
    const password = safeText(elements.password.value);

    if (!email){
      setStatus('Escribe tu correo para entrar.', 'error');
      elements.email.focus();
      return;
    }
    if (!password){
      setStatus('Escribe tu contraseña para continuar.', 'error');
      elements.password.focus();
      return;
    }

    const fb = global.A33Firebase && typeof global.A33Firebase.getState === 'function'
      ? global.A33Firebase.getState()
      : {};
    const auth = fb && fb.auth ? fb.auth : (global.A33Firebase && global.A33Firebase._unsafeGetAuth ? global.A33Firebase._unsafeGetAuth() : null);
    if (!auth || typeof auth.signInWithEmailAndPassword !== 'function'){
      setStatus('Auth todavía no está listo. Recarga la página o verifica Firebase.', 'error');
      return;
    }

    setSubmitting(true);
    setStatus('Verificando credenciales…', 'info');
    try{
      await setAuthPersistence(auth);
      await auth.signInWithEmailAndPassword(email, password);
      try{ localStorage.setItem('a33_last_login_email', email); }catch(_){ }
      runtime.error = '';
      setStatus('Sesión iniciada.', 'success');
      elements.password.value = '';
    }catch(error){
      runtime.error = mapAuthError(error);
      setStatus(runtime.error, 'error');
      console.warn('[Suite A33] Error de login Firebase Auth.', error);
    }finally{
      setSubmitting(false);
    }
  }

  async function onLogout(){
    const fb = global.A33Firebase && typeof global.A33Firebase.getState === 'function'
      ? global.A33Firebase.getState()
      : {};
    const auth = fb && fb.auth ? fb.auth : (global.A33Firebase && global.A33Firebase._unsafeGetAuth ? global.A33Firebase._unsafeGetAuth() : null);
    if (!auth || typeof auth.signOut !== 'function') return;

    const elements = ensureElements();
    elements.logout.disabled = true;
    elements.logout.textContent = 'Saliendo…';
    try{
      await auth.signOut();
      runtime.user = null;
      runtime.error = '';
    }catch(error){
      runtime.error = 'No se pudo cerrar sesión. Intenta otra vez.';
      console.warn('[Suite A33] Error al cerrar sesión.', error);
    }finally{
      elements.logout.disabled = false;
      elements.logout.textContent = 'Cerrar sesión';
      render();
    }
  }

  function onFirebaseStatus(detail){
    runtime.firebaseStatus = detail && typeof detail === 'object' ? detail : null;
    const status = runtime.firebaseStatus && runtime.firebaseStatus.status ? String(runtime.firebaseStatus.status) : 'disabled';
    const authReady = !!(runtime.firebaseStatus && runtime.firebaseStatus.authReady);

    if (status === 'ready' && authReady){
      runtime.loading = false;
      runtime.authEnabled = true;
      const auth = global.A33Firebase && global.A33Firebase._unsafeGetAuth ? global.A33Firebase._unsafeGetAuth() : null;
      bindAuth(auth);
      render();
      return;
    }

    if (status === 'initializing'){
      runtime.loading = true;
      runtime.authEnabled = true;
      render();
      return;
    }

    runtime.loading = false;
    runtime.authEnabled = false;
    runtime.authResolved = false;
    runtime.user = null;
    render();
  }

  function start(){
    ensureElements();
    const initial = global.A33Firebase && typeof global.A33Firebase.getState === 'function'
      ? global.A33Firebase.getState()
      : null;
    if (initial) onFirebaseStatus(initial);
    else render();

    global.addEventListener('a33:firebase-status', (event) => {
      onFirebaseStatus(event && event.detail ? event.detail : null);
    });
    global.addEventListener('a33:access-state', (event) => {
      runtime.accessState = event && event.detail ? event.detail : null;
      render();
    });
  }

  global.A33Auth = {
    stateEvent: AUTH_EVENT,
    getState: authStateSnapshot,
    refresh(){
      const current = global.A33Firebase && typeof global.A33Firebase.getState === 'function'
        ? global.A33Firebase.getState()
        : null;
      onFirebaseStatus(current);
      return authStateSnapshot();
    }
  };

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
