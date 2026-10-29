const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function publicAddress(address) {
    if (net.isIP(address) === 6) {
        // Only global unicast; exclude mapped IPv4 and local/reserved addresses.
        return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0*0|0*2|0*10|0*20):/i.test(address);
    }
    if (net.isIP(address) !== 4) return false;
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) ||
        (a === 203 && b === 0));
}

async function upstream(target, range, redirects = 0) {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (url.port && !['80', '443'].includes(url.port))) throw new Error('URL no permitida');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(hostname)
        ? [{ address: hostname, family: net.isIP(hostname) }]
        : await dns.lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(entry => !publicAddress(entry.address))) throw new Error('Destino no permitido');
    const chosen = addresses[0];
    return new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https : http).get(url, {
            // Pin the validated address; redirects are validated independently.
            lookup: (_name, _options, callback) => callback(null, chosen.address, chosen.family),
            family: chosen.family,
            autoSelectFamily: false,
            headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'M3UPlayer/1.0', ...(range ? { Range: range } : {}) }
        }, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                if (redirects >= 4 || !response.headers.location) return reject(new Error('Demasiadas redirecciones'));
                resolve(upstream(new URL(response.headers.location, url).href, range, redirects + 1));
                return;
            }
            if (![200, 206].includes(response.statusCode)) {
                response.resume();
                return reject(new Error(`El origen respondió HTTP ${response.statusCode}`));
            }
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                // Stay below Vercel's response limit, including manifest rewriting.
                if (size > 4 * 1024 * 1024) response.destroy(new Error('Fragmento demasiado grande para el proxy'));
                else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => resolve({ body: Buffer.concat(chunks), headers: response.headers, status: response.statusCode, url: url.href }));
        });
        request.setTimeout(12000, () => request.destroy(new Error('Tiempo de espera agotado')));
        const deadline = setTimeout(() => request.destroy(new Error('Tiempo de espera agotado')), 18000);
        request.on('close', () => clearTimeout(deadline));
        request.on('error', reject);
    });
}

function rewriteManifest(text, base) {
    const proxy = value => {
        const url = new URL(value, base);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocolo HLS no compatible');
        return '/api/proxy/hls?url=' + encodeURIComponent(url.href);
    };
    return text.split(/\r?\n/).map(line => {
        if (!line.trim()) return line;
        if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${proxy(value)}"`);
        return proxy(line.trim());
    }).join('\n');
}

async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (typeof req.query.url !== 'string') return res.status(400).json({ error: 'Falta la URL del video' });
    try {
        const result = await upstream(req.query.url, /^bytes=\d*-\d*$/.test(req.headers.range || '') ? req.headers.range : null);
        const text = result.body.toString('utf8');
        if (text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.status(200).send(rewriteManifest(text, result.url));
        }
        const type = result.headers['content-type'] || '';
        if (!/^(video\/|audio\/|application\/(octet-stream|mp4)|text\/vtt)/i.test(type)) {
            return res.status(502).json({ error: 'El origen no devolvió un video compatible' });
        }
        res.setHeader('Content-Type', type);
        for (const name of ['content-range', 'accept-ranges']) {
            if (result.headers[name]) res.setHeader(name, result.headers[name]);
        }
        return res.status(result.status).send(result.body);
    } catch (error) {
        return res.status(502).json({ error: error.message });
    }
}

module.exports = { handler, rewriteManifest, publicAddress };
