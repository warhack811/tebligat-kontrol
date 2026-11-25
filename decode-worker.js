import { decodeImage } from './decoder.js';
self.onmessage = ({ data }) => { try {
    self.postMessage({ id: data.id, codes: decodeImage(data.image) });
}
catch {
    self.postMessage({ id: data.id, error: true });
} };
