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
// 🔒 나만 보기: priv가 true이거나, 정한 적 없으면 선물·서프라이즈는 기본으로 나만 보기 → 서버에 안 올림
const PRIV_CATS = { gift: true, surprise: true };
function isPriv(x) { return x.priv === true || (x.priv === undefined && !!PRIV_CATS[x.cat]); }
const COLS = [
  {
    name: 'items',
    key: 'ournote:items',
    valid: (x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id && typeof x.title === 'string' && x.title.trim() !== '',
    local: isPriv // 이 폰에만 두는 항목
  },
  {
    // 데이트 코스 일정(날짜에 붙은 장소 하나하나). 둘이 따로 넣은 것도 전부 합쳐짐
    name: 'stops',
    key: 'ournote:course2',
    valid: (x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id && typeof x.title === 'string',
    read: () => { const c = courseStore(); return c && Array.isArray(c.stops) ? c.stops : []; },
    write: (list) => { const c = courseStore() || { stops: [], ranges: [], view: { start: '', end: '' } }; c.stops = list; writeRaw('ournote:course2', c); },
    stamp: true // 누가 넣었는지(who) 기록
  }
];
// 코스 화면을 아직 안 열어서 예전 형식만 있으면 코스 화면과 같은 방법으로 옮겨 둠(덮어써서 잃지 않게)
function courseStore() {
  const c = readJSON('ournote:course2', null);
  if (c && Array.isArray(c.stops)) return c;
  const oldT = readJSON('ournote:courses', null);
  let trips = oldT && Array.isArray(oldT.trips) ? oldT.trips : [];
  if (!trips.length) {
    const old = readJSON('ournote:course', null);
    if (old && Array.isArray(old.stops) && (old.stops.length || old.date)) trips = [{ id: 'old', start: old.date || '', end: old.date || '', stops: old.stops }];
  }
  if (!trips.length) return null;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const addDays = (d0, n) => { const p = d0.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const out = { stops: [], ranges: [], view: { start: '', end: '' } };
  trips.forEach((t) => {
    (Array.isArray(t.stops) ? t.stops : []).forEach((st) => { st.date = t.start ? addDays(t.start, st.day || 0) : ''; delete st.day; out.stops.push(st); });
    if (t.start) out.ranges.push({ start: t.start, end: t.end || t.start });
  });
  const cur = trips.find((t) => oldT && t.id === oldT.current) || trips[0];
  if (cur) out.view = { start: cur.start || '', end: cur.end || cur.start || '' };
  writeRaw('ournote:course2', out);
  return out;
}
const FULL_EVERY = 7 * 864e5;   // 일주일에 한 번은 전체를 맞춰 봄
const TOMB_KEEP = 30 * 864e5;   // 지움 표시는 30일 뒤 정리
const OVERLAP = 60 * 1000;      // '바뀐 것만' 물을 때 1분 겹치게

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
    if (!F) F = await import('/fb.js');
    if (!app) { // 초기화는 딱 한 번(로그인이 실패해서 다시 시도할 때도)
      app = F.initializeApp(FIREBASE_CONFIG);
      auth = F.getAuth(app);
      db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() });
      if (localStorage.getItem('ournote:emu') === '1') { // 개발용 에뮬레이터
        F.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      }
    }
    await new Promise((res) => { const off = F.onAuthStateChanged(auth, () => { off(); res(); }); });
    if (!auth.currentUser) await F.signInAnonymously(auth);
    uid = auth.currentUser.uid;
    if (state.uid !== uid) { state.uid = uid; saveState(); } // 코스 화면에서 '상대가 넣은 일정' 구분용
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

function localList(col) { const v = col.read ? col.read() : readJSON(col.key, []); return Array.isArray(v) ? v : []; }
function writeList(col, list) { if (col.write) col.write(list); else writeRaw(col.key, list); }
// 새로 넣은 항목에 누가 넣었는지 표시(처음 올릴 때 한 번)
function stamp(col) {
  if (!col.stamp || !uid) return;
  const list = localList(col);
  let changed = false;
  list.forEach((x) => { if (col.valid(x) && !x.who) { x.who = uid; changed = true; } });
  if (changed) writeList(col, list);
}
function shared(col, x) { return col.valid(x) && !(col.local && col.local(x)); }
function localMap(col) {
  const m = {};
  localList(col).forEach((x) => { if (shared(col, x)) m[x.id] = canon(x); });
  return m;
}
function syncMeta(col) {
  if (!state.meta) state.meta = {};
  return state.meta[col.name] || (state.meta[col.name] = { cursor: 0, fullAt: 0 });
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
  // 지울 때도 문서를 없애지 않고 '지움 표시'를 남겨야 상대가 '바뀐 것만' 물어봐도 알 수 있음
  const p = F.setDoc(ref, c === undefined
    ? { id, del: true, by: uid, at: F.serverTimestamp() }
    : { id, j: c, by: uid, at: F.serverTimestamp() });
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
  if (!uid || !state.cid) return; // 로그인 전에는 올리지 않음
  stamp(col);
  const L = localMap(col), B = baseOf(col);
  new Set(Object.keys(L).concat(Object.keys(B))).forEach((id) => { if (L[id] !== B[id]) push(col, id, L[id]); });
}

// 서버 상태가 오면 세 갈래 비교
// full: 서버 전체를 받은 경우(서버에 없는 건 지워진 것), 아니면 R에 든 것(바뀐 것)만 비교
function reconcile(col, R, full) {
  stamp(col);
  const list = localList(col);
  const L = localMap(col), B = baseOf(col);
  const ids = full ? new Set(Object.keys(L).concat(Object.keys(B), Object.keys(R))) : new Set(Object.keys(R));
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
    if (!shared(col, x) || !(x.id in replace)) { next.push(x); return; } // 나만 보기 항목은 절대 안 건드림
    seen[x.id] = true;
    if (replace[x.id]) next.push(replace[x.id]);
  });
  Object.keys(replace).forEach((id) => { if (!seen[id] && replace[id]) next.push(replace[id]); });
  writeList(col, next);
  window.dispatchEvent(new CustomEvent('ournote:remote', { detail: { key: col.key } }));
  window.dispatchEvent(new Event('ournote:changed'));
}

let flushTimer = null;
Storage.prototype.setItem = function (k, v) {
  rawSet.call(this, k, v);
  if (this === localStorage && (k === 'ournote:items' || k === 'ournote:course2')) window.dispatchEvent(new Event('ournote:changed'));
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
    if (joined) { toast('연결됐어요 💞'); state.invite = null; saveState(); }
    if (changed && ov && mode === 'sync' && !pendingInvite) paint();
    setStatus(status);
  }, () => {}));
  COLS.forEach((col) => {
    const meta = syncMeta(col);
    // 평소에는 마지막으로 받은 뒤 바뀐 것만, 처음이거나 일주일이 지났으면 전체
    const full = !meta.fullAt || Date.now() - meta.fullAt > FULL_EVERY;
    const ref = F.collection(db, 'couples', cid, col.name);
    const q = full ? ref : F.query(ref, F.where('at', '>', F.Timestamp.fromMillis(Math.max(0, meta.cursor - OVERLAP))));
    let fullDone = false;
    const off = F.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      if (state.cid !== cid) return;
      if (snap.metadata.fromCache) { setStatus('offline'); return; } // 서버에서 확인된 것만 비교
      const R = {};
      let maxAt = meta.cursor;
      snap.forEach((d) => {
        const v = d.data();
        const id = typeof v.id === 'string' ? v.id : decodeURIComponent(d.id);
        const at = v.at && v.at.toMillis ? v.at.toMillis() : 0;
        if (!d.metadata.hasPendingWrites && at > maxAt) maxAt = at;
        if (v.del) {
          R[id] = undefined;
          // 오래된 지움 표시는 정리(전체를 맞출 때만)
          if (full && at && Date.now() - at > TOMB_KEEP) F.deleteDoc(d.ref).catch(() => {});
          return;
        }
        if (typeof v.j !== 'string') return;
        try { const o = JSON.parse(v.j); if (col.valid(o)) R[id] = canon(o); } catch (e) { /* 깨진 문서 무시 */ }
      });
      reconcile(col, R, full); // 전체 모드는 매번 컬렉션 전부가 옴
      if (full && !fullDone) { fullDone = true; meta.fullAt = Date.now(); }
      meta.cursor = maxAt;
      saveState();
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
  state = { cid: ref.id, base: {}, uid }; // base가 비어 있으니 지금 있는 약속이 전부 올라감
  saveState();
  start();
  return ref.id;
}

async function createInvite() {
  const cid = await ensureCouple();
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    try {
      const exp = Date.now() + INVITE_HOURS * 3600 * 1000;
      await F.setDoc(F.doc(db, 'invites', code), { cid, by: uid, exp: F.Timestamp.fromMillis(exp) });
      // 새 코드로 바꾸면 예전 코드는 바로 못 쓰게
      if (state.invite && state.invite.code !== code) F.deleteDoc(F.doc(db, 'invites', state.invite.code)).catch(() => {});
      state.invite = { code, exp };
      saveState();
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
  if (d.cid === state.cid) return { error: members === 1 ? '내가 만든 코드예요. 상대 폰에서 넣어주세요' : '이미 이 커플과 연결돼 있어요' };
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
    COLS.forEach((col) => writeList(col, localList(col).filter((x) => col.valid(x) && !shared(col, x)))); // 나만 보기는 남김
    window.dispatchEvent(new CustomEvent('ournote:remote', { detail: { key: '*' } }));
  }
  state = { cid: inv.cid, base: {}, uid };
  saveState();
  await start();
}

// 끊어도 지금까지의 데이터는 이 폰에 그대로 남음
async function leave(silent) {
  const cid = state.cid;
  const inv = state.invite; // 쓰지 않은 초대코드도 같이 없앰
  stop();
  state = { cid: '', base: {}, uid };
  saveState();
  setStatus('off');
  if (!cid) return;
  try {
    await firebase();
    if (inv && inv.code) await F.deleteDoc(F.doc(db, 'invites', inv.code)).catch(() => {});
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
.sy-link{display:block;margin:10px auto 0;border:0;background:none;color:var(--muted,#7d6f7a);font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
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
let mode = 'sync'; // sync | backup
function open(kind) {
  addStyle();
  close();
  mode = kind === 'backup' ? 'backup' : 'sync';
  ov = document.createElement('div');
  ov.className = 'sy-ov';
  ov.innerHTML = '<div class="sy-sheet" role="dialog" aria-modal="true" aria-label="' + (mode === 'backup' ? '백업' : '같이 쓰기') + '"></div>';
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov && ov.classList.add('show'));
  // 이벤트는 한 번만 붙임(다시 그려도 중복되지 않게)
  const s = sheet();
  s.addEventListener('click', (e) => { if (mode === 'backup') onBackupClick(e); else onClick(e); });
  s.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.target.matches('[data-code]')) { e.preventDefault(); onJoin(); }
    else if (e.target.matches('[data-rcode]')) { e.preventDefault(); onRestoreLookup(); }
  });
  if (mode === 'sync') listeners.add(paintStatus);
  paint();
}
function sheet() { return ov && ov.querySelector('.sy-sheet'); }

function paint() {
  const s = sheet();
  if (!s) return;
  if (mode === 'backup') { paintBackup(); return; }
  const X = '<button type="button" class="sy-close" data-x aria-label="닫기">×</button>';
  if (state.cid) {
    s.innerHTML = X + '<h2>💞 같이 쓰는 중</h2>' +
      '<div class="sy-stat" data-stat></div>' +
      '<p>둘 중 한 명이 약속을 넣거나 고치면 상대 폰에도 바로 보여요. 인터넷이 없을 때 고친 것도 다시 연결되면 맞춰져요.</p>' +
      (members === 1
        // 아직 상대가 안 들어왔으면: 내 코드 보내기 또는 상대 코드 넣기
        ? '<div class="sy-div">상대에게 보낼 초대코드</div>' + inviteBlock(true) +
          '<div class="sy-div">상대에게 코드를 받았다면</div>' + joinRow() +
          '<div class="sy-err" data-err></div>' +
          '<button type="button" class="sy-link" data-act="leave">기다리기 그만하기</button>'
        : '<div class="sy-div">폰을 바꿨거나 상대가 연결이 끊겼다면</div>' + inviteBlock(false) +
          '<div class="sy-div">그만 같이 쓰기</div>' +
          '<button type="button" class="sy-btn wide danger" data-act="leave">연결 끊기</button>' +
          '<div class="sy-err" data-err></div>');
    paintStatus();
  } else {
    s.innerHTML = X + '<h2>💞 같이 쓰기</h2>' +
      '<p>둘이 같은 약속 노트를 함께 써요. 한 명이 초대코드를 만들고, 다른 한 명이 그 코드를 넣으면 연결돼요. 🔒 나만 보기 약속은 상대에게 보이지 않아요.</p>' +
      inviteBlock(true) +
      '<div class="sy-div">상대에게 코드를 받았다면</div>' + joinRow() +
      '<div class="sy-err" data-err></div>';
  }
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
    const waiting = members === 1;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = waiting ? '한 번 더 누르면 초대가 취소돼요' : '정말 끊을까요? 한 번 더 누르면 끊겨요'; return; }
    busy(b, true, '끊는 중…');
    await leave(false);
    paint();
    toast(waiting ? '초대를 취소했어요' : '연결을 끊었어요 · 지금까지의 약속은 이 폰에 남아 있어요');
  }
}
// 초대코드를 만든 순간 커플이 생겨 화면이 '같이 쓰는 중'으로 바뀌지만, 방금 만든 코드는 계속 보여줌
function paintKeepCode() { paint(); }
function joinRow() {
  return '<div class="sy-row"><input class="sy-in" data-code maxlength="7" placeholder="ABC-123" autocomplete="off" autocapitalize="characters" enterkeyhint="go">' +
    '<button type="button" class="sy-btn pri" data-act="join">연결</button></div>';
}
// 아직 쓸 수 있는 코드가 있으면 그 코드를 보여주고 '새 코드로 바꾸기', 없으면 '초대코드 만들기'
function inviteBlock(primary) {
  const inv = state.invite;
  if (inv && inv.exp > Date.now() + 60000) {
    const d = new Date(inv.exp), pad = (n) => (n < 10 ? '0' : '') + n;
    return '<div class="sy-code">' + showCode(inv.code) + '</div>' +
      '<div class="sy-hint">' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) +
      '까지 한 번 쓸 수 있어요 · 상대 폰의 ‘같이 쓰기’에서 넣어주세요</div>' +
      '<button type="button" class="sy-btn wide" data-act="copy" data-c="' + showCode(inv.code) + '">코드 복사</button>' +
      '<button type="button" class="sy-link" data-act="invite">🔄 새 코드로 바꾸기</button>';
  }
  return '<button type="button" class="sy-btn ' + (primary ? 'pri ' : '') + 'wide" data-act="invite">' + (primary ? '초대코드 만들기' : '새 초대코드 만들기') + '</button>';
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
    const n = localList(COLS[0]).filter((x) => shared(COLS[0], x)).length; // 나만 보기는 어차피 안 올라감
    const m = localList(COLS[1]).filter((x) => shared(COLS[1], x)).length;
    const s = sheet();
    if (!n && !m) {
      await joinInvite(r, true);
      pendingInvite = null;
      paint();
      toast('연결됐어요 💞');
      return;
    }
    s.innerHTML = '<h2>이 폰에 있던 약속은?</h2>' +
      '<p>이 폰에 같이 볼 ' + [n ? '약속 ' + n + '개' : '', m ? '데이트 코스 일정 ' + m + '개' : ''].filter(Boolean).join(', ') + '가 있어요. 상대 것과 합칠까요, 아니면 버리고 상대 것만 볼까요? 🔒 나만 보기 약속은 어느 쪽이든 이 폰에 그대로 남아요.</p>' +
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

// ---------- 백업 ----------
// B. 서버 자동 백업: 복구 코드로 암호화해서 서버의 '내 칸'(주소도 코드에서 만듦)에 최신본 한 개만 저장
//    → 코드를 모르면 누구도(서버 주인도) 못 열어봄. 🔒 나만 보기 약속과 데이트 코스까지 전부.
// A. 파일 백업: 'Ournote 백업파일.json'
const BK_KEY = 'ournote:backup'; // { code, lastHash, lastAt }
const BK_DATA = ['ournote:items', 'ournote:course2'];
const BK_DELAY = 30 * 1000;
let bk = readJSON(BK_KEY, null);
if (!bk || typeof bk !== 'object') bk = { code: '', lastHash: '', lastAt: 0 };
function saveBk() { writeRaw(BK_KEY, bk); if (typeof updateBackupButtons === 'function') updateBackupButtons(); }

function makeRecovery() {
  const a = new Uint32Array(16);
  crypto.getRandomValues(a);
  const c = Array.from(a, (n) => CODE_ABC[n % CODE_ABC.length]).join('');
  return c.match(/.{4}/g).join('-');
}
function cleanRecovery(s) { const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length === 16 ? c.match(/.{4}/g).join('-') : ''; }
const enc = new TextEncoder();
function hex(buf) { return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''); }
async function sha(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
async function slotId(code) { return sha('ournote-backup-id:' + code); }
async function aesKey(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('ournote-backup-key'), iterations: 120000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function b64(bytes) { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); }
function unb64(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); }

function snapshot() {
  return { app: 'ournote', v: 2, savedAt: Date.now(), items: readJSON('ournote:items', []), course2: readJSON('ournote:course2', null) };
}
function counts(d) {
  const items = Array.isArray(d.items) ? d.items.length : 0;
  const stops = d.course2 && Array.isArray(d.course2.stops) ? d.course2.stops.length : 0;
  return '약속 ' + items + '개 · 코스 일정 ' + stops + '개';
}
function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms), pad = (n) => (n < 10 ? '0' : '') + n;
  return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

let bkTimer = null, bkBusy = false;
async function backupNow(force) {
  if (!bk.code || bkBusy) return false;
  const data = snapshot();
  const h = await sha(canon({ items: data.items, course2: data.course2 }));
  if (!force && h === bk.lastHash) return true; // 바뀐 게 없으면 안 씀
  bkBusy = true;
  try {
    await firebase();
    const key = await aesKey(bk.code);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
    const all = new Uint8Array(iv.length + ct.length);
    all.set(iv); all.set(ct, iv.length);
    await F.setDoc(F.doc(db, 'backups', await slotId(bk.code)), { d: b64(all), v: 1, at: F.serverTimestamp() });
    bk.lastHash = h;
    bk.lastAt = Date.now();
    saveBk();
    if (mode === 'backup' && ov) paintBackup();
    return true;
  } catch (e) {
    console.warn('backup', e);
    return false;
  } finally { bkBusy = false; }
}
function scheduleBackup(ms) {
  if (!bk.code) return;
  clearTimeout(bkTimer);
  bkTimer = setTimeout(() => backupNow(false), ms);
}
async function fetchBackup(code) {
  await firebase();
  const snap = await F.getDoc(F.doc(db, 'backups', await slotId(code)));
  if (!snap.exists()) return null;
  const all = unb64(snap.data().d);
  const key = await aesKey(code);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

// 되살리기는 '합치기': 백업에 있는 건 넣거나 그 내용으로 바꾸고, 지금 있는 건 지우지 않음
// (같이 쓰기 중이어도 상대 약속이 사라지지 않게)
function mergeById(cur, add) {
  const out = Array.isArray(cur) ? cur.slice() : [];
  const at = {};
  out.forEach((x, i) => { if (x && x.id) at[x.id] = i; });
  (Array.isArray(add) ? add : []).forEach((x) => {
    if (!x || !x.id) return;
    if (x.id in at) out[at[x.id]] = x; else { at[x.id] = out.length; out.push(x); }
  });
  return out;
}
function restoreData(d) {
  const items = (Array.isArray(d) ? d : d.items || []).filter((x) => x && typeof x.title === 'string' && x.title.trim());
  localStorage.setItem('ournote:items', JSON.stringify(mergeById(readJSON('ournote:items', []), items)));
  if (d.course2 && Array.isArray(d.course2.stops)) {
    const cur = readJSON('ournote:course2', null) || { stops: [], ranges: [], view: d.course2.view || { start: '', end: '' } };
    cur.stops = mergeById(cur.stops, d.course2.stops);
    const keyOf = (r) => (r.start || '') + '|' + (r.end || r.start || '');
    const have = {};
    (cur.ranges = Array.isArray(cur.ranges) ? cur.ranges : []).forEach((r) => { have[keyOf(r)] = true; });
    (d.course2.ranges || []).forEach((r) => { if (r && !have[keyOf(r)]) { have[keyOf(r)] = true; cur.ranges.push(r); } });
    localStorage.setItem('ournote:course2', JSON.stringify(cur));
  }
  window.dispatchEvent(new CustomEvent('ournote:remote', { detail: { key: '*' } }));
}

// A. 파일
async function saveFile() {
  const name = 'Ournote 백업파일.json';
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function pickFile() {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) { res(null); return; }
      const r = new FileReader();
      r.onload = () => { try { res(JSON.parse(String(r.result || ''))); } catch (e) { res(false); } };
      r.onerror = () => res(false);
      r.readAsText(f);
    };
    inp.click();
  });
}

let restoreFound = null;
function paintBackup() {
  const s = sheet();
  if (!s) return;
  const X = '<button type="button" class="sy-close" data-x aria-label="닫기">×</button>';
  if (restoreFound) {
    s.innerHTML = X + '<h2>백업을 찾았어요</h2>' +
      '<p>' + esc(counts(restoreFound)) + (restoreFound.savedAt ? ' · ' + esc(fmtTime(restoreFound.savedAt)) + ' 저장' : '') + '</p>' +
      '<p>지금 이 폰에 있는 건 지우지 않고, 백업에 있는 걸 더하거나 그 내용으로 바꿔요.</p>' +
      '<button type="button" class="sy-btn pri wide" data-act="bk-apply">이 폰에 되살리기</button><div style="height:8px"></div>' +
      '<button type="button" class="sy-btn wide" data-act="bk-cancel">취소</button><div class="sy-err" data-err></div>';
    return;
  }
  if (!bk.code) {
    s.innerHTML = X + '<h2>🗂 백업</h2>' +
      '<p>자동 백업을 켜면 약속과 데이트 코스가 바뀔 때마다 알아서 서버에 저장돼요. 🔒 나만 보기 약속도 들어가요.</p>' +
      '<button type="button" class="sy-btn pri wide" data-act="bk-on">자동 백업 켜기</button>' +
      '<div class="sy-div">폰을 바꿨거나 데이터가 사라졌다면</div>' +
      '<div class="sy-row"><input class="sy-in" data-rcode maxlength="19" placeholder="복구 코드" autocomplete="off" autocapitalize="characters" style="font-size:15px;letter-spacing:1px">' +
      '<button type="button" class="sy-btn pri" data-act="bk-find">찾기</button></div>' +
      '<div class="sy-div">파일로</div>' +
      '<div class="sy-row"><button type="button" class="sy-btn" style="flex:1" data-act="bk-file">파일로 저장</button>' +
      '<button type="button" class="sy-btn" style="flex:1" data-act="bk-load">파일 불러오기</button></div>' +
      '<div class="sy-err" data-err></div>';
    return;
  }
  s.innerHTML = X + '<h2>🗂 자동 백업 켜짐</h2>' +
    '<div class="sy-stat"><span class="sy-dot ' + (bk.lastAt ? 'live' : '') + '"></span>' +
    (bk.lastAt ? '마지막 백업 ' + esc(fmtTime(bk.lastAt)) : '아직 백업 전이에요') + '</div>' +
    '<p>아래 <b>복구 코드</b>를 꼭 캡처해 두세요. 폰을 바꾸거나 잃어버려도 이 코드만 있으면 그대로 되살릴 수 있어요. 코드를 잃어버리면 백업을 찾을 수도, 되살릴 수도 없어요.</p>' +
    '<div class="sy-code" style="font-size:22px;letter-spacing:2px">' + esc(bk.code) + '</div>' +
    '<button type="button" class="sy-btn wide" data-act="copy" data-c="' + esc(bk.code) + '">복구 코드 복사</button><div style="height:8px"></div>' +
    '<button type="button" class="sy-btn wide" data-act="bk-now">즉시 백업하기</button>' +
    '<div class="sy-div">다른 백업에서 되살리기</div>' +
    '<div class="sy-row"><input class="sy-in" data-rcode maxlength="19" placeholder="복구 코드" autocomplete="off" autocapitalize="characters" style="font-size:15px;letter-spacing:1px">' +
    '<button type="button" class="sy-btn pri" data-act="bk-find">찾기</button></div>' +
    '<div class="sy-div">파일로</div>' +
    '<div class="sy-row"><button type="button" class="sy-btn" style="flex:1" data-act="bk-file">파일로 저장</button>' +
    '<button type="button" class="sy-btn" style="flex:1" data-act="bk-load">파일 불러오기</button></div>' +
    '<div class="sy-err" data-err></div>';
}

async function onRestoreLookup() {
  const inp = ov && ov.querySelector('[data-rcode]');
  const btn = ov && ov.querySelector('[data-act="bk-find"]');
  if (!inp) return;
  const code = cleanRecovery(inp.value);
  err('');
  if (!code) { err('복구 코드 16자리를 넣어주세요'); return; }
  busy(btn, true, '찾는 중…');
  try {
    const d = await fetchBackup(code);
    busy(btn, false);
    if (!d) { err('이 코드로 저장된 백업이 없어요'); return; }
    restoreFound = d;
    restoreFound.code = code;
    paintBackup();
  } catch (x) { busy(btn, false); err(x && x.name === 'OperationError' ? '코드가 맞지 않아요' : failText(x)); console.warn(x); }
}

async function onBackupClick(e) {
  if (e.target.closest('[data-x]')) { restoreFound = null; close(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.getAttribute('data-act');
  err('');
  if (act === 'copy') {
    const c = b.getAttribute('data-c');
    try { await navigator.clipboard.writeText(c); b.textContent = '복사했어요'; } catch (x) { b.textContent = c; }
  } else if (act === 'bk-on') {
    busy(b, true, '켜는 중…');
    bk = { code: makeRecovery(), lastHash: '', lastAt: 0 };
    saveBk();
    const ok = await backupNow(true);
    paintBackup();
    if (!ok) err(failText());
  } else if (act === 'bk-now') {
    busy(b, true, '백업하는 중…');
    const ok = await backupNow(true);
    busy(b, false);
    if (ok) toast('백업했어요'); else err(failText());
  } else if (act === 'bk-find') {
    onRestoreLookup();
  } else if (act === 'bk-apply') {
    const d = restoreFound;
    restoreData(d);
    // 이 폰도 앞으로 같은 코드로 백업(폰을 바꾼 경우 그대로 이어짐)
    if (!bk.code && d.code) bk = { code: d.code, lastHash: '', lastAt: 0 };
    saveBk();
    restoreFound = null;
    paintBackup();
    toast('되살렸어요');
    scheduleBackup(2000);
  } else if (act === 'bk-cancel') {
    restoreFound = null;
    paintBackup();
  } else if (act === 'bk-file') {
    saveFile();
  } else if (act === 'bk-load') {
    const d = await pickFile();
    if (d === null) return;
    if (!d || !(Array.isArray(d) || Array.isArray(d.items))) { err('우리 약속 노트 백업 파일이 아니에요'); return; }
    restoreFound = Array.isArray(d) ? { items: d } : d;
    paintBackup();
  }
}

function updateBackupButtons() {
  document.querySelectorAll('[data-backup-btn]').forEach((b) => {
    b.innerHTML = bk.code ? '<span class="sy-dot live"></span>🗂 백업 켜짐' : '🗂 백업';
  });
}

// ---------- 시작 ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sync-btn]')) { e.preventDefault(); open('sync'); }
  if (e.target.closest('[data-backup-btn]')) { e.preventDefault(); open('backup'); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov) close(); });
addStyle();
updateButtons();
updateBackupButtons();
// 자동 백업: 약속·코스가 바뀌면 30초 뒤(그 사이 또 바뀌면 미룸), 앱을 내릴 때는 바로
window.addEventListener('ournote:changed', () => scheduleBackup(BK_DELAY));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && bkTimer) { clearTimeout(bkTimer); bkTimer = null; backupNow(false); } });
if (bk.code) scheduleBackup(5000); // 지난번에 못 올린 게 있으면
window.addEventListener('online', () => { if (state.cid && status !== 'live') start(); });
if (state.cid) start();

window.OurSync = { open, status: () => status, state: () => state, backup: () => bk };
