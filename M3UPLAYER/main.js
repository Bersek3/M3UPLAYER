/**
 * M3U TV PRO - SAMSUNG SMART TV (TIZEN OS)
 * Pure Single-Screen Live TV Experience (Reference UI)
 * Features:
 * - Instant full-screen playback of last channel on boot (Auto-Resume)
 * - Vertical channel carousel with distinctive magenta/pink active card (#5 Latina style)
 * - Live EPG preview cards (En vivo + Quedan XX min / Próximo programa)
 * - Top-right channel watermark & bottom-right clock
 * - 6-second auto-hide overlay for pure TV viewing
 * - Native Smart TV Exit Dialog on Return/Back/Exit keys with D-Pad controls
 * - Database channels integration via MongoDB Atlas (/api/channels)
 */

// ==========================================================================
// STATE
// ==========================================================================
let allChannels = [];
let currentChannelIndex = 0;
let hlsInstance = null;
let overlayHideTimeout = null;
let isExitDialogOpen = false;
let exitDialogFocusIndex = 0; // 0 = Continuar, 1 = Salir
let channelSwitchDebounceTimeout = null;

const STORAGE_KEY_TOKEN = "tv_user_token";
const STORAGE_KEY_LAST_CHANNEL = "m3u_last_played_index";
const STORAGE_KEY_LAST_CHANNEL_URL = "m3u_last_played_url";
const STORAGE_KEY_CACHED_CHANNELS = "m3u_cached_channels";

const DEFAULT_SERVER_URL = "https://m3uplayer-yw7z.onrender.com";

function getServerUrl() {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
        const origin = window.location.origin;
        if (origin.indexOf('http') === 0 && origin.indexOf('file://') === -1 && !origin.includes('github.io')) {
            return origin;
        }
    }
    return DEFAULT_SERVER_URL;
}

// Fallback high-quality channels if database is unreachable (Top Chilean Channels)
const FALLBACK_CHANNELS = [
    {
        "number": "001",
        "name": "Mega",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/455_Mega.png",
        "url": "https://unlimited1-cl-isp.dps.live/mega/mega.smil/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "002",
        "name": "CHV Noticias",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1153_CHV.png",
        "url": "https://mdstrm.com/live-stream-playlist/6491ced935a5833c47dd7f41.m3u8?PlaylistM3UCL"
    },
    {
        "number": "003",
        "name": "TVN 24 Horas",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/448_TVN_24_Horas.png",
        "url": "https://mdstrm.com/live-stream-playlist/57d1a22064f5d85712b20dab.m3u8?PlaylistM3UCL"
    },
    {
        "number": "004",
        "name": "TV Chile",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/448_TVN_24_Horas.png",
        "url": "https://mdstrm.com/live-stream-playlist/533adcc949386ce765657d7c.m3u8"
    },
    {
        "number": "005",
        "name": "TVN3",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1437_TVN3.png",
        "url": "https://mdstrm.com/live-stream-playlist/5653641561b4eba30a7e4929.m3u8?PlaylistM3UCL"
    },
    {
        "number": "006",
        "name": "NTV",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/45_NTV.png",
        "url": "https://mdstrm.com/live-stream-playlist/5aaabe9e2c56420918184c6d.m3u8"
    },
    {
        "number": "007",
        "name": "TV+",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/458_TV_.png",
        "url": "https://redirector.rudo.video/hls-video/ey6283je82983je9823je8jowowiekldk9838274/tvmas/tvmas.smil/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "008",
        "name": "T13",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1054_T13.png",
        "url": "https://redirector.rudo.video/hls-video/10b92cafdf3646cbc1e727f3dc76863621a327fd/t13/t13.smil/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "009",
        "name": "T13 Radio",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1198_T13_Radio.png",
        "url": "https://unlimited1-cl-isp.dps.live/t13radio/t13radio.smil/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "010",
        "name": "13 Cultura",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1193_13_Cultura.png",
        "url": "https://redirector.dps.live/hls/13cultura/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "011",
        "name": "13 Cocina",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1683_13_Cocina.png",
        "url": "https://redirector.dps.live/hls/13cocina/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "012",
        "name": "13 Pop",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1033_13_Pop.png",
        "url": "https://redirector.dps.live/hls/13pop/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "013",
        "name": "13 Teleseries",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1032_13_Teleseries.png",
        "url": "https://redirector.dps.live/hls/13t/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "014",
        "name": "13 Festival",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1446_13_Festival.png",
        "url": "https://redirector.dps.live/hls/13festival/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "015",
        "name": "13 Realities",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1448_13_Realities.png",
        "url": "https://redirector.dps.live/hls/13realities/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "016",
        "name": "13 Viajes",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1684_13_Viajes.png",
        "url": "https://redirector.dps.live/hls/13viajes/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "017",
        "name": "U Chile TV",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1017_U_Chile_TV.png",
        "url": "https://unlimited1-cl-isp.dps.live/uchiletv/uchiletv.smil/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "018",
        "name": "UCV",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/54_UCV.png",
        "url": "https://unlimited2-cl-isp.dps.live/ucvtv2/ucvtv2.smil/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "019",
        "name": "UCV 2",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/1152_UCV_2.png",
        "url": "https://unlimited1-cl-isp.dps.live/ucvtveventos/ucvtveventos.smil/playlist.m3u8?PlaylistM3UCL"
    },
    {
        "number": "020",
        "name": "TVN",
        "group": "Nacional",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/3/33/Logotipo_de_Televisi%C3%B3n_Nacional_de_Chile.svg",
        "url": "https://mdstrm.com/live-stream-playlist-v/555c9a91eb4886825b07ee7b.m3u8"
    },
    {
        "number": "021",
        "name": "Chilevisión",
        "group": "Nacional",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/8/87/Emblema_de_Chilevisi%C3%B3n.svg",
        "url": "https://redirector.rudo.video/hls-video/10b92cafdf3646cbc1e727f3dc76863621a327fd/chv/chv.smil/playlist.m3u8"
    },
    {
        "number": "022",
        "name": "Canal 13 HD",
        "group": "Nacional",
        "logo": "https://cdn.m3u.cl/logo/457_Canal_13.png",
        "url": "https://jireh-9-hls-video-cl-movistar.dps.live/hls-video/ey6283je82983je9823je8jowowiekldk9838274/13live/13live.smil/13live/livestream1/chunks.m3u8"
    },
    {
        "number": "023",
        "name": "BioBio TV",
        "group": "Noticias",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/a/a8/Biobio_TV_logo.jpg",
        "url": "https://redirector.rudo.video/hls-video/339f69c6122f6d8f4574732c235f09b7683e31a5/bbtv/bbtv.smil/playlist.m3u8"
    },
    {
        "number": "024",
        "name": "Radio Carolina TV",
        "group": "Música",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/b/b8/Logo_Radio_Carolina_2020.png",
        "url": "https://mdstrm.com/live-stream-playlist/63a06468117f42713374addd.m3u8"
    },
    {
        "number": "025",
        "name": "Radio Cooperativa",
        "group": "Música / Noticias",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/e/ed/Radio_Cooperativa_Logo.svg",
        "url": "https://unlimited1-cl-isp.dps.live/coopetv/coopetv.smil/playlist.m3u8"
    },
    {
        "number": "026",
        "name": "Radio ADN TV",
        "group": "Música / Noticias",
        "logo": "https://upload.wikimedia.org/wikipedia/commons/c/c2/ADN_Radio_Chile.svg",
        "url": "https://redirector.rudo.video/hls-video/931b584451fa6dd1313ee66efbfd5802e3f3bcea/adntv/adntv.smil/playlist.m3u8"
    },
    {
        "number": "027",
        "name": "Tevex",
        "group": "General",
        "logo": "https://tevex.cl/wp-content/uploads/2021/01/logo_tevex_formato_3.svg",
        "url": "https://v4.tustreaming.cl:443/tevexinter/index.m3u8"
    }
];

// ==========================================================================
// INITIALIZATION
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    initClock();
    initTizenKeys();
    initEventListeners();

    if (window.tizen && !window.webapis) {
        try {
            const s = document.createElement('script');
            s.src = '$WEBAPIS/webapis/webapis.js';
            document.head.appendChild(s);
        } catch (e) {}
    }

    // Start loading channels from Database or Cache immediately
    loadChannelsAndBoot();
});

function initClock() {
    const update = () => {
        const now = new Date();
        const hrs = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const clockEl = document.getElementById('tv-clock');
        if (clockEl) clockEl.textContent = `${hrs}:${mins}`;
    };
    update();
    setInterval(update, 1000);
}

function initTizenKeys() {
    if (window.tizen && tizen.tvinputdevice) {
        try {
            tizen.tvinputdevice.registerKey("ChannelUp");
            tizen.tvinputdevice.registerKey("ChannelDown");
            tizen.tvinputdevice.registerKey("MediaPlay");
            tizen.tvinputdevice.registerKey("MediaPause");
            tizen.tvinputdevice.registerKey("MediaPlayPause");
            tizen.tvinputdevice.registerKey("ColorF3Blue");
            tizen.tvinputdevice.registerKey("ColorF0Red");
            tizen.tvinputdevice.registerKey("ColorF1Green");
            tizen.tvinputdevice.registerKey("ColorF2Yellow");
        } catch (e) {
            console.warn("Tizen key registration:", e);
        }
    }
}

// ==========================================================================
// CHANNEL LOADING (DATABASE FIRST + AUTO-RESUME)
// ==========================================================================
async function loadChannelsAndBoot() {
    showBuffering(true);

    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const serverUrl = getServerUrl();
    const endpoint = token ? `${serverUrl}/api/user/channels` : `${serverUrl}/api/channels`;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    try {
        const res = await fetch(endpoint, { headers, cache: 'no-cache' });
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.channels) && data.channels.length > 0) {
                allChannels = data.channels.map((ch, idx) => ({
                    number: String(idx + 1).padStart(3, '0'),
                    name: ch.name || `Canal ${idx + 1}`,
                    logo: ch.logo || '',
                    group: ch.group || 'General',
                    url: ch.url
                }));
                localStorage.setItem(STORAGE_KEY_CACHED_CHANNELS, JSON.stringify(allChannels));
            }
        }
    } catch (err) {
        console.warn("Error fetching channels from server:", err);
    }

    // If fetch failed or had 0 channels, try localStorage cached channels
    if (allChannels.length === 0) {
        const cached = localStorage.getItem(STORAGE_KEY_CACHED_CHANNELS);
        if (cached) {
            try {
                allChannels = JSON.parse(cached);
            } catch (e) {}
        }
    }

    // If still empty, use fallback channels
    if (allChannels.length === 0) {
        allChannels = FALLBACK_CHANNELS;
    }

    // Render channels UI list
    renderVerticalChannelList();

    // AUTO-RESUME: Find last played channel or start with 0 (or index 4 for Latina if available)
    let savedIndex = parseInt(localStorage.getItem(STORAGE_KEY_LAST_CHANNEL), 10);
    const savedUrl = localStorage.getItem(STORAGE_KEY_LAST_CHANNEL_URL);

    if (savedUrl) {
        const idxByUrl = allChannels.findIndex(c => c.url === savedUrl);
        if (idxByUrl !== -1) savedIndex = idxByUrl;
    }

    if (isNaN(savedIndex) || savedIndex < 0 || savedIndex >= allChannels.length) {
        savedIndex = 0;
    }

    // Play the channel immediately!
    selectAndPlayChannel(savedIndex, false);
}

// ==========================================================================
// VERTICAL CHANNELS LIST & EPG RENDERING
// ==========================================================================
function renderVerticalChannelList() {
    const listContainer = document.getElementById('channels-scroll-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    allChannels.forEach((ch, idx) => {
        const item = document.createElement('div');
        item.className = 'channel-nav-item' + (idx === currentChannelIndex ? ' active' : '');
        item.id = `ch-item-${idx}`;
        item.dataset.index = idx;

        // Channel Number column
        const numSpan = document.createElement('span');
        numSpan.className = 'ch-num';
        numSpan.textContent = idx + 1;
        item.appendChild(numSpan);

        // Box containing Logo / Name
        const box = document.createElement('div');
        box.className = 'ch-box';

        // Active card number inside the magenta card
        const cardNum = document.createElement('span');
        cardNum.className = 'active-card-num';
        cardNum.textContent = idx + 1;
        box.appendChild(cardNum);

        if (ch.logo) {
            const img = document.createElement('img');
            img.className = 'ch-logo';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = ch.logo;
            img.alt = ch.name;
            img.onerror = () => {
                img.style.display = 'none';
                if (!box.querySelector('.ch-fallback-name')) {
                    const fallback = document.createElement('span');
                    fallback.className = 'ch-fallback-name';
                    fallback.textContent = ch.name;
                    box.appendChild(fallback);
                }
            };
            box.appendChild(img);
        } else {
            const nameSpan = document.createElement('span');
            nameSpan.className = 'ch-fallback-name';
            nameSpan.textContent = ch.name;
            box.appendChild(nameSpan);
        }

        item.appendChild(box);

        // Click support
        item.addEventListener('click', () => {
            selectAndPlayChannel(idx, true);
        });

        listContainer.appendChild(item);
    });
}

function updateVerticalCarouselPosition() {
    const listContainer = document.getElementById('channels-scroll-list');
    const items = document.querySelectorAll('.channel-nav-item');
    if (!listContainer || items.length === 0) return;

    items.forEach((item, idx) => {
        if (idx === currentChannelIndex) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    const activeItem = items[currentChannelIndex];
    if (activeItem) {
        const windowCenter = window.innerHeight / 2;
        // Dynamically compute offset using the active item's actual rendered position & height
        const itemCenter = activeItem.offsetTop + (activeItem.offsetHeight / 2);
        const targetOffset = windowCenter - itemCenter;
        listContainer.style.transform = `translateY(${targetOffset}px)`;
    }
}

// Generate realistic dynamic EPG info for the channel
function updateEpgAndWatermark(channel) {
    if (!channel) return;

    // Top Right Watermark (Logo Only)
    const watermarkImg = document.getElementById('watermark-logo');
    if (watermarkImg) {
        if (channel.logo) {
            watermarkImg.src = channel.logo;
            watermarkImg.classList.remove('hidden');
            watermarkImg.onerror = () => watermarkImg.classList.add('hidden');
        } else {
            watermarkImg.classList.add('hidden');
        }
    }

    // Dynamic program titles based on time & channel name
    const now = new Date();
    const currentHour = now.getHours();
    const currentMins = now.getMinutes();

    const titleCurrent = document.getElementById('epg-title-current');
    const subCurrent = document.getElementById('epg-subtitle');
    const timeLeft = document.getElementById('epg-time-left');
    const progressFill = document.getElementById('epg-progress-fill');

    const titleNext = document.getElementById('epg-title-next');
    const upcomingTime = document.getElementById('epg-upcoming-time');

    // Dynamic programs
    const remainingMins = 60 - currentMins;
    const nextHour = (currentHour + 1) % 24;
    const nextHourStr = `${String(nextHour).padStart(2, '0')}:00`;

    if (titleCurrent) {
        titleCurrent.textContent = getProgramNameForChannel(channel.name, currentHour);
    }
    if (timeLeft) {
        timeLeft.textContent = `Quedan ${remainingMins} min`;
    }
    if (progressFill) {
        const percent = Math.min(100, Math.max(10, Math.round((currentMins / 60) * 100)));
        progressFill.style.width = `${percent}%`;
    }

    if (titleNext) {
        titleNext.textContent = getUpcomingProgramForChannel(channel.name, currentHour);
    }
    if (upcomingTime) {
        upcomingTime.textContent = `Comienza a las ${nextHourStr}`;
    }
}

function getProgramNameForChannel(chName, hour) {
    const lower = (chName || '').toLowerCase();
    if (lower.includes('13') && !lower.includes('radio')) {
        if (hour >= 6 && hour < 8) return '3x3 Teletrece';
        if (hour >= 8 && hour < 13) return 'Tu Día (En Vivo)';
        if (hour >= 13 && hour < 15) return 'Teletrece Tarde';
        if (hour >= 15 && hour < 21) return '¡Qué Dice Chile!';
        if (hour >= 21 && hour < 22) return 'Teletrece Central';
        return 'Tierra Brava / Ganar o Servir';
    }
    if (lower.includes('tvn') && !lower.includes('3')) {
        if (hour >= 8 && hour < 13) return 'Buenos Días a Todos';
        if (hour >= 13 && hour < 15) return '24 Tarde';
        if (hour >= 15 && hour < 21) return 'Carmen Gloria a Tu Servicio';
        if (hour >= 21 && hour < 22) return '24 Horas Central';
        return 'El Clon / Serie Estelar';
    }
    if (lower.includes('mega')) {
        if (hour >= 8 && hour < 13) return 'Mucho Gusto (En Vivo)';
        if (hour >= 13 && hour < 15) return 'Meganoticias Actualiza';
        if (hour >= 15 && hour < 21) return 'Como La Vida Misma';
        if (hour >= 21 && hour < 22) return 'Meganoticias Prime';
        return 'Al Sur del Corazón';
    }
    if (lower.includes('chilevisi') || lower.includes('chv')) {
        if (hour >= 8 && hour < 13) return 'Contigo en la Mañana';
        if (hour >= 13 && hour < 15) return 'CHV Noticias Tarde';
        if (hour >= 15 && hour < 21) return 'Pasapalabra';
        if (hour >= 21 && hour < 22) return 'CHV Noticias Central';
        return 'Gran Hermano / The Voice';
    }
    if (lower.includes('24 horas') || lower.includes('noticias')) return 'Noticiero 24 Horas en Vivo';
    if (lower.includes('biobio')) return 'Radiograma con Tomás Mosciatti';
    if (lower.includes('carolina')) return 'Comunidad Carolina';
    if (lower.includes('cooperativa')) return 'El Diario de Cooperativa';
    if (lower.includes('adn')) return 'Los Tenores de ADN';
    if (lower.includes('tvn 3')) return 'Grandes Recuerdos de TVN';
    if (lower.includes('ucv')) return 'Toc Show';
    return `${chName} en Vivo`;
}

function getUpcomingProgramForChannel(chName, hour) {
    const lower = (chName || '').toLowerCase();
    if (lower.includes('13')) return 'Lugares que Hablan';
    if (lower.includes('tvn')) return 'Informe Especial';
    if (lower.includes('mega')) return 'Generación 98';
    if (lower.includes('chilevisi') || lower.includes('chv')) return 'Podemos Hablar';
    if (lower.includes('noticias') || lower.includes('24')) return 'Edición Especial 24';
    if (lower.includes('adn')) return 'ADN Deportes';
    if (lower.includes('carolina')) return 'Pegao al Taco';
    return 'Programación Especial';
}

// ==========================================================================
// VIDEO PLAYBACK & STREAMING ENGINE (SMART TV DUAL-ENGINE: HLS.JS + NATIVE)
// ==========================================================================
function stopCurrentPlayback() {
    if (hlsInstance) {
        try {
            hlsInstance.destroy();
        } catch (e) {}
        hlsInstance = null;
    }

    const video = document.getElementById('main-video');
    if (video) {
        try {
            video.pause();
            video.removeAttribute('src');
            video.load();
        } catch (e) {}
    }

    if (window.webapis && webapis.avplay) {
        try {
            const state = webapis.avplay.getState();
            if (state !== 'NONE' && state !== 'IDLE') {
                webapis.avplay.stop();
            }
            webapis.avplay.close();
        } catch (e) {}
    }
}

function selectAndPlayChannel(index, keepOverlayAwake = true, immediate = false) {
    if (allChannels.length === 0) return;

    if (index < 0) index = allChannels.length - 1;
    if (index >= allChannels.length) index = 0;

    currentChannelIndex = index;
    const channel = allChannels[currentChannelIndex];

    // Persist last watched channel for Auto-Resume!
    localStorage.setItem(STORAGE_KEY_LAST_CHANNEL, String(currentChannelIndex));
    if (channel && channel.url) {
        localStorage.setItem(STORAGE_KEY_LAST_CHANNEL_URL, channel.url);
    }

    // Instant UI reaction (Navbar & EPG update immediately at 60fps)
    updateVerticalCarouselPosition();
    updateEpgAndWatermark(channel);

    if (keepOverlayAwake) {
        showOverlay();
        resetOverlayHideTimer();
    }

    if (!channel || !channel.url) return;

    // Cancela cualquier carga de streaming anterior pendiente
    clearTimeout(channelSwitchDebounceTimeout);

    if (immediate) {
        playStreamOnTv(channel.url);
    } else {
        // Anti-congelamiento en TV: Espera 350ms antes de pedir video/decodificador de hardware
        // Permite surfear canales suavemente con las flechas sin saturar la memoria RAM del televisor
        channelSwitchDebounceTimeout = setTimeout(() => {
            playStreamOnTv(channel.url);
        }, 350);
    }
}

function playStreamOnTv(streamUrl) {
    const video = document.getElementById('main-video');
    if (!video) return;

    showBuffering(true);
    hideError();

    stopCurrentPlayback();

    let triedNative = false;

    // Fallback: Native HTML5 TV Video Player (bypasses CORS restrictions on Smart TV)
    const playWithNativeVideo = () => {
        if (triedNative) return;
        triedNative = true;
        console.log("Iniciando reproductor nativo de TV (GStreamer/Hardware)...", streamUrl);

        if (hlsInstance) {
            try { hlsInstance.destroy(); } catch (e) {}
            hlsInstance = null;
        }

        video.pause();
        video.src = streamUrl;
        video.load();

        const playPromise = video.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(err => {
                console.warn("Fallo en video nativo HTML5:", err);
                if (window.webapis && webapis.avplay) {
                    playWithSamsungAvPlay(streamUrl);
                } else {
                    showError("Canal temporalmente no disponible");
                    showBuffering(false);
                }
            });
        }
    };

    video.onplaying = () => {
        showBuffering(false);
        hideError();
    };
    video.onwaiting = () => showBuffering(true);
    video.onerror = (e) => {
        console.warn("Error en elemento video:", e);
        if (!triedNative) {
            playWithNativeVideo();
        } else if (window.webapis && webapis.avplay) {
            playWithSamsungAvPlay(streamUrl);
        } else {
            showBuffering(false);
            showError("Señal en vivo no disponible");
        }
    };

    // Try Hls.js with TV-safe settings (low memory buffer, no workers, fast cleanup)
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        hlsInstance = new Hls({
            enableWorker: false, // CRÍTICO: En Samsung Tizen WebKit los Workers fallan al procesar MSE
            lowLatencyMode: false,
            backBufferLength: 8,       // Mantiene solo 8s de buffer pasado (libera RAM inmediatamente)
            maxBufferLength: 10,       // Descarga máx 10s hacia adelante (evita saturar el navegador del TV)
            maxMaxBufferLength: 15,
            maxBufferSize: 12 * 1024 * 1024, // Límite estricto de 12MB de buffer en memoria
            autoCleanupMaxBufferSize: 15 * 1024 * 1024,
            manifestLoadingTimeOut: 12000,
            manifestLoadingMaxRetry: 3,
            levelLoadingTimeOut: 12000,
            levelLoadingMaxRetry: 3,
            fragLoadingTimeOut: 15000,
            fragLoadingMaxRetry: 3,
            xhrSetup: function(xhr) {
                try {
                    xhr.withCredentials = false;
                } catch (e) {}
            }
        });

        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(video);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            showBuffering(false);
            video.play().catch(() => {
                playWithNativeVideo();
            });
        });

        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.warn("HLS.js fatal error on TV:", data.type, data.details);
                // Si Hls.js sufre error fatal (como CORS en Smart TV), caer automáticamente al reproductor nativo
                playWithNativeVideo();
            }
        });
    } else {
        playWithNativeVideo();
    }
}

function playWithSamsungAvPlay(url) {
    if (!window.webapis || !webapis.avplay) return;
    try {
        console.log("Iniciando Samsung AVPlay nativo de hardware:", url);
        try {
            const state = webapis.avplay.getState();
            if (state !== 'NONE' && state !== 'IDLE') {
                webapis.avplay.stop();
            }
            webapis.avplay.close();
        } catch (e) {}

        webapis.avplay.open(url);
        webapis.avplay.setDisplayRect(0, 0, window.innerWidth || 1920, window.innerHeight || 1080);
        
        webapis.avplay.setListener({
            onbufferingstart: () => showBuffering(true),
            onbufferingcomplete: () => showBuffering(false),
            onerror: () => {
                showBuffering(false);
                showError("Canal no disponible");
            }
        });

        webapis.avplay.prepareAsync(() => {
            webapis.avplay.play();
            showBuffering(false);
            hideError();
        }, () => {
            showBuffering(false);
            showError("Canal no disponible");
        });
    } catch (e) {
        console.warn("Error en AVPlay:", e);
    }
}

function showBuffering(show) {
    const el = document.getElementById('player-buffering');
    if (el) el.classList.toggle('hidden', !show);
}

function showError(msg) {
    const el = document.getElementById('player-error');
    const textEl = document.getElementById('player-error-text');
    if (textEl && msg) textEl.textContent = msg;
    if (el) el.classList.remove('hidden');
    setTimeout(hideError, 4500);
}

function hideError() {
    const el = document.getElementById('player-error');
    if (el) el.classList.add('hidden');
}

// ==========================================================================
// AUTO-HIDE OVERLAY (PURE IMMERSIVE TV EXPERIENCE)
// ==========================================================================
function showOverlay() {
    const overlay = document.getElementById('tv-main-overlay');
    if (overlay) overlay.classList.remove('faded-out');
}

function hideOverlay() {
    if (isExitDialogOpen) return; // Never hide if user is exiting
    const overlay = document.getElementById('tv-main-overlay');
    if (overlay) overlay.classList.add('faded-out');
}

function resetOverlayHideTimer() {
    clearTimeout(overlayHideTimeout);
    overlayHideTimeout = setTimeout(() => {
        hideOverlay();
    }, 6000); // 6 seconds auto-hide
}

// ==========================================================================
// SMART TV NATIVE EXIT DIALOG
// ==========================================================================
function openExitDialog() {
    isExitDialogOpen = true;
    clearTimeout(overlayHideTimeout);
    showOverlay();

    const dialog = document.getElementById('tv-exit-dialog');
    if (dialog) dialog.classList.remove('hidden');

    exitDialogFocusIndex = 0; // Default focus on "Continuar viendo" (safe option)
    updateExitDialogButtonsFocus();
}

function closeExitDialog() {
    isExitDialogOpen = false;
    const dialog = document.getElementById('tv-exit-dialog');
    if (dialog) dialog.classList.add('hidden');
    resetOverlayHideTimer();
}

function updateExitDialogButtonsFocus() {
    const cancelBtn = document.getElementById('btn-exit-cancel');
    const confirmBtn = document.getElementById('btn-exit-confirm');

    if (cancelBtn && confirmBtn) {
        if (exitDialogFocusIndex === 0) {
            cancelBtn.classList.add('active');
            confirmBtn.classList.remove('active');
        } else {
            confirmBtn.classList.add('active');
            cancelBtn.classList.remove('active');
        }
    }
}

function executeExitApp() {
    console.log("Cerrando aplicación Smart TV...");
    showToast("Cerrando aplicación...");

    // Samsung Tizen TV Exit API
    if (window.tizen && tizen.application) {
        try {
            tizen.application.getCurrentApplication().exit();
            return;
        } catch (e) {
            console.warn("Tizen exit failed:", e);
        }
    }

    // Web / PC fallback
    try {
        window.close();
    } catch (e) {}

    // Visual fallback if window.close() is blocked by browser
    setTimeout(() => {
        document.body.innerHTML = `
            <div style="width:100vw;height:100vh;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;">
                <h1 style="font-size:32px;margin-bottom:12px;">Aplicación Finalizada</h1>
                <p style="color:#aaa;">En el televisor Samsung la app se ha cerrado. Puedes cerrar esta pestaña.</p>
            </div>
        `;
    }, 400);
}

// ==========================================================================
// REMOTE CHANNELS RELOAD (NO REINSTALL REQUIRED)
// ==========================================================================
async function reloadChannelsFromServer() {
    showToast("🔄 Actualizando lista de canales...");
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const serverUrl = getServerUrl();
    const endpoint = token ? `${serverUrl}/api/user/channels?_t=${Date.now()}` : `${serverUrl}/api/channels?_t=${Date.now()}`;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    try {
        const res = await fetch(endpoint, { headers, cache: 'no-cache' });
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.channels) && data.channels.length > 0) {
                const currentUrl = allChannels[currentChannelIndex] ? allChannels[currentChannelIndex].url : null;
                allChannels = data.channels.map((ch, idx) => ({
                    number: String(idx + 1).padStart(3, '0'),
                    name: ch.name || `Canal ${idx + 1}`,
                    logo: ch.logo || '',
                    group: ch.group || 'General',
                    url: ch.url
                }));
                localStorage.setItem(STORAGE_KEY_CACHED_CHANNELS, JSON.stringify(allChannels));

                // Re-render list
                renderVerticalChannelList();

                // Keep same playing channel index if still present
                if (currentUrl) {
                    const foundIdx = allChannels.findIndex(c => c.url === currentUrl);
                    if (foundIdx !== -1) currentChannelIndex = foundIdx;
                }
                if (currentChannelIndex >= allChannels.length) currentChannelIndex = 0;

                updateVerticalCarouselPosition();
                showOverlay();
                resetOverlayHideTimer();
                showToast(`✅ Canales actualizados (${allChannels.length})`);
                return;
            }
        }
        showToast("ℹ️ La lista está al día");
    } catch (err) {
        console.warn("Error recargando canales:", err);
        showToast("⚠️ Servidor no disponible temporalmente");
    }
}

// ==========================================================================
// REMOTE CONTROL & KEYBOARD NAVIGATION (SAMSUNG REMOTE D-PAD)
// ==========================================================================
function initEventListeners() {
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('resize', () => {
        updateVerticalCarouselPosition();
    });

    // Exit Dialog Buttons
    const cancelBtn = document.getElementById('btn-exit-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeExitDialog);
    }

    const confirmBtn = document.getElementById('btn-exit-confirm');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', executeExitApp);
    }
}

function handleGlobalKeyDown(e) {
    const keyCode = e.keyCode || e.which;

    // IF EXIT DIALOG IS OPEN: D-PAD CONTROLS DIALOG
    if (isExitDialogOpen) {
        switch (keyCode) {
            case 37: // Arrow Left
            case 39: // Arrow Right
                exitDialogFocusIndex = exitDialogFocusIndex === 0 ? 1 : 0;
                updateExitDialogButtonsFocus();
                return;

            case 13: // Enter / OK
                if (exitDialogFocusIndex === 0) {
                    closeExitDialog();
                } else {
                    executeExitApp();
                }
                return;

            case 10009: // Tizen Return
            case 10182: // Tizen Exit
            case 27:    // Escape
            case 8:     // Backspace
                closeExitDialog();
                return;
        }
        return;
    }

    // IF OVERLAY IS CURRENTLY FADED: ANY KEY FIRST WAKES UP THE OVERLAY
    const overlay = document.getElementById('tv-main-overlay');
    const isFaded = overlay && overlay.classList.contains('faded-out');

    // REGULAR LIVE TV REMOTE CONTROLS
    switch (keyCode) {
        // Arrow UP or Channel UP -> Previous Channel
        case 38:  // Arrow UP
        case 427: // ChannelUp (Samsung BN59 Rocker)
            selectAndPlayChannel(currentChannelIndex - 1, true);
            break;

        // Arrow DOWN or Channel DOWN -> Next Channel
        case 40:  // Arrow DOWN
        case 428: // ChannelDown (Samsung BN59 Rocker)
            selectAndPlayChannel(currentChannelIndex + 1, true);
            break;

        // OK / ENTER -> Wake overlay or confirm channel
        case 13:
            if (isFaded) {
                showOverlay();
                resetOverlayHideTimer();
            } else {
                // Keep playing current channel and reset hide timer
                resetOverlayHideTimer();
            }
            break;

        // RETURN / BACK / EXIT -> OPEN SAMSUNG TV EXIT DIALOG
        case 10009: // Tizen Return
        case 10182: // Tizen Exit Key
        case 27:    // Escape
        case 8:     // Backspace
            openExitDialog();
            break;

        // Arrow LEFT / RIGHT -> Wake overlay and reset timer
        case 37:
        case 39:
            showOverlay();
            resetOverlayHideTimer();
            break;

        // BLUE KEY or 'R' -> RELOAD CHANNELS FROM CLOUD/SERVER LIVE
        case 406:   // Samsung Remote Blue Key (ColorF3Blue)
        case 82:    // Key 'R' (Keyboard)
        case 10190: // Extra Blue key
            reloadChannelsFromServer();
            break;

        // Media Play/Pause
        case 10252:
        case 415:
        case 19:
        case 32: // Space
            togglePlayPause();
            break;
    }
}

function togglePlayPause() {
    const video = document.getElementById('main-video');
    if (!video) return;
    if (video.paused) {
        video.play().catch(() => {});
        showToast("▶ Reproduciendo");
    } else {
        video.pause();
        showToast("⏸ Pausado");
    }
    showOverlay();
    resetOverlayHideTimer();
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
}
