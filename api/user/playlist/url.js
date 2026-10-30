const { prepareImport } = require('../../_lib/playlist-import');
// api/user/playlist/url.js — POST /api/user/playlist/url
const { connectDB } = require('../../_lib/db');
const { authenticate } = require('../../_lib/auth');
const { parseM3UContent } = require('../../_lib/m3u');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
    }

    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await authenticate(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    try {
        const { url, name } = req.body || {};
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Ingresa una URL válida (http o https)' });
        }

        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Mozilla/5.0 (SmartTV; Tizen)' }
        });
        if (!response.ok) {
            return res.status(400).json({ error: `No se pudo descargar la lista. Código ${response.status}` });
        }

        const text = await response.text();
        const playlistName = name || 'Lista Web ' + new Date().toLocaleDateString();
        let parsedChannels = parseM3UContent(text, url, playlistName);

        if (parsedChannels.length === 0) {
            return res.status(400).json({ error: 'La URL no contiene canales válidos en formato M3U' });
        }

        const db = await connectDB();
        return res.status(200).json(await prepareImport(db, auth.user, {
            name: playlistName, type: 'url', sourceUrl: url, channels: parsedChannels
        }));
    } catch (err) {
        console.error('Add URL error:', err);
        return res.status(500).json({ error: 'Error al procesar la lista: ' + err.message });
    }
};
