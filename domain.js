export const PROFILE = 'ptt13-v1';
export function barcode(raw) { if (typeof raw !== 'string')
    return null; let s = raw.trim(); if (/^\*[0-9]{13}\*$/.test(s))
    s = s.slice(1, -1); if (!/^[0-9]{13}$/.test(s))
    return null; let sum = 0; for (let i = 0; i < 12; i++)
    sum += Number(s[i]) * (i % 2 ? 3 : 1); return (10 - sum % 10) % 10 === Number(s[12]) ? s : null; }
export function session(rows, meta = {}) { const expected = new Map(); for (const r of rows) {
    if (barcode(r.barcode) !== r.barcode || expected.has(r.barcode))
        throw Error('Geçersiz veya mükerrer referans.');
    expected.set(r.barcode, Object.freeze({ ...r }));
} if (!expected.size)
    throw Error('Liste boş.'); return { expected, accepted: new Map(), history: [], duplicates: new Map(), issues: [], meta, physical: null }; }
export function scan(s, raw, source = 'camera') { const b = barcode(raw); if (!b)
    return { kind: 'invalid' }; if (s.history.length >= 50000) return { kind: 'limit' }; if (s.accepted.has(b)) {
    s.duplicates.set(b, (s.duplicates.get(b) || 0) + 1);
    s.history.push({ kind: 'duplicate', b });
    return { kind: 'duplicate', b, row: s.expected.get(b) };
} const kind = s.expected.has(b) ? 'matched' : 'outside'; const e = { kind, b, source, at: Date.now() }; s.accepted.set(b, e); s.history.push(e); return { ...e, row: s.expected.get(b) }; }
export function undo(s) { const e = s.history.pop(); if (!e)
    return null; if (e.kind === 'duplicate') {
    const n = s.duplicates.get(e.b) - 1;
    if (n)
        s.duplicates.set(e.b, n);
    else
        s.duplicates.delete(e.b);
}
else
    s.accepted.delete(e.b); return e; }
export function counts(s) { let matched = 0; for (const b of s.accepted.keys())
    if (s.expected.has(b))
        matched++; return { total: s.expected.size, matched, missing: s.expected.size - matched, outside: s.accepted.size - matched, accepted: s.accepted.size, repeats: [...s.duplicates.values()].reduce((a, b) => a + b, 0), issues: s.issues.filter(x => !x.resolved).length }; }
export function results(s, type) { if (type === 'missing')
    return [...s.expected.values()].filter(r => !s.accepted.has(r.barcode)); if (type === 'matched')
    return [...s.expected.values()].filter(r => s.accepted.has(r.barcode)).map(r => ({ ...r, source: s.accepted.get(r.barcode).source })); if (type === 'outside')
    return [...s.accepted.values()].filter(e => e.kind === 'outside').map(e => ({ barcode: e.b, source: e.source })); return [...s.duplicates].map(([barcode, times]) => ({ barcode, times, ...s.expected.get(barcode) })); }
export class Gate {
    constructor() { this.reset(); }
    reset(block = null) { this.last = null; this.hits = 0; this.block = block; this.absent = 0; }
    feed(codes, now) { const unique = [...new Set(codes)]; if (codes.length > 1 || unique.length > 1) {
        this.last = null;
        this.hits = 0;
        this.absent = 0;
        return { kind: 'multi' };
    } if (!codes.length) {
        this.last = null;
        this.hits = 0;
        if (!this.absent)
            this.absent = now;
        if (now - this.absent >= 350)
            this.block = null;
        return { kind: 'none' };
    } this.absent = 0; const b = codes[0]; if (b === this.block) { this.last = null; this.hits = 0; return { kind: 'hold' }; } if (b !== this.last) {
        this.last = b;
        this.hits = 1;
        this.first = now;
        return { kind: 'confirm' };
    } if (now - this.first > 1200) {
        this.hits = 1;
        this.first = now;
        return { kind: 'confirm' };
    } if (++this.hits >= 2) {
        this.block = b;
        this.last = null;
        this.hits = 0;
        return { kind: 'accept', b };
    } return { kind: 'confirm' }; }
}
