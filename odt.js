import { barcode } from './domain.js';
const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', X = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const norm = s => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
const heads = [['DOSYA NO', 'DOSYA NUMARASI', 'SORUŞTURMA NO'], ['TEBLİGAT YAPILAN', 'MUHATAP', 'ADI SOYADI', 'TEBLİGAT YAPILAN KİŞİ'], ['GÖNDERİ BARKODU', 'BARKOD NO', 'BARKOD NUMARASI', 'GÖNDERİ NO', 'BARKOD']];
const direct = (el, name) => [...el.children].filter(c => c.namespaceURI === T && c.localName === name);
function text(el) { let out = ''; function visit(n, d = 0) { if (d > 32)
    throw Error('Hücre iç içe yapı sınırı aşıldı.'); if (n.nodeType === 3 || n.nodeType === 4) {
    out += n.nodeValue;
}
else if (n.nodeType === 1) {
    if (n.namespaceURI !== X)
        throw Error('Hücre içinde desteklenmeyen içerik.');
    if (n.localName === 's') {
        const count = Number(n.getAttributeNS(X, 'c') || 1);
        if (!Number.isInteger(count) || count < 1 || count > 1024)
            throw Error('Geçersiz boşluk sayısı.');
        out += ' '.repeat(count);
    }
    else if (['tab', 'line-break'].includes(n.localName))
        out += ' ';
    else if (['p', 'span', 'a', 'h'].includes(n.localName)) {
        for (const c of n.childNodes)
            visit(c, d + 1);
        if (['p', 'h'].includes(n.localName))
            out += ' ';
    }
    else
        throw Error('Hücre içinde desteklenmeyen metin yapısı.');
} if (out.length > 2048)
    throw Error('Hücre uzunluk sınırı aşıldı.'); } for (const c of el.childNodes)
    if (c.nodeType === 1 || (c.nodeType === 3 || c.nodeType === 4) && c.nodeValue.trim())
        visit(c); return out.trim().normalize('NFC'); }
function structure(el) { for (const k of ['number-rows-repeated', 'number-columns-repeated', 'number-rows-spanned', 'number-columns-spanned']) {
    const v = el.getAttributeNS(T, k);
    if (v !== null && v !== '1')
        throw Error('Tekrarlanan/birleşik satır veya hücre desteklenmiyor.');
} const vis = el.getAttributeNS(T, 'visibility'); if (vis && vis !== 'visible')
    throw Error('Gizlenmiş satır veya sütun desteklenmiyor.'); }
export function parseXML(xml) {
    if (typeof xml !== 'string' || xml.length > 20 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
        throw Error('Güvenli olmayan XML.');
    let tags = 0;
    for (let i = 0; (i = xml.indexOf('<', i)) !== -1; i++)
        if (++tags > 420000)
            throw Error('XML yapı sınırı aşıldı.');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || doc.documentElement.namespaceURI !== O || doc.documentElement.localName !== 'document-content')
        throw Error('ODT XML içeriği bozuk.');
    const tables = [...doc.getElementsByTagNameNS(T, 'table')];
    if (tables.length !== 1)
        throw Error('Belgede tam bir tablo olmalı. Birden fazla veya iç içe tablo desteklenmiyor.');
    const table = tables[0];
    if (table.parentNode?.namespaceURI !== O || table.parentNode.localName !== 'text')
        throw Error('Tablo beklenen belge bölümünde değil.');
    const rr = [];
    for (const c of table.children) {
        if (c.namespaceURI !== T)
            throw Error('Bilinmeyen tablo yapısı.');
        if (c.localName === 'table-row')
            rr.push(c);
        else if (['table-header-rows', 'table-rows'].includes(c.localName)) {
            if ([...c.children].some(x => x.namespaceURI !== T || x.localName !== 'table-row'))
                throw Error('Bilinmeyen satır grubu.');
            rr.push(...direct(c, 'table-row'));
        }
        else if (c.localName === 'table-column') {
            const vis = c.getAttributeNS(T, 'visibility');
            if (vis && vis !== 'visible')
                throw Error('Gizli sütun desteklenmiyor.');
        }
        else
            throw Error('Desteklenmeyen tablo yapısı: ' + c.localName);
    }
    if (rr.length > 10050)
        throw Error('Satır sınırı aşıldı.');
    let cols = null, width = 0, blank = 0, header = 0;
    const rows = [], seen = new Map();
    for (let i = 0; i < rr.length; i++) {
        const r = rr[i];
        structure(r);
        const cells = [...r.children];
        if (!cells.length || cells.length > 100 || cells.some(c => c.namespaceURI !== T || c.localName !== 'table-cell'))
            throw Error(`Satır ${i + 1}: desteklenmeyen hücre.`);
        const vals = cells.map(c => { structure(c); return text(c); });
        if (vals.every(v => !v)) {
            blank++;
            continue;
        }
        if (!cols) {
            const normalized = vals.map(norm);
            const found = heads.map(h => normalized.flatMap((v, j) => h.includes(v) ? [j] : []));
            if (found.some(x => x.length !== 1) || new Set(found.flat()).size !== 3)
                throw Error('Barkodlu ODT başlığı bulunamadı veya belirsiz. DOSYA NO, TEBLİGAT YAPILAN, GÖNDERİ BARKODU gerekli.');
            cols = found.map(x => x[0]);
            width = vals.length;
            header++;
            continue;
        }
        if (vals.length !== width)
            throw Error(`Satır ${i + 1}: sütun sayısı uyuşmuyor.`);
        const [caseNo, recipient, raw] = cols.map(j => vals[j]);
        const b = barcode(raw);
        if (!caseNo || !recipient || !b || caseNo.length > 128 || recipient.length > 1024)
            throw Error(`Satır ${i + 1}: eksik alan veya geçersiz barkod. Liste kabul edilmedi.`);
        if (seen.has(b))
            throw Error(`Mükerrer barkod: ${seen.get(b)} ve ${i + 1}. satırlar. Liste kabul edilmedi.`);
        seen.set(b, i + 1);
        rows.push({ caseNo, recipient, barcode: b, sourceRow: i + 1 });
        if (rows.length > 10000)
            throw Error('10.000 kayıt sınırı aşıldı.');
    }
    if (!rows.length || !header || rr.length !== rows.length + blank + header)
        throw Error('Liste boş veya satır muhasebesi geçersiz.');
    return { rows, account: { total: rr.length, header, blank, records: rows.length, extraColumns: width - 3 } };
}
export async function fingerprint(rows) { const data = JSON.stringify(rows.map(r => [r.barcode, r.caseNo, r.recipient]).sort((a, b) => a[0].localeCompare(b[0]))); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)); return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''); }
