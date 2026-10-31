'use strict';

(() => {
    const form = document.getElementById('direct-form');
    const input = document.getElementById('direct-url');
    const video = document.getElementById('direct-video');
    const stopButton = document.getElementById('direct-stop');
    const status = document.getElementById('direct-status');
    const volume = document.getElementById('direct-volume');
    const mute = document.getElementById('direct-mute');
    let activePlayer = null;
    let generation = 0;

    function message(text, state = '') {
        status.textContent = text;
        status.dataset.state = state;
    }

    function stop() {
        generation++;
        const previous = activePlayer;
        activePlayer = null;
        if (previous) previous.destroy();
        stopButton.disabled = true;
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        stop();
        const session = generation;
        let url;
        try {
            url = new URL(input.value.trim());
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
                throw new Error('Invalid URL');
            }
        } catch {
            message('Escribe una URL HTTP o HTTPS válida, sin usuario ni contraseña en la dirección.', 'error');
            return;
        }

        if (typeof DirectMpegts === 'undefined') {
            message('No se pudo cargar el reproductor. Recarga la página y comprueba los archivos locales.', 'error');
            return;
        }
        const transportError = DirectMpegts.transportError(url.href);
        if (transportError) {
            message(transportError, 'error');
            return;
        }

        function fail(text) {
            if (generation !== session) return;
            stop();
            message(text, 'error');
        }

        message('Conectando con la señal…');
        try {
            activePlayer = DirectMpegts.create(video, url.href, {
                onBuffering(buffering) {
                    if (generation !== session) return;
                    message(buffering ? 'Cargando señal…' : 'Reproduciendo la señal original.');
                },
                onError(text) { fail(text); },
                onAutoplayBlocked() {
                    if (generation === session) message('Pulsa el botón de reproducción del video para comenzar.');
                }
            });
            stopButton.disabled = false;
            Promise.resolve(activePlayer.start()).catch(() => {
                fail('No se pudo iniciar la señal. Comprueba la conexión y que el origen admita este navegador.');
            });
        } catch {
            fail('No se pudo crear el reproductor. Comprueba que este navegador admita MPEG-TS y Media Source Extensions.');
        }
    });

    stopButton.addEventListener('click', () => {
        stop();
        message('Reproducción detenida.');
    });
    volume.addEventListener('input', () => { video.volume = Number(volume.value) / 100; });
    mute.addEventListener('click', () => { video.muted = !video.muted; });
    video.addEventListener('volumechange', () => {
        volume.value = String(Math.round(video.volume * 100));
        mute.textContent = video.muted ? 'Activar sonido' : 'Silenciar';
        mute.setAttribute('aria-pressed', String(video.muted));
    });
    window.addEventListener('pagehide', stop);
})();
