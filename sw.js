// sw.js — Service Worker: App-Hülle offline verfügbar halten
const VERSION = 'haushaltch-v1.3.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './vendor/xlsx.full.min.js',
  './vendor/msal-browser.min.js',
  './js/main.js',
  './js/core/util.js',
  './js/core/model.js',
  './js/core/categories.js',
  './js/core/store.js',
  './js/core/fx.js',
  './js/core/rules.js',
  './js/core/parsers.js',
  './js/core/importer.js',
  './js/core/analytics.js',
  './js/core/budget.js',
  './js/core/goals.js',
  './js/core/reports.js',
  './js/core/sync.js',
  './js/core/investments.js',
  './js/core/quotes.js',
  './js/core/ibkr.js',
  './js/core/recurring.js',
  './js/core/forecast.js',
  './js/ui/charts.js',
  './js/ui/components.js',
  './js/ui/dashboard.js',
  './js/ui/accounts.js',
  './js/ui/transactions.js',
  './js/ui/budget.js',
  './js/ui/goals.js',
  './js/ui/networth.js',
  './js/ui/investments.js',
  './js/ui/planning.js',
  './js/ui/reports.js',
  './js/ui/importview.js',
  './js/ui/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Microsoft Graph und Kursabfragen niemals aus dem Cache bedienen
  if (url.hostname.endsWith('microsoft.com') || url.hostname.endsWith('microsoftonline.com')
      || url.hostname.endsWith('frankfurter.app')) return;

  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) {
        // Im Hintergrund auffrischen
        fetch(e.request).then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
