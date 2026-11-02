'use strict';
const video = document.getElementById('video');
const controls = document.getElementById('controls');
const status = document.getElementById('status');
const strip = document.getElementById('channels');
let channels = [], selected = 0, hls = null, hideTimer, generation = 0;
function showControls() {
    controls.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => controls.classList.add('hidden'), 6000);
}
function hideControls() { clearTimeout(hideTimer); controls.classList.add('hidden'); }
window.playerBack = () => {
    if (!document.getElementById('auth').hidden) return false;
    if (controls.classList.contains('hidden')) { showControls(); return true; }
    return false;
};
function playChannel(index) {
    if (!channels.length) return;
    selected = (index + channels.length) % channels.length;
    const channel = channels[selected], request = ++generation;
    localStorage.setItem('android-channel-url', channel.url);
    document.getElementById('title').textContent = channel.name;
    document.querySelectorAll('#channels button').forEach((button, i) => {
        button.classList.toggle('selected', i === selected);
        button.setAttribute('aria-pressed', String(i === selected));
    });
    strip.children[selected]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute('src'); video.load();
    status.textContent = 'Conectando…';
    const start = () => {
        if (request !== generation) return;
        video.play().catch(() => { status.textContent = 'Pulsa ▶ para reproducir'; });
    };
    if (window.Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, backBufferLength: 15 });
        hls.loadSource(channel.url); hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, start);
        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal && request === generation) {
                status.textContent = 'Canal no disponible. Elige otro canal.'; showControls();
            }
        });
    } else { video.src = channel.url; start(); }
    showControls();
}
video.addEventListener('playing', () => { status.textContent = ''; document.getElementById('play').textContent = 'Ⅱ'; });
video.addEventListener('pause', () => { document.getElementById('play').textContent = '▶'; });
video.addEventListener('waiting', () => { status.textContent = 'Cargando…'; });
video.addEventListener('error', () => { status.textContent = 'Canal no disponible. Elige otro canal.'; showControls(); });
video.addEventListener('click', () => controls.classList.contains('hidden') ? showControls() : hideControls());
controls.addEventListener('pointerdown', showControls);
strip.addEventListener('scroll', showControls, { passive: true });
document.getElementById('hide').onclick = hideControls;
document.getElementById('previous').onclick = () => playChannel(selected - 1);
document.getElementById('next').onclick = () => playChannel(selected + 1);
document.getElementById('play').onclick = () => {
    if (video.paused) video.play().catch(() => { status.textContent = 'No se pudo reproducir. Elige otro canal.'; });
    else video.pause();
};
document.addEventListener('keydown', event => {
    if (!document.getElementById('auth').hidden) return;
    if (event.key === 'ArrowRight') playChannel(selected + 1);
    if (event.key === 'ArrowLeft') playChannel(selected - 1);
});
function renderChannels(list) {
    generation++;
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute('src'); video.load();
    strip.replaceChildren();
    channels = list;
    if (!channels.length) throw new Error('Lista vacía');
    document.getElementById('count').textContent = String(channels.length);
    channels.forEach((channel, i) => {
        const button = document.createElement('button'), number = document.createElement('small');
        number.textContent = String(i + 1).padStart(3, '0') + ' · ' + (channel.group || 'TV');
        const name = document.createElement('strong'); name.textContent = channel.name;
        button.append(number, name); button.onclick = () => playChannel(i); strip.append(button);
    });
    const saved = channels.findIndex(channel => channel.url === localStorage.getItem('android-channel-url'));
    playChannel(saved < 0 ? 0 : saved);
}
