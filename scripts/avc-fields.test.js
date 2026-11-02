const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function writer() {
    let data = '';
    return {
        bits(value, count) { data += value.toString(2).padStart(count, '0'); return this; },
        ue(value) {
            const code = (value + 1).toString(2);
            data += '0'.repeat(code.length - 1) + code;
            return this;
        },
        se(value) { return this.ue(value > 0 ? value * 2 - 1 : -value * 2); },
        bytes(header) {
            data += '1';
            while (data.length % 8) data += '0';
            return new Uint8Array([header, ...data.match(/.{8}/g).map(value => parseInt(value, 2))]);
        }
    };
}

function avcc(nal) {
    const data = new Uint8Array(nal.length + 4);
    new DataView(data.buffer).setUint32(0, nal.length);
    data.set(nal, 4);
    return { type: nal[0] & 31, data };
}

function parameters({ frameOnly = false, profile = 100, frameNumBits = 4, separate = false,
    scaling = false, spsId = 0, ppsId = 0 } = {}) {
    const s = writer().bits(profile, 8).bits(0, 8).bits(40, 8).ue(spsId);
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135, 144].includes(profile)) {
        s.ue(separate ? 3 : 1);
        if (separate) s.bits(1, 1);
        s.ue(0).ue(0).bits(0, 1).bits(scaling ? 1 : 0, 1);
        if (scaling) {
            for (let list = 0; list < (separate ? 12 : 8); list++) {
                s.bits(list === 0 ? 1 : 0, 1);
                if (list === 0) for (let i = 0; i < 16; i++) s.se(0);
            }
        }
    }
    s.ue(frameNumBits - 4).ue(0).ue(0).ue(2).bits(0, 1).ue(119).ue(33).bits(frameOnly ? 1 : 0, 1);
    if (!frameOnly) s.bits(0, 1);
    s.bits(1, 1).bits(0, 1).bits(0, 1);
    const p = writer().ue(ppsId).ue(spsId).bits(0, 1).bits(0, 1);
    return { sps: avcc(s.bytes(0x67)), pps: avcc(p.bytes(0x68)) };
}

function sample({ frame = 1, bottom = false, field = true, frameOnly = false,
    frameNumBits = 4, ppsId = 0, separate = false, dts = 1000, pts = dts,
    keyframe = false, tag = 'original' } = {}) {
    const s = writer().ue(0).ue(keyframe ? 2 : 0).ue(ppsId);
    if (separate) s.bits(0, 2);
    s.bits(frame, frameNumBits);
    if (!frameOnly) {
        s.bits(field ? 1 : 0, 1);
        if (field) s.bits(bottom ? 1 : 0, 1);
    }
    const unit = avcc(s.bytes(keyframe ? 0x65 : 0x41));
    return { units: [unit], length: unit.data.length, dts, pts, cts: pts - dts,
        isKeyframe: keyframe, file_position: 123, tag };
}

function processor() {
    const context = vm.createContext({ Uint8Array, Map, Math });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'avc-fields.js'), 'utf8'), context);
    return context.AvcFields.create();
}

test('progressive SPS leaves the exact sample unchanged', () => {
    const process = processor();
    const meta = parameters({ frameOnly: true });
    const input = sample({ frameOnly: true });
    assert.equal(process(input, meta), input);
});

test('interlaced-capable SPS with frame pictures leaves samples unchanged', () => {
    const process = processor();
    const input = sample({ field: false });
    assert.equal(process(input, parameters()), input);
});

test('opposite fields of the same frame become one access unit without changing NAL bytes', () => {
    const process = processor();
    const meta = parameters();
    const top = sample({ dts: 1000, pts: 1100, keyframe: true });
    const bottom = sample({ bottom: true, dts: 1016, pts: 1116 });
    assert.equal(process(top, meta), null);
    const result = process(bottom, meta);
    assert.equal(result.units.length, 2);
    assert.equal(result.units[0], top.units[0]);
    assert.equal(result.units[1], bottom.units[0]);
    assert.equal(result.length, top.length + bottom.length);
    assert.equal(result.isKeyframe, true);
    assert.equal(result.dts, 1000);
    assert.equal(result.pts, 1100);
    assert.equal(result.cts, 100);
    assert.equal(result.file_position, top.file_position);
    assert.equal(result.tag, top.tag);
});

test('orphan fields are discarded until a matching opposite field arrives', () => {
    const process = processor();
    const meta = parameters();
    assert.equal(process(sample({ frame: 1 }), meta), null);
    const newest = sample({ frame: 2, dts: 1033 });
    assert.equal(process(newest, meta), null);
    const result = process(sample({ frame: 2, bottom: true, dts: 1050 }), meta);
    assert.equal(result.units[0], newest.units[0]);
});

test('two copies of the same field cannot form a frame', () => {
    const process = processor();
    const meta = parameters();
    assert.equal(process(sample(), meta), null);
    assert.equal(process(sample({ dts: 1016 }), meta), null);
});

test('fields more than 100 milliseconds apart are not paired', () => {
    const process = processor();
    const meta = parameters();
    assert.equal(process(sample({ dts: 1000 }), meta), null);
    assert.equal(process(sample({ bottom: true, dts: 1101 }), meta), null);
});

test('composition timestamps also constrain pairing and CTS stays consistent', () => {
    const process = processor();
    const meta = parameters();
    assert.equal(process(sample({ dts: 1000, pts: 1200 }), meta), null);
    assert.equal(process(sample({ bottom: true, dts: 1016, pts: 1500 }), meta), null);
    const paired = process(sample({ dts: 1033, pts: 1516 }), meta);
    assert.equal(paired.dts, 1016);
    assert.equal(paired.pts, 1500);
    assert.equal(paired.cts, 484);
});

test('SPS/PPS views respect byte offsets rather than reading unrelated backing-buffer bytes', () => {
    const process = processor();
    const meta = parameters();
    for (const name of ['sps', 'pps']) {
        const data = meta[name].data;
        const backing = new Uint8Array(data.length + 12).fill(0xaa);
        backing.set(data, 7);
        meta[name] = { type: meta[name].type, data: backing.subarray(7, 7 + data.length) };
    }
    assert.equal(process(sample(), meta), null);
    assert.equal(process(sample({ bottom: true, dts: 1016 }), meta).units.length, 2);
});

test('High profile scaling lists and separate colour planes do not shift field header parsing', () => {
    const process = processor();
    const meta = parameters({ separate: true, scaling: true, frameNumBits: 8 });
    assert.equal(process(sample({ frame: 129, frameNumBits: 8, separate: true }), meta), null);
    const result = process(sample({ frame: 129, frameNumBits: 8, separate: true, bottom: true, dts: 1016 }), meta);
    assert.equal(result.units.length, 2);
});

test('a changed SPS clears pending fields even when the parameter-set IDs are reused', () => {
    const process = processor();
    assert.equal(process(sample(), parameters()), null);
    assert.equal(process(sample({ frameNumBits: 8, bottom: true, dts: 1016 }), parameters({ frameNumBits: 8 })), null);
});

test('invalid or oversized parameter sets are bounded and leave the sample bytes intact', () => {
    const process = processor();
    const input = sample();
    assert.equal(process(input, { sps: avcc(new Uint8Array([0x67])) }), input);
    assert.equal(process(input, { sps: avcc(new Uint8Array(5000).fill(0x67)) }), input);
});
