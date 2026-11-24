const { test } = require('node:test');
const assert = require('node:assert/strict');
const { playbackSource, TNT_SOURCE } = require('../api/_lib/playback-source');

test('configured converter maps registered sources and preserves the original URL', () => {
    const mapped = playbackSource({ name: 'TNT', url: TNT_SOURCE }, { M3U_PLAYBACK_BRIDGE_URL: 'https://video.example' });
    assert.match(mapped.url, /^https:\/\/video\.example\/live\/[a-f0-9]{24}\/index\.m3u8$/);
    assert.equal(mapped.sourceUrl, TNT_SOURCE);
    assert.equal(mapped.playbackType, 'hls');
    assert.equal(playbackSource(mapped, { M3U_PLAYBACK_BRIDGE_URL: 'https://video.example' }).url, mapped.url);
    const other = { url: 'https://unrelated.example/stream.m3u8' };
    assert.equal(playbackSource(other, { M3U_PLAYBACK_BRIDGE_URL: 'https://video.example' }), other);
});

test('converter rejects non-loopback HTTP and invalid public base addresses', () => {
    for (const base of ['http://public.example', 'https://user:secret@video.example', 'https://video.example/?token=a']) {
        assert.equal(playbackSource({ url: TNT_SOURCE }, { M3U_PLAYBACK_BRIDGE_URL: base }).url, TNT_SOURCE);
    }
    assert.match(playbackSource({ url: TNT_SOURCE }, { M3U_PLAYBACK_BRIDGE_URL: 'http://127.0.0.1:10000' }).url, /^http:\/\/127.0.0.1:10000\/live\//);
});

test('saved local converter playlist moves registered IDs to the public HTTPS converter', () => {
    const id = 'c55014add896e9fc907dc4d0';
    const env = { M3U_PLAYBACK_BRIDGE_URL: 'https://video.example' };
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
        const channel = { name: 'CHV', url: `http://${host}:10000/live/${id}/index.m3u8`, playbackMode: 'proxy' };
        const mapped = playbackSource(channel, env);
        assert.equal(mapped.url, `https://video.example/live/${id}/index.m3u8`);
        assert.equal(mapped.sourceUrl, channel.url);
        assert.equal(mapped.playbackType, 'hls');
        assert.equal(mapped.playbackMode, 'direct');
        assert.equal(playbackSource(mapped, env).url, mapped.url);
        assert.equal(playbackSource(mapped, { ...env, M3U_PLAYBACK_BRIDGE_URL: 'https://replacement.example' }).url,
            `https://replacement.example/live/${id}/index.m3u8`);
        assert.equal(channel.playbackMode, 'proxy');
    }
});

test('local converter migration requires registered IDs and an exact loopback route', () => {
    const id = 'c55014add896e9fc907dc4d0';
    for (const url of [
        `http://127.0.0.1:10000/live/${'0'.repeat(24)}/index.m3u8`,
        `https://unrelated.example/live/${id}/index.m3u8`,
        `http://user:secret@localhost:10000/live/${id}/index.m3u8`,
        `http://localhost:10000/live/${id}/index.m3u8?other=1`
    ]) {
        const channel = { url };
        assert.equal(playbackSource(channel, { M3U_PLAYBACK_BRIDGE_URL: 'https://video.example' }), channel);
    }
});

test('bare provider endpoints use continuous MPEG-TS while actual HLS paths remain HLS', () => {
    for (const id of ['a0pm', 'a0r0', 'a0qp']) {
        const url = `http://181.78.79.131:8000/play/${id}`;
        assert.equal(playbackSource({ url }, {}).playbackType, 'mpegts');
        assert.equal(playbackSource({ url }, {}).url, url);
    }
    const hls = { url: 'http://181.78.8.199:8000/play/a0d4/index.m3u8' };
    assert.equal(playbackSource(hls, {}), hls);
});

test('TNT uses MPEG-TS directly even when the former bridge URL is configured', () => {
    const channel = { name: 'TNT', url: TNT_SOURCE, playbackMode: 'proxy', playbackNotice: 'Old setup notice' };
    const mapped = playbackSource(channel, { TNT_SPORTS_HLS_URL: 'https://video.example/live/index.m3u8' });
    assert.equal(mapped.url, TNT_SOURCE);
    assert.equal(mapped.playbackMode, 'direct');
    assert.equal(mapped.playbackType, 'mpegts');
    assert.equal(mapped.playbackNotice, undefined);
    assert.equal(channel.playbackMode, 'proxy');
    assert.equal(channel.playbackNotice, 'Old setup notice');
});

test('existing TNT channels can explicitly select HLS without rewriting the saved URL', () => {
    const channel = { name: 'TNT', url: TNT_SOURCE, playbackMode: 'proxy' };
    const mapped = playbackSource(channel, { TNT_SPORTS_PLAYBACK: 'hls', TNT_SPORTS_HLS_URL: 'https://video.example/live/index.m3u8' });
    assert.equal(mapped.url, 'https://video.example/live/index.m3u8');
    assert.equal(mapped.playbackMode, 'direct');
    assert.equal(mapped.playbackType, 'hls');
    assert.equal(mapped.sourceUrl, TNT_SOURCE);
    assert.equal(channel.url, TNT_SOURCE);
    const other = { url: 'https://other.example/live.m3u8' };
    assert.equal(playbackSource(other, {}), other);
});

test('missing or insecure optional HLS configuration preserves direct MPEG-TS playback', () => {
    for (const value of ['', 'not a url', 'http://video.example/live/index.m3u8',
        'https://user:secret@video.example/live/index.m3u8', 'https://video.example/']) {
        const channel = playbackSource({ url: TNT_SOURCE }, { TNT_SPORTS_PLAYBACK: 'hls', TNT_SPORTS_HLS_URL: value });
        assert.equal(channel.url, TNT_SOURCE);
        assert.equal(channel.playbackMode, 'direct');
        assert.equal(channel.playbackType, 'mpegts');
        assert.equal(channel.playbackNotice, undefined);
    }
});

test('provider HTTPS override retains the original source and MPEG-TS transport', () => {
    const mapped = playbackSource({ url: TNT_SOURCE }, { TNT_SPORTS_DIRECT_URL: 'https://provider.example/play/a0q9?token=test' });
    assert.equal(mapped.url, 'https://provider.example/play/a0q9?token=test');
    assert.equal(mapped.sourceUrl, TNT_SOURCE);
    assert.equal(mapped.playbackMode, 'direct');
    assert.equal(mapped.playbackType, 'mpegts');
    assert.equal(mapped.playbackNotice, undefined);
});

test('invalid provider override does not introduce insecure schemes or embedded credentials', () => {
    for (const value of ['not a url', 'http://provider.example/play/a0q9',
        'https://user:secret@provider.example/play/a0q9', 'file:///tmp/channel.ts']) {
        const mapped = playbackSource({ url: TNT_SOURCE }, { TNT_SPORTS_DIRECT_URL: value });
        assert.equal(mapped.url, TNT_SOURCE);
        assert.equal(mapped.playbackType, 'mpegts');
        assert.equal(mapped.playbackNotice, undefined);
    }
});

test('previously saved HLS mapping returns to its original MPEG-TS source by default', () => {
    const saved = { url: 'https://old-bridge.onrender.com/live/index.m3u8', sourceUrl: TNT_SOURCE,
        playbackMode: 'proxy', playbackType: 'hls', playbackNotice: 'Old bridge notice' };
    const mapped = playbackSource(saved, { TNT_SPORTS_HLS_URL: saved.url });
    assert.equal(mapped.url, TNT_SOURCE);
    assert.equal(mapped.sourceUrl, TNT_SOURCE);
    assert.equal(mapped.playbackMode, 'direct');
    assert.equal(mapped.playbackType, 'mpegts');
    assert.equal(mapped.playbackNotice, undefined);
    assert.equal(saved.url, 'https://old-bridge.onrender.com/live/index.m3u8');
});

test('provider override for a previously saved HLS channel retains the true original source', () => {
    const mapped = playbackSource({ url: 'https://old-bridge.onrender.com/live/index.m3u8', sourceUrl: TNT_SOURCE },
        { TNT_SPORTS_DIRECT_URL: 'https://provider.example/play/a0q9' });
    assert.equal(mapped.url, 'https://provider.example/play/a0q9');
    assert.equal(mapped.sourceUrl, TNT_SOURCE);
    assert.equal(mapped.playbackType, 'mpegts');
});
