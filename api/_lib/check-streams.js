// Bound both downloads and elapsed time: importing a dead stream must not hang.
async function probe(url, signal, depth = 0) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Protocolo no compatible');
    const response = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Respuesta vacía');
    const chunks = [];
    let size = 0;
    const type = response.headers.get('content-type') || '';
    try {
        while (size < 131072) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
            size += value.length;
            // A media stream can be endless. Only read its first chunk.
            if (/^(video|audio)\//i.test(type) && !/mpegurl/i.test(type)) break;
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (text.startsWith('#EXTM3U')) {
        if (depth >= 2) throw new Error('Manifiesto sin fragmento verificable');
        const next = text.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
        if (!next) throw new Error('Manifiesto vacío');
        return probe(new URL(next, response.url || url).href, signal, depth + 1);
    }
    // Reject HTML error pages, including ones incorrectly served as video.
    if (/^\s*</.test(text) || !bytes.length) throw new Error('Respuesta sin vídeo');
    const isTransportStream = bytes[0] === 0x47;
    const isMp4 = bytes.length >= 8 && /^(ftyp|styp|moof|sidx)$/.test(bytes.toString('ascii', 4, 8));
    if (!isTransportStream && !isMp4 && !/^(video|audio)\//i.test(type)) {
        throw new Error('Formato de vídeo no reconocido');
    }
}

async function checkStreams(channels, { concurrency = 64, timeoutMs = 3500, budgetMs = 18000 } = {}) {
    const deadline = Date.now() + budgetMs;
    const results = new Array(channels.length);
    let cursor = 0;
    async function worker() {
        while (cursor < channels.length) {
            const index = cursor++;
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                results[index] = { ...channels[index], availability: 'unverified', reason: 'Tiempo de comprobación agotado' };
                continue;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
            try {
                await probe(channels[index].url, controller.signal);
                results[index] = { ...channels[index], availability: 'online', checkedAt: new Date() };
            } catch (error) {
                results[index] = { ...channels[index], availability: 'unavailable', reason: controller.signal.aborted ? 'Sin respuesta a tiempo' : error.message };
            } finally {
                clearTimeout(timer);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, channels.length) }, worker));
    const working = results.filter(channel => channel.availability === 'online');
    return {
        channels: working,
        excludedChannels: results.filter(channel => channel.availability !== 'online'),
        verification: { total: channels.length, online: working.length, excluded: channels.length - working.length,
            unverified: results.filter(channel => channel.availability === 'unverified').length, checkedAt: new Date() }
    };
}

module.exports = { checkStreams };
