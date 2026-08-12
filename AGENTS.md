# AGENTS

## Reglas permanentes de trabajo
- Puedes analizar, modificar y probar archivos locales del proyecto.
- Nunca ejecutes `git push` sin autorización explícita del usuario.
- Nunca despliegues, publiques ni envíes cambios a producción sin autorización explícita del usuario.
- No borres `localStorage`, IndexedDB ni datos existentes salvo instrucción expresa del usuario.
- No agregues dependencias nuevas sin autorización explícita del usuario.
- No reconstruyas innecesariamente la aplicación.
- Trabaja por etapas pequeñas, cerrables y verificables.
- Antes de cerrar una etapa, ejecuta las pruebas disponibles y reporta el resultado.
- Mantén compatibilidad histórica con los datos existentes.
- Protege la lógica de PWA, Service Worker, Firebase y caché; modifica estos elementos solo cuando corresponda al objetivo de la etapa.
- No hagas cambios fuera del alcance solicitado.
- Si una acción puede ser destructiva, irreversible o afectar datos, detente y pide autorización antes de ejecutarla.
- Puedes preparar cambios y commits locales, pero no hagas `git push` sin autorización explícita del usuario.
- Mantén siempre la aplicación funcional al cierre de cada etapa.
- No borres ni sobrescribas archivos históricos o de respaldo salvo instrucción expresa del usuario.

## Repo shape (no build system)
- This is a static multi-module web app: root `index.html` links to module folders (`pos/`, `inventario/`, `lotes/`, `pedidos/`, `agenda/`, `finanzas/`, `catalogos/`, `analitica/`, `configuracion/`, `centro-mando/`, etc.).
- Shared runtime utilities live in `assets/js/` (notably `a33-storage.js`, `a33-theme.js`, `a33-release.js`). Most modules are plain HTML/CSS/JS, no bundler.
- `functions/` is a separate Firebase Functions project (Node 20, entrypoint `functions/src/index.js`).

## Canonical paths and legacy trap
- Use `centro-mando/` as canonical. `centro_mando/index.html` is a legacy redirect/cleanup page; do not implement new features there.

## Firebase deploy reality
- Source of truth is `firebase.json`.
- Hosting deploy target is `hosting.public = "pruebas"` (not repo root).
- Firestore config is root-level `firestore.rules` + `firestore.indexes.json`.
- Functions source is `functions/` with runtime `nodejs20`.

## Commands you can actually run
- From repo root, deploy pieces with Firebase CLI: `firebase deploy --only hosting`, `firebase deploy --only functions`, `firebase deploy --only firestore:rules,firestore:indexes`.
- In `functions/`: `npm run serve` (functions emulator), `npm run deploy`, `npm run logs`.
- `functions/npm run lint` is a placeholder (`echo "Sin lint configurado"`); do not assume lint/test/typecheck automation exists.

## Versioning + cache coherence (easy to break)
- Cache/version values are hardcoded and duplicated across module HTML and service workers via `?v=...&r=...` query params.
- `assets/js/a33-release.js` is the SW/UI release source (`suiteVersion`, `rev`). If you change asset versions or SW precache lists, update related `?v/&r` references and module `sw.js` precache entries together.
- Service workers are module-scoped (`pos/sw.js`, `inventario/sw.js`, `lotes/sw.js`, `pedidos/sw.js`, `catalogos/sw.js`, `centro_mando/sw.js`) and intentionally avoid cross-module cache deletion.

## Storage conventions that affect cross-module behavior
- Shared storage prefixes are `arcano33_`, `a33_`, `suite_a33_` (see `assets/js/a33-storage.js`). New persisted keys should follow these prefixes to remain compatible with backup/cleanup tooling.
