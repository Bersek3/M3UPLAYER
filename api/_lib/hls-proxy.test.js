const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteManifest, publicAddress, handler } = require('./hls-proxy');

test('rewrites variants, segments, keys, maps and renditions using the final upstream URL', () => {
    const text = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/list.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nhttp://media.example/seg.ts?token=a%2Fb\nvariant.m3u8';
    const result = rewriteManifest(text, 'https://cdn.example/live/master.m3u8');
    for (const url of ['https://cdn.example/live/audio/list.m3u8', 'https://cdn.example/key',
        'https://cdn.example/live/init.mp4', 'http://media.example/seg.ts?token=a%2Fb',
        'https://cdn.example/live/variant.m3u8']) {
        assert.ok(result.includes('/api/proxy/hls?url=' + encodeURIComponent(url)));
    }
});

test('rejects non HTTP manifest references', () => {
    assert.throws(() => rewriteManifest('#EXTM3U\nfile:///secret', 'https://cdn.example/'));
});

test('blocks loopback, private, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.0.1', '169.254.169.254',
        '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '2001:db8::1']) {
        assert.equal(publicAddress(ip), false, ip);
    }
    assert.equal(publicAddress('8.8.8.8'), true);
    assert.equal(publicAddress('2606:4700:4700::1111'), true);
});

test('proxy refuses local destinations without contacting them', async () => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', query: { url: 'http://127.0.0.1/' }, headers: {} }, res);
    assert.equal(res.code, 502);
    assert.match(res.body.error, /permitido/);
});
