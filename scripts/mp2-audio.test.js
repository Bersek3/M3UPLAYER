const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ delayedReady = false, results = [], missingContext = false } = {}) {
    const listeners = new Map();
    const intervals = new Map();
    const errors = [];
    const contexts = [];
    const decoders = [];
    let resolveReady;
    const decoderReady = delayedReady ? new Promise(resolve => { resolveReady = resolve; }) : Promise.resolve();
    function pcm(seconds = 1) {
        const samples = Math.round(seconds * 48000);
        return { samplesDecoded: samples, sampleRate: 48000,
            channelData: [new Float32Array(samples), new Float32Array(samples)], errors: [] };
    }
    class MPEGDecoder {
        constructor() { this.ready = decoderReady; this.decoded = []; this.freed = 0; decoders.push(this); }
        decode(data) { this.decoded.push(data); return results.length ? results.shift() : pcm(1); }
        free() { this.freed++; }
    }
    class AudioContext {
        constructor() {
            this.state = 'suspended'; this.currentTime = 0; this.destination = {};
            this.resumeCalls = 0; this.sources = []; this.buffers = [];
            contexts.push(this);
        }
        createGain() {
            this.gain = { gain: { value: 1 }, connect() {}, disconnect() { this.disconnected = true; } };
            return this.gain;
        }
        createBuffer(channels, samples, sampleRate) {
            const data = Array.from({ length: channels }, () => new Float32Array(samples));
            const buffer = { numberOfChannels: channels, length: samples, sampleRate,
                getChannelData(channel) { return data[channel]; } };
            this.buffers.push(buffer);
            return buffer;
        }
        createBufferSource() {
            const source = { playbackRate: { value: 1 },
                connect(target) { this.target = target; },
                disconnect() { this.disconnected = true; },
                start(time, offset, duration) { this.started = { time, offset, duration }; },
                stop() { this.stopped = true; }
            };
            this.sources.push(source);
            return source;
        }
        resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
    }
    const video = { currentTime: 0, paused: true, ended: false, seeking: false, playbackRate: 1,
        muted: false, volume: 1,
        addEventListener(name, fn) { listeners.set(name, fn); },
        removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); }
    };
    const sandbox = { Promise, Uint8Array, AudioContext: missingContext ? undefined : AudioContext,
        'mpg123-decoder': { MPEGDecoder },
        setInterval(fn) { const id = intervals.size + 1; intervals.set(id, fn); return id; },
        clearInterval(id) { intervals.delete(id); }
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'mp2-audio.js'), 'utf8'), context);
    const audio = context.Mp2Audio.create(video, { onError: message => errors.push(message) });
    return { audio, video, contexts, decoders, errors, intervals, listeners, pcm,
        resolveReady,
        emit(name) { listeners.get(name)?.(); },
        tick() { for (const fn of intervals.values()) fn(); },
        push(pts, data = new Uint8Array([1, 2, 3])) { audio.push({ data, pts }); }
    };
}

test('AudioContext resumes during the user gesture before decoder readiness', async () => {
    const f = fixture({ delayedReady: true });
    const resumed = f.audio.resume();
    assert.equal(f.contexts[0].resumeCalls, 1);
    f.push(100);
    assert.equal(f.audio.hasAudio(), true);
    assert.equal(f.decoders[0].decoded.length, 0);
    f.resolveReady();
    await f.audio.ready;
    await resumed;
    assert.equal(f.decoders[0].decoded.length, 1);
    f.audio.destroy();
});

test('PES timestamps align against video DTS origin and preserve an initial audio offset', async () => {
    const f = fixture();
    await f.audio.ready;
    await f.audio.resume();
    f.audio.setOrigin(100);
    f.video.currentTime = 0.1;
    f.video.paused = false;
    f.contexts[0].currentTime = 5;
    f.push(100.4);
    const source = f.contexts[0].sources[0];
    assert.ok(Math.abs(source.started.time - 5.3) < 0.00001);
    assert.ok(Math.abs(source.started.offset) < 0.00001);
    assert.equal(source.playbackRate.value, 1);
    assert.ok(source.started.duration <= 0.35);
    assert.ok(Math.abs(f.audio.ahead() - 1.3) < 0.00001);
    f.audio.destroy();
});

test('decoder residue keeps the first PES timestamp when a split frame produces output later', async () => {
    const f = fixture({ results: [{ samplesDecoded: 0, channelData: [], sampleRate: 48000 }] });
    await f.audio.ready;
    f.audio.setOrigin(100);
    f.push(100);
    assert.equal(f.audio.ahead(), 0);
    f.push(100.1);
    assert.equal(f.audio.ahead(), 1);
    f.audio.destroy();
});

test('pause stops scheduled sources and resume schedules remaining PCM without duplicate audio', async () => {
    const f = fixture();
    await f.audio.ready;
    await f.audio.resume();
    f.audio.setOrigin(100);
    f.video.paused = false;
    f.push(100);
    const old = f.contexts[0].sources[0];
    f.video.currentTime = 0.1;
    f.video.paused = true;
    f.emit('pause');
    assert.equal(old.stopped, true);
    assert.equal(old.disconnected, true);
    f.tick();
    assert.equal(f.contexts[0].sources.length, 1);
    f.video.currentTime = 0.3;
    f.video.paused = false;
    f.emit('playing');
    const resumed = f.contexts[0].sources[1];
    assert.ok(Math.abs(resumed.started.offset - 0.3) < 0.00001);
    assert.equal(resumed.playbackRate.value, 1);
    f.audio.destroy();
});

test('mute and volume controls also control decoded MP2 audio', async () => {
    const f = fixture();
    await f.audio.ready;
    f.video.volume = 0.4;
    f.emit('volumechange');
    assert.equal(f.contexts[0].gain.gain.value, 0.4);
    f.video.muted = true;
    f.emit('volumechange');
    assert.equal(f.contexts[0].gain.gain.value, 0);
    f.video.muted = false;
    f.emit('volumechange');
    assert.equal(f.contexts[0].gain.gain.value, 0.4);
    f.audio.destroy();
});

test('PCM beyond thirty seconds ahead is discarded rather than growing indefinitely while paused', async () => {
    const f = fixture();
    await f.audio.ready;
    f.audio.setOrigin(100);
    for (let second = 0; second < 100; second++) f.push(100 + second);
    assert.equal(f.audio.ahead(), 30);
    assert.ok(f.contexts[0].buffers.length <= 31);
    assert.equal(f.contexts[0].sources.length, 0);
    f.audio.destroy();
});

test('seek cancels old audio and reschedules at the new video time without time stretching', async () => {
    const f = fixture();
    await f.audio.ready;
    await f.audio.resume();
    f.audio.setOrigin(100);
    f.video.paused = false;
    f.push(100);
    f.push(101);
    const old = f.contexts[0].sources[0];
    f.video.seeking = true;
    f.emit('seeking');
    assert.equal(old.stopped, true);
    f.video.currentTime = 1.2;
    f.video.seeking = false;
    f.emit('seeked');
    const source = f.contexts[0].sources.at(-1);
    assert.ok(Math.abs(source.started.offset - 0.2) < 0.00001);
    assert.equal(source.playbackRate.value, 1);
    f.audio.destroy();
});

test('destroy releases timers, media listeners, decoder and AudioContext exactly once', async () => {
    const f = fixture();
    await f.audio.ready;
    await f.audio.resume();
    f.audio.setOrigin(100);
    f.video.paused = false;
    f.push(100);
    f.audio.destroy();
    f.audio.destroy();
    assert.equal(f.intervals.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.decoders[0].freed, 1);
    assert.equal(f.contexts[0].state, 'closed');
    assert.equal(f.contexts[0].sources[0].stopped, true);
    assert.equal(f.audio.ahead(), 0);
});

test('destroy before WASM readiness still frees decoder after initialization', async () => {
    const f = fixture({ delayedReady: true });
    f.audio.destroy();
    f.resolveReady();
    await f.audio.ready;
    assert.equal(f.decoders[0].freed, 1);
    assert.equal(f.contexts[0].state, 'closed');
});

test('missing WebAudio rejects ready and reports a useful audio error', async () => {
    const f = fixture({ missingContext: true });
    await assert.rejects(f.audio.ready);
    assert.match(f.errors[0], /audio MPEG/);
    f.audio.destroy();
});
