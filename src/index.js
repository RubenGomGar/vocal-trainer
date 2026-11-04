// Resonar · Worker «vocal»
// /api/yt        → título y canal de un vídeo de YouTube (oEmbed). 403 = el autor no deja insertarlo.
// /api/feedback  → POST comentario de un usuario (se guarda en KV 12 meses)
// /api/log       → POST informe de error de JavaScript (se guarda en KV 30 días)
// /api/admin     → panel de comentarios o errores. Se entra con la clave en un formulario (POST) y queda una cookie
//                  HttpOnly de 12 h; la clave nunca va en la URL. Máx. 10 intentos fallidos por hora e IP.
// El resto lo sirven los static assets (public/).

const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...JSON_H, ...extra } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === '/api/yt') return await yt(url);
      if (p === '/api/feedback') return await feedback(req, env);
      if (p === '/api/log') return await log(req, env);
      if (p === '/api/admin') return await admin(req, url, env);
      if (p.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'server' }, 500);
    }
    return env.ASSETS.fetch(req);
  }
};

/* ---------- YouTube ---------- */
async function yt(url) {
  const id = url.searchParams.get('id') || '';
  if (!/^[\w-]{11}$/.test(id)) return json({ error: 'bad_id' }, 400);
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, {
    cf: { cacheTtl: 86400, cacheEverything: true }
  });
  if (r.status === 401 || r.status === 403) return json({ error: 'not_embeddable' }, 403);
  if (!r.ok) return json({ error: 'not_found' }, 404);
  const j = await r.json();
  return json({ title: j.title || '', author: j.author_name || '' }, 200, { 'cache-control': 'public, max-age=86400' });
}

/* ---------- utilidades ---------- */
function sameOrigin(req) {
  const o = req.headers.get('origin');
  if (!o) return true; // sendBeacon/keepalive en algunos navegadores no la manda
  try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
}
async function readJson(req, max) {
  const len = +(req.headers.get('content-length') || 0);
  if (len > max) return null;
  const txt = await req.text();
  if (txt.length > max) return null;
  try { return JSON.parse(txt); } catch { return null; }
}
const str = (x, n) => (typeof x === 'string' ? x : x == null ? '' : String(x)).slice(0, n);
const ipOf = req => req.headers.get('cf-connecting-ip') || 'x';
const rid = () => crypto.randomUUID().slice(0, 8);

// Límite sencillo por IP y hora (KV es eventual: aproximado, suficiente contra abusos)
async function limited(env, kind, ip, max) {
  // 1) límite nativo de Workers por minuto (no gasta escrituras de KV); 2) límite por hora en KV
  if (env.RL) { try { const { success } = await env.RL.limit({ key: kind + ':' + ip }); if (!success) return true } catch { } }
  const hour = new Date().toISOString().slice(0, 13);
  const k = `rl:${kind}:${hour}:${ip}`;
  const n = +(await env.RESONAR.get(k)) || 0;
  if (n >= max) return true;
  await env.RESONAR.put(k, String(n + 1), { expirationTtl: 3700 });
  return false;
}

/* ---------- comentarios ---------- */
async function feedback(req, env) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!env.RESONAR) return json({ error: 'kv_missing' }, 503);
  if (!sameOrigin(req)) return json({ error: 'origin' }, 403);
  const b = await readJson(req, 8000);
  if (!b) return json({ error: 'bad_body' }, 400);
  const text = str(b.text, 4000).trim();
  if (text.length < 3) return json({ error: 'empty' }, 400);
  const type = ['idea', 'bug', 'otro'].includes(b.type) ? b.type : 'otro';
  let email = str(b.email, 200).trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';
  if (await limited(env, 'fb', ipOf(req), 10)) return json({ error: 'rate' }, 429);
  const t = b.tech && typeof b.tech === 'object' ? b.tech : {};
  const tech = {
    ver: str(t.ver, 20), ua: str(t.ua, 200), vw: str(t.vw, 20), scr: str(t.scr, 30),
    pwa: !!t.pwa, demo: !!t.demo, sex: str(t.sex, 2),
    errs: Array.isArray(t.errs) ? t.errs.slice(0, 3).map(x => str(x, 200)) : []
  };
  const date = new Date().toISOString();
  const rec = { date, type, text, email: email || null, tech, country: req.cf && req.cf.country || null };
  await env.RESONAR.put(`fb:${date}:${rid()}`, JSON.stringify(rec), {
    expirationTtl: 365 * 86400,
    metadata: { type, preview: text.slice(0, 90), email: !!email }
  });
  return json({ ok: true });
}

/* ---------- errores ---------- */
async function log(req, env) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!env.RESONAR) return new Response(null, { status: 204 });
  if (!sameOrigin(req)) return json({ error: 'origin' }, 403);
  const b = await readJson(req, 3000);
  if (!b) return json({ error: 'bad_body' }, 400);
  if (await limited(env, 'err', ipOf(req), 30)) return new Response(null, { status: 204 });
  const date = new Date().toISOString();
  const rec = {
    date, msg: str(b.msg, 300), src: str(b.src, 120), line: +b.line || 0, stack: str(b.stack, 800),
    scr: str(b.scr, 30), ver: str(b.ver, 20), ua: str(b.ua, 200), vw: str(b.vw, 20), pwa: !!b.pwa,
    country: req.cf && req.cf.country || null
  };
  await env.RESONAR.put(`err:${date}:${rid()}`, JSON.stringify(rec), {
    expirationTtl: 30 * 86400,
    metadata: { msg: rec.msg.slice(0, 90), scr: rec.scr, ver: rec.ver }
  });
  return new Response(null, { status: 204 });
}

/* ---------- panel ---------- */
function eq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ADM_H = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
const STYLE = '<style>body{font:14px system-ui;margin:16px;background:#14122b;color:#f4f2ff}a{color:#a17dff}table{border-collapse:collapse;width:100%}td{border-top:1px solid #3a3570;padding:8px;vertical-align:top}small{color:#aaa4d8}input,button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #3a3570;background:#1b1838;color:#f4f2ff}button{background:#a17dff;border:0;color:#14122b;font-weight:600}</style>';
async function sha(text) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('') }
// cookie = hora de caducidad + firma (SHA-256 de clave + caducidad): no guarda la clave y caduca sola
async function makeToken(env, exp) { return exp + '.' + await sha('resonar-admin|' + env.ADMIN_KEY + '|' + exp) }
async function validToken(env, tok) { const [exp] = String(tok || '').split('.'); if (!/^\d+$/.test(exp) || +exp < Date.now()) return false; return eq(tok, await makeToken(env, exp)) }
const cookieOf = req => (req.headers.get('cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === 'rsn_admin')?.[1];
function loginPage(msg) { return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resonar · Panel</title>${STYLE}<h1>Panel de Resonar</h1>${msg ? `<p style="color:#ff6b7a">${esc(msg)}</p>` : ''}<form method="post"><input type="password" name="key" placeholder="Clave del panel" autocomplete="current-password" required autofocus> <button>Entrar</button></form>`, { status: msg ? 401 : 200, headers: ADM_H }) }

async function admin(req, url, env) {
  if (!env.ADMIN_KEY) return new Response('Panel desactivado', { status: 503, headers: ADM_H });
  if (!env.RESONAR) return new Response('Falta el KV RESONAR', { status: 503, headers: ADM_H });
  const ip = ipOf(req), failKey = `rl:adm:${new Date().toISOString().slice(0, 13)}:${ip}`;
  if (url.searchParams.has('key')) return new Response('La clave ya no va en la dirección: entra con el formulario en /api/admin', { status: 400, headers: ADM_H });
  if (req.method === 'POST') {
    const fails = +(await env.RESONAR.get(failKey)) || 0;
    if (fails >= 10) return loginPage('Demasiados intentos. Prueba dentro de una hora.');
    const form = await req.formData().catch(() => null), key = form ? String(form.get('key') || '') : '';
    if (!eq(key, env.ADMIN_KEY)) { await env.RESONAR.put(failKey, String(fails + 1), { expirationTtl: 3700 }); return loginPage('Clave incorrecta.') }
    const exp = Date.now() + 12 * 3600e3;
    return new Response(null, { status: 303, headers: { location: '/api/admin', 'set-cookie': `rsn_admin=${await makeToken(env, exp)}; Path=/api/admin; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`, 'cache-control': 'no-store' } });
  }
  if (url.searchParams.get('salir') != null) return new Response(null, { status: 303, headers: { location: '/api/admin', 'set-cookie': 'rsn_admin=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict' } });
  if (!(await validToken(env, cookieOf(req)))) return loginPage('');
  const kind = url.searchParams.get('kind') === 'err' ? 'err' : 'fb';
  const list = await env.RESONAR.list({ prefix: kind + ':', limit: 1000 });
  const keys = list.keys.map(k => k.name).sort().reverse().slice(0, 150);
  const recs = (await Promise.all(keys.map(k => env.RESONAR.get(k, 'json')))).filter(Boolean);
  if (url.searchParams.get('format') === 'json') return new Response(JSON.stringify(recs), { headers: { ...JSON_H, 'x-robots-tag': 'noindex' } });
  const rows = kind === 'fb'
    ? recs.map(r => `<tr><td>${esc(r.date.slice(0, 16).replace('T', ' '))}</td><td>${esc({ idea: '💡', bug: '🐞', otro: '💬' }[r.type])}</td><td style="white-space:pre-wrap">${esc(r.text)}</td><td>${esc(r.email || '')}</td><td><small>${esc(r.tech && r.tech.ver || '')} · ${esc(r.tech && r.tech.vw || '')} · ${esc(r.tech && r.tech.scr || '')}${r.tech && r.tech.pwa ? ' · app' : ''}<br>${esc(r.tech && r.tech.ua || '')}</small></td></tr>`)
    : recs.map(r => `<tr><td>${esc(r.date.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.msg)}<br><small>${esc(r.src)}:${esc(r.line)}</small></td><td>${esc(r.scr)}</td><td><small>${esc(r.ver)} · ${esc(r.vw)}${r.pwa ? ' · app' : ''}<br>${esc(r.ua)}</small></td></tr>`);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resonar · ${kind === 'fb' ? 'Comentarios' : 'Errores'}</title>${STYLE}
<h1>${kind === 'fb' ? 'Comentarios' : 'Errores'} (${recs.length})</h1>
<p><a href="?kind=fb">Comentarios</a> · <a href="?kind=err">Errores</a> · <a href="?kind=${kind}&format=json">JSON</a> · <a href="?salir">Salir</a></p>
<table>${rows.join('') || '<tr><td>Nada todavía.</td></tr>'}</table>`;
  return new Response(html, { headers: ADM_H });
}
