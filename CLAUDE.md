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
- Comentarios y errores de usuarios: panel `/api/admin` (formulario con la clave → cookie `rsn_admin` de 12 h; `?kind=fb|err&format=json`). Nunca pongas la clave en una URL.
- Detector de tono: `yin2` corre en un AudioWorklet (100 lecturas/s, `PW`), con respaldo al AnalyserNode (`prefs.engine`). Lectura estable para pantalla: `PV`/`pvUpdate`; la puntuación usa `m` crudo.
- Banco de pruebas: `npm run bench` (carga las funciones reales de `public/index.html`). Tras tocar el detector, el estabilizador o el extractor de melodía, compáralo antes/después y no empeores ninguna fila.
- Grabaciones reales: Laboratorio → Diagnóstico → «Grabar 10 s» descarga `.wav` + `.json`; se copian en `bench/real/` (ignorada por git, privada) y `node scripts/bench/real.mjs` las analiza.
- Seguridad: todo lo que venga de localStorage, de una copia importada o de una API se escapa con `esc()` antes de ir a `innerHTML`. La importación pasa por `bkSanitize` (lista blanca `BK_KEYS`); si añades claves nuevas a `LS`, añádelas ahí.
- La fuente Fredoka se sirve desde `public/fonts/` (sin Google Fonts). Acciones de GitHub fijadas por SHA; al actualizarlas, fija el SHA nuevo.
- Separación de voz con IA («Canta conmigo»): `public/ai/sep.mjs` (worker de módulo) con Open-Unmix umxhq vocals (`public/ai/umxhq-vocals.f16w.onnx`, MIT) sobre onnxruntime-web (`public/ai/ort/`). Se descarga una vez y se guarda en Cache Storage `rsn-ai-v1` (si cambias el modelo o ORT, cambia el nombre del archivo o `CACHE`). El service worker no toca `/ai/`. Cada archivo estático debe pesar < 25 MiB (límite de Workers). El modelo se exporta con el workflow de la rama `tools/modelo-voz`. Banco: `node scripts/bench/sep.mjs`.
