/* ============================================================================
 * sw.js — Service Worker für das Digitale Bullet Journal
 * ----------------------------------------------------------------------------
 * GitHub-Pages-kompatibel: ausschließlich RELATIVE Pfade. Der Scope ergibt sich
 * automatisch aus dem Verzeichnis, in dem dieser Service Worker registriert
 * wird (self.location). Es ist KEIN hartcodierter Repository-Pfad nötig.
 * Strategie: "Cache First" für die App-Shell, Netzwerk-Fallback, Offline-Seite.
 * ========================================================================== */

'use strict';

const CACHE_NAME = 'bujo_pwa_v2';

/* Basisverzeichnis aus dem SW-Standort ableiten (z. B. "/repo/" auf GH Pages
 * oder "/" auf localhost). So funktionieren die Cache-Einträge überall. */
const BASE = self.location.pathname.replace(/sw\.js$/, '');

/* App-Shell — relative Pfade, an das Basisverzeichnis gehängt. */
const urlsToCache = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'style.css',
  BASE + 'script.js',
  BASE + 'offline.html',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/apple-touch-icon.png'
];

/* --- install: App-Shell vorab cachen ------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // addAll bricht bei einem fehlenden Asset komplett ab — daher einzeln
        // cachen, damit ein optionales Asset den Install nicht blockiert.
        return Promise.all(
          urlsToCache.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Konnte nicht cachen:', url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* --- activate: alte Caches aufräumen ------------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* --- fetch: Cache First mit Netzwerk-Fallback ---------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Nur GET-Anfragen behandeln (POST/PUT etc. durchreichen).
  if (req.method !== 'GET') return;

  // Cross-Origin-Anfragen (z. B. CryptoJS-CDN) nicht abfangen — direkt ans Netz.
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (!sameOrigin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((response) => {
          // Erfolgreiche Antworten in den Cache legen (Kopie, da Stream).
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline: Bei Navigations-Anfragen die Offline-Seite ausliefern.
          if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
            return caches.match(BASE + 'offline.html');
          }
          // Sonst eine leere Fehler-Antwort.
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});

/* --- message: manuelles Update / Skip-Waiting ---------------------------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
