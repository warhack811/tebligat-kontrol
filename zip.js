const MAX_FILE = 10 * 1024 * 1024, MAX_XML = 20 * 1024 * 1024;
const fail = () => { throw Error('ZIP yapısı geçersiz, şifreli veya desteklenmiyor.'); };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++)
    n = (n & 1) ? (0xedb88320 ^ (n >>> 1)) : (n >>> 1); return n >>> 0; });
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes)
    c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export async function extractODT(buffer) {
    if (buffer.byteLength > MAX_FILE || buffer.byteLength < 22)
        throw Error('Dosya boyutu desteklenmiyor (10 MiB sınır).');
    const v = new DataView(buffer), a = new Uint8Array(buffer), u16 = p => v.getUint16(p, true), u32 = p => v.getUint32(p, true);
    if (u32(0) !== 0x04034b50)
        fail();
    let end = -1;
    for (let p = a.length - 22; p >= Math.max(0, a.length - 65557); p--)
        if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === a.length) {
            end = p;
            break;
        }
    if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
        fail();
    const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
    if (!count || count > 2000 || start + size !== end)
        fail();
    let p = start;
    const entries = new Map(), td = new TextDecoder('utf-8', { fatal: true });
    for (let i = 0; i < count; i++) {
        if (p + 46 > end || u32(p) !== 0x02014b50)
            fail();
        const n = u16(p + 28), x = u16(p + 30), c = u16(p + 32), next = p + 46 + n + x + c;
        if (next > end || !n || u16(p + 34))
            fail();
        const name = td.decode(a.subarray(p + 46, p + 46 + n));
        if (entries.has(name))
            fail();
        const e = { name, flag: u16(p + 8), method: u16(p + 10), crc: u32(p + 16), compressed: u32(p + 20), length: u32(p + 24), offset: u32(p + 42) };
        if (e.flag & 0x2041)
            fail();
        entries.set(name, e);
        p = next;
    }
    if (p !== end)
        fail();
    async function read(name, limit) { const e = entries.get(name); if (!e)
        fail(); if (e.length > limit)
        throw Error('Açılmış dosya güvenlik sınırını aşıyor.'); let q = e.offset; if (q + 30 > start || u32(q) !== 0x04034b50 || u16(q + 8) !== e.method || u16(q + 6) !== e.flag)
        fail(); let n = u16(q + 26), x = u16(q + 28), off = q + 30 + n + x; if (off + e.compressed > start || td.decode(a.subarray(q + 30, q + 30 + n)) !== name)
        fail(); if (!(e.flag & 8) && (u32(q + 14) !== e.crc || u32(q + 18) !== e.compressed || u32(q + 22) !== e.length))
        fail(); let bytes = a.subarray(off, off + e.compressed); if (e.method === 8) {
        if (typeof DecompressionStream === 'undefined')
            throw Error('Tarayıcı sıkıştırılmış ODT açmayı desteklemiyor. Güncelleyin.');
        const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        let len = 0, parts = [];
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                len += value.length;
                if (len > limit || len > e.length) {
                    await reader.cancel();
                    throw Error('Açılmış dosya boyutu sınırı aşıldı.');
                }
                parts.push(value);
            }
            bytes = new Uint8Array(len);
            let at = 0;
            for (const part of parts) {
                bytes.set(part, at);
                at += part.length;
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    else if (e.method !== 0)
        fail(); if (bytes.length !== e.length || crc32(bytes) !== e.crc)
        fail(); return td.decode(bytes); }
    if (await read('mimetype', 128) !== 'application/vnd.oasis.opendocument.text')
        throw Error('Geçerli ODT metin belgesi değil.');
    return await read('content.xml', MAX_XML);
}
