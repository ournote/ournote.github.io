// 배포할 때마다 VERSION을 올리면 이전 캐시가 정리되고 새 앱 셸이 저장된다.
const VERSION = 'v1.10.5';
const SHELL_CACHE = 'ournote-shell-' + VERSION;
const FONT_CACHE = 'ournote-fonts';
const SHELL = [
  '/',
  '/index.html',
  '/map.html',
  '/graph.html',
  '/v2.html',
  '/course.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('ournote-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: 캐시 우선, 뒤에서 갱신
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // 페이지 열기: 저장해 둔 페이지를 바로 보여주고, 최신본은 뒤에서 받아 다음에 씀
  if (req.mode === 'navigate') {
    const key = url.pathname;
    const network = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(key, copy));
      }
      return res;
    });
    event.respondWith(
      caches.match(key, { ignoreSearch: true }).then((cached) => {
        if (cached) {
          event.waitUntil(network.catch(() => {}));
          return cached;
        }
        return network.catch(() => caches.match('/index.html'));
      })
    );
    return;
  }

  // 그 밖의 정적 파일: 캐시 우선
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
