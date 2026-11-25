importScripts('./sw-assets.js');
const PREFIX = 'tebligat-v2-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE = PREFIX + VERSION;
const assets = new Map(Object.entries(HASHES).map(([a, h]) => [new URL(a, self.registration.scope).href, h]));
const entry = self.registration.scope;
const index = new URL('index.html', entry).href;
async function verified(url) { const r = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin', redirect: 'error' })); if (!r.ok)
    throw Error('Missing asset'); const b = await r.clone().arrayBuffer(); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join(''); if (hash !== assets.get(url))
    throw Error('Asset integrity mismatch'); return r; }
self.addEventListener('install', e => e.waitUntil((async () => { const existed=(await caches.keys()).includes(CACHE);const c = await caches.open(CACHE); try {
    for (const url of assets.keys()) {
        const hit = await c.match(url);
        if (hit && hit.ok) {
            const bytes = await hit.arrayBuffer();
            const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
            if (digest === assets.get(url)) continue;
        }
        await c.put(url, await verified(url));
    }
}
catch (err) {
    if(!existed)await caches.delete(CACHE);
    throw err;
} })()));
// Never force activation while any old client may hold an unsaved session.
self.addEventListener('activate', e => e.waitUntil((async () => { for (const key of await caches.keys())
    if (key.startsWith(PREFIX) && key !== CACHE)
        await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener('fetch', e => { const r = e.request; if (r.method !== 'GET') {
    e.respondWith(new Response('Blocked', { status: 403 }));
    return;
} const target = new URL(r.url);
    const root = new URL(entry);
    const isAppNavigation = r.mode === 'navigate' && target.origin === root.origin && [root.pathname, new URL(index).pathname].includes(target.pathname);
    // Ignore query parameters only for the exact app entry paths. Never fetch the query.
    const url = isAppNavigation ? entry : r.url; if (!assets.has(url)) {
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
