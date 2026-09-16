/**
 * Service worker: keeps the app shell available offline.
 *
 * Only the shell is cached. Supabase calls always go to the network — a stale
 * study queue or a stale streak would be worse than an honest failure, and
 * reviews taken offline are parked in the outbox in api.js instead.
 */
const VERSION = 'oxford3000-v2';
const SHELL = [
    './',
    './index.html',
    './styles.css',
    './word-meta-styles.css',
    './app-styles.css',
    './app.js',
    './api.js',
    './icon.svg',
    './manifest.webmanifest',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(VERSION)
            // one bad URL must not fail the whole install
            .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.hostname.endsWith('.supabase.co')) return; // always live

    // Navigations: network first, fall back to the cached shell when offline.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Everything else: serve from cache, refresh it in the background.
    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(VERSION).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
