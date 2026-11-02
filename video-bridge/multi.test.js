const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once, EventEmitter } = require('node:events');
const { sourceId, readChannels, conversionArgs, createMultiBridge } = require('./multi');

test('only configured playlist sources receive stable opaque IDs', () => {
    const channels = readChannels('#EXTM3U\n#EXTINF:-1,Canal\nhttp://example.test:8000/play/a0\n');
    assert.equal(channels.size, 1);
    assert.equal(channels.get(sourceId('http://example.test:8000/play/a0')).name, 'Canal');
    assert.match([...channels.keys()][0], /^[a-f0-9]{24}$/);
});

test('conversion deinterlaces and emits browser-compatible H264 and AAC with bounded threads', () => {
    const args = conversionArgs('http://example.test/play/a', '/tmp/output', 1);
    assert.match(args[args.indexOf('-vf') + 1], /^bwdif=.*fps=30/);
    assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
    assert.equal(args[args.indexOf('-threads') + 1], '2');
});

async function fixture(t, maxSessions = 2) {
    const channels = readChannels(['#EXTM3U', ...['a', 'b', 'c'].flatMap(id => [`#EXTINF:-1,${id}`, `http://example.test:8000/play/${id}`])].join('\n'));
    const children = [];
    const bridge = createMultiBridge({ channels, maxSessions, origins: ['https://player.example'], resolve: async url => url,
        spawnProcess(_, args) {
            const child = new EventEmitter();
            child.stderr = new EventEmitter(); child.exitCode = null;
            child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
            children.push(child);
            const dir = path.dirname(args.at(-1));
            fs.writeFileSync(path.join(dir, 'index.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsegment-1-1.ts\n#EXTINF:2,\nsegment-1-2.ts\n');
            fs.writeFileSync(path.join(dir, 'segment-1-1.ts'), Buffer.alloc(188, 0x47));
            return child;
        } });
    const server = http.createServer(bridge.handler);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => {
        bridge.close(); server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    return { bridge, children, channels, base: `http://127.0.0.1:${server.address().port}` };
}

test('serves converted manifests and segments without accepting arbitrary URLs', async t => {
    const { base, children, channels } = await fixture(t);
    const id = [...channels.keys()][0];
    const response = await fetch(`${base}/live/${id}/index.m3u8`, { headers: { Origin: 'https://player.example' } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /#EXTM3U/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://player.example');
    assert.equal((await fetch(`${base}/live/${id}/segment-1-1.ts`)).status, 200);
    assert.equal((await fetch(`${base}/live/${'f'.repeat(24)}/index.m3u8`)).status, 404);
    assert.equal((await fetch(`${base}/?url=http://127.0.0.1`)).status, 404);
    assert.equal((await fetch(`${base}/live/${id}/index.m3u8`, { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal(children.length, 1);
});

test('viewers share one conversion and capacity evicts the least recently requested source', async t => {
    const { base, children, channels, bridge } = await fixture(t);
    const ids = [...channels.keys()];
    for (const id of [ids[0], ids[0], ids[1], ids[2]]) assert.equal((await fetch(`${base}/live/${id}/index.m3u8`)).status, 200);
    assert.equal(children.length, 3);
    assert.equal(children[0].exitCode, 0);
    assert.equal(bridge.sessions.size, 2);
});
