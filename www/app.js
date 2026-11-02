(function () {
'use strict';

/* =========================================================
   Утилиты
   ========================================================= */
const CFG = window.APP_CONFIG || {};
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

function add(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  add(e, kids);
  return e;
}
const $app = document.getElementById('app');
let toastTimer;
function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
const pad2 = n => String(n).padStart(2, '0');
const fmtTime = ts => { const d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
function fmtDay(ts) {
  const d = new Date(ts), n = Date.now();
  if (sameDay(ts, n)) return 'Сегодня';
  if (sameDay(ts, n - 86400000)) return 'Вчера';
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}
function fmtList(ts) {
  const d = new Date(ts);
  if (sameDay(ts, Date.now())) return fmtTime(ts);
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1);
}
function fmtSeen(u) {
  if (!u) return '';
  if (u.online) return 'в сети';
  if (!u.lastSeen) return 'не в сети';
  const d = new Date(u.lastSeen);
  if (sameDay(u.lastSeen, Date.now())) return 'был(а) сегодня в ' + fmtTime(u.lastSeen);
  if (sameDay(u.lastSeen, Date.now() - 86400000)) return 'был(а) вчера в ' + fmtTime(u.lastSeen);
  return 'был(а) ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' в ' + fmtTime(u.lastSeen);
}
function avatarColor(id) { return 'hsl(' + ((parseInt(id, 10) * 47) % 360) + ',55%,52%)'; }
function avatar(u, cls) {
  const d = h('div', { class: 'avatar ' + (cls || ''), style: 'background:' + avatarColor(u.id) }, ((u.name || '?').trim().charAt(0) || '?').toUpperCase());
  if (u.online) d.append(h('span', { class: 'dot' }));
  return d;
}
function copyText(text) {
  const done = () => toast('Скопировано');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
  function fallback() {
    const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.append(t); t.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Не удалось скопировать'); }
    t.remove();
  }
}
function beep() {
  if (!S.settings.sound) return;
  try {
    const ac = beep.ac || (beep.ac = new (window.AudioContext || window.webkitAudioContext)());
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.12);
  } catch (e) {}
}
const isEmojiOnly = t => t && t.length <= 12 && /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s)+$/u.test(t) && /\p{Extended_Pictographic}/u.test(t);

function longPress(el, fn) {
  let t;
  el.addEventListener('touchstart', () => { t = setTimeout(() => { t = null; fn(); }, 550); }, { passive: true });
  const cancel = () => { if (t) clearTimeout(t); t = null; };
  el.addEventListener('touchend', cancel); el.addEventListener('touchmove', cancel); el.addEventListener('touchcancel', cancel);
  el.addEventListener('contextmenu', e => { e.preventDefault(); fn(); });
}

/* =========================================================
   Состояние и настройки
   ========================================================= */
const S = {
  token: null, me: null,
  chats: [], peers: {}, msgs: {}, typing: {},
  online: false,
  settings: Object.assign({ theme: 'light', accent: '#2b7de9', wall: 'none', font: 16, sound: true, server: '' }, lsGet('sc_settings', {})),
  stickers: lsGet('sc_stickers', []),
};
const session = lsGet('sc_session', null);
if (session && session.token) { S.token = session.token; S.me = session.me; }
const saveSettings = () => lsSet('sc_settings', S.settings);

const THEMES = [
  { id: 'auto', name: 'Авто', bg: 'linear-gradient(90deg,#f4f6fa 50%,#18202a 50%)' },
  { id: 'light', name: 'Светлая', bg: '#f4f6fa' },
  { id: 'dark', name: 'Тёмная', bg: '#18202a' },
  { id: 'amoled', name: 'Чёрная', bg: '#000' },
  { id: 'ocean', name: 'Океан', bg: '#13283d' },
  { id: 'sepia', name: 'Сепия', bg: '#fbf4e4' },
];
const ACCENTS = ['#2b7de9', '#e5484d', '#f59e0b', '#16a34a', '#8b5cf6', '#ec4899', '#0ea5a4', '#64748b'];
const WALLS = [
  { id: 'none', name: 'Нет' },
  { id: 'g1', css: 'linear-gradient(160deg,#a8edea,#fed6e3)' },
  { id: 'g2', css: 'linear-gradient(160deg,#667eea,#764ba2)' },
  { id: 'g3', css: 'linear-gradient(160deg,#f6d365,#fda085)' },
  { id: 'g4', css: 'linear-gradient(160deg,#0f2027,#2c5364)' },
  { id: 'g5', css: 'linear-gradient(160deg,#134e5e,#71b280)' },
  { id: 'g6', css: 'linear-gradient(160deg,#ff9a9e,#fad0c4)' },
  { id: 'dots', name: '', css: 'radial-gradient(rgba(127,127,127,.28) 2px,transparent 2.5px)', size: '22px 22px' },
];
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 0;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function applySettings() {
  const s = S.settings, root = document.documentElement;
  let theme = s.theme;
  if (theme === 'auto') theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.style.setProperty('--accent', s.accent);
  const onAcc = luminance(s.accent) > 0.7 ? '#111' : '#fff';
  root.style.setProperty('--on-accent', onAcc);
  root.style.setProperty('--bubble-out-text', onAcc);
  root.style.setProperty('--font', s.font + 'px');
  let wall = 'none', size = 'cover';
  if (s.wall === 'custom') { const img = lsGet('sc_wall_img', null); if (img) wall = 'url(' + img + ')'; }
  else { const w = WALLS.find(x => x.id === s.wall); if (w && w.css) { wall = w.css; size = w.size || 'cover'; } }
  root.style.setProperty('--wall', wall);
  root.style.setProperty('--wall-size', size);
  let meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = s.accent;
}
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

/* =========================================================
   Работа с сервером
   ========================================================= */
function normServer(s) {
  s = (s || '').trim(); if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s.replace(/\/+$/, '');
}
const baseUrl = () => normServer(S.settings.server) || normServer(CFG.server) || location.origin;
const needServer = () => !normServer(S.settings.server) && !normServer(CFG.server) && location.hostname === 'localhost' && !location.port;

async function api(method, path, body, opts) {
  opts = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 45000);
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      method, signal: ctl.signal,
      headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Сервер долго не отвечает' : 'Нет связи с сервером');
  } finally { clearTimeout(timer); }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    if (res.status === 401 && S.token && !opts.noLogout) doLogout(true);
    throw new Error(data.error || 'Ошибка ' + res.status);
  }
  return data;
}

/* =========================================================
   Навигация
   ========================================================= */
let view = { name: '' };
function route() {
  const hsh = location.hash || '#/';
  let m;
  if (!S.token) return { name: 'auth' };
  if ((m = hsh.match(/^#\/chat\/(\d+)$/))) return { name: 'chat', peer: m[1] };
  if (hsh === '#/settings') return { name: 'settings' };
  if (hsh === '#/sticker') return { name: 'sticker' };
  return { name: 'chats' };
}
function depth() { return (history.state && history.state.d) || 0; }
function go(hash, replace) {
  if (replace) history.replaceState({ d: depth() }, '', hash);
  else history.pushState({ d: depth() + 1 }, '', hash);
  render();
}
function back() {
  if (depth() > 0) history.back();
  else go('#/', true);
}
window.addEventListener('popstate', render);

function render() {
  if (view.cleanup) { try { view.cleanup(); } catch (e) {} }
  view = { name: '' };
  $app.innerHTML = '';
  closeOverlays();
  const r = route();
  if (r.name === 'auth') viewAuth();
  else if (r.name === 'chats') viewChats();
  else if (r.name === 'chat') viewChat(r.peer);
  else if (r.name === 'settings') viewSettings();
  else if (r.name === 'sticker') viewSticker();
}
function closeOverlays() { document.querySelectorAll('.overlay').forEach(o => o.remove()); }

/* =========================================================
   Диалоги
   ========================================================= */
function sheet(title, items) {
  closeOverlays();
  const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'sheet' },
      title ? h('h3', null, title) : null,
      items.map(it => h('button', { class: 'item' + (it.danger ? ' danger' : ''), onclick: () => { ov.remove(); it.fn(); } }, it.icon ? h('span', null, it.icon) : null, it.label))));
  document.body.append(ov);
  return ov;
}
function confirmBox(text, okLabel, fn, danger) {
  closeOverlays();
  const ov = h('div', { class: 'overlay modal', onclick: e => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'box' }, h('p', null, text),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => ov.remove() }, 'Отмена'),
        h('button', { class: 'btn' + (danger ? ' danger' : ''), onclick: () => { ov.remove(); fn(); } }, okLabel))));
  document.body.append(ov);
}

/* =========================================================
   Экран входа / регистрации
   ========================================================= */
function viewAuth() {
  let mode = 'login', busy = false;
  const card = h('div', { class: 'auth-card' });
  const screen = h('div', { class: 'screen auth' }, card);
  $app.append(screen);

  const inLogin = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 20 });
  const inPass = h('input', { type: 'password', autocomplete: 'current-password' });
  const inPass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const inServer = h('input', { type: 'text', placeholder: 'https://мой-сервер.onrender.com', value: S.settings.server || '', autocapitalize: 'none', spellcheck: 'false' });
  const err = h('div', { class: 'err' });
  const btn = h('button', { class: 'btn', type: 'submit' });
  const tabL = h('button', { type: 'button', onclick: () => setMode('login') }, 'Вход');
  const tabR = h('button', { type: 'button', onclick: () => setMode('reg') }, 'Регистрация');
  const f2 = h('label', { class: 'field' }, h('span', null, 'Повторите пароль'), inPass2);
  const srvBox = h('label', { class: 'field' + (needServer() ? '' : ' hidden') }, h('span', null, 'Адрес сервера'), inServer);
  const srvLink = h('button', { type: 'button', class: 'link', onclick: () => srvBox.classList.toggle('hidden') }, 'Настройки сервера');

  function setMode(m) {
    mode = m; err.textContent = '';
    tabL.classList.toggle('on', m === 'login'); tabR.classList.toggle('on', m === 'reg');
    f2.classList.toggle('hidden', m === 'login');
    btn.textContent = m === 'login' ? 'Войти' : 'Создать аккаунт';
    inPass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
  }
  card.append(
    h('img', { class: 'logo', src: 'icon.svg', alt: '' }),
    h('h2', null, 'Чатик'),
    h('p', { class: 'sub' }, 'Простой мессенджер для двоих'),
    h('div', { class: 'tabs' }, tabL, tabR),
    h('form', {
      onsubmit: async e => {
        e.preventDefault();
        if (busy) return;
        err.textContent = '';
        if (srvBox.classList.contains('hidden') === false || inServer.value.trim()) {
          S.settings.server = normServer(inServer.value); saveSettings();
        }
        if (needServer()) { err.textContent = 'Укажите адрес сервера (ссылка из инструкции)'; srvBox.classList.remove('hidden'); return; }
        const login = inLogin.value.trim(), password = inPass.value;
        if (!login || !password) { err.textContent = 'Введите логин и пароль'; return; }
        if (mode === 'reg' && password !== inPass2.value) { err.textContent = 'Пароли не совпадают'; return; }
        busy = true; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Подождите…';
        const slow = setTimeout(() => { err.style.color = 'var(--muted)'; err.textContent = 'Сервер просыпается, это может занять до минуты…'; }, 4000);
        try {
          const d = await api('POST', mode === 'login' ? '/api/login' : '/api/register',
            mode === 'login' ? { login, password } : { login, password, password2: inPass2.value }, { timeout: 70000 });
          S.token = d.token; S.me = d.user;
          lsSet('sc_session', { token: d.token, me: d.user });
          startSession();
          go('#/', true);
        } catch (ex) { err.style.color = ''; err.textContent = ex.message; }
        finally { clearTimeout(slow); busy = false; btn.disabled = false; btn.textContent = old; }
      }
    },
      h('label', { class: 'field' }, h('span', null, 'Логин'), inLogin),
      h('label', { class: 'field' }, h('span', null, 'Пароль'), inPass),
      f2, srvBox, err, btn),
    srvLink);
  setMode('login');
}

/* =========================================================
   Сессия, события, синхронизация
   ========================================================= */
let es = null, esTimer = null;
function startSession() {
  S.chats = []; S.msgs = {}; S.peers = {};
  connectEvents();
}
function connectEvents() {
  if (!S.token) return;
  if (es) { es.onopen = es.onmessage = es.onerror = null; es.close(); }
  clearTimeout(esTimer);
  es = new EventSource(baseUrl() + '/api/events?token=' + encodeURIComponent(S.token));
  es.onopen = () => { S.online = true; updateBanner(); syncAll(); };
  es.onmessage = e => { try { handleEvent(JSON.parse(e.data)); } catch (ex) {} };
  es.onerror = () => {
    S.online = false; updateBanner();
    if (es.readyState === 2) { esTimer = setTimeout(connectEvents, 3000); }
  };
}
function stopSession() {
  if (es) { es.onopen = es.onmessage = es.onerror = null; es.close(); es = null; }
  clearTimeout(esTimer);
  S.online = false;
}
function doLogout(silent) {
  const t = S.token;
  stopSession();
  if (t && !silent) fetch(baseUrl() + '/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(() => {});
  S.token = null; S.me = null; S.chats = []; S.msgs = {}; S.peers = {};
  lsSet('sc_session', null);
  history.replaceState({ d: 0 }, '', '#/');
  render();
  if (silent) toast('Нужно войти заново');
}
function updateBanner() {
  const b = document.getElementById('banner');
  if (b) b.classList.toggle('hidden', S.online);
}
function rememberPeer(u) {
  const old = S.peers[u.id] || {};
  S.peers[u.id] = Object.assign(old, u);
  const c = S.chats.find(x => x.peer.id === u.id);
  if (c) c.peer = S.peers[u.id];
}
async function loadChats() {
  try {
    const d = await api('GET', '/api/chats');
    d.chats.forEach(c => { rememberPeer(c.peer); c.peer = S.peers[c.peer.id]; });
    S.chats = d.chats;
    if (view.name === 'chats' && view.drawList) view.drawList();
  } catch (e) {}
}
async function syncAll() {
  await loadChats();
  if (view.name === 'chat') syncChat(view.peer);
}
async function syncChat(peer) {
  const box = S.msgs[peer];
  if (!box) return;
  const real = box.list.filter(m => typeof m.id === 'number');
  const last = real.length ? real[real.length - 1].id : 0;
  try {
    const d = await api('GET', '/api/messages/' + peer + (last ? '?after=' + last : ''));
    rememberPeer(d.peer);
    let changed = false;
    for (const m of d.messages) { const r = addMsg(peer, m); if (r === 'added') changed = true; }
    if (!last && d.messages.length) { box.list = d.messages; changed = true; }
    if (changed && view.name === 'chat' && view.peer === peer) { view.rebuild(); }
    if (view.name === 'chat' && view.peer === peer) { view.updateHeader(); markRead(peer); }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.token) {
    if (!es || es.readyState === 2) connectEvents();
    else syncAll();
  }
});

function peerOfMsg(m) { return m.from === S.me.id ? m.to : m.from; }
function addMsg(peer, m) {
  const box = S.msgs[peer];
  if (!box) return null;
  const i = box.list.findIndex(x => x.id === m.id || (m.cid && x.cid === m.cid));
  if (i >= 0) { Object.assign(box.list[i], m, { pending: false, failed: false }); return 'updated'; }
  box.list.push(m);
  return 'added';
}
function handleEvent(ev) {
  if (ev.type === 'message') {
    const m = ev.message, peer = peerOfMsg(m), incoming = m.to === S.me.id;
    const r = addMsg(peer, m);
    const inChat = view.name === 'chat' && view.peer === peer && document.visibilityState === 'visible';
    // обновить список чатов
    let c = S.chats.find(x => x.peer.id === peer);
    if (!c) {
      c = { peer: S.peers[peer] || { id: peer, name: 'ID ' + peer }, last: m, unread: 0 };
      S.chats.unshift(c);
      api('GET', '/api/users/' + peer).then(d => { rememberPeer(d.user); if (view.drawList) view.drawList(); }).catch(() => {});
    }
    c.last = m;
    if (incoming && !inChat) { c.unread++; beep(); }
    if (incoming && S.typing[peer]) { clearTimeout(S.typing[peer]); delete S.typing[peer]; }
    S.chats.sort((a, b) => b.last.ts - a.last.ts);
    if (view.name === 'chats' && view.drawList) view.drawList();
    if (view.name === 'chat' && view.peer === peer) {
      if (r === 'added') view.append(m); else if (r === 'updated') view.update(m);
      view.updateHeader();
      if (incoming && inChat) markRead(peer);
    }
  } else if (ev.type === 'deleted') {
    const peer = ev.a === S.me.id ? ev.b : ev.a;
    const box = S.msgs[peer];
    if (box) box.list = box.list.filter(x => x.id !== ev.id);
    loadChats();
    if (view.name === 'chat' && view.peer === peer) view.rebuild();
  } else if (ev.type === 'read') {
    if (ev.mine) {
      const c = S.chats.find(x => x.peer.id === ev.by); // (не используется: by = я)
    } else {
      const box = S.msgs[ev.by];
      if (box) box.list.forEach(m => { if (m.from === S.me.id) m.read = true; });
      if (view.name === 'chat' && view.peer === ev.by) view.refreshTicks();
    }
  } else if (ev.type === 'typing') {
    clearTimeout(S.typing[ev.from]);
    S.typing[ev.from] = setTimeout(() => { delete S.typing[ev.from]; if (view.name === 'chat') view.updateHeader(); }, 4000);
    if (view.name === 'chat' && view.peer === ev.from) view.updateHeader();
  } else if (ev.type === 'presence') {
    rememberPeer(ev.user);
    if (ev.user.id === S.me.id) { S.me.name = ev.user.name; }
    if (view.name === 'chats' && view.drawList) view.drawList();
    if (view.name === 'chat' && view.peer === ev.user.id) view.updateHeader();
  }
}
function markRead(peer) {
  const c = S.chats.find(x => x.peer.id === peer);
  const had = c && c.unread > 0;
  if (c) c.unread = 0;
  const box = S.msgs[peer];
  const unreadInBox = box && box.list.some(m => m.to === S.me.id && !m.read);
  if (had || unreadInBox) {
    if (box) box.list.forEach(m => { if (m.to === S.me.id) m.read = true; });
    api('POST', '/api/read', { peer }).catch(() => {});
  }
}
function previewText(m) {
  const who = m.from === S.me.id ? 'Вы: ' : '';
  if (m.type === 'sticker') return who + '🖼 Стикер';
  if (m.type === 'image') return who + '📷 Фото' + (m.text ? ', ' + m.text : '');
  return who + (m.text || '').replace(/\s+/g, ' ');
}

/* =========================================================
   Экран: список чатов
   ========================================================= */
function viewChats() {
  view = { name: 'chats' };
  const list = h('div', { class: 'scroll', id: 'chatlist' });
  const inId = h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', placeholder: 'Найти человека по ID', maxlength: 12 });
  const foundBox = h('div');
  const screen = h('div', { class: 'screen' },
    h('div', { class: 'bar' }, h('h1', null, 'Чатик'),
      h('button', { class: 'icon-btn', 'aria-label': 'Настройки', onclick: () => go('#/settings') }, '⚙️')),
    h('div', { class: 'banner' + (S.online ? ' hidden' : ''), id: 'banner' }, 'Подключение…'),
    h('div', { class: 'myid' }, 'Ваш ID: ', h('b', null, S.me.id),
      h('button', { class: 'chip', style: 'padding:3px 10px;margin-left:auto', onclick: () => copyText(S.me.id) }, 'Копировать')),
    h('div', { class: 'search' },
      h('form', {
        onsubmit: async e => {
          e.preventDefault();
          const id = inId.value.trim();
          foundBox.innerHTML = '';
          if (!id) return;
          if (!/^\d+$/.test(id)) { foundBox.append(h('div', { class: 'hint' }, 'ID состоит только из цифр')); return; }
          if (id === S.me.id) { foundBox.append(h('div', { class: 'hint' }, 'Это ваш собственный ID 🙂')); return; }
          foundBox.append(h('div', { class: 'hint' }, 'Ищем…'));
          try {
            const d = await api('GET', '/api/users/' + id);
            rememberPeer(d.user);
            foundBox.innerHTML = '';
            foundBox.append(h('div', { class: 'found' }, avatar(d.user, 'sm'),
              h('div', { class: 'info' }, h('b', null, d.user.name), h('div', { class: 'hint', style: 'margin:0' }, 'ID ' + d.user.id + ' · ' + fmtSeen(d.user))),
              h('button', { class: 'btn small', type: 'button', onclick: () => go('#/chat/' + d.user.id) }, 'Написать')));
          } catch (ex) { foundBox.innerHTML = ''; foundBox.append(h('div', { class: 'hint', style: 'color:var(--danger)' }, ex.message)); }
        }
      }, inId, h('button', { class: 'go', type: 'submit' }, 'Найти')),
      foundBox),
    list);
  $app.append(screen);

  view.drawList = function () {
    list.innerHTML = '';
    if (!S.chats.length) {
      list.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '💬'), 'Чатов пока нет.', h('br'), 'Введите ID друга в поиске выше и напишите ему. Свой ID отправьте другу — он найдёт вас так же.'));
      return;
    }
    for (const c of S.chats) {
      list.append(h('button', { class: 'chat-row', onclick: () => go('#/chat/' + c.peer.id) },
        avatar(c.peer),
        h('div', { class: 'mid' },
          h('div', { class: 'top' }, h('span', { class: 'nm' }, c.peer.name), h('span', { class: 'tm' }, fmtList(c.last.ts))),
          h('div', { class: 'bot' }, h('span', { class: 'pv' }, S.typing[c.peer.id] ? 'печатает…' : previewText(c.last)), c.unread ? h('span', { class: 'badge' }, c.unread) : null))));
    }
  };
  view.drawList();
  loadChats();
}

/* =========================================================
   Экран: чат
   ========================================================= */
let tmpCounter = 0;
function viewChat(peer) {
  view = { name: 'chat', peer };
  const cache = S.msgs[peer];
  let panelMode = null, loadingMore = false, lastTypingSent = 0;
  view.stick = true;

  const nameEl = h('div', { class: 't1' }), statusEl = h('div', { class: 't2' });
  const avBox = h('div');
  const msgsEl = h('div', { class: 'msgs' });
  const ta = h('textarea', { rows: 1, placeholder: 'Сообщение', maxlength: 4000, enterkeyhint: 'send' });
  const panelBox = h('div');
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'bar chat-bar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: back }, '←'),
      h('div', { class: 'who' }, avBox, h('div', { style: 'min-width:0' }, nameEl, statusEl)),
      h('button', { class: 'icon-btn', 'aria-label': 'Тема', onclick: openThemeSheet }, '🎨')),
    h('div', { class: 'banner' + (S.online ? ' hidden' : ''), id: 'banner' }, 'Подключение…'),
    msgsEl,
    h('div', { class: 'composer' },
      h('button', { class: 'icon-btn', 'aria-label': 'Стикеры и эмодзи', onclick: () => togglePanel('stickers') }, '😊'),
      ta,
      h('button', { class: 'icon-btn', 'aria-label': 'Фото', onclick: () => fileIn.click() }, '📎'),
      h('button', { class: 'icon-btn send', 'aria-label': 'Отправить', onclick: sendText }, '➤')),
    panelBox, fileIn);
  $app.append(screen);

  // ---- шапка
  view.updateHeader = function () {
    const u = S.peers[peer] || { id: peer, name: 'ID ' + peer };
    nameEl.textContent = u.name;
    statusEl.textContent = S.typing[peer] ? 'печатает…' : fmtSeen(u);
    avBox.innerHTML = ''; avBox.append(avatar(u, 'sm'));
  };
  view.updateHeader();

  // ---- сообщения
  const nodes = new Map();
  function tickText(m) { return m.failed ? '⚠' : (m.pending ? '🕓' : (m.read ? '✓✓' : '✓')); }
  function msgEl(m) {
    const mine = m.from === S.me.id;
    const cls = ['msg', mine ? 'out' : 'in'];
    const meta = h('div', { class: 'meta' }, h('span', null, fmtTime(m.ts)), mine ? h('span', { class: 'tick' }, tickText(m)) : null);
    let body;
    if (m.type === 'sticker') {
      cls.push('sticker');
      body = [h('img', { src: m.data, alt: 'стикер' }), meta];
    } else if (m.type === 'image') {
      cls.push('image');
      body = [h('img', { src: m.data, alt: 'фото' }), m.text ? h('div', { class: 'tx' }, m.text) : null, m.text ? meta : (meta.classList.add('over'), meta)];
    } else if (isEmojiOnly(m.text)) {
      cls.push('big-emoji');
      body = [h('div', { class: 'tx' }, m.text), meta];
    } else body = [h('div', { class: 'tx' }, m.text), meta];
    if (m.pending) cls.push('pending');
    const el = h('div', { class: cls.join(' '), onclick: () => msgActions(m.cid && !m.id ? m : m) }, body);
    el.querySelectorAll('img').forEach(i => i.addEventListener('load', () => { if (view.stick) scrollBottom(); }));
    nodes.set(m.cid || m.id, el);
    return el;
  }
  const key = m => m.cid || m.id;
  function nearBottom() { return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 90; }
  function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }
  msgsEl.addEventListener('scroll', () => {
    view.stick = nearBottom();
    if (msgsEl.scrollTop < 40) loadMore();
  });

  let lastTs = 0;
  view.rebuild = function () {
    const box = S.msgs[peer]; if (!box) return;
    const keep = nearBottom() || view.stick;
    msgsEl.innerHTML = ''; nodes.clear(); lastTs = 0;
    msgsEl.append(h('div', { class: 'spacer' }));
    if (box.hasMore) msgsEl.append(h('div', { class: 'day', style: 'background:none;color:var(--muted)' }, '⋯'));
    for (const m of box.list) appendNode(m);
    if (keep) scrollBottom();
  };
  function appendNode(m) {
    if (!lastTs || !sameDay(lastTs, m.ts)) msgsEl.append(h('div', { class: 'day' }, fmtDay(m.ts)));
    lastTs = m.ts;
    msgsEl.append(msgEl(m));
  }
  view.append = function (m) {
    const was = view.stick || nearBottom();
    appendNode(m);
    if (was || m.from === S.me.id) { view.stick = true; scrollBottom(); }
  };
  view.update = function (m) {
    const k = m.cid && nodes.has(m.cid) ? m.cid : m.id;
    const old = nodes.get(k);
    if (!old) return view.rebuild();
    const fresh = msgEl(m);
    old.replaceWith(fresh);
  };
  view.refreshTicks = function () {
    const box = S.msgs[peer]; if (!box) return;
    for (const m of box.list) {
      if (m.from !== S.me.id) continue;
      const el = nodes.get(key(m)); const t = el && el.querySelector('.tick');
      if (t) t.textContent = tickText(m);
    }
  };

  async function loadMore() {
    const box = S.msgs[peer];
    if (loadingMore || !box || !box.hasMore) return;
    const first = box.list.find(m => typeof m.id === 'number');
    if (!first) return;
    loadingMore = true;
    try {
      const d = await api('GET', '/api/messages/' + peer + '?before=' + first.id);
      const prevH = msgsEl.scrollHeight;
      box.list = d.messages.concat(box.list); box.hasMore = d.hasMore;
      view.stick = false;
      view.rebuild();
      msgsEl.scrollTop = msgsEl.scrollHeight - prevH;
    } catch (e) {} finally { loadingMore = false; }
  }

  async function load() {
    if (cache) { view.rebuild(); scrollBottom(); syncChat(peer); markRead(peer); return; }
    msgsEl.append(h('div', { class: 'empty', style: 'margin:auto' }, 'Загрузка…'));
    try {
      const d = await api('GET', '/api/messages/' + peer);
      rememberPeer(d.peer);
      S.msgs[peer] = { list: d.messages, hasMore: d.hasMore };
      view.updateHeader(); view.rebuild(); view.stick = true; scrollBottom();
      markRead(peer);
      if (view.drawList) view.drawList();
    } catch (e) {
      msgsEl.innerHTML = '';
      msgsEl.append(h('div', { class: 'empty', style: 'margin:auto' }, e.message, h('br'), h('button', { class: 'btn small', style: 'margin-top:12px', onclick: () => go('#/', true) }, 'К списку чатов')));
    }
  }

  // ---- отправка
  function sendMessage(payload) {
    if (!S.msgs[peer]) return;
    const cid = 'c' + Date.now() + '_' + (++tmpCounter);
    const m = Object.assign({ id: cid, cid, from: S.me.id, to: peer, ts: Date.now(), read: false, pending: true }, payload);
    S.msgs[peer].list.push(m);
    let c = S.chats.find(x => x.peer.id === peer);
    if (!c) { c = { peer: S.peers[peer] || { id: peer, name: 'ID ' + peer }, last: m, unread: 0 }; S.chats.unshift(c); }
    c.last = m;
    view.append(m);
    postMessage(m);
  }
  async function postMessage(m) {
    m.pending = true; m.failed = false;
    try {
      const d = await api('POST', '/api/messages', { to: m.to, type: m.type, text: m.text, data: m.data, cid: m.cid });
      const box = S.msgs[peer];
      const cur = box && box.list.find(x => x.cid === m.cid);
      if (cur) { Object.assign(cur, d.message, { pending: false, failed: false }); }
      const c = S.chats.find(x => x.peer.id === peer); if (c && (c.last.cid === m.cid)) c.last = cur || d.message;
      if (view.name === 'chat' && view.peer === peer) view.update(cur || d.message);
    } catch (e) {
      m.pending = false; m.failed = true;
      if (view.name === 'chat' && view.peer === peer) view.update(m);
      toast(e.message);
    }
  }
  function sendText() {
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; autosize();
    sendMessage({ type: 'text', text });
  }
  function autosize() { ta.style.height = '42px'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }
  ta.addEventListener('input', () => {
    autosize();
    if (Date.now() - lastTypingSent > 3000 && ta.value) { lastTypingSent = Date.now(); api('POST', '/api/typing', { to: peer }).catch(() => {}); }
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia && matchMedia('(pointer:fine)').matches) { e.preventDefault(); sendText(); }
  });
  ta.addEventListener('focus', () => { closePanel(); setTimeout(() => { if (view.stick) scrollBottom(); }, 300); });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    try { const data = await imageToDataUrl(f, 1280, 'image/jpeg', 0.78); sendMessage({ type: 'image', data }); }
    catch (e) { toast('Не удалось открыть картинку'); }
  });

  // ---- действия с сообщением
  function msgActions(m) {
    const items = [];
    if (m.failed) {
      items.push({ icon: '🔁', label: 'Повторить отправку', fn: () => { m.failed = false; view.update(m); postMessage(m); } });
      items.push({ icon: '🗑', label: 'Удалить', danger: true, fn: () => { const box = S.msgs[peer]; box.list = box.list.filter(x => x !== m); view.rebuild(); } });
    } else {
      if (m.type === 'text') items.push({ icon: '📋', label: 'Копировать текст', fn: () => copyText(m.text) });
      if (m.type === 'sticker') items.push({ icon: '⭐', label: 'Сохранить стикер себе', fn: () => { addSticker(m.data); toast('Стикер сохранён'); } });
      if (m.from === S.me.id && typeof m.id === 'number') items.push({ icon: '🗑', label: 'Удалить у всех', danger: true, fn: () => api('DELETE', '/api/messages/' + m.id).catch(e => toast(e.message)) });
    }
    if (items.length) sheet('', items);
  }

  // ---- тема в чате
  function openThemeSheet() {
    closeOverlays();
    const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } },
      h('div', { class: 'sheet' }, h('h3', null, 'Оформление чата'), appearanceBox(false), h('button', { class: 'btn', style: 'margin-top:14px', onclick: () => ov.remove() }, 'Готово')));
    document.body.append(ov);
  }

  // ---- панель стикеров / эмодзи
  function closePanel() { panelMode = null; panelBox.innerHTML = ''; }
  function togglePanel(mode) {
    if (panelMode) { closePanel(); ta.focus(); return; }
    ta.blur(); panelMode = mode; drawPanel('stickers');
    setTimeout(() => { if (view.stick) scrollBottom(); }, 50);
  }
  function drawPanel(tab) {
    panelBox.innerHTML = '';
    const grid = h('div', { class: 'grid' + (tab === 'emoji' ? ' emoji' : '') });
    if (tab === 'emoji') {
      EMOJI.forEach(e => grid.append(h('button', { onclick: () => insertAtCursor(ta, e) }, e)));
    } else {
      grid.append(h('button', { class: 'st add', onclick: () => go('#/sticker') }, '＋'));
      S.stickers.forEach(s => {
        const b = h('button', { class: 'st', onclick: () => { sendMessage({ type: 'sticker', data: s.data }); closePanel(); } }, h('img', { src: s.data, alt: '' }));
        longPress(b, () => confirmBox('Удалить этот стикер из коллекции?', 'Удалить', () => { removeSticker(s.id); drawPanel('stickers'); }, true));
        grid.append(b);
      });
      grid.append(h('div', { class: 'sec' }, 'Стандартные'));
      defaultStickers().forEach(d => grid.append(h('button', { class: 'st', onclick: () => { sendMessage({ type: 'sticker', data: d }); closePanel(); } }, h('img', { src: d, alt: '' }))));
    }
    panelBox.append(h('div', { class: 'panel' },
      h('div', { class: 'ptabs' },
        h('button', { class: tab === 'stickers' ? 'on' : '', onclick: () => drawPanel('stickers') }, 'Стикеры'),
        h('button', { class: tab === 'emoji' ? 'on' : '', onclick: () => drawPanel('emoji') }, 'Эмодзи'),
        h('button', { onclick: closePanel }, '✕')),
      grid));
  }

  view.cleanup = function () { };
  load();
}
function insertAtCursor(ta, text) {
  const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, e = ta.selectionEnd == null ? s : ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
  ta.dispatchEvent(new Event('input'));
}

/* =========================================================
   Стикеры: коллекция, стандартные, картинки
   ========================================================= */
const EMOJI = Array.from('😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😋😛😜🤪🤗🤔🤨😐😑😶🙄😏😴😌😎🤓🥳🤩😢😭😤😠😡🤬😱😨😰😓🤯😳🥺😬🤤🤒🤕🤢🤮🥶🥵👍👎👌✌️🤞🤝👏🙌🙏💪👀🧠❤️🧡💛💚💙💜🖤💔💕💯🔥✨⭐🎉🎂🍕🍔🍟🍺☕🌹🌞🌙🐶🐱🐼🦊🐸🐵🙈🚀⚽🎮🎧💤💩👻💀🤡');
const DEFAULT_ST = ['😀', '😂', '😍', '😎', '😭', '😡', '😱', '🥳', '👍', '👎', '❤️', '🔥', '🎉', '🙏', '🤝', '💩'];
let defCache = null;
function emojiToDataUrl(ch) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.font = '200px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(ch, 128, 140);
  return c.toDataURL('image/png');
}
function defaultStickers() { return defCache || (defCache = DEFAULT_ST.map(emojiToDataUrl)); }
function addSticker(data) {
  S.stickers.unshift({ id: 's' + Date.now() + Math.floor(Math.random() * 1000), data });
  if (!lsSet('sc_stickers', S.stickers)) { S.stickers.shift(); toast('Не хватает места для стикеров'); }
}
function removeSticker(id) { S.stickers = S.stickers.filter(s => s.id !== id); lsSet('sc_stickers', S.stickers); }
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
async function imageToDataUrl(file, max, type, q) {
  const img = await loadImage(await fileToDataUrl(file));
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const x = c.getContext('2d');
  if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, q);
}

/* =========================================================
   Экран: создание стикера
   ========================================================= */
function viewSticker() {
  view = { name: 'sticker' };
  const ed = { img: null, emoji: null, scale: 1, ox: 0, oy: 0, shape: 'rounded', text: '', pos: 'bottom', color: '#ffffff' };
  const SIZE = 512;
  const canvas = h('canvas', { width: SIZE, height: SIZE });
  const ctx = canvas.getContext('2d');
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const zoom = h('input', { type: 'range', min: 0.3, max: 3, step: 0.01, value: 1, oninput: () => { ed.scale = parseFloat(zoom.value); draw(); } });
  const hint = h('div', { class: 'hint', style: 'text-align:center' }, 'Выберите фото или эмодзи. Фото можно двигать пальцем и менять масштаб.');

  function rr(x, y, w, h_, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h_, r); ctx.arcTo(x + w, y + h_, x, y + h_, r);
    ctx.arcTo(x, y + h_, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    if (ed.img) {
      if (ed.shape === 'circle') { ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2); ctx.clip(); }
      else if (ed.shape === 'rounded') { rr(0, 0, SIZE, SIZE, 96); ctx.clip(); }
      const fit = ed.shape === 'free' ? Math.min(SIZE / ed.img.width, SIZE / ed.img.height) : Math.max(SIZE / ed.img.width, SIZE / ed.img.height);
      const s = fit * ed.scale, w = ed.img.width * s, hh = ed.img.height * s;
      ctx.drawImage(ed.img, SIZE / 2 - w / 2 + ed.ox, SIZE / 2 - hh / 2 + ed.oy, w, hh);
    } else if (ed.emoji) {
      ctx.font = Math.round(380 * ed.scale) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ed.emoji, SIZE / 2 + ed.ox, SIZE / 2 + 30 + ed.oy);
    } else {
      ctx.fillStyle = 'rgba(120,120,120,.5)'; ctx.font = '36px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Здесь будет стикер', SIZE / 2, SIZE / 2);
    }
    ctx.restore();
    if (ed.text.trim() && (ed.img || ed.emoji)) {
      let size = 84; const t = ed.text.trim();
      ctx.font = '800 ' + size + 'px Impact,"Arial Black",sans-serif';
      while (ctx.measureText(t).width > SIZE - 40 && size > 20) { size -= 4; ctx.font = '800 ' + size + 'px Impact,"Arial Black",sans-serif'; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const y = ed.pos === 'top' ? size / 2 + 22 : SIZE - size / 2 - 22;
      ctx.lineWidth = Math.max(6, size / 7); ctx.strokeStyle = ed.color === '#000000' ? '#fff' : '#000';
      ctx.strokeText(t, SIZE / 2, y); ctx.fillStyle = ed.color; ctx.fillText(t, SIZE / 2, y);
    }
  }
  // перетаскивание
  const wrap = h('div', { class: 'canvas-wrap' }, canvas);
  let drag = null;
  wrap.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, ox: ed.ox, oy: ed.oy }; wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    const k = SIZE / wrap.getBoundingClientRect().width;
    ed.ox = drag.ox + (e.clientX - drag.x) * k; ed.oy = drag.oy + (e.clientY - drag.y) * k; draw();
  });
  const end = () => { drag = null; };
  wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('wheel', e => { e.preventDefault(); ed.scale = Math.min(3, Math.max(0.3, ed.scale * (e.deltaY < 0 ? 1.06 : 0.94))); zoom.value = ed.scale; draw(); }, { passive: false });

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try { ed.img = await loadImage(await fileToDataUrl(f)); ed.emoji = null; ed.scale = 1; ed.ox = ed.oy = 0; zoom.value = 1; shapesRow.classList.remove('hidden'); draw(); }
    catch (e) { toast('Не удалось открыть картинку'); }
  });

  const chipRow = (items, get, set) => {
    const row = h('div', { class: 'chips' });
    const paint = () => { row.innerHTML = ''; items.forEach(([v, label]) => row.append(h('button', { class: 'chip' + (get() === v ? ' on' : ''), onclick: () => { set(v); paint(); draw(); } }, label))); };
    paint(); return row;
  };
  const shapesRow = chipRow([['rounded', 'Скруглённый'], ['circle', 'Круг'], ['square', 'Квадрат'], ['free', 'Без обрезки']], () => ed.shape, v => ed.shape = v);
  shapesRow.classList.add('hidden');
  const posRow = chipRow([['top', 'Текст сверху'], ['bottom', 'Текст снизу']], () => ed.pos, v => ed.pos = v);
  const colorRow = chipRow([['#ffffff', 'Белый'], ['#ffe14d', 'Жёлтый'], ['#ff5a5f', 'Красный'], ['#000000', 'Чёрный']], () => ed.color, v => ed.color = v);
  const emojiGrid = h('div', { class: 'emoji-pick' });
  Array.from('😀😂😍😎😭😡😱🥳👍👎❤️🔥🎉🙏🤝💩🤔😴🤡👻🐱🐶🐸🦊').forEach(e => emojiGrid.append(h('button', { onclick: () => { ed.emoji = e; ed.img = null; ed.scale = 1; ed.ox = ed.oy = 0; zoom.value = 1; shapesRow.classList.add('hidden'); draw(); } }, e)));

  function save() {
    if (!ed.img && !ed.emoji) { toast('Сначала выберите фото или эмодзи'); return; }
    let out = canvas, data = out.toDataURL('image/webp', 0.9);
    if (!data.startsWith('data:image/webp')) data = out.toDataURL('image/png');
    if (data.length > 380000) {
      const c = document.createElement('canvas'); c.width = c.height = 384; c.getContext('2d').drawImage(canvas, 0, 0, 384, 384);
      data = c.toDataURL('image/webp', 0.8); if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/png');
    }
    addSticker(data); toast('Стикер сохранён ✓'); back();
  }

  $app.append(h('div', { class: 'screen' },
    h('div', { class: 'bar' }, h('button', { class: 'icon-btn', onclick: back, 'aria-label': 'Назад' }, '←'), h('h1', null, 'Новый стикер')),
    h('div', { class: 'scroll' }, h('div', { class: 'editor' },
      wrap, hint,
      h('button', { class: 'btn', onclick: () => fileIn.click() }, '🖼 Выбрать фото из галереи'),
      h('div', { class: 'hint' }, 'или эмодзи:'), emojiGrid,
      shapesRow,
      h('label', { class: 'field' }, h('span', null, 'Масштаб'), zoom),
      h('label', { class: 'field' }, h('span', null, 'Надпись на стикере'), h('input', { type: 'text', maxlength: 30, placeholder: 'Например: Привет!', oninput: e => { ed.text = e.target.value; draw(); } })),
      posRow, colorRow,
      h('button', { class: 'btn', style: 'margin-top:8px', onclick: save }, 'Сохранить стикер'),
      h('div', { class: 'pad' })), fileIn)));
  draw();
}

/* =========================================================
   Оформление (общий блок для настроек и для чата)
   ========================================================= */
function appearanceBox(withFont) {
  const box = h('div');
  const set = patch => { Object.assign(S.settings, patch); saveSettings(); applySettings(); draw(); };
  function draw() {
    box.innerHTML = '';
    add(box, [h('h4', null, 'Тема'),
      h('div', { class: 'themes' }, THEMES.map(t => h('button', { class: S.settings.theme === t.id ? 'on' : '', onclick: () => set({ theme: t.id }) }, h('i', { style: 'background:' + t.bg }), t.name))),
      h('h4', { style: 'margin-top:16px' }, 'Цвет акцента'),
      h('div', { class: 'swatches' },
        ACCENTS.map(c => h('button', { class: 'sw' + (S.settings.accent === c ? ' on' : ''), style: 'background:' + c, 'aria-label': c, onclick: () => set({ accent: c }) })),
        h('label', { class: 'sw' + (ACCENTS.includes(S.settings.accent) ? '' : ' on'), style: 'background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);position:relative;overflow:hidden' },
          h('input', { type: 'color', value: S.settings.accent, style: 'opacity:0;position:absolute;inset:0;width:100%;height:100%', onchange: e => set({ accent: e.target.value }) }))),
      h('h4', { style: 'margin-top:16px' }, 'Фон чата'),
      h('div', { class: 'walls' },
        WALLS.map(w => h('button', { class: S.settings.wall === w.id ? 'on' : '', style: w.css ? 'background-image:' + w.css + ';background-size:' + (w.size || 'cover') : '', onclick: () => set({ wall: w.id }) }, w.name || '')),
        (() => {
          const fi = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async () => {
            const f = fi.files[0]; if (!f) return;
            try { const d = await imageToDataUrl(f, 1280, 'image/jpeg', 0.7); if (!lsSet('sc_wall_img', d)) return toast('Картинка слишком большая'); set({ wall: 'custom' }); }
            catch (e) { toast('Не удалось открыть картинку'); }
          } });
          const custom = lsGet('sc_wall_img', null);
          return h('button', { class: S.settings.wall === 'custom' ? 'on' : '', style: custom ? 'background-image:url(' + custom + ')' : '', onclick: () => fi.click() }, custom ? '' : '＋ своё', fi);
        })()),
      withFont ? [h('h4', { style: 'margin-top:16px' }, 'Размер текста в чате'),
        h('input', { type: 'range', min: 13, max: 22, step: 1, value: S.settings.font, oninput: e => { S.settings.font = +e.target.value; saveSettings(); applySettings(); } }),
        h('div', { class: 'preview-msg' },
          h('div', { class: 'msg in' }, h('div', { class: 'tx' }, 'Привет! Как дела?'), h('div', { class: 'meta' }, '12:30')),
          h('div', { class: 'msg out' }, h('div', { class: 'tx' }, 'Отлично, спасибо!'), h('div', { class: 'meta' }, '12:31 ✓✓')))] : null]);
  }
  draw();
  return box;
}

/* =========================================================
   Экран: настройки
   ========================================================= */
function viewSettings() {
  view = { name: 'settings' };
  const nameIn = h('input', { type: 'text', maxlength: 30, value: S.me.name, style: 'width:100%;padding:11px 12px;border:1.5px solid var(--border);border-radius:12px;background:var(--bg);outline:none' });
  const avBox = h('div');
  const drawAv = () => { avBox.innerHTML = ''; avBox.append(avatar(S.me)); };
  drawAv();

  function passwordSheet() {
    closeOverlays();
    const a = h('input', { type: 'password', autocomplete: 'current-password' }), b = h('input', { type: 'password', autocomplete: 'new-password' }), c = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'err' });
    const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } },
      h('div', { class: 'sheet' }, h('h3', null, 'Смена пароля'),
        h('label', { class: 'field' }, h('span', null, 'Старый пароль'), a),
        h('label', { class: 'field' }, h('span', null, 'Новый пароль'), b),
        h('label', { class: 'field' }, h('span', null, 'Повторите новый пароль'), c), err,
        h('button', { class: 'btn', onclick: async () => {
          err.textContent = '';
          try { await api('PATCH', '/api/me', { oldPassword: a.value, newPassword: b.value, newPassword2: c.value }); ov.remove(); toast('Пароль изменён'); }
          catch (e) { err.textContent = e.message; }
        } }, 'Сохранить')));
    document.body.append(ov);
  }

  $app.append(h('div', { class: 'screen' },
    h('div', { class: 'bar' }, h('button', { class: 'icon-btn', onclick: back, 'aria-label': 'Назад' }, '←'), h('h1', null, 'Настройки')),
    h('div', { class: 'scroll' },
      h('div', { class: 'sect' }, h('h4', null, 'Профиль'),
        h('div', { class: 'profile' }, avBox, h('div', { class: 'pi' },
          h('div', { class: 'hint', style: 'margin:0' }, 'Ваш ID (отправьте его другу)'),
          h('div', { class: 'idbig' }, S.me.id),
          h('div', { class: 'hint', style: 'margin:2px 0 0' }, 'Логин: ' + S.me.login)),
          h('button', { class: 'chip', onclick: () => copyText(S.me.id) }, 'Копировать')),
        h('div', { style: 'display:flex;gap:8px;margin-top:14px' }, nameIn,
          h('button', { class: 'btn small', onclick: async () => {
            try { const d = await api('PATCH', '/api/me', { name: nameIn.value }); S.me = d.user; lsSet('sc_session', { token: S.token, me: S.me }); drawAv(); toast('Имя сохранено'); }
            catch (e) { toast(e.message); }
          } }, 'Сохранить'))),
      h('div', { class: 'sect' }, appearanceBox(true)),
      h('div', { class: 'sect' }, h('h4', null, 'Стикеры'),
        h('div', { class: 'row-set' }, h('div', { class: 'lbl' }, 'В вашей коллекции: ' + S.stickers.length), h('button', { class: 'btn small', onclick: () => go('#/sticker') }, 'Создать'))),
      h('div', { class: 'sect' }, h('h4', null, 'Уведомления'),
        (() => {
          const sw = h('button', { class: 'switch' + (S.settings.sound ? ' on' : ''), 'aria-label': 'Звук', onclick: () => { S.settings.sound = !S.settings.sound; saveSettings(); sw.classList.toggle('on', S.settings.sound); if (S.settings.sound) beep(); } });
          return h('div', { class: 'row-set' }, h('div', { class: 'lbl' }, 'Звук нового сообщения'), sw);
        })()),
      h('div', { class: 'sect' }, h('h4', null, 'Аккаунт'),
        h('button', { class: 'btn ghost', onclick: passwordSheet }, '🔑 Сменить пароль'),
        h('button', { class: 'btn danger', style: 'margin-top:10px', onclick: () => confirmBox('Выйти из аккаунта?', 'Выйти', () => doLogout(false), true) }, 'Выйти'),
        h('div', { class: 'hint', style: 'text-align:center;word-break:break-all' }, 'Сервер: ' + baseUrl())),
      h('div', { class: 'pad' }))));
}

/* =========================================================
   Запуск
   ========================================================= */
applySettings();
if (window.visualViewport) {
  const fit = () => { $app.style.height = window.visualViewport.height + 'px'; };
  visualViewport.addEventListener('resize', fit); fit();
}
if (S.token) {
  startSession();
  api('GET', '/api/me', null, { noLogout: false }).then(d => { S.me = d.user; lsSet('sc_session', { token: S.token, me: S.me }); }).catch(() => {});
}
if (!history.state) history.replaceState({ d: 0 }, '', location.hash || '#/');
render();
})();
