const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('./serve-direct-player');

test('standalone server serves only player assets and never proxies arbitrary targets', async t => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base + '/direct-player.html');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(await page.text(), /direct-player-page\.js/);
    const script = await fetch(base + '/direct-player-page.js', { method: 'HEAD' });
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await script.text(), '');
    for (const route of ['/package.json', '/api/channels', '/api/proxy/hls?url=http://example.test', '/vendor/../package.json']) {
        assert.equal((await fetch(base + route)).status, 404, route);
    }
    const write = await fetch(base + '/direct-player.html', { method: 'POST', body: 'test' });
    assert.equal(write.status, 405);
    assert.equal(write.headers.get('allow'), 'GET, HEAD');
});
