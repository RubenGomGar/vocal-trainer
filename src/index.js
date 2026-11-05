// Resonar · Worker «vocal»
// /api/yt        → título y canal de un vídeo de YouTube (oEmbed). 403 = el autor no deja insertarlo.
// /api/feedback  → POST comentario de un usuario (se guarda en KV 12 meses)
// /api/log       → POST informe de error de JavaScript (se guarda en KV 30 días)
// /api/ping      → POST «uso hoy» (identificador anónimo, una vez al día) para contar usuarios activos (KV 60 días)
// /api/interest  → POST prueba de interés en Premium (aún no se vende): puerta, precio visto, respuesta, email con permiso (KV 12 meses)
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
      if (p === '/api/ping') return await ping(req, env);
      if (p === '/api/interest') return await interest(req, env);
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

// Solo el límite nativo por minuto (no gasta escrituras de KV): para peticiones frecuentes y pequeñas
async function quickLimited(env, kind, ip) {
  if (!env.RL) return false;
  try { const { success } = await env.RL.limit({ key: kind + ':' + ip }); return !success } catch { return false }
}
const UID = /^[a-z0-9]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function ctxOf(c) {
  c = c && typeof c === 'object' ? c : {};
  return { ver: str(c.ver, 20), pwa: !!c.pwa, demo: !!c.demo, sex: ['M', 'F', 'X'].includes(c.sex) ? c.sex : '', days: Math.max(0, Math.min(9999, +c.days || 0)), mods: Math.max(0, Math.min(99, +c.mods || 0)) };
}

/* ---------- usuarios activos ---------- */
async function ping(req, env) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!env.RESONAR) return new Response(null, { status: 204 });
  if (!sameOrigin(req)) return json({ error: 'origin' }, 403);
  const b = await readJson(req, 1500);
  if (!b || !UID.test(b.uid || '')) return json({ error: 'bad_body' }, 400);
  if (await quickLimited(env, 'png', ipOf(req))) return new Response(null, { status: 204 });
  const c = ctxOf(b.ctx), day = new Date().toISOString().slice(0, 10);
  await env.RESONAR.put(`act:${day}:${b.uid}`, '', { expirationTtl: 60 * 86400, metadata: { ...c, country: req.cf && req.cf.country || null } });
  return new Response(null, { status: 204 });
}

/* ---------- interés en Premium ---------- */
const PM_DOORS = ['ai', 'rate', 'spec', 'set'], PM_PRICES = [299, 499, 999], PM_REASONS = ['caro', 'nouso', 'suscr', 'otro'];
async function interest(req, env) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!env.RESONAR) return json({ error: 'kv_missing' }, 503);
  if (!sameOrigin(req)) return json({ error: 'origin' }, 403);
  const b = await readJson(req, 2000);
  if (!b || !UID.test(b.uid || '') || !PM_DOORS.includes(b.door) || !PM_PRICES.includes(b.price) || !['view', 'yes', 'no'].includes(b.choice)) return json({ error: 'bad_body' }, 400);
  if (await quickLimited(env, 'int', ipOf(req))) return json({ error: 'rate' }, 429);
  const key = `int:${b.uid}:${b.door}`;
  const old = await env.RESONAR.get(key, 'json');
  if (old && b.choice === 'view') return json({ ok: true }); // ya contestó en esta puerta: no se pisa la respuesta
  let email = str(b.email, 200).trim();
  if (!(email && EMAIL.test(email) && b.consent === true)) email = '';
  const reason = PM_REASONS.includes(b.reason) ? b.reason : '';
  const date = new Date().toISOString();
  const rec = {
    ...(old || {}), uid: b.uid, door: b.door, price: b.price, choice: b.choice, date, first: (old && old.first) || date,
    ctx: ctxOf(b.ctx), country: req.cf && req.cf.country || null
  };
  if (b.choice === 'yes') rec.reason = ''; else if (reason) rec.reason = reason;
  if (email) { rec.email = email; rec.consent = date }
  await env.RESONAR.put(key, JSON.stringify(rec), {
    expirationTtl: 365 * 86400,
    metadata: { door: rec.door, price: rec.price, choice: rec.choice, reason: rec.reason || '', email: !!rec.email, demo: rec.ctx.demo, days: rec.ctx.days }
  });
  return json({ ok: true });
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

const NAV = '<p><a href="?kind=fb">Comentarios</a> · <a href="?kind=err">Errores</a> · <a href="?kind=int">Interés Premium</a> · <a href="?salir">Salir</a>';
async function listAll(env, prefix, max = 20000) {
  const out = []; let cursor;
  do { const r = await env.RESONAR.list({ prefix, cursor, limit: 1000 }); out.push(...r.keys); cursor = r.list_complete ? null : r.cursor } while (cursor && out.length < max);
  return out;
}
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
const eur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';
const DOOR_N = { ai: 'Canta conmigo (IA, MP3)', rate: 'Califica tu voz', spec: 'Módulos de especialización', set: 'Ajustes' };
const REASON_N = { caro: 'Es caro', nouso: 'No lo usaría', suscr: 'Prefiero suscripción', otro: 'Otro' };

async function adminInterest(env, url) {
  const now = Date.now(), d28 = new Date(now - 27 * 864e5).toISOString().slice(0, 10), d7 = new Date(now - 6 * 864e5).toISOString().slice(0, 10);
  // activos: claves act:<día>:<uid> (sin modo demo)
  const act = await listAll(env, 'act:');
  const a28 = new Set(), a7 = new Set(), a3d = new Set(), byDay = {};
  for (const k of act) {
    const [, day, uid] = k.name.split(':'); const m = k.metadata || {};
    if (m.demo || day < d28) continue;
    a28.add(uid); if (day >= d7) a7.add(uid); if ((m.days || 0) >= 3) a3d.add(uid);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  // interés: claves int:<uid>:<puerta>
  const ik = (await listAll(env, 'int:')).filter(k => !(k.metadata && k.metadata.demo));
  const doors = {}, prices = {}, reasons = {}, seenU = new Set(), yesU = new Set();
  for (const k of ik) {
    const [, uid, door] = k.name.split(':'); const m = k.metadata || {};
    const d = doors[door] = doors[door] || { seen: 0, yes: 0, no: 0 }; d.seen++; if (m.choice === 'yes') d.yes++; if (m.choice === 'no') d.no++;
    seenU.add(uid); if (m.choice === 'yes') yesU.add(uid);
    if (m.choice === 'no' && m.reason) reasons[m.reason] = (reasons[m.reason] || 0) + 1;
    const p = prices[m.price] = prices[m.price] || { seen: new Set(), yes: new Set() }; p.seen.add(uid); if (m.choice === 'yes') p.yes.add(uid);
  }
  const mailKeys = ik.filter(k => k.metadata && k.metadata.email).map(k => k.name);
  const mails = (await Promise.all(mailKeys.slice(0, 500).map(k => env.RESONAR.get(k, 'json')))).filter(Boolean).sort((a, b) => a.date < b.date ? 1 : -1);
  const priceRows = Object.keys(prices).sort((a, b) => a - b).map(p => ({ price: +p, seen: prices[p].seen.size, yes: prices[p].yes.size, pct: pct(prices[p].yes.size, prices[p].seen.size) }));
  const out = {
    active28: a28.size, active7: a7.size, active28With3Days: a3d.size, opened: seenU.size, wants: yesU.size,
    wantsOfActive28: pct(yesU.size, a28.size), wantsOfOpened: pct(yesU.size, seenU.size),
    doors, prices: priceRows, reasons, byDay,
    emails: mails.map(r => ({ email: r.email, door: r.door, price: r.price, date: r.date, days: r.ctx && r.ctx.days }))
  };
  if (url.searchParams.get('format') === 'json') return new Response(JSON.stringify(out), { headers: { ...JSON_H, 'x-robots-tag': 'noindex' } });
  const days = Object.keys(byDay).sort().reverse().slice(0, 14);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Resonar · Interés Premium</title>${STYLE}
<h1>Interés en Premium</h1>
${NAV} · <a href="?kind=int&format=json">JSON</a></p>
<p><small>Sin contar el modo demo. «Lo quiero» = pulsó «Lo quiero» en alguna puerta. Premium aún no se vende.</small></p>
<table>
<tr><td>Usuarios activos (28 días)</td><td><b>${out.active28}</b> <small>· 7 días: ${out.active7} · con ≥ 3 días de práctica: ${out.active28With3Days}</small></td></tr>
<tr><td>Han abierto Premium</td><td><b>${out.opened}</b></td></tr>
<tr><td>Dicen «Lo quiero»</td><td><b>${out.wants}</b> <small>· ${out.wantsOfActive28} % de los activos · ${out.wantsOfOpened} % de quienes lo abrieron</small></td></tr>
<tr><td>Emails para avisar</td><td><b>${mails.length}</b></td></tr>
</table>
<h2>Por puerta</h2><table><tr><td><b>Puerta</b></td><td><b>Abierta</b></td><td><b>Lo quiero</b></td><td><b>Ahora no</b></td></tr>
${Object.entries(doors).map(([k, d]) => `<tr><td>${esc(DOOR_N[k] || k)}</td><td>${d.seen}</td><td>${d.yes} <small>(${pct(d.yes, d.seen)} %)</small></td><td>${d.no}</td></tr>`).join('') || '<tr><td>Nada todavía.</td></tr>'}</table>
<h2>Por precio (pago único)</h2><table><tr><td><b>Precio</b></td><td><b>Lo vieron</b></td><td><b>Lo quieren</b></td></tr>
${priceRows.map(r => `<tr><td>${eur(r.price)}</td><td>${r.seen}</td><td>${r.yes} <small>(${r.pct} %)</small></td></tr>`).join('') || '<tr><td>Nada todavía.</td></tr>'}</table>
<h2>Por qué «ahora no»</h2><table>${Object.entries(reasons).map(([k, n]) => `<tr><td>${esc(REASON_N[k] || k)}</td><td>${n}</td></tr>`).join('') || '<tr><td>Nadie ha dado motivo.</td></tr>'}</table>
<h2>Emails (con permiso, solo para avisar del lanzamiento)</h2><table>${mails.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(DOOR_N[r.door] || r.door)}</td><td>${eur(r.price)}</td><td><small>${esc(r.date.slice(0, 10))} · ${esc(r.ctx && r.ctx.days || 0)} días de práctica</small></td></tr>`).join('') || '<tr><td>Ninguno todavía.</td></tr>'}</table>
<h2>Activos por día</h2><table>${days.map(d => `<tr><td>${esc(d)}</td><td>${byDay[d]}</td></tr>`).join('') || '<tr><td>Nada todavía.</td></tr>'}</table>`;
  return new Response(html, { headers: ADM_H });
}

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
  if (url.searchParams.get('kind') === 'int') return await adminInterest(env, url);
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
${NAV} · <a href="?kind=${kind}&format=json">JSON</a></p>
<table>${rows.join('') || '<tr><td>Nada todavía.</td></tr>'}</table>`;
  return new Response(html, { headers: ADM_H });
}
