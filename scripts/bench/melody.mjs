// Banco del extractor de melodía (Canta conmigo): canción sintética con voz, bajo, acordes y batería
import { synthSong } from './song.mjs';
import { APP } from './app.mjs';
export const SONGS = [
  { label: 'Voz clara + base suave', o: { voiceGain: 1.2, bassGain: .6, padGain: .4, drums: .15 } },
  { label: 'Mezcla normal', o: {} },
  { label: 'Base fuerte (voz baja)', o: { voiceGain: .6, bassGain: 1, padGain: .9, drums: .35 } },
  { label: 'Acordes al centro', o: { center: true, voiceGain: .9, padGain: .8 } },
  { label: 'Tonalidad grave', o: { key: 45 } },
  { label: 'Solo voz', o: { bassGain: 0, padGain: 0, drums: 0 } },
];
export async function runSong(o) {
  const song = synthSong(o), t0 = Date.now(), ref = await APP.extractMelodyLR(song, {}, null);
  let vT = 0, hit = 0, fa = 0, unv = 0;
  for (let k = 0; k < ref.m.length; k++) { const i = Math.floor((ref.t0 + k * ref.hop) * song.sr); if (i >= song.truth.length) break; const tr = song.truth[i], m = ref.m[k];
    if (!isNaN(tr)) { vT++; if (!isNaN(m)) { const f = (((m - tr) % 12) + 18) % 12 - 6; if (Math.abs(f) <= .5) hit++ } } else { unv++; if (!isNaN(m)) fa++ } }
  return { 'acierto (ignorando octava) %': +(hit / vT * 100).toFixed(1), 'notas falsas en huecos %': +(fa / Math.max(1, unv) * 100).toFixed(1), ms: Date.now() - t0 }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = []; for (const s of SONGS) rows.push({ canción: s.label, ...(await runSong(s.o)) });
  console.log('Extractor de melodía de la voz'); console.table(rows);
}
