// api/user/channels.js — GET /api/user/channels
const { connectDB } = require('../_lib/db');
const { authenticate } = require('../_lib/auth');

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

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await authenticate(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    try {
        const db = await connectDB();
        const playlists = await db.collection('playlists')
            .find({ userId: auth.user.userId })
            .toArray();

        let allChannels = [];
        let counter = 1;

        playlists.forEach(pl => {
            if (Array.isArray(pl.channels)) {
                pl.channels.forEach(ch => {
                    allChannels.push({
                        ...ch,
                        number: String(counter).padStart(3, '0'),
                        playlistName: pl.name
                    });
                    counter++;
                });
            }
        });

        const categoriesSet = new Set();
        allChannels.forEach(ch => { if (ch.group) categoriesSet.add(ch.group); });

        return res.status(200).json({
            success: true,
            channels: allChannels,
            channelCount: allChannels.length,
            categories: ['ALL', ...categoriesSet]
        });
    } catch (err) {
        console.error('Channels error:', err);
        return res.status(500).json({ error: 'Error al obtener los canales: ' + err.message });
    }
};
