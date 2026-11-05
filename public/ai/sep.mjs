// Resonar · separación de voz en el dispositivo (Web Worker de módulo)
// Open-Unmix «umxhq», objetivo vocals (Stöter et al., 2019; pesos MIT), exportado a ONNX.
// Entrada: { L, R } Float32Array a 44 100 Hz. Salida: la voz estimada { L, R } a 44 100 Hz.
// STFT 4096 / salto 1024, Hann, center=True (como torch.stft), magnitud → modelo → máscara suave
// (voz / mezcla) sobre el espectro complejo → iSTFT. Por trozos de ~16 s con fundido, para que la
// memoria no dependa de la duración de la canción.
import * as ort from './ort/ort.wasm.min.mjs';

const MODEL = 'umxhq-vocals.f16w.onnx';           // se versiona con CACHE si cambia
const WASM = 'ort/ort-wasm-simd-threaded.wasm';
const CACHE = 'rsn-ai-v1';
const SR = 44100, N = 4096, HOP = 1024, BINS = N / 2 + 1;
const CHUNK = 16 * SR, OVL = 2 * SR;                // trozos de 16 s que se solapan 2 s

const base = new URL('./', import.meta.url).href;
let session = null;

// Descarga una vez y guarda en Cache Storage (fuera de la caché del service worker, que se vacía en cada versión)
async function cached(path, onp) {
  const url = base + path;
  let c = null;
  try { c = await caches.open(CACHE); const hit = await c.match(url); if (hit) return await hit.arrayBuffer(); } catch (e) { c = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error('descarga ' + path + ': ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  let buf;
  if (res.body && total && onp) {
    const r = res.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); got += value.length; onp(got / total); }
    buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    buf = buf.buffer;
  } else buf = await res.arrayBuffer();
  if (c) try { await c.put(url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* sin espacio: seguimos */ }
  return buf;
}

async function load(post) {
  if (session) return session;
  post({ stage: 'load', p: 0 });
  ort.env.wasm.wasmPaths = base + 'ort/';
  let pw = 0, pm = 0; const rep = () => post({ stage: 'load', p: .3 * pw + .7 * pm });
  const [wasm, model] = await Promise.all([cached(WASM, p => { pw = p; rep(); }), cached(MODEL, p => { pm = p; rep(); })]);
  session = await createSession(model, wasm);
  return session;
}

// ---- FFT real de tamaño N (radix-2, tablas precalculadas)
const win = new Float32Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
const rev = new Uint32Array(N), cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
{ const bits = Math.log2(N); for (let i = 0; i < N; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = Math.sin(2 * Math.PI * i / N); } }
function fft(re, im, inv) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const c = cosT[k], s = inv ? sinT[k] : -sinT[k], a = i + j, b = a + half;
      const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
const reflect = (i, n) => { const p = 2 * (n - 1); i = ((i % p) + p) % p; return i < n ? i : p - i; };

// STFT centrada (reflect) de x → { re, im } [T][BINS] planos
function stft(x) {
  const n = x.length, T = 1 + Math.floor(n / HOP), re = new Float32Array(T * BINS), im = new Float32Array(T * BINS);
  const fr = new Float64Array(N), fi = new Float64Array(N);
  for (let t = 0; t < T; t++) {
    const pos = t * HOP - N / 2;
    for (let i = 0; i < N; i++) { const k = pos + i; fr[i] = (k >= 0 && k < n ? x[k] : x[reflect(k, n)]) * win[i]; fi[i] = 0; }
    fft(fr, fi, false);
    re.set(fr.subarray(0, BINS), t * BINS); im.set(fi.subarray(0, BINS), t * BINS);
  }
  return { re, im, T };
}
// iSTFT (solape-suma con ventana y normalización por la envolvente), longitud n
function istft(re, im, T, n) {
  const out = new Float64Array((T - 1) * HOP + N), env = new Float64Array(out.length), fr = new Float64Array(N), fi = new Float64Array(N);
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < BINS; k++) { fr[k] = re[t * BINS + k]; fi[k] = im[t * BINS + k]; }
    for (let k = BINS; k < N; k++) { fr[k] = fr[N - k]; fi[k] = -fi[N - k]; }
    fft(fr, fi, true);
    const o = t * HOP;
    for (let i = 0; i < N; i++) { out[o + i] += fr[i] / N * win[i]; env[o + i] += win[i] * win[i]; }
  }
  const y = new Float32Array(n), pad = N / 2;
  for (let i = 0; i < n; i++) { const e = env[i + pad]; y[i] = e > 1e-8 ? out[i + pad] / e : 0; }
  return y;
}

async function sepChunk(sess, L, R) {
  const n = L.length, A = stft(L), B = stft(R), T = A.T;
  const mag = new Float32Array(2 * BINS * T);                 // [1, 2, F, T]
  for (const [c, S] of [[0, A], [1, B]]) for (let t = 0; t < T; t++) for (let f = 0; f < BINS; f++) {
    const i = t * BINS + f; mag[c * BINS * T + f * T + t] = Math.hypot(S.re[i], S.im[i]);
  }
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', mag, [1, 2, BINS, T]) });
  const est = out[sess.outputNames[0]].data;
  const res = [];
  for (const [c, S] of [[0, A], [1, B]]) {
    const re = new Float32Array(T * BINS), im = new Float32Array(T * BINS);
    for (let t = 0; t < T; t++) for (let f = 0; f < BINS; f++) {
      const j = c * BINS * T + f * T + t, i = t * BINS + f, m = mag[j], g = m > 1e-9 ? Math.min(1, est[j] / m) : 0;
      re[i] = S.re[i] * g; im[i] = S.im[i] * g;
    }
    res.push(istft(re, im, T, n));
  }
  return res;
}

// Separa la voz de una canción estéreo a 44,1 kHz con una sesión ya creada
export async function separate(sess, L, R, onp) {
  const n = L.length, oL = new Float32Array(n), oR = new Float32Array(n);
  const starts = []; for (let s = 0; s < n; s += CHUNK - OVL) { starts.push(s); if (s + CHUNK >= n) break; }
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k], e2 = Math.min(n, s + CHUNK);
    const [vL, vR] = await sepChunk(sess, L.subarray(s, e2), R.subarray(s, e2));
    const fadeIn = k > 0 ? Math.min(OVL, e2 - s) : 0;
    for (let i = 0; i < e2 - s; i++) {
      if (i < fadeIn) { const w = i / fadeIn; oL[s + i] = oL[s + i] * (1 - w) + vL[i] * w; oR[s + i] = oR[s + i] * (1 - w) + vR[i] * w; }
      else { oL[s + i] = vL[i]; oR[s + i] = vR[i]; }
    }
    if (onp) onp((k + 1) / starts.length);
  }
  return { L: oL, R: oR };
}
export function createSession(model, wasm) {
  if (wasm) ort.env.wasm.wasmBinary = wasm;
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  return ort.InferenceSession.create(model instanceof Uint8Array ? model : new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = async e => {
  const { id, L, R } = e.data, post = m => self.postMessage({ id, ...m });
  try {
    const sess = await load(post), t0 = performance.now();
    const v = await separate(sess, L, R, p => post({ stage: 'sep', p }));
    self.postMessage({ id, done: true, L: v.L, R: v.R, ms: performance.now() - t0 }, [v.L.buffer, v.R.buffer]);
  } catch (err) {
    post({ error: String(err && err.message || err) });
  }
};
