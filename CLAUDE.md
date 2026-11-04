# Resonar (vocal-trainer) · instrucciones para Claude

App web de entrenamiento vocal en español, un solo `public/index.html` (HTML+CSS+JS sin dependencias), servida por un Cloudflare Worker.

- Ramas: `develop` → Worker `vocal-staging` (beta) · `main` → Worker `vocal` (público). La GitHub Action `deploy.yml` despliega en cada push.
- Trabaja siempre en `develop`. Pasa a `main` solo cuando Ruben lo pida o lo haya autorizado.
- Antes de commitear: `node scripts/check.mjs` y `node scripts/build.mjs staging` deben pasar.
- **Nunca** añadas `Content-Security-Policy` en `public/_headers`: deja la app en negro.
- No edites `dist/` (se genera). Datos por entorno en `site.config.json`.
- Nuevos módulos de ejercicios: añadir a `NEW_MODULES` y su id a `MOD_ORDER`; nota en «Califica tu voz» en `rateTake()`.
- Prueba con Playwright en viewport de móvil y modo demo (`localStorage rsn_prefs = {"demo":"1"}`), sin errores en consola.
- Textos de la interfaz en español de España, tono cercano.
- Comentarios y errores de usuarios: `/api/admin?key=ADMIN_KEY&kind=fb|err&format=json` (KV `RESONAR`).
