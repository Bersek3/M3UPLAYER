'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { readChannels } = require('../video-bridge/multi');

function findFfmpeg(root = path.resolve(__dirname, '..')) {
    const toolDir = path.join(root, '.android-tools/ffmpeg');
    let ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    if (!process.env.FFMPEG_PATH && fs.existsSync(toolDir)) {
        for (const entry of fs.readdirSync(toolDir, { withFileTypes: true })) {
            const candidate = path.join(toolDir, entry.name, 'bin', 'ffmpeg.exe');
            if (entry.isDirectory() && fs.existsSync(candidate)) { ffmpeg = candidate; break; }
        }
    }
    if (spawnSync(ffmpeg, ['-version'], { stdio: 'ignore', windowsHide: true }).status !== 0) {
        throw new Error('Falta FFmpeg. Instálalo o define FFMPEG_PATH con la ruta al ejecutable.');
    }
    return ffmpeg;
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const supplied = process.argv[2] ? path.resolve(process.argv[2]) : null;
    const privateList = path.join(root, 'playlists/chile.m3u');
    const playlist = supplied || (fs.existsSync(privateList) ? privateList : path.join(root, 'playlists/chile-sin-credenciales.m3u'));
    const channels = readChannels(fs.readFileSync(playlist, 'utf8'));
    const ffmpeg = findFfmpeg(root);
    const appPort = Number(process.env.APP_PORT || 3000);
    const bridgePort = Number(process.env.BRIDGE_PORT || 10000);
    const bridgeBase = `http://127.0.0.1:${bridgePort}`;
    const env = { ...process.env, FFMPEG_PATH: ffmpeg, SOURCE_PLAYLIST: playlist,
        BRIDGE_PORT: String(bridgePort), PORT: String(appPort), HOST: '127.0.0.1', BRIDGE_HOST: '127.0.0.1',
        ALLOWED_ORIGINS: `http://127.0.0.1:${appPort},http://localhost:${appPort}`,
        M3U_PLAYBACK_BRIDGE_URL: bridgeBase, M3U_BRIDGE_SOURCE_IDS: [...channels.keys()].join(',') };
    const children = [];
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        for (const child of children) child.kill('SIGTERM');
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    for (const file of ['video-bridge/multi.js', 'server/server.js']) {
        const child = spawn(process.execPath, [path.join(root, file)], { cwd: root, env, stdio: 'inherit', windowsHide: true });
        children.push(child);
        child.once('error', stop);
        child.once('exit', code => { if (!stopping) { process.exitCode = code || 1; stop(); } });
    }
    fs.writeFileSync(path.join(root, 'playlists/chile-convertidos-local.m3u'), '#EXTM3U\n' + [...channels].map(([id, channel]) =>
        `#EXTINF:-1 group-title="Chile",${channel.name}\n${bridgeBase}/live/${id}/index.m3u8\n`).join(''));
    console.log(`Abre http://127.0.0.1:${appPort} y entra con tu cuenta habitual.`);
    console.log('Las señales de esta lista se convierten bajo demanda. Ctrl+C detiene ambos servicios.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { findFfmpeg };
