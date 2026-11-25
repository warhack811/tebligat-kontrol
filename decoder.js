// Restricted numeric Code 39: standard digit and start/stop patterns, no guessing.
const patterns = new Map([0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064, 0x094].map((v, i) => [v, i === 10 ? '*' : String(i)]));
function symbol(r, i) { if (i + 9 > r.length)
    return null; const a = r.slice(i, i + 9), s = [...a].sort((x, y) => x - y); if (s[6] < s[5] * 1.42 || s[8] > s[6] * 2.1 || s[5] > s[0] * 2.5)
    return null; const threshold = (s[5] + s[6]) / 2; let mask = 0; for (const n of a)
    mask = (mask << 1) | (n > threshold ? 1 : 0); const c = patterns.get(mask); return c ? { c, narrow: (s[2] + s[3]) / 2 } : null; }
function lineDecode(gray) { let lo = 255, hi = 0; for (const x of gray) {
    if (x < lo)
        lo = x;
    if (x > hi)
        hi = x;
} if (hi - lo < 42)
    return []; let hist = new Uint32Array(256); for (const x of gray)
    hist[x]++; let sum = 0; for (let i = 0; i < 256; i++)
    sum += i * hist[i]; let w = 0, s = 0, best = -1, threshold = (lo + hi) / 2; for (let i = lo; i < hi; i++) {
    w += hist[i];
    s += i * hist[i];
    if (!w || w === gray.length)
        continue;
    const delta = s / w - (sum - s) / (gray.length - w), score = w * (gray.length - w) * delta * delta;
    if (score > best) {
        best = score;
        threshold = i;
    }
} const out = []; for (const reverse of [false, true]) {
    const runs = [], starts = [];
    let prev = false, n = 0;
    for (let j = 0; j < gray.length; j++) {
        const black = gray[reverse ? gray.length - 1 - j : j] <= threshold;
        if (black !== prev) {
            runs.push(n);
            starts.push(j - n);
            n = 0;
            prev = black;
        }
        n++;
    }
    runs.push(n);
    starts.push(gray.length - n);
    for (let i = 1; i + 149 <= runs.length; i += 2) {
        const a = symbol(runs, i);
        if (a?.c !== '*' || runs[i - 1] < a.narrow * 4)
            continue;
        let str = '', j = i + 10, ok = true;
        for (let k = 0; k < 14; k++, j += 10) {
            const x = symbol(runs, j);
            if (!x || runs[j - 1] > x.narrow * 2.8 || runs[j - 1] < x.narrow * .35 || x.narrow / a.narrow > 2 || x.narrow / a.narrow < .5) {
                ok = false;
                break;
            }
            if (k === 13) {
                if (x.c !== '*' || (runs[j + 9] || 0) < x.narrow * 4)
                    ok = false;
            }
            else {
                if (x.c === '*') {
                    ok = false;
                    break;
                }
                str += x.c;
            }
        }
        if (ok && str.length === 13) {
            const start = starts[i], end = starts[i + 149] ?? gray.length;
            const left = reverse ? gray.length - end : start, right = reverse ? gray.length - start : end;
            out.push({ code: str, left, right });
            i += 148;
        }
    }
} return out; }
export function decodeImage({ data, width, height }, exhaustive=false) {
    if (width < 100 || height < 20 || data.length !== width * height * 4 || width * height > 3000000)
        return [];
    const lum = (x, y) => { const i = (y * width + x) * 4; return (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8; };
    function sweep(slopes, dense=false) { const hits = []; for (const vertical of [false, true])
        for (const slope of slopes) {
            const extent = vertical ? width : height, len = vertical ? height : width;
            const step = Math.max(2, Math.min(dense?10:48, Math.floor(extent / 40)));
            for (let pos = Math.floor(step / 2); pos < extent; pos += step) {
                const gray = new Uint8Array(len);
                let start = -1, end = -1;
                for (let i = 0; i < len; i++) {
                    const cross = Math.round(pos + slope * (i - (len - 1) / 2));
                    if (cross < 0 || cross >= extent) {
                        gray[i] = 255;
                        continue;
                    }
                    if (start < 0)
                        start = i;
                    end = i;
                    gray[i] = vertical ? lum(cross, i) : lum(i, cross);
                }
                if (end - start < 100)
                    continue;
                for (const h of lineDecode(gray.subarray(start, end + 1))) {
                    h.left += start;
                    h.right += start;
                    const prior = hits.find(k => k.code === h.code && k.vertical === vertical && k.slope === slope && Math.abs(k.left - h.left) < len * .08 && Math.abs(k.right - h.right) < len * .08 && Math.abs(k.last - pos) <= step * 3);
                    if (prior) {
                        if (prior.last !== pos)
                            prior.n++;
                        prior.last = pos;
                    }
                    else
                        hits.push({ ...h, vertical, slope, last: pos, n: 1 });
                }
            }
        } return hits.filter(h => h.n >= 2); }
    const straight = sweep([0],true);
    if (straight.length && !exhaustive)
        return straight.map(h => h.code);
    // Angled fallback only when horizontal/vertical passes found no symbol. Each
    // direction is assessed independently; ambiguous different codes stay blocked.
    const slopes=[-.087,.087,-.176,.176,-.268,.268,-.364,.364,-.466,.466,-.577,.577,-.700,.700,-.839,.839,-1,1];
    let angled=sweep(slopes);if(!angled.length&&!straight.length)angled=sweep(slopes,true);
    if(straight.length){const codes=straight.map(h=>h.code);for(const h of angled)if(!codes.includes(h.code))codes.push(h.code);return codes;}
    const unique = new Set(angled.map(h => h.code));
    if (unique.size > 1)
        return [...unique];
    if (!unique.size)
        return [];
    const byDirection = new Map();
    for (const h of angled) {
        const k = `${h.vertical}/${h.slope}`;
        byDirection.set(k, (byDirection.get(k) || 0) + 1);
    }
    return Array(Math.max(...byDirection.values())).fill([...unique][0]);
}
