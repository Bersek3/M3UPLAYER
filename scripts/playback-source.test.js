const { test } = require('node:test');
const assert = require('node:assert/strict');
const { playbackSource, TNT_SOURCE } = require('../api/_lib/playback-source');

test('existing TNT channels use configured HLS directly without rewriting the saved URL', () => {
    const channel = { name: 'TNT', url: TNT_SOURCE, playbackMode: 'proxy' };
    const mapped = playbackSource(channel, { TNT_SPORTS_HLS_URL: 'https://video.example/live/index.m3u8' });
    assert.equal(mapped.url, 'https://video.example/live/index.m3u8');
    assert.equal(mapped.playbackMode, 'direct');
    assert.equal(mapped.sourceUrl, TNT_SOURCE);
    assert.equal(channel.url, TNT_SOURCE);
    const other = { url: 'https://other.example/live.m3u8' };
    assert.equal(playbackSource(other, {}), other);
});

test('missing or insecure bridge configuration explains setup without changing the source', () => {
    for (const value of ['', 'not a url', 'http://video.example/live/index.m3u8',
        'https://user:secret@video.example/live/index.m3u8', 'https://video.example/']) {
        const channel = playbackSource({ url: TNT_SOURCE }, { TNT_SPORTS_HLS_URL: value });
        assert.equal(channel.url, TNT_SOURCE);
        assert.match(channel.playbackNotice, /TNT_SPORTS_HLS_URL/);
    }
});
