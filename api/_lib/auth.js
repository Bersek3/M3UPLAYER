// api/_lib/auth.js — Shared auth middleware for Vercel serverless
const { connectDB } = require('./db');

async function authenticate(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = req.query?.token
        || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null)
        || req.body?.token
        || null;

    if (!token) return { error: 'Token de autenticación no proporcionado', status: 401 };

    const db = await connectDB();
    const user = await db.collection('users').findOne({ token });
    if (!user) return { error: 'Sesión inválida o expirada', status: 401 };

    return { user: { userId: user._id.toString(), username: user.username } };
}

module.exports = { authenticate };
