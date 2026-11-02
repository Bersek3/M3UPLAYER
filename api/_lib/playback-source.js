const TNT_SOURCE = 'http://181.78.79.131:8000/play/a0q9';

function playbackSource(channel, env = process.env) {
    if (channel.url !== TNT_SOURCE && channel.sourceUrl !== TNT_SOURCE) return channel;
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
