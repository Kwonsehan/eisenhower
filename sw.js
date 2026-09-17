/* ============================================================
   sw.js - Service Worker
   
   역할:
   - 앱 파일들을 브라우저 캐시에 저장합니다.
   - 인터넷이 없어도 (오프라인 상태에서도) 앱이 열리게 합니다.
   - 홈화면에 추가한 후 빠르게 로딩되도록 도와줍니다.
============================================================ */

// 캐시 버전 이름 (파일을 업데이트할 때 이 이름을 바꾸면 새 버전으로 갱신됩니다)
const CACHE_NAME = 'eisenhower-v1';

// 캐시에 저장할 파일 목록
const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/* ─── 설치(install) 단계 ──────────────────────────────────
   Service Worker가 처음 등록될 때 실행됩니다.
   앱 파일들을 캐시에 미리 저장합니다.
────────────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] 파일 캐싱 중...');
      // 외부 CDN(Tailwind, Chart.js)은 캐시 실패해도 앱은 동작하도록
      // addAll 대신 개별 add로 오류를 무시합니다
      return Promise.allSettled(
        FILES_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] 캐싱 실패 (무시됨): ${url}`, err);
          })
        )
      );
    })
  );
  // 이전 버전 SW를 기다리지 않고 즉시 활성화
  self.skipWaiting();
});

/* ─── 활성화(activate) 단계 ──────────────────────────────
   새 버전의 SW가 활성화될 때 이전 캐시를 삭제합니다.
────────────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME) // 현재 버전이 아닌 캐시
          .map((name) => {
            console.log('[SW] 오래된 캐시 삭제:', name);
            return caches.delete(name);
          })
      )
    )
  );
  // 즉시 모든 탭에 새 SW 적용
  self.clients.claim();
});

/* ─── 요청(fetch) 가로채기 ────────────────────────────────
   파일 요청 시:
   1. 캐시에 있으면 캐시에서 빠르게 제공
   2. 캐시에 없으면 네트워크에서 가져온 후 캐시에 저장
────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  // chrome-extension:// 같은 특수 프로토콜은 무시
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 캐시 히트: 캐시에서 즉시 반환
        return cachedResponse;
      }

      // 캐시 미스: 네트워크에서 가져오기
      return fetch(event.request)
        .then((networkResponse) => {
          // 유효한 응답만 캐시에 저장 (CDN 파일 등)
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // 네트워크도 실패한 경우: 오프라인 폴백
          // HTML 요청이면 캐시된 index.html을 반환
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
