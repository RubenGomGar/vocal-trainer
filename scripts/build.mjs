// Copia public/ → dist/ e inyecta versión, URL del sitio y datos del titular según el entorno.
// Uso: node scripts/build.mjs [production|staging]   (por defecto production)
import { readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';

const env = process.argv[2] || process.env.RESONAR_ENV || 'production';
const all = JSON.parse(readFileSync('site.config.json', 'utf8'));
const cfg = all[env];
if (!cfg) { console.error(`Entorno desconocido: ${env}`); process.exit(1); }

// Versión: fecha + commit corto (o hora si no hay git)
const d = new Date();
const pad = n => String(n).padStart(2, '0');
let sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : '';
if (!sha) { try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { } }
const version = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}-${sha || pad(d.getUTCHours()) + pad(d.getUTCMinutes())}${env === 'staging' ? '-beta' : ''}`;
const site = String(cfg.siteUrl || '').replace(/\/+$/, '');

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });

const must = (s, re, what) => { if (!re.test(s)) { console.error(`No encuentro ${what}`); process.exit(1); } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// index.html
let html = readFileSync('dist/index.html', 'utf8');
must(html, /const APP_VER='[^']*';/, 'APP_VER');
must(html, /const CFG=\{[^;]*\};/, 'CFG');
html = html
  .replace(/const APP_VER='[^']*';/, `const APP_VER='${version}';`)
  .replace(/const CFG=\{[^;]*\};/, `const CFG=${JSON.stringify({ owner: cfg.owner || '', email: cfg.email || '', analytics: cfg.analytics || '' })};`)
  .replaceAll('%%SITE_URL%%', site)
  .replace('<!--%%ENV_HEAD%%-->', env === 'staging'
    ? '<meta name="robots" content="noindex,nofollow">'
    : '');
if (env === 'staging') html = html.replace('<title>Resonar · Entrenamiento vocal</title>', '<title>[Beta] Resonar · Entrenamiento vocal</title>');
writeFileSync('dist/index.html', html);

// sw.js
let sw = readFileSync('dist/sw.js', 'utf8');
must(sw, /const VERSION = '[^']*';/, 'VERSION en sw.js');
writeFileSync('dist/sw.js', sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));

// privacidad.html
const owner = cfg.owner || 'El responsable de Resonar';
const contact = cfg.email ? `<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a> o el formulario «Danos tu opinión» de la app` : 'el formulario «Danos tu opinión» de la app';
let priv = readFileSync('dist/privacidad.html', 'utf8');
priv = priv.replaceAll('El responsable de Resonar', esc(owner)).replaceAll('el formulario «Danos tu opinión» de la app', contact);
if (env === 'staging') priv = priv.replace('<head>', '<head><meta name="robots" content="noindex,nofollow">');
writeFileSync('dist/privacidad.html', priv);

// robots.txt
writeFileSync('dist/robots.txt', env === 'staging' ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /api/\n${site ? `Sitemap: ${site}/sitemap.xml\n` : ''}`);
if (env !== 'staging' && site) writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}/</loc></url><url><loc>${site}/privacidad.html</loc></url></urlset>\n`);

const warn = [];
if (!cfg.owner) warn.push('owner vacío (Aviso legal)');
if (!cfg.analytics) warn.push('sin token de analítica');
if (/TU-SUBDOMINIO|TU-DOMINIO/.test(site)) warn.push('siteUrl sin rellenar (vista previa al compartir)');
console.log(`✔ dist/ listo · ${env} · v${version}${warn.length ? '\n⚠ ' + warn.join(' · ') : ''}`);
