// sw.js — 오프라인 캐시.
// 앱 셸을 설치 시점에 통째로 캐시하고, 이후 같은 출처 요청은 캐시 우선으로 응답한다.
// 학습 데이터는 IndexedDB 에 있으므로 여기서는 다루지 않는다.

const VERSION = 'v2.0.0';
const CACHE = `examtree-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './src/app.js',
  './src/db.js',
  './src/store.js',
  './src/seed-data.js',
  './src/undo.js',
  './src/ui.js',
  './src/tree.js',
  './src/sheet.js',
  './src/review.js',
  './src/search.js',
  './src/backup.js',
  './src/sync.js',
  './src/toolbar.js',
  './src/richtext.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 하나가 실패해도 나머지는 캐시되도록 개별로 넣는다.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
        console.warn('[sw] 캐시 실패:', url, err);
      })
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 문서 요청: 네트워크를 먼저 시도하되 실패하면 캐시된 앱 셸을 돌려준다.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match('./index.html') || await caches.match('./');
        return cached || new Response('오프라인입니다.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  // 그 밖의 같은 출처 자산: 캐시 우선, 없으면 네트워크에서 받아 캐시에 넣는다.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
