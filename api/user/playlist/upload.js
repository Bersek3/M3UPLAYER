const { prepareImport } = require('../../_lib/playlist-import');
// api/user/playlist/upload.js — POST /api/user/playlist/upload (multipart/form-data)
const { connectDB } = require('../../_lib/db');
const { authenticate } = require('../../_lib/auth');
const { parseM3UContent } = require('../../_lib/m3u');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Vercel doesn't support multer directly — parse multipart manually using built-in body
// We use the raw body approach: Vercel exposes req.body as Buffer when content-type is multipart
// but the simplest approach for .m3u files is to have the client send the text as JSON instead
// The frontend should base64 encode or send the file contents as text in JSON body
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
        // Accept { content: '<m3u text>', name: 'playlist name' }
        const { content, name, filename } = req.body || {};

        if (!content) {
            return res.status(400).json({ error: 'No se recibió contenido del archivo M3U' });
        }

        const playlistName = name || filename || 'Lista Subida';
        let parsedChannels = parseM3UContent(content, '', playlistName);

        if (parsedChannels.length === 0) {
            return res.status(400).json({ error: 'El archivo no contiene canales válidos en formato M3U' });
        }

        const db = await connectDB();
        return res.status(200).json(await prepareImport(db, auth.user, {
            name: playlistName, type: 'file', fileName: filename || 'archivo.m3u', channels: parsedChannels
        }));
    } catch (err) {
        console.error('Upload error:', err);
        return res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
    }
};
