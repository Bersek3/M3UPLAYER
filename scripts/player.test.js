const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function player(url, fields = {}) {
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
        startLoad() { this.restarts = (this.restarts || 0) + 1; }
    }
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {} },
            pause() {}, load() {}, removeAttribute() {}, play: async () => {} });
        return elements.get(id);
    } };
    const context = vm.createContext({ tvChannels: [{ url, ...fields }], tvHls: null, Hls, document,
        window: { location: { protocol: 'https:', href: 'https://player.example/' } },
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
