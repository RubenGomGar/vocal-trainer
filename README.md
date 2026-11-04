# Resonar · entrenamiento vocal

App web (un solo `index.html`) servida por el Cloudflare Worker **vocal**.

| Rama | Despliega en | Worker | KV |
|---|---|---|---|
| `develop` | beta (staging) | `vocal-staging` | `resonar-staging` |
| `main` | público | `vocal` | `resonar` |

## Estructura
- `public/` — la app: `index.html`, `sw.js`, `manifest.webmanifest`, `privacidad.html`, iconos, `og-image.jpg`, `_headers`.
- `src/index.js` — Worker: `/api/yt`, `/api/feedback`, `/api/log`, `/api/admin`.
- `scripts/build.mjs` — genera `dist/` con versión automática, URL y datos legales de `site.config.json`.
- `scripts/check.mjs` — comprueba que el JS compila, que no hay CSP y que está `#boot`.

## Puesta en marcha (una vez)
1. `npm install`
2. Secretos del panel: `npx wrangler secret put ADMIN_KEY` y `npx wrangler secret put ADMIN_KEY --env staging`
3. En GitHub → Settings → Secrets and variables → Actions:
   - `CLOUDFLARE_API_TOKEN` (plantilla «Edit Cloudflare Workers»)
   - `CLOUDFLARE_ACCOUNT_ID` (Panel de Cloudflare → Workers & Pages, columna derecha)
4. Rellena `site.config.json`: `siteUrl`, `owner`, `email` y `analytics` de cada entorno.
5. Dominio: descomenta `routes` en `wrangler.jsonc` (y el de staging) y pon tu dominio en `siteUrl`.

## Día a día
- Trabaja en `develop` → push → se publica la beta.
- Cuando esté bien: merge a `main` → push → se publica la versión pública.
- La versión (`APP_VER` y la caché del service worker) se pone sola en cada build.
- Probar en local: `npm run dev` (http://localhost:8787).
- A mano, sin GitHub: `npm run deploy:staging` o `npm run deploy`.

## Ver comentarios y errores
`https://TU-DOMINIO/api/admin?key=TU_ADMIN_KEY` (y en la beta con su propia clave).

## Reglas
- **No** añadas `Content-Security-Policy` en `_headers`: la app se queda en negro.
- No edites `dist/`: se regenera en cada build.

## Checklist antes de abrir al público
- [ ] iPhone · Safari: abrir, Añadir a pantalla de inicio, abrir desde el icono, conceder micro, hacer un ejercicio.
- [ ] iPhone: modo avión → abrir desde el icono → la app carga (sin YouTube).
- [ ] iPhone: al día siguiente, el progreso sigue ahí.
- [ ] Android · Chrome: aviso «Instala Resonar» → Instalar → abre a pantalla completa.
- [ ] iPad horizontal: «Canta conmigo» a dos columnas con un vídeo de YouTube.
- [ ] Exportar copia en un móvil e importarla en otro.
- [ ] Enviar un comentario y verlo en `/api/admin`.
- [ ] Pegar el enlace en WhatsApp: sale imagen, título y descripción.
- [ ] Publicar una versión nueva y comprobar que el móvil la coge al reabrir (Ajustes → número de versión en el pie de inicio).
- [ ] Privacidad y Aviso legal con tu nombre y contacto.
