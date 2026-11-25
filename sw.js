importScripts('./sw-assets.js');
const CACHE = 'tebligat-' + VERSION;
const assets = new Map(Object.entries(HASHES).map(([a, h]) => [new URL(a, self.registration.scope).href, h]));
const entry = self.registration.scope;
const index = new URL('index.html', entry).href;
async function verified(url) { const r = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin', redirect: 'error' })); if (!r.ok)
    throw Error('Missing asset'); const b = await r.clone().arrayBuffer(); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join(''); if (hash !== assets.get(url))
    throw Error('Asset integrity mismatch'); return r; }
self.addEventListener('install', e => e.waitUntil((async () => { const c = await caches.open(CACHE); try {
    for (const url of assets.keys())
        await c.put(url, await verified(url));
}
catch (err) {
    await caches.delete(CACHE);
    throw err;
} })()));
// Never force activation while any old client may hold an unsaved session.
self.addEventListener('activate', e => e.waitUntil((async () => { for (const key of await caches.keys())
    if (key.startsWith('tebligat-') && key !== CACHE)
        await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener('fetch', e => { const r = e.request; if (r.method !== 'GET') {
    e.respondWith(new Response('Blocked', { status: 403 }));
    return;
} const url = r.mode === 'navigate' && [entry, index].includes(r.url) ? entry : r.url; if (!assets.has(url)) {
    e.respondWith(new Response('Blocked', { status: 403 }));
    return;
} e.respondWith((async () => { const c = await caches.open(CACHE); const hit = await c.match(url); if (hit)
    return hit; try {
    const fresh = await verified(url);
    await c.put(url, fresh.clone());
    return fresh;
}
catch {
    return new Response('Offline cache incomplete', { status: 503 });
} })()); });
