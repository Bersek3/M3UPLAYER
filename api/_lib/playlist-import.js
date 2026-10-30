const { ObjectId } = require('mongodb');
const { playbackSource } = require('./playback-source');

// Candidates are temporary analysis data, never part of the user's channel catalog.
async function prepareImport(db, user, document) {
    const now = new Date();
    await db.collection('playlistImports').deleteMany({ expiresAt: { $lte: now } });
    const result = await db.collection('playlistImports').insertOne({
        ...document, userId: user.userId, username: user.username,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
    });
    return { success: true, requiresPlaybackCheck: true, importId: result.insertedId,
        channels: document.channels.map((ch, index) => ({ ...playbackSource(ch), candidateId: index })) };
}

async function confirmImport(db, user, body) {
    if (!ObjectId.isValid(body?.importId) || !Array.isArray(body?.results)) {
        throw new Error('Análisis de reproducción inválido');
    }
    const id = new ObjectId(body.importId);
    const existing = await db.collection('playlists').findOne({ _id: id, userId: user.userId });
    if (existing) return { success: true, playlistId: id, channelsCount: existing.channelCount, verification: existing.verification };
    const staged = await db.collection('playlistImports').findOne({ _id: id, userId: user.userId, expiresAt: { $gt: new Date() } });
    if (!staged) throw new Error('El análisis venció. Vuelve a cargar la lista.');
    const results = new Map(body.results.filter(result => Number.isInteger(result.candidateId))
        .map(result => [result.candidateId, result]));
    const channels = [];
    const excludedChannels = [];
    staged.channels.forEach((channel, index) => {
        const result = results.get(index);
        if (result?.playable === true && ['direct', 'proxy'].includes(result.playbackMode)) {
            channels.push({ ...channel, number: String(channels.length + 1).padStart(3, '0'),
                playbackMode: result.playbackMode, availability: 'online', browserVerifiedAt: new Date() });
        } else {
            channels.push({ ...channel, number: String(channels.length + 1).padStart(3, '0'), availability: 'unverified', reason: String(result?.reason || 'Sin video comprobado').slice(0, 200) });
        }
    });
    const verification = { total: staged.channels.length, online: channels.filter(channel => channel.availability === 'online').length,
        unverified: channels.filter(channel => channel.availability === 'unverified').length,
        excluded: excludedChannels.length, method: 'browser-playback', checkedAt: new Date() };
    const { expiresAt, ...document } = staged;
    await db.collection('playlists').updateOne({ _id: id, userId: user.userId }, { $setOnInsert: {
        ...document, channels, channelCount: channels.length, excludedChannels, verification, updatedAt: new Date()
    } }, { upsert: true });
    await db.collection('playlistImports').deleteOne({ _id: id, userId: user.userId });
    return { success: true, playlistId: id, channelsCount: channels.length, verification };
}

module.exports = { prepareImport, confirmImport };
