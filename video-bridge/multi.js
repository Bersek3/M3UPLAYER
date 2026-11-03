'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpegArgs, createHandler } = require('./server');

function sourceId(url) { return crypto.createHash('sha256').update(url).digest('hex').slice(0, 24); }

function readChannels(text) {
    let name = '';
    const channels = new Map();
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim())) {
        if (line.startsWith('#EXTINF:')) name = line.slice(line.lastIndexOf(',') + 1).trim();
        else if (/^https?:\/\//i.test(line)) {
            const url = new URL(line);
            if (url.username || url.password) throw new Error('La lista contiene credenciales HTTP incrustadas no admitidas');
            channels.set(sourceId(url.href), { name: name || 'Canal', url: url.href });
            name = '';
        }
    }
    return channels;
}

function conversionArgs(url, dir, session, { width = 640, fps = 25 } = {}) {
    const args = ffmpegArgs(url, dir, session);
    args[args.indexOf('-vf') + 1] = `bwdif=mode=send_frame:parity=auto:deint=interlaced,fps=${fps},scale=w='min(${width},iw)':h=-2`;
    args[args.indexOf('-g') + 1] = String(fps * 2);
    args[args.indexOf('-keyint_min') + 1] = String(fps * 2);
    if (width >= 1280) {
        args[args.indexOf('-crf') + 1] = '21';
        args[args.indexOf('-maxrate') + 1] = width >= 1920 ? '6000k' : '4000k';
        args[args.indexOf('-bufsize') + 1] = width >= 1920 ? '12000k' : '8000k';
    }
    args.splice(args.indexOf('-i'), 0, '-filter_threads', '1');
    args.splice(args.indexOf('-preset'), 0, '-threads', '2');
    return args;
}

async function resolveSource(source) {
    const url = new URL(source);
    if (url.hostname !== 'rudo.video' || !/^\/live\/[a-z0-9_-]+\/?$/i.test(url.pathname)) return source;
    const response = await fetch(source, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error('No se pudo resolver el reproductor de origen');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (size < 256 * 1024) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value); size += value.length;
        }
    } finally { await reader.cancel(); }
    const match = Buffer.concat(chunks).toString('utf8').match(/\bvar\s+streamURL\s*=\s*['"]([^'"\r\n]+)['"]/);
    if (!match) throw new Error('El reproductor no publica una señal directa');
    const target = new URL(match[1]);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Señal de origen no compatible');
    return target.href;
}

function createMultiBridge({ channels, ffmpeg = 'ffmpeg', maxSessions = 2, idleMs = 45000,
    origins = [], spawnProcess = spawn, resolve = resolveSource, rootDir, videoWidth = 640, videoFps = 25, channelProfiles = {} } = {}) {
    if (!(channels instanceof Map) || !channels.size) throw new Error('La lista de canales está vacía');
    if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 8) throw new Error('MAX_SESSIONS debe estar entre 1 y 8');
    if (!Number.isInteger(videoWidth) || videoWidth < 320 || videoWidth > 1920 || videoWidth % 2 || ![25, 30].includes(videoFps)) throw new Error('Perfil de video inválido: ancho par entre 320 y 1920, FPS 25 o 30');
    for (const [id, profile] of Object.entries(channelProfiles)) {
        if (!channels.has(id) || !profile || !Number.isInteger(profile.width) || profile.width < 320 || profile.width > 1920 || profile.width % 2 || ![25, 30].includes(profile.fps)) throw new Error('Perfil de canal inválido');
    }
    const root = rootDir || fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-multi-'));
    const sessions = new Map();
    let serial = Date.now(), closed = false;

    function dispose(id) {
        const session = sessions.get(id);
        if (!session) return;
        sessions.delete(id); session.disposed = true;
        session.child?.kill('SIGTERM');
        if (session.child) {
            const killer = setTimeout(() => session.child.kill('SIGKILL'), 2000);
            killer.unref(); session.child.once('exit', () => clearTimeout(killer));
        }
        const remove = () => {
            if (path.resolve(session.dir).startsWith(path.resolve(root) + path.sep)) fs.rm(session.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }, () => {});
        };
        if (session.child && session.child.exitCode === null) session.child.once('exit', remove);
        else remove();
    }

    function start(id) {
        let session = sessions.get(id);
        if (session) {
            let modified = session.started;
            try { modified = fs.statSync(path.join(session.dir, 'index.m3u8')).mtimeMs; } catch {}
            if (Date.now() - modified > 45000) session.failed = true;
        }
        if (session?.failed) { dispose(id); session = null; }
        if (session) { session.touched = Date.now(); return session; }
        if (sessions.size >= maxSessions) {
            const oldest = [...sessions].sort((a, b) => a[1].touched - b[1].touched)[0];
            dispose(oldest[0]);
        }
        const dir = fs.mkdtempSync(path.join(root, id + '-'));
        session = { dir, touched: Date.now(), started: Date.now(), disposed: false, failed: false, child: null };
        sessions.set(id, session);
        Promise.resolve().then(() => resolve(channels.get(id).url)).then(url => {
            if (closed || session.disposed) return;
            const profile = channelProfiles[id] || { width: videoWidth, fps: videoFps };
            const child = spawnProcess(ffmpeg, conversionArgs(url, dir, ++serial, profile), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
            session.child = child;
            let diagnostic = '';
            child.stderr?.on('data', chunk => {
                diagnostic = (diagnostic + chunk.toString()).slice(-4096);
                const http = /(?:Server returned|HTTP error)\s+(400|401|403|404|410)\b/i.exec(diagnostic);
                if (http) session.failure = { code: `SOURCE_HTTP_${http[1]}`, error: `El enlace original respondió HTTP ${http[1]}. Necesita una dirección vigente del proveedor.` };
                else if (/Failed to resolve hostname|Name or service not known|No such host is known/i.test(diagnostic)) {
                    session.failure = { code: 'SOURCE_DNS', error: 'El dominio de la señal no se pudo resolver. Actualiza el enlace de origen.' };
                }
            });
            child.once('error', () => { session.failed = true; });
            child.once('exit', () => { if (!session.disposed) session.failed = true; });
        }).catch(() => { session.failed = true; });
        return session;
    }

    const cleanup = setInterval(() => {
        for (const [id, session] of sessions) if (Date.now() - session.touched > idleMs) dispose(id);
    }, Math.min(10000, idleMs));
    cleanup.unref();

    async function handler(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const origin = req.headers.origin;
        if (origin && !origins.includes(origin)) { res.writeHead(403); return res.end('Origin not allowed'); }
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
        if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ running: true, channels: channels.size, sessions: sessions.size })); }
        const match = /^\/live\/([a-f0-9]{24})\/(index\.m3u8|segment-\d+-\d+\.ts)$/.exec(req.url);
        if (!match || !channels.has(match[1])) { res.writeHead(404); return res.end('Channel not configured'); }
        const id = match[1], file = match[2];
        let session = sessions.get(id);
        if (file === 'index.m3u8') session = start(id);
        if (!session || session.disposed) { res.writeHead(404); return res.end('Session expired'); }
        session.touched = Date.now();
        if (file === 'index.m3u8') {
            const deadline = Date.now() + 35000;
            while (!res.destroyed && !session.disposed && !session.failed && Date.now() < deadline) {
                try {
                    const text = fs.readFileSync(path.join(session.dir, file), 'utf8');
                    if ((text.match(/^#EXTINF:/gm) || []).length >= 2) break;
                } catch {}
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            if (res.destroyed) return;
            if (session.failed && session.failure && !session.disposed) {
                res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '3' });
                return res.end(JSON.stringify(session.failure));
            }
            if (session.failed || session.disposed) { res.writeHead(503, { 'Retry-After': '3' }); return res.end('El origen no produjo video compatible; comprueba su disponibilidad.'); }
        }
        const localRequest = Object.create(req);
        localRequest.url = '/live/' + file;
        return createHandler(session.dir, origin || origins[0] || 'http://127.0.0.1:3000')(localRequest, res);
    }

    function close() { closed = true; clearInterval(cleanup); for (const id of [...sessions.keys()]) dispose(id); }
    return { handler: (req, res) => handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(503); if (!res.destroyed) res.end('Video not ready'); }), close, sessions, root };
}

if (require.main === module) {
    const file = process.env.SOURCE_PLAYLIST || path.join(__dirname, '..', 'playlists', 'chile-sin-credenciales.m3u');
    const channels = readChannels(fs.readFileSync(file, 'utf8'));
    const profileFile = process.env.BRIDGE_CHANNEL_PROFILES || path.join(__dirname, 'channel-profiles.local.json');
    const channelProfiles = fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile, 'utf8')) : {};
    const port = Number(process.env.BRIDGE_PORT || process.env.PORT || 10000);
    const origins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:3000,http://localhost:3000,https://m3u-player-one.vercel.app,https://appassets.androidplatform.net').split(',').map(value => new URL(value.trim()).origin);
    const bridge = createMultiBridge({ channels, ffmpeg: process.env.FFMPEG_PATH, maxSessions: Number(process.env.MAX_SESSIONS || 2), origins,
        videoWidth: Number(process.env.BRIDGE_VIDEO_WIDTH || 640), videoFps: Number(process.env.BRIDGE_VIDEO_FPS || 25), channelProfiles });
    const server = http.createServer(bridge.handler);
    server.listen(port, process.env.BRIDGE_HOST || '127.0.0.1', () => console.log(`Conversor listo: ${channels.size} canales, puerto ${port}`));
    const stop = () => { bridge.close(); server.close(); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

module.exports = { sourceId, readChannels, conversionArgs, createMultiBridge };
