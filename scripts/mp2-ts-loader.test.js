const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TsProcessor, createClass, crc32 } = require('../mp2-ts-loader');

const join = (...parts) => Uint8Array.from(parts.flatMap(part => [...part]));
const idr = Uint8Array.from([0, 0, 1, 0x67, 0x64, 0, 0, 1, 0x68, 0xee, 0, 0, 1, 0x65, 0x88]);

function section(body) {
    const bytes = join(body, [0, 0, 0, 0]);
    bytes[1] = (bytes[1] & 0xf0) | ((bytes.length - 3) >> 8);
    bytes[2] = (bytes.length - 3) & 255;
    const crc = crc32(bytes.subarray(0, -4));
    bytes.set([crc >>> 24, crc >>> 16, crc >>> 8, crc], bytes.length - 4);
    return bytes;
}

function pat() {
    return section([0, 0xb0, 0, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0]);
}

function pmt(type = 3, programInfo = [], descriptors = []) {
    return section([2, 0xb0, 0, 0, 1, 0xc1, 0, 0, 0xe1, 1,
        0xf0 | (programInfo.length >> 8), programInfo.length & 255, ...programInfo,
        0x1b, 0xe1, 1, 0xf0, 0,
        type, 0xe1, 2, 0xf0 | (descriptors.length >> 8), descriptors.length & 255, ...descriptors]);
}

function packet(pid, data, start = false, cc = 0, corrupt = false, randomAccess = false) {
    assert.ok(data.length <= 184);
    const bytes = new Uint8Array(188).fill(0xff);
    bytes[0] = 0x47;
    bytes[1] = (pid >> 8) | (start ? 64 : 0) | (corrupt ? 128 : 0);
    bytes[2] = pid;
    if (data.length === 184) {
        bytes[3] = 0x10 | cc;
        bytes.set(data, 4);
    } else {
        bytes[3] = 0x30 | cc;
        bytes[4] = 183 - data.length;
        if (bytes[4]) bytes[5] = randomAccess ? 0x40 : 0;
        bytes.set(data, 5 + bytes[4]);
    }
    return bytes;
}

function payload(packet) {
    return packet.subarray((packet[3] & 32) ? 5 + packet[4] : 4);
}

function psiPackets(pid, bytes, first = 183) {
    const result = [packet(pid, join([0], bytes.subarray(0, first)), true)];
    for (let offset = first, cc = 1; offset < bytes.length; offset += 184, cc++) {
        result.push(packet(pid, bytes.subarray(offset, offset + 184), false, cc & 15));
    }
    return result;
}

function pts(value, prefix = 0x20) {
    return [prefix | ((Math.floor(value / 1073741824) & 7) << 1) | 1,
        Math.floor(value / 4194304) & 255, ((Math.floor(value / 32768) & 127) << 1) | 1,
        Math.floor(value / 128) & 255, ((value & 127) << 1) | 1];
}

function pes(data, time = 630000, videoDts = null) {
    const stamps = videoDts === null ? pts(time) : [...pts(time, 0x30), ...pts(videoDts, 0x10)];
    const length = 3 + stamps.length + data.length;
    return join([0, 0, 1, videoDts === null ? 0xc0 : 0xe0, length >> 8, length & 255,
        0x80, videoDts === null ? 0x80 : 0xc0, stamps.length, ...stamps], data);
}

function pesPackets(pid, bytes, initialCC = 0) {
    const output = [];
    for (let offset = 0, n = 0; offset < bytes.length; offset += 184, n++) {
        output.push(packet(pid, bytes.subarray(offset, offset + 184), offset === 0, (initialCC + n) & 15));
    }
    return output;
}

function setup() {
    const audio = [], bases = [], outputs = [];
    const processor = new TsProcessor(value => audio.push(value), value => bases.push(value), value => outputs.push(value));
    processor.push(join(...psiPackets(0, pat())));
    processor.push(join(...psiPackets(256, pmt())));
    outputs.length = 0;
    return { processor, audio, bases, outputs };
}

test('uses the MPEG-2 CRC-32 polynomial', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0x0376e6e7);
});

test('rewrites a multi-packet PMT with valid CRC while preserving video bytes', () => {
    const outputs = [];
    const processor = new TsProcessor(() => {}, () => {}, value => outputs.push(value));
    processor.push(join(...psiPackets(0, pat())));
    outputs.length = 0;
    const programInfo = [0x40, 180, ...new Array(180).fill(0x61)];
    const original = pmt(3, programInfo, [0x0a, 4, 0x65, 0x73, 0x70, 0]);
    const split = psiPackets(256, original, 9);
    processor.push(split[0]);
    assert.equal(outputs.length, 0, 'incomplete PMT is held before publishing');
    const video = packet(257, pes(idr, 990000, 900000), true);
    processor.push(join(...split.slice(1), video));
    const all = join(...outputs);
    const rewritten = join(...split.map((_, i) => payload(all.subarray(i * 188, (i + 1) * 188))).map((part, i) => i ? part : part.subarray(1)));
    const audioOffset = 12 + programInfo.length + 5;
    assert.equal(rewritten[audioOffset], 6);
    assert.equal(rewritten[audioOffset + 5], 0x42);
    assert.equal(crc32(rewritten), 0);
    assert.deepEqual(all.subarray(all.length - 188), video);
});

test('handles arbitrary network chunks and emits only a complete audio PES with its PTS', () => {
    const { processor, audio, outputs } = setup();
    const data = Uint8Array.from({ length: 700 }, (_, i) => i & 255);
    const transport = join(...pesPackets(258, pes(data)));
    for (let offset = 0; offset < transport.length; offset += 37) processor.push(transport.subarray(offset, offset + 37));
    processor.finish();
    assert.equal(audio.length, 1);
    assert.equal(audio[0].pts, 7);
    assert.deepEqual(audio[0].data, data);
    assert.deepEqual(join(...outputs), transport);
});

test('drops an incomplete PES after a continuity gap and resumes at the next start', () => {
    const { processor, audio } = setup();
    const broken = pesPackets(258, pes(new Uint8Array(500)));
    processor.push(join(broken[0], broken[2]));
    const intact = Uint8Array.from([0xff, 0xfd, 0x94, 0x04, 1, 2, 3]);
    processor.push(join(...pesPackets(258, pes(intact, 720000), 3)));
    assert.equal(audio.length, 1);
    assert.deepEqual(audio[0].data, intact);
    assert.equal(audio[0].pts, 8);
});

test('leaves AAC program tables unchanged', () => {
    const outputs = [], audio = [];
    const processor = new TsProcessor(value => audio.push(value), () => {}, value => outputs.push(value));
    const transport = join(...psiPackets(0, pat()), ...psiPackets(256, pmt(0x0f)));
    processor.push(transport);
    assert.deepEqual(join(...outputs), transport);
    assert.equal(audio.length, 0);
});

test('announces first video DTS once before handing video bytes to mpegts', () => {
    const { processor, bases } = setup();
    const video = pesPackets(257, pes(idr, 990000, 900000));
    processor.push(join(...video));
    processor.push(join(...pesPackets(257, pes(idr, 1080000, 990000), 1)));
    assert.deepEqual(bases, [10]);
});

test('suppresses initial non-IDR video using null TS and preserves the first configured IDR byte-for-byte', () => {
    const { processor, outputs, bases } = setup();
    const predictive = Uint8Array.from([0, 0, 1, 0x67, 0x64, 0, 0, 1, 0x68, 0xee, 0, 0, 1, 0x41, 0x88]);
    const early = join(...pesPackets(257, pes(predictive, 900000, 891000)));
    processor.push(early);
    assert.equal(bases.length, 0);
    const suppressed = join(...outputs);
    assert.equal(((suppressed[1] & 31) << 8) | suppressed[2], 0x1fff);
    outputs.length = 0;
    const accepted = join(...pesPackets(257, pes(idr, 1080000, 1071000), 1));
    processor.push(accepted);
    assert.deepEqual(join(...outputs), accepted);
    assert.deepEqual(bases, [11.9]);
});

test('waits for SPS, PPS and IDR in the same PES and scans NAL prefixes across packet boundaries', () => {
    const { processor, outputs, bases } = setup();
    const noConfig = join(...pesPackets(257, pes(Uint8Array.from([0, 0, 1, 0x65, 1]), 900000, 891000)));
    processor.push(noConfig);
    assert.equal(bases.length, 0);
    outputs.length = 0;
    const padded = join(new Uint8Array(162).fill(0x55), idr);
    const accepted = join(...pesPackets(257, pes(padded, 1080000, 1071000), 1));
    for (let offset = 0; offset < accepted.length; offset += 43) processor.push(accepted.subarray(offset, offset + 43));
    assert.deepEqual(join(...outputs), accepted);
    assert.deepEqual(bases, [11.9]);
});

test('aligns first audio/video timestamps to the same 33-bit rollover epoch', () => {
    const { processor } = setup();
    const wrap = 8589934592;
    assert.equal(processor.unwrap(wrap - 90000, 'audio'), (wrap - 90000) / 90000);
    assert.equal(processor.unwrap(90000, 'video'), (wrap + 90000) / 90000);
    assert.equal(processor.unwrap(180000, 'audio'), (wrap + 180000) / 90000);
});

test('accepts open-GOP non-IDR I slices only with SPS/PPS and a real random-access indicator', () => {
    for (const encodedSlice of [0xb8, 0x88]) { // first_mb=0; slice_type=2 or 7 (both I)
        const { processor, outputs, bases } = setup();
        const data = join(idr.subarray(0, 13), [0x41, encodedSlice]);
        const transport = packet(257, pes(data, 990000, 900000), true, 0, false, true);
        processor.push(transport);
        assert.deepEqual(join(...outputs), transport);
        assert.deepEqual(bases, [10]);
    }
});

test('does not treat P or B slices as random-access video even if the adaptation flag is set', () => {
    for (const encodedSlice of [0xc0, 0xa0]) { // first_mb=0; slice_type=0 (P) or 1 (B)
        const { processor, outputs, bases } = setup();
        const data = join(idr.subarray(0, 13), [0x41, encodedSlice]);
        processor.push(packet(257, pes(data, 990000, 900000), true, 0, false, true));
        assert.equal(bases.length, 0);
        const suppressed = join(...outputs);
        assert.equal(((suppressed[1] & 31) << 8) | suppressed[2], 0x1fff);
    }
});

test('does not accept an open-GOP I slice without the transport random-access flag', () => {
    const { processor, outputs, bases } = setup();
    const data = join(idr.subarray(0, 13), [0x41, 0xb8]);
    processor.push(packet(257, pes(data, 990000, 900000), true));
    assert.equal(bases.length, 0);
    const suppressed = join(...outputs);
    assert.equal(((suppressed[1] & 31) << 8) | suppressed[2], 0x1fff);
});

test('parses both Exp-Golomb slice header values across transport and network chunk boundaries', () => {
    const { processor, outputs, bases } = setup();
    // ue(255) + ue(7): first_mb_in_slice and I slice_type consume exactly 24 bits.
    const data = join(idr.subarray(0, 13), [0x41, 0x00, 0x80, 0x08]);
    const bytes = pes(data, 990000, 900000);
    const first = packet(257, bytes.subarray(0, 34), true, 0, false, true);
    const second = packet(257, bytes.subarray(34), false, 1);
    processor.push(first);
    assert.equal(bases.length, 0);
    assert.equal(outputs.length, 0);
    const transport = join(first, second);
    processor.push(second.subarray(0, 101));
    processor.push(second.subarray(101));
    assert.deepEqual(join(...outputs), transport);
    assert.deepEqual(bases, [10]);
});

test('fails clearly if no configured IDR arrives within the startup deadline', () => {
    const { processor } = setup();
    processor.videoWaitStarted = Date.now() - 16000;
    assert.throws(() => processor.push(join(...pesPackets(257, pes(idr, 990000, 900000)))), /15 segundos/);
});

test('rejects invalid PMT CRC before publishing that table', () => {
    const { processor, outputs } = setup();
    const bad = pmt(); bad[bad.length - 1] ^= 1;
    assert.throws(() => processor.push(packet(256, join([0], bad), true, 1)), /CRC/);
    assert.equal(outputs.length, 0);
});

test('custom loader performs one CORS fetch, exposes consistent offsets and cancels on destroy', async t => {
    const oldFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = oldFetch; });
    const calls = [];
    const bytes = join(...psiPackets(0, pat()), ...psiPackets(256, pmt()), ...pesPackets(258, pes(Uint8Array.from([1, 2, 3]))));
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(new ReadableStream({ start(controller) {
            controller.enqueue(bytes.subarray(0, 191));
            controller.enqueue(bytes.subarray(191));
            controller.close();
        } }));
    };
    const received = [], audio = [], errors = [];
    const Loader = createClass(value => audio.push(value));
    const loader = new Loader();
    loader.onDataArrival = (chunk, from, length) => received.push({ chunk, from, length });
    loader.onError = (type, info) => errors.push({ type, info });
    let completed = false;
    loader.onComplete = () => { completed = true; };
    await loader.open({ url: 'http://provider.example/live' }, { from: 0, to: -1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.mode, 'cors');
    assert.equal(calls[0].options.credentials, 'omit');
    assert.equal(received[0].from, 0);
    assert.equal(received.at(-1).length, bytes.length);
    assert.equal(received[1].from, received[0].chunk.byteLength);
    assert.equal(audio.length, 1);
    assert.deepEqual(errors, []);
    assert.equal(completed, true);
    assert.equal(loader.needStashBuffer, true);
    loader.destroy();
    assert.equal(calls[0].options.signal.aborted, true);
});
