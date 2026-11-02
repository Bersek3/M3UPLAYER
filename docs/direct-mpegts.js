(function (root) {
    'use strict';

    function isChannel(channel) {
        if (channel.playbackType) return channel.playbackType === 'mpegts';
        return channel.url === 'http://181.78.79.131:8000/play/a0q9' || /\.ts(?:[?#]|$)/i.test(channel.url || '');
    }

    function transportError(value) {
        let url;
        try { url = new URL(value); } catch { return 'La dirección de la señal no es válida.'; }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            return 'Usa una dirección HTTP o HTTPS sin credenciales en la dirección.';
        }
        if (root.location.protocol === 'https:' && url.protocol === 'http:') {
            return 'La página HTTPS no puede leer esta señal HTTP directamente. Prueba el reproductor local o utiliza una señal HTTPS del proveedor.';
        }
        return null;
    }

    function create(video, url, callbacks = {}) {
        let player = null;
        let audio = null;
        let attemptGeneration = 0;
        let destroyed = false;
        let started = false;
        let retryTimer = null;
        let monitor = null;
        let retries = 0;
        let awaitingBuffer = true;
        let lastTime = 0;
        let lastAdvance = 0;
        let healthySince = 0;
        const originalAutoplay = video.autoplay;
        const notify = (name, value) => { if (callbacks[name]) callbacks[name](value); };

        function releasePlayer() {
            attemptGeneration++;
            const old = player;
            player = null;
            if (audio) { audio.destroy(); audio = null; }
            if (old) old.destroy();
        }

        function stop(message) {
            clearTimeout(retryTimer);
            clearInterval(monitor);
            retryTimer = monitor = null;
            releasePlayer();
            notify('onBuffering', false);
            notify('onError', message);
        }

        function retry(message) {
            if (destroyed || retryTimer !== null) return;
            if (retries >= 3) return stop(message);
            releasePlayer();
            notify('onBuffering', true);
            retryTimer = setTimeout(() => {
                retryTimer = null;
                attempt();
            }, 1000 * Math.pow(2, retries++));
        }

        function maybePlay() {
            if (destroyed || !player || !awaitingBuffer) return;
            if (video.buffered.length && video.currentTime < video.buffered.start(0)) {
                video.currentTime = video.buffered.start(0);
            }
            let ahead = 0;
            for (let i = 0; i < video.buffered.length; i++) {
                if (video.currentTime >= video.buffered.start(i) - 0.25 && video.currentTime <= video.buffered.end(i)) {
                    ahead = video.buffered.end(i) - video.currentTime;
                    break;
                }
            }
            if (ahead < 4) return;
            if (audio && audio.hasAudio() && audio.ahead() < 3) return;
            awaitingBuffer = false;
            video.play().catch(error => {
                if (destroyed || error.name === 'AbortError') return;
                notify('onBuffering', false);
                notify('onAutoplayBlocked');
            });
        }

        function waiting() {
            if (!player || destroyed) return;
            // Refill instead of repeatedly draining the buffer at the live edge.
            if (!video.paused) {
                awaitingBuffer = true;
                video.pause();
            }
            notify('onBuffering', true);
        }

        function playing() {
            if (destroyed) return;
            awaitingBuffer = false;
            lastAdvance = Date.now();
            if (audio) audio.resume().catch(() => notify('onAutoplayBlocked'));
            notify('onBuffering', false);
        }

        function mediaError() {
            const active = player;
            if (!active || destroyed) return;
            queueMicrotask(() => {
                if (!destroyed && player === active) {
                    stop('El navegador rechazó la decodificación del video original. Esta señal necesita un formato compatible del proveedor o conversión; el modo directo no usa Render.');
                }
            });
        }

        function attempt() {
            if (destroyed) return;
            releasePlayer();
            awaitingBuffer = true;
            lastTime = 0;
            lastAdvance = Date.now();
            healthySince = 0;
            video.autoplay = false;
            video.playbackRate = 1;
            notify('onBuffering', true);
            const generation = attemptGeneration;
            const hybrid = !!(root.Mp2Audio && root.Mp2TsLoader);
            if (hybrid) {
                try {
                    audio = root.Mp2Audio.create(video, {
                        onError: () => {
                            if (!destroyed && generation === attemptGeneration) {
                                queueMicrotask(() => {
                                    if (!destroyed && generation === attemptGeneration) stop('No se pudo decodificar el audio MP2 de la señal.');
                                });
                            }
                        }
                    });
                    // Keep this inside the user gesture, before WASM initialization.
                    audio.resume().catch(() => notify('onAutoplayBlocked'));
                    audio.ready.then(() => {
                        if (!destroyed && generation === attemptGeneration) initialize();
                    }).catch(() => {
                        if (!destroyed && generation === attemptGeneration) stop('No se pudo cargar el decodificador de audio.');
                    });
                } catch {
                    stop('No se pudo iniciar el audio en este navegador.');
                }
            } else initialize();

            function initialize() {
                try {
                    const customLoader = hybrid ? root.Mp2TsLoader.createClass(
                        packet => { if (audio && generation === attemptGeneration) audio.push(packet); },
                        timestamp => { if (audio && generation === attemptGeneration) audio.setOrigin(timestamp); }
                    ) : undefined;
                    const active = root.mpegts.createPlayer({ type: 'mpegts', isLive: true, url,
                        cors: true, withCredentials: false }, {
                        // The custom loader splits audio once and shares the same connection.
                        enableWorker: !hybrid,
                        ...(customLoader ? { customLoader } : {}),
                        ...(root.AvcFields ? { avcSampleProcessor: root.AvcFields.create() } : {}),
                        enableStashBuffer: true,
                        stashInitialSize: 384 * 1024,
                        liveBufferLatencyChasing: false,
                        liveSync: false,
                        autoCleanupSourceBuffer: true,
                        autoCleanupMaxBackwardDuration: 30,
                        autoCleanupMinBackwardDuration: 15,
                        fixAudioTimestampGap: true,
                        lazyLoad: !hybrid,
                        lazyLoadMaxDuration: 30,
                        lazyLoadRecoverDuration: 10
                    });
                    player = active;
                    active.on(root.mpegts.Events.ERROR, type => {
                        // MSE can emit this inside appendMediaSegment. Let its stack unwind
                        // before destroy(), which disconnects the vendor's loading controller.
                        queueMicrotask(() => {
                            if (destroyed || player !== active) return;
                            if (type === root.mpegts.ErrorTypes.NETWORK_ERROR) {
                                retry('No se pudo mantener la conexión directa. Revisa que la señal esté activa y que el proveedor permita CORS.');
                            } else {
                                stop('El navegador no admite el formato de audio o video recibido, o la señal llegó dañada.');
                            }
                        });
                    });
                    active.on(root.mpegts.Events.LOADING_COMPLETE, () => {
                        queueMicrotask(() => {
                            if (player === active && !destroyed) retry('El origen cerró la transmisión en directo.');
                        });
                    });
                    active.attachMediaElement(video);
                    active.load();
                } catch {
                    stop('No se pudo iniciar el reproductor MPEG-TS en este navegador.');
                }
            }
        }

        return {
            start() {
                if (started || destroyed) return;
                started = true;
                const blocked = transportError(url);
                if (blocked) return stop(blocked);
                if (!root.mpegts || !root.mpegts.getFeatureList().mseLivePlayback) {
                    return stop('Este navegador no admite MPEG-TS en directo. Prueba con Chrome o Edge actualizados.');
                }
                video.addEventListener('progress', maybePlay);
                video.addEventListener('canplay', maybePlay);
                video.addEventListener('waiting', waiting);
                video.addEventListener('playing', playing);
                video.addEventListener('error', mediaError);
                monitor = setInterval(() => {
                    if (destroyed || !player || retryTimer !== null) return;
                    maybePlay();
                    if (video.currentTime > lastTime + 0.1) {
                        lastTime = video.currentTime;
                        lastAdvance = Date.now();
                        if (!healthySince) healthySince = lastAdvance;
                        if (lastAdvance - healthySince >= 15000) retries = 0;
                    } else if (awaitingBuffer || !video.paused) {
                        healthySince = 0;
                        if (Date.now() - lastAdvance > 20000) retry('La señal dejó de entregar video reproducible.');
                    } else {
                        // A deliberate pause must not trigger an automatic reconnect.
                        lastAdvance = Date.now();
                        healthySince = 0;
                    }
                }, 500);
                attempt();
            },
            destroy() {
                if (destroyed) return;
                destroyed = true;
                clearTimeout(retryTimer);
                clearInterval(monitor);
                video.removeEventListener('progress', maybePlay);
                video.removeEventListener('canplay', maybePlay);
                video.removeEventListener('waiting', waiting);
                video.removeEventListener('playing', playing);
                video.removeEventListener('error', mediaError);
                releasePlayer();
                video.autoplay = originalAutoplay;
                video.playbackRate = 1;
            }
        };
    }

    root.DirectMpegts = Object.freeze({ isChannel, transportError, create });
})(globalThis);
