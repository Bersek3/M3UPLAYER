const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function importService() {
    class ObjectId {
        constructor(id) { this.id = id; }
        static isValid(id) { return typeof id === 'string' && id.length === 24; }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/_lib/playlist-import.js'), 'utf8'), {
        require: () => ({ ObjectId }), module, Date, Map
    });
    return module.exports;
}

test('only browser-confirmed candidates are saved, with their tested playback mode', async () => {
    const service = importService();
    let saved;
    const staged = { _id: 'a'.repeat(24), name: 'Test', userId: 'user', channels: [
        { name: 'Working', url: 'https://example.test/one' },
        { name: 'Broken', url: 'https://example.test/two' },
        { name: 'Not tested', url: 'https://example.test/three' }
    ] };
    const db = { collection(name) {
        if (name === 'playlistImports') return { findOne: async query => {
            assert.equal(query.userId, 'user');
            assert.ok(query.expiresAt.$gt);
            return staged;
        }, deleteOne: async () => {} };
        return { findOne: async () => null, updateOne: async (_query, update) => { saved = update.$setOnInsert; } };
    } };
    const result = await service.confirmImport(db, { userId: 'user' }, { importId: staged._id, results: [
        { candidateId: 0, playable: true, playbackMode: 'proxy' },
        { candidateId: 1, playable: false, reason: 'No video' },
        { candidateId: 999, playable: true, playbackMode: 'direct' }
    ] });
    assert.equal(result.channelsCount, 1);
    assert.equal(saved.channels[0].name, 'Working');
    assert.equal(saved.channels[0].playbackMode, 'proxy');
    assert.equal(saved.excludedChannels.length, 2);
    assert.equal(saved.verification.method, 'browser-playback');
});

test('empty playback results never create a playlist', async () => {
    const service = importService();
    let writes = 0;
    const db = { collection: name => ({
        findOne: async () => name === 'playlists' ? null : { channels: [{ name: 'Unverified' }] },
        updateOne: async () => { writes++; }
    }) };
    await assert.rejects(service.confirmImport(db, { userId: 'user' }, { importId: 'a'.repeat(24), results: [] }), /No se guardó/);
    assert.equal(writes, 0);
});

test('preparation only stages candidates, without publishing channels', async () => {
    const service = importService();
    const collections = [];
    const db = { collection: name => {
        collections.push(name);
        return { deleteMany: async () => {}, insertOne: async () => ({ insertedId: 'a'.repeat(24) }) };
    } };
    const result = await service.prepareImport(db, { userId: 'user' }, { channels: [{ name: 'Test' }] });
    assert.equal(result.requiresPlaybackCheck, true);
    assert.equal(result.channels[0].candidateId, 0);
    assert.ok(collections.every(name => name === 'playlistImports'));
});

function browserProbe() {
    const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    // Parse as a classic browser script too (top-level await must not slip in).
    new vm.Script(source);
    const start = source.indexOf('function checkBrowserPlayback(');
    const instances = [];
    class Hls {
        static isSupported() { return true; }
        static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
        static ErrorTypes = { NETWORK_ERROR: 'network' };
        constructor() { this.events = {}; instances.push(this); }
        on(event, fn) { this.events[event] = fn; }
        loadSource() {}
        attachMedia() {}
        destroy() { this.destroyed = true; }
    }
    let tick, timeout;
    const video = { style: {}, readyState: 0, videoWidth: 0, currentTime: 0, paused: false,
        setAttribute() {}, pause() {}, removeAttribute() {}, load() {}, play: async () => {},
        remove() { this.removed = true; } };
    const context = vm.createContext({ document: { createElement: () => video, body: { appendChild() {} } },
        Hls, window: { location: { protocol: 'https:', href: 'https://example.test/' } }, URL, API_BASE: '',
        setTimeout: fn => { timeout = fn; }, clearTimeout() {}, setInterval: fn => { tick = fn; }, clearInterval() {} });
    vm.runInContext(source.slice(start, source.indexOf('async function analyzeAndSavePlaylist', start)), context);
    const controller = new AbortController();
    const result = context.checkBrowserPlayback({ url: 'https://example.test/live', candidateId: 0 }, controller.signal);
    return { result, instances, video, controller, tick: () => tick(), timeout: () => timeout() };
}

test('manifest and metadata alone do not pass; video and advancing playback are required', async () => {
    const probe = browserProbe();
    let settled = false;
    probe.result.then(() => { settled = true; });
    probe.instances[0].events.manifest();
    probe.tick();
    await Promise.resolve();
    assert.equal(settled, false);
    probe.video.readyState = 2;
    probe.video.videoWidth = 1280;
    probe.video.currentTime = 10;
    probe.tick();
    probe.video.currentTime = 11.2;
    probe.tick();
    assert.equal((await probe.result).playable, true);
    assert.equal(probe.video.removed, true);
    assert.equal(probe.instances[0].destroyed, true);
});

test('no video after direct and proxy timeouts is excluded; cancellation releases resources', async () => {
    const probe = browserProbe();
    probe.timeout();
    assert.equal(probe.instances.length, 2);
    probe.timeout();
    assert.equal((await probe.result).playable, false);
    const cancelled = browserProbe();
    cancelled.controller.abort();
    assert.equal((await cancelled.result).playable, false);
    assert.equal(cancelled.video.removed, true);
});
