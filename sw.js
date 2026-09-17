/* ============================================================
   sw.js - Service Worker (Network-First 최신 업데이트 보장 버전)
   
   개선 사항:
   - 항상 인터넷(네트워크)에서 최신 파일을 먼저 가져옵니다 (Network-First).
   - 인터넷 연결이 없을 때만 캐시된 오프라인 파일을 사용합니다.
   - 캐시 버전을 올려 이전의 낡은 캐시를 즉시 완전히 삭제합니다.
============================================================ */

const CACHE_NAME = 'eisenhower-v4';

const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// 설치 시 대기 없이 즉시 활성화
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 활성화 시 이전 버전의 모든 오래된 캐시 즉시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] 오래된 캐시 삭제 완료:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// 요청 가로채기: Network-First (네트워크 우선 -> 실패 시 캐시)
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // 네트워크 연결 성공 시: 최신 응답을 캐시에도 갱신
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
        // 네트워크 실패(오프라인) 시에만 캐시된 파일 제공
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
