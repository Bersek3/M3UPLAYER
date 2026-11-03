const TNT_SOURCE = 'http://181.78.79.131:8000/play/a0q9';
const crypto = require('node:crypto');
const bridgeSources = new Set(require('./bridge-sources.json'));

function playbackSource(channel, env = process.env) {
    if (env.M3U_PLAYBACK_BRIDGE_URL) {
        try {
            const original = new URL(channel.sourceUrl || channel.url);
            const source = original.href;
            // Imported local converter playlists already carry the registered ID.
            // Hashing their loopback URL again loses the original source identity.
            const localPath = original.protocol === 'http:' &&
                ['127.0.0.1', 'localhost', '[::1]'].includes(original.hostname) &&
                !original.username && !original.password && !original.search && !original.hash &&
                /^\/live\/([a-f0-9]{24})\/index\.m3u8$/.exec(original.pathname);
            const id = localPath ? localPath[1] : crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
            const allowed = env.M3U_BRIDGE_SOURCE_IDS ? new Set(env.M3U_BRIDGE_SOURCE_IDS.split(',').map(value => value.trim())) : bridgeSources;
            const base = new URL(env.M3U_PLAYBACK_BRIDGE_URL);
            const local = base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
            if (allowed.has(id) && (base.protocol === 'https:' || local) && !base.username && !base.password && !base.search && !base.hash) {
                return { ...channel, sourceUrl: source, url: base.href.replace(/\/$/, '') + '/live/' + id + '/index.m3u8',
                    playbackMode: 'direct', playbackType: 'hls', playbackNotice: undefined };
            }
        } catch { /* Preserve the existing path when conversion is not configured correctly. */ }
    }
    if (channel.url !== TNT_SOURCE && channel.sourceUrl !== TNT_SOURCE) {
        try {
            const url = new URL(channel.url);
            if (url.hostname === '181.78.79.131' && url.port === '8000' && /^\/play\/[^/]+\/?$/.test(url.pathname)) {
                return { ...channel, playbackMode: 'direct', playbackType: 'mpegts' };
            }
        } catch { /* Invalid URLs are handled by the playback/import validation. */ }
        return channel;
    }
    // An existing bridge URL must not silently keep direct playback on Render.
    // Preserve the former HLS route only when deliberately selected.
    const configured = env.TNT_SPORTS_PLAYBACK === 'hls' && env.TNT_SPORTS_HLS_URL;
    if (configured) {
        try {
            const target = new URL(configured);
            if (target.protocol === 'https:' && !target.username && !target.password && target.pathname.endsWith('.m3u8')) {
                return { ...channel, sourceUrl: TNT_SOURCE, url: target.href, playbackMode: 'direct', playbackType: 'hls',
                    playbackNotice: undefined };
            }
        } catch { /* Fall back to the original source when optional HLS configuration is invalid. */ }
    }
    if (env.TNT_SPORTS_DIRECT_URL) {
        try {
            const target = new URL(env.TNT_SPORTS_DIRECT_URL);
            if (target.protocol === 'https:' && !target.username && !target.password) {
                return { ...channel, sourceUrl: TNT_SOURCE, url: target.href, playbackMode: 'direct',
                    playbackType: 'mpegts', playbackNotice: undefined };
            }
        } catch { /* Invalid provider overrides must not disable the original direct source. */ }
    }
    return { ...channel, url: TNT_SOURCE, playbackMode: 'direct', playbackType: 'mpegts', playbackNotice: undefined };
}

module.exports = { playbackSource, TNT_SOURCE };
