(function (root) {
    'use strict';

    function create(video, options = {}) {
        let context = null;
        let decoder = null;
        let gain = null;
        let destroyed = false;
        let failed = false;
        let decoderReady = false;
        let detected = false;
        let origin = null;
        let nextTimestamp = null;
        let scheduledThrough = null;
        let anchor = null;
        let pendingBytes = 0;
        let pending = [];
        let queue = [];
        const sources = new Set();
        const horizon = 0.35;
        const maxAhead = 30;

        function failure() {
            if (failed || destroyed) return;
            failed = true;
            silence();
            if (options.onError) options.onError('No se pudo decodificar el audio MPEG de esta señal en el navegador.');
        }

        function silence() {
            for (const source of sources) {
                source.onended = null;
                try { source.stop(); } catch { /* Already ended. */ }
                source.disconnect();
            }
            sources.clear();
            scheduledThrough = null;
            anchor = null;
        }

        function trim() {
            if (origin === null) {
                if (queue.length) {
                    const newest = queue[queue.length - 1].start;
                    queue = queue.filter(chunk => chunk.start >= newest - maxAhead);
                }
                return;
            }
            const position = video.currentTime || 0;
            queue = queue.filter(chunk => chunk.start + chunk.duration - origin > position - 2 &&
                chunk.start - origin < position + maxAhead);
        }

        function updateVolume() {
            if (gain) gain.gain.value = video.muted ? 0 : Math.max(0, Math.min(1, video.volume ?? 1));
        }

        function schedule() {
            if (destroyed || failed || !context || context.state !== 'running' || origin === null ||
                video.paused || video.seeking || video.ended || Math.abs((video.playbackRate || 1) - 1) > 0.001) return;
            trim();
            const position = video.currentTime || 0;
            const clock = context.currentTime;
            // Re-anchor clocks after a seek or drift, without changing voice speed.
            if (anchor && Math.abs(position - (anchor.video + clock - anchor.audio)) > 0.12) silence();
            if (!anchor) anchor = { video: position, audio: clock };
            let through = Math.max(position, scheduledThrough ?? position);
            for (const chunk of queue) {
                const start = chunk.start - origin;
                const end = start + chunk.duration;
                if (end <= through || start >= position + horizon) continue;
                const from = Math.max(start, through, position);
                const until = Math.min(end, position + horizon);
                if (until - from < 0.001) continue;
                const source = context.createBufferSource();
                source.buffer = chunk.buffer;
                source.playbackRate.value = 1;
                source.connect(gain);
                sources.add(source);
                source.onended = () => { sources.delete(source); source.disconnect(); };
                source.start(clock + Math.max(0, from - position), from - start, until - from);
                through = until;
            }
            scheduledThrough = through;
        }

        function decode(packet) {
            if (destroyed || failed || !decoderReady) return;
            try {
                const pts = Number.isFinite(packet.pts) ? packet.pts : nextTimestamp;
                if (nextTimestamp === null) nextTimestamp = pts;
                // A partial MP2 frame can span PES packets. Keep the decoded sample clock
                // for small differences; retain real source gaps as silence.
                if (Number.isFinite(pts) && Number.isFinite(nextTimestamp) && Math.abs(pts - nextTimestamp) > 0.25) {
                    nextTimestamp = pts;
                }
                const pcm = decoder.decode(packet.data);
                if (!pcm.samplesDecoded || !pcm.channelData?.length || !Number.isFinite(nextTimestamp)) return;
                const duration = pcm.samplesDecoded / pcm.sampleRate;
                const start = nextTimestamp;
                nextTimestamp += duration;
                if (origin !== null && (start - origin > (video.currentTime || 0) + maxAhead ||
                    start + duration - origin < (video.currentTime || 0) - 2)) return;
                const buffer = context.createBuffer(pcm.channelData.length, pcm.samplesDecoded, pcm.sampleRate);
                for (let channel = 0; channel < pcm.channelData.length; channel++) {
                    buffer.getChannelData(channel).set(pcm.channelData[channel]);
                }
                queue.push({ start, duration, buffer });
                trim();
                schedule();
            } catch { failure(); }
        }

        let ready;
        try {
            const AudioContext = root.AudioContext || root.webkitAudioContext;
            const MPEGDecoder = root['mpg123-decoder']?.MPEGDecoder;
            if (!AudioContext || !MPEGDecoder) throw new Error('Audio decoder unavailable');
            context = new AudioContext();
            gain = context.createGain();
            gain.connect(context.destination);
            updateVolume();
            decoder = new MPEGDecoder();
            ready = Promise.resolve(decoder.ready).then(() => {
                if (destroyed) { decoder.free(); decoder = null; return; }
                decoderReady = true;
                const packets = pending;
                pending = [];
                pendingBytes = 0;
                for (const packet of packets) decode(packet);
            }).catch(error => { failure(); throw error; });
        } catch (error) {
            ready = Promise.reject(error);
            failure();
        }
        // Consumers await ready; keep early construction failures from becoming unhandled.
        ready.catch(() => {});

        function resume() {
            if (destroyed || !context) return Promise.resolve();
            // Must run immediately during the user's gesture, before awaiting WASM.
            try { return Promise.resolve(context.resume()).then(schedule); }
            catch (error) { return Promise.reject(error); }
        }

        function onPlay() { resume().catch(() => {}); }
        const events = { play: onPlay, playing: schedule, pause: silence, waiting: silence,
            seeking: silence, seeked: schedule, ratechange: silence, volumechange: updateVolume };
        for (const [event, handler] of Object.entries(events)) video.addEventListener(event, handler);
        const timer = setInterval(schedule, 100);

        return {
            ready,
            resume,
            setOrigin(seconds) {
                if (destroyed || !Number.isFinite(seconds)) return;
                if (origin !== null && Math.abs(origin - seconds) > 0.001) silence();
                origin = seconds;
                trim();
                schedule();
            },
            push(packet) {
                if (destroyed || failed || !(packet?.data instanceof Uint8Array) || !packet.data.length) return;
                detected = true;
                if (decoderReady) return decode(packet);
                const saved = { data: packet.data.slice(), pts: packet.pts };
                pending.push(saved);
                pendingBytes += saved.data.length;
                while (pendingBytes > 512 * 1024 && pending.length) pendingBytes -= pending.shift().data.length;
            },
            hasAudio() { return detected; },
            ahead() {
                if (origin === null || destroyed || failed || !queue.length) return 0;
                trim();
                const end = queue.reduce((last, chunk) => Math.max(last, chunk.start + chunk.duration), origin);
                return Math.max(0, Math.min(maxAhead, end - origin - (video.currentTime || 0)));
            },
            destroy() {
                if (destroyed) return;
                destroyed = true;
                clearInterval(timer);
                for (const [event, handler] of Object.entries(events)) video.removeEventListener(event, handler);
                silence();
                queue = pending = [];
                if (decoderReady && decoder) { decoder.free(); decoder = null; }
                if (gain) gain.disconnect();
                if (context) context.close().catch(() => {});
            }
        };
    }

    root.Mp2Audio = Object.freeze({ create });
})(globalThis);
