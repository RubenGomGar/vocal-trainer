// Banco del separador de voz (Open-Unmix en el dispositivo) + extractor de melodía
// Compara el extractor sobre la mezcla y sobre la voz separada (con la misma puerta de energía que la app, aiGate),
// en las canciones sintéticas de melody.mjs. Ojo: Open-Unmix se entrenó con música real; aquí la voz es sintética.
import { readFileSync } from 'node:fs';
import { synthSong } from './song.mjs';
import { APP } from './app.mjs';
import { SONGS } from './melody.mjs';
const sep = await import('../../public/ai/sep.mjs');
const root = new URL('../../public/ai/', import.meta.url);
const sess = await sep.createSession(readFileSync(new URL('umxhq-vocals.f16w.onnx', root)), readFileSync(new URL('ort/ort-wasm-simd-threaded.wasm', root)));
function score(song, ref) {
  let vT = 0, hit = 0, fa = 0, unv = 0;
  for (let k = 0; k < ref.m.length; k++) { const i = Math.floor((ref.t0 + k * ref.hop) * song.sr); if (i >= song.truth.length) break; const tr = song.truth[i], m = ref.m[k];
    if (!isNaN(tr)) { vT++; if (!isNaN(m)) { const f = (((m - tr) % 12) + 18) % 12 - 6; if (Math.abs(f) <= .5) hit++ } } else { unv++; if (!isNaN(m)) fa++ } }
  return [+(hit / vT * 100).toFixed(1), +(fa / Math.max(1, unv) * 100).toFixed(1)];
}
const rows = [];
for (const s of SONGS) {
  const song = synthSong(s.o);
  const a = score(song, await APP.extractMelodyLR(song, {}, null));
  const t0 = Date.now(), v = await sep.separate(sess, song.L, song.R), ms = Date.now() - t0;
  const b = score(song, APP.aiGate(await APP.extractMelodyLR({ L: v.L, R: v.R, sr: song.sr }, {}, null), v, song.sr));
  rows.push({ canción: s.label, 'mezcla %': a[0], 'voz separada %': b[0], 'falsas mezcla %': a[1], 'falsas separada %': b[1], 'separar (s/min)': +(ms / 1000 / (song.L.length / song.sr / 60)).toFixed(1) });
}
console.log('Separación de voz + extractor (acierto ignorando octava)'); console.table(rows);
