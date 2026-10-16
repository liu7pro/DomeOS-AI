"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEntities = decodeEntities;
exports.webSearch = webSearch;
exports.readPage = readPage;
// src/main/websearch.ts - what lets the agent look things up the way an assistant does.
//
// No paid search key on purpose: the tool reads public result pages and walks a chain of
// engines until one answers. The chain is ordered by how reliably each is reachable - the
// international engines are last because they are blocked on some networks, and vice versa.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
    '&hellip;': '…', '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“',
    '&rdquo;': '”', '&middot;': '·', '&times;': '×',
};
function decodeEntities(s) {
    return s
        .replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp|hellip|mdash|ndash|rsquo|lsquo|ldquo|rdquo|middot|times);/g, (m) => ENTITIES[m] ?? m)
        .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
function stripTags(html) {
    return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
/** Search engines wrap their result links; unwrap the common cases. */
function unwrap(url) {
    let out = decodeEntities(url);
    const ddg = /[?&]uddg=([^&]+)/.exec(out);
    if (ddg) {
        try {
            out = decodeURIComponent(ddg[1]);
        }
        catch {
            /* keep the raw href */
        }
    }
    if (out.startsWith('//'))
        out = `https:${out}`;
    return out;
}
/** Everything between two markers, tolerant of attribute order. */
function blocks(html, startRe) {
    const out = [];
    const re = new RegExp(startRe.source, 'gi');
    let m;
    while ((m = re.exec(html))) {
        // a result block ends at the next block of the same kind
        const rest = html.slice(m.index + m[0].length);
        const next = new RegExp(startRe.source, 'i').exec(rest);
        out.push(html.slice(m.index, next ? m.index + m[0].length + next.index : m.index + 4000));
    }
    return out;
}
function firstLink(block) {
    const a = /<a[^>]+href="([^"]+)"/i.exec(block);
    return a ? unwrap(a[1]) : '';
}
/** Bing: <li class="b_algo"> … <h2><a href> … <p>snippet</p> */
function parseBing(html, limit) {
    const out = [];
    for (const block of blocks(html, /<li class="b_algo"/)) {
        if (out.length >= limit)
            break;
        const h2 = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        if (!h2)
            continue;
        const snip = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
        const url = unwrap(h2[1]);
        if (!/^https?:/i.test(url))
            continue;
        out.push({ title: stripTags(h2[2]), url, snippet: snip ? stripTags(snip[1]) : '' });
    }
    return out;
}
/** Baidu: <div class="result …"> … <h3><a href> … abstract text */
function parseBaidu(html, limit) {
    const out = [];
    for (const block of blocks(html, /<div[^>]+class="result[ "]/)) {
        if (out.length >= limit)
            break;
        const h3 = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        if (!h3)
            continue;
        const url = unwrap(h3[1]);
        // Baidu's own AI cards and redirects are noise; the real link carries data-tools or is absolute
        if (!/^https?:/i.test(url) || /baidu\.com\/link\?/.test(url))
            continue;
        const snip = /<span[^>]+class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block) ??
            /<div[^>]+class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
        out.push({ title: stripTags(h3[2]), url, snippet: snip ? stripTags(snip[1]) : '' });
    }
    return out;
}
/** 360: <li class="res-list"> … <h3 class="res-title"><a href data-mdurl> */
function parse360(html, limit) {
    const out = [];
    for (const block of blocks(html, /<li[^>]+class="res-list"/)) {
        if (out.length >= limit)
            break;
        const a = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
        if (!a)
            continue;
        // 360 redirects through /link?m=…; data-mdurl holds the destination
        const real = /data-mdurl="([^"]+)"/i.exec(a[2]);
        const url = unwrap(real ? real[1] : a[1]);
        if (!/^https?:/i.test(url))
            continue;
        const snip = /<p[^>]+class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);
        out.push({ title: stripTags(a[3]), url, snippet: snip ? stripTags(snip[1]) : '' });
    }
    return out;
}
/** DuckDuckGo's no-JS endpoint. */
function parseDuckDuckGo(html, limit) {
    const out = [];
    const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippets = [];
    let sm;
    while ((sm = snippetRe.exec(html)))
        snippets.push(stripTags(sm[1]));
    let m;
    let i = 0;
    while ((m = linkRe.exec(html)) && out.length < limit) {
        const url = unwrap(m[1]);
        if (!/^https?:/i.test(url))
            continue;
        out.push({ title: stripTags(m[2]), url, snippet: snippets[i] ?? '' });
        i++;
    }
    return out;
}
/** Brave's plain HTML page. */
function parseBrave(html, limit) {
    const out = [];
    const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
        out.push({ title: stripTags(m[2]), url: m[1], snippet: '' });
    }
    return out;
}
/** Ordered by reachability: the ones that answer on a restricted network come first. */
const ENGINES = [
    { name: 'bing', url: (q) => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN`, parse: parseBing },
    { name: 'baidu', url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=20`, parse: parseBaidu },
    { name: 'so360', url: (q) => `https://www.so.com/s?q=${encodeURIComponent(q)}`, parse: parse360 },
    { name: 'duckduckgo', url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, parse: parseDuckDuckGo },
    { name: 'brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`, parse: parseBrave },
];
async function webSearch(query, limit, signal) {
    const tried = [];
    for (const engine of ENGINES) {
        try {
            const timeout = AbortSignal.timeout(12_000);
            const res = await fetch(engine.url(query), {
                headers: {
                    'user-agent': UA,
                    accept: 'text/html,application/xhtml+xml',
                    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
                },
                redirect: 'follow',
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            });
            if (!res.ok) {
                tried.push(`${engine.name}: HTTP ${res.status}`);
                continue;
            }
            const html = await res.text();
            const hits = engine.parse(html, limit);
            if (hits.length)
                return { ok: true, engine: engine.name, hits };
            tried.push(`${engine.name}: no results parsed`);
        }
        catch (e) {
            if (signal?.aborted)
                return { ok: true, engine: '', hits: [] };
            tried.push(`${engine.name}: ${e?.cause?.code ?? e?.name ?? e?.message ?? e}`);
        }
    }
    return {
        ok: false,
        engine: '',
        hits: [],
        error: tried.join('; ') || 'every search engine refused the request',
    };
}
/** Reads a page and reduces it to readable text, keeping the links inline. */
async function readPage(url, limit, signal) {
    try {
        const timeout = AbortSignal.timeout(25_000);
        const res = await fetch(url, {
            headers: {
                'user-agent': UA,
                accept: 'text/html,application/json,text/plain,*/*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            redirect: 'follow',
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const raw = await res.text();
        const type = res.headers.get('content-type') ?? '';
        if (type.includes('json')) {
            const text = raw.length > limit ? `${raw.slice(0, limit)}\n[truncated]` : raw;
            return { ok: res.ok, status: res.status, title: url, text };
        }
        const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? '').trim());
        // keep link targets so the agent can follow up
        const withLinks = raw.replace(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => `[${stripTags(label) || href}](${href})`);
        const text = decodeEntities(withLinks
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<head[\s\S]*?<\/head>/gi, ' ')
            .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table)>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' '))
            .replace(/[ \t\u00a0]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .join('\n');
        const cut = text.length > limit;
        return {
            ok: res.ok,
            status: res.status,
            title: title || url,
            text: cut ? `${text.slice(0, limit)}\n\n[truncated at ${limit} chars]` : text,
        };
    }
    catch (e) {
        return {
            ok: false,
            status: 0,
            title: url,
            text: '',
            error: String(e?.cause?.code ?? e?.name ?? e?.message ?? e),
        };
    }
}
