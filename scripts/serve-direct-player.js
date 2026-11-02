'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assets = new Map([
    ['/', ['direct-player.html', 'text/html; charset=utf-8']],
    ['/direct-player.html', ['direct-player.html', 'text/html; charset=utf-8']],
    ['/direct-player-page.js', ['direct-player-page.js', 'text/javascript; charset=utf-8']],
    ['/direct-mpegts.js', ['direct-mpegts.js', 'text/javascript; charset=utf-8']],
    ['/mp2-ts-loader.js', ['mp2-ts-loader.js', 'text/javascript; charset=utf-8']],
    ['/avc-fields.js', ['avc-fields.js', 'text/javascript; charset=utf-8']],
    ['/mp2-audio.js', ['mp2-audio.js', 'text/javascript; charset=utf-8']],
    ['/vendor/mpg123-decoder-1.0.3.min.js', ['vendor/mpg123-decoder-1.0.3.min.js', 'text/javascript; charset=utf-8']],
    ['/vendor/THIRD-PARTY.md', ['vendor/THIRD-PARTY.md', 'text/plain; charset=utf-8']],
    ['/vendor/mpg123-decoder-LICENSE.txt', ['vendor/mpg123-decoder-LICENSE.txt', 'text/plain; charset=utf-8']],
    ['/vendor/mpg123-LGPL-2.1.txt', ['vendor/mpg123-LGPL-2.1.txt', 'text/plain; charset=utf-8']],
    ['/vendor/mpegts.js.LICENSE.txt', ['vendor/mpegts.js.LICENSE.txt', 'text/plain; charset=utf-8']],
    ['/vendor/mpegts-1.8.2.min.js', ['vendor/mpegts-1.8.2.min.js', 'text/javascript; charset=utf-8']],
    ['/vendor/mpegts-LICENSE.txt', ['vendor/mpegts-LICENSE.txt', 'text/plain; charset=utf-8']]
]);

function createServer() {
    return http.createServer((req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { Allow: 'GET, HEAD' });
            return res.end();
        }
        let pathname;
        try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; }
        catch { res.writeHead(400); return res.end('Bad request'); }
        const asset = assets.get(pathname);
        if (!asset) { res.writeHead(404); return res.end('Not found'); }
        fs.readFile(path.join(root, asset[0]), (error, body) => {
            if (error) { res.writeHead(404); return res.end('File not found'); }
            res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': body.length });
            res.end(req.method === 'HEAD' ? undefined : body);
        });
    });
}

if (require.main === module) {
    const server = createServer();
    server.on('error', error => {
        console.error(error.code === 'EADDRINUSE'
            ? 'El puerto 4173 ya está ocupado. Cierra el otro servidor local y vuelve a intentar.'
            : 'No se pudo iniciar el servidor local: ' + error.code);
        process.exitCode = 1;
    });
    server.listen(4173, '127.0.0.1', () => {
        console.log('Abre http://127.0.0.1:4173/direct-player.html');
        console.log('Pulsa Ctrl+C para detener. Este servidor solo entrega archivos locales; no retransmite video.');
    });
}

module.exports = { createServer };
