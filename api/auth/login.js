// api/auth/login.js — POST /api/auth/login
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { connectDB } = require('../_lib/db');

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

    try {
        const { username, email, password } = req.body || {};
        const identifier = String(email || username || '').trim().toLowerCase();

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Correo o usuario y contraseña requeridos' });
        }

        const db = await connectDB();
        const usersCol = db.collection('users');

        const user = await usersCol.findOne({
            $or: [{ username: identifier }, { email: identifier }]
        });

        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Usuario/correo o contraseña incorrectos' });
        }

        const isValid = await bcrypt.compare(String(password), user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Usuario/correo o contraseña incorrectos' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        await usersCol.updateOne({ _id: user._id }, { $set: { token, lastLogin: new Date() } });

        return res.status(200).json({
            success: true,
            message: 'Inicio de sesión correcto',
            token,
            username: user.username
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Error al iniciar sesión: ' + err.message });
    }
};
