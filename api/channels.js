// api/channels.js — GET /api/channels (public, no auth needed)
const { connectDB } = require('./_lib/db');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
    }

    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

    try {
        const db = await connectDB();
        const playlists = await db.collection('playlists')
            .find()
            .sort({ updatedAt: -1 })
            .toArray();

        let allChannels = [];
        let counter = 1;
        const seenNames = new Set();

        playlists.forEach(pl => {
            if (Array.isArray(pl.channels)) {
                pl.channels.forEach(ch => {
                    const key = (ch.name || '').trim().toLowerCase();
                    if (!seenNames.has(key)) {
                        seenNames.add(key);
                        allChannels.push({
                            ...ch,
                            number: String(counter).padStart(3, '0'),
                            playlistName: pl.name
                        });
                        counter++;
                    }
                });
            }
        });

        return res.status(200).json({
            success: true,
            channels: allChannels,
            channelCount: allChannels.length
        });
    } catch (err) {
        console.error('Public channels error:', err);
        return res.status(500).json({ error: 'Error al obtener canales: ' + err.message });
    }
};
