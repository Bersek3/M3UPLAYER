(function (root) {
    'use strict';

    const PACKET_SIZE = 188;
    const MAX_SECTION = 1024;
    const MAX_PENDING_PACKETS = Math.floor(2 * 1024 * 1024 / PACKET_SIZE);
    const MAX_PES = 256 * 1024;
    const PTS_WRAP = 8589934592;

    function crc32(bytes) {
        let crc = 0xffffffff;
        for (const byte of bytes) {
            crc ^= byte << 24;
            for (let bit = 0; bit < 8; bit++) {
                crc = (crc & 0x80000000) ? (crc << 1) ^ 0x04c11db7 : crc << 1;
            }
        }
        return crc >>> 0;
    }

    function timestamp(bytes, offset) {
        if (offset + 5 > bytes.length || !(bytes[offset] & 1) ||
            !(bytes[offset + 2] & 1) || !(bytes[offset + 4] & 1)) return null;
        return ((bytes[offset] & 14) * 536870912 + bytes[offset + 1] * 4194304 +
            (bytes[offset + 2] & 254) * 16384 + bytes[offset + 3] * 128 +
            (bytes[offset + 4] >> 1));
    }

    function h264SliceType(bytes) {
        const rbsp = [];
        let zeros = 0;
        for (const byte of bytes) {
            if (zeros >= 2 && byte === 3) { zeros = 0; continue; }
            rbsp.push(byte);
            zeros = byte === 0 ? zeros + 1 : 0;
        }
        let position = 0;
        const bit = () => (rbsp[position >> 3] >> (7 - (position++ & 7))) & 1;
        function ue() {
            let leading = 0;
            while (true) {
                if (position >= rbsp.length * 8) return undefined;
                if (bit()) break;
                if (++leading > 31) return null;
            }
            if (position + leading > rbsp.length * 8) return undefined;
            let value = 1;
            for (let i = 0; i < leading; i++) value = value * 2 + bit();
            return value - 1;
        }
        const firstMb = ue();
        if (firstMb === undefined || firstMb === null) return firstMb;
        const type = ue();
        if (type === undefined || type === null) return type;
        return type <= 9 ? type % 5 : null;
    }

    class TsProcessor {
        constructor(onAudio, onTimestampBase, onPackets) {
            this.onAudio = onAudio;
            this.onTimestampBase = onTimestampBase;
            this.onPackets = onPackets;
            this.tail = new Uint8Array(0);
            this.pending = [];
            this.sections = new Map();
            this.psiContinuity = new Map();
            this.pmtPid = null;
            this.program = null;
            this.audioPid = null;
            this.videoPid = null;
            this.videoType = null;
            this.videoGateOpen = false;
            this.videoCandidate = null;
            this.videoContinuity = null;
            this.videoWaitStarted = null;
            this.audioContinuity = null;
            this.pes = null;
            this.videoHeader = null;
            this.timestampSent = false;
            this.clock = {};
        }

        push(chunk) {
            if (!(chunk instanceof Uint8Array)) chunk = new Uint8Array(chunk);
            if (chunk.length > 4 * 1024 * 1024) throw new Error('Bloque de transporte MPEG-TS demasiado grande.');
            const bytes = new Uint8Array(this.tail.length + chunk.length);
            bytes.set(this.tail);
            bytes.set(chunk, this.tail.length);
            let offset = 0;
            const ready = [];
            while (offset + PACKET_SIZE <= bytes.length) {
                // Dropping transport bytes would invalidate byte offsets and can hide damage.
                if (bytes[offset] !== 0x47) throw new Error('La señal no contiene paquetes MPEG-TS de 188 bytes alineados.');
                const packet = bytes.slice(offset, offset + PACKET_SIZE);
                offset += PACKET_SIZE;
                this.pending.push(packet);
                this.packet(packet);
                if (this.pending.length > MAX_PENDING_PACKETS) {
                    throw new Error('La tabla o el fotograma inicial MPEG-TS excedieron el límite de 2 MB.');
                }
                if (this.sections.size === 0) {
                    const blocked = this.videoCandidate
                        ? this.pending.indexOf(this.videoCandidate.packets[0]) : -1;
                    const count = blocked < 0 ? this.pending.length : blocked;
                    ready.push(...this.pending.splice(0, count));
                }
            }
            this.tail = bytes.slice(offset);
            if (ready.length) {
                const output = new Uint8Array(ready.length * PACKET_SIZE);
                ready.forEach((packet, i) => output.set(packet, i * PACKET_SIZE));
                this.onPackets(output);
            }
        }

        finish() {
            if (this.tail.length || this.sections.size) throw new Error('La fuente cerró con un paquete o tabla MPEG-TS incompletos.');
            if (this.videoCandidate) throw new Error('La fuente cerró antes de entregar un fotograma de acceso completo con SPS/PPS.');
            // Audio with an explicit PES size is dispatched as soon as complete.
            // A size-zero PES is delimited by the next start indicator, not a truncated EOF.
            this.pes = null;
        }

        packet(packet) {
            const pid = ((packet[1] & 31) << 8) | packet[2];
            const start = !!(packet[1] & 64);
            const bad = !!(packet[1] & 128);
            const scrambled = !!(packet[3] & 192);
            const control = (packet[3] >> 4) & 3;
            const cc = packet[3] & 15;
            if (control === 0) throw new Error('Paquete MPEG-TS con encabezado inválido.');
            let offset = 4;
            let discontinuity = false;
            let randomAccess = false;
            if (control & 2) {
                const length = packet[offset++];
                if (offset + length > PACKET_SIZE) throw new Error('Campo de adaptación MPEG-TS inválido.');
                discontinuity = length > 0 && !!(packet[offset] & 128);
                randomAccess = length > 0 && !!(packet[offset] & 64);
                offset += length;
            }
            const psi = pid === 0 || pid === this.pmtPid;
            if (psi && (bad || scrambled)) throw new Error('La tabla de programa MPEG-TS llegó dañada o cifrada.');
            if (pid === this.audioPid && (bad || scrambled || discontinuity)) {
                this.pes = null;
                this.audioContinuity = null;
            }
            if (!(control & 1) || offset === PACKET_SIZE) return;
            if (psi) {
                const previous = this.psiContinuity.get(pid);
                if (previous === cc && !discontinuity) {
                    // A duplicate PMT must be rewritten too; fail rather than leak its old audio codec.
                    throw new Error('La tabla MPEG-TS contiene un paquete duplicado; vuelve a conectar la señal.');
                }
                if (previous !== undefined && !discontinuity && cc !== ((previous + 1) & 15)) {
                    if (this.sections.has(pid)) throw new Error('Se perdieron paquetes de una tabla MPEG-TS.');
                }
                if (discontinuity && this.sections.has(pid)) throw new Error('La tabla MPEG-TS se interrumpió antes de completarse.');
                this.psiContinuity.set(pid, cc);
                this.psi(packet, offset, pid, start);
            }
            if (pid === this.audioPid && !bad && !scrambled) {
                this.audio(packet.subarray(offset), start, cc, discontinuity);
            }
            if (pid === this.videoPid && !this.timestampSent) {
                if (bad || scrambled) { this.rejectVideoCandidate(); this.nullPacket(packet); }
                else if (this.videoType === 0x1b) this.gateVideo(packet, packet.subarray(offset), start, cc, discontinuity, randomAccess);
                else this.video(packet.subarray(offset), start);
            }
        }

        psi(packet, offset, pid, start) {
            if (start) {
                const pointer = packet[offset++];
                if (offset + pointer > PACKET_SIZE) throw new Error('Puntero PSI MPEG-TS inválido.');
                const nextSection = offset + pointer;
                if (this.sections.has(pid)) {
                    this.sectionBytes(packet, offset, nextSection, pid);
                    if (this.sections.has(pid)) throw new Error('Se interrumpió una sección PSI MPEG-TS.');
                }
                offset = nextSection;
            } else if (!this.sections.has(pid)) {
                // Joined mid-section: no table can be decoded until its next start indicator.
                return;
            }
            while (offset < PACKET_SIZE) {
                if (!this.sections.has(pid)) {
                    if (packet[offset] === 0xff) break;
                    this.sections.set(pid, { bytes: [], refs: [], expected: null });
                }
                const consumed = this.sectionBytes(packet, offset, PACKET_SIZE, pid);
                offset += consumed;
                if (!consumed) break;
            }
        }

        sectionBytes(packet, offset, end, pid) {
            const state = this.sections.get(pid);
            if (!state) return 0;
            const initial = offset;
            while (offset < end) {
                state.bytes.push(packet[offset]);
                state.refs.push([packet, offset++]);
                if (state.bytes.length === 3) {
                    state.expected = 3 + (((state.bytes[1] & 15) << 8) | state.bytes[2]);
                    if (state.expected < 12 || state.expected > MAX_SECTION) {
                        throw new Error('Sección PSI MPEG-TS demasiado grande o inválida.');
                    }
                }
                if (state.expected && state.bytes.length === state.expected) {
                    const bytes = Uint8Array.from(state.bytes);
                    this.table(bytes, pid);
                    state.refs.forEach(([target, index], i) => { target[index] = bytes[i]; });
                    this.sections.delete(pid);
                    break;
                }
            }
            return offset - initial;
        }

        table(section, pid) {
            if (!(section[1] & 128) || crc32(section) !== 0) throw new Error('La tabla MPEG-TS no pasó la comprobación CRC.');
            if (!(section[5] & 1)) return; // Future table, not active yet.
            if (section[6] !== 0 || section[7] !== 0) {
                throw new Error('Este reproductor directo admite tablas PAT/PMT de una sección.');
            }
            const end = section.length - 4;
            if (pid === 0) {
                if (section[0] !== 0) throw new Error('La tabla PAT MPEG-TS no es válida.');
                const programs = [];
                for (let i = 8; i < end; i += 4) {
                    if (i + 4 > end) throw new Error('La tabla PAT MPEG-TS está truncada.');
                    const program = (section[i] << 8) | section[i + 1];
                    if (program) programs.push({ program, pid: ((section[i + 2] & 31) << 8) | section[i + 3] });
                }
                if (programs.length !== 1) throw new Error('Este reproductor directo requiere una señal MPEG-TS de un solo programa.');
                if (this.pmtPid !== null && this.pmtPid !== programs[0].pid) {
                    throw new Error('El programa de la señal cambió; vuelve a conectar.');
                }
                this.program = programs[0].program;
                this.pmtPid = programs[0].pid;
                return;
            }
            if (section[0] !== 2 || section.length < 16 || ((section[3] << 8) | section[4]) !== this.program) {
                throw new Error('La tabla PMT MPEG-TS no corresponde al programa.');
            }
            let offset = 12 + (((section[10] & 15) << 8) | section[11]);
            if (offset > end) throw new Error('Descriptores de programa MPEG-TS inválidos.');
            let firstAudio = null;
            let firstVideo = null;
            let videoType = null;
            while (offset < end) {
                if (offset + 5 > end) throw new Error('La tabla de pistas MPEG-TS está truncada.');
                const type = section[offset];
                const elementaryPid = ((section[offset + 1] & 31) << 8) | section[offset + 2];
                const infoEnd = offset + 5 + (((section[offset + 3] & 15) << 8) | section[offset + 4]);
                if (infoEnd > end) throw new Error('Descriptor de pista MPEG-TS inválido.');
                if ([0x1b, 0x24].includes(type) && firstVideo === null) {
                    firstVideo = elementaryPid;
                    videoType = type;
                }
                if (type === 3 || type === 4) {
                    if (firstAudio === null) firstAudio = elementaryPid;
                    section[offset] = 6;
                    // Turn MP2 descriptors into stuffing descriptors without changing section size.
                    for (let d = offset + 5; d < infoEnd;) {
                        if (d + 2 > infoEnd || d + 2 + section[d + 1] > infoEnd) throw new Error('Descriptor de audio MPEG-TS inválido.');
                        const length = section[d + 1];
                        section[d] = 0x42;
                        section.fill(0xff, d + 2, d + 2 + length);
                        d += 2 + length;
                    }
                }
                offset = infoEnd;
            }
            if (this.audioPid !== firstAudio) {
                this.pes = null;
                this.audioContinuity = null;
                this.audioPid = firstAudio;
            }
            this.videoPid = firstVideo;
            this.videoType = videoType;
            const crc = crc32(section.subarray(0, end));
            section[end] = crc >>> 24;
            section[end + 1] = crc >>> 16;
            section[end + 2] = crc >>> 8;
            section[end + 3] = crc;
        }

        unwrap(raw, kind) {
            const other = this.clock[kind === 'audio' ? 'video' : 'audio'];
            const clock = this.clock[kind] || { last: raw, epoch: other
                ? Math.round((other.last + other.epoch - raw) / PTS_WRAP) * PTS_WRAP : 0 };
            if (raw - clock.last < -PTS_WRAP / 2) clock.epoch += PTS_WRAP;
            else if (raw - clock.last > PTS_WRAP / 2) clock.epoch -= PTS_WRAP;
            clock.last = raw;
            this.clock[kind] = clock;
            return (raw + clock.epoch) / 90000;
        }

        audio(payload, start, cc, discontinuity) {
            if (this.audioContinuity === cc && !discontinuity) return;
            const gap = this.audioContinuity !== null && cc !== ((this.audioContinuity + 1) & 15);
            this.audioContinuity = cc;
            if (gap || discontinuity) this.pes = null;
            if (start) {
                if (this.pes && this.pes.expected === 0) this.deliverAudio(this.pes);
                this.pes = { bytes: new Uint8Array(4096), length: 0, expected: null };
            }
            if (!this.pes) return;
            const state = this.pes;
            if (state.length + payload.length > MAX_PES) { this.pes = null; return; }
            if (state.length + payload.length > state.bytes.length) {
                const next = new Uint8Array(Math.min(MAX_PES, Math.max(state.bytes.length * 2, state.length + payload.length)));
                next.set(state.bytes.subarray(0, state.length));
                state.bytes = next;
            }
            state.bytes.set(payload, state.length);
            state.length += payload.length;
            if (state.expected === null && state.length >= 6) {
                if (state.bytes[0] || state.bytes[1] || state.bytes[2] !== 1 || (state.bytes[3] & 0xe0) !== 0xc0) {
                    this.pes = null;
                    return;
                }
                const length = (state.bytes[4] << 8) | state.bytes[5];
                state.expected = length ? length + 6 : 0;
            }
            if (state.expected && state.length >= state.expected) {
                this.deliverAudio(state);
                this.pes = null;
            }
        }

        deliverAudio(state) {
            const bytes = state.bytes.subarray(0, state.expected || state.length);
            if (bytes.length < 14 || (bytes[6] & 0xc0) !== 0x80 || !(bytes[7] & 128)) return;
            const offset = 9 + bytes[8];
            if (bytes[8] < 5 || offset >= bytes.length) return;
            const pts = timestamp(bytes, 9);
            if (pts === null) return;
            this.onAudio({ data: bytes.slice(offset), pts: this.unwrap(pts, 'audio') });
        }

        nullPacket(packet) {
            const cc = packet[3] & 15;
            packet.fill(0xff);
            packet.set([0x47, 0x1f, 0xff, 0x10 | cc]);
        }

        rejectVideoCandidate() {
            if (this.videoCandidate) this.videoCandidate.packets.forEach(packet => this.nullPacket(packet));
            this.videoCandidate = null;
        }

        acceptVideoCandidate(candidate) {
            this.videoGateOpen = true;
            this.timestampSent = true;
            this.videoCandidate = null;
            this.onTimestampBase(candidate.dts);
        }

        gateVideo(packet, payload, start, cc, discontinuity, randomAccess) {
            if (this.videoWaitStarted === null) this.videoWaitStarted = Date.now();
            if (Date.now() - this.videoWaitStarted > 15000) {
                throw new Error('No llegó un fotograma de acceso H.264 completo con SPS/PPS en 15 segundos.');
            }
            const previous = this.videoContinuity;
            this.videoContinuity = cc;
            if (previous === cc && !discontinuity) { this.nullPacket(packet); return; }
            if (discontinuity || (previous !== null && cc !== ((previous + 1) & 15))) this.rejectVideoCandidate();
            if (start) {
                this.rejectVideoCandidate();
                this.videoCandidate = { packets: [], header: [], headerSize: 9, headerDone: false,
                    dts: null, zeros: 0, nalHeader: false, sps: false, pps: false,
                    randomAccess, slice: null };
            }
            const candidate = this.videoCandidate;
            if (!candidate) { this.nullPacket(packet); return; }
            candidate.packets.push(packet);
            let offset = 0;
            while (!candidate.headerDone && offset < payload.length) {
                candidate.header.push(payload[offset++]);
                if (candidate.header.length === 9) {
                    const header = candidate.header;
                    if (header[0] || header[1] || header[2] !== 1 || (header[3] & 0xf0) !== 0xe0 ||
                        (header[6] & 0xc0) !== 0x80) { this.rejectVideoCandidate(); return; }
                    candidate.headerSize = 9 + header[8];
                }
                if (candidate.header.length === candidate.headerSize) {
                    const flags = candidate.header[7] >> 6;
                    const at = flags === 3 ? 14 : 9;
                    if (flags < 2 || candidate.header[8] < (flags === 3 ? 10 : 5)) {
                        this.rejectVideoCandidate(); return;
                    }
                    const raw = timestamp(candidate.header, at);
                    if (raw === null) { this.rejectVideoCandidate(); return; }
                    candidate.dts = this.unwrap(raw, 'video');
                    candidate.headerDone = true;
                }
            }
            for (; offset < payload.length; offset++) {
                const byte = payload[offset];
                if (candidate.slice !== null) {
                    candidate.slice.push(byte);
                    const sliceType = h264SliceType(candidate.slice);
                    if (sliceType === undefined && candidate.slice.length < 32) continue;
                    if (sliceType === 2) this.acceptVideoCandidate(candidate);
                    else this.rejectVideoCandidate();
                    return;
                }
                if (candidate.nalHeader) {
                    candidate.nalHeader = false;
                    const type = byte & 31;
                    if (type === 7) candidate.sps = true;
                    if (type === 8) candidate.pps = true;
                    if (type >= 1 && type <= 5) {
                        if (!candidate.sps || !candidate.pps) {
                            this.rejectVideoCandidate();
                            return;
                        }
                        if (type === 5) {
                            this.acceptVideoCandidate(candidate);
                            return;
                        }
                        // Open-GOP broadcast streams can use non-IDR I slices with a real
                        // random_access_indicator. Parse the slice; never relabel P/B as IDR.
                        if (type === 1 && candidate.randomAccess) candidate.slice = [];
                        else { this.rejectVideoCandidate(); return; }
                    }
                }
                if (byte === 1 && candidate.zeros >= 2) {
                    candidate.nalHeader = true;
                    candidate.zeros = 0;
                } else candidate.zeros = byte === 0 ? Math.min(3, candidate.zeros + 1) : 0;
            }
        }

        video(payload, start) {
            if (start) this.videoHeader = new Uint8Array(0);
            if (!this.videoHeader) return;
            const header = new Uint8Array(Math.min(32, this.videoHeader.length + payload.length));
            header.set(this.videoHeader);
            header.set(payload.subarray(0, header.length - this.videoHeader.length), this.videoHeader.length);
            this.videoHeader = header;
            if (header.length < 9) return;
            if (header[0] || header[1] || header[2] !== 1 || (header[3] & 0xf0) !== 0xe0 || (header[6] & 0xc0) !== 0x80) {
                this.videoHeader = null;
                return;
            }
            const flags = header[7] >> 6;
            const at = flags === 3 ? 14 : 9;
            if (flags < 2 || header[8] < (flags === 3 ? 10 : 5)) { this.videoHeader = null; return; }
            if (header.length < at + 5) return;
            const dts = timestamp(header, at);
            if (dts !== null) {
                this.timestampSent = true;
                this.onTimestampBase(this.unwrap(dts, 'video'));
            }
            this.videoHeader = null;
        }
    }

    function createClass(onAudio, onTimestampBase = () => {}) {
        return class Mp2Loader {
            constructor() {
                this._status = 0;
                this._aborted = false;
                this._controller = null;
                this._received = 0;
                this._reader = null;
                this.onContentLengthKnown = this.onURLRedirect = this.onDataArrival = this.onError = this.onComplete = null;
            }
            static isSupported() { return typeof root.fetch === 'function' && typeof root.AbortController === 'function'; }
            get type() { return 'mp2-ts-fetch-loader'; }
            get status() { return this._status; }
            get needStashBuffer() { return true; }
            isWorking() { return this._status === 1 || this._status === 2; }
            open(source, range = { from: 0, to: -1 }) {
                this._aborted = false;
                this._received = 0;
                this._status = 1;
                if (range.from !== 0 || (range.to !== undefined && range.to !== -1)) {
                    this.error('Exception', 'La señal MPEG-TS continua no admite búsqueda por rango.');
                    return;
                }
                this._controller = new root.AbortController();
                const processor = new TsProcessor(
                    audio => { if (!this._aborted) onAudio(audio); },
                    time => { if (!this._aborted) onTimestampBase(time); },
                    bytes => {
                        if (this._aborted) return;
                        const byteStart = this._received;
                        this._received += bytes.length;
                        if (this.onDataArrival) this.onDataArrival(bytes.buffer, byteStart, this._received);
                    });
                return this.run(source, processor).catch(error => {
                    if (!this._aborted && this._status !== 3) this.error('Exception', error.message || 'No se pudo leer la señal MPEG-TS.');
                });
            }
            async run(source, processor) {
                const response = await root.fetch(source.url, { method: 'GET', mode: 'cors', credentials: 'omit',
                    cache: 'no-store', referrerPolicy: 'no-referrer', signal: this._controller.signal });
                if (this._aborted) { if (response.body) await response.body.cancel(); return; }
                if (!response.ok || !response.body) {
                    if (response.body) await response.body.cancel();
                    this.error('HttpStatusCodeInvalid', 'El origen respondió HTTP ' + response.status, response.status);
                    return;
                }
                if (response.url && response.url !== source.url && this.onURLRedirect) this.onURLRedirect(response.url);
                const length = Number(response.headers.get('Content-Length'));
                if (Number.isSafeInteger(length) && length > 0 && this.onContentLengthKnown) this.onContentLengthKnown(length);
                const reader = this._reader = response.body.getReader();
                this._status = 2;
                while (!this._aborted) {
                    const next = await reader.read();
                    if (this._aborted) return;
                    if (next.done) {
                        processor.finish();
                        this._status = 4;
                        if (this.onComplete) this.onComplete(0, this._received - 1);
                        return;
                    }
                    processor.push(next.value);
                }
            }
            error(type, message, code = -1) {
                this._status = 3;
                this._controller?.abort();
                if (this._reader) this._reader.cancel().catch(() => {});
                if (this.onError) this.onError(type, { code, msg: message });
            }
            abort() {
                this._aborted = true;
                this._controller?.abort();
                if (this._reader) this._reader.cancel().catch(() => {});
                this._status = 0;
            }
            destroy() {
                this.abort();
                this.onContentLengthKnown = this.onURLRedirect = this.onDataArrival = this.onError = this.onComplete = null;
            }
        };
    }

    root.Mp2TsLoader = Object.freeze({ createClass });
    if (typeof module === 'object' && module.exports) module.exports = { createClass, TsProcessor, crc32 };
})(globalThis);
