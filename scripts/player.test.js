const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function player(url) {
    const instances = [];
    class Hls {
        static isSupported() { return true; }
        static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
        static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
        constructor(config) { this.config = config; this.events = {}; instances.push(this); }
        on(event, callback) { this.events[event] = callback; }
        loadSource(source) { this.source = source; }
        attachMedia() {}
        destroy() { this.destroyed = true; }
        stopLoad() { this.stopped = true; }
    }
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {} },
            pause() {}, load() {}, removeAttribute() {}, play: async () => {} });
        return elements.get(id);
    } };
    const context = vm.createContext({ tvChannels: [{ url }], tvHls: null, Hls, document,
        window: { location: { protocol: 'https:', href: 'https://player.example/' } },
        URL, API_BASE: '', updateTvVerticalPosition() {}, updateTvWatermarkAndEpg() {}, showToast() {} });
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const start = source.indexOf('function playTvChannel(index)');
    vm.runInContext(source.slice(start, source.indexOf('function updateTvWatermarkAndEpg', start)), context);
    context.playTvChannel(0);
    return { instances, elements };
}

test('HTTP starts with HTTPS proxy, including later HLS requests', () => {
    const { instances } = player('http://cdn.example/live.m3u8');
    assert.match(instances[0].source, /^\/api\/proxy\/hls\?url=/);
    let target;
    instances[0].config.xhrSetup({ open(_method, url) { target = url; } }, 'http://cdn.example/seg.ts');
    assert.equal(target, '/api/proxy/hls?url=' + encodeURIComponent('http://cdn.example/seg.ts'));
});

test('network failure retries once through proxy and then shows an error', () => {
    const { instances, elements } = player('https://cdn.example/live.m3u8');
    instances[0].events.error(null, { fatal: true, type: 'network' });
    assert.equal(instances.length, 2);
    assert.equal(instances[0].destroyed, true);
    assert.match(instances[1].source, /^\/api\/proxy\/hls\?url=/);
    instances[1].events.error(null, { fatal: true, type: 'network' });
    assert.equal(instances.length, 2);
    assert.equal(instances[1].stopped, true);
    assert.ok(elements.get('tv-error-text').textContent);
});
