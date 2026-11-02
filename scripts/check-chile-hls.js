const fs = require('node:fs');
const path = require('node:path');

const candidates = [
    ['13C', 'https://origin.dpsgo.com/ssai/event/GI-9cp_bT8KcerLpZwkuhw/master.m3u8'],
    ['Mega', 'https://unlimited1-cl-isp.dps.live/mega/mega.smil/playlist.m3u8'],
    ['TVN', 'https://iptv.bitred.cl/tvn/index.m3u8'],
    ['Canal 13', 'http://181.78.8.199:8000/play/a0d4/index.m3u8'],
    ['Canal 13 (alternativa)', 'http://181.78.8.199:8000/play/a0dj/index.m3u8']
];

async function read(url, sample = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(url, { signal: controller.signal,
            headers: sample ? { Range: 'bytes=0-32767' } : {} });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body.getReader(), chunks = [];
        let bytes = 0;
        const limit = sample ? 32768 : 512 * 1024;
        try {
            while (bytes < limit) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = value.subarray(0, limit - bytes);
                chunks.push(chunk); bytes += chunk.length;
            }
        } finally { await reader.cancel(); }
        return { body: Buffer.concat(chunks), url: response.url,
            cors: response.headers.get('access-control-allow-origin') };
    } finally { clearTimeout(timer); }
}

async function check([name, url]) {
    try {
        let next = url;
        for (let level = 0; level < 5; level++) {
            const result = await read(next);
            const text = result.body.toString('utf8').replace(/^\uFEFF/, '').trim();
            if (!text.startsWith('#EXTM3U')) throw new Error('La respuesta no es un manifiesto HLS');
            const lines = text.split(/\r?\n/).map(line => line.trim());
            const variants = [];
            lines.forEach((line, index) => {
                if (line.startsWith('#EXT-X-STREAM-INF:') && lines[index + 1] && !lines[index + 1].startsWith('#')) {
                    variants.push({ url: new URL(lines[index + 1], result.url).href,
                        bandwidth: Number(line.match(/(?:[:,])BANDWIDTH=(\d+)/)?.[1] || Infinity) });
                }
            });
            if (variants.length) {
                next = variants.sort((a, b) => a.bandwidth - b.bandwidth)[0].url;
                continue;
            }
            const segments = lines.filter(line => line && !line.startsWith('#'));
            if (!segments.length) throw new Error('El manifiesto no tiene fragmentos');
            const sample = await read(new URL(segments.at(-1), result.url).href, true);
            const body = sample.body;
            const transport = body.length > 376 && body[0] === 0x47 && body[188] === 0x47 && body[376] === 0x47;
            const fragmentedMp4 = ['styp', 'moof', 'ftyp', 'sidx'].includes(body.subarray(4, 8).toString('ascii'));
            if (!transport && !fragmentedMp4) throw new Error('La muestra no contiene MPEG-TS o MP4 reconocible');
            return { name, url, checked: true, sampleBytes: body.length,
                format: transport ? 'mpegts' : 'fmp4', cors: sample.cors };
        }
        throw new Error('Demasiados niveles de manifiestos');
    } catch (error) {
        return { name, url, checked: false, reason: error.cause?.code || error.message };
    }
}

async function main() {
    const results = await Promise.all(candidates.map(check));
    const valid = results.filter(result => result.checked);
    const root = path.resolve(__dirname, '..', 'playlists');
    fs.writeFileSync(path.join(root, 'chile-hls-comprobados.m3u'), '#EXTM3U\n' + valid.map(result =>
        `#EXTINF:-1 group-title="Chile",${result.name}\n${result.url}\n`).join(''));
    fs.writeFileSync(path.join(root, 'chile-hls-comprobacion.json'), JSON.stringify({
        checkedAt: new Date().toISOString(), scope: 'Manifiestos HLS y muestra de un fragmento; sin prueba de decodificación o continuidad en navegador.', results
    }, null, 2) + '\n');
    for (const result of results) console.log(`${result.name}: ${result.checked ? 'HLS y muestra de video recibidos' : result.reason}`);
    if (!valid.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
