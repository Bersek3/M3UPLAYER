const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createHandler, ffmpegArgs } = require('./server');

test('serves generated HLS and segments with CORS; rejects arbitrary paths and stale video', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
    const server = http.createServer(createHandler(dir, 'https://player.example'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/live/index.m3u8')).status, 503);
    const manifest = '#EXTM3U\n#EXTINF:2,\nsegment-123-001.ts\n';
    fs.writeFileSync(path.join(dir, 'index.m3u8'), manifest);
    fs.writeFileSync(path.join(dir, 'segment-123-001.ts'), Buffer.from([0x47, 0, 0]));
    const playlist = await fetch(base + '/live/index.m3u8', { headers: { Origin: 'https://player.example' } });
    assert.equal(playlist.headers.get('access-control-allow-origin'), 'https://player.example');
    assert.equal(await playlist.text(), manifest);
    const segment = await fetch(base + '/live/segment-123-001.ts');
    assert.equal(segment.headers.get('content-type'), 'video/mp2t');
    assert.equal((await segment.arrayBuffer()).byteLength, 3);
    assert.equal((await fetch(base + '/live/index.m3u8', { method: 'HEAD' })).headers.get('content-length'), String(Buffer.byteLength(manifest)));
    assert.equal((await fetch(base + '/live/index.m3u8', { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(base + '/live/index.m3u8', { method: 'OPTIONS' })).status, 204);
    assert.equal((await fetch(base + '/live/segment-123-001.ts.tmp')).status, 404);
    assert.equal((await fetch(base + '/live/index.m3u8?url=http://other.example')).status, 404);
    const stale = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, 'index.m3u8'), stale, stale);
    assert.equal((await fetch(base + '/live/index.m3u8')).status, 503);
});

test('conversion produces bounded HLS with browser codecs and unique segment sessions', () => {
    const args = ffmpegArgs('http://example.test:8000/live', '/tmp/video', 123);
    assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
    assert.equal(args[args.indexOf('-hls_list_size') + 1], '8');
    assert.equal(args[args.indexOf('-hls_start_number_source') + 1], 'epoch');
    assert.ok(args.includes('delete_segments+independent_segments+temp_file+discont_start'));
    assert.match(args[args.indexOf('-hls_segment_filename') + 1], /segment-123-/);
});
