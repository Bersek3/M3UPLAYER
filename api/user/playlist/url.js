const { checkStreams } = require('../../_lib/check-streams');
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

        const checked = await checkStreams(parsedChannels);
        if (!checked.channels.length) {
            return res.status(422).json({ error: `No se pudo verificar ningún canal de los ${parsedChannels.length}. Pueden estar caídos, bloqueados o tardar demasiado en responder.`, verification: checked.verification });
        }
        parsedChannels = checked.channels;

        const db = await connectDB();
        const result = await db.collection('playlists').insertOne({
            userId: auth.user.userId,
            username: auth.user.username,
            name: playlistName,
            type: 'url',
            sourceUrl: url,
            channelCount: parsedChannels.length,
            channels: parsedChannels,
            excludedChannels: checked.excludedChannels,
            verification: checked.verification,
            updatedAt: new Date()
        });

        return res.status(200).json({
            success: true,
            message: `Lista guardada con ${parsedChannels.length} canal(es).`,
            playlistId: result.insertedId,
            verification: checked.verification,
            channelsCount: parsedChannels.length
        });
    } catch (err) {
        console.error('Add URL error:', err);
        return res.status(500).json({ error: 'Error al procesar la lista: ' + err.message });
    }
};
