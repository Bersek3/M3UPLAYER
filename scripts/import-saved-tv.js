const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://pelisjuanita.com/tv/tv/';
function decode(value) {
    return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function attribute(tag, name) {
    return decode(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '');
}
function mediaUrl(value) {
    try {
        const url = new URL(value, BASE);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        if (/\.(m3u8|mp4|mp3|ts)$/i.test(url.pathname)) return url.href;
        // These saved wrappers expose their source in plain text or Base64.
        // Read the value as data; never execute the saved page's scripts.
        if (url.pathname.endsWith('/f.html')) {
            let source = url.searchParams.get('get') || '';
            if (!/^https?:\/\//i.test(source)) source = Buffer.from(source, 'base64').toString('utf8');
            if (/^https?:\/\//i.test(source)) {
                const target = new URL(source);
                if (/\.(m3u8|mp4|mp3|ts)$/i.test(target.pathname)) return target.href;
            }
        }
    } catch {}
    return null;
}

function extract(html) {
    const catalog = [];
    for (const match of html.matchAll(/<div\b([^>]*\bclass="item"[^>]*)>([\s\S]*?)<h2>([\s\S]*?)<\/h2>/g)) {
        const tag = match[1];
        const group = attribute(tag, 'data-categoria');
        if (group.toLowerCase() === 'adultos') continue;
        const onclick = attribute(tag, 'onclick');
        const json = onclick.match(/cambiarOpcion\(this,\s*(\[[\s\S]*\])\s*\)/)?.[1];
        if (!json) continue;
        let options;
        try { options = JSON.parse(json); } catch { continue; }
        const sources = options.filter(option => typeof option.url === 'string').map(option => new URL(option.url, BASE).href);
        const streams = [...new Set(sources.map(mediaUrl).filter(Boolean))];
        catalog.push({
            name: decode(match[3].replace(/<[^>]*>/g, '')).trim(),
            group, country: attribute(tag, 'data-pais'), slug: attribute(tag, 'data-slug'),
            sources, streams, status: streams.length ? 'not-tested' : 'web-player-only'
        });
    }
    return catalog;
}
function toM3U(channels) {
    const clean = value => String(value || '').replace(/[\r\n"]/g, ' ');
    return '#EXTM3U\n' + channels.map(channel =>
        `#EXTINF:-1 group-title="${clean(channel.group)}",${clean(channel.name)}\n${channel.url}`
    ).join('\n') + '\n';
}

if (require.main === module) {
    const input = process.argv[2];
    if (!input) throw new Error('Uso: node scripts/import-saved-tv.js archivo.html');
    const catalog = extract(fs.readFileSync(input, 'utf8'));
    const channels = catalog.flatMap(channel => channel.streams.map((url, i) => ({
        name: channel.name + (i ? ` (alternativa ${i + 1})` : ''), group: channel.group, url
    })));
    const dir = path.resolve(__dirname, '../playlists');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tv-gratis-catalog.json'), JSON.stringify(catalog, null, 2));
    fs.writeFileSync(path.join(dir, 'tv-gratis-candidatos.m3u'), toM3U(channels));
    console.log(JSON.stringify({ catalog: catalog.length, withDirectStream: catalog.filter(c => c.streams.length).length,
        candidateStreams: channels.length, webPlayerOnly: catalog.filter(c => !c.streams.length).length }));
}
module.exports = { extract, mediaUrl, toM3U };
