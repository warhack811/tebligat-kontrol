import { Gate } from './domain.js';
export class Camera {
    constructor(video, notify) { this.video = video; this.notify = notify; this.gate = new Gate(); this.generation = 0; this.active = false; this.stream = null; this.worker = null; this.timer = null; this.lastCode = null; this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }); }
    async start(deviceId) { this.stop(); const g = this.generation; this.notify('starting'); try {
        if (!navigator.mediaDevices?.getUserMedia)
            throw Error('Kamera için HTTPS ve desteklenen tarayıcı gerekli.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }), width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (g !== this.generation) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        this.stream = stream;
        this.video.srcObject = stream;
        await this.video.play();
        if (g !== this.generation)
            return;
        this.active = true;
        this.worker = new Worker('./decode-worker.js', { type: 'module' });
        this.worker.onerror = () => { if (g === this.generation) {
            this.stop();
            this.notify('error', 'Barkod motoru çalıştırılamadı. Manuel giriş kullanın.');
        } };
        let pending = false, last = 0, id = 0, lastVideoTime = -1, lastAdvance = performance.now();
        this.worker.onmessage = ({ data }) => { if (g !== this.generation || !this.active || data.id !== id)
            return; pending = false; if (data.error) {
            this.stop();
            this.notify('error', 'Barkod çözümleme hatası.');
            return;
        } const result = this.gate.feed(data.codes, performance.now()); if (result.kind === 'accept')
            this.lastCode = result.b; this.notify(result.kind, result.b); };
        stream.getVideoTracks()[0].addEventListener('ended', () => { if (g === this.generation) {
            this.stop();
            this.notify('error', 'Kamera bağlantısı kesildi. Yeniden başlatın.');
        } });
        const tick = () => { if (g !== this.generation || !this.active)
            return; if (pending && performance.now() - last > 4000) {
            this.stop();
            this.notify('error', 'Kamera çözümleyicisi yanıt vermedi.');
            return;
        } if (performance.now() - lastAdvance > 6000) { this.stop(); this.notify('error', 'Kamera görüntüsü yenilenmiyor. Kamerayı yeniden başlatın.'); return; } if (!pending && this.video.readyState >= 2 && this.video.videoWidth && this.video.currentTime !== lastVideoTime) {
            lastVideoTime = this.video.currentTime; lastAdvance = performance.now();
            try {
                const w = this.video.videoWidth, h = this.video.videoHeight;
                const box = this.video.getBoundingClientRect();
                const fit = Math.min(box.width / w, box.height / h);
                const vw = w * fit, vh = h * fit;
                const target = this.video.parentElement.querySelector('.target');
                if (target && vw > 0 && vh > 0) {
                    target.style.left = (box.width - vw) / 2 + vw * .03 + 'px';
                    target.style.right = (box.width - vw) / 2 + vw * .03 + 'px';
                    target.style.top = (box.height - vh) / 2 + vh * .24 + 'px';
                    target.style.bottom = (box.height - vh) / 2 + vh * .24 + 'px';
                }
                const sw = Math.floor(w * .94), sh = Math.floor(h * .52), sx = Math.floor((w - sw) / 2), sy = Math.floor((h - sh) / 2);
                const scale = Math.min(1, 1500 / Math.max(sw, sh));
                this.canvas.width = Math.floor(sw * scale);
                this.canvas.height = Math.floor(sh * scale);
                this.ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
                const image = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                pending = true;
                last = performance.now();
                this.worker.postMessage({ id: ++id, image }, [image.data.buffer]);
            }
            catch {
                this.stop();
                this.notify('error', 'Kamera karesi alınamadı.');
                return;
            }
        } this.timer = setTimeout(tick, 140); };
        this.notify('ready', stream.getVideoTracks()[0].getCapabilities?.() || {});
        tick();
    }
    catch (e) {
        if (g !== this.generation)
            return;
        this.stop();
        this.notify('error', e.name === 'NotAllowedError' ? 'Kamera izni verilmedi. Tarayıcı ayarlarından izin verin veya manuel giriş kullanın.' : e.name === 'NotReadableError' ? 'Kamera başka bir uygulama tarafından kullanılıyor olabilir.' : 'Kamera başlatılamadı. HTTPS, kamera izni ve tarayıcı desteğini kontrol edin.');
    } }
    stop() { this.generation++; this.active = false; clearTimeout(this.timer); this.worker?.terminate(); this.worker = null; this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.video.pause(); this.video.srcObject = null; this.canvas.width = 1; this.canvas.height = 1; this.gate.reset(this.lastCode); }
    rearm(b) { this.gate.reset(b || this.lastCode); }
    async torch(on) { const t = this.stream?.getVideoTracks()[0]; if (!t?.getCapabilities?.().torch)
        return false; try {
        await t.applyConstraints({ advanced: [{ torch: on }] });
        return true;
    }
    catch {
        return false;
    } }
}
