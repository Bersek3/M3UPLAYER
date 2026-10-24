const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkStreams } = require('./check-streams');

test('imports only streams with media; follows relative HLS manifests and rejects errors', async () => {
    const original = global.fetch;
    const requested = [];
    global.fetch = async (url, { signal }) => {
        requested.push(url);
        if (url.endsWith('/slow')) return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        if (url.endsWith('/master')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia');
        if (url.endsWith('/media')) return new Response('#EXTM3U\n#EXTINF:4,\nsegment');
        if (url.endsWith('/segment')) return new Response(new Uint8Array([0x47, 1, 2]));
        if (url.endsWith('/missing')) return new Response('missing', { status: 404 });
        if (url.endsWith('/empty')) return new Response('#EXTM3U');
        return new Response('<html>Error</html>', { headers: { 'content-type': 'video/mp2t' } });
    };
    try {
        const result = await checkStreams(['master', 'missing', 'empty', 'html', 'slow'].map(name => ({ name, url: `https://example.test/${name}` })), { timeoutMs: 40 });
        assert.deepEqual(result.channels.map(c => c.name), ['master']);
        assert.equal(result.excludedChannels.length, 4);
        assert.equal(result.verification.total, 5);
        assert.ok(requested.includes('https://example.test/segment'));
        assert.match(result.excludedChannels.find(c => c.name === 'slow').reason, /tiempo/);
        const expired = await checkStreams([{ url: 'https://example.test/master' }], { budgetMs: 0 });
        assert.equal(expired.channels.length, 0);
        assert.equal(expired.verification.unverified, 1);
    } finally {
        global.fetch = original;
    }
});
