const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://franciscojmaguilar11_db_user:8KHcxKKvUMbHeVk2@cluster0.rpmhjcl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'm3u_tv_database';

let db = null;
let usersCol = null;
let playlistsCol = null;

// Connect to MongoDB Atlas
async function connectDB() {
    try {
        console.log('Connecting to MongoDB Atlas...');
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);
        usersCol = db.collection('users');
        playlistsCol = db.collection('playlists');
        console.log('Connected successfully to MongoDB Atlas (Database: ' + DB_NAME + ')');
    } catch (err) {
        console.error('MongoDB Atlas Connection Error:', err);
    }
}
connectDB();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Also serve TV web app under /tv for testing or web client access
app.use('/tv', express.static(path.join(__dirname, '..', 'M3UPLAYER')));

// Multer in-memory storage for file uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB limit

// Active user sessions (in-memory fast lookup + db persistence)
const activeTokens = new Map(); // token -> { userId, username }

// M3U Parser Helper
function parseM3UContent(rawText) {
    const lines = rawText.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;
    let counter = 1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannel = {};
            currentChannel.number = String(counter).padStart(3, '0');
            counter++;

            // Extract tvg-logo
            const logoMatch = line.match(/tvg-logo=["']([^"']+)["']/i);
            currentChannel.logo = logoMatch ? logoMatch[1] : '';

            // Extract group-title
            const groupMatch = line.match(/group-title=["']([^"']+)["']/i);
            currentChannel.group = groupMatch ? groupMatch[1].trim() : 'General';

            // Extract channel name
            const commaIndex = line.lastIndexOf(',');
            if (commaIndex !== -1 && commaIndex < line.length - 1) {
                currentChannel.name = line.substring(commaIndex + 1).trim();
            } else {
                const nameMatch = line.match(/tvg-name=["']([^"']+)["']/i);
                currentChannel.name = nameMatch ? nameMatch[1] : `Canal ${currentChannel.number}`;
            }

        } else if (!line.startsWith('#')) {
            if (currentChannel) {
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }
    }
    return channels;
}

// Authentication Middleware
async function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = req.query.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);

    if (!token && req.body && req.body.token) {
        token = req.body.token;
    }

    if (!token) {
        return res.status(401).json({ error: 'Token de autenticación no proporcionado' });
    }

    if (activeTokens.has(token)) {
        req.user = activeTokens.get(token);
        return next();
    }

    try {
        const user = await usersCol.findOne({ token: token });
        if (!user) {
            return res.status(401).json({ error: 'Sesión inválida o expirada' });
        }
        const sessionData = { userId: user._id.toString(), username: user.username };
        activeTokens.set(token, sessionData);
        req.user = sessionData;
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Error verificando sesión' });
    }
}

// ==========================================================================
// AUTHENTICATION ROUTES
// ==========================================================================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }

        const cleanUsername = username.trim().toLowerCase();
        if (cleanUsername.length < 3) {
            return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
        }

        const existing = await usersCol.findOne({ username: cleanUsername });
        if (existing) {
            return res.status(400).json({ error: 'El nombre de usuario ya está registrado' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const token = crypto.randomBytes(32).toString('hex');

        const newUser = {
            username: cleanUsername,
            passwordHash: passwordHash,
            token: token,
            createdAt: new Date()
        };

        const result = await usersCol.insertOne(newUser);
        activeTokens.set(token, { userId: result.insertedId.toString(), username: cleanUsername });

        res.json({
            success: true,
            message: 'Usuario registrado con éxito',
            token: token,
            username: cleanUsername
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Error en el servidor al registrar usuario' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
        }

        const cleanUsername = username.trim().toLowerCase();
        const user = await usersCol.findOne({ username: cleanUsername });
        if (!user) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        await usersCol.updateOne({ _id: user._id }, { $set: { token: token, lastLogin: new Date() } });

        activeTokens.set(token, { userId: user._id.toString(), username: cleanUsername });

        res.json({
            success: true,
            message: 'Inicio de sesión correcto',
            token: token,
            username: cleanUsername
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Error en el servidor al iniciar sesión' });
    }
});

// ==========================================================================
// TV QR CODE & MOBILE PAIRING ROUTES
// ==========================================================================
const pairSessions = new Map(); // pairCode -> { status: 'pending'|'approved', token, username, expiresAt }

function generatePairCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Auto clean expired pair sessions every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, s] of pairSessions.entries()) {
        if (now > s.expiresAt) pairSessions.delete(code);
    }
}, 120000);

// TV requests a new pairing code
app.post('/api/auth/pair/request', (req, res) => {
    try {
        const code = generatePairCode();
        const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
        pairSessions.set(code, {
            status: 'pending',
            token: null,
            username: null,
            expiresAt: expiresAt
        });

        res.json({
            success: true,
            pairCode: code,
            expiresIn: 600
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al generar código de vinculación' });
    }
});

// TV polls pairing status
app.get('/api/auth/pair/status', (req, res) => {
    const code = (req.query.code || '').trim().toUpperCase();
    if (!code || !pairSessions.has(code)) {
        return res.json({ success: false, status: 'expired' });
    }

    const session = pairSessions.get(code);
    if (Date.now() > session.expiresAt) {
        pairSessions.delete(code);
        return res.json({ success: false, status: 'expired' });
    }

    if (session.status === 'approved') {
        // Return token and username to TV
        return res.json({
            success: true,
            status: 'approved',
            token: session.token,
            username: session.username
        });
    }

    res.json({ success: true, status: 'pending' });
});

// Mobile phone approves pairing with active token
app.post('/api/auth/pair/approve', authenticate, async (req, res) => {
    try {
        const code = (req.body.code || req.body.pairCode || '').trim().toUpperCase();
        if (!code || !pairSessions.has(code)) {
            return res.status(400).json({ error: 'Código de vinculación inválido o expirado' });
        }

        const session = pairSessions.get(code);
        if (Date.now() > session.expiresAt) {
            pairSessions.delete(code);
            return res.status(400).json({ error: 'El código en la TV ha expirado. Genera uno nuevo.' });
        }

        // Get user token from header
        const authHeader = req.headers['authorization'];
        const userToken = req.body.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);

        session.status = 'approved';
        session.token = userToken;
        session.username = req.user.username;

        console.log(`Smart TV successfully paired with user: ${req.user.username} (Code: ${code})`);

        res.json({
            success: true,
            message: '¡Televisor vinculado con éxito! Tu Smart TV iniciará sesión de inmediato.',
            username: req.user.username
        });
    } catch (err) {
        console.error('Approve pairing error:', err);
        res.status(500).json({ error: 'Error al autorizar la vinculación' });
    }
});

// ==========================================================================
// PLAYLIST & CHANNELS ROUTES
// ==========================================================================

// Get user's combined channels (used by Samsung TV and Web Portal)
app.get('/api/user/channels', authenticate, async (req, res) => {
    try {
        const playlists = await playlistsCol.find({ userId: req.user.userId }).toArray();
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

        // Extract categories
        const categoriesSet = new Set();
        allChannels.forEach(ch => {
            if (ch.group) categoriesSet.add(ch.group);
        });

        res.json({
            success: true,
            username: req.user.username,
            channels: allChannels,
            channelCount: allChannels.length,
            playlistCount: playlists.length,
            categories: ['ALL', ...Array.from(categoriesSet)]
        });
    } catch (err) {
        console.error('Fetch channels error:', err);
        res.status(500).json({ error: 'Error al obtener los canales del usuario' });
    }
});

// Get user's playlists summary
app.get('/api/user/playlists', authenticate, async (req, res) => {
    try {
        const playlists = await playlistsCol.find(
            { userId: req.user.userId },
            { projection: { channels: 0 } } // Exclude full channels array for light summary
        ).toArray();

        res.json({ success: true, playlists });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener listas' });
    }
});

// Add Remote M3U URL
app.post('/api/user/playlist/url', authenticate, async (req, res) => {
    try {
        const { url, name } = req.body;
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Ingresa una URL válida de tipo http o https' });
        }

        console.log(`Downloading remote M3U for user ${req.user.username}: ${url}`);
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SmartTV; Tizen)' } });
        if (!response.ok) {
            return res.status(400).json({ error: `No se pudo descargar la lista. Servidor respondió con código ${response.status}` });
        }

        const text = await response.text();
        const parsedChannels = parseM3UContent(text);

        if (parsedChannels.length === 0) {
            return res.status(400).json({ error: 'La URL proporcionada no contiene canales válidos en formato M3U' });
        }

        const playlistDoc = {
            userId: req.user.userId,
            username: req.user.username,
            name: name || 'Lista Web ' + (new Date().toLocaleDateString()),
            type: 'url',
            sourceUrl: url,
            channelCount: parsedChannels.length,
            channels: parsedChannels,
            updatedAt: new Date()
        };

        const result = await playlistsCol.insertOne(playlistDoc);

        res.json({
            success: true,
            message: `¡Lista guardada con éxito! Se cargaron ${parsedChannels.length} canales.`,
            playlistId: result.insertedId,
            channelCount: parsedChannels.length
        });
    } catch (err) {
        console.error('Add M3U URL error:', err);
        res.status(500).json({ error: 'Error al descargar o procesar la lista M3U: ' + err.message });
    }
});

// Upload Local M3U File
app.post('/api/user/playlist/upload', authenticate, upload.single('m3uFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha seleccionado ningún archivo' });
        }

        const rawText = req.file.buffer.toString('utf-8');
        const parsedChannels = parseM3UContent(rawText);

        if (parsedChannels.length === 0) {
            return res.status(400).json({ error: 'El archivo subido no contiene canales válidos en formato M3U' });
        }

        const playlistName = req.body.name || req.file.originalname || 'Lista Subida';

        const playlistDoc = {
            userId: req.user.userId,
            username: req.user.username,
            name: playlistName,
            type: 'file',
            fileName: req.file.originalname,
            channelCount: parsedChannels.length,
            channels: parsedChannels,
            updatedAt: new Date()
        };

        const result = await playlistsCol.insertOne(playlistDoc);

        res.json({
            success: true,
            message: `¡Archivo procesado con éxito! Se importaron ${parsedChannels.length} canales.`,
            playlistId: result.insertedId,
            channelCount: parsedChannels.length
        });
    } catch (err) {
        console.error('Upload M3U error:', err);
        res.status(500).json({ error: 'Error al procesar el archivo subido: ' + err.message });
    }
});

// Delete Playlist
app.delete('/api/user/playlist/:id', authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await playlistsCol.deleteOne({ _id: new ObjectId(id), userId: req.user.userId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'Lista no encontrada' });
        }
        res.json({ success: true, message: 'Lista eliminada correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar la lista' });
    }
});

// Health check
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        database: db ? 'connected' : 'connecting',
        serverTime: new Date()
    });
});

// Fallback to Web Portal
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 M3U Server & Web Portal running on:`);
    console.log(`👉 Local:   http://localhost:${PORT}`);
    console.log(`👉 Network: http://192.168.1.108:${PORT}`);
    console.log(`====================================================`);
});
