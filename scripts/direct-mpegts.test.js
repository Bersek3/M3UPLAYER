const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ protocol = 'https:', supported = true, autoplayError, hybrid = false } = {}) {
    const instances = [];
    const audioInstances = [];
    const loaders = [];
    const timers = new Map();
    const intervals = new Map();
    const microtasks = [];
    const listeners = new Map();
    const errors = [];
    const buffering = [];
    let ranges = [];
    let now = 1000;
    let id = 0;
    let autoplayBlocked = 0;
    const video = {
        autoplay: true,
        playbackRate: 1,
        paused: true,
        currentTime: 0,
        playCalls: 0,
        pauseCalls: 0,
        buffered: {
            get length() { return ranges.length; },
            start(index) { return ranges[index][0]; },
            end(index) { return ranges[index][1]; }
        },
        play() {
            this.playCalls++;
            if (autoplayError) return Promise.reject(autoplayError);
            this.paused = false;
            return Promise.resolve();
        },
        pause() { this.pauseCalls++; this.paused = true; },
        addEventListener(name, callback) { listeners.set(name, callback); },
        removeEventListener(name, callback) {
            if (listeners.get(name) === callback) listeners.delete(name);
        }
    };
    const mpegts = {
        Events: { ERROR: 'error', LOADING_COMPLETE: 'complete' },
        ErrorTypes: { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' },
        getFeatureList: () => ({ mseLivePlayback: supported }),
        createPlayer(source, config) {
            const player = {
                source, config, events: {}, destroyCalls: 0, loadCalls: 0,
                on(event, callback) { this.events[event] = callback; },
                attachMediaElement(media) { this.video = media; },
                load() { this.loadCalls++; },
                destroy() { this.destroyCalls++; }
            };
            instances.push(player);
            return player;
        }
    };
    const sandbox = {
        location: { protocol }, URL, mpegts, queueMicrotask(callback) { microtasks.push(callback); },
        Date: { now: () => now },
        setTimeout(callback, delay) { const key = ++id; timers.set(key, { callback, delay }); return key; },
        clearTimeout(key) { timers.delete(key); },
        setInterval(callback, delay) { const key = ++id; intervals.set(key, { callback, delay }); return key; },
        clearInterval(key) { intervals.delete(key); }
    };
    if (hybrid) {
        sandbox.Mp2Audio = { create(media, callbacks) {
            let resolveReady, rejectReady;
            const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
            const audio = { ready, resolveReady, rejectReady, callbacks, media,
                resumeCalls: 0, destroyCalls: 0, packets: [], origins: [], detected: false, aheadValue: 0,
                resume() { this.resumeCalls++; return Promise.resolve(); },
                push(packet) { this.packets.push(packet); this.detected = true; },
                setOrigin(value) { this.origins.push(value); },
                hasAudio() { return this.detected; },
                ahead() { return this.aheadValue; },
                destroy() { this.destroyCalls++; }
            };
            audioInstances.push(audio);
            return audio;
        } };
        sandbox.Mp2TsLoader = { createClass(onAudio, onTimestampBase) {
            class CustomLoader {}
            loaders.push({ onAudio, onTimestampBase, Class: CustomLoader });
            return CustomLoader;
        } };
    }
    const context = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'direct-mpegts.js'), 'utf8'), context);
    const callbacks = {
        onError: value => errors.push(value),
        onBuffering: value => buffering.push(value),
        onAutoplayBlocked: () => autoplayBlocked++
    };
    return {
        api: context.DirectMpegts, video, callbacks, instances, audioInstances, loaders,
        timers, intervals, listeners, errors, buffering,
        get autoplayBlocked() { return autoplayBlocked; },
        flush() { while (microtasks.length) microtasks.shift()(); },
        setRanges(value) { ranges = value; },
        emit(name) { listeners.get(name)?.(); },
        tick(ms = 500) {
            now += ms;
            for (const { callback } of [...intervals.values()]) callback();
        },
        retry() {
            const [key, timer] = [...timers][0];
            timers.delete(key);
            now += timer.delay;
            timer.callback();
            return timer.delay;
        },
        start(url = 'https://provider.example/live.ts') {
            const controller = context.DirectMpegts.create(video, url, callbacks);
            controller.start();
            return controller;
        }
    };
}

test('HTTPS page refuses HTTP source before constructing a transport, without proxy fallback', () => {
    const f = fixture();
    f.start('http://181.78.79.131:8000/play/a0q9');
    assert.equal(f.instances.length, 0);
    assert.equal(f.timers.size + f.intervals.size, 0);
    assert.match(f.errors[0], /HTTPS.*HTTP/);
});

test('direct MPEG-TS reads the exact provider URL with CORS and no cookies', () => {
    const f = fixture();
    const url = 'https://provider.example/live.ts?token=a%2Fb';
    f.start(url);
    const player = f.instances[0];
    assert.equal(player.source.url, url);
    assert.equal(player.source.type, 'mpegts');
    assert.equal(player.source.isLive, true);
    assert.equal(player.source.cors, true);
    assert.equal(player.source.withCredentials, false);
    assert.equal(player.video, f.video);
    assert.equal(player.loadCalls, 1);
    assert.equal(f.video.playbackRate, 1);
});

test('HTTP page can attempt the original HTTP stream without Render', () => {
    const f = fixture({ protocol: 'http:' });
    const url = 'http://181.78.79.131:8000/play/a0q9';
    f.start(url);
    assert.equal(f.instances[0].source.url, url);
    assert.deepEqual(f.errors, []);
});

test('waits for four seconds of forward buffer before playing', () => {
    const f = fixture();
    f.start();
    f.setRanges([[0, 3.9]]);
    f.emit('progress');
    assert.equal(f.video.playCalls, 0);
    f.setRanges([[0, 4]]);
    f.emit('canplay');
    assert.equal(f.video.playCalls, 1);
    f.emit('progress');
    assert.equal(f.video.playCalls, 1);
});

test('initial timestamps beyond zero start at the first buffered media range', () => {
    const f = fixture();
    f.start();
    f.setRanges([[1.5, 7]]);
    f.emit('progress');
    assert.equal(f.video.currentTime, 1.5);
    assert.equal(f.video.playCalls, 1);
    assert.equal(f.timers.size, 0);
});

test('refills after underflow without chasing latency or speeding up voices', () => {
    const f = fixture();
    f.start();
    f.setRanges([[0, 5]]);
    f.emit('progress');
    f.emit('playing');
    f.video.currentTime = 4.9;
    f.emit('waiting');
    assert.equal(f.video.paused, true);
    assert.equal(f.video.pauseCalls, 1);
    f.emit('progress');
    assert.equal(f.video.playCalls, 1);
    f.setRanges([[0, 9]]);
    f.tick();
    assert.equal(f.video.playCalls, 2);
    assert.equal(f.video.playbackRate, 1);
    assert.equal(f.instances[0].config.liveSync, false);
    assert.equal(f.instances[0].config.liveBufferLatencyChasing, false);
});

test('network errors retry at one, two and four seconds then stop', () => {
    const f = fixture();
    f.start();
    for (const expected of [1000, 2000, 4000]) {
        const player = f.instances.at(-1);
        player.events.error('network');
        f.flush();
        assert.equal(player.destroyCalls, 1);
        assert.equal(f.retry(), expected);
    }
    f.instances.at(-1).events.error('network');
    f.flush();
    assert.equal(f.instances.length, 4);
    assert.equal(f.timers.size + f.intervals.size, 0);
    assert.match(f.errors[0], /conexión directa/);
});

test('destroy cancels retries and listeners and ignores obsolete error events', () => {
    const f = fixture();
    const controller = f.start();
    const player = f.instances[0];
    player.events.error('network');
    f.flush();
    assert.equal(f.timers.size, 1);
    controller.destroy();
    controller.destroy();
    player.events.error('network');
    f.flush();
    assert.equal(f.timers.size + f.intervals.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(player.destroyCalls, 1);
    assert.equal(f.video.autoplay, true);
    assert.equal(f.video.playbackRate, 1);
});

test('a deliberate pause after playback does not trigger reconnection', () => {
    const f = fixture();
    f.start();
    f.setRanges([[0, 10]]);
    f.emit('progress');
    f.emit('playing');
    f.video.currentTime = 1;
    f.tick();
    f.video.pause();
    for (let i = 0; i < 120; i++) f.tick();
    assert.equal(f.instances.length, 1);
    assert.equal(f.timers.size, 0);
    assert.equal(f.video.playCalls, 1);
});

test('a stalled live source reconnects after twenty seconds without playable progress', () => {
    const f = fixture();
    f.start();
    f.tick(20001);
    assert.equal(f.timers.size, 1);
    assert.equal(f.instances[0].destroyCalls, 1);
    assert.equal(f.retry(), 1000);
    assert.equal(f.instances.length, 2);
});

test('sustained recovered playback restores the network retry budget', () => {
    const f = fixture();
    f.start();
    f.instances[0].events.error('network');
    f.flush();
    assert.equal(f.retry(), 1000);
    f.setRanges([[0, 30]]);
    f.emit('progress');
    f.emit('playing');
    for (let i = 1; i <= 33; i++) {
        f.video.currentTime = i / 2;
        f.tick();
    }
    f.instances[1].events.error('network');
    f.flush();
    assert.equal(f.retry(), 1000);
});

test('incompatible media reports its cause and releases transport without network retries', () => {
    const f = fixture();
    f.start();
    f.instances[0].events.error('media');
    f.flush();
    assert.match(f.errors[0], /formato de audio o video/);
    assert.equal(f.instances[0].destroyCalls, 1);
    assert.equal(f.timers.size + f.intervals.size, 0);
});

test('media callbacks finish their append stack before teardown clears internal controllers', () => {
    const f = fixture();
    f.start();
    const player = f.instances[0];
    player.events.error('media');
    // mpegts.js still uses its loading controller after emitting this callback.
    assert.equal(player.destroyCalls, 0);
    assert.deepEqual(f.errors, []);
    f.flush();
    assert.equal(player.destroyCalls, 1);
    assert.match(f.errors[0], /formato de audio o video/);
});

test('changing players while an error is queued ignores the obsolete error', () => {
    const f = fixture();
    const controller = f.start();
    const player = f.instances[0];
    player.events.error('media');
    controller.destroy();
    f.flush();
    assert.equal(player.destroyCalls, 1);
    assert.deepEqual(f.errors, []);
});

test('unsupported browsers fail before allocating media resources', () => {
    const f = fixture({ supported: false });
    f.start();
    assert.equal(f.instances.length, 0);
    assert.equal(f.listeners.size, 0);
    assert.match(f.errors[0], /navegador no admite MPEG-TS/);
});

test('a native video decode failure stops the direct stream and explains the limitation', () => {
    const f = fixture();
    f.start();
    f.video.error = { code: 3 };
    f.emit('error');
    f.flush();
    assert.equal(f.instances[0].destroyCalls, 1);
    assert.equal(f.timers.size, 0);
    assert.match(f.errors[0], /rechazó la decodificación del video original/);
});

test('autoplay rejection shows a user gesture prompt instead of retrying the stream', async () => {
    const f = fixture({ autoplayError: Object.assign(new Error(), { name: 'NotAllowedError' }) });
    f.start();
    f.setRanges([[0, 5]]);
    f.emit('progress');
    await Promise.resolve();
    assert.equal(f.autoplayBlocked, 1);
    assert.equal(f.instances.length, 1);
    assert.equal(f.timers.size, 0);
});

test('hybrid playback resumes WebAudio immediately but waits for WASM before starting the transport', async () => {
    const f = fixture({ hybrid: true });
    f.start();
    assert.equal(f.audioInstances.length, 1);
    const audio = f.audioInstances[0];
    assert.equal(audio.resumeCalls, 1);
    assert.equal(audio.media, f.video);
    assert.equal(f.instances.length, 0);
    assert.equal(f.loaders.length, 0);
    audio.resolveReady();
    await audio.ready;
    assert.equal(f.instances.length, 1);
    assert.equal(f.instances[0].config.customLoader, f.loaders[0].Class);
    assert.equal(f.instances[0].config.enableWorker, false);
    assert.equal(f.instances[0].config.lazyLoad, false);
});

test('hybrid playback starts only after four seconds of video and three seconds of decoded audio', async () => {
    const f = fixture({ hybrid: true });
    f.start();
    const audio = f.audioInstances[0];
    audio.resolveReady();
    await audio.ready;
    audio.detected = true;
    audio.aheadValue = 2.9;
    f.setRanges([[0, 5]]);
    f.emit('progress');
    assert.equal(f.video.playCalls, 0);
    audio.aheadValue = 3;
    f.setRanges([[0, 3.9]]);
    f.emit('progress');
    assert.equal(f.video.playCalls, 0);
    f.setRanges([[0, 4]]);
    f.emit('progress');
    assert.equal(f.video.playCalls, 1);
    assert.equal(f.video.playbackRate, 1);
});

test('the shared loader routes MPEG audio packets and the video timestamp origin to WebAudio', async () => {
    const f = fixture({ hybrid: true });
    f.start();
    const audio = f.audioInstances[0];
    audio.resolveReady();
    await audio.ready;
    const packet = { data: new Uint8Array([0xff, 0xfd]), pts: 123.5 };
    f.loaders[0].onTimestampBase(123);
    f.loaders[0].onAudio(packet);
    assert.deepEqual(audio.origins, [123]);
    assert.equal(audio.packets[0], packet);
    assert.equal(audio.hasAudio(), true);
});

test('destroy before WASM readiness releases audio and never creates a late player', async () => {
    const f = fixture({ hybrid: true });
    const controller = f.start();
    const audio = f.audioInstances[0];
    controller.destroy();
    assert.equal(audio.destroyCalls, 1);
    audio.resolveReady();
    await audio.ready;
    assert.equal(f.instances.length, 0);
    assert.equal(f.loaders.length, 0);
    assert.equal(f.timers.size + f.intervals.size, 0);
});

test('retry generation invalidates the previous loaders audio and timestamp callbacks', async () => {
    const f = fixture({ hybrid: true });
    f.start();
    const firstAudio = f.audioInstances[0];
    firstAudio.resolveReady();
    await firstAudio.ready;
    const oldLoader = f.loaders[0];
    f.instances[0].events.error('network');
    f.flush();
    assert.equal(firstAudio.destroyCalls, 1);
    assert.equal(f.retry(), 1000);
    const nextAudio = f.audioInstances[1];
    nextAudio.resolveReady();
    await nextAudio.ready;
    oldLoader.onTimestampBase(1000);
    oldLoader.onAudio({ data: new Uint8Array([1]), pts: 1000 });
    assert.deepEqual(firstAudio.origins, []);
    assert.deepEqual(nextAudio.origins, []);
    assert.deepEqual(nextAudio.packets, []);
    f.loaders[1].onTimestampBase(2000);
    assert.deepEqual(nextAudio.origins, [2000]);
});
