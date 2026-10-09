// api/status.js — GET /api/status (health check)
const { connectDB } = require('./_lib/db');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
    }
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    try {
        await connectDB();
        return res.status(200).json({ status: 'online', database: 'connected', serverTime: new Date() });
    } catch (err) {
        return res.status(503).json({ status: 'degraded', database: 'error', error: err.message });
    }
};
