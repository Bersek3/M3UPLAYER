const fs = require('node:fs');
const path = require('node:path');
const { readChannels } = require('../video-bridge/multi');

async function main() {
    const root = path.resolve(__dirname, '..');
    const privateList = path.join(root, 'playlists/chile.m3u');
    const file = process.env.SOURCE_PLAYLIST || (fs.existsSync(privateList) ? privateList : path.join(root, 'playlists/chile-sin-credenciales.m3u'));
    const results = [];
    for (const [id, channel] of readChannels(fs.readFileSync(file, 'utf8'))) {
        let result = { id, name: channel.name };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(channel.url, { signal: controller.signal,
                headers: { 'User-Agent': 'VLC/3.0.21', Range: 'bytes=0-1023' } });
            const reader = response.body.getReader();
            const { value } = await reader.read(); await reader.cancel();
            const bytes = Buffer.from(value || []);
            result = { ...result, status: response.status, contentType: response.headers.get('content-type'),
                kind: bytes.toString('utf8').trimStart().startsWith('#EXTM3U') ? 'hls'
                    : bytes.length > 188 && bytes[0] === 0x47 && bytes[188] === 0x47 ? 'mpegts'
                    : /text\/html/.test(response.headers.get('content-type') || '') ? 'pagina-html' : 'otro' };
        } catch (error) { result.error = error.cause?.code || error.name; }
        finally { clearTimeout(timer); }
        results.push(result);
        console.log(`${result.name}: ${result.status || result.error} ${result.kind || ''}`);
    }
    fs.writeFileSync(path.join(root, 'playlists/compatibilidad-origenes.json'), JSON.stringify({
        checkedAt: new Date().toISOString(), scope: 'Disponibilidad y formato de una muestra de cada enlace original con User-Agent VLC. No verifica decodificación ni continuidad.', results
    }, null, 2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
