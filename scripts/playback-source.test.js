const { test } = require('node:test');
const assert = require('node:assert/strict');
const { playbackSource, TNT_SOURCE } = require('../api/_lib/playback-source');

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
