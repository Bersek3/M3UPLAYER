(function (root) {
    'use strict';

    // Read only the bounded header prefixes needed to identify PAFF field pairs.
    // The actual NAL payloads are never changed or decoded here.
    function nalBytes(value) {
        const bytes = value?.data || value;
        if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Missing NAL');
        if (bytes.length >= 5) {
            const length = (bytes[0] * 0x1000000) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
            if (length > 0 && length <= bytes.length - 4) return bytes.subarray(4, 4 + length);
        }
        return bytes;
    }

    function reader(nal, limit = 4096) {
        const bytes = [];
        let zeros = 0;
        for (let i = 1; i < nal.length && bytes.length < limit; i++) {
            const value = nal[i];
            if (zeros >= 2 && value === 3) { zeros = 0; continue; }
            bytes.push(value);
            zeros = value === 0 ? zeros + 1 : 0;
        }
        let position = 0;
        function bits(count) {
            if (count < 0 || count > 32 || position + count > bytes.length * 8) throw new Error('Truncated header');
            let result = 0;
            while (count--) {
                result = result * 2 + ((bytes[position >> 3] >> (7 - (position & 7))) & 1);
                position++;
            }
            return result;
        }
        function ue(max = 0x100000) {
            let zeros = 0;
            while (bits(1) === 0) if (++zeros > 20) throw new Error('Invalid Golomb value');
            const value = Math.pow(2, zeros) - 1 + bits(zeros);
            if (value > max) throw new Error('Header limit exceeded');
            return value;
        }
        function se() { const value = ue(); return value & 1 ? (value + 1) / 2 : -value / 2; }
        return { bits, ue, se };
    }

    function parseSps(nal) {
        if ((nal[0] & 31) !== 7 || nal.length > 4096) throw new Error('Invalid SPS');
        const r = reader(nal);
        const profile = r.bits(8);
        r.bits(8); // Constraint flags.
        r.bits(8); // Level.
        const id = r.ue(31);
        let separateColourPlane = false;
        if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135, 144].includes(profile)) {
            const chroma = r.ue(3);
            if (chroma === 3) separateColourPlane = !!r.bits(1);
            r.ue(6); r.ue(6); // Bit depths minus eight.
            r.bits(1);
            if (r.bits(1)) {
                for (let list = 0; list < (chroma === 3 ? 12 : 8); list++) {
                    if (!r.bits(1)) continue;
                    let last = 8, next = 8;
                    for (let i = 0; i < (list < 6 ? 16 : 64); i++) {
                        if (next !== 0) next = (last + r.se() + 256) % 256;
                        if (next !== 0) last = next;
                    }
                }
            }
        } else if (![66, 77, 88].includes(profile)) throw new Error('Unsupported SPS profile');
        const frameNumBits = r.ue(12) + 4;
        const orderType = r.ue(2);
        if (orderType === 0) r.ue(12);
        else if (orderType === 1) {
            r.bits(1); r.se(); r.se();
            const cycle = r.ue(255);
            for (let i = 0; i < cycle; i++) r.se();
        }
        r.ue(32); r.bits(1); // Reference frames, gaps flag.
        r.ue(65535); r.ue(65535); // Picture dimensions in macroblocks.
        return { id, frameNumBits, separateColourPlane, frameOnly: !!r.bits(1) };
    }

    function parsePps(nal) {
        if ((nal[0] & 31) !== 8 || nal.length > 4096) throw new Error('Invalid PPS');
        const r = reader(nal);
        return { id: r.ue(255), spsId: r.ue(31) };
    }

    function signature(nal) {
        let result = '';
        for (const value of nal) result += value.toString(16).padStart(2, '0');
        return result;
    }

    function create() {
        const sps = new Map();
        const pps = new Map();
        let pending = null;

        function parameter(value, type) {
            const nal = nalBytes(value);
            if (nal.length > 4096) throw new Error('Parameter set too large');
            const key = signature(nal);
            const map = type === 7 ? sps : pps;
            const parsed = type === 7 ? parseSps(nal) : parsePps(nal);
            const previous = map.get(parsed.id);
            if (previous?.key === key) return;
            if (previous) pending = null;
            map.set(parsed.id, { ...parsed, key });
        }

        function slice(unit) {
            const nal = nalBytes(unit);
            const type = nal[0] & 31;
            if (type !== 1 && type !== 5) return null;
            const r = reader(nal, 256);
            r.ue(); // first_mb_in_slice
            r.ue(9); // slice_type
            const ppsId = r.ue(255);
            const picture = pps.get(ppsId);
            const sequence = picture && sps.get(picture.spsId);
            if (!sequence) throw new Error('Missing parameter sets');
            if (sequence.separateColourPlane) r.bits(2);
            const frameNum = r.bits(sequence.frameNumBits);
            const field = !sequence.frameOnly && !!r.bits(1);
            return { frameNum, ppsId, field, bottom: field ? !!r.bits(1) : false };
        }

        return function process(sample, metadata = {}) {
            if (!sample || !Array.isArray(sample.units)) return sample;
            try {
                if (sample.units.length > 512) throw new Error('Too many slices');
                if (metadata.sps) parameter(metadata.sps, 7);
                if (metadata.pps) parameter(metadata.pps, 8);
                for (const unit of sample.units) {
                    if (unit.type === 7 || unit.type === 8) parameter(unit, unit.type);
                }
                let picture = null;
                for (const unit of sample.units) {
                    if (unit.type !== 1 && unit.type !== 5) continue;
                    const info = slice(unit);
                    if (!info) continue;
                    if (picture && (picture.frameNum !== info.frameNum || picture.ppsId !== info.ppsId ||
                        picture.field !== info.field || picture.bottom !== info.bottom)) {
                        // Already contains multiple pictures: preserve the original grouping.
                        pending = null;
                        return sample;
                    }
                    picture = info;
                }
                if (!picture || !picture.field) { pending = null; return sample; }
                if (!Number.isFinite(sample.dts) || !Number.isFinite(sample.pts)) { pending = null; return null; }
                const match = pending && pending.picture.frameNum === picture.frameNum &&
                    pending.picture.ppsId === picture.ppsId && pending.picture.bottom !== picture.bottom &&
                    Math.abs(pending.sample.dts - sample.dts) <= 100 && Math.abs(pending.sample.pts - sample.pts) <= 100;
                if (!match) { pending = { sample, picture }; return null; }
                const first = pending.sample;
                pending = null;
                const length = first.length + sample.length;
                if (!Number.isFinite(length) || length > 16 * 1024 * 1024) return null;
                const dts = Math.min(first.dts, sample.dts);
                const pts = Math.min(first.pts, sample.pts);
                return { ...first, units: first.units.concat(sample.units), length,
                    isKeyframe: first.isKeyframe || sample.isKeyframe, dts, pts, cts: pts - dts };
            } catch {
                pending = null;
                // Unknown profiles or malformed headers must not rewrite their NAL data.
                return sample;
            }
        };
    }

    root.AvcFields = Object.freeze({ create });
})(globalThis);
