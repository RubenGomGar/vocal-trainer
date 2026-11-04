// Carga las funciones REALES de public/index.html (sin copiarlas) para que el banco mida lo que se publica.
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
function grabFunction(name) {
  const re = new RegExp(`(?:async )?function ${name}\\(`); const m = re.exec(html); if (!m) throw new Error('No encuentro ' + name);
  let j = m.index + m[0].length, pd = 1; for (; j < html.length && pd; j++) { if (html[j] === '(') pd++; else if (html[j] === ')') pd-- }
  let i = html.indexOf('{', j), depth = 0, str = null;
  for (; i < html.length; i++) { const ch = html[i];
    if (str) { if (ch === '\\') { i++; continue } if (ch === str) str = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; continue }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return html.slice(m.index, i + 1) } }
  throw new Error('Sin cierre: ' + name)
}
function grabLine(start) { const i = html.indexOf(start); if (i < 0) throw new Error('No encuentro ' + start); return html.slice(i, html.indexOf('\n', i)) }
const src = [
  grabLine('const median='), grabLine('const hz2m='), grabLine('const clamp='),
  'const prefs={stab:"medio"};',
  grabLine('const YB='), grabFunction('yin2'), grabLine('const STAB_WIN='), grabLine('const PV='), grabFunction('pvReset'), grabFunction('pvUpdate'),
  grabFunction('melFFT'), grabFunction('extractMelodyLR'),
  'return {median,hz2m,m2hz,yin2,PV,pvReset,pvUpdate,prefs,extractMelodyLR,STAB_WIN};'
].join('\n');
export const APP = new Function(src)();
