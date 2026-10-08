// 같이 쓰기(커플 동기화)
// - 화면들은 지금처럼 localStorage만 읽고 씀. 이 파일이 뒤에서 Firestore와 맞춰줌.
// - 연결 안 했으면 Firebase를 아예 불러오지 않음(지금과 똑같이 폰 안에서만 동작).
// - 맞추는 방법: 마지막으로 서버와 맞았던 상태(base)를 기억해 두고
//   내 폰(local)·서버(remote)·base를 항목(id)별로 비교 → 바뀐 쪽을 반영. 둘 다 바뀌면 이 폰 쪽이 이김.

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB2luVPKNB98JheU6Dtoy-HC5WvALp-mzk',
  authDomain: 'ournote-e1b52.firebaseapp.com',
  projectId: 'ournote-e1b52',
  storageBucket: 'ournote-e1b52.firebasestorage.app',
  messagingSenderId: '1053017440269',
  appId: '1:1053017440269:web:d26040cf902283ae90d544'
};

const STATE_KEY = 'ournote:sync';
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I 제외
const INVITE_HOURS = 24;

// 같이 쓰는 데이터: localStorage 키 ↔ Firestore 하위 컬렉션
const COLS = [
  {
    name: 'items',
    key: 'ournote:items',
    valid: (x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id && typeof x.title === 'string' && x.title.trim() !== ''
  }
];

// ---------- 작은 유틸 ----------
const rawSet = Storage.prototype.setItem;
function readJSON(key, fb) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fb : v; } catch (e) { return fb; }
}
function writeRaw(key, v) { try { rawSet.call(localStorage, key, JSON.stringify(v)); } catch (e) { /* 저장 공간 부족 */ } }
// 키 순서와 상관없이 같은 내용이면 같은 글자가 되도록
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function docId(id) { return encodeURIComponent(id).replace(/\./g, '%2E'); }
function makeCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => CODE_ABC[n % CODE_ABC.length]).join('');
}
function showCode(c) { return c.slice(0, 3) + '-' + c.slice(3); }
function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 상태: { cid, base: { items: { id: canon } } }
let state = readJSON(STATE_KEY, null);
if (!state || typeof state !== 'object') state = { cid: '', base: {} };
if (!state.base) state.base = {};
function saveState() { writeRaw(STATE_KEY, state); }

// ---------- Firebase (필요할 때만 불러옴) ----------
let F = null, app = null, auth = null, db = null, uid = '';
let fbPromise = null;
function firebase() {
  if (fbPromise) return fbPromise;
  fbPromise = (async () => {
    F = await import('/fb.js');
    app = F.initializeApp(FIREBASE_CONFIG);
    auth = F.getAuth(app);
    db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() });
    if (localStorage.getItem('ournote:emu') === '1') { // 개발용 에뮬레이터
      F.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    await new Promise((res) => { const off = F.onAuthStateChanged(auth, () => { off(); res(); }); });
    if (!auth.currentUser) await F.signInAnonymously(auth);
    uid = auth.currentUser.uid;
  })();
  fbPromise.catch(() => { fbPromise = null; });
  return fbPromise;
}

// ---------- 동기화 ----------
let unsubs = [];
let status = 'off'; // off | connecting | live | offline | error
let members = 0; // 커플 인원(1이면 상대를 기다리는 중)
let pending = {}; // 서버 확인을 기다리는 쓰기: 'col/id' → canon(없으면 '∅')
const listeners = new Set();
function setStatus(s) { status = s; listeners.forEach((f) => f()); updateButtons(); }

function localList(col) { const v = readJSON(col.key, []); return Array.isArray(v) ? v : []; }
function localMap(col) {
  const m = {};
  localList(col).forEach((x) => { if (col.valid(x)) m[x.id] = canon(x); });
  return m;
}
function baseOf(col) { return state.base[col.name] || (state.base[col.name] = {}); }
function setBase(col, id, c) {
  const b = baseOf(col);
  if (c === undefined) delete b[id]; else b[id] = c;
  saveState();
}

function push(col, id, c) {
  const pk = col.name + '/' + id;
  const mark = c === undefined ? '∅' : c;
  if (pending[pk] === mark) return;
  pending[pk] = mark;
  const cid = state.cid;
  const ref = F.doc(db, 'couples', cid, col.name, docId(id));
  const p = c === undefined ? F.deleteDoc(ref) : F.setDoc(ref, { j: c, by: uid, at: F.serverTimestamp() });
  p.then(() => {
    if (pending[pk] === mark) delete pending[pk];
    if (state.cid !== cid) return;
    if (localMap(col)[id] === c) setBase(col, id, c); // 아직 그 내용이면 '서버와 맞음'으로 기록
  }).catch((err) => {
    if (pending[pk] === mark) delete pending[pk];
    console.warn('sync push', err);
  });
}

// 내 폰에서 바뀐 것 올리기
function flush(col) {
  if (!db || !state.cid) return;
  const L = localMap(col), B = baseOf(col);
  new Set(Object.keys(L).concat(Object.keys(B))).forEach((id) => { if (L[id] !== B[id]) push(col, id, L[id]); });
}

// 서버 상태가 오면 세 갈래 비교
function reconcile(col, R) {
  const list = localList(col);
  const L = localMap(col), B = baseOf(col);
  const ids = new Set(Object.keys(L).concat(Object.keys(B), Object.keys(R)));
  let changed = false;
  const replace = {}; // id → 새 객체(null이면 지움)
  ids.forEach((id) => {
    const l = L[id], b = B[id], r = R[id];
    if (l === r) {
      if (!pending[col.name + '/' + id] && b !== r) { if (r === undefined) delete B[id]; else B[id] = r; }
      return;
    }
    if (l === b) { // 이 폰은 안 바꿨음 → 서버 것을 받음
      replace[id] = r === undefined ? null : JSON.parse(r);
      if (r === undefined) delete B[id]; else B[id] = r;
      changed = true;
    } else {
      push(col, id, l); // 이 폰에서 바꾼 것 → 올림
    }
  });
  saveState();
  if (!changed) return;
  const seen = {};
  const next = [];
  list.forEach((x) => {
    if (!col.valid(x) || !(x.id in replace)) { next.push(x); return; }
    seen[x.id] = true;
    if (replace[x.id]) next.push(replace[x.id]);
  });
  Object.keys(replace).forEach((id) => { if (!seen[id] && replace[id]) next.push(replace[id]); });
  writeRaw(col.key, next);
  window.dispatchEvent(new CustomEvent('ournote:remote', { detail: { key: col.key } }));
}

let flushTimer = null;
Storage.prototype.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (this === localStorage && state.cid && COLS.some((c) => c.key === k)) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => COLS.forEach(flush), 300);
  }
};

async function start() {
  stop();
  if (!state.cid) { setStatus('off'); return; }
  setStatus('connecting');
  try { await firebase(); } catch (e) { setStatus(navigator.onLine ? 'error' : 'offline'); return; }
  const cid = state.cid;
  unsubs.push(F.onSnapshot(F.doc(db, 'couples', cid), (d) => {
    if (state.cid !== cid || !d.exists()) return;
    const n = (d.data().members || []).length;
    const joined = members === 1 && n > 1, changed = members !== n;
    members = n;
    if (joined) toast('연결됐어요 💞');
    if (changed && ov && !ov.querySelector('.sy-code') && !pendingInvite) paint();
    setStatus(status);
  }, () => {}));
  COLS.forEach((col) => {
    const off = F.onSnapshot(F.collection(db, 'couples', cid, col.name), { includeMetadataChanges: true }, (snap) => {
      if (state.cid !== cid) return;
      if (snap.metadata.fromCache) { setStatus('offline'); return; } // 서버에서 확인된 것만 비교
      const R = {};
      snap.forEach((d) => {
        const j = d.data().j;
        if (typeof j !== 'string') return;
        try { const o = JSON.parse(j); if (col.valid(o)) R[o.id] = canon(o); } catch (e) { /* 깨진 문서 무시 */ }
      });
      reconcile(col, R);
      setStatus('live');
    }, (err) => {
      console.warn('sync listen', err);
      if (err && err.code === 'permission-denied') {
        // 커플에서 빠졌거나 규칙이 아직 없음
        setStatus('error');
      } else setStatus('offline');
    });
    unsubs.push(off);
    flush(col);
  });
}
function stop() { unsubs.forEach((f) => f()); unsubs = []; pending = {}; members = 0; }

// ---------- 연결 만들기 / 들어가기 / 끊기 ----------
async function ensureCouple() {
  await firebase();
  if (state.cid) return state.cid;
  const ref = F.doc(F.collection(db, 'couples'));
  await F.setDoc(ref, { members: [uid], createdAt: F.serverTimestamp() });
  await F.setDoc(F.doc(db, 'users', uid), { cid: ref.id });
  state = { cid: ref.id, base: {} }; // base가 비어 있으니 지금 있는 약속이 전부 올라감
  saveState();
  start();
  return ref.id;
}

async function createInvite() {
  const cid = await ensureCouple();
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    try {
      await F.setDoc(F.doc(db, 'invites', code), {
        cid, by: uid, exp: F.Timestamp.fromMillis(Date.now() + INVITE_HOURS * 3600 * 1000)
      });
      return code;
    } catch (e) {
      if (i === 4) throw e; // 같은 코드가 이미 있으면 다시 뽑기
    }
  }
}

async function lookupInvite(input) {
  const code = cleanCode(input);
  if (code.length !== 6) return { error: '코드 6자리를 넣어주세요' };
  await firebase();
  const snap = await F.getDoc(F.doc(db, 'invites', code));
  if (!snap.exists()) return { error: '코드가 맞지 않거나 이미 쓴 코드예요' };
  const d = snap.data();
  if (!d.exp || d.exp.toMillis() < Date.now()) return { error: '시간이 지난 코드예요. 새로 만들어 달라고 해주세요' };
  if (d.cid === state.cid) return { error: '이미 이 커플과 연결돼 있어요' };
  return { code, cid: d.cid };
}

// keepMine: 이 폰에 있던 약속을 합칠지(true) 버릴지(false)
async function joinInvite(inv, keepMine) {
  await firebase();
  if (state.cid) await leave(true);
  await F.updateDoc(F.doc(db, 'couples', inv.cid), { members: F.arrayUnion(uid), code: inv.code });
  await F.setDoc(F.doc(db, 'users', uid), { cid: inv.cid });
  F.deleteDoc(F.doc(db, 'invites', inv.code)).catch(() => {}); // 한 번 쓴 코드는 없앰
  if (!keepMine) {
    COLS.forEach((col) => writeRaw(col.key, []));
    window.dispatchEvent(new CustomEvent('ournote:remote', { detail: { key: '*' } }));
  }
  state = { cid: inv.cid, base: {} };
  saveState();
  await start();
}

// 끊어도 지금까지의 데이터는 이 폰에 그대로 남음
async function leave(silent) {
  const cid = state.cid;
  stop();
  state = { cid: '', base: {} };
  saveState();
  setStatus('off');
  if (!cid) return;
  try {
    await firebase();
    await F.updateDoc(F.doc(db, 'couples', cid), { members: F.arrayRemove(uid) });
    await F.deleteDoc(F.doc(db, 'users', uid));
  } catch (e) { if (!silent) console.warn('leave', e); }
}

// ---------- 화면 ----------
const CSS = `
.sy-ov{position:fixed;inset:0;z-index:80;background:rgba(20,14,20,.38);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .22s}
.sy-ov.show{opacity:1}
.sy-sheet{width:100%;max-width:560px;background:var(--paper,#fff);color:var(--ink,#2b2230);border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));transform:translateY(24px);transition:transform .22s;max-height:88vh;overflow:auto;font-family:var(--sans,sans-serif)}
.sy-ov.show .sy-sheet{transform:none}
.sy-sheet h2{margin:0 0 6px;font-family:var(--serif,serif);font-size:20px}
.sy-sheet p{margin:0 0 14px;color:var(--muted,#7d6f7a);font-size:13.5px;line-height:1.6}
.sy-row{display:flex;gap:8px;align-items:center;margin:10px 0}
.sy-btn{border:1px solid var(--line,#e8dfe3);background:transparent;color:var(--ink,#2b2230);border-radius:12px;padding:11px 14px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.sy-btn.pri{background:var(--rose,#b5476a);border-color:var(--rose,#b5476a);color:#fff}
.sy-btn.wide{width:100%}
.sy-btn.danger{color:var(--rose,#b5476a)}
.sy-btn:disabled{opacity:.5}
.sy-in{flex:1;min-width:0;border:1px solid var(--line,#e8dfe3);background:var(--bg,#f7f3f4);color:var(--ink,#2b2230);border-radius:12px;padding:11px 12px;font:inherit;font-size:17px;letter-spacing:3px;text-transform:uppercase;text-align:center}
.sy-code{font-size:34px;font-weight:700;letter-spacing:6px;text-align:center;margin:8px 0 4px;color:var(--plum,#4a2f45)}
.sy-hint{text-align:center;color:var(--muted,#7d6f7a);font-size:12.5px;margin-bottom:12px}
.sy-div{display:flex;align-items:center;gap:10px;color:var(--muted,#7d6f7a);font-size:12px;margin:18px 0 8px}
.sy-div:before,.sy-div:after{content:"";flex:1;height:1px;background:var(--line,#e8dfe3)}
.sy-err{color:var(--rose,#b5476a);font-size:13px;min-height:18px;margin-top:4px}
.sy-stat{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted,#7d6f7a);margin-bottom:12px}
.sy-dot{width:8px;height:8px;border-radius:50%;background:var(--muted,#7d6f7a)}
.sy-dot.live{background:var(--ok,#3f7a5a)}
.sy-dot.error{background:var(--rose,#b5476a)}
.sy-close{position:sticky;float:right;top:0;border:0;background:none;color:var(--muted,#7d6f7a);font-size:20px;cursor:pointer;padding:0 4px}
.syncbtn{border:1px solid var(--line,#e8dfe3);background:var(--paper,#fff);color:var(--ink,#2b2230);border-radius:999px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.syncbtn .sy-dot{width:7px;height:7px}
`;
let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

const STATUS_TEXT = { off: '', connecting: '연결하는 중…', live: '같이 쓰는 중', offline: '오프라인 · 다시 연결되면 맞춰져요', error: '연결에 문제가 있어요' };

function updateButtons() {
  document.querySelectorAll('[data-sync-btn]').forEach((b) => {
    b.innerHTML = !state.cid ? '💞 같이 쓰기'
      : members === 1 ? '<span class="sy-dot"></span>💞 상대를 기다리는 중'
      : '<span class="sy-dot ' + (status === 'live' ? 'live' : status === 'error' ? 'error' : '') + '"></span>💞 같이 쓰는 중';
  });
}

let ov = null;
function close() {
  if (!ov) return;
  const o = ov;
  ov = null;
  o.classList.remove('show');
  setTimeout(() => o.remove(), 220);
  listeners.delete(paintStatus);
}
function paintStatus() {
  if (!ov) return;
  const el = ov.querySelector('[data-stat]');
  if (!el) return;
  if (members === 1 && status === 'live') el.innerHTML = '<span class="sy-dot"></span>상대가 초대코드를 넣기를 기다리는 중';
  else el.innerHTML = '<span class="sy-dot ' + status + '"></span>' + esc(STATUS_TEXT[status] || '');
  const h = ov.querySelector('h2');
  if (h) h.textContent = members === 1 ? '💞 상대를 기다리는 중' : '💞 같이 쓰는 중';
}
function open() {
  addStyle();
  close();
  ov = document.createElement('div');
  ov.className = 'sy-ov';
  ov.innerHTML = '<div class="sy-sheet" role="dialog" aria-modal="true" aria-label="같이 쓰기"></div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov && ov.classList.add('show'));
  listeners.add(paintStatus);
  paint();
}
function sheet() { return ov && ov.querySelector('.sy-sheet'); }

function paint() {
  const s = sheet();
  if (!s) return;
  const X = '<button type="button" class="sy-close" data-x aria-label="닫기">×</button>';
  if (state.cid) {
    s.innerHTML = X + '<h2>💞 같이 쓰는 중</h2>' +
      '<div class="sy-stat" data-stat></div>' +
      '<p>둘 중 한 명이 약속을 넣거나 고치면 상대 폰에도 바로 보여요. 인터넷이 없을 때 고친 것도 다시 연결되면 맞춰져요.</p>' +
      (members === 1
        ? '<div class="sy-div">상대에게 보낼 초대코드</div><button type="button" class="sy-btn pri wide" data-act="invite">초대코드 만들기</button>'
        : '<div class="sy-div">폰을 바꿨거나 상대가 연결이 끊겼다면</div><button type="button" class="sy-btn wide" data-act="invite">새 초대코드 만들기</button>') +
      '<div data-codebox></div>' +
      '<div class="sy-div">그만 같이 쓰기</div>' +
      '<button type="button" class="sy-btn wide danger" data-act="leave">연결 끊기</button>' +
      '<div class="sy-err" data-err></div>';
    paintStatus();
  } else {
    s.innerHTML = X + '<h2>💞 같이 쓰기</h2>' +
      '<p>둘이 같은 약속 노트를 함께 써요. 한 명이 초대코드를 만들고, 다른 한 명이 그 코드를 넣으면 연결돼요.</p>' +
      '<button type="button" class="sy-btn pri wide" data-act="invite">초대코드 만들기</button>' +
      '<div data-codebox></div>' +
      '<div class="sy-div">상대에게 코드를 받았다면</div>' +
      '<div class="sy-row"><input class="sy-in" data-code maxlength="7" placeholder="ABC-123" autocomplete="off" autocapitalize="characters" enterkeyhint="go">' +
      '<button type="button" class="sy-btn pri" data-act="join">연결</button></div>' +
      '<div class="sy-err" data-err></div>';
  }
  s.addEventListener('click', onClick);
  s.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-code]') && !e.isComposing) { e.preventDefault(); onJoin(); }
  });
}
function err(msg) { const e = ov && ov.querySelector('[data-err]'); if (e) e.textContent = msg || ''; }
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || '잠깐만요…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
function failText(e) {
  if (!navigator.onLine) return '인터넷에 연결된 뒤에 다시 해주세요';
  if (e && e.code === 'permission-denied') return '서버 설정(보안 규칙)이 아직 안 돼 있어요';
  if (e && e.code === 'auth/operation-not-allowed') return '서버에서 익명 로그인이 꺼져 있어요';
  return '잘 안 됐어요. 잠시 뒤에 다시 해주세요';
}

async function onClick(e) {
  if (e.target.closest('[data-x]')) { close(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.getAttribute('data-act');
  err('');
  if (act === 'invite') {
    busy(b, true, '만드는 중…');
    try {
      const code = await createInvite();
      paintKeepCode(code);
    } catch (x) { busy(b, false); err(failText(x)); console.warn(x); }
  } else if (act === 'copy') {
    const c = b.getAttribute('data-c');
    try { await navigator.clipboard.writeText(c); b.textContent = '복사했어요'; } catch (x) { b.textContent = c; }
  } else if (act === 'join') {
    onJoin();
  } else if (act === 'keep' || act === 'drop') {
    const inv = pendingInvite;
    if (!inv) return;
    busy(b, true, '연결하는 중…');
    try {
      await joinInvite(inv, act === 'keep');
      pendingInvite = null;
      paint();
      toast('연결됐어요 💞');
    } catch (x) { busy(b, false); err(failText(x)); console.warn(x); }
  } else if (act === 'leave') {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '정말 끊을까요? 한 번 더 누르면 끊겨요'; return; }
    busy(b, true, '끊는 중…');
    await leave(false);
    paint();
    toast('연결을 끊었어요 · 지금까지의 약속은 이 폰에 남아 있어요');
  }
}
// 초대코드를 만든 순간 커플이 생겨 화면이 '같이 쓰는 중'으로 바뀌지만, 방금 만든 코드는 계속 보여줌
function paintKeepCode(code) {
  paint();
  const box = ov && ov.querySelector('[data-codebox]');
  if (box) {
    box.innerHTML = '<div class="sy-code">' + showCode(code) + '</div>' +
      '<div class="sy-hint">' + INVITE_HOURS + '시간 동안 한 번 쓸 수 있어요 · 상대 폰의 ‘같이 쓰기’에서 넣어주세요</div>' +
      '<button type="button" class="sy-btn wide" data-act="copy" data-c="' + showCode(code) + '">코드 복사</button>';
  }
}

let pendingInvite = null;
async function onJoin() {
  const input = ov && ov.querySelector('[data-code]');
  const btn = ov && ov.querySelector('[data-act="join"]');
  if (!input) return;
  err('');
  busy(btn, true, '확인 중…');
  try {
    const r = await lookupInvite(input.value);
    busy(btn, false);
    if (r.error) { err(r.error); return; }
    pendingInvite = r;
    const n = localList(COLS[0]).filter(COLS[0].valid).length;
    const s = sheet();
    if (!n) {
      await joinInvite(r, true);
      pendingInvite = null;
      paint();
      toast('연결됐어요 💞');
      return;
    }
    s.innerHTML = '<h2>이 폰에 있던 약속은?</h2>' +
      '<p>이 폰에 약속이 ' + n + '개 있어요. 상대의 약속과 합칠까요, 아니면 버리고 상대 것만 볼까요?</p>' +
      '<button type="button" class="sy-btn pri wide" data-act="keep">합치기</button>' +
      '<div style="height:8px"></div>' +
      '<button type="button" class="sy-btn wide" data-act="drop">버리고 상대 것만</button>' +
      '<div class="sy-err" data-err></div>';
  } catch (x) { busy(btn, false); err(failText(x)); console.warn(x); }
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- 시작 ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sync-btn]')) { e.preventDefault(); open(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov) close(); });
addStyle();
updateButtons();
// '나만 보기'가 생기기 전까지 버튼은 숨겨 둠(이미 연결한 폰만 보임)
if (state.cid) document.querySelectorAll('.syncbar').forEach((el) => { el.hidden = false; });
window.addEventListener('online', () => { if (state.cid && status !== 'live') start(); });
if (state.cid) start();

window.OurSync = { open, status: () => status, state: () => state };
