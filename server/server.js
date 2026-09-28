const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://franciscojmaguilar11_db_user:8KHcxKKvUMbHeVk2@cluster0.rpmhjcl.mongodb.net/m3u_tv_database?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'm3u_tv_database';

let client = null;
let db = null;
let usersCol = null;
let playlistsCol = null;
let isConnecting = false;

// Connect to MongoDB Atlas with auto-retry, timeout protection and IPv4 forced
async function connectDB() {
    if (db && usersCol && playlistsCol) return true;
    if (isConnecting) return false;
    isConnecting = true;
    try {
        console.log('Connecting to MongoDB Atlas...');
        client = new MongoClient(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
            family: 4
        });
        await client.connect();
        db = client.db(DB_NAME);
        usersCol = db.collection('users');
        playlistsCol = db.collection('playlists');
        console.log('Connected successfully to MongoDB Atlas (Database: ' + DB_NAME + ')');
        isConnecting = false;
        return true;
    } catch (err) {
        isConnecting = false;
        console.error('MongoDB Atlas Connection Error:', err.message);
        if (err.message && (err.message.includes('alert number 80') || err.message.includes('tlsv1 alert internal error'))) {
            console.error('⚠️ ATENCIÓN: Este error (SSL alert number 80) significa que MongoDB Atlas bloqueó la IP de Render. Debes agregar 0.0.0.0/0 en MongoDB Atlas -> Network Access.');
        }
        return false;
    }
}
connectDB();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware to ensure DB connection before handling API routes
app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        if (!usersCol || !playlistsCol) {
            const connected = await connectDB();
            if (!connected && !usersCol) {
                return res.status(503).json({
                    error: 'La base de datos aún no está conectada. Si estás en Render, asegúrate de habilitar 0.0.0.0/0 en Network Access de MongoDB Atlas.'
                });
            }
        }
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
// Also serve TV web app under /tv for testing or web client access
app.use('/tv', express.static(path.join(__dirname, '..', 'M3UPLAYER')));

// Multer in-memory storage for file uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB limit

// Active user sessions (in-memory fast lookup + db persistence)
const activeTokens = new Map(); // token -> { userId, username }

// Helper to derive a clean channel name from a stream URL
function extractChannelNameFromUrl(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
            let last = parts[parts.length - 1];
            last = last.replace(/\.(m3u8|m3u|ts|mp4|mkv)$/i, '');
            last = decodeURIComponent(last).replace(/[-_]/g, ' ').trim();
            if (last && last.toLowerCase() !== 'master' && last.toLowerCase() !== 'index' && last.toLowerCase() !== 'playlist' && last.toLowerCase() !== 'live') {
                return last.charAt(0).toUpperCase() + last.slice(1);
            }
            if (parts.length > 1) {
                let prev = parts[parts.length - 2];
                prev = decodeURIComponent(prev).replace(/[-_]/g, ' ').trim();
                if (prev) return prev.charAt(0).toUpperCase() + prev.slice(1);
            }
        }
    } catch (e) {}
    return 'Canal En Vivo';
}

// Enhanced M3U / M3U8 Parser Helper
function parseM3UContent(rawText, sourceUrl = '', defaultName = '') {
    if (!rawText || typeof rawText !== 'string') return [];
    
    // Strip UTF-8 BOM and normalize newlines
    let text = rawText.replace(/^\uFEFF/, '').trim();
    if (!text) return [];

    // Case 1: Direct single HLS Stream link (.m3u8 master playlist or media playlist)
    const isDirectHlsStream = (
        sourceUrl && (sourceUrl.toLowerCase().includes('.m3u8') || sourceUrl.toLowerCase().includes('.ts')) &&
        (text.includes('#EXT-X-STREAM-INF') || text.includes('#EXT-X-TARGETDURATION') || text.includes('#EXT-X-MEDIA-SEQUENCE')) &&
        !text.includes('group-title=') && !text.includes('tvg-name=')
    );

    if (isDirectHlsStream) {
        const channelName = defaultName || extractChannelNameFromUrl(sourceUrl) || 'Canal M3U8 En Vivo';
        return [{
            number: '001',
            name: channelName,
            logo: '',
            group: 'En Vivo',
            url: sourceUrl
        }];
    }

    const lines = text.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;
    let counter = 1;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannel = {};
            currentChannel.number = String(counter).padStart(3, '0');
            counter++;

            // Extract tvg-logo
            const logoMatch = line.match(/tvg-logo=["']([^"']+)["']/i);
            currentChannel.logo = logoMatch ? logoMatch[1].trim() : '';

            // Extract group-title
            const groupMatch = line.match(/group-title=["']([^"']+)["']/i);
            currentChannel.group = groupMatch ? groupMatch[1].trim() : 'General';

            // Extract channel name
            const commaIndex = line.lastIndexOf(',');
            if (commaIndex !== -1 && commaIndex < line.length - 1) {
                currentChannel.name = line.substring(commaIndex + 1).trim();
            } else {
                const nameMatch = line.match(/tvg-name=["']([^"']+)["']/i);
                currentChannel.name = nameMatch ? nameMatch[1].trim() : `Canal ${currentChannel.number}`;
            }

            // Cleanup surrounding quotes if present
            currentChannel.name = currentChannel.name.replace(/^["']|["']$/g, '');

        } else if (line.startsWith('#EXTGRP:')) {
            // Group tag alternative
            if (currentChannel && (!currentChannel.group || currentChannel.group === 'General')) {
                currentChannel.group = line.substring(8).trim() || 'General';
            }
        } else if (!line.startsWith('#')) {
            // Stream URL
            if (currentChannel) {
                let streamUrl = line;
                // Resolve relative URLs if base URL is provided
                if (sourceUrl && !streamUrl.startsWith('http://') && !streamUrl.startsWith('https://') && !streamUrl.startsWith('rtmp://')) {
                    try {
                        streamUrl = new URL(streamUrl, sourceUrl).href;
                    } catch (e) {}
                }
                currentChannel.url = streamUrl;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }
    }

    // Case 2: If no #EXTINF was found, check if lines are direct URLs (plain playlist)
    if (channels.length === 0) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('http://') || line.startsWith('https://')) {
                const name = extractChannelNameFromUrl(line);
                channels.push({
                    number: String(counter).padStart(3, '0'),
                    name: name,
                    logo: '',
                    group: 'General',
                    url: line
                });
                counter++;
            }
        }
    }

    // Case 3: If still 0 channels, but sourceUrl is an active m3u8 link, treat sourceUrl as the channel!
    if (channels.length === 0 && sourceUrl && (sourceUrl.includes('.m3u8') || sourceUrl.startsWith('http'))) {
        channels.push({
            number: '001',
            name: defaultName || extractChannelNameFromUrl(sourceUrl) || 'Canal M3U8',
            logo: '',
            group: 'En Vivo',
            url: sourceUrl
        });
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
        const { username, email, password } = req.body || {};
        const identifier = (username || (email ? email.split('@')[0] : '')).trim().toLowerCase();
        const cleanEmail = email ? String(email).trim().toLowerCase() : (identifier.includes('@') ? identifier : '');

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Usuario/correo y contraseña requeridos' });
        }

        if (identifier.length < 3) {
            return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres' });
        }

        const queryOr = [{ username: identifier }];
        if (cleanEmail) queryOr.push({ email: cleanEmail });

        const existing = await usersCol.findOne({ $or: queryOr });
        if (existing) {
            return res.status(400).json({ error: 'El usuario o correo electrónico ya está registrado' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(String(password), salt);
        const token = crypto.randomBytes(32).toString('hex');

        const newUser = {
            username: identifier,
            email: cleanEmail,
            passwordHash: passwordHash,
            token: token,
            createdAt: new Date()
        };

        const result = await usersCol.insertOne(newUser);
        activeTokens.set(token, { userId: result.insertedId.toString(), username: identifier });

        res.json({
            success: true,
            message: 'Usuario registrado con éxito',
            token: token,
            username: identifier
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Error al registrar usuario: ' + (err.message || 'Error del servidor') });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, email, password } = req.body || {};
        const identifier = String(email || username || '').trim().toLowerCase();
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Correo o usuario y contraseña requeridos' });
        }

        const user = await usersCol.findOne({
            $or: [
                { username: identifier },
                { email: identifier }
            ]
        });

        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Usuario/correo o contraseña incorrectos' });
        }

        const isValid = await bcrypt.compare(String(password), user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Usuario/correo o contraseña incorrectos' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        await usersCol.updateOne({ _id: user._id }, { $set: { token: token, lastLogin: new Date() } });

        activeTokens.set(token, { userId: user._id.toString(), username: user.username });

        res.json({
            success: true,
            message: 'Inicio de sesión correcto',
            token: token,
            username: user.username
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Error al iniciar sesión: ' + (err.message || 'Error del servidor') });
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
        const playlistName = name || 'Lista Web ' + (new Date().toLocaleDateString());
        const parsedChannels = parseM3UContent(text, url, playlistName);

        if (parsedChannels.length === 0) {
            return res.status(400).json({ error: 'La URL proporcionada no contiene canales válidos en formato M3U o M3U8' });
        }

        const playlistDoc = {
            userId: req.user.userId,
            username: req.user.username,
            name: playlistName,
            type: 'url',
            sourceUrl: url,
            channelCount: parsedChannels.length,
            channels: parsedChannels,
            updatedAt: new Date()
        };

        const result = await playlistsCol.insertOne(playlistDoc);

        res.json({
            success: true,
            message: `¡Lista guardada con éxito! Se cargaron ${parsedChannels.length} canal(es).`,
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
        const playlistName = req.body.name || req.file.originalname || 'Lista Subida';
        const parsedChannels = parseM3UContent(rawText, '', playlistName);

        if (parsedChannels.length === 0) {
            return res.status(400).json({ error: 'El archivo subido no contiene canales válidos en formato M3U o M3U8' });
        }

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

// ==========================================================================
// M3U PROXY (allows Samsung TV to load playlists blocked by CORS)
// GET /api/proxy/m3u?url=https://...
// ==========================================================================
app.get('/api/proxy/m3u', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).json({ error: 'Se requiere un parametro url valido (http/https)' });
    }

    try {
        const proxyRes = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) SamsungBrowser/2.1 Chrome/56.0.2924.0 TV Safari/538.1',
                'Accept': '*/*',
                'Accept-Language': 'es,en;q=0.8',
                'Referer': targetUrl
            },
            redirect: 'follow'
        });

        if (!proxyRes.ok) {
            return res.status(proxyRes.status).send('Error del servidor origen: ' + proxyRes.status);
        }

        const contentType = proxyRes.headers.get('content-type') || 'application/x-mpegurl';
        const body = await proxyRes.text();

        res.setHeader('Content-Type', contentType.includes('html') ? 'application/x-mpegurl' : contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(body);

    } catch (err) {
        console.error('Proxy M3U error:', err.message);
        res.status(502).send('Error al obtener la lista: ' + err.message);
    }
});

// Public channels endpoint (allows TV to load channels without login)
app.get('/api/channels/public', async (req, res) => {
    try {
        if (playlistsCol) {
            const playlist = await playlistsCol.findOne({}, { sort: { updatedAt: -1 } });
            if (playlist && Array.isArray(playlist.channels) && playlist.channels.length > 0) {
                return res.json({
                    success: true,
                    name: playlist.name,
                    channels: playlist.channels,
                    channelCount: playlist.channels.length
                });
            }
        }

        const localM3U = path.join(__dirname, 'public', 'playlists', 'canales_chile.m3u');
        if (fs.existsSync(localM3U)) {
            const text = fs.readFileSync(localM3U, 'utf8');
            const channels = parseM3UContent(text, '', 'Canales Chile');
            return res.json({ success: true, name: 'Canales Chile', channels, channelCount: channels.length });
        }

        res.json({ success: false, channels: [] });
    } catch (err) {
        console.error('Public channels error:', err);
        res.status(500).json({ error: 'Error al obtener canales públicos' });
    }
});

// Raw default M3U playlist with open CORS
app.get('/api/playlist/default.m3u', (req, res) => {
    const localM3U = path.join(__dirname, 'public', 'playlists', 'canales_chile.m3u');
    if (fs.existsSync(localM3U)) {
        res.setHeader('Content-Type', 'application/x-mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.sendFile(localM3U);
    }
    res.status(404).send('#EXTM3U\n');
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
