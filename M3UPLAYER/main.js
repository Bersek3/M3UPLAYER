/**
 * ==========================================================================
 * M3U PLAYER PRO - SAMSUNG SMART TV (TIZEN OS)
 * Engine tailored for Samsung Smart Remote (SolarCell / BN59 series)
 * ==========================================================================
 */

// Global State
let allChannels = [];
let filteredChannels = [];
let categories = [];
let selectedCategory = 'ALL';
let currentChannelIndex = 0;
let activePlayingChannel = null;

let hlsMainInstance = null;
let isFullscreen = true; // ALWAYS START IN FULLSCREEN
let osdHideTimeout = null;
let isDrawerOpen = false;
let drawerFocusedIndex = 0;

let okKeyTimer = null;
let isLongPress = false;

const DEFAULT_ADMIN_PIN = "1234";
const DEFAULT_SERVER_URL = "http://192.168.1.108:3000";

const STORAGE_KEY_TOKEN = "tv_user_token";
const STORAGE_KEY_USERNAME = "tv_user_username";
const STORAGE_KEY_SERVER = "tv_server_url";
const STORAGE_KEY_URL = "m3u_custom_url";
const STORAGE_KEY_CHANNELS = "m3u_cached_channels";
const STORAGE_KEY_LAST_CHANNEL = "m3u_last_played_index";
const STORAGE_KEY_LAST_CHANNEL_URL = "m3u_last_played_url";

function getServerUrl() {
    const saved = localStorage.getItem(STORAGE_KEY_SERVER);
    if (saved) return saved;
    // Auto-detect if served over HTTP/HTTPS from a cloud host (Render, etc.)
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
        const origin = window.location.origin;
        if (origin.indexOf('http') === 0 && origin.indexOf('file://') === -1) {
            return origin;
        }
    }
    return DEFAULT_SERVER_URL;
}

// High quality curated demo channels (Public & Free streams)
const DEMO_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="1" tvg-name="NASA TV HD" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/300px-NASA_logo.svg.png" group-title="Ciencia",NASA TV HD
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 tvg-id="2" tvg-name="DW Español" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_logo.svg/300px-Deutsche_Welle_logo.svg.png" group-title="Noticias",DW Español HD
https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/master.m3u8
#EXTINF:-1 tvg-id="3" tvg-name="Red Bull TV" tvg-logo="https://images.redbull.com/images/w_300/q_auto,f_auto/redbullcom/2016/12/12/1331834279589_2/red-bull-tv-logo.png" group-title="Deportes",Red Bull TV Deportes
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8
#EXTINF:-1 tvg-id="4" tvg-name="Euronews Español" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Euronews_2016_logo.svg/320px-Euronews_2016_logo.svg.png" group-title="Noticias",Euronews Español
https://euronews-euronews-spanish-1-es.samsung.wurl.tv/playlist.m3u8
#EXTINF:-1 tvg-id="5" tvg-name="Big Buck Bunny Cine" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/300px-Big_buck_bunny_poster_big.jpg" group-title="Cine",Big Buck Bunny (4K/FHD)
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="6" tvg-name="Sintel Animation" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Sintel_poster.jpg/300px-Sintel_poster.jpg" group-title="Cine",Sintel Open Movie
https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8
#EXTINF:-1 tvg-id="7" tvg-name="Tears of Steel" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Tears_of_Steel_poster.jpg/300px-Tears_of_Steel_poster.jpg" group-title="Cine",Tears of Steel Sci-Fi
https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8
#EXTINF:-1 tvg-id="8" tvg-name="Bloomberg Live" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Bloomberg_News_logo.svg/320px-Bloomberg_News_logo.svg.png" group-title="Noticias",Bloomberg TV
https://bloomberg.com/media-manifest/streams/us.m3u8
`;

// ==========================================================================
// INITIALIZATION
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    initClock();
    initTizenRemoteKeys();
    initEventListeners();

    // Check if user is logged in
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    if (!token) {
        showTvLoginScreen();
    } else {
        fetchChannelsFromBackend();
    }
});

// ==========================================================================
// TIZEN REMOTE KEYS REGISTRATION (Optimized for Samsung Smart Remote)
// ==========================================================================
function initTizenRemoteKeys() {
    if (window.tizen && tizen.tvinputdevice) {
        try {
            // Register Channel rocker keys (CH Up & CH Down)
            tizen.tvinputdevice.registerKey("ChannelUp");
            tizen.tvinputdevice.registerKey("ChannelDown");
            
            // Register Color keys & Menu
            tizen.tvinputdevice.registerKey("ColorF0Red");     // Red Color Button (via 123 button)
            tizen.tvinputdevice.registerKey("ColorF1Green");   // Green Color Button
            
            // Register Play/Pause media keys
            tizen.tvinputdevice.registerKey("MediaPlay");
            tizen.tvinputdevice.registerKey("MediaPause");
            tizen.tvinputdevice.registerKey("MediaPlayPause");
            
            console.log("Samsung Smart Remote Keys registered successfully.");
        } catch (e) {
            console.warn("Could not register Tizen remote keys:", e);
        }
    }
}

// ==========================================================================
// CLOCK
// ==========================================================================
function initClock() {
    const updateTime = () => {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;
        
        const clockEl = document.getElementById('clock-display');
        const osdClockEl = document.getElementById('osd-clock');
        if (clockEl) clockEl.textContent = timeStr;
        if (osdClockEl) osdClockEl.textContent = timeStr;
    };
    updateTime();
    setInterval(updateTime, 1000);
}

// ==========================================================================
// M3U PARSER
// ==========================================================================
function parseM3U(rawContent) {
    const lines = rawContent.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;
    let channelNumberCounter = 1;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannel = {};
            
            // Number badge
            currentChannel.number = String(channelNumberCounter).padStart(3, '0');
            channelNumberCounter++;

            // Logo
            const logoMatch = line.match(/tvg-logo=["']([^"']+)["']/i);
            currentChannel.logo = logoMatch ? logoMatch[1] : '';

            // Group / Category
            const groupMatch = line.match(/group-title=["']([^"']+)["']/i);
            currentChannel.group = groupMatch ? groupMatch[1].trim() : 'General';

            // Channel name
            const commaIndex = line.lastIndexOf(',');
            if (commaIndex !== -1 && commaIndex < line.length - 1) {
                currentChannel.name = line.substring(commaIndex + 1).trim();
            } else {
                const nameMatch = line.match(/tvg-name=["']([^"']+)["']/i);
                currentChannel.name = nameMatch ? nameMatch[1] : `Canal ${currentChannel.number}`;
            }

        } else if (!line.startsWith('#')) {
            if (currentChannel) {
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }
    }

    return channels;
}

// ==========================================================================
// TV LOGIN & AUTHENTICATION (DUAL-CARD: QR CODE PAIRING + REMOTE LOGIN)
// ==========================================================================
let pairPollInterval = null;

function isTvLoginActive() {
    const overlay = document.getElementById('tv-login-overlay');
    return overlay && !overlay.classList.contains('hidden');
}

function showTvLoginScreen() {
    const overlay = document.getElementById('tv-login-overlay');
    const portalUrlEl = document.getElementById('tv-login-portal-url');
    const usernameInput = document.getElementById('tv-input-username');
    const passwordInput = document.getElementById('tv-input-password');
    const errorEl = document.getElementById('tv-login-error');

    if (overlay) overlay.classList.remove('hidden');
    const currentServerUrl = getServerUrl();
    if (portalUrlEl) portalUrlEl.textContent = currentServerUrl;
    if (errorEl) errorEl.classList.add('hidden');
    if (usernameInput) {
        usernameInput.value = '';
    }
    if (passwordInput) passwordInput.value = '';

    // Stop video playback if active
    const video = document.getElementById('main-video');
    if (video) {
        video.pause();
        video.src = '';
    }
    if (hlsMainInstance) {
        hlsMainInstance.destroy();
        hlsMainInstance = null;
    }
    const playerOverlay = document.getElementById('player-overlay');
    if (playerOverlay) playerOverlay.classList.add('hidden');

    // Initiate QR Pairing Workflow
    startQrPairingWorkflow();
}

function hideTvLoginScreen() {
    stopQrPairingWorkflow();
    const overlay = document.getElementById('tv-login-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function stopQrPairingWorkflow() {
    if (pairPollInterval) {
        clearInterval(pairPollInterval);
        pairPollInterval = null;
    }
}

function startQrPairingWorkflow() {
    stopQrPairingWorkflow();

    const qrBox = document.getElementById('tv-qr-box');
    const pairCodeEl = document.getElementById('tv-pair-code');

    if (pairCodeEl) pairCodeEl.textContent = "------";
    if (qrBox) {
        qrBox.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:14px;text-align:center;">Generando código seguro...</div>';
    }

    const serverUrl = getServerUrl();

    fetch(serverUrl + '/api/auth/pair/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (!isTvLoginActive()) return;

        if (data && data.success && data.pairCode) {
            const pairCode = data.pairCode;
            if (pairCodeEl) pairCodeEl.textContent = pairCode;

            const mobilePairUrl = serverUrl + '/pair.html?code=' + encodeURIComponent(pairCode);

            if (qrBox) {
                qrBox.innerHTML = '';
                try {
                    if (typeof QRCode !== 'undefined') {
                        new QRCode(qrBox, {
                            text: mobilePairUrl,
                            width: 170,
                            height: 170,
                            colorDark: "#0f172a",
                            colorLight: "#ffffff",
                            correctLevel: QRCode.CorrectLevel.M
                        });
                    } else {
                        qrBox.innerHTML = '<div style="padding:10px;font-size:12px;color:#94a3b8;text-align:center;">Abre en tu móvil:<br><strong style="color:#38bdf8;">' + mobilePairUrl + '</strong></div>';
                    }
                } catch(e) {
                    console.warn("QR Render error:", e);
                    qrBox.innerHTML = '<div style="padding:10px;font-size:12px;color:#94a3b8;text-align:center;">Abre en tu móvil:<br><strong style="color:#38bdf8;">' + mobilePairUrl + '</strong></div>';
                }
            }

            // Start polling status every 2 seconds
            pairPollInterval = setInterval(function() {
                checkPairStatus(pairCode);
            }, 2000);
        } else {
            if (qrBox) {
                qrBox.innerHTML = '<div style="padding:15px;color:#f87171;font-size:13px;text-align:center;">No se pudo generar el código QR.<br>Usa el acceso con control remoto.</div>';
            }
        }
    })
    .catch(function(err) {
        console.warn("Pair request error:", err);
        if (qrBox) {
            qrBox.innerHTML = '<div style="padding:15px;color:#f87171;font-size:13px;text-align:center;">Sin conexión al servicio.<br>Usa el acceso con control remoto.</div>';
        }
    });
}

function checkPairStatus(pairCode) {
    if (!isTvLoginActive()) {
        stopQrPairingWorkflow();
        return;
    }

    const serverUrl = getServerUrl();
    fetch(serverUrl + '/api/auth/pair/status?code=' + encodeURIComponent(pairCode))
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data && data.status === 'approved' && data.token) {
            stopQrPairingWorkflow();
            localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
            localStorage.setItem(STORAGE_KEY_USERNAME, data.username || 'Usuario');
            hideTvLoginScreen();
            showToast("¡Dispositivo vinculado con éxito!");
            fetchChannelsFromBackend(true);
        } else if (data && data.status === 'expired') {
            stopQrPairingWorkflow();
            startQrPairingWorkflow();
        }
    })
    .catch(function(err) {
        // Polling network drop
    });
}

function handleTvLogin() {
    const usernameInput = document.getElementById('tv-input-username');
    const passwordInput = document.getElementById('tv-input-password');
    const errorEl = document.getElementById('tv-login-error');
    const submitBtn = document.getElementById('btn-tv-login-submit');

    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        if (errorEl) {
            errorEl.textContent = "Por favor ingresa usuario y contraseña.";
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = "<span>⏳ Verificando credenciales...</span>";
    }

    const serverUrl = getServerUrl();

    fetch(serverUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
    })
    .then(function(res) {
        return res.json();
    })
    .then(function(data) {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>🚀 Iniciar Sesión y Ver TV</span>";
        }

        if (data && data.success && data.token) {
            stopQrPairingWorkflow();
            localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
            localStorage.setItem(STORAGE_KEY_USERNAME, data.username);
            hideTvLoginScreen();
            showToast("¡Bienvenido " + data.username + "!");
            fetchChannelsFromBackend();
        } else {
            if (errorEl) {
                errorEl.textContent = (data && data.error) ? data.error : "Usuario o contraseña incorrectos.";
                errorEl.classList.remove('hidden');
            }
        }
    })
    .catch(function(err) {
        console.warn("Login fetch error:", err);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>🚀 Iniciar Sesión y Ver TV</span>";
        }
        if (errorEl) {
            errorEl.textContent = "No se pudo conectar al servicio. Verifica tu conexión a internet.";
            errorEl.classList.remove('hidden');
        }
    });
}

function handleTvLogout() {
    stopQrPairingWorkflow();
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_USERNAME);
    closeAdminModal();
    showTvLoginScreen();
    showToast("Sesión cerrada.");
}

// ==========================================================================
// PLAYLIST MANAGEMENT & CLOUD SYNC
// ==========================================================================
function fetchChannelsFromBackend(showNotification) {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const username = localStorage.getItem(STORAGE_KEY_USERNAME) || 'Usuario';
    const serverUrl = getServerUrl();

    if (!token) {
        showTvLoginScreen();
        return;
    }

    if (showNotification) {
        showToast("Cargando tus canales...");
    }

    fetch(serverUrl + '/api/user/channels', {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    })
    .then(function(res) {
        if (res.status === 401) {
            handleTvLogout();
            throw new Error("Sesión expirada");
        }
        if (!res.ok) throw new Error("Status: " + res.status);
        return res.json();
    })
    .then(function(data) {
        if (data && Array.isArray(data.channels) && data.channels.length > 0) {
            allChannels = data.channels;
            localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
            finishPlaylistLoad("Mis Canales (" + (data.username || username) + ")");
            if (showNotification) {
                showToast("¡Listo! " + allChannels.length + " canales cargados");
            }
        } else {
            showToast("No tienes canales guardados. Agrega listas desde tu móvil o PC.");
            const cachedData = localStorage.getItem(STORAGE_KEY_CHANNELS);
            if (cachedData) {
                try {
                    allChannels = JSON.parse(cachedData);
                    finishPlaylistLoad("Caché local (" + username + ")");
                } catch(e) {
                    useDemoPlaylist();
                }
            } else {
                useDemoPlaylist();
            }
        }
    })
    .catch(function(err) {
        console.warn("Fallo al conectar con el servicio:", err);
        const cachedData = localStorage.getItem(STORAGE_KEY_CHANNELS);
        if (cachedData) {
            try {
                allChannels = JSON.parse(cachedData);
                finishPlaylistLoad("Modo Sin Conexión (Caché)");
                showToast("Sin conexión al servicio. Mostrando canales guardados.");
            } catch(e) {
                useDemoPlaylist();
            }
        } else {
            useDemoPlaylist();
        }
    });
}

function loadPlaylist() {
    fetchChannelsFromBackend();
}

function useDemoPlaylist() {
    allChannels = parseM3U(DEMO_PLAYLIST);
    finishPlaylistLoad("Lista Pública Demo");
}

function finishPlaylistLoad(sourceInfo) {
    extractCategories();
    renderCategories();
    filterChannels();
    renderDrawerChannels();

    // Update Admin Status in modal
    const statusText = document.getElementById('status-loaded-text');
    const statusCount = document.getElementById('status-channel-count');
    if (statusText) statusText.textContent = "Activa (" + sourceInfo + ")";
    if (statusCount) statusCount.textContent = allChannels.length;

    // Recall last played channel by URL or index
    let savedIndex = 0;
    const lastPlayedUrl = localStorage.getItem(STORAGE_KEY_LAST_CHANNEL_URL);
    if (lastPlayedUrl && filteredChannels && filteredChannels.length > 0) {
        for (let i = 0; i < filteredChannels.length; i++) {
            if (filteredChannels[i].url === lastPlayedUrl) {
                savedIndex = i;
                break;
            }
        }
    } else {
        let idx = parseInt(localStorage.getItem(STORAGE_KEY_LAST_CHANNEL), 10);
        if (!isNaN(idx) && idx >= 0 && idx < filteredChannels.length) {
            savedIndex = idx;
        }
    }

    // ALWAYS OPEN IMMEDIATELY IN FULLSCREEN!
    if (filteredChannels.length > 0) {
        selectAndPlayChannel(savedIndex, true);
    }
}

function extractCategories() {
    const groupsSet = new Set();
    allChannels.forEach(ch => {
        if (ch.group) groupsSet.add(ch.group);
    });
    categories = ['ALL', ...Array.from(groupsSet)];
}

// ==========================================================================
// RENDERING (Categories, Grid & Drawer)
// ==========================================================================
function renderCategories() {
    const container = document.getElementById('category-list');
    if (!container) return;
    container.innerHTML = '';

    categories.forEach((cat, idx) => {
        const chip = document.createElement('button');
        chip.className = `category-chip ${cat === selectedCategory ? 'active' : ''}`;
        chip.textContent = cat === 'ALL' ? '⭐ Todos' : cat;
        chip.dataset.category = cat;
        chip.dataset.index = idx;

        chip.addEventListener('click', () => {
            setCategory(cat);
        });

        container.appendChild(chip);
    });
}

function setCategory(cat) {
    selectedCategory = cat;
    document.querySelectorAll('.category-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.category === cat);
    });

    const catTitle = document.getElementById('current-category-title');
    if (catTitle) {
        catTitle.textContent = cat === 'ALL' ? 'Todos los Canales' : `Canales: ${cat}`;
    }

    filterChannels();
    renderDrawerChannels();
}

function filterChannels() {
    const searchInput = document.getElementById('channel-search');
    const query = (searchInput ? searchInput.value.trim().toLowerCase() : '');

    filteredChannels = allChannels.filter(ch => {
        const matchesCategory = (selectedCategory === 'ALL' || ch.group === selectedCategory);
        const matchesQuery = (!query || 
            ch.name.toLowerCase().includes(query) || 
            ch.number.includes(query) ||
            ch.group.toLowerCase().includes(query)
        );
        return matchesCategory && matchesQuery;
    });

    renderChannelsGrid();
}

// Performance constants for Smart TV
const CHANNELS_CHUNK_SIZE = 40;
const DRAWER_CHUNK_SIZE = 40;
const brokenLogos = new Set();
let renderedGridCount = 0;
let renderedDrawerCount = 0;
let channelSwitchDebounceTimer = null;

function renderChannelsGrid(reset) {
    const grid = document.getElementById('channels-grid');
    const countBadge = document.getElementById('channel-count-badge');
    const emptyState = document.getElementById('empty-state');

    if (countBadge) countBadge.textContent = filteredChannels.length + " canales";
    if (!grid) return;

    if (reset !== false) {
        grid.innerHTML = '';
        renderedGridCount = 0;
    }

    if (filteredChannels.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    } else {
        if (emptyState) emptyState.classList.add('hidden');
    }

    const fragment = document.createDocumentFragment();
    const nextLimit = Math.min(filteredChannels.length, renderedGridCount + CHANNELS_CHUNK_SIZE);

    for (let idx = renderedGridCount; idx < nextLimit; idx++) {
        const ch = filteredChannels[idx];
        const card = document.createElement('div');
        card.className = "channel-card" + (idx === currentChannelIndex ? " focused" : "") + (activePlayingChannel && activePlayingChannel.url === ch.url ? " active-playing" : "");
        card.dataset.index = idx;
        card.tabIndex = 0;

        let logoHtml = '';
        if (ch.logo && ch.logo.trim() !== '' && !brokenLogos.has(ch.logo)) {
            logoHtml = '<img class="channel-logo-img" loading="lazy" src="' + escapeHtml(ch.logo) + '" alt="' + escapeHtml(ch.name) + '" onerror="handleLogoError(this, \'' + escapeHtml(ch.name) + '\')">';
        } else {
            logoHtml = createFallbackLogoHtml(ch.name);
        }

        card.innerHTML = 
            '<div class="card-header-meta">' +
                '<span class="channel-num-badge">#' + ch.number + '</span>' +
                '<span class="channel-group-tag">' + escapeHtml(ch.group) + '</span>' +
            '</div>' +
            '<div class="channel-logo-wrap">' +
                logoHtml +
            '</div>' +
            '<div class="channel-name" title="' + escapeHtml(ch.name) + '">' + escapeHtml(ch.name) + '</div>' +
            '<div class="channel-footer-meta">' +
                '<span class="live-indicator"><span class="pulse-dot"></span> EN VIVO</span>' +
                '<span class="hd-badge">HD</span>' +
            '</div>';

        fragment.appendChild(card);
    }

    grid.appendChild(fragment);
    renderedGridCount = nextLimit;
}

// Render Quick Drawer for In-Video Navigation (Chunked for maximum smoothness)
function renderDrawerChannels(reset) {
    const drawerList = document.getElementById('drawer-channels-list');
    if (!drawerList) return;

    if (reset !== false) {
        drawerList.innerHTML = '';
        renderedDrawerCount = 0;
    }

    const fragment = document.createDocumentFragment();
    const nextLimit = Math.min(filteredChannels.length, renderedDrawerCount + DRAWER_CHUNK_SIZE);

    for (let idx = renderedDrawerCount; idx < nextLimit; idx++) {
        const ch = filteredChannels[idx];
        const item = document.createElement('div');
        item.className = "drawer-item" + (idx === currentChannelIndex ? " active focused" : "");
        item.dataset.index = idx;

        let logoEl = '';
        if (ch.logo && ch.logo.trim() !== '' && !brokenLogos.has(ch.logo)) {
            logoEl = '<img class="drawer-item-logo" loading="lazy" src="' + escapeHtml(ch.logo) + '" alt="" onerror="handleLogoError(this, \'' + escapeHtml(ch.name) + '\')">';
        } else {
            const initials = (ch.name || 'TV').substring(0, 2).toUpperCase();
            logoEl = '<div class="drawer-item-initials">' + escapeHtml(initials) + '</div>';
        }

        item.innerHTML = 
            '<span class="drawer-item-num">#' + ch.number + '</span>' +
            logoEl +
            '<span class="drawer-item-name">' + escapeHtml(ch.name) + '</span>';

        fragment.appendChild(item);
    }

    drawerList.appendChild(fragment);
    renderedDrawerCount = nextLimit;
}

function createFallbackLogoHtml(name) {
    const initials = (name || 'TV')
        .split(' ')
        .slice(0, 2)
        .map(w => w[0])
        .join('')
        .toUpperCase();
    return '<div class="channel-fallback-logo"><span>' + escapeHtml(initials) + '</span></div>';
}

window.handleLogoError = function (imgElement, channelName) {
    if (!imgElement) return;
    if (imgElement.src) {
        brokenLogos.add(imgElement.src);
    }
    const parent = imgElement.parentNode;
    if (parent) {
        parent.innerHTML = createFallbackLogoHtml(channelName);
    }
};

// ==========================================================================
// CHANNEL PLAYBACK & PERSISTENCE (O(1) Ultra-fast DOM updates)
// ==========================================================================
function selectAndPlayChannel(index, fullScreenMode) {
    if (typeof fullScreenMode === 'undefined') fullScreenMode = true;
    if (index < 0 || index >= filteredChannels.length) return;

    currentChannelIndex = index;
    const channel = filteredChannels[index];
    activePlayingChannel = channel;

    // SAVE TO STORAGE: Resume exactly this channel next time app opens!
    localStorage.setItem(STORAGE_KEY_LAST_CHANNEL, index);
    if (channel && channel.url) {
        localStorage.setItem(STORAGE_KEY_LAST_CHANNEL_URL, channel.url);
    }

    // Instant O(1) state update on grid without querying all elements
    const grid = document.getElementById('channels-grid');
    if (grid) {
        const oldCard = grid.querySelector('.channel-card.focused');
        if (oldCard) oldCard.classList.remove('focused', 'active-playing');
        const newCard = grid.querySelector('.channel-card[data-index="' + index + '"]');
        if (newCard) newCard.classList.add('focused', 'active-playing');
    }

    // Instant O(1) state update on drawer without querying all elements
    const drawerList = document.getElementById('drawer-channels-list');
    if (drawerList) {
        const oldItem = drawerList.querySelector('.drawer-item.active');
        if (oldItem) oldItem.classList.remove('active', 'focused');
        const newItem = drawerList.querySelector('.drawer-item[data-index="' + index + '"]');
        if (newItem) newItem.classList.add('active', 'focused');
    }

    if (fullScreenMode) {
        openFullscreen();
    }
}

// Low-memory, low-latency HLS configuration tuned for Samsung Smart TV hardware
function playStream(videoEl, streamUrl) {
    if (!videoEl || !streamUrl) return;

    const loader = document.getElementById('player-buffering');
    const errorOverlay = document.getElementById('player-error');

    if (loader) loader.classList.remove('hidden');
    if (errorOverlay) errorOverlay.classList.add('hidden');

    // Halt preview video to release hardware video decoder
    const previewVideo = document.getElementById('preview-video');
    if (previewVideo && previewVideo !== videoEl && !previewVideo.paused) {
        try { previewVideo.pause(); previewVideo.src = ''; } catch(e) {}
    }

    if (hlsMainInstance) {
        hlsMainInstance.destroy();
        hlsMainInstance = null;
    }

    if (window.Hls && Hls.isSupported() && (streamUrl.indexOf('.m3u8') !== -1 || streamUrl.indexOf('.mp4') === -1)) {
        const hls = new Hls({
            enableWorker: false, // Prevents thread starvation on TV dual/quad-core processors
            lowLatencyMode: false,
            maxBufferLength: 8, // Buffer only 8 seconds ahead (low memory footprint)
            maxMaxBufferLength: 12, // Maximum 12 seconds buffer
            maxBufferSize: 8 * 1024 * 1024, // Strict 8MB memory ceiling for buffer
            backBufferLength: 3, // Aggressively flush played memory
            manifestLoadingTimeOut: 6000,
            manifestLoadingMaxRetry: 2,
            levelLoadingTimeOut: 6000,
            fragLoadingTimeOut: 12000,
            appendErrorMaxRetry: 2
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            videoEl.play().catch(function (e) { console.log("Play gesture wait:", e); });
            if (loader) loader.classList.add('hidden');
        });

        hls.on(Hls.Events.ERROR, function (event, data) {
            if (data.fatal) {
                console.warn("HLS fatal error:", data.type);
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        hls.recoverMediaError();
                        break;
                    default:
                        hls.destroy();
                        if (errorOverlay) errorOverlay.classList.remove('hidden');
                        break;
                }
            }
        });

        hlsMainInstance = hls;

    } else {
        videoEl.src = streamUrl;
        videoEl.play()
            .then(function () { if (loader) loader.classList.add('hidden'); })
            .catch(function (e) { console.warn("Video play error:", e); });
    }

    videoEl.onwaiting = function () { if (loader) loader.classList.remove('hidden'); };
    videoEl.onplaying = function () { if (loader) loader.classList.add('hidden'); };
    videoEl.onerror = function () {
        if (loader) loader.classList.add('hidden');
        if (errorOverlay) errorOverlay.classList.remove('hidden');
    };
}

// ==========================================================================
// FULLSCREEN PLAYER & OSD
// ==========================================================================
function openFullscreen() {
    if (!activePlayingChannel) return;

    isFullscreen = true;
    const overlay = document.getElementById('player-overlay');
    const mainVideo = document.getElementById('main-video');
    const appContainer = document.getElementById('app-container');

    if (overlay) overlay.classList.remove('hidden');
    // Hide background layout so TV GPU doesn't waste CPU/RAM rendering behind the video
    if (appContainer) appContainer.style.display = 'none';

    playStream(mainVideo, activePlayingChannel.url);
    updateOSD(activePlayingChannel);
    showOSD();
}

function closeFullscreen() {
    isFullscreen = false;
    const overlay = document.getElementById('player-overlay');
    const appContainer = document.getElementById('app-container');

    if (overlay) overlay.classList.add('hidden');
    if (appContainer) appContainer.style.display = 'flex';
}

function updateOSD(ch) {
    const osdNumber = document.getElementById('osd-number');
    const osdGroup = document.getElementById('osd-group');
    const osdTitle = document.getElementById('osd-title');
    const osdLogoContainer = document.querySelector('.osd-logo-container');

    if (osdNumber) osdNumber.textContent = "#" + ch.number;
    if (osdGroup) osdGroup.textContent = ch.group;
    if (osdTitle) osdTitle.textContent = ch.name;

    if (osdLogoContainer) {
        if (ch.logo && !brokenLogos.has(ch.logo)) {
            osdLogoContainer.innerHTML = '<img id="osd-logo" src="' + escapeHtml(ch.logo) + '" alt="" onerror="handleLogoError(this, \'' + escapeHtml(ch.name) + '\')">';
        } else {
            osdLogoContainer.innerHTML = createFallbackLogoHtml(ch.name);
        }
    }
}

function showOSD() {
    const osd = document.getElementById('player-osd');
    if (!osd) return;

    osd.classList.remove('hidden-osd');
    clearTimeout(osdHideTimeout);

    osdHideTimeout = setTimeout(() => {
        osd.classList.add('hidden-osd');
    }, 3500);
}

// Debounced channel switching with INSTANT 0ms visual OSD feedback!
function switchChannelRelative(offset) {
    if (filteredChannels.length === 0) return;

    let newIndex = currentChannelIndex + offset;
    if (newIndex < 0) newIndex = filteredChannels.length - 1;
    if (newIndex >= filteredChannels.length) newIndex = 0;

    currentChannelIndex = newIndex;
    const ch = filteredChannels[newIndex];
    activePlayingChannel = ch;

    // 1. Instant OSD feedback (0ms latency!)
    updateOSD(ch);
    showOSD();

    // 2. Debounce the heavy video player reloading by 180ms
    clearTimeout(channelSwitchDebounceTimer);
    channelSwitchDebounceTimer = setTimeout(function () {
        selectAndPlayChannel(currentChannelIndex, true);
    }, 180);
}

// Drawer: Quick Channel List over video
function toggleDrawer() {
    isDrawerOpen ? closeDrawer() : openDrawer();
}

function openDrawer() {
    const drawer = document.getElementById('quick-channels-drawer');
    if (!drawer) return;
    drawer.classList.remove('hidden');
    isDrawerOpen = true;
    drawerFocusedIndex = currentChannelIndex;

    // Render drawer if empty or ensure focused channel is loaded
    if (renderedDrawerCount === 0 || drawerFocusedIndex >= renderedDrawerCount) {
        renderDrawerChannels(true);
        while (drawerFocusedIndex >= renderedDrawerCount && renderedDrawerCount < filteredChannels.length) {
            renderDrawerChannels(false);
        }
    }

    scrollDrawerToItem(drawerFocusedIndex);
}

function closeDrawer() {
    const drawer = document.getElementById('quick-channels-drawer');
    if (!drawer) return;
    drawer.classList.add('hidden');
    isDrawerOpen = false;
}

function navigateDrawer(direction) {
    const drawerList = document.getElementById('drawer-channels-list');
    if (!drawerList) return;

    const oldItem = drawerList.querySelector('.drawer-item.focused');
    if (oldItem) oldItem.classList.remove('focused');

    drawerFocusedIndex += direction;
    if (drawerFocusedIndex < 0) drawerFocusedIndex = filteredChannels.length - 1;
    if (drawerFocusedIndex >= filteredChannels.length) drawerFocusedIndex = 0;

    // Dynamically load more items if navigating near the bottom
    if (drawerFocusedIndex >= renderedDrawerCount - 5 && renderedDrawerCount < filteredChannels.length) {
        renderDrawerChannels(false);
    }

    const newItem = drawerList.querySelector('.drawer-item[data-index="' + drawerFocusedIndex + '"]');
    if (newItem) {
        newItem.classList.add('focused');
        newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function scrollDrawerToItem(index) {
    const drawerList = document.getElementById('drawer-channels-list');
    if (!drawerList) return;
    const item = drawerList.querySelector('.drawer-item[data-index="' + index + '"]');
    if (item) {
        item.classList.add('focused');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ==========================================================================
// HIDDEN ADMIN MODAL (NO VISIBLE BUTTON) & LOCAL FILE UPLOAD
// ==========================================================================
function openHiddenAdminModal() {
    const modal = document.getElementById('admin-modal');
    const pinView = document.getElementById('admin-pin-view');
    const panelView = document.getElementById('admin-panel-view');
    const pinInput = document.getElementById('admin-pin-input');
    const pinError = document.getElementById('pin-error-msg');

    if (!modal) return;

    modal.classList.remove('hidden');
    pinView.classList.remove('hidden');
    panelView.classList.add('hidden');
    if (pinError) pinError.classList.add('hidden');

    if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 150);
    }
}

function closeAdminModal() {
    const modal = document.getElementById('admin-modal');
    if (modal) modal.classList.add('hidden');
}

function verifyAdminPin() {
    const pinInput = document.getElementById('admin-pin-input');
    const pinError = document.getElementById('pin-error-msg');
    const pinView = document.getElementById('admin-pin-view');
    const panelView = document.getElementById('admin-panel-view');
    const urlInput = document.getElementById('m3u-url-input');

    if (!pinInput) return;

    if (pinInput.value.trim() === DEFAULT_ADMIN_PIN) {
        pinView.classList.add('hidden');
        panelView.classList.remove('hidden');
        if (pinError) pinError.classList.add('hidden');

        if (urlInput) {
            urlInput.value = localStorage.getItem(STORAGE_KEY_URL) || '';
            urlInput.focus();
        }

        const serverInput = document.getElementById('server-url-input');
        if (serverInput) {
            serverInput.value = getServerUrl();
        }
    } else {
        if (pinError) pinError.classList.remove('hidden');
        pinInput.value = '';
        pinInput.focus();
    }
}

function saveCustomM3UUrl() {
    const urlInput = document.getElementById('m3u-url-input');
    if (!urlInput) return;

    const newUrl = urlInput.value.trim();
    if (!newUrl) {
        showToast("Por favor ingresa un link M3U válido");
        return;
    }

    localStorage.setItem(STORAGE_KEY_URL, newUrl);
    closeAdminModal();
    showToast("Descargando nueva lista M3U...");
    loadPlaylist();
}

// Local File Upload Handler (.m3u / .m3u8)
let pendingFileContent = null;

function handleLocalFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const label = document.getElementById('selected-file-label');
    const loadBtn = document.getElementById('btn-load-file');

    if (label) label.textContent = `Archivo: ${file.name} (${Math.round(file.size / 1024)} KB)`;

    const reader = new FileReader();
    reader.onload = function (e) {
        pendingFileContent = e.target.result;
        if (loadBtn) loadBtn.removeAttribute('disabled');
        showToast("Archivo leído. Pulsa 'Procesar y Guardar'.");
    };
    reader.onerror = function () {
        showToast("Error al leer el archivo local");
    };
    reader.readAsText(file);
}

function processAndSaveLocalFile() {
    if (!pendingFileContent) return;

    const parsed = parseM3U(pendingFileContent);
    if (parsed.length === 0) {
        showToast("El archivo no contiene canales válidos en formato M3U");
        return;
    }

    allChannels = parsed;
    localStorage.removeItem(STORAGE_KEY_URL); // Clear remote url so it uses local file
    localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
    localStorage.setItem(STORAGE_KEY_LAST_CHANNEL, 0);

    closeAdminModal();
    finishPlaylistLoad("Archivo local subido");
    showToast(`¡Éxito! ${allChannels.length} canales cargados.`);
}

function clearCustomM3U() {
    if (confirm("¿Seguro que deseas borrar la lista configurada y volver a la demo?")) {
        localStorage.removeItem(STORAGE_KEY_URL);
        localStorage.removeItem(STORAGE_KEY_CHANNELS);
        localStorage.setItem(STORAGE_KEY_LAST_CHANNEL, 0);
        closeAdminModal();
        useDemoPlaylist();
        showToast("Lista restablecida a los canales de fábrica");
    }
}

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
let toastTimeout = null;
function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = msg;
    toast.classList.remove('hidden');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3500);
}

// ==========================================================================
// SAMSUNG SMART REMOTE (BN59) MAPPING & KEYBOARD HANDLERS
// ==========================================================================
function initEventListeners() {
    // Admin modal tabs (Remote URL vs Local File)
    const tabBtnUrl = document.getElementById('tab-btn-url');
    const tabBtnFile = document.getElementById('tab-btn-file');
    const tabUrl = document.getElementById('admin-tab-url');
    const tabFile = document.getElementById('admin-tab-file');

    if (tabBtnUrl && tabBtnFile) {
        tabBtnUrl.addEventListener('click', () => {
            tabBtnUrl.classList.add('active');
            tabBtnFile.classList.remove('active');
            tabUrl.classList.remove('hidden');
            tabFile.classList.add('hidden');
        });

        tabBtnFile.addEventListener('click', () => {
            tabBtnFile.classList.add('active');
            tabBtnUrl.classList.remove('active');
            tabFile.classList.remove('hidden');
            tabUrl.classList.add('hidden');
        });
    }

    // Local file trigger & process
    const fileInput = document.getElementById('m3u-file-input');
    const triggerFileBtn = document.getElementById('btn-trigger-file');
    const loadFileBtn = document.getElementById('btn-load-file');

    if (triggerFileBtn && fileInput) {
        triggerFileBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleLocalFileSelect);
    }

    if (loadFileBtn) {
        loadFileBtn.addEventListener('click', processAndSaveLocalFile);
    }

    // Admin PIN & Save buttons
    const closeBtn = document.getElementById('btn-close-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeAdminModal);

    const submitPinBtn = document.getElementById('btn-submit-pin');
    if (submitPinBtn) submitPinBtn.addEventListener('click', verifyAdminPin);

    const saveM3uBtn = document.getElementById('btn-save-m3u');
    if (saveM3uBtn) saveM3uBtn.addEventListener('click', saveCustomM3UUrl);

    const loadDemoBtn = document.getElementById('btn-load-demo');
    if (loadDemoBtn) {
        loadDemoBtn.addEventListener('click', () => {
            localStorage.removeItem(STORAGE_KEY_URL);
            localStorage.removeItem(STORAGE_KEY_CHANNELS);
            closeAdminModal();
            useDemoPlaylist();
        });
    }

    const clearM3uBtn = document.getElementById('btn-clear-m3u');
    if (clearM3uBtn) clearM3uBtn.addEventListener('click', clearCustomM3U);

    // Search input
    const searchInput = document.getElementById('channel-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => filterChannels());
    }

    // TV Login submit button
    const tvLoginBtn = document.getElementById('btn-tv-login-submit');
    if (tvLoginBtn) {
        tvLoginBtn.addEventListener('click', handleTvLogin);
    }

    // Cloud sync button
    const syncCloudBtn = document.getElementById('btn-sync-cloud');
    if (syncCloudBtn) {
        syncCloudBtn.addEventListener('click', function() {
            closeAdminModal();
            fetchChannelsFromBackend(true);
        });
    }

    // TV Logout button
    const tvLogoutBtn = document.getElementById('btn-tv-logout');
    if (tvLogoutBtn) {
        tvLogoutBtn.addEventListener('click', function() {
            if (confirm("¿Deseas cerrar sesión en esta TV?")) {
                handleTvLogout();
            }
        });
    }

    // Server URL input changes
    const serverInput = document.getElementById('server-url-input');
    if (serverInput) {
        serverInput.addEventListener('change', function() {
            const val = serverInput.value.trim();
            if (val) {
                localStorage.setItem(STORAGE_KEY_SERVER, val);
                showToast("Servidor actualizado: " + val);
            }
        });
    }

    // Delegated click for Channels Grid (ultra-fast, zero per-card listeners)
    const grid = document.getElementById('channels-grid');
    if (grid) {
        grid.addEventListener('click', function (e) {
            const card = e.target.closest('.channel-card');
            if (card && card.dataset.index) {
                selectAndPlayChannel(parseInt(card.dataset.index, 10), true);
            }
        });
        grid.addEventListener('scroll', function () {
            if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 300) {
                if (renderedGridCount < filteredChannels.length) {
                    renderChannelsGrid(false);
                }
            }
        });
    }

    // Delegated click for Quick Drawer
    const drawerList = document.getElementById('drawer-channels-list');
    if (drawerList) {
        drawerList.addEventListener('click', function (e) {
            const item = e.target.closest('.drawer-item');
            if (item && item.dataset.index) {
                selectAndPlayChannel(parseInt(item.dataset.index, 10), true);
                closeDrawer();
            }
        });
    }

    // Close player button (return to grid)
    const closePlayerBtn = document.getElementById('btn-close-player');
    if (closePlayerBtn) {
        closePlayerBtn.addEventListener('click', closeFullscreen);
    }

    // Global Keydown & Keyup (Long Press OK support)
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);
}

function handleGlobalKeyDown(e) {
    const keyCode = e.keyCode || e.which;

    // Detect Long Press on OK / Enter (3 seconds) to open Admin Menu
    if (keyCode === 13 && !okKeyTimer) {
        isLongPress = false;
        okKeyTimer = setTimeout(() => {
            isLongPress = true;
            openHiddenAdminModal();
        }, 2500);
    }

    // If TV Login Screen is active:
    if (isTvLoginActive()) {
        const usernameInput = document.getElementById('tv-input-username');
        const passwordInput = document.getElementById('tv-input-password');
        const submitBtn = document.getElementById('btn-tv-login-submit');

        switch (keyCode) {
            case 38: // Arrow Up
                if (document.activeElement === submitBtn) {
                    if (passwordInput) passwordInput.focus();
                } else if (document.activeElement === passwordInput) {
                    if (usernameInput) usernameInput.focus();
                }
                return;

            case 40: // Arrow Down
                if (document.activeElement === usernameInput) {
                    if (passwordInput) passwordInput.focus();
                } else if (document.activeElement === passwordInput) {
                    if (submitBtn) submitBtn.focus();
                }
                return;

            case 13: // Enter / OK
                if (document.activeElement === usernameInput) {
                    if (passwordInput) passwordInput.focus();
                } else {
                    handleTvLogin();
                }
                return;

            case 10009: // Return / Exit
            case 27:
                if (confirm("¿Deseas salir de la aplicación?")) {
                    if (window.tizen && tizen.application) {
                        tizen.application.getCurrentApplication().exit();
                    }
                }
                return;
        }
        return; // Block other media/channel keys while login is active
    }

    // If Admin Modal is open:
    const modal = document.getElementById('admin-modal');
    if (modal && !modal.classList.contains('hidden')) {
        if (keyCode === 13) {
            const pinView = document.getElementById('admin-pin-view');
            if (!pinView.classList.contains('hidden')) {
                verifyAdminPin();
            } else {
                saveCustomM3UUrl();
            }
        } else if (keyCode === 10009 || keyCode === 27) { // Return / Escape
            closeAdminModal();
        }
        return;
    }

    // Direct Remote Control Key Mapping for Samsung SolarCell / Smart Remote
    switch (keyCode) {
        // Balancín CH (Channel Rocker)
        case 427: // ChannelUp
            switchChannelRelative(1);
            return;
        case 428: // ChannelDown
            switchChannelRelative(-1);
            return;

        // Botón Menú (☰) o Botón Rojo (123 -> Rojo) -> Abre panel Admin
        case 10133: // Menu Key
        case 18:    // Alt / Menu
        case 403:   // ColorF0Red (Botón Rojo)
            openHiddenAdminModal();
            return;

        // Botón Play / Pause (⏯)
        case 10252: // MediaPlayPause
        case 415:   // MediaPlay
        case 19:    // MediaPause
            togglePlayPause();
            return;

        // Flecha ARRIBA
        case 38:
            if (isDrawerOpen) {
                navigateDrawer(-1);
            } else if (isFullscreen) {
                switchChannelRelative(-1);
            } else {
                navigateGridRelative(-1);
            }
            return;

        // Flecha ABAJO
        case 40:
            if (isDrawerOpen) {
                navigateDrawer(1);
            } else if (isFullscreen) {
                switchChannelRelative(1);
            } else {
                navigateGridRelative(1);
            }
            return;

        // Flecha DERECHA / IZQUIERDA
        case 39: // Right
        case 37: // Left
            if (isFullscreen) {
                toggleDrawer();
            }
            return;

        // Botón ATRÁS / RETURN (↩)
        case 10009: // Tizen Return
        case 27:    // Escape (PC)
        case 8:     // Backspace (PC)
            if (isDrawerOpen) {
                closeDrawer();
            } else if (isFullscreen) {
                closeFullscreen();
                showToast("Pulsa ATRÁS para salir");
            } else {
                // Confirm exit
                if (confirm("¿Deseas salir de la aplicación?")) {
                    if (window.tizen && tizen.application) {
                        tizen.application.getCurrentApplication().exit();
                    }
                }
            }
            return;
    }
}

function navigateGridRelative(offset) {
    if (filteredChannels.length === 0) return;
    let nextIndex = currentChannelIndex + offset;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= filteredChannels.length) nextIndex = filteredChannels.length - 1;

    // Load next batch when scrolling near bottom
    if (nextIndex >= renderedGridCount - 6 && renderedGridCount < filteredChannels.length) {
        renderChannelsGrid(false);
    }

    currentChannelIndex = nextIndex;
    const grid = document.getElementById('channels-grid');
    if (grid) {
        const oldCard = grid.querySelector('.channel-card.focused');
        if (oldCard) oldCard.classList.remove('focused');
        const newCard = grid.querySelector('.channel-card[data-index="' + nextIndex + '"]');
        if (newCard) {
            newCard.classList.add('focused');
            newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

function handleGlobalKeyUp(e) {
    const keyCode = e.keyCode || e.which;

    if (keyCode === 13) {
        clearTimeout(okKeyTimer);
        okKeyTimer = null;

        // If TV Login is active, don't trigger drawer or channel play
        if (isTvLoginActive()) return;

        // If it was not a long press:
        if (!isLongPress) {
            const modal = document.getElementById('admin-modal');
            if (modal && !modal.classList.contains('hidden')) return;

            if (isDrawerOpen) {
                selectAndPlayChannel(drawerFocusedIndex, true);
                closeDrawer();
            } else if (isFullscreen) {
                // Toggle Channel Quick Drawer on OK press
                toggleDrawer();
            } else {
                // Play focused card in fullscreen
                selectAndPlayChannel(currentChannelIndex, true);
            }
        }
        isLongPress = false;
    }
}

function togglePlayPause() {
    const video = document.getElementById('main-video');
    if (!video) return;

    if (video.paused) {
        video.play();
        showToast("▶ Reanudado");
    } else {
        video.pause();
        showToast("⏸ Pausado");
    }
}

// Safe HTML helper
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
