'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createMultiBridge, readChannels } = require('../video-bridge/multi');
const { findFfmpeg } = require('./start-compatible-player');

function run(executable, args, timeout = 65000) {
    return new Promise(resolve => {
        const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        let text = '';
        child.stdout.on('data', data => { if (text.length < 128000) text += data.toString(); });
        const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
        child.once('error', () => { clearTimeout(timer); resolve({ code: -1 }); });
        child.once('exit', code => { clearTimeout(timer); resolve({ code, text }); });
    });
}

async function main() {
    const root = path.resolve(__dirname, '..'), ffmpeg = findFfmpeg(root);
    const ffprobe = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    const playlist = process.env.SOURCE_PLAYLIST || path.join(root, 'playlists/chile-sin-credenciales.m3u');
    const channels = readChannels(fs.readFileSync(playlist, 'utf8'));
    const bridge = createMultiBridge({ channels, ffmpeg, maxSessions: 1 });
    const server = http.createServer(bridge.handler);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const results = [];
    const availableFile = path.join(root, 'playlists/compatibilidad-origenes.json');
    const available = process.argv.includes('--all') && fs.existsSync(availableFile)
        ? new Set(JSON.parse(fs.readFileSync(availableFile, 'utf8')).results.filter(result => result.status === 200 && ['hls', 'mpegts'].includes(result.kind)).map(result => result.id)) : null;
    const targets = [...channels].filter(([id, channel]) => available ? available.has(id) : ['CHV', 'TNT Sports Premium SD', 'CNN Chile'].includes(channel.name));
    try {
        for (const [id, channel] of targets) {
            const name = channel.name;
            const url = `http://127.0.0.1:${server.address().port}/live/${id}/index.m3u8`;
            console.log(`Convirtiendo y comprobando ${name}…`);
            const probe = await run(ffprobe, ['-v', 'error', '-rw_timeout', '45000000', '-show_entries', 'stream=codec_name,codec_type,width,height', '-of', 'json', url]);
            let streams = [];
            try { streams = JSON.parse(probe.text).streams || []; } catch {}
            const supported = streams.some(s => s.codec_name === 'h264') && streams.some(s => s.codec_name === 'aac');
            let decoded = false;
            if (supported) {
                const decode = await run(ffmpeg, ['-v', 'error', '-rw_timeout', '15000000', '-i', url, '-t', '4', '-f', 'null', '-'], 30000);
                decoded = decode.code === 0;
            }
            results.push({ id, name, codecs: streams, decodedFourSeconds: decoded });
            console.log(`${name}: ${decoded ? 'video H.264 y audio AAC decodificados' : 'no se pudo confirmar la reproducción'}`);
        }
        fs.writeFileSync(path.join(root, 'playlists/compatibilidad-conversion.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
            scope: 'Conversión del origen real a HLS, inspección de códecs y decodificación de cuatro segundos. No prueba la pantalla ni el audio de un dispositivo físico.', results }, null, 2) + '\n');
        if (!results.length || results.some(result => !result.decodedFourSeconds)) process.exitCode = 1;
    } finally {
        bridge.close(); server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
