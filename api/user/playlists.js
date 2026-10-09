// api/user/playlists.js — GET /api/user/playlists
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
            .find({ userId: auth.user.userId }, { projection: { channels: 0 } })
            .toArray();

        // Normalize _id to id string for frontend compatibility
        const formatted = playlists.map(p => ({
            id: p._id.toString(),
            name: p.name,
            type: p.type,
            channelCount: p.channelCount || 0,
            updatedAt: p.updatedAt
        }));

        return res.status(200).json({ success: true, playlists: formatted });
    } catch (err) {
        console.error('Playlists error:', err);
        return res.status(500).json({ error: 'Error al obtener listas: ' + err.message });
    }
};
