'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { readChannels, conversionArgs } = require('../video-bridge/multi');

function run(ffmpeg, args, timeout) {
    return new Promise(resolve => {
        const started = Date.now();
        const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        let progress = '';
        child.stdout.on('data', data => { progress = (progress + data).slice(-16000); });
        const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
        child.once('error', () => { clearTimeout(timer); resolve({ code: -1, seconds: 0 }); });
        child.once('close', code => {
            clearTimeout(timer);
            const times = [...progress.matchAll(/^out_time_us=(\d+)$/gm)];
            resolve({ code, seconds: Number(times.at(-1)?.[1] || 0) / 1e6, wall: (Date.now() - started) / 1000 });
        });
    });
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const playlist = process.env.SOURCE_PLAYLIST || path.join(root, 'playlists/chile-sin-credenciales.m3u');
    const target = [...readChannels(fs.readFileSync(playlist, 'utf8'))].find(([, c]) => c.name === 'TNT Sports Premium SD');
    if (!target) throw new Error('No se encontró TNT Sports Premium SD en la lista.');
    const [id, channel] = target;
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-tnt-quality-'));
    try {
        const sample = path.join(dir, 'sample.ts');
        console.log('Capturando 12 segundos originales de TNT. No cambies de canal durante la prueba.');
        const capture = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-rw_timeout', '15000000', '-user_agent', 'VLC/3.0.21', '-i', channel.url,
            '-map', '0:v:0', '-map', '0:a:0?', '-t', '12', '-c', 'copy', sample], 45000);
        if (capture.code !== 0 || !fs.existsSync(sample) || fs.statSync(sample).size < 18800) throw new Error('No se pudo capturar una muestra válida. Se conserva la calidad anterior.');
        let selected;
        for (const width of [1920, 1280, 960, 640]) {
            const profile = { width, fps: 25 };
            const output = path.join(dir, String(width));
            fs.mkdirSync(output);
            const args = conversionArgs(sample, output, width, profile);
            const encoding = args.slice(args.indexOf('-map'));
            encoding.splice(encoding.indexOf('-f'), 0, '-t', '30');
            console.log(`Midiendo ancho ${width}, 25 fps: 30 segundos de conversión HLS...`);
            const result = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin',
                '-progress', 'pipe:1', '-filter_threads', '1', '-fflags', '+genpts+discardcorrupt',
                '-stream_loop', '-1', '-i', sample, ...encoding], 50000);
            const speed = result.seconds / result.wall;
            console.log(`${width}: ${result.code === 0 ? speed.toFixed(2) + 'x' : 'falló o excedió el tiempo'}`);
            // Reserve headroom for the operating system, HTTP and input variations.
            if (result.code === 0 && result.seconds >= 29 && speed >= 1.25) { selected = profile; break; }
        }
        if (!selected) throw new Error('Ningún perfil mantuvo el margen de 1.25x. Se conserva la configuración anterior.');
        const file = process.env.BRIDGE_CHANNEL_PROFILES || path.join(root, 'video-bridge/channel-profiles.local.json');
        const profiles = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
        profiles[id] = selected;
        fs.writeFileSync(file + '.tmp', JSON.stringify(profiles, null, 2) + '\n');
        fs.renameSync(file + '.tmp', file);
        console.log(`Guardado solo para TNT: ancho máximo ${selected.width}, ${selected.fps} fps. Los demás canales conservan su perfil.`);
        console.log('Reinicia m3u-conversor y comprueba continuidad durante varios minutos. La prueba no garantiza el rendimiento de todas las escenas.');
    } finally {
        const resolved = path.resolve(dir);
        if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('m3u-tnt-quality-')) throw new Error('Directorio temporal inesperado');
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
