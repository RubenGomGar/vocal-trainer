// Banco del detector de tono: voces sintéticas → misma cadena que la app (yin2 a 100 lecturas/s + mediana de 3 + PV)
import { synthVoice } from './voice.mjs';
import { APP } from './app.mjs';
const { yin2, hz2m, median, PV, pvReset, pvUpdate, prefs } = APP;
export const CASES = [
  { label: 'Chico grave Do3 · móvil', o: { m: 48.35, lowcut: 150, snr: 22 } },
  { label: 'Chico La2 · móvil', o: { m: 45.4, lowcut: 150, snr: 22, vowel: 'u' } },
  { label: 'Chico Sol3 recto', o: { m: 55.3, snr: 25 } },
  { label: 'Chico Sol3 vibrato', o: { m: 55.3, vib: 90, snr: 25 } },
  { label: 'Chica La4 recto', o: { m: 69.4, snr: 25 } },
  { label: 'Chica La4 vibrato ancho', o: { m: 69.4, vib: 120, snr: 25, vowel: 'i' } },
  { label: 'Chica Mi5 ruido', o: { m: 76.4, snr: 14 } },
  { label: 'Entre dos notas (+45 c)', o: { m: 60.45, snr: 25 } },
  { label: 'Chica Do6', o: { m: 84.3, snr: 22 } },
  { label: 'Chico Mi2 · móvil', o: { m: 40.3, lowcut: 150, snr: 20 } },
  { label: 'Vibrato lento y ancho', o: { m: 62.2, vib: 160, vibRate: 4.2, snr: 22 } },
  { label: 'Voz soplada', o: { m: 64.3, breath: .5, snr: 16, shimmer: .2, jitter: .012 } },
];
export function runCase(o, { hopS = .01, stab = 'medio' } = {}) {
  const { x, center, sr } = synthVoice(o); prefs.stab = stab; pvReset();
  const hop = Math.round(sr * hopS), mh = [], res = []; let t0 = performance.now();
  for (let end = 4096; end <= x.length; end += hop) {
    const buf = x.subarray(end - 4096, end), t = end / sr;
    const r = yin2(buf, sr, PV.disp != null && PV.hist.length >= 12 ? PV.disp : null);
    let m = r && r.f > 62 && r.f < 1600 ? hz2m(r.f) : null;
    mh.push(m); if (mh.length > 3) mh.shift(); const v = mh.filter(q => q != null); if (m != null && v.length >= 2) { const md = median(v); if (Math.abs(m - md) > 1.5) m = md }
    pvUpdate(m, t, r ? r.conf : 0); res.push({ t, m, disp: PV.disp, note: PV.disp != null ? PV.note : null, tc: center[end - 1300] })
  }
  const ms = (performance.now() - t0) / res.length, st = res.filter(r => r.t > .5), dv = st.filter(r => r.disp != null), target = Math.round(o.m);
  let flips = 0, prev = null; for (const r of dv) { if (prev != null && r.note !== prev) flips++; prev = r.note }
  const jit = []; for (let i = 1; i < dv.length; i++) jit.push((dv[i].disp - dv[i - 1].disp) * 100);
  const sd = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) };
  const err = dv.map(r => Math.abs(r.disp - r.tc) * 100).sort((a, b) => a - b);
  return { 'saltos/s': +(flips / (st.length * hopS)).toFixed(2), 'nota mal %': +(dv.filter(r => r.note !== target).length / dv.length * 100).toFixed(1),
    'temblor c': +(sd(jit) * Math.sqrt(hopS / (1 / 60))).toFixed(2), 'err50 c': +err[err.length >> 1].toFixed(1), 'octava %': +(st.filter(r => r.m != null && Math.abs(r.m - r.tc) > 6).length / st.length * 100).toFixed(1),
    'sin voz %': +(st.filter(r => r.m == null).length / st.length * 100).toFixed(1), 'ms/lectura': +ms.toFixed(2) }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Detector · 100 lecturas/s · estabilizador «normal»');
  console.table(CASES.map(c => ({ caso: c.label, ...runCase(c.o) })));
}
