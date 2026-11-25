import { extractODT } from './zip.js';
self.onmessage = async ({ data }) => { try {
    self.postMessage({ xml: await extractODT(data) });
}
catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : 'ODT açılamadı.' });
} };
