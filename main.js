import { barcode, session, scan, undo, counts, results } from './domain.js';
import { parseXML, fingerprint } from './odt.js';
import { Camera } from './camera.js';
import { decodeImage } from './decoder.js';
import { VERSION, ASSETS } from './version.js';
const $ = id => document.getElementById(id);
let s = null, pending = null, importGen = 0, importWorker = null, importTimer = null, importReject = null, tab = 'missing', page = 0, sound = true, audio = null, torch = false, wake = null, waiting = null, activeView = 'home', sessionEpoch = 0;
const txt = (id, v) => $(id).textContent = String(v);
const show = (id, v = true) => $(id).hidden = !v;
const listen = (id, ev, fn) => $(id).addEventListener(ev, fn);
const click = (id, fn) => listen(id, 'click', fn);
const notice = (text = '') => { txt('global', text); show('global', !!text); };
// Best-effort same-origin warning, no document data shared across tabs.
let channel = null; const otherTabs = new Map(); const tabId = Math.random().toString(36).slice(2);
function announce(active = !!s) { try { channel?.postMessage({ type: 'presence', id: tabId, active }); } catch {} }
function checkTabs() { const now = Date.now(); for (const [id, time] of otherTabs) if (now - time > 20000) otherTabs.delete(id); show('tabWarning', !!s && otherTabs.size > 0); }
try { if ('BroadcastChannel' in window) { channel = new BroadcastChannel('tebligat-presence-v1'); channel.onmessage = ({ data }) => { if (data?.type !== 'presence' || typeof data.id !== 'string' || data.id === tabId) return; const known = otherTabs.has(data.id); if (data.active) otherTabs.set(data.id, Date.now()); else otherTabs.delete(data.id); if (data.active && !known && s) announce(true); checkTabs(); }; setInterval(() => { if (s) announce(); checkTabs(); }, 8000); } } catch {}
function view(v) { activeView = v; show('home', v === 'home'); show('preview', v === 'preview'); show('work', v === 'work' || v === 'result'); show('scanPanel', v === 'work'); show('resultPanel', v === 'result'); $('updateBtn').disabled = !!s || !!pending || !!importWorker; }
function element(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; if (cls)
    e.className = cls; return e; }
function record(r, mask = false) { const el = element('div', undefined, 'record'); el.append(element('strong', mask ? 'Barkod kaydı' : r.recipient || 'Barkod kaydı'), element('p', [mask ? '' : r.caseNo, r.barcode, r.source === 'manual' ? 'Elle giriş' : r.source === 'camera' ? 'Kamera' : '', r.times ? `${r.times} tekrar` : ''].filter(Boolean).join(' · '))); return el; }
function demoRows() { return Array.from({ length: 12 }, (_, i) => { const base = '990000000' + String(i + 1).padStart(3, '0'); const sum = [...base].reduce((a, x, j) => a + Number(x) * (j % 2 ? 3 : 1), 0); return { barcode: base + ((10 - sum % 10) % 10), caseNo: `DEMO/${Math.floor(i / 2) + 1}`, recipient: `Örnek muhatap ${String(i + 1).padStart(2, '0')}`, sourceRow: i + 2 }; }); }
function cancelImport() { importGen++; clearTimeout(importTimer); importWorker?.terminate(); importWorker = null; if (importReject) {
    importReject(Error('İçe aktarma iptal edildi.'));
    importReject = null;
} pending = null; $('file').value = ''; $('samples').replaceChildren(); txt('previewTitle', ''); txt('account', ''); txt('finger', ''); $('confirmList').checked = false; $('acceptList').disabled = true; }
async function preview(data, name, g) { const id = await fingerprint(data.rows); if (g !== importGen)
    return; pending = { ...data, name, id }; txt('previewTitle', `${data.rows.length} kayıt`); txt('account', `${data.account.total} kaynak satırı · ${data.account.header} başlık · ${data.account.blank} boş · ${data.rows.length} geçerli · ${data.account.extraColumns} ek sütun`); txt('finger', `${name} · Kimlik ${id.slice(0, 16)}`); $('samples').replaceChildren(...[...data.rows.slice(0, 2), ...data.rows.slice(2).slice(-2)].map(r => record(r))); $('expectedCount').value = ''; $('physical').value = ''; $('confirmList').checked = false; $('acceptList').disabled = true; notice(); view('preview'); }
async function importFile(file) { if (!file)
    return; cancelImport(); stopCamera(); const g = importGen; notice('ODT dosyası kontrol ediliyor…'); view('home'); const cancel = element('button', 'İçe aktarmayı iptal et', 'secondary'); cancel.onclick = () => { cancelImport(); notice(); view(s ? 'work' : 'home'); }; $('global').append(cancel); try {
    if (file.size > 10 * 1024 * 1024)
        throw Error('Dosya 10 MiB sınırını aşıyor.');
    const buffer = await file.arrayBuffer();
    if (g !== importGen)
        return;
    const worker = new Worker('./import-worker.js', { type: 'module' });
    importWorker = worker;
    const xml = await new Promise((resolve, reject) => { importReject = reject; importTimer = setTimeout(() => { worker.terminate(); reject(Error('ODT okuma zaman sınırı aşıldı.')); }, 10000); worker.onmessage = ({ data }) => data.error ? reject(Error(data.error)) : resolve(data.xml); worker.onerror = () => reject(Error('ODT okuyucusu başlatılamadı.')); worker.postMessage(buffer, [buffer]); });
    clearTimeout(importTimer);
    worker.terminate();
    if (g !== importGen)
        return;
    importReject = null;
    importWorker = null;
    await preview(parseXML(xml), file.name, g);
}
catch (e) {
    if (g !== importGen)
        return;
    cancelImport();
    notice(e.message || 'Liste okunamadı.');
    view(s ? 'work' : 'home');
} }
function intField(id, max, min = 0) { const v = $(id).value; if (v === '')
    return null; if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < min || Number(v) > max)
    throw Error('Sayım alanına geçerli bir tam sayı girin.'); return Number(v); }
click('chooseFile', () => $('file').click());
listen('file', 'change', () => importFile($('file').files?.[0]));
click('demo', async () => { cancelImport(); stopCamera(); const rows = demoRows(); try {
    await preview({ rows, account: { total: 13, header: 1, blank: 0, extraColumns: 0 } }, 'Sentetik eğitim listesi', importGen);
}
catch {
    notice('Örnek liste açılamadı. Güvenli bağlantı gerekli.');
} });
listen('confirmList', 'change', () => { $('acceptList').disabled = !$('confirmList').checked; });
click('cancelImport', () => { cancelImport(); notice(); view(s ? 'work' : 'home'); });
click('acceptList', () => { if (!pending || !$('confirmList').checked)
    return; try {
    const n = intField('expectedCount', 10000, 1), p = intField('physical', 1000000);
    if (n !== null && n !== pending.rows.length)
        throw Error('Bağımsız referans sayımı listeyle uyuşmuyor. Listeyi kontrol edin.');
    if (s && !confirm('Önceki oturum silinecek. Yeni listeye geçilsin mi?'))
        return;
    sessionEpoch++;
    s = session(pending.rows, { name: pending.name, id: pending.id, account: pending.account });
    s.physical = p;
    announce(true); checkTabs();
    cancelImport();
    cam.lastCode = null;
    cam.rearm();
    $('reviewDuplicates').checked = false;
    $('mask').checked = false;
    $('search').value = '';
    txt('listName', s.meta.name);
    txt('listId', `Liste ${s.meta.id.slice(0, 16)} · Oturum bellekte`);
    txt('recent', '');
    feedback('Hazır. Her seferinde tek evrak gösterin.', '');
    notice();
    view('work');
    refresh();
}
catch (e) {
    notice(e.message);
} });
click('newList', () => { stopCamera(); cancelImport(); view('home'); notice('Mevcut oturum korunuyor; yeni listeyi onaylayana kadar değişmez.'); const b = element('button', 'Mevcut oturuma dön', 'secondary'); b.onclick = () => { notice(); view('work'); }; $('global').append(b); });
function feedback(message, cls) { txt('feedback', message); $('feedback').className = 'feedback ' + cls; }
async function unlockAudio() { if (!sound)
    return; try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C)
        return;
    audio ??= new C();
    if (audio.state === 'suspended')
        await audio.resume();
}
catch { } }
function beep(kind) { if (!sound || !audio || audio.state !== 'running')
    return; const seq = kind === 'matched' ? [[760, .11]] : kind === 'outside' ? [[320, .32]] : [[450, .11], [450, .11]]; let at = audio.currentTime; for (const [freq, dur] of seq) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(.0001, at);
    g.gain.exponentialRampToValueAtTime(.13, at + .012);
    g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    o.connect(g);
    g.connect(audio.destination);
    o.start(at);
    o.stop(at + dur + .01);
    at += dur + .075;
} try {
    navigator.vibrate?.(kind === 'matched' ? 40 : kind === 'outside' ? 180 : [60, 60, 60]);
}
catch { } }
function process(raw, source) { if (!s || activeView !== 'work')
    return; const r = scan(s, raw, source);
    if (r.kind === 'limit') { stopCamera(); feedback('Oturum 50.000 tarama olayı sınırına ulaştı. Sonuçları inceleyin; yeni olay kabul edilmedi.', 'warn'); return; } $('reviewDuplicates').checked = false; const masked = $('mask').checked; const detail = r.row && !masked ? `${r.row.recipient} · ${r.row.caseNo}` : r.b || ''; if (r.kind === 'matched')
    feedback(`EŞLEŞTİ — eşleşen yığına koyun.\n${detail}`, 'good');
else if (r.kind === 'outside')
    feedback(`LİSTE DIŞI — ayrı yığına koyun.\n${r.b}`, 'bad');
else if (r.kind === 'duplicate')
    feedback(`TEKRAR — aynı barkod daha önce okutuldu. Fiziksel kopya olup olmadığını kontrol edin.\n${detail}`, 'warn');
else
    feedback('GEÇERSİZ — kod biçimi veya kontrol basamağı hatalı. Sayım değişmedi.', 'warn'); beep(r.kind); refresh(); }
const cam = new Camera($('video'), (kind, value) => { if (activeView !== 'work' || !s)
    return; if (kind === 'starting') {
    show('camBox');
    show('start', false);
    show('cameraControls');
    txt('camStatus', 'Kamera izni ve görüntü bekleniyor…');
}
else if (kind === 'ready') {
    txt('camStatus', 'Kamera açık · CODE 39 pilot motoru');
    show('torch', !!value.torch);
    listLenses();
}
else if (kind === 'accept')
    process(value, 'camera');
else if (kind === 'multi')
    txt('camStatus', 'Birden fazla barkod algılandı. Tek evrak gösterin.');
else if (kind === 'confirm')
    txt('camStatus', 'Barkod doğrulanıyor…');
else if (kind === 'none')
    txt('camStatus', 'Tek barkodu yatay hizalayın. Gerekiyorsa yaklaşın veya uzaklaşın.');
else if (kind === 'error') {
    stopCamera();
    feedback(value, 'warn');
} });
async function listLenses() { const g = cam.generation; try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    if (g !== cam.generation)
        return;
    const id = cam.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const sel = $('lens');
    sel.replaceChildren(...devices.map((d, i) => { const opt = element('option', d.label || `Kamera ${i + 1}`); opt.value = d.deviceId; opt.selected = d.deviceId === id; return opt; }));
    show('lens', devices.length > 1);
}
catch { } }
async function startCamera(device) { if (!s || activeView !== 'work')
    return; const g = sessionEpoch; unlockAudio(); cam.start(device); const generation = cam.generation; try {
    if (navigator.wakeLock) {
        const w = await navigator.wakeLock.request('screen');
        if (g !== sessionEpoch || generation !== cam.generation || document.hidden)
            await w.release();
        else {
            wake?.release().catch(() => { });
            wake = w;
        }
    }
}
catch { } }
function stopCamera() { cam.stop(); wake?.release().catch(() => { }); wake = null; torch = false; txt('torch', 'Fener aç'); show('camBox', false); show('cameraControls', false); show('start'); show('lens', false); show('torch', false); txt('camStatus', ''); }
click('start', () => startCamera());
click('stop', () => stopCamera());
listen('lens', 'change', () => startCamera($('lens').value));
click('torch', async () => { if (await cam.torch(!torch)) {
    torch = !torch;
    txt('torch', torch ? 'Fener kapat' : 'Fener aç');
}
else
    txt('camStatus', 'Bu kamera fener kontrolünü desteklemiyor.'); });
click('sound', () => { sound = !sound; txt('sound', sound ? 'Ses açık' : 'Ses kapalı'); $('sound').setAttribute('aria-pressed', String(sound)); if (sound) {
    unlockAudio().then(() => beep('matched'));
} });
function dialog(title, body) { stopCamera(); const d = $('dialogBody'); d.replaceChildren(element('h2', title)); body(d); if (!$('dlg').open)
    $('dlg').showModal(); }
click('manual', () => { if (!s)
    return; unlockAudio(); dialog('Barkodu elle gir', d => { d.append(element('p', 'Evrak üzerindeki 13 rakamı aynen yazın. Geçersiz kod kabul edilmez.')); const f = element('input'); f.autofocus = true; f.type = 'text'; f.inputMode = 'numeric'; f.maxLength = 15; f.autocomplete = 'off'; f.setAttribute('aria-label', '13 haneli barkod'); const p = element('p', '', 'muted'); const b = element('button', 'Kodu doğrula ve kaydet', 'primary'); b.onclick = () => { const v = barcode(f.value); if (!v) {
    p.textContent = 'Geçersiz kod. Sayım değişmedi.';
    return;
} if (!confirm(`${v} barkodunu evrakla tekrar karşılaştırdınız mı?`))
    return; $('dlg').close(); cam.lastCode = v; cam.rearm(v); process(v, 'manual'); }; d.append(f, p, b); f.focus(); }); });
click('undo', () => { if (!s)
    return; stopCamera(); const e = undo(s); if (!e)
    return; cam.lastCode = e.b; cam.rearm(e.b); $('reviewDuplicates').checked = false; feedback('Son kayıt geri alındı. Yeniden okutmak için evrakı kadrajdan çıkarıp tekrar gösterin.', 'warn'); refresh(); });
click('issue', () => { if (!s)
    return; dialog('Sorunlu evrakı ayır', d => { d.append(element('p', 'Okunamayan, hasarlı veya şüpheli fiziksel evrakı ayrı yığına alın. Bu kayıt eşleşme sayısını değiştirmez.')); const sel = element('select'); for (const reason of ['Barkod okunamadı', 'Fiziksel kopya şüphesi', 'Evrak içeriği şüpheli', 'Diğer']) {
    const op = element('option', reason);
    op.value = reason;
    sel.append(op);
} const b = element('button', 'Sorunlu evrak kaydet', 'primary'); b.onclick = () => { s.issues.push({ id: s.issues.length + 1, reason: sel.value, resolved: false }); $('dlg').close(); feedback('Sorunlu evrak kaydedildi. Ayrı yığına koyun.', 'warn'); refresh(); }; d.append(sel, b); }); });
function refresh() { if (!s)
    return; const c = counts(s); for (const k of ['total', 'matched', 'missing', 'outside'])
    txt(k, c[k]); $('progress').max = c.total; $('progress').value = c.matched; txt('repeatCount', `${c.repeats} tekrar olayı`); txt('issueCount', `${c.issues} açık sorun`); $('undo').disabled = !s.history.length; txt('recent', s.history.slice(-3).reverse().map(e => `${e.kind === 'matched' ? 'Eşleşti' : e.kind === 'outside' ? 'Liste dışı' : 'Tekrar'} · ${e.b}`).join('\n')); if (activeView === 'result')
    renderResults(); }
click('finish', () => { if (!s)
    return; stopCamera(); view('result'); $('finalPhysical').value = s.physical ?? ''; tab = 'missing'; page = 0; renderResults(); });
click('resume', () => { view('work'); feedback('Tarama duraklatıldı. Kamerayı yeniden başlatın.', ''); refresh(); });
function renderResults() { if (!s)
    return; const c = counts(s); let p = null, invalid = false; try {
    p = intField('finalPhysical', 1000000);
    s.physical = p;
}
catch {
    invalid = true;
    s.physical = null;
} const mismatch = p !== null && p !== c.accepted; const dupUnreviewed = c.repeats > 0 && !$('reviewDuplicates').checked; const complete = !c.missing && !c.outside && !c.issues && !dupUnreviewed && !mismatch && !invalid; txt('verdict', complete ? 'Listedeki tüm barkodlar eşleşti' : 'Kontrol edilmesi gereken kayıtlar var'); txt('verdictDetail', `${c.matched}/${c.total} eşleşen · ${c.missing} eksik · ${c.outside} liste dışı · ${c.issues} açık sorun`); txt('physicalResult', invalid ? 'Fiziksel sayım geçersiz.' : p === null ? 'Bağımsız fiziksel sayım yapılmadı.' : mismatch ? `Fiziksel evrak (${p}) ile benzersiz okutma (${c.accepted}) uyuşmuyor.` : 'Beyan edilen fiziksel sayım ile benzersiz okutma uyumlu.'); show('reviewDuplicates', c.repeats > 0); $('reviewDuplicates').parentElement.hidden = !c.repeats; const sizes = { missing: c.missing, outside: c.outside, matched: c.matched, duplicate: s.duplicates.size, issues: c.issues }; const labels = { missing: 'Eksik', outside: 'Liste dışı', matched: 'Eşleşen', duplicate: 'Tekrar', issues: 'Sorunlu' }; for (const b of $('tabs').querySelectorAll('button')) {
    b.textContent = `${labels[b.dataset.tab]} (${sizes[b.dataset.tab]})`;
    b.setAttribute('aria-selected', String(tab === b.dataset.tab));
} let rows = tab === 'issues' ? s.issues : results(s, tab); const query = $('search').value.trim().toLocaleLowerCase('tr-TR'); const mask = $('mask').checked; if (query)
    rows = rows.filter(r => [r.barcode, mask ? '' : r.recipient, mask ? '' : r.caseNo, r.reason].filter(Boolean).some(v => v.toLocaleLowerCase('tr-TR').includes(query))); const pages = Math.max(1, Math.ceil(rows.length / 40)); page = Math.min(page, pages - 1); $('prev').disabled = page === 0; $('next').disabled = page >= pages - 1; txt('pageLabel', `${page + 1}/${pages} · ${rows.length} kayıt`); const els = rows.slice(page * 40, page * 40 + 40).map(r => { if (tab !== 'issues')
    return record(r, mask); const el = element('div', undefined, 'record'); el.append(element('strong', `Evrak #${r.id} · ${r.reason}`), element('p', r.resolved ? 'Çözüldü' : 'Açık')); const b = element('button', r.resolved ? 'Tekrar aç' : 'Kontrol edildi olarak işaretle', 'small'); b.onclick = () => { if (!r.resolved && !confirm('Fiziksel evrakı kontrol ettiniz mi? Bu işlem barkodu eşleşmiş saymaz.'))
    return; r.resolved = !r.resolved; refresh(); }; el.append(b); return el; }); $('resultList').replaceChildren(...(els.length ? els : [element('p', 'Bu kategoride kayıt yok.', 'muted')])); }
$('tabs').addEventListener('click', e => { const t = e.target.closest('button[data-tab]'); if (t) {
    tab = t.dataset.tab;
    page = 0;
    renderResults();
} });
for (const id of ['finalPhysical', 'reviewDuplicates', 'search', 'mask'])
    listen(id, 'input', () => { if (id === 'search')
        page = 0; renderResults(); });
click('prev', () => { page--; renderResults(); });
click('next', () => { page++; renderResults(); });
click('report', () => { if (!s || activeView !== 'result')
    return; const c = counts(s); const lines = ['Tebligat Kontrol — kişisel verisiz sayım özeti', `Sürüm: ${VERSION}`, `Toplam: ${c.total}`, `Eşleşen: ${c.matched}`, `Henüz okutulmamış: ${c.missing}`, `Liste dışı: ${c.outside}`, `Tekrar olayları: ${c.repeats}`, `Açık sorun: ${c.issues}`, `Fiziksel sayım: ${s.physical ?? 'Yapılmadı'}`, `Tekrar kontrolü: ${$('reviewDuplicates').checked ? 'Beyan edildi' : 'Beyan edilmedi'}`, 'Bu özet gönderim/teslim veya evrak içeriği kanıtı değildir.']; const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })); const a = element('a'); a.href = url; a.download = 'tebligat-kontrol-ozet.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
function clear() { stopCamera(); cancelImport(); sessionEpoch++; s = null; announce(false); checkTabs(); cam.lastCode = null; cam.rearm(); for (const id of ['listName', 'listId', 'recent', 'previewTitle', 'account', 'finger', 'verdict', 'verdictDetail', 'physicalResult', 'repeatCount', 'issueCount', 'pageLabel'])
    txt(id, ''); for (const id of ['samples', 'resultList', 'dialogBody'])
    $(id).replaceChildren(); for (const id of ['expectedCount', 'physical', 'finalPhysical', 'search'])
    $(id).value = ''; for (const id of ['confirmList', 'reviewDuplicates', 'mask'])
    $(id).checked = false; if ($('dlg').open)
    $('dlg').close(); for (const id of ['total', 'matched', 'missing', 'outside'])
    txt(id, 0); $('progress').value = 0; feedback('', ''); view('home'); notice('Oturum belleği temizlendi. Kaynak ODT dosyası telefonunuzda kalmış olabilir.'); }
click('clear', () => { if (confirm('Tüm liste ve tarama kayıtları geri alınamayacak biçimde oturumdan silinsin mi?'))
    clear(); });
click('help', () => dialog('Kullanım ve güvenlik', d => { for (const t of ['Barkodlu ODT seçin. Önizlemede doğru gönderi grubunu ve kayıt sayısını kontrol edin.', 'Kameraya tek evrak gösterin. Eşleşen, liste dışı ve şüpheli evrakları ayrı yığınlara koyun.', 'Aynı barkod iki fiziksel evrakta bulunabilir; uygulama bunu otomatik ayırt edemez.', 'Oturum geçici bellektedir; uygulama kapanırsa yeniden tarama gerekir.', 'iPhone: Safari paylaş menüsünden Ana Ekrana Ekle. Android: tarayıcı menüsünden Ana ekrana ekle. Çevrim dışı hazır göstergesini kontrol edin.', 'Yalnızca kurumsal yetkiyle gerçek belge kullanın. Resmî UYAP/PTT uygulaması değildir.'])
    d.append(element('p', t)); }));
document.addEventListener('visibilitychange', () => { if (document.hidden) {
    stopCamera();
    if (s) {
        document.body.classList.add('private');
    }
}
else
    document.body.classList.remove('private'); });
window.addEventListener('pagehide', e => { stopCamera(); announce(false); if (e.persisted && s) clear(); });
window.addEventListener('beforeunload', e => { if (s) {
    e.preventDefault();
    e.returnValue = '';
} });
let selfTestResult = null;
async function motorSelfTest() { if (selfTestResult !== null) return selfTestResult; try { const img = new Image(); img.src = './selftest.png'; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const codes = decodeImage(x.getImageData(0, 0, c.width, c.height)); selfTestResult = codes.length === 1 && codes[0] === '9900000000011'; return selfTestResult; } catch { return false; } }
async function offlineReady() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) {
        txt('offline', 'Çevrim dışı destek yok');
        return;
    }
    async function checkCache() { try {
        const key = 'tebligat-' + VERSION;
        const valid = !!navigator.serviceWorker.controller && (await caches.has(key)) && (await Promise.all(ASSETS.map(a => caches.match(new URL(a, location.href), { cacheName: key })))).every(Boolean);
        const motorOK = valid && await motorSelfTest();
        txt('offline', motorOK ? 'Çevrim dışı dosyalar hazır' : valid ? 'Barkod motoru öz testi başarısız' : 'Çevrim dışı hazırlık tamamlanmadı');
        return motorOK;
    }
    catch {
        txt('offline', 'Çevrim dışı hazırlık doğrulanamadı');
        return false;
    } }
    const initiallyReady = await checkCache();
    navigator.serviceWorker.addEventListener('controllerchange', () => checkCache());
    window.addEventListener('online', checkCache);
    window.addEventListener('offline', checkCache);
    try {
        const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        const setWaiting = () => { waiting = reg.waiting; if (waiting && navigator.serviceWorker.controller) {
            show('update');
            $('updateBtn').disabled = !!s || !!pending || !!importWorker;
        } };
        setWaiting();
        reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', setWaiting));
        await navigator.serviceWorker.ready;
        await checkCache();
    }
    catch {
        if (!initiallyReady)
            txt('offline', 'Çevrim dışı hazırlık başarısız');
    }
}
click('updateBtn', () => { if (!s && !pending && waiting)
    notice('Güncellemek için uygulamanın tüm sekmelerini kapatıp yeniden açın. Açık başka bir oturumu zorla yenilemiyoruz.'); });
view('home');
offlineReady();
