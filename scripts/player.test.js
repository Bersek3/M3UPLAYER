const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function player(url, fields = {}, href = 'https://player.example/') {
    const instances = [];
    const timers = new Map();
    const directInstances = [];
    let timerId = 0;
    class Hls {
        static isSupported() { return true; }
        static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', FRAG_LOADED: 'fragment' };
        static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
        constructor(config) { this.config = config; this.events = {}; instances.push(this); }
        on(event, callback) { this.events[event] = callback; }
        loadSource(source) { this.source = source; }
        attachMedia() {}
        destroy() { this.destroyed = true; }
        stopLoad() { this.stopped = true; }
        recoverMediaError() { this.mediaRecoveries = (this.mediaRecoveries || 0) + 1; }
        startLoad() { this.restarts = (this.restarts || 0) + 1; }
    }
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {} },
            pause() {}, load() {}, removeAttribute() {}, play: async () => {} });
        return elements.get(id);
    } };
    const context = vm.createContext({ tvChannels: [{ url, ...fields }], tvHls: null, Hls, document,
        window: { location: { protocol: new URL(href).protocol, href } },
        DirectMpegts: {
            isChannel: channel => channel.playbackType === 'mpegts',
            create(video, source, callbacks) { const item = { source, video, callbacks,
                start() { this.started = true; }, destroy() { this.destroyed = true; } };
                directInstances.push(item); return item; }
        },
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); }, URL, API_BASE: '', updateTvVerticalPosition() {}, updateTvWatermarkAndEpg() {}, showToast() {} });
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const start = source.indexOf('function playTvChannel(index)');
    vm.runInContext(source.slice(start, source.indexOf('function updateTvWatermarkAndEpg', start)), context);
    context.playTvChannel(0);
    return { instances, elements, timers, context, directInstances };
}

test('HTTP starts with HTTPS proxy, including later HLS requests', () => {
    const { instances } = player('http://cdn.example/live.m3u8');
    assert.match(instances[0].source, /^\/api\/proxy\/hls\?url=/);
    let target;
    instances[0].config.xhrSetup({ open(_method, url) { target = url; } }, 'http://cdn.example/seg.ts');
    assert.equal(target, '/api/proxy/hls?url=' + encodeURIComponent('http://cdn.example/seg.ts'));
});

test('persistent media failure rebuilds the video source once and reloads the live manifest', () => {
    const { instances, timers, elements } = player('https://video.example/live/index.m3u8',
        { playbackType: 'hls', sourceUrl: 'https://provider.example/live' });
    const first = instances[0];
    const video = elements.get('tv-main-video');
    let sourceResets = 0;
    video.removeAttribute = name => { assert.equal(name, 'src'); sourceResets++; };
    first.events.error(null, { fatal: true, type: 'media' });
    assert.equal(first.mediaRecoveries, 1);
    assert.equal(timers.size, 0);
    first.events.error(null, { fatal: true, type: 'media' });
    assert.equal(first.stopped, true);
    assert.equal(timers.size, 1);
    // Duplicate callbacks must not consume recovery or show a final error early.
    first.events.error(null, { fatal: true, type: 'media' });
    assert.equal(elements.get('tv-error-text'), undefined);
    const [id, timer] = [...timers][0];
    assert.equal(timer.delay, 1000);
    timers.delete(id);
    timer.fn();
    assert.equal(first.destroyed, true);
    assert.equal(sourceResets, 1);
    assert.equal(instances.length, 2);
    assert.equal(instances[1].source, first.source);
    instances[1].events.error(null, { fatal: true, type: 'media' });
    assert.equal(instances[1].stopped, true);
    assert.equal(timers.size, 0);
    assert.match(elements.get('tv-error-text').textContent, /después de reiniciar/);
});

test('switching channels cancels a pending decoder rebuild and ignores stale media errors', () => {
    const { instances, timers, context } = player('https://video.example/live.m3u8');
    const first = instances[0];
    first.events.error(null, { fatal: true, type: 'media' });
    first.events.error(null, { fatal: true, type: 'media' });
    assert.equal(timers.size, 1);
    context.playTvChannel(0);
    assert.equal(timers.size, 0);
    assert.equal(first.destroyed, true);
    first.events.error(null, { fatal: true, type: 'media' });
    assert.equal(timers.size, 0);
    assert.equal(instances.length, 2);
});

test('non-media engine errors are not reported as a browser decoding failure', () => {
    const { instances, elements } = player('https://video.example/live.m3u8');
    instances[0].events.error(null, { fatal: true, type: 'other' });
    assert.equal(instances[0].stopped, true);
    assert.match(elements.get('tv-error-text').textContent, /procesar esta señal/);
});

test('decoder diagnostics preserve the native cause before recovery clears it and omit source URLs', () => {
    const { instances, elements } = player('https://video.example/private.m3u8?token=secret');
    const video = elements.get('tv-main-video');
    video.error = { code: 3, message: 'PIPELINE_ERROR_DECODE https://video.example/private?token=secret' };
    instances[0].recoverMediaError = () => { video.error = null; };
    instances[0].events.error(null, { fatal: true, type: 'media', details: 'bufferAppendError' });
    const snapshot = video.playbackDiagnostics.errors[0];
    assert.equal(video.error, null);
    assert.equal(snapshot.mediaCode, 3);
    assert.equal(snapshot.detail, 'bufferAppendError');
    assert.match(snapshot.mediaMessage, /PIPELINE_ERROR_DECODE/);
    assert.ok(!JSON.stringify(video.playbackDiagnostics).includes('secret'));
    assert.ok(!JSON.stringify(video.playbackDiagnostics).includes('video.example'));
});

test('copying a playback diagnostic includes the captured error and browser version', async () => {
    let copied, notice;
    const diagnostics = { channel: 'CHV', errors: [{ mediaCode: 3, mediaMessage: 'PIPELINE_ERROR_DECODE' }] };
    const context = vm.createContext({
        document: { getElementById: () => ({ playbackDiagnostics: diagnostics }) },
        navigator: { userAgent: 'Test browser', clipboard: { async writeText(text) { copied = JSON.parse(text); } } },
        showToast(text) { notice = text; }
    });
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const start = source.indexOf('async function copyTvPlaybackDiagnostics()');
    vm.runInContext(source.slice(start, source.indexOf('function initTvPlaybackUi(', start)), context);
    await context.copyTvPlaybackDiagnostics();
    assert.equal(copied.errors[0].mediaMessage, 'PIPELINE_ERROR_DECODE');
    assert.equal(copied.browser, 'Test browser');
    assert.equal(notice, 'Diagnóstico copiado');
});

test('network failure falls back to proxy, retries with backoff, then shows an error', () => {
    const { instances, elements, timers } = player('https://cdn.example/live.m3u8');
    instances[0].events.error(null, { fatal: true, type: 'network' });
    assert.equal(instances.length, 2);
    assert.equal(instances[0].destroyed, true);
    assert.match(instances[1].source, /^\/api\/proxy\/hls\?url=/);
    instances[1].events.error(null, { fatal: true, type: 'network' });
    assert.equal(instances.length, 2);
    for (const delay of [1000, 2000, 4000]) {
        const [id, timer] = [...timers][0];
        assert.equal(timer.delay, delay);
        timers.delete(id); timer.fn();
        instances[1].events.error(null, { fatal: true, type: 'network' });
    }
    assert.equal(instances[1].restarts, 3);
    assert.equal(instances[1].stopped, true);
    assert.ok(elements.get('tv-error-text').textContent);
});

test('confirmed invalid sources show their cause without repeated proxy requests', () => {
    for (const code of ['SOURCE_DNS', 'SOURCE_NOT_VIDEO', 'SOURCE_POLICY', 'SOURCE_HTTP_401', 'SOURCE_HTTP_404']) {
        const { instances, elements, timers } = player('http://cdn.example/live.m3u8');
        instances[0].events.error(null, { fatal: true, type: 'network',
            networkDetails: { responseText: JSON.stringify({ code, error: 'Causa del origen' }) } });
        assert.equal(instances[0].stopped, true);
        assert.equal(timers.size, 0);
        assert.equal(elements.get('tv-error-text').textContent, 'Causa del origen');
    }
});

test('unconfigured continuous video explains the required service without failing through the HLS proxy', () => {
    const notice = 'Configura TNT_SPORTS_HLS_URL';
    const { instances, elements } = player('http://181.78.79.131:8000/play/a0q9', { playbackNotice: notice });
    assert.equal(instances.length, 0);
    assert.equal(elements.get('tv-error-text').textContent, notice);
});


test('switching channels cancels pending recovery of the old player', () => {
    const { instances, timers, context } = player('http://cdn.example/live.m3u8');
    instances[0].events.error(null, { fatal: true, type: 'network' });
    assert.equal(timers.size, 1);
    context.playTvChannel(0);
    assert.equal(timers.size, 0);
    assert.equal(instances[0].destroyed, true);
});

test('successful fragment restores the consecutive network retry budget', () => {
    const { instances, timers } = player('http://cdn.example/live.m3u8');
    const hls = instances[0];
    hls.events.error(null, { fatal: true, type: 'network' });
    const [id, timer] = [...timers][0]; timers.delete(id); timer.fn();
    hls.events.fragment();
    hls.events.error(null, { fatal: true, type: 'network' });
    assert.equal([...timers.values()][0].delay, 1000);
});


test('MPEG-TS uses the direct player and never sends its source to the HLS proxy', () => {
    const { instances, directInstances, context } = player('http://181.78.79.131:8000/play/a0q9', { playbackType: 'mpegts', playbackMode: 'proxy' });
    assert.equal(instances.length, 0);
    assert.equal(directInstances[0].source, 'http://181.78.79.131:8000/play/a0q9');
    assert.equal(directInstances[0].started, true);
    context.playTvChannel(0);
    assert.equal(directInstances[0].destroyed, true);
});

test('converted HLS retries its converter directly instead of proxying a local address', () => {
    const url = 'http://127.0.0.1:10000/live/test/index.m3u8';
    const { instances, elements, timers } = player(url, { playbackType: 'hls',
        sourceUrl: 'http://provider.example/live.ts', playbackMode: 'proxy' }, 'http://127.0.0.1:3000/');
    let hls = instances[0];
    assert.equal(hls.source, url);
    for (const delay of [1000, 2000, 4000]) {
        hls.events.error(null, { fatal: true, type: 'network' });
        const [id, timer] = [...timers][0];
        assert.equal(timer.delay, delay);
        timers.delete(id); timer.fn();
        assert.equal(hls.destroyed, true);
        hls = instances.at(-1);
        assert.equal(hls.source, url);
    }
    hls.events.error(null, { fatal: true, type: 'network' });
    assert.equal(instances.length, 4);
    assert.equal(hls.stopped, true);
    assert.match(elements.get('tv-error-text').textContent, /conversor/);
});

test('imported local playlist without metadata never contacts Vercel from the public player', () => {
    const url = 'http://127.0.0.1:10000/live/c55014add896e9fc907dc4d0/index.m3u8';
    const { instances, timers, elements } = player(url);
    assert.equal(instances.length, 0);
    assert.equal(timers.size, 0);
    assert.match(elements.get('tv-error-text').textContent, /Abrir-Reproductor.cmd/);
});

test('expired converter segment reloads the manifest and ignores errors from the old player', () => {
    const url = 'https://converter.example/live/channel/index.m3u8';
    const { instances, timers } = player(url, { playbackType: 'hls', sourceUrl: 'http://provider.example/live.ts' });
    const old = instances[0];
    old.events.error(null, { fatal: true, type: 'network', response: { code: 404 } });
    const [id, timer] = [...timers][0];
    timers.delete(id); timer.fn();
    assert.equal(old.destroyed, true);
    assert.equal(instances.length, 2);
    assert.equal(instances[1].source, url);
    assert.equal(instances[1].restarts, undefined);
    old.events.error(null, { fatal: true, type: 'network' });
    assert.equal(timers.size, 0);
});

test('confirmed provider failure from converter stops without retrying unavailable channels', () => {
    const { instances, timers, elements } = player('https://converter.example/live/channel/index.m3u8',
        { playbackType: 'hls', sourceUrl: 'http://provider.example/live.ts' });
    instances[0].events.error(null, { fatal: true, type: 'network', networkDetails: {
        responseText: JSON.stringify({ code: 'SOURCE_HTTP_404', error: 'El enlace original respondió HTTP 404.' })
    } });
    assert.equal(instances[0].stopped, true);
    assert.equal(timers.size, 0);
    assert.equal(instances.length, 1);
    assert.match(elements.get('tv-error-text').textContent, /404/);
});

test('imported local playlist without metadata plays directly in the local portal', () => {
    const url = 'http://127.0.0.1:10000/live/c55014add896e9fc907dc4d0/index.m3u8';
    const { instances } = player(url, { playbackMode: 'proxy' }, 'http://127.0.0.1:3000/');
    assert.equal(instances[0].source, url);
    instances[0].events.error(null, { fatal: true, type: 'network' });
    assert.equal(instances.length, 1);
});
