// api/user/playlist/[id].js — DELETE /api/user/playlist/:id
const { ObjectId } = require('mongodb');
const { connectDB } = require('../../_lib/db');
const { authenticate } = require('../../_lib/auth');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
    }

    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await authenticate(req);
    if (auth.error) return res.status(auth.status).json({ error: auth.error });

    try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'ID de lista requerido' });

        const db = await connectDB();
        const result = await db.collection('playlists').deleteOne({
            _id: new ObjectId(id),
            userId: auth.user.userId
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Lista no encontrada o no tienes permiso para eliminarla' });
        }

        return res.status(200).json({ success: true, message: 'Lista eliminada correctamente' });
    } catch (err) {
        console.error('Delete playlist error:', err);
        return res.status(500).json({ error: 'Error al eliminar la lista: ' + err.message });
    }
};
