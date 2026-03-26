(function(g){
  'use strict';

  const EVENT_NAME = 'a33-workspace-state';
  let currentState = null;
  let ensurePromise = null;
  let authListenerBound = false;

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

  function emitState(){
    try{
      if (typeof g.dispatchEvent === 'function' && typeof CustomEvent === 'function'){
        g.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: clone(currentState) }));
      }
    }catch(_){ }
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
      message: 'Firebase base no está disponible.',
      hasRealConfig: false,
      services: { appPrepared:false, authPrepared:false, firestorePrepared:false },
      error: null,
      checkedAt: nowIso(),
      projectId: '',
      authDomain: ''
    };
  }

  function getAuthStatus(){
    try{
      if (g.A33Auth && typeof g.A33Auth.getStatusSync === 'function'){
        return g.A33Auth.getStatusSync();
      }
    }catch(_){ }
    const firebase = getFirebaseStatus();
    return {
      code: firebase.hasRealConfig ? 'signed-out' : 'needs-config',
      label: firebase.hasRealConfig ? 'Sin sesión' : 'Config pendiente',
      message: firebase.hasRealConfig ? 'No hay una sesión activa en este navegador.' : 'Completa la configuración de Firebase para activar el acceso real.',
      isAuthenticated: false,
      authReady: !!(firebase.services && firebase.services.authPrepared),
      user: null,
      error: firebase.error || null,
      checkedAt: firebase.checkedAt || nowIso()
    };
  }

  function buildBaseState(){
    const firebase = getFirebaseStatus();
    const auth = getAuthStatus();

    if (!firebase.hasRealConfig){
      return {
        code: 'needs-config',
        label: 'Config pendiente',
        message: 'Completa la configuración de Firebase antes de preparar el contexto real.',
        isBusy: false,
        isAuthenticated: false,
        hasContext: false,
        user: null,
        profile: null,
        workspace: null,
        membership: null,
        role: '',
        currentWorkspaceId: '',
        created: { user:false, workspace:false, membership:false },
        error: null,
        checkedAt: nowIso(),
        firebase: {
          code: firebase.code || 'placeholder',
          label: firebase.label || 'Pendiente de configuración',
          message: firebase.message || '',
          projectId: safeText(firebase.projectId),
          authDomain: safeText(firebase.authDomain)
        }
      };
    }

    if (!auth.isAuthenticated || !auth.user){
      return {
        code: 'signed-out',
        label: 'Sin sesión',
        message: 'Inicia sesión para preparar el usuario real y su espacio de trabajo.',
        isBusy: false,
        isAuthenticated: false,
        hasContext: false,
        user: null,
        profile: null,
        workspace: null,
        membership: null,
        role: '',
        currentWorkspaceId: '',
        created: { user:false, workspace:false, membership:false },
        error: auth.error || null,
        checkedAt: nowIso(),
        firebase: {
          code: firebase.code || 'ready',
          label: firebase.label || 'Base Firebase',
          message: firebase.message || '',
          projectId: safeText(firebase.projectId),
          authDomain: safeText(firebase.authDomain)
        }
      };
    }

    return {
      code: 'awaiting-context',
      label: 'Contexto pendiente',
      message: 'Validando usuario, espacio y vínculo en Firestore…',
      isBusy: false,
      isAuthenticated: true,
      hasContext: false,
      user: clone(auth.user),
      profile: null,
      workspace: null,
      membership: null,
      role: '',
      currentWorkspaceId: '',
      created: { user:false, workspace:false, membership:false },
      error: null,
      checkedAt: nowIso(),
      firebase: {
        code: firebase.code || 'ready',
        label: firebase.label || 'Base Firebase',
        message: firebase.message || '',
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
      created: {
        ...(base.created || {}),
        ...((prev.created && typeof prev.created === 'object') ? prev.created : {}),
        ...(((partial || {}).created && typeof (partial || {}).created === 'object') ? (partial || {}).created : {})
      },
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

  function formatTimestamp(value){
    try{
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value.toDate === 'function') return value.toDate().toISOString();
      if (value.seconds != null){
        return new Date(Number(value.seconds) * 1000).toISOString();
      }
    }catch(_){ }
    return '';
  }

  function compactUid(uid){
    const safe = safeText(uid);
    if (!safe) return '';
    return safe.length > 12 ? `${safe.slice(0, 6)}…${safe.slice(-4)}` : safe;
  }

  function normalizeUserDoc(id, data = {}){
    return {
      id: safeText(id),
      uid: safeText(data.uid || id),
      uidShort: compactUid(data.uid || id),
      email: safeText(data.email),
      displayName: safeText(data.displayName),
      status: safeText(data.status) || 'ACTIVO',
      type: safeText(data.type) || 'USER',
      currentWorkspaceId: safeText(data.currentWorkspaceId),
      createdAt: formatTimestamp(data.createdAt),
      updatedAt: formatTimestamp(data.updatedAt),
      lastLoginAt: formatTimestamp(data.lastLoginAt)
    };
  }

  function normalizeWorkspaceDoc(id, data = {}){
    return {
      id: safeText(id),
      name: safeText(data.name) || safeText(id),
      status: safeText(data.status) || 'ACTIVO',
      ownerUid: safeText(data.ownerUid),
      createdBy: safeText(data.createdBy),
      structureVersion: safeText(data.structureVersion) || 'workspace-min-v1',
      roleModel: Array.isArray(data.roleModel) ? data.roleModel.slice() : ['ADMIN', 'MIEMBRO'],
      activeJoinCode: safeText(data.activeJoinCode),
      activeJoinRole: safeText(data.activeJoinRole) || 'MIEMBRO',
      activeJoinStatus: safeText(data.activeJoinStatus),
      activeJoinUpdatedAt: formatTimestamp(data.activeJoinUpdatedAt),
      createdAt: formatTimestamp(data.createdAt),
      updatedAt: formatTimestamp(data.updatedAt)
    };
  }

  function normalizeMembershipDoc(id, data = {}){
    return {
      id: safeText(id),
      uid: safeText(data.uid || id),
      workspaceId: safeText(data.workspaceId),
      role: safeText(data.role) || 'MIEMBRO',
      status: safeText(data.status) || 'ACTIVO',
      kind: safeText(data.kind) || 'MEMBER',
      email: safeText(data.email),
      displayName: safeText(data.displayName),
      inviteCode: safeText(data.inviteCode),
      joinedAt: formatTimestamp(data.joinedAt),
      createdAt: formatTimestamp(data.createdAt),
      updatedAt: formatTimestamp(data.updatedAt)
    };
  }

  function sanitizeWorkspaceForRole(workspace, membership){
    const safeWorkspace = workspace && typeof workspace === 'object' ? { ...workspace } : null;
    if (!safeWorkspace) return null;
    const role = safeText(membership && membership.role);
    if (role === 'ADMIN') return safeWorkspace;
    delete safeWorkspace.activeJoinCode;
    delete safeWorkspace.activeJoinRole;
    delete safeWorkspace.activeJoinStatus;
    delete safeWorkspace.activeJoinUpdatedAt;
    return safeWorkspace;
  }

  function sanitizeWorkspaceId(uid = ''){
    const safe = safeText(uid).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    return `ws_${(safe || 'base').slice(0, 28)}`;
  }

  function buildDefaultWorkspaceName(authUser = {}){
    const display = safeText(authUser.displayName);
    if (display) return `Espacio de ${display}`;
    const email = safeText(authUser.email);
    const seed = email.includes('@') ? email.split('@')[0] : 'Arcano 33';
    const normalized = seed.replace(/[._-]+/g, ' ').trim() || 'Arcano 33';
    return `Espacio de ${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
  }

  function buildUserPatch(existingData, authUser, workspaceId, firestoreMod){
    const existing = existingData && typeof existingData === 'object' ? existingData : {};
    const uid = safeText(authUser.uid);
    const email = safeText(authUser.email);
    const displayName = safeText(authUser.displayName);
    const patch = {};

    if (!safeText(existing.uid)) patch.uid = uid;
    if (email && safeText(existing.email) !== email) patch.email = email;
    if (displayName && safeText(existing.displayName) !== displayName) patch.displayName = displayName;
    if (!safeText(existing.status)) patch.status = 'ACTIVO';
    if (!safeText(existing.type)) patch.type = 'USER';
    if (safeText(existing.currentWorkspaceId) !== workspaceId) patch.currentWorkspaceId = workspaceId;
    if (!existing.createdAt) patch.createdAt = firestoreMod.serverTimestamp();
    if (!existing.lastLoginAt) patch.lastLoginAt = firestoreMod.serverTimestamp();
    if (Object.keys(patch).length){
      patch.updatedAt = firestoreMod.serverTimestamp();
      if (!patch.lastLoginAt) patch.lastLoginAt = firestoreMod.serverTimestamp();
    }
    return Object.keys(patch).length ? patch : null;
  }

  function buildWorkspacePatch(existingData, authUser, workspaceId, firestoreMod){
    const existing = existingData && typeof existingData === 'object' ? existingData : {};
    if (existing && Object.keys(existing).length){
      const patch = {};
      if (!safeText(existing.name)) patch.name = buildDefaultWorkspaceName(authUser);
      if (!safeText(existing.status)) patch.status = 'ACTIVO';
      if (!safeText(existing.ownerUid)) patch.ownerUid = safeText(authUser.uid);
      if (!safeText(existing.createdBy)) patch.createdBy = safeText(authUser.uid);
      if (!Array.isArray(existing.roleModel) || !existing.roleModel.length) patch.roleModel = ['ADMIN', 'MIEMBRO'];
      if (!safeText(existing.structureVersion)) patch.structureVersion = 'workspace-min-v1';
      if (Object.keys(patch).length){
        patch.updatedAt = firestoreMod.serverTimestamp();
        return patch;
      }
      return null;
    }
    return {
      id: workspaceId,
      name: buildDefaultWorkspaceName(authUser),
      status: 'ACTIVO',
      ownerUid: safeText(authUser.uid),
      createdBy: safeText(authUser.uid),
      roleModel: ['ADMIN', 'MIEMBRO'],
      structureVersion: 'workspace-min-v1',
      createdAt: firestoreMod.serverTimestamp(),
      updatedAt: firestoreMod.serverTimestamp()
    };
  }

  function buildMembershipPatch(existingData, workspaceData, authUser, workspaceId, firestoreMod){
    const existing = existingData && typeof existingData === 'object' ? existingData : {};
    const workspace = workspaceData && typeof workspaceData === 'object' ? workspaceData : {};
    const uid = safeText(authUser.uid);
    const email = safeText(authUser.email);
    const displayName = safeText(authUser.displayName);
    const workspaceOwnerUid = safeText(workspace.ownerUid);
    const canAutoOwnMembership = !workspaceOwnerUid || workspaceOwnerUid === uid;

    if (existing && Object.keys(existing).length){
      const patch = {};
      if (safeText(existing.uid) !== uid) patch.uid = uid;
      if (!safeText(existing.userId)) patch.userId = uid;
      if (safeText(existing.workspaceId) !== workspaceId) patch.workspaceId = workspaceId;
      if (!safeText(existing.role) && canAutoOwnMembership) patch.role = 'ADMIN';
      if (!safeText(existing.role) && !canAutoOwnMembership) patch.role = 'MIEMBRO';
      if (!safeText(existing.status)) patch.status = 'ACTIVO';
      if (!safeText(existing.kind)) patch.kind = canAutoOwnMembership ? 'OWNER' : 'MEMBER';
      if (email && safeText(existing.email) !== email) patch.email = email;
      if (displayName && safeText(existing.displayName) !== displayName) patch.displayName = displayName;
      if (!existing.joinedAt) patch.joinedAt = firestoreMod.serverTimestamp();
      if (Object.keys(patch).length){
        patch.updatedAt = firestoreMod.serverTimestamp();
        return patch;
      }
      return null;
    }

    if (!canAutoOwnMembership) return null;

    return {
      uid,
      userId: uid,
      workspaceId,
      role: 'ADMIN',
      status: 'ACTIVO',
      kind: 'OWNER',
      email,
      displayName,
      joinedAt: firestoreMod.serverTimestamp(),
      createdAt: firestoreMod.serverTimestamp(),
      updatedAt: firestoreMod.serverTimestamp()
    };
  }

  function mapWorkspaceError(error){
    const code = safeText(error && error.code);
    const rawMessage = safeText(error && error.message) || 'No se pudo validar el contexto real en Firestore.';
    const map = {
      'permission-denied': 'Firestore rechazó la operación. Activa Firestore y usa reglas que permitan al usuario autenticado leer/escribir su contexto base.',
      'failed-precondition': 'Firestore todavía no está listo. Verifica que la base exista y que el proyecto Firebase esté completo.',
      'unavailable': 'Firestore no respondió. Revisa conexión o estado del servicio.',
      'not-found': 'No se encontró la ruta esperada en Firestore.'
    };
    return {
      code: code || 'workspace/error',
      message: map[code] || rawMessage
    };
  }

  async function ensure(options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    if (ensurePromise) return ensurePromise;

    ensurePromise = (async () => {
      const auth = getAuthStatus();
      const firebaseBefore = getFirebaseStatus();
      if (!firebaseBefore.hasRealConfig) return mergeState(buildBaseState());
      if (!auth.isAuthenticated || !auth.user) return mergeState(buildBaseState());

      mergeState({
        code: 'syncing',
        label: 'Preparando contexto',
        message: 'Validando usuario, espacio y vínculo real en Firestore…',
        isBusy: true,
        isAuthenticated: true,
        user: clone(auth.user),
        error: null,
        created: { user:false, workspace:false, membership:false }
      });

      if (g.A33Firebase && typeof g.A33Firebase.boot === 'function'){
        await g.A33Firebase.boot();
      }

      const firebase = getFirebaseStatus();
      const db = g.A33Firebase && typeof g.A33Firebase.getFirestore === 'function' ? g.A33Firebase.getFirestore() : null;
      const modules = g.A33Firebase && typeof g.A33Firebase.getModules === 'function' ? g.A33Firebase.getModules() : null;
      const firestoreMod = modules && modules.firestore;

      if (!db || !firestoreMod){
        return mergeState({
          code: 'firebase-error',
          label: 'Firestore no preparado',
          message: 'Firebase todavía no dejó Firestore listo para crear el contexto real.',
          isBusy: false,
          isAuthenticated: true,
          hasContext: false,
          user: clone(auth.user),
          error: { code:'firestore/not-ready', message:'Firestore no está preparado.' },
          firebase: {
            code: firebase.code || 'error',
            label: firebase.label || 'Base Firebase',
            message: firebase.message || '',
            projectId: safeText(firebase.projectId),
            authDomain: safeText(firebase.authDomain)
          }
        });
      }

      const uid = safeText(auth.user.uid);
      const userRef = firestoreMod.doc(db, 'users', uid);
      const userSnap = await firestoreMod.getDoc(userRef);
      const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
      const workspaceId = safeText(userData.currentWorkspaceId) || sanitizeWorkspaceId(uid);
      const workspaceRef = firestoreMod.doc(db, 'workspaces', workspaceId);
      const memberRef = firestoreMod.doc(db, 'workspaces', workspaceId, 'members', uid);
      const [workspaceSnap, memberSnap] = await Promise.all([
        firestoreMod.getDoc(workspaceRef),
        firestoreMod.getDoc(memberRef)
      ]);

      const workspaceData = workspaceSnap.exists() ? (workspaceSnap.data() || {}) : {};
      const memberData = memberSnap.exists() ? (memberSnap.data() || {}) : {};

      const batch = firestoreMod.writeBatch(db);
      let hasWrites = false;
      const created = { user:false, workspace:false, membership:false };

      const userPatch = buildUserPatch(userData, auth.user, workspaceId, firestoreMod);
      if (userPatch){
        batch.set(userRef, userPatch, { merge:true });
        hasWrites = true;
        if (!userSnap.exists()) created.user = true;
      }

      const workspacePatch = buildWorkspacePatch(workspaceData, auth.user, workspaceId, firestoreMod);
      if (workspacePatch){
        batch.set(workspaceRef, workspacePatch, { merge:true });
        hasWrites = true;
        if (!workspaceSnap.exists()) created.workspace = true;
      }

      const membershipPatch = buildMembershipPatch(memberData, workspaceData, auth.user, workspaceId, firestoreMod);
      if (membershipPatch){
        batch.set(memberRef, membershipPatch, { merge:true });
        hasWrites = true;
        if (!memberSnap.exists()) created.membership = true;
      }

      if (hasWrites) await batch.commit();

      const [finalUserSnap, finalWorkspaceSnap, finalMemberSnap] = await Promise.all([
        firestoreMod.getDoc(userRef),
        firestoreMod.getDoc(workspaceRef),
        firestoreMod.getDoc(memberRef)
      ]);

      const profile = normalizeUserDoc(uid, finalUserSnap.exists() ? finalUserSnap.data() : userData);
      const workspace = normalizeWorkspaceDoc(workspaceId, finalWorkspaceSnap.exists() ? finalWorkspaceSnap.data() : workspaceData);
      const membership = normalizeMembershipDoc(uid, finalMemberSnap.exists() ? finalMemberSnap.data() : memberData);
      const visibleWorkspace = sanitizeWorkspaceForRole(workspace, membership);
      const membershipExists = !!(membership && membership.uid);
      const membershipActive = membershipExists && safeText(membership.status) === 'ACTIVO';

      if (!membershipActive){
        const message = membershipExists
          ? 'Tu vínculo con este espacio no está activo en este momento. Usa un código de unión o pide a un ADMIN que te reactive.'
          : 'Este usuario no tiene membresía activa en el espacio seleccionado. Usa un código de unión o pide a un ADMIN que te agregue.';
        return mergeState({
          code: 'no-membership',
          label: 'Sin membresía activa',
          message,
          isBusy: false,
          isAuthenticated: true,
          hasContext: false,
          user: clone(auth.user),
          profile,
          workspace: visibleWorkspace,
          membership: membershipExists ? membership : null,
          role: '',
          currentWorkspaceId: workspace.id,
          created,
          error: membershipExists ? { code:'membership/inactive', message } : { code:'membership/missing', message },
          firebase: {
            code: firebase.code || 'ready',
            label: firebase.label || 'Base Firebase',
            message: firebase.message || '',
            projectId: safeText(firebase.projectId),
            authDomain: safeText(firebase.authDomain)
          }
        });
      }

      const message = created.workspace
        ? 'Se creó el espacio inicial y quedó vinculado al usuario autenticado.'
        : (created.membership
          ? 'Se preparó el vínculo real del usuario con su espacio de trabajo.'
          : 'Usuario, espacio y vínculo ya están listos en Firestore.');

      return mergeState({
        code: 'ready',
        label: 'Contexto listo',
        message,
        isBusy: false,
        isAuthenticated: true,
        hasContext: true,
        user: clone(auth.user),
        profile,
        workspace: visibleWorkspace,
        membership,
        role: membership.role || 'ADMIN',
        currentWorkspaceId: workspace.id,
        created,
        error: null,
        firebase: {
          code: firebase.code || 'ready',
          label: firebase.label || 'Base Firebase',
          message: firebase.message || '',
          projectId: safeText(firebase.projectId),
          authDomain: safeText(firebase.authDomain)
        }
      });
    })().catch((error) => {
      const auth = getAuthStatus();
      const firebase = getFirebaseStatus();
      const mapped = mapWorkspaceError(error);
      return mergeState({
        code: 'error',
        label: 'Contexto con error',
        message: mapped.message,
        isBusy: false,
        isAuthenticated: !!auth.isAuthenticated,
        hasContext: false,
        user: clone(auth.user),
        error: mapped,
        created: { user:false, workspace:false, membership:false },
        firebase: {
          code: firebase.code || 'error',
          label: firebase.label || 'Base Firebase',
          message: firebase.message || '',
          projectId: safeText(firebase.projectId),
          authDomain: safeText(firebase.authDomain)
        }
      });
    }).finally(() => {
      ensurePromise = null;
    });

    return ensurePromise;
  }

  async function refresh(options = {}){
    const opts = options && typeof options === 'object' ? options : {};
    const auth = getAuthStatus();
    if (auth.isAuthenticated){
      return ensure({ forceEnsure: !!opts.forceEnsure });
    }
    return mergeState(buildBaseState());
  }

  async function reset(){
    ensurePromise = null;
    currentState = buildBaseState();
    emitState();
    return clone(currentState);
  }

  function getStatusSync(){
    if (!currentState){
      currentState = buildBaseState();
    }
    return clone(currentState);
  }

  function bindAuthEvents(){
    if (authListenerBound || typeof g.addEventListener !== 'function') return;
    authListenerBound = true;
    const authEventName = (g.A33Auth && g.A33Auth.EVENT_NAME) || 'a33-auth-state';
    g.addEventListener(authEventName, () => {
      const auth = getAuthStatus();
      if (auth.isAuthenticated){
        ensure({ reason:'auth-event' }).catch(() => {});
      }else{
        reset().catch(() => {});
      }
    });
  }

  bindAuthEvents();
  currentState = buildBaseState();

  g.A33Workspace = {
    EVENT_NAME,
    getStatusSync,
    ensure,
    refresh,
    reset
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
