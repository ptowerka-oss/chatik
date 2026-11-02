// Чатик — сервер. Без внешних зависимостей: нужен только Node.js 18+.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const WWW_DIR = path.join(__dirname, '..', 'www');

// ---------- хранилище (один JSON-файл) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: {}, tokens: {}, chats: {}, nextMsgId: 1 };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* первый запуск */ }

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  saveTimer = null;
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) { console.error('Не удалось сохранить базу:', e.message); }
}
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
process.on('SIGINT', () => { saveNow(); process.exit(0); });

const loginIndex = {}; // login(lowercase) -> id
for (const u of Object.values(db.users)) loginIndex[u.login.toLowerCase()] = u.id;
const peersOf = {};    // id -> Set(id)  с кем есть переписка
for (const key of Object.keys(db.chats)) {
  const [a, b] = key.split('_');
  (peersOf[a] = peersOf[a] || new Set()).add(b);
  (peersOf[b] = peersOf[b] || new Set()).add(a);
}

// ---------- утилиты ----------
const chatKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const now = () => Date.now();

function newUserId() {
  for (;;) {
    const id = String(crypto.randomInt(1000000, 10000000)); // 7 цифр
    if (!db.users[id]) return id;
  }
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function checkPassword(pw, stored) {
  const [s, h] = stored.split(':');
  const hash = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(h, 'hex'));
}
function newToken(userId) {
  const t = crypto.randomBytes(32).toString('hex');
  db.tokens[t] = { userId, created: now() };
  return t;
}

// ---------- онлайн (SSE-подключения) ----------
const conns = {}; // userId -> Set(res)
const isOnline = id => !!(conns[id] && conns[id].size);

function publicUser(u) {
  return { id: u.id, name: u.name, online: isOnline(u.id), lastSeen: u.lastSeen || 0 };
}
function me(u) {
  return { id: u.id, login: u.login, name: u.name };
}
function push(userId, event) {
  const set = conns[userId];
  if (!set) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) { try { res.write(line); } catch (e) { /* закроется само */ } }
}
function broadcastPresence(u) {
  const ev = { type: 'presence', user: publicUser(u) };
  for (const p of peersOf[u.id] || []) push(p, ev);
}

// ---------- ограничение попыток входа ----------
const attempts = {};
function tooMany(ip) {
  const a = attempts[ip];
  return a && a.count >= 15 && now() - a.first < 10 * 60 * 1000;
}
function fail(ip) {
  const a = attempts[ip];
  if (!a || now() - a.first > 10 * 60 * 1000) attempts[ip] = { count: 1, first: now() };
  else a.count++;
}
setInterval(() => { for (const k of Object.keys(attempts)) if (now() - attempts[k].first > 600000) delete attempts[k]; }, 600000).unref();

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Слишком большой запрос'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('Неверный формат запроса'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}
function authUser(req, url) {
  let t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t) t = url.searchParams.get('token') || '';
  const rec = db.tokens[t];
  return rec ? db.users[rec.userId] : null;
}

const LOGIN_RE = /^[A-Za-z0-9_.\-Ѐ-ӿ]{3,20}$/;
const IMG_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function lastMsg(key) { const a = db.chats[key]; return a && a.length ? a[a.length - 1] : null; }

async function api(req, res, url) {
  const route = req.method + ' ' + url.pathname;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  // --- регистрация / вход ---
  if (route === 'POST /api/register') {
    const b = await readBody(req);
    const login = String(b.login || '').trim(), pw = String(b.password || ''), pw2 = String(b.password2 || '');
    if (!LOGIN_RE.test(login)) return send(res, 400, { error: 'Логин: 3–20 символов, буквы, цифры, _ . -' });
    if (pw.length < 4) return send(res, 400, { error: 'Пароль минимум 4 символа' });
    if (pw.length > 100) return send(res, 400, { error: 'Пароль слишком длинный' });
    if (pw !== pw2) return send(res, 400, { error: 'Пароли не совпадают' });
    if (loginIndex[login.toLowerCase()]) return send(res, 409, { error: 'Такой логин уже занят' });
    const id = newUserId();
    const u = db.users[id] = { id, login, name: login, pass: hashPassword(pw), created: now(), lastSeen: now() };
    loginIndex[login.toLowerCase()] = id;
    const token = newToken(id);
    save();
    return send(res, 200, { token, user: me(u) });
  }
  if (route === 'POST /api/login') {
    if (tooMany(ip)) return send(res, 429, { error: 'Слишком много попыток, подождите несколько минут' });
    const b = await readBody(req);
    const id = loginIndex[String(b.login || '').trim().toLowerCase()];
    const u = id && db.users[id];
    if (!u || !checkPassword(String(b.password || ''), u.pass)) { fail(ip); return send(res, 401, { error: 'Неверный логин или пароль' }); }
    const token = newToken(id);
    save();
    return send(res, 200, { token, user: me(u) });
  }

  // --- всё остальное требует входа ---
  const user = authUser(req, url);
  if (!user) return send(res, 401, { error: 'Нужно войти заново' });

  if (route === 'GET /api/events') { // поток событий (SSE)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\ndata: {"type":"hello"}\n\n');
    const set = conns[user.id] = conns[user.id] || new Set();
    const wasOnline = set.size > 0;
    set.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    req.on('close', () => {
      clearInterval(ping);
      set.delete(res);
      if (!set.size) { user.lastSeen = now(); save(); broadcastPresence(user); }
    });
    if (!wasOnline) broadcastPresence(user);
    return;
  }

  if (route === 'GET /api/me') return send(res, 200, { user: me(user) });

  if (route === 'PATCH /api/me') {
    const b = await readBody(req);
    if (b.name !== undefined) {
      const name = String(b.name).trim().replace(/\s+/g, ' ');
      if (name.length < 1 || name.length > 30) return send(res, 400, { error: 'Имя: от 1 до 30 символов' });
      user.name = name;
    }
    if (b.newPassword !== undefined) {
      if (!checkPassword(String(b.oldPassword || ''), user.pass)) return send(res, 400, { error: 'Старый пароль неверный' });
      if (String(b.newPassword).length < 4) return send(res, 400, { error: 'Новый пароль минимум 4 символа' });
      if (b.newPassword !== b.newPassword2) return send(res, 400, { error: 'Новые пароли не совпадают' });
      user.pass = hashPassword(String(b.newPassword));
    }
    save();
    broadcastPresence(user);
    return send(res, 200, { user: me(user) });
  }

  if (route === 'POST /api/logout') {
    const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    delete db.tokens[t]; save();
    return send(res, 200, { ok: true });
  }

  // --- поиск по ID ---
  let m = url.pathname.match(/^\/api\/users\/(\d{1,12})$/);
  if (m && req.method === 'GET') {
    const u = db.users[m[1]];
    if (!u) return send(res, 404, { error: 'Пользователь с таким ID не найден' });
    return send(res, 200, { user: publicUser(u) });
  }

  // --- список чатов ---
  if (route === 'GET /api/chats') {
    const out = [];
    for (const p of peersOf[user.id] || []) {
      const key = chatKey(user.id, p);
      const msgs = db.chats[key] || [];
      if (!msgs.length) continue;
      let unread = 0;
      for (const x of msgs) if (x.to === user.id && !x.read) unread++;
      out.push({ peer: publicUser(db.users[p]), last: msgs[msgs.length - 1], unread });
    }
    out.sort((a, b) => b.last.ts - a.last.ts);
    return send(res, 200, { chats: out });
  }

  // --- сообщения ---
  m = url.pathname.match(/^\/api\/messages\/(\d{1,12})$/);
  if (m && req.method === 'GET') {
    const peer = db.users[m[1]];
    if (!peer) return send(res, 404, { error: 'Пользователь не найден' });
    const all = db.chats[chatKey(user.id, peer.id)] || [];
    const before = parseInt(url.searchParams.get('before')) || Infinity;
    const after = parseInt(url.searchParams.get('after')) || 0;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 60, 200);
    let list;
    if (after) list = all.filter(x => x.id > after);
    else { list = all.filter(x => x.id < before); list = list.slice(-limit); }
    const hasMore = !after && all.length && list.length && all[0].id < list[0].id;
    return send(res, 200 , { peer: publicUser(peer), messages: list, hasMore: !!hasMore });
  }

  if (route === 'POST /api/messages') {
    const b = await readBody(req);
    const to = db.users[String(b.to)];
    if (!to) return send(res, 404, { error: 'Пользователь не найден' });
    if (to.id === user.id) return send(res, 400, { error: 'Нельзя писать самому себе' });
    const type = b.type || 'text';
    const msg = { id: db.nextMsgId++, cid: String(b.cid || '').slice(0, 40), from: user.id, to: to.id, type, ts: now(), read: false };
    if (type === 'text') {
      const text = String(b.text || '').slice(0, 4000);
      if (!text.trim()) return send(res, 400, { error: 'Пустое сообщение' });
      msg.text = text;
    } else if (type === 'sticker' || type === 'image') {
      const data = String(b.data || '');
      const max = type === 'sticker' ? 500000 : 2500000;
      if (!IMG_RE.test(data) || data.length > max) return send(res, 400, { error: 'Картинка не подходит или слишком большая' });
      msg.data = data;
      if (type === 'image' && b.text) msg.text = String(b.text).slice(0, 1000);
    } else return send(res, 400, { error: 'Неизвестный тип сообщения' });

    const key = chatKey(user.id, to.id);
    (db.chats[key] = db.chats[key] || []).push(msg);
    (peersOf[user.id] = peersOf[user.id] || new Set()).add(to.id);
    (peersOf[to.id] = peersOf[to.id] || new Set()).add(user.id);
    save();
    const ev = { type: 'message', message: msg };
    push(to.id, ev); push(user.id, ev);
    return send(res, 200, { message: msg });
  }

  m = url.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (m && req.method === 'DELETE') {
    const id = parseInt(m[1]);
    for (const p of peersOf[user.id] || []) {
      const key = chatKey(user.id, p);
      const arr = db.chats[key] || [];
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) {
        if (arr[i].from !== user.id) return send(res, 403, { error: 'Можно удалять только свои сообщения' });
        arr.splice(i, 1); save();
        const ev = { type: 'deleted', id, a: user.id, b: p };
        push(user.id, ev); push(p, ev);
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Сообщение не найдено' });
  }

  if (route === 'POST /api/read') {
    const b = await readBody(req);
    const peer = db.users[String(b.peer)];
    if (!peer) return send(res, 404, { error: 'Пользователь не найден' });
    let changed = false;
    for (const x of db.chats[chatKey(user.id, peer.id)] || []) if (x.to === user.id && !x.read) { x.read = true; changed = true; }
    if (changed) { save(); push(peer.id, { type: 'read', by: user.id }); push(user.id, { type: 'read', by: user.id, mine: true }); }
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/typing') {
    const b = await readBody(req);
    if (db.users[String(b.to)]) push(String(b.to), { type: 'typing', from: user.id });
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Не найдено' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(WWW_DIR, p));
  if (!file.startsWith(WWW_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true, users: Object.keys(db.users).length });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.code ? e.message : 'Ошибка сервера' });
    if (!e.code) console.error(e);
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`Чатик запущен на порту ${PORT}`));
