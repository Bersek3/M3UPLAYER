// api/auth/register.js — POST /api/auth/register
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { connectDB } = require('../_lib/db');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
    // Handle preflight
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
        const identifier = ((username || (email ? email.split('@')[0] : '')) + '').trim().toLowerCase();
        const cleanEmail = email ? String(email).trim().toLowerCase() : '';

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Usuario/correo y contraseña requeridos' });
        }
        if (identifier.length < 3) {
            return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
        }

        const db = await connectDB();
        const usersCol = db.collection('users');

        const queryOr = [{ username: identifier }];
        if (cleanEmail) queryOr.push({ email: cleanEmail });

        const existing = await usersCol.findOne({ $or: queryOr });
        if (existing) {
            return res.status(400).json({ error: 'El usuario o correo ya está registrado' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(String(password), salt);
        const token = crypto.randomBytes(32).toString('hex');

        const result = await usersCol.insertOne({
            username: identifier,
            email: cleanEmail,
            passwordHash,
            token,
            createdAt: new Date()
        });

        return res.status(200).json({
            success: true,
            message: 'Usuario registrado con éxito',
            token,
            username: identifier
        });
    } catch (err) {
        console.error('Register error:', err);
        return res.status(500).json({ error: 'Error al registrar: ' + err.message });
    }
};
