const TNT_SOURCE = 'http://181.78.79.131:8000/play/a0q9';

function playbackSource(channel, env = process.env) {
    if (channel.url !== TNT_SOURCE) return channel;
    const configured = env.TNT_SPORTS_HLS_URL;
    if (configured) {
        try {
            const target = new URL(configured);
            if (target.protocol === 'https:' && !target.username && !target.password && target.pathname.endsWith('.m3u8')) {
                return { ...channel, sourceUrl: channel.url, url: target.href, playbackMode: 'direct',
                    playbackNotice: undefined };
            }
        } catch { /* Report configuration through the channel instead of breaking the catalog. */ }
    }
    return { ...channel, playbackNotice: 'Este canal necesita el servicio de video. Configura TNT_SPORTS_HLS_URL en Vercel con la URL HTTPS del conversor.' };
}

module.exports = { playbackSource, TNT_SOURCE };
