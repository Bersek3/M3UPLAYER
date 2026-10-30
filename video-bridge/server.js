'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function ffmpegArgs(source, dir, session) {
    return ['-hide_banner', '-loglevel', 'error', '-nostdin',
        '-rw_timeout', '15000000', '-reconnect', '1', '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5', '-user_agent', 'VLC/3.0.21', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', "scale=w='min(1280,iw)':h=-2", '-c:v', 'libx264', '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p', '-crf', '23', '-maxrate', '2500k', '-bufsize', '5000k',
        '-force_key_frames', 'expr:gte(t,n_forced*2)',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
        '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8', '-hls_delete_threshold', '4',
        '-hls_start_number_source', 'epoch',
        '-hls_flags', 'delete_segments+independent_segments+temp_file+discont_start',
        '-hls_segment_filename', path.join(dir, `segment-${session}-%09d.ts`),
        path.join(dir, 'index.m3u8')];
}

function createHandler(dir, allowedOrigin) {
    return (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{"service":"running"}');
        }
        if (req.headers.origin && req.headers.origin !== allowedOrigin) {
            res.writeHead(403); return res.end('Origin not allowed');
        }
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
        // Fixed output files only: this service never accepts arbitrary source URLs.
        const match = /^\/live\/(index\.m3u8|segment-\d+-\d+\.ts)$/.exec(req.url);
        if (!match) { res.writeHead(404); return res.end('Not found'); }
        const filename = path.join(dir, match[1]);
        fs.stat(filename, (error, stat) => {
            if (error || !stat.isFile()) {
                res.setHeader('Retry-After', '3');
                res.writeHead(match[1] === 'index.m3u8' ? 503 : 404);
                return res.end('Video not ready');
            }
            if (match[1] === 'index.m3u8' && Date.now() - stat.mtimeMs > 30000) {
                res.writeHead(503); return res.end('Upstream video stalled');
            }
            if (match[1] === 'index.m3u8') {
                // FFmpeg replaces the manifest atomically; read one snapshot before sizing it.
                return fs.readFile(filename, (readError, body) => {
                    if (readError) { res.writeHead(503); return res.end('Video not ready'); }
                    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': body.length });
                    res.end(req.method === 'HEAD' ? undefined : body);
                });
            }
            const file = fs.createReadStream(filename);
            file.on('error', () => {
                if (!res.headersSent) { res.writeHead(404); res.end('Not found'); }
                else res.destroy();
            });
            file.on('open', () => {
                res.writeHead(200, { 'Content-Type': match[1].endsWith('.m3u8')
                    ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Content-Length': stat.size });
                if (req.method === 'HEAD') { file.destroy(); res.end(); }
                else file.pipe(res);
            });
            res.on('close', () => file.destroy());
        });
    };
}

function normalizeOrigin(value) {
    const message = 'ALLOWED_ORIGIN debe ser la URL HTTPS de tu pagina, por ejemplo https://m3u-player-one.vercel.app';
    let origin;
    try { origin = new URL(String(value || '').trim()); }
    catch { throw new Error(message); }
    if (origin.protocol !== 'https:' || origin.username || origin.password ||
        origin.pathname !== '/' || origin.search || origin.hash) throw new Error(message);
    return origin.origin;
}

function main() {
    const source = new URL(process.env.SOURCE_URL || 'http://181.78.79.131:8000/play/a0q9');
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Invalid SOURCE_URL');
    const origin = normalizeOrigin(process.env.ALLOWED_ORIGIN);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnt-hls-'));
    let child, retryTimer, stopping = false, started = Date.now();
    function start() {
        started = Date.now();
        child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ffmpegArgs(source.href, dir, Date.now()),
            { stdio: ['ignore', 'ignore', 'ignore'] });
        child.on('error', () => console.error('Could not start FFmpeg. Check installation.'));
        child.on('close', code => {
            if (!stopping) {
                console.error(`Video process stopped (${code}); retrying in 5 seconds.`);
                retryTimer = setTimeout(start, 5000);
            }
        });
    }
    // FFmpeg may be alive while the upstream stops producing usable frames.
    const watchdog = setInterval(() => {
        let modified = started;
        try { modified = fs.statSync(path.join(dir, 'index.m3u8')).mtimeMs; } catch {}
        if (Date.now() - Math.max(modified, started) > 60000) child?.kill('SIGKILL');
        // Remove leftovers from prior process sessions; keep recent segments for active viewers.
        for (const name of fs.readdirSync(dir)) {
            if (!/^segment-\d+-\d+\.ts(?:\.tmp)?$/.test(name)) continue;
            try {
                if (Date.now() - fs.statSync(path.join(dir, name)).mtimeMs > 120000) {
                    fs.unlinkSync(path.join(dir, name));
                }
            } catch {}
        }
    }, 10000);
    const server = http.createServer(createHandler(dir, origin));
    server.listen(Number(process.env.PORT || 10000), '0.0.0.0', start);
    function stop() {
        if (stopping) return;
        stopping = true;
        clearTimeout(retryTimer); clearInterval(watchdog);
        child?.kill('SIGTERM');
        server.close();
        setTimeout(() => { child?.kill('SIGKILL'); process.exit(0); }, 3000).unref();
    }
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

if (require.main === module) main();
module.exports = { ffmpegArgs, createHandler, normalizeOrigin };
