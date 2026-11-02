'use strict';

// The published MPEG-TS demuxer emits one MP4 sample per PES. Some broadcast
// sources carry one interlaced field per PES, while browser decoders need a full
// frame per sample. Add an optional callback before dispatching AVC samples.
// AvcFields implements that callback in readable application code.
const fs = require('node:fs');
const crypto = require('node:crypto');

function patch(source) {
    const start = source.indexOf('.parseH264Payload=function');
    const end = source.indexOf('.parseH265Payload=function', start);
    const anchor = 'm.samples.push(g),m.length+=_';
    if (start < 0 || end < 0) throw new Error('Unexpected mpegts.js build');
    const section = source.slice(start, end);
    if (section.split(anchor).length !== 2) throw new Error('AVC sample hook must match exactly once');
    const replacement = 'this.config_.avcSampleProcessor&&(g=this.config_.avcSampleProcessor(g,this.video_metadata_)),g&&(m.samples.push(g),m.length+=g.length)';
    return '/* M3U Player modification: optional AVC field-pair sample hook. See scripts/patch-mpegts.js and avc-fields.js. */\n' +
        source.slice(0, start) + section.replace(anchor, replacement) + source.slice(end);
}

if (require.main === module) {
    if (!process.argv[2]) throw new Error('Usage: node scripts/patch-mpegts.js path/to/original/mpegts.js');
    const original = fs.readFileSync(process.argv[2]);
    const hash = crypto.createHash('sha256').update(original).digest('hex');
    // Pin the browser distribution from npm mpegts.js@1.8.2.
    const expected = 'bda31748736a69cb610c2edf4623e633f1f4f47b5bda83668c8d287e51b0c3a8';
    if (hash !== expected) throw new Error('Unexpected upstream file hash; review the patch before updating');
    fs.writeFileSync('vendor/mpegts-1.8.2.min.js', patch(original.toString('utf8')));
}

module.exports = { patch };
