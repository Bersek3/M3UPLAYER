const { connectDB } = require('../../_lib/db');
const { authenticate } = require('../../_lib/auth');
const { confirmImport } = require('../../_lib/playlist-import');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const auth = await authenticate(req);
        if (auth.error) return res.status(auth.status).json({ error: auth.error });
        return res.json(await confirmImport(await connectDB(), auth.user, req.body));
    } catch (error) {
        return res.status(422).json({ error: error.message });
    }
};
