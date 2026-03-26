(function(g){
  'use strict';

  const EVENT_NAME = 'a33-members-state';
  const CODE_PREFIX = 'A33';
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let currentState = null;
  let refreshPromise = null;

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

  function setState(partial){
    currentState = {
      ...buildBaseState(),
      ...(currentState || {}),
      ...(partial || {}),
      checkedAt: nowIso()
    };
    emitState();
    return clone(currentState);
  }

  function formatTimestamp(value){
    try{
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value.toDate === 'function') return value.toDate().toISOString();
      if (value.seconds != null) return new Date(Number(value.seconds) * 1000).toISOString();
    }catch(_){ }
    return '';
  }

  function buildBaseState(){
    const workspace = getWorkspaceStatus();
    const auth = getAuthStatus();
    return {
      code: !auth.isAuthenticated ? 'signed-out' : (workspace.hasContext ? 'idle' : 'no-context'),
      label: !auth.isAuthenticated ? 'Sin sesión' : (workspace.hasContext ? 'Pendiente de refresco' : 'Sin contexto activo'),
      message: !auth.isAuthenticated
        ? 'Inicia sesión para ver o administrar miembros reales.'
        : (workspace.hasContext
          ? 'Refresca miembros para cargar el estado real del espacio compartido.'
          : (workspace.message || 'No hay un contexto activo para listar miembros.')),
      isBusy: false,
      isAuthenticated: !!auth.isAuthenticated,
      hasContext: !!workspace.hasContext,
      canManage: safeText(workspace.role) === 'ADMIN',
      role: safeText(workspace.role),
      currentUserId: safeText(auth.user && auth.user.uid),
      currentWorkspaceId: safeText(workspace.currentWorkspaceId || (workspace.workspace && workspace.workspace.id)),
      workspace: clone(workspace.workspace || null),
      members: [],
      counts: { total:0, adminCount:0, memberCount:0, activeCount:0 },
      activeJoinCode: safeText(workspace.workspace && workspace.workspace.activeJoinCode),
      activeJoinRole: safeText(workspace.workspace && workspace.workspace.activeJoinRole) || 'MIEMBRO',
      activeJoinStatus: safeText(workspace.workspace && workspace.workspace.activeJoinStatus),
      lastInviteCode: '',
      error: workspace.error || null,
      checkedAt: nowIso()
    };
  }

  function getAuthStatus(){
    try{
      if (g.A33Auth && typeof g.A33Auth.getStatusSync === 'function'){
        return g.A33Auth.getStatusSync();
      }
    }catch(_){ }
    return { isAuthenticated:false, user:null, error:null };
  }

  function getWorkspaceStatus(){
    try{
      if (g.A33Workspace && typeof g.A33Workspace.getStatusSync === 'function'){
        return g.A33Workspace.getStatusSync();
      }
    }catch(_){ }
    return { hasContext:false, role:'', workspace:null, currentWorkspaceId:'', message:'Contexto no disponible.', error:null };
  }

  function getFirebaseHandles(){
    const db = g.A33Firebase && typeof g.A33Firebase.getFirestore === 'function' ? g.A33Firebase.getFirestore() : null;
    const modules = g.A33Firebase && typeof g.A33Firebase.getModules === 'function' ? g.A33Firebase.getModules() : null;
    const firestore = modules && modules.firestore;
    return { db, firestore };
  }

  function normalizeMemberDoc(id, data = {}){
    return {
      id: safeText(id),
      uid: safeText(data.uid || id),
      userId: safeText(data.userId || data.uid || id),
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

  function normalizeWorkspaceDoc(id, data = {}){
    return {
      id: safeText(id),
      name: safeText(data.name) || safeText(id),
      status: safeText(data.status) || 'ACTIVO',
      ownerUid: safeText(data.ownerUid),
      activeJoinCode: safeText(data.activeJoinCode),
      activeJoinRole: safeText(data.activeJoinRole) || 'MIEMBRO',
      activeJoinStatus: safeText(data.activeJoinStatus),
      activeJoinUpdatedAt: formatTimestamp(data.activeJoinUpdatedAt),
      updatedAt: formatTimestamp(data.updatedAt),
      createdAt: formatTimestamp(data.createdAt)
    };
  }

  function normalizeInviteCode(raw = ''){
    const compact = safeText(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!compact) return '';
    const stripped = compact.startsWith(CODE_PREFIX) ? compact.slice(CODE_PREFIX.length) : compact;
    if (stripped.length !== 8) return '';
    return `${CODE_PREFIX}-${stripped.slice(0, 4)}-${stripped.slice(4)}`;
  }

  function randomChars(length = 8){
    let out = '';
    const cryptoApi = g.crypto || null;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function'){
      const buf = new Uint32Array(length);
      cryptoApi.getRandomValues(buf);
      for (let i = 0; i < length; i += 1){
        out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
      }
      return out;
    }
    while (out.length < length){
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  async function generateUniqueInviteCode(db, firestore){
    for (let i = 0; i < 8; i += 1){
      const code = `${CODE_PREFIX}-${randomChars(4)}-${randomChars(4)}`;
      const ref = firestore.doc(db, 'workspaceInvites', code);
      const snap = await firestore.getDoc(ref);
      if (!snap.exists()) return code;
    }
    throw { code:'invite/code-collision', message:'No se pudo generar un código libre. Vuelve a intentarlo.' };
  }

  function sortMembers(list = [], currentUserId = ''){
    const roleRank = { OWNER:0, ADMIN:1, MIEMBRO:2 };
    return list.slice().sort((a, b) => {
      const aKind = safeText(a.kind) === 'OWNER' ? 'OWNER' : safeText(a.role || 'MIEMBRO');
      const bKind = safeText(b.kind) === 'OWNER' ? 'OWNER' : safeText(b.role || 'MIEMBRO');
      const byRank = (roleRank[aKind] ?? 9) - (roleRank[bKind] ?? 9);
      if (byRank !== 0) return byRank;
      if (a.uid === currentUserId && b.uid !== currentUserId) return -1;
      if (b.uid === currentUserId && a.uid !== currentUserId) return 1;
      const aName = safeText(a.displayName || a.email || a.uid).toLowerCase();
      const bName = safeText(b.displayName || b.email || b.uid).toLowerCase();
      return aName.localeCompare(bName, 'es');
    });
  }

  function countMembers(members = []){
    const active = members.filter((item) => safeText(item.status) === 'ACTIVO');
    return {
      total: members.length,
      activeCount: active.length,
      adminCount: active.filter((item) => safeText(item.role) === 'ADMIN').length,
      memberCount: active.filter((item) => safeText(item.role) === 'MIEMBRO').length
    };
  }

  async function ensureOperationalContext({ requireContext = false, requireAdmin = false } = {}){
    if (g.A33Firebase && typeof g.A33Firebase.boot === 'function'){
      await g.A33Firebase.boot();
    }
    if (g.A33Workspace && typeof g.A33Workspace.refresh === 'function'){
      await g.A33Workspace.refresh({ forceEnsure:false });
    }
    const auth = getAuthStatus();
    const workspace = getWorkspaceStatus();
    const { db, firestore } = getFirebaseHandles();
    if (!auth.isAuthenticated || !auth.user){
      throw { code:'auth/signed-out', message:'Inicia sesión para operar miembros reales.' };
    }
    if (!db || !firestore){
      throw { code:'firestore/not-ready', message:'Firestore no está listo todavía.' };
    }
    if (requireContext && !workspace.hasContext){
      throw { code: workspace.code || 'workspace/no-context', message: workspace.message || 'No hay contexto activo para este usuario.' };
    }
    if (requireAdmin && safeText(workspace.role) !== 'ADMIN'){
      throw { code:'members/not-admin', message:'Solo un ADMIN puede gestionar miembros o códigos de unión.' };
    }
    return { auth, workspace, db, firestore };
  }

  async function refresh(){
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const auth = getAuthStatus();
      const workspaceBefore = getWorkspaceStatus();
      if (!auth.isAuthenticated || !auth.user){
        return setState(buildBaseState());
      }

      setState({ code:'loading', label:'Cargando miembros', message:'Leyendo miembros reales del espacio compartido…', isBusy:true, error:null });

      try{
        const { workspace, db, firestore } = await ensureOperationalContext({ requireContext:false, requireAdmin:false });
        if (!workspace.hasContext || !workspace.currentWorkspaceId){
          return setState({
            ...buildBaseState(),
            code: 'no-context',
            label: 'Sin contexto activo',
            message: workspace.message || 'No hay un espacio activo para listar miembros.',
            isBusy: false,
            error: workspace.error || null,
            workspace: clone(workspace.workspace || null),
            currentWorkspaceId: safeText(workspace.currentWorkspaceId || (workspace.workspace && workspace.workspace.id)),
            canManage: safeText(workspace.role) === 'ADMIN',
            role: safeText(workspace.role),
            currentUserId: safeText(auth.user.uid)
          });
        }

        const workspaceRef = firestore.doc(db, 'workspaces', workspace.currentWorkspaceId);
        const membersRef = firestore.collection(db, 'workspaces', workspace.currentWorkspaceId, 'members');
        const [workspaceSnap, membersSnap] = await Promise.all([
          firestore.getDoc(workspaceRef),
          firestore.getDocs(membersRef)
        ]);

        const workspaceDoc = normalizeWorkspaceDoc(workspace.currentWorkspaceId, workspaceSnap.exists() ? (workspaceSnap.data() || {}) : (workspace.workspace || {}));
        const members = [];
        membersSnap.forEach((docSnap) => {
          const member = normalizeMemberDoc(docSnap.id, docSnap.data() || {});
          if (member.uid === safeText(auth.user.uid)){
            if (!member.email) member.email = safeText(auth.user.email);
            if (!member.displayName) member.displayName = safeText(auth.user.displayName) || safeText(workspace.profile && workspace.profile.displayName);
          }
          members.push(member);
        });

        const sortedMembers = sortMembers(members, safeText(auth.user.uid));
        const counts = countMembers(sortedMembers);
        return setState({
          code: 'ready',
          label: 'Miembros listos',
          message: 'Miembros reales cargados desde Firestore.',
          isBusy: false,
          isAuthenticated: true,
          hasContext: true,
          canManage: safeText(workspace.role) === 'ADMIN',
          role: safeText(workspace.role),
          currentUserId: safeText(auth.user.uid),
          currentWorkspaceId: safeText(workspace.currentWorkspaceId),
          workspace: workspaceDoc,
          members: sortedMembers,
          counts,
          activeJoinCode: safeText(workspaceDoc.activeJoinCode),
          activeJoinRole: safeText(workspaceDoc.activeJoinRole) || 'MIEMBRO',
          activeJoinStatus: safeText(workspaceDoc.activeJoinStatus),
          error: null
        });
      }catch(error){
        const base = buildBaseState();
        return setState({
          ...base,
          code: base.hasContext ? 'error' : 'no-context',
          label: base.hasContext ? 'Miembros con error' : 'Sin contexto activo',
          message: safeText(error && error.message) || 'No se pudo cargar la lista real de miembros.',
          isBusy: false,
          error: { code: safeText(error && error.code) || 'members/error', message: safeText(error && error.message) || 'No se pudo cargar la lista real de miembros.' }
        });
      }
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function createJoinCode(payload = {}){
    const role = safeText(payload.role) === 'ADMIN' ? 'ADMIN' : 'MIEMBRO';
    const { auth, workspace, db, firestore } = await ensureOperationalContext({ requireContext:true, requireAdmin:true });
    const workspaceRef = firestore.doc(db, 'workspaces', workspace.currentWorkspaceId);
    const workspaceSnap = await firestore.getDoc(workspaceRef);
    const workspaceData = workspaceSnap.exists() ? (workspaceSnap.data() || {}) : {};
    const previousCode = safeText(workspaceData.activeJoinCode);
    const newCode = await generateUniqueInviteCode(db, firestore);
    const batch = firestore.writeBatch(db);

    if (previousCode){
      batch.set(firestore.doc(db, 'workspaceInvites', previousCode), {
        status: 'REVOCADA',
        revokedAt: firestore.serverTimestamp(),
        updatedAt: firestore.serverTimestamp()
      }, { merge:true });
    }

    batch.set(firestore.doc(db, 'workspaceInvites', newCode), {
      code: newCode,
      workspaceId: workspace.currentWorkspaceId,
      workspaceName: safeText((workspace.workspace || {}).name || workspaceData.name),
      role,
      status: 'ACTIVA',
      kind: 'JOIN_CODE',
      createdBy: safeText(auth.user.uid),
      createdByEmail: safeText(auth.user.email),
      createdAt: firestore.serverTimestamp(),
      updatedAt: firestore.serverTimestamp()
    }, { merge:true });

    batch.set(workspaceRef, {
      activeJoinCode: newCode,
      activeJoinRole: role,
      activeJoinStatus: 'ACTIVA',
      activeJoinUpdatedAt: firestore.serverTimestamp(),
      updatedAt: firestore.serverTimestamp()
    }, { merge:true });

    await batch.commit();
    const next = await refresh();
    return { ok:true, code:newCode, state:setState({ ...next, lastInviteCode:newCode }) };
  }

  async function revokeActiveJoinCode(){
    const { workspace, db, firestore } = await ensureOperationalContext({ requireContext:true, requireAdmin:true });
    const activeCode = safeText((workspace.workspace || {}).activeJoinCode || workspace.activeJoinCode);
    if (!activeCode){
      return { ok:false, error:{ code:'invite/no-active-code', message:'No hay un código activo para revocar.' }, state:getStatusSync() };
    }
    const batch = firestore.writeBatch(db);
    batch.set(firestore.doc(db, 'workspaces', workspace.currentWorkspaceId), {
      activeJoinCode: firestore.deleteField(),
      activeJoinRole: firestore.deleteField(),
      activeJoinStatus: 'REVOCADA',
      activeJoinUpdatedAt: firestore.serverTimestamp(),
      updatedAt: firestore.serverTimestamp()
    }, { merge:true });
    batch.set(firestore.doc(db, 'workspaceInvites', activeCode), {
      status: 'REVOCADA',
      revokedAt: firestore.serverTimestamp(),
      updatedAt: firestore.serverTimestamp()
    }, { merge:true });
    await batch.commit();
    return { ok:true, state:await refresh() };
  }

  async function redeemJoinCode(rawCode = ''){
    const code = normalizeInviteCode(rawCode);
    if (!code){
      return { ok:false, error:{ code:'invite/invalid-code', message:'Escribe un código válido con formato A33-XXXX-XXXX.' }, state:getStatusSync() };
    }
    const { auth, db, firestore } = await ensureOperationalContext({ requireContext:false, requireAdmin:false });
    const uid = safeText(auth.user.uid);
    const email = safeText(auth.user.email);
    const displayName = safeText(auth.user.displayName);

    await firestore.runTransaction(db, async (tx) => {
      const inviteRef = firestore.doc(db, 'workspaceInvites', code);
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists()) throw { code:'invite/not-found', message:'Ese código no existe o ya no está disponible.' };
      const invite = inviteSnap.data() || {};
      if (safeText(invite.status) !== 'ACTIVA') throw { code:'invite/inactive', message:'Ese código ya no está activo.' };
      const workspaceId = safeText(invite.workspaceId);
      if (!workspaceId) throw { code:'invite/bad-workspace', message:'Ese código no apunta a un espacio válido.' };
      const workspaceRef = firestore.doc(db, 'workspaces', workspaceId);
      const workspaceSnap = await tx.get(workspaceRef);
      if (!workspaceSnap.exists()) throw { code:'workspace/not-found', message:'El espacio del código ya no existe.' };
      const memberRef = firestore.doc(db, 'workspaces', workspaceId, 'members', uid);
      const memberSnap = await tx.get(memberRef);
      const existing = memberSnap.exists() ? (memberSnap.data() || {}) : {};
      tx.set(memberRef, {
        uid,
        userId: uid,
        workspaceId,
        role: safeText(invite.role) === 'ADMIN' ? 'ADMIN' : 'MIEMBRO',
        status: 'ACTIVO',
        kind: safeText(existing.kind) || 'MEMBER',
        email,
        displayName,
        inviteCode: code,
        joinedAt: existing.joinedAt || firestore.serverTimestamp(),
        updatedAt: firestore.serverTimestamp(),
        ...(memberSnap.exists() ? {} : { createdAt: firestore.serverTimestamp() })
      }, { merge:true });
      tx.set(firestore.doc(db, 'users', uid), {
        uid,
        email,
        displayName,
        currentWorkspaceId: workspaceId,
        status: 'ACTIVO',
        type: 'USER',
        lastLoginAt: firestore.serverTimestamp(),
        updatedAt: firestore.serverTimestamp(),
        createdAt: firestore.serverTimestamp()
      }, { merge:true });
    });

    if (g.A33Workspace && typeof g.A33Workspace.refresh === 'function'){
      await g.A33Workspace.refresh({ forceEnsure:true });
    }
    return { ok:true, code, state:await refresh() };
  }

  async function updateMemberRole(uid = '', role = 'MIEMBRO'){
    const targetUid = safeText(uid);
    const nextRole = safeText(role) === 'ADMIN' ? 'ADMIN' : 'MIEMBRO';
    if (!targetUid){
      return { ok:false, error:{ code:'member/missing-id', message:'No se encontró el miembro a actualizar.' }, state:getStatusSync() };
    }
    const { workspace, db, firestore } = await ensureOperationalContext({ requireContext:true, requireAdmin:true });
    const memberRef = firestore.doc(db, 'workspaces', workspace.currentWorkspaceId, 'members', targetUid);
    const [memberSnap, membersSnap] = await Promise.all([
      firestore.getDoc(memberRef),
      firestore.getDocs(firestore.collection(db, 'workspaces', workspace.currentWorkspaceId, 'members'))
    ]);
    if (!memberSnap.exists()){
      return { ok:false, error:{ code:'member/not-found', message:'Ese miembro ya no existe.' }, state:getStatusSync() };
    }
    const member = normalizeMemberDoc(targetUid, memberSnap.data() || {});
    const allMembers = [];
    membersSnap.forEach((docSnap) => allMembers.push(normalizeMemberDoc(docSnap.id, docSnap.data() || {})));
    const activeAdmins = allMembers.filter((item) => safeText(item.status) === 'ACTIVO' && safeText(item.role) === 'ADMIN');
    if (safeText(member.kind) === 'OWNER' && nextRole !== 'ADMIN'){
      return { ok:false, error:{ code:'member/owner-fixed', message:'El propietario original debe conservar rol ADMIN.' }, state:getStatusSync() };
    }
    if (safeText(member.role) === 'ADMIN' && nextRole !== 'ADMIN' && activeAdmins.length <= 1){
      return { ok:false, error:{ code:'member/last-admin', message:'No puedes dejar el espacio sin al menos un ADMIN activo.' }, state:getStatusSync() };
    }
    await firestore.setDoc(memberRef, {
      role: nextRole,
      updatedAt: firestore.serverTimestamp()
    }, { merge:true });
    if (targetUid === safeText((workspace.user || {}).uid || (getAuthStatus().user || {}).uid) && g.A33Workspace && typeof g.A33Workspace.refresh === 'function'){
      await g.A33Workspace.refresh({ forceEnsure:true });
    }
    return { ok:true, state:await refresh() };
  }

  async function removeMember(uid = ''){
    const targetUid = safeText(uid);
    if (!targetUid){
      return { ok:false, error:{ code:'member/missing-id', message:'No se encontró el miembro a remover.' }, state:getStatusSync() };
    }
    const { auth, workspace, db, firestore } = await ensureOperationalContext({ requireContext:true, requireAdmin:true });
    if (targetUid === safeText(auth.user.uid)){
      return { ok:false, error:{ code:'member/remove-self', message:'Por seguridad, no te puedes remover a ti mismo desde aquí.' }, state:getStatusSync() };
    }
    const memberRef = firestore.doc(db, 'workspaces', workspace.currentWorkspaceId, 'members', targetUid);
    const [memberSnap, membersSnap] = await Promise.all([
      firestore.getDoc(memberRef),
      firestore.getDocs(firestore.collection(db, 'workspaces', workspace.currentWorkspaceId, 'members'))
    ]);
    if (!memberSnap.exists()){
      return { ok:false, error:{ code:'member/not-found', message:'Ese miembro ya no existe.' }, state:getStatusSync() };
    }
    const member = normalizeMemberDoc(targetUid, memberSnap.data() || {});
    if (safeText(member.kind) === 'OWNER'){
      return { ok:false, error:{ code:'member/remove-owner', message:'El propietario original no se puede remover desde este cierre final.' }, state:getStatusSync() };
    }
    const allMembers = [];
    membersSnap.forEach((docSnap) => allMembers.push(normalizeMemberDoc(docSnap.id, docSnap.data() || {})));
    const activeAdmins = allMembers.filter((item) => safeText(item.status) === 'ACTIVO' && safeText(item.role) === 'ADMIN');
    if (safeText(member.role) === 'ADMIN' && activeAdmins.length <= 1){
      return { ok:false, error:{ code:'member/last-admin', message:'No puedes remover al último ADMIN activo.' }, state:getStatusSync() };
    }
    await firestore.setDoc(memberRef, {
      status: 'REMOVIDO',
      removedAt: firestore.serverTimestamp(),
      updatedAt: firestore.serverTimestamp()
    }, { merge:true });
    return { ok:true, state:await refresh() };
  }

  function getStatusSync(){
    if (!currentState){
      currentState = buildBaseState();
    }
    return clone(currentState);
  }

  function bindEvents(){
    try{
      if (typeof g.addEventListener !== 'function') return;
      const authEventName = (g.A33Auth && g.A33Auth.EVENT_NAME) || 'a33-auth-state';
      const workspaceEventName = (g.A33Workspace && g.A33Workspace.EVENT_NAME) || 'a33-workspace-state';
      g.addEventListener(authEventName, () => { refresh().catch(() => {}); });
      g.addEventListener(workspaceEventName, () => { refresh().catch(() => {}); });
    }catch(_){ }
  }

  bindEvents();
  currentState = buildBaseState();

  g.A33Members = {
    EVENT_NAME,
    normalizeInviteCode,
    getStatusSync,
    refresh,
    createJoinCode,
    revokeActiveJoinCode,
    redeemJoinCode,
    updateMemberRole,
    removeMember
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
