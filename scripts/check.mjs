// Comprobaciones rápidas antes de desplegar: que el script de index.html compile y que no haya CSP.
import { readFileSync } from 'node:fs';
const html = readFileSync('public/index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let ok = true;
scripts.forEach((code, i) => { try { new Function(code); } catch (e) { ok = false; console.error(`✖ Script inline ${i + 1}: ${e.message}`); } });
for (const f of ['public/_headers']) {
  const h = readFileSync(f, 'utf8');
  if (/^\s*Content-Security-Policy:/mi.test(h)) { ok = false; console.error(`✖ ${f} tiene Content-Security-Policy (deja la app en negro)`); }
}
if (!/id="boot"/.test(html)) { ok = false; console.error('✖ Falta #boot en index.html'); }
const sw = readFileSync('public/sw.js', 'utf8');
if (!/const VERSION = '[^']*';/.test(sw)) { ok = false; console.error('✖ sw.js sin VERSION'); }
if (!ok) process.exit(1);
console.log(`✔ ${scripts.length} scripts inline compilan · sin CSP · #boot presente`);
