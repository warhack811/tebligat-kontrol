import {seal,restore} from './checkpoint.js';
import * as manage from './manage.js';
import { barcode, session, scan, undo, counts, results } from './domain.js';
import { parseXML, fingerprint } from './odt.js';
import { Camera } from './camera.js';
import { decodeImage } from './decoder.js';
import { VERSION, ASSETS } from './version.js';
const $ = id => document.getElementById(id);
let findTargets=null, photoGen=0, dialogGen=0, resultMode="summary";
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
function view(v) { if(v!=='work')setExpanded(false); activeView = v; show('bottomNav',v==='work'||v==='result'); for(const id of ['navScan','navRecords','navSummary']) $(id).setAttribute('aria-current',String(v==='work'?id==='navScan':id===(resultMode==='records'?'navRecords':'navSummary')));  show('home', v === 'home'); show('preview', v === 'preview'); show('work', v === 'work' || v === 'result'); show('scanPanel', v === 'work'); show('resultPanel', v === 'result'); $('updateBtn').disabled = !!s || !!pending || !!importWorker; }
function element(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = text; if (cls)
    e.className = cls; return e; }
function record(r, mask = false) { const el = element('div', undefined, 'record'); el.append(element('strong', mask ? 'Barkod kaydı' : r.recipient || 'Barkod kaydı'), element('p', [mask ? '' : r.caseNo, r.barcode, r.source === 'manual' ? 'Elle giriş' : r.source === 'camera' ? 'Kamera' : r.source==='photo'?'Görsel':r.times?'Tekrar olayı':'', r.times ? `${r.times} tekrar` : ''].filter(Boolean).join(' · '))); return el; }
function demoRows() { return Array.from({ length: 12 }, (_, i) => { const base = '990000000' + String(i + 1).padStart(3, '0'); const sum = [...base].reduce((a, x, j) => a + Number(x) * (j % 2 ? 3 : 1), 0); return { barcode: base + ((10 - sum % 10) % 10), caseNo: `DEMO/${Math.floor(i / 2) + 1}`, recipient: `Örnek muhatap ${String(i + 1).padStart(2, '0')}`, sourceRow: i + 2 }; }); }
function cancelImport() { importGen++; clearTimeout(importTimer); importWorker?.terminate(); importWorker = null; if (importReject) {
    importReject(Error('İçe aktarma iptal edildi.'));
    importReject = null;
} pending = null; $('file').value = ''; $('samples').replaceChildren(); txt('previewTitle', ''); txt('account', ''); txt('finger', ''); $('confirmList').checked = false; $('acceptList').disabled = true; }
async function preview(data, name, g) { const id = await fingerprint(data.rows); if (g !== importGen)
    return; pending = { ...data, name, id }; txt('previewTitle', `${data.rows.length} kayıt`); txt('account', `${data.account.total} kaynak satırı · ${data.account.header} başlık · ${data.account.blank} boş · ${data.rows.length} geçerli · ${data.account.extraColumns} ek sütun`); txt('finger', `${name} · Kimlik ${id.slice(0, 16)}`); $('samples').replaceChildren(...[...data.rows.slice(0, 2), ...data.rows.slice(2).slice(-2)].map(r => record(r))); const diff=s?manage.delta(s,data.rows):null; pending.diff=diff; show('deltaSummary',!!diff); show('carryLabel',!!diff); $('carry').checked=false; if(diff)txt('deltaSummary',`Yeni ${diff.added} · Çıkarılan ${diff.removed} · Bilgisi değişen ${diff.changed} · Aktarılabilir ${diff.eligible.length}. Aynı fiziksel grup ise aktarın.`); $('expectedCount').value = ''; $('physical').value = ''; $('confirmList').checked = false; $('acceptList').disabled = true; notice(); view('preview'); }
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
    if (s && !confirm('Yeni referans listeye geçilsin mi? Yalnızca seçilen, değişmemiş doğrulamalar aktarılabilir; diğer işlemler taşınmaz.'))
        return;
    sessionEpoch++;
    const old=s; const next = manage.init(session(pending.rows, { name: pending.name, id: pending.id, account: pending.account })); if(old && $('carry').checked && pending.diff)manage.carry(old,next,pending.diff.eligible); s=next; findTargets=null; show('findExit',false);
    s.physical = p;
    announce(true); checkTabs();
    cancelImport();
    cam.lastCode = null;
    cam.rearm();
    $('reviewDuplicates').checked = false;
    $('mask').checked = false; $('group').checked=false;
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
    return; if(findTargets){const b=barcode(raw);if(b&&findTargets.has(b)){feedback('ARANAN EVRAK BULUNDU — '+b,'good');beep('matched');}else feedback('Aranan evrak değil. Sayım değişmedi.','');return;} const r = manage.accept(s, raw, source);
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
    txt('camStatus', 'Kamera hazır'); show('focus',!!value.focusMode?.length); show('zoomWrap',!!value.zoom); if(value.zoom){const z=$('zoom'); z.min=value.zoom.min;z.max=value.zoom.max;z.step=value.zoom.step||0.1;z.value=cam.stream?.getVideoTracks()[0]?.getSettings().zoom||value.zoom.min;}
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
    txt('camStatus', 'Barkodun tamamı görünür olsun. Yönünü değiştirmeniz gerekmez.');
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
    sel.replaceChildren(...devices.map((d, i) => { const opt = element('option', `${/front|facing front/i.test(d.label)?'Ön':'Kamera'} ${i + 1}`); opt.value = d.deviceId; opt.selected = d.deviceId === id; return opt; }));
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
function stopCamera() { setExpanded(false);photoGen++; cam.stop(); show('zoomWrap',false);show('focus',false); wake?.release().catch(() => { }); wake = null; torch = false; txt('torch', 'Fener aç'); show('camBox', false); show('cameraControls', false); show('start'); show('lens', false); show('torch', false); txt('camStatus', ''); }
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
$('dlg').addEventListener('close',()=>{if(!$('dlg').open){dialogGen++;$('dialogBody').replaceChildren();}});
function dialog(title, body) { dialogGen++; stopCamera(); const d = $('dialogBody'); d.replaceChildren(element('h2', title)); body(d); if (!$('dlg').open)
    $('dlg').showModal(); }
click('manual', () => { if (!s)
    return; unlockAudio(); dialog('Barkodu elle gir', d => { d.append(element('p', 'Evrak üzerindeki 13 rakamı aynen yazın. Geçersiz kod kabul edilmez.')); const f = element('input'); f.autofocus = true; f.type = 'text'; f.inputMode = 'numeric'; f.maxLength = 15; f.autocomplete = 'off'; f.setAttribute('aria-label', '13 haneli barkod'); const p = element('p', '', 'muted'); const b = element('button', 'Kodu doğrula ve kaydet', 'primary'); b.onclick = () => { const v = barcode(f.value); if (!v) {
    p.textContent = 'Geçersiz kod. Sayım değişmedi.';
    return;
} if (!confirm(`${v} barkodunu evrakla tekrar karşılaştırdınız mı?`))
    return; $('dlg').close(); cam.lastCode = v; cam.rearm(v); process(v, 'manual'); }; d.append(f, p, b); f.focus(); }); });
click('undo', () => { if (!s)
    return; stopCamera(); const e = manage.historyStep(s); if (!e)
    return; if(barcode(e.b)){cam.lastCode=e.b;cam.rearm(e.b);} $('reviewDuplicates').checked = false; feedback('Son kayıt işlemi geri alındı. Yeniden okutmak için evrakı kadrajdan çıkarıp tekrar gösterin.', 'warn'); refresh(); });
click('issue', () => { if (!s)
    return; dialog('Sorunlu evrakı ayır', d => { d.append(element('p', 'Okunamayan, hasarlı veya şüpheli fiziksel evrakı ayrı yığına alın. Bu kayıt eşleşme sayısını değiştirmez.')); const sel = element('select'); for (const reason of ['Barkod okunamadı', 'Fiziksel kopya şüphesi', 'Evrak içeriği şüpheli', 'Diğer']) {
    const op = element('option', reason);
    op.value = reason;
    sel.append(op);
} const b = element('button', 'Sorunlu evrak kaydet', 'primary'); b.onclick = () => { try{manage.addIssue(s,sel.value);}catch(e){d.append(element('p',e.message));return;} $('dlg').close(); feedback('Sorunlu evrak kaydedildi. Ayrı yığına koyun.', 'warn'); refresh(); }; d.append(sel, b); }); });
let filteredRows=[];
function refresh() { if (!s)
    return; const c = counts(s); for (const k of ['total', 'matched', 'missing', 'outside'])
    txt(k, c[k]); $('progress').max = c.total; $('progress').value = c.matched; txt('repeatCount', `${c.repeats} tekrar olayı`); txt('issueCount', `${c.issues} açık sorun`); $('undo').disabled = !s.journal.length; $('redo').disabled=!s.redo.length; $('resultRedo').disabled=!s.redo.length;$('resultUndo').disabled=!s.journal.length; txt('recent', s.audit.slice(-2).reverse().map(e => `${e.label} · ${e.b}`).join('\n')); if (activeView === 'result')
    renderResults(); }
function openResults(t='missing',mode='summary'){if(!s)return;stopCamera();findTargets=null;show('findExit',false);tab=t;page=0;resultMode=mode;show('summaryBlock',mode==='summary'); $('finalPhysical').value=s.physical??'';view('result');renderResults();} click('finish',()=>openResults());
click('resume', () => { view('work'); feedback('Tarama duraklatıldı. Kamerayı yeniden başlatın.', ''); refresh(); });
function renderResults() { if (!s)
    return; const c = counts(s); let p = null, invalid = false; try {
    p = intField('finalPhysical', 1000000);
    s.physical = p;
}
catch {
    invalid = true;
    s.physical = null;
} const d=manage.detailCounts(s); const mismatch = p !== null && p !== c.accepted+d.copies; const dupUnreviewed = c.repeats > 0 && !$('reviewDuplicates').checked; const complete = !c.missing && !c.outside && !c.issues && !dupUnreviewed && !mismatch && !invalid && !d.copies && !d.excluded; txt('verdict', complete ? (d.manual?'Tüm barkodlar eşleşti (elle doğrulamalar dahil)':'Listedeki tüm barkodlar eşleşti') : 'Kontrol edilmesi gereken kayıtlar var'); txt('verdictDetail', `${c.matched}/${c.total} eşleşen · ${c.missing} eksik · ${c.outside} liste dışı · ${c.issues} açık sorun · ${d.manual} elle · ${d.photo} görsel · ${d.excluded} kapsam dışı notu · ${d.copies} fiziksel kopya`); txt('physicalResult', invalid ? 'Fiziksel sayım geçersiz.' : p === null ? 'Bağımsız fiziksel sayım yapılmadı.' : mismatch ? `Fiziksel evrak (${p}) ile benzersiz okutma (${c.accepted+d.copies}) uyuşmuyor.` : 'Beyan edilen fiziksel sayım ile benzersiz barkodlar + işaretlenen kopyalar uyumlu.'); show('reviewDuplicates', c.repeats > 0); $('reviewDuplicates').parentElement.hidden = !c.repeats; const sizes = { all:c.total, missing: c.missing, outside: c.outside, matched: c.matched, duplicate: s.duplicates.size, issues: c.issues }; const labels = { all:'Tümü', missing: 'Eksik', outside: 'Liste dışı', matched: 'Eşleşen', duplicate: 'Tekrar', issues: 'Sorunlu' }; for (const b of $('tabs').querySelectorAll('button')) {
    b.textContent = `${labels[b.dataset.tab]} (${sizes[b.dataset.tab]})`;
    b.setAttribute('aria-selected', String(tab === b.dataset.tab));
} let rows = tab === 'issues' ? s.issues : (tab==='all'?[...s.expected.values()].map(r=>({...r,source:s.accepted.get(r.barcode)?.source})):results(s,tab)).map(r=>manage.rowView(s,r)); const query = $('search').value.trim().toLocaleLowerCase('tr-TR'); const mask = $('mask').checked; if (query)
    rows = rows.filter(r => [r.barcode, mask ? '' : r.recipient, mask ? '' : r.caseNo, r.reason,mask?'':r.note].filter(Boolean).some(v => v.toLocaleLowerCase('tr-TR').includes(query))); if($('group').checked&&!mask&&tab!=='issues')rows.sort((a,b)=>(a.caseNo||'').localeCompare(b.caseNo||'','tr',{numeric:true})); filteredRows=tab==='issues'?[]:rows.map(r=>r.barcode); const pages = Math.max(1, Math.ceil(rows.length / 40)); page = Math.min(page, pages - 1); $('prev').disabled = page === 0; $('next').disabled = page >= pages - 1; txt('pageLabel', `${page + 1}/${pages} · ${rows.length} kayıt`); const els = rows.slice(page * 40, page * 40 + 40).map(r => { if (tab !== 'issues')
    {const el=record(r,mask);if(tab==='all')el.append(element('p',s.accepted.has(r.barcode)?'Doğrulandı':'Henüz okutulmadı')); if(r.excluded)el.append(element('p','Kapsam dışı notu: '+(mask?'Gizli':r.excluded))); if(r.copies)el.append(element('p',`${r.copies} fiziksel kopya`)); if(r.note&&!mask)el.append(element('p',r.note)); const b=element('button','Düzenle','recordAction');b.onclick=()=>editRecord(r.barcode);el.append(b);return el;} const el = element('div', undefined, 'record'); el.append(element('strong', `Evrak #${r.id} · ${r.reason}`), element('p', r.resolved ? 'Çözüldü' : 'Açık')); const b = element('button', r.resolved ? 'Tekrar aç' : 'Kontrol edildi olarak işaretle', 'small'); b.onclick = () => { if (!r.resolved && !confirm('Fiziksel evrakı kontrol ettiniz mi? Bu işlem barkodu eşleşmiş saymaz.'))
    return; try{manage.toggleIssue(s,s.issues.indexOf(r));refresh();}catch(e){notice(e.message);} }; el.append(b); return el; }); if($('group').checked&&!mask&&tab!=='issues'&&els.length){const grouped=[];let prior=null;rows.slice(page*40,page*40+40).forEach((r,i)=>{const key=mask?'Gizli dosya':r.caseNo||'Dosya bilgisi yok';if(key!==prior)grouped.push(element('div',key,'groupTitle'));prior=key;grouped.push(els[i]);});$('resultList').replaceChildren(...grouped);}else $('resultList').replaceChildren(...(els.length ? els : [element('p', 'Bu kategoride kayıt yok.', 'muted')])); }
$('tabs').addEventListener('click', e => { const t = e.target.closest('button[data-tab]'); if (t) {
    tab = t.dataset.tab;
    page = 0;
    renderResults();
} });
for (const id of ['finalPhysical', 'reviewDuplicates', 'search', 'mask', 'group'])
    listen(id, 'input', () => { if (id === 'search')
        page = 0; renderResults(); });
click('prev', () => { page--; renderResults(); });
click('next', () => { page++; renderResults(); });
click('report', () => { if (!s || activeView !== 'result')
    return; const c = counts(s), d=manage.detailCounts(s); const lines = ['Tebligat Kontrol — kişisel verisiz sayım özeti', `Sürüm: ${VERSION}`, `Toplam: ${c.total}`, `Eşleşen: ${c.matched}`, `Kamera: ${d.camera}`, `Elle: ${d.manual}`, `Görsel: ${d.photo}`, `Kapsam dışı notu: ${d.excluded}`, `Fiziksel kopya: ${d.copies}`, `Henüz okutulmamış: ${c.missing}`, `Liste dışı: ${c.outside}`, `Tekrar olayları: ${c.repeats}`, `Açık sorun: ${c.issues}`, `Fiziksel sayım: ${s.physical ?? 'Yapılmadı'}`, `Tekrar kontrolü: ${$('reviewDuplicates').checked ? 'Beyan edildi' : 'Beyan edilmedi'}`, 'Bu özet gönderim/teslim veya evrak içeriği kanıtı değildir.']; const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })); const a = element('a'); a.href = url; a.download = 'tebligat-kontrol-ozet.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
function clear() { stopCamera(); cancelImport(); sessionEpoch++; s = null; filteredRows=[]; findTargets=null;show('findExit',false); announce(false); checkTabs(); cam.lastCode = null; cam.rearm(); for (const id of ['listName', 'listId', 'recent', 'previewTitle', 'account', 'finger', 'verdict', 'verdictDetail', 'physicalResult', 'repeatCount', 'issueCount', 'pageLabel'])
    txt(id, ''); for (const id of ['samples', 'resultList', 'dialogBody'])
    $(id).replaceChildren(); for (const id of ['expectedCount', 'physical', 'finalPhysical', 'search'])
    $(id).value = ''; for (const id of ['confirmList', 'reviewDuplicates', 'mask', 'group', 'carry'])
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
        if($('dlg').open)$('dlg').close(); document.body.classList.add('private');
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
        const key = 'tebligat-v2-' + encodeURIComponent(new URL('./',location.href).href) + '-' + VERSION;
        const valid = !!navigator.serviceWorker.controller && (await caches.has(key)) && (await Promise.all(ASSETS.map(a => caches.match(new URL(a,new URL('./',location.href)), { cacheName: key })))).every(Boolean);
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
// Record operations preserve the immutable imported reference.
function inputField(parent,label,value='',type='text'){const l=element('label',label,'field'),f=element('input');f.type=type;f.value=value;l.append(f);parent.append(l);return f;}
function action(parent,label,fn,cls='secondary'){const b=element('button',label,cls);b.onclick=()=>{try{fn();}catch(e){const error=element('p',e.message,'notice');error.setAttribute('role','alert');parent.append(error);}};parent.append(b);return b;}
function edited(){ $('reviewDuplicates').checked=false; refresh(); if($('dlg').open)$('dlg').close(); }
function editRecord(b){if(!s)return;const original=s.expected.get(b),r=manage.rowView(s,original||{barcode:b});const isMasked=$('mask').checked;dialog('Kayıt ayrıntısı',d=>{d.append(element('p',b,'mono')); if(original&&!isMasked)d.append(element('p','Kaynak: '+original.caseNo+' · '+original.recipient,'muted'));if(isMasked){d.append(element('p','Bilgileri düzenlemek için mahremiyet modunu kapatın.'));}else{const c=inputField(d,'Çalışma dosya numarası',r.caseNo||''),n=inputField(d,'Çalışma muhatabı',r.recipient||'');const note=element('textarea');note.maxLength=500;note.value=r.note||'';note.setAttribute('aria-label','Açıklama');d.append(element('p','Açıklama'),note);action(d,'Bilgileri kaydet (kaynak değişmez)',()=>{manage.editDetails(s,b,c.value,n.value,note.value);edited();},'primary');}
if(s.accepted.has(b)){const corrected=inputField(d,'Yanlış okutulduysa doğru barkod');corrected.inputMode='numeric';corrected.maxLength=15;action(d,'Barkod gözlemini düzelt',()=>{if(confirm('Eski okutma kaldırılacak, yeni barkod elle doğrulanmış olarak kaydedilecek. Evrak üzerindeki kodu kontrol ettiniz mi?')){manage.replaceObservation(s,b,corrected.value);cam.rearm(corrected.value);edited();}});action(d,'Doğrulamayı kaldır',()=>{if(confirm('Bu barkodun eşleşmesi ve tekrar kayıtları kaldırılacak. Onaylıyor musunuz?')){manage.remove(s,b);cam.rearm(b);edited();}},'danger');const f=inputField(d,'Fiziksel fazla kopya sayısı',String(r.copies||0),'number');f.min='0';f.max='10000';action(d,'Kopya sayısını kaydet',()=>{if(!/^\d+$/.test(f.value))throw Error('Tam sayı girin.');manage.markCopy(s,b,Number(f.value));edited();});if(s.duplicates.has(b))action(d,'Yanlışlıkla tekrar okutuldu',()=>{if(confirm('Tekrar uyarısı kaldırılacak.')){manage.reviewRepeat(s,b);edited();}});}
else if(original){action(d,'Elle doğrula',()=>{if(confirm('Fiziksel evraktaki barkodu birebir doğruladınız mı?')){manage.verify(s,b);edited();}});if(!isMasked){const reason=inputField(d,'Kapsam dışı gerekçesi (boş = kaldır)',r.excluded||'');action(d,'Gerekçeyi kaydet',()=>{manage.exclude(s,b,reason.value);edited();});}}
action(d,'Bu evrakı kamerayla bul',()=>{ $('dlg').close();startFind([b]);});action(d,'Barkodu kopyala',async()=>{try{await navigator.clipboard.writeText(b);notice('Barkod kopyalandı.');}catch{notice('Kopyalama izni yok.');}});});}
function startFind(keys){if(!s||!keys.length)return; stopCamera();findTargets=new Set(keys);view('work');show('findExit');feedback(`Arama modu: ${keys.length} hedef. Sayım değişmez.`,'');refresh();}
click('findBtn',()=>{if(!s)return;dialog('Evrak bul',d=>{const q=inputField(d,'Dosya, isim veya barkod');const out=element('div');d.append(out);const draw=()=>{const term=q.value.trim().toLocaleLowerCase('tr-TR');out.replaceChildren();if(!term)return;const rows=[...s.expected.values()].filter(r=>[r.barcode,$('mask').checked?'':r.caseNo,$('mask').checked?'':r.recipient].some(v=>v.toLocaleLowerCase('tr-TR').includes(term)));out.append(element('p',`${rows.length} hedef`));if(rows.length)action(out,'Bulunan kayıtları ara',()=>{$('dlg').close();startFind(rows.map(r=>r.barcode));});};q.oninput=draw;action(d,'Tüm eksikleri ara',()=>{const rows=results(s,'missing');if(!rows.length)throw Error('Eksik kayıt yok.');$('dlg').close();startFind(rows.map(r=>r.barcode));});});});
click('findExit',()=>{stopCamera();findTargets=null;show('findExit',false);feedback('Normal taramaya dönüldü.','');});
function redoAction(){if(!s)return;stopCamera();if(manage.historyStep(s,true)){ $('reviewDuplicates').checked=false;feedback('İşlem yeniden uygulandı.','');refresh();}} click('redo',redoAction);click('resultRedo',redoAction);click('resultUndo',()=>$('undo').click());
click('focus',async()=>{if(!await cam.focus())txt('camStatus','Odak kontrolü desteklenmiyor.');});listen('zoom','change',async()=>{if(!await cam.zoom($('zoom').value))txt('camStatus','Yakınlaştırma uygulanamadı.');});
click('photoBtn',()=>{stopCamera();$('photo').click();});listen('photo','change',async()=>{const f=$('photo').files?.[0];$('photo').value='';if(!f||!s)return;const g=++photoGen,epoch=sessionEpoch;let img;try{if(f.size>12*1024*1024)throw Error('Görsel 12 MiB sınırını aşıyor.');img=await createImageBitmap(f);if(g!==photoGen||epoch!==sessionEpoch||activeView!=='work')return;const c=document.createElement('canvas'),scale=Math.min(1,2400/Math.max(img.width,img.height),Math.sqrt(2900000/(img.width*img.height)));c.width=Math.max(1,Math.floor(img.width*scale));c.height=Math.max(1,Math.floor(img.height*scale));const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);const codes=decodeImage(ctx.getImageData(0,0,c.width,c.height));c.width=c.height=1;if(codes.length!==1||!barcode(codes[0]))throw Error('Tek geçerli barkod okunamadı.');if(confirm('Görseldeki '+codes[0]+' barkodunu doğruluyor musunuz?'))process(codes[0],'photo');}catch(e){if(g===photoGen)feedback(e.message,'warn');}finally{img?.close();}});
click('allPreview',()=>{if(!pending)return;dialog('Referans liste',d=>{const q=inputField(d,'Ara');const out=element('div');let p=0;const draw=()=>{const v=q.value.toLocaleLowerCase('tr-TR');const rows=pending?.rows.filter(r=>[r.barcode,r.caseNo,r.recipient].some(x=>x.toLocaleLowerCase('tr-TR').includes(v)))||[];p=Math.max(0,Math.min(p,Math.ceil(rows.length/30)-1));out.replaceChildren(element('p',`${rows.length} kayıt · Sayfa ${p+1}`),...rows.slice(p*30,p*30+30).map(r=>record(r)));};q.oninput=()=>{p=0;draw();};d.append(out);action(d,'Önceki sayfa',()=>{p--;draw();});action(d,'Sonraki sayfa',()=>{p++;draw();});draw();});});
click('historyBtn',()=>{if(!s)return;dialog('İşlem geçmişi',d=>{d.append(element('p','Son 100 işlem · Oturum belleği','muted'));for(const e of s.audit.slice(-100).reverse())d.append(element('p',`${new Date(e.at).toLocaleTimeString('tr-TR')} · ${e.label} · ${e.b}`));});});
for(const el of document.querySelectorAll('[data-go]'))el.onclick=()=>openResults(el.dataset.go,'records');
click('navScan',()=>{if(!s)return;view('work');refresh();});click('navRecords',()=>openResults('all','records'));click('navSummary',()=>openResults('missing'));
function downloadLocal(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type}));const a=element('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
click('saveCheckpoint',()=>{if(!s)return;const current=s,epoch=sessionEpoch;dialog('Şifreli oturum dosyası',d=>{d.append(element('p','Yalnızca kurumunuz izin veriyorsa kullanın. Dosya hassas veri içerir; bulut klasörüne kaydetmeyin. Parola kaybolursa kurtarılamaz. Geri alma geçmişi taşınmaz.'));const dg=dialogGen;const pass=inputField(d,'Parola (en az 12 karakter)','','password'),again=inputField(d,'Parolayı tekrar girin','','password');const status=element('p');d.append(status);const b=action(d,'Şifrele ve indir',async()=>{if(pass.value!==again.value){status.textContent='Parolalar uyuşmuyor.';return;}b.disabled=true;try{const out=await seal(current,pass.value);if(s!==current||epoch!==sessionEpoch||dg!==dialogGen||!$('dlg').open)return;downloadLocal(out,'tebligat-oturum.tkcp','application/octet-stream');$('dlg').close();notice('Şifreli dosya hazır. Kaydettiğiniz konumu kontrol edin.');}catch(e){status.textContent=e.message;}finally{pass.value=again.value='';b.disabled=false;}},'primary');});});
click('restoreBtn',()=>$('restoreFile').click());listen('restoreFile','change',()=>{const f=$('restoreFile').files?.[0];$('restoreFile').value='';if(!f)return;dialog('Şifreli oturumu aç',d=>{d.append(element('p','Yalnız size ait ve kurumca izin verilen oturum dosyalarını açın.'));const pass=inputField(d,'Parola','','password'),status=element('p');d.append(status);const epoch=sessionEpoch,g=importGen,dg=dialogGen;const b=action(d,'Oturumu aç',async()=>{b.disabled=true;try{if(f.size>25*1024*1024)throw Error('Dosya çok büyük.');const next=await restore(await f.arrayBuffer(),pass.value);if(epoch!==sessionEpoch||g!==importGen||dg!==dialogGen||!$('dlg').open)return;if(s&&!confirm('Önceki oturum silinsin mi?'))return;cancelImport();sessionEpoch++;s=next;findTargets=null;show('findExit',false);cam.lastCode=null;cam.rearm();$('reviewDuplicates').checked=false; $('mask').checked=false;$('search').value='';txt('listName',s.meta.name);txt('listId','Liste '+s.meta.id.slice(0,16)+' · Kurtarılan oturum');$('dlg').close();announce(true);checkTabs();view('work');feedback('Oturum kurtarıldı. Fiziksel yığınları doğrulayın.','warn');refresh();}catch(e){status.textContent=e.message;}finally{pass.value='';b.disabled=false;}},'primary');});});
const csvCell=v=>{let x=String(v??'');if(/^[\s]*[=+\-@]/.test(x)||/^\d{13}$/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"';};
click('detailReport',()=>{if(!s||!confirm('Bu dosya hassas barkod ve muhatap verileri içerebilir. Kurumunuzun izin verdiğini ve güvenli yerel konuma kaydedeceğinizi doğruluyor musunuz?'))return;const mask=$('mask').checked,rows=[['Durum','Barkod','Dosya','Muhatap','Kaynak','Not','Kapsam dışı gerekçesi','Fiziksel kopya']];for(const r0 of [...s.expected.values(),...results(s,'outside')]){const r=manage.rowView(s,r0),e=s.accepted.get(r.barcode);rows.push([s.expected.has(r.barcode)?e?'Eşleşen':'Eksik':'Liste dışı',r.barcode,mask?'':r.caseNo,mask?'':r.recipient,e?.source,mask?'':r.note,mask?'':r.excluded,r.copies]);}downloadLocal('\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n'),'tebligat-ayrintili.csv','text/csv;charset=utf-8');});
click('bulkNote',()=>{if(!s||$('mask').checked||!filteredRows.length){notice('Not eklemek için kayıt seçin ve mahremiyet modunu kapatın.');return;}const keys=[...new Set(filteredRows)];dialog('Filtrelenen kayıtlara not',d=>{d.append(element('p',`${keys.length} kaydın açıklaması değişecek; eşleşme sayısı değişmez.`));const f=inputField(d,'Yeni açıklama (boş = kaldır)');action(d,'Tümüne uygula',()=>{if(!confirm(`${keys.length} kayda uygulansın mı?`))return;manage.bulkAnnotate(s,keys,f.value);edited();},'primary');});});
function setExpanded(on){document.body.classList.toggle('scanExpanded',on);$('expandScan').setAttribute('aria-pressed',String(on));txt('expandScan',on?'Normal ekran':'Tam ekran');}click('expandScan',()=>{const on=!document.body.classList.contains('scanExpanded');setExpanded(on);if(on&&!cam.active)startCamera();});
view('home');
offlineReady();
