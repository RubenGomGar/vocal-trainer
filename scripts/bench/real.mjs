// Grabaciones reales del modo diagnóstico (bench/real/*.wav + *.json, carpeta privada, no se publica).
// Recalcula la cadena actual sobre el audio y compara con lo que vio el móvil.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { APP } from './app.mjs';
const { yin2, hz2m, median, PV, pvReset, pvUpdate } = APP;
const dir = new URL('../../bench/real/', import.meta.url);
function readWav(buf) { const sr = buf.readUInt32LE(24), n = buf.readUInt32LE(40) / 2, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768; return { x, sr } }
if (!existsSync(dir)) { console.log('No hay grabaciones en bench/real/ todavía. Graba desde Laboratorio → Diagnóstico y copia los archivos ahí.'); process.exit(0) }
const rows = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.wav'))) {
  const { x, sr } = readWav(readFileSync(new URL(f, dir))); pvReset(); const hop = Math.round(sr / 100), mh = [], out = [];
  for (let end = 4096; end <= x.length; end += hop) { const b = x.subarray(end - 4096, end); let s = 0; for (let i = 2048; i < 4096; i++) s += b[i] * b[i]; const rms = Math.sqrt(s / 2048);
    const r = rms > .0015 ? yin2(b, sr, PV.disp != null && PV.hist.length >= 12 ? PV.disp : null) : null; let m = r && r.f > 62 && r.f < 1600 ? hz2m(r.f) : null;
    mh.push(m); if (mh.length > 3) mh.shift(); const v = mh.filter(q => q != null); if (m != null && v.length >= 2) { const md = median(v); if (Math.abs(m - md) > 1.5) m = md }
    pvUpdate(m, end / sr, r ? r.conf : 0); out.push({ m, d: PV.disp }) }
  const dv = out.filter(o => o.d != null), js = []; for (let i = 1; i < dv.length; i++) if (Math.abs(dv[i].d - dv[i - 1].d) < .5) js.push((dv[i].d - dv[i - 1].d) * 100);
  const sd = a => { if (a.length < 2) return 0; const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) };
  const meta = existsSync(new URL(f.replace('.wav', '.json'), dir)) ? JSON.parse(readFileSync(new URL(f.replace('.wav', '.json'), dir))) : {};
  rows.push({ toma: f, móvil: (meta.ua || '').match(/iPhone|iPad|Android|Mac|Windows/)?.[0] || '?', 'lecturas/s en el móvil': meta.rate, 'fps pantalla': meta.fps, 'con voz %': +(out.filter(o => o.m != null).length / out.length * 100).toFixed(1), 'temblor c (10 ms)': +sd(js).toFixed(2) })
}
console.table(rows);
