import { CASES, runCase } from './pitch.mjs';
import { SONGS, runSong } from './melody.mjs';
console.log('== Detector de tono (100 lecturas/s, estabilizador normal) ==');
console.table(CASES.map(c => ({ caso: c.label, ...runCase(c.o) })));
console.log('== Extractor de melodía (Canta conmigo) ==');
const rows = []; for (const s of SONGS) rows.push({ canción: s.label, ...(await runSong(s.o)) }); console.table(rows);
await import('./sep.mjs');
await import('./real.mjs');
