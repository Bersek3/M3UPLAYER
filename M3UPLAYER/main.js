/**
 * M3U TV PRO - SAMSUNG SMART TV (TIZEN OS)
 * State-of-the-Art Channel Selection, Dynamic Spotlight Hero,
 * Bug-Free 2D D-Pad Navigation, and QR-Only Mobile Pairing via GitHub Pages
 */

// ==========================================================================
// STATE MANAGEMENT
// ==========================================================================
let allChannels = [];
let filteredChannels = [];
let categories = ['ALL'];
let selectedCategory = 'ALL';
let currentChannelIndex = 0;
let activePlayingChannel = null;

let hlsMainInstance = null;
let isFullscreen = false;
let osdHideTimeout = null;
let isDrawerOpen = false;
let drawerFocusedIndex = 0;

let okKeyTimer = null;
let isLongPress = false;

let streamRetryCount = 0;
const MAX_STREAM_RETRIES = 3;

const DEFAULT_ADMIN_PIN = "1234";
const DEFAULT_SERVER_URL = "https://m3uplayer-yw7z.onrender.com";
const GITHUB_PAGES_PAIR_URL = "https://bersek3.github.io/M3UPLAYER/pair.html";

const STORAGE_KEY_TOKEN = "tv_user_token";
const STORAGE_KEY_USERNAME = "tv_user_username";
const STORAGE_KEY_SERVER = "tv_server_url";
const STORAGE_KEY_URL = "m3u_custom_url";
const STORAGE_KEY_CHANNELS = "m3u_cached_channels";
const STORAGE_KEY_LAST_CHANNEL = "m3u_last_played_index";
const STORAGE_KEY_LAST_CHANNEL_URL = "m3u_last_played_url";

let currentNavZone = 'GRID'; // 'GRID', 'CATEGORIES', 'TOPBAR'
let categoryNavIndex = 0;

let pairPollInterval = null;
const brokenLogos = new Set();

function getServerUrl() {
    const saved = localStorage.getItem(STORAGE_KEY_SERVER);
    if (saved) return saved;
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
        const origin = window.location.origin;
        if (origin.indexOf('http') === 0 && origin.indexOf('file://') === -1 && !origin.includes('github.io')) {
            return origin;
        }
    }
    return DEFAULT_SERVER_URL;
}

// Curated high quality fallback demo channels
const DEMO_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="1" tvg-name="NASA TV HD" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/300px-NASA_logo.svg.png" group-title="Ciencia",NASA TV HD
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 tvg-id="2" tvg-name="DW Español" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_logo.svg/300px-Deutsche_Welle_logo.svg.png" group-title="Noticias",DW Español HD
https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/master.m3u8
#EXTINF:-1 tvg-id="3" tvg-name="Red Bull TV" tvg-logo="https://images.redbull.com/images/w_300/q_auto,f_auto/redbullcom/2016/12/12/1331834279589_2/red-bull-tv-logo.png" group-title="Deportes",Red Bull TV Deportes
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8
#EXTINF:-1 tvg-id="4" tvg-name="Euronews Español" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Euronews_2016_logo.svg/320px-Euronews_2016_logo.svg.png" group-title="Noticias",Euronews Español
https://euronews-euronews-spanish-1-es.samsung.wurl.tv/playlist.m3u8
#EXTINF:-1 tvg-id="5" tvg-name="Big Buck Bunny" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/300px-Big_buck_bunny_poster_big.jpg" group-title="Cine",Big Buck Bunny (FHD)
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
    updateUserSessionUI();

    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const customUrl = localStorage.getItem(STORAGE_KEY_URL);
    const cachedChannels = localStorage.getItem(STORAGE_KEY_CHANNELS);

    if (token) {
        // User is logged in: fetch their channels from backend!
        fetchChannelsFromBackend(true);
    } else if (customUrl) {
        // User configured a custom M3U URL in admin settings
        loadCustomM3UUrl(customUrl);
    } else if (cachedChannels) {
        try {
            allChannels = JSON.parse(cachedChannels);
            if (allChannels && allChannels.length > 0) {
                finishPlaylistLoad("Canales Guardados");
            } else {
                loadDefaultPlaylist();
            }
        } catch (e) {
            loadDefaultPlaylist();
        }
    } else {
        // First boot without token: load default channels and offer QR pairing!
        loadDefaultPlaylist();
        // Show QR pairing overlay so user can easily link their account via mobile
        showTvLoginScreen();
    }
});

// Update topbar UI based on active session
function updateUserSessionUI() {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const username = localStorage.getItem(STORAGE_KEY_USERNAME);
    const accountBtn = document.getElementById('btn-user-account');
    const accountIcon = document.getElementById('account-btn-icon');
    const accountLabel = document.getElementById('account-btn-label');
    const logoutBtn = document.getElementById('btn-tv-logout');
    const statusUser = document.getElementById('status-user-text');

    if (token && username) {
        if (accountIcon) accountIcon.textContent = "👤";
        if (accountLabel) accountLabel.textContent = `@${username}`;
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        if (statusUser) statusUser.textContent = `@${username} (Activo)`;
    } else {
        if (accountIcon) accountIcon.textContent = "📱";
        if (accountLabel) accountLabel.textContent = "Vincular Celular (QR)";
        if (logoutBtn) logoutBtn.classList.add('hidden');
        if (statusUser) statusUser.textContent = "Sin cuenta vinculada";
    }
}

// ==========================================================================
// TIZEN REMOTE KEYS REGISTRATION (Samsung Smart Remote / SolarCell BN59)
// ==========================================================================
function initTizenRemoteKeys() {
    if (window.tizen && tizen.tvinputdevice) {
        try {
            tizen.tvinputdevice.registerKey("ChannelUp");
            tizen.tvinputdevice.registerKey("ChannelDown");
            tizen.tvinputdevice.registerKey("ColorF0Red");     // Red Color Button (via 123)
            tizen.tvinputdevice.registerKey("ColorF1Green");   // Green Color Button
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
// M3U / M3U8 PARSER (With UTF-8 Sanitation & Clean Categories)
// ==========================================================================
function sanitizeText(str) {
    if (!str) return '';
    try {
        return decodeURIComponent(escape(str));
    } catch (e) {
        return str
            .replace(/Ã‘/g, 'Ñ').replace(/Ã±/g, 'ñ')
            .replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é')
            .replace(/Ã­/g, 'í').replace(/Ã³/g, 'ó')
            .replace(/Ãº/g, 'ú').replace(/Ã/g, 'Í');
    }
}

function normalizeCategoryName(group) {
    if (!group) return 'General';
    let g = sanitizeText(group).trim();
    if (!g) return 'General';

    // Capitalize first letter
    g = g.charAt(0).toUpperCase() + g.slice(1);

    // Normalize common English/Spanish tags
    const lower = g.toLowerCase();
    if (lower === 'news') return 'Noticias';
    if (lower === 'music') return 'Música';
    if (lower === 'sports') return 'Deportes';
    if (lower === 'movies' || lower === 'cinema') return 'Cine';
    if (lower === 'kids') return 'Infantil';

    return g;
}

function extractChannelNameFromUrl(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
            let last = parts[parts.length - 1];
            last = last.replace(/\.(m3u8|m3u|ts|mp4|mkv)$/i, '');
            last = decodeURIComponent(last).replace(/[-_]/g, ' ').trim();
            if (last && last.toLowerCase() !== 'master' && last.toLowerCase() !== 'index' && last.toLowerCase() !== 'playlist' && last.toLowerCase() !== 'live') {
                return last.charAt(0).toUpperCase() + last.slice(1);
            }
            if (parts.length > 1) {
                let prev = parts[parts.length - 2];
                prev = decodeURIComponent(prev).replace(/[-_]/g, ' ').trim();
                if (prev) return prev.charAt(0).toUpperCase() + prev.slice(1);
            }
        }
    } catch (e) {}
    return 'Canal En Vivo';
}

function parseM3U(rawContent, sourceUrl = '', defaultName = '') {
    if (!rawContent || typeof rawContent !== 'string') return [];

    let text = rawContent.replace(/^\uFEFF/, '').trim();
    if (!text) return [];

    // Direct single HLS Stream link (.m3u8 master playlist or media playlist)
    const isDirectHlsStream = (
        sourceUrl && (sourceUrl.toLowerCase().includes('.m3u8') || sourceUrl.toLowerCase().includes('.ts')) &&
        (text.includes('#EXT-X-STREAM-INF') || text.includes('#EXT-X-TARGETDURATION') || text.includes('#EXT-X-MEDIA-SEQUENCE')) &&
        !text.includes('group-title=') && !text.includes('tvg-name=')
    );

    if (isDirectHlsStream) {
        const channelName = defaultName || extractChannelNameFromUrl(sourceUrl) || 'Canal M3U8 En Vivo';
        return [{
            number: '001',
            name: sanitizeText(channelName),
            logo: '',
            group: 'En Vivo',
            url: sourceUrl
        }];
    }

    const lines = text.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;
    let channelNumberCounter = 1;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannel = {};
            currentChannel.number = String(channelNumberCounter).padStart(3, '0');
            channelNumberCounter++;

            // Extract tvg-logo
            const logoMatch = line.match(/tvg-logo=["']([^"']+)["']/i);
            currentChannel.logo = logoMatch ? logoMatch[1].trim() : '';

            // Extract group-title
            const groupMatch = line.match(/group-title=["']([^"']+)["']/i);
            currentChannel.group = normalizeCategoryName(groupMatch ? groupMatch[1].trim() : 'General');

            // Extract channel name
            const commaIndex = line.lastIndexOf(',');
            if (commaIndex !== -1 && commaIndex < line.length - 1) {
                currentChannel.name = sanitizeText(line.substring(commaIndex + 1).trim());
            } else {
                const nameMatch = line.match(/tvg-name=["']([^"']+)["']/i);
                currentChannel.name = nameMatch ? sanitizeText(nameMatch[1].trim()) : `Canal ${currentChannel.number}`;
            }

            // Cleanup quotes
            currentChannel.name = currentChannel.name.replace(/^["']|["']$/g, '');

        } else if (line.startsWith('#EXTGRP:')) {
            if (currentChannel && (!currentChannel.group || currentChannel.group === 'General')) {
                currentChannel.group = normalizeCategoryName(line.substring(8).trim());
            }
        } else if (!line.startsWith('#')) {
            if (currentChannel) {
                let streamUrl = line;
                if (sourceUrl && !streamUrl.startsWith('http://') && !streamUrl.startsWith('https://') && !streamUrl.startsWith('rtmp://')) {
                    try {
                        streamUrl = new URL(streamUrl, sourceUrl).href;
                    } catch (e) {}
                }
                currentChannel.url = streamUrl;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }
    }

    // Plain text list of URLs
    if (channels.length === 0) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('http://') || line.startsWith('https://')) {
                const name = extractChannelNameFromUrl(line);
                channels.push({
                    number: String(channelNumberCounter).padStart(3, '0'),
                    name: sanitizeText(name),
                    logo: '',
                    group: 'General',
                    url: line
                });
                channelNumberCounter++;
            }
        }
    }

    if (channels.length === 0 && sourceUrl && (sourceUrl.includes('.m3u8') || sourceUrl.startsWith('http'))) {
        channels.push({
            number: '001',
            name: defaultName || extractChannelNameFromUrl(sourceUrl) || 'Canal M3U8',
            logo: '',
            group: 'En Vivo',
            url: sourceUrl
        });
    }

    return channels;
}

// ==========================================================================
// PLAYLIST MANAGEMENT & CLOUD SYNC
// ==========================================================================
function fetchChannelsFromBackend(showNotification) {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const username = localStorage.getItem(STORAGE_KEY_USERNAME) || 'Usuario';
    const serverUrl = getServerUrl();

    if (!token) {
        loadDefaultPlaylist();
        return;
    }

    if (showNotification) {
        showToast("Sincronizando canales de tu cuenta...");
    }

    fetch(serverUrl + '/api/user/channels', {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    })
    .then(res => {
        if (!res.ok) throw new Error("Status: " + res.status);
        return res.json();
    })
    .then(data => {
        if (data && Array.isArray(data.channels) && data.channels.length > 0) {
            allChannels = data.channels.map((ch, idx) => ({
                number: ch.number || String(idx + 1).padStart(3, '0'),
                name: sanitizeText(ch.name),
                logo: ch.logo || '',
                group: normalizeCategoryName(ch.group),
                url: ch.url
            }));
            localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
            finishPlaylistLoad(`Cuenta @${data.username || username}`);
            if (showNotification) {
                showToast(`¡Listo! ${allChannels.length} canales sincronizados`);
            }
        } else {
            loadDefaultPlaylist();
        }
    })
    .catch(err => {
        console.warn("Fallo al conectar con el servidor:", err);
        const cachedData = localStorage.getItem(STORAGE_KEY_CHANNELS);
        if (cachedData) {
            try {
                allChannels = JSON.parse(cachedData);
                finishPlaylistLoad("Caché Local");
            } catch (e) {
                loadDefaultPlaylist();
            }
        } else {
            loadDefaultPlaylist();
        }
    });
}

function loadCustomM3UUrl(url) {
    if (!url) return;
    showToast("Cargando lista M3U8...");

    const serverUrl = getServerUrl();
    const proxyUrl = serverUrl + '/api/proxy/m3u?url=' + encodeURIComponent(url);

    fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 TV Safari/538.1',
            'Accept': '*/*'
        }
    })
    .then(res => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
    })
    .then(text => {
        const parsed = parseM3U(text, url, 'Lista M3U8');
        if (parsed.length > 0) {
            allChannels = parsed;
            localStorage.setItem(STORAGE_KEY_URL, url);
            localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
            finishPlaylistLoad("Lista M3U8");
            showToast("¡Éxito! " + allChannels.length + " canales cargados");
        } else {
            throw new Error("Sin canales válidos");
        }
    })
    .catch(err => {
        console.warn("Fetch directo falló, probando proxy:", err.message);
        fetch(proxyUrl)
        .then(res => {
            if (!res.ok) throw new Error("Proxy HTTP " + res.status);
            return res.text();
        })
        .then(text => {
            const parsed = parseM3U(text, url, 'Lista M3U8');
            if (parsed.length > 0) {
                allChannels = parsed;
                localStorage.setItem(STORAGE_KEY_URL, url);
                localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
                finishPlaylistLoad("Lista M3U8 (proxy)");
                showToast("¡Éxito! " + allChannels.length + " canales (vía proxy)");
            } else {
                throw new Error("Sin canales vía proxy");
            }
        })
        .catch(err2 => {
            console.warn("Proxy también falló:", err2.message);
            if (url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.ts')) {
                allChannels = [{
                    number: '001',
                    name: extractChannelNameFromUrl(url) || 'Canal M3U8 En Vivo',
                    logo: '',
                    group: 'En Vivo',
                    url: url
                }];
                localStorage.setItem(STORAGE_KEY_URL, url);
                localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
                finishPlaylistLoad("Canal M3U8 Directo");
            } else {
                showToast("Error: No se pudo cargar la lista. Revisa la URL.");
                useDemoPlaylist();
            }
        });
    });
}

function loadDefaultPlaylist() {
    // 1. Try bundled channels.m3u in the Tizen app package
    fetch('channels.m3u')
    .then(res => {
        if (!res.ok) throw new Error("channels.m3u no encontrado localmente");
        return res.text();
    })
    .then(text => {
        const parsed = parseM3U(text, 'channels.m3u', 'Canales Chile');
        if (parsed.length > 0) {
            allChannels = parsed;
            localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
            finishPlaylistLoad("Canales Chile (" + allChannels.length + ")");
            return;
        }
        throw new Error("Sin canales válidos en channels.m3u");
    })
    .catch(err => {
        console.log("Cargando canales demo fallback:", err.message);
        useDemoPlaylist();
    });
}

function useDemoPlaylist() {
    allChannels = parseM3U(DEMO_PLAYLIST);
    finishPlaylistLoad("Canales Demo");
}

function finishPlaylistLoad(sourceInfo) {
    extractCategories();
    renderCategories();
    filterChannels();
    renderDrawerChannels();

    const statusText = document.getElementById('status-loaded-text');
    const statusCount = document.getElementById('status-channel-count');
    if (statusText) statusText.textContent = "Activa (" + sourceInfo + ")";
    if (statusCount) statusCount.textContent = allChannels.length;

    // Recall last played channel
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

    currentChannelIndex = savedIndex;
    updateFocusedCard();
    updateSpotlightBanner(filteredChannels[currentChannelIndex]);
}

function extractCategories() {
    const groupsSet = new Set();
    allChannels.forEach(ch => {
        if (ch.group) groupsSet.add(ch.group);
    });
    categories = ['ALL', ...Array.from(groupsSet)];
}

// ==========================================================================
// RENDERING & UI ENGINE
// ==========================================================================
function renderCategories() {
    const container = document.getElementById('category-list');
    if (!container) return;
    container.innerHTML = '';

    categories.forEach((cat, idx) => {
        const chip = document.createElement('button');
        const isActive = (cat === selectedCategory);
        chip.className = `category-chip ${isActive ? 'active' : ''}`;
        chip.dataset.category = cat;
        chip.dataset.index = idx;

        // Count channels in this category
        const count = (cat === 'ALL') ? allChannels.length : allChannels.filter(c => c.group === cat).length;
        const icon = getCategoryIcon(cat);
        chip.innerHTML = `${icon} <span>${cat === 'ALL' ? 'Todos' : cat}</span> <span class="count-badge" style="padding:1px 6px; font-size:11px;">${count}</span>`;

        chip.addEventListener('click', () => {
            setCategory(cat);
        });

        container.appendChild(chip);
    });
}

function getCategoryIcon(cat) {
    const l = cat.toLowerCase();
    if (cat === 'ALL') return '⭐';
    if (l.includes('noticia') || l.includes('news')) return '📰';
    if (l.includes('deporte') || l.includes('sport')) return '⚽';
    if (l.includes('cine') || l.includes('movie') || l.includes('film')) return '🎬';
    if (l.includes('música') || l.includes('musica') || l.includes('music')) return '🎵';
    if (l.includes('ciencia') || l.includes('doc')) return '🔬';
    if (l.includes('infantil') || l.includes('kid')) return '🧸';
    return '📺';
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

    currentChannelIndex = 0;
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

    if (currentChannelIndex >= filteredChannels.length) {
        currentChannelIndex = 0;
    }

    renderChannelsGrid();

    if (filteredChannels.length > 0) {
        updateSpotlightBanner(filteredChannels[currentChannelIndex]);
    }
}

function isValidLogoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed.length < 8) return false;
    if (trimmed.startsWith('.') || trimmed === '.png' || trimmed === '.jpg') return false;
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

// Generate distinct color palette for monogram fallback based on channel name
function getMonogramGradient(name) {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const gradients = [
        'linear-gradient(135deg, #1e3a8a, #00e5ff)',
        'linear-gradient(135deg, #4c1d95, #8b5cf6)',
        'linear-gradient(135deg, #065f46, #10b981)',
        'linear-gradient(135deg, #991b1b, #f59e0b)',
        'linear-gradient(135deg, #1e293b, #3b82f6)',
        'linear-gradient(135deg, #831843, #ec4899)'
    ];
    return gradients[Math.abs(hash) % gradients.length];
}

function createFallbackLogoHtml(name) {
    const initials = (name || 'TV')
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0])
        .join('')
        .toUpperCase() || 'TV';
    const bg = getMonogramGradient(name);
    return `<div class="channel-fallback-logo" style="background:${bg};"><span>${escapeHtml(initials)}</span></div>`;
}

window.handleLogoError = function (imgElement, channelName) {
    if (!imgElement) return;
    imgElement.onerror = null;
    if (imgElement.src) {
        brokenLogos.add(imgElement.src);
    }
    const parent = imgElement.parentNode;
    if (parent) {
        parent.innerHTML = createFallbackLogoHtml(channelName);
    }
};

window.handleSpotlightLogoError = function (imgElement) {
    if (!imgElement) return;
    imgElement.onerror = null;
    imgElement.style.display = 'none';
    const fallback = document.getElementById('spotlight-fallback-logo');
    if (fallback) fallback.classList.remove('hidden');
};

function renderChannelsGrid() {
    const grid = document.getElementById('channels-grid');
    const countBadge = document.getElementById('channel-count-badge');
    const emptyState = document.getElementById('empty-state');

    if (countBadge) countBadge.textContent = filteredChannels.length + " canales";
    if (!grid) return;

    grid.innerHTML = '';

    if (filteredChannels.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    } else {
        if (emptyState) emptyState.classList.add('hidden');
    }

    const fragment = document.createDocumentFragment();

    filteredChannels.forEach((ch, idx) => {
        const card = document.createElement('div');
        const isFocused = (idx === currentChannelIndex && currentNavZone === 'GRID');
        const isPlaying = (activePlayingChannel && activePlayingChannel.url === ch.url);

        card.className = "channel-card" + (isFocused ? " focused" : "") + (isPlaying ? " active-playing" : "");
        card.dataset.index = idx;
        card.tabIndex = 0;

        let logoHtml = '';
        if (isValidLogoUrl(ch.logo) && !brokenLogos.has(ch.logo)) {
            logoHtml = `<img class="channel-logo-img" loading="lazy" src="${escapeHtml(ch.logo)}" alt="${escapeHtml(ch.name)}" onerror="handleLogoError(this, '${escapeHtml(ch.name)}')">`;
        } else {
            logoHtml = createFallbackLogoHtml(ch.name);
        }

        card.innerHTML = `
            <div class="card-header-meta">
                <span class="channel-num-badge">#${ch.number}</span>
                <span class="channel-group-tag">${escapeHtml(ch.group)}</span>
            </div>
            <div class="channel-logo-wrap">
                <div class="channel-logo-stage">
                    ${logoHtml}
                </div>
            </div>
            <div class="channel-name" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</div>
            <div class="channel-footer-meta">
                <span class="live-indicator"><span class="pulse-dot"></span> EN VIVO</span>
                <span class="hd-badge">HD</span>
            </div>
        `;

        card.addEventListener('mouseenter', () => {
            currentNavZone = 'GRID';
            currentChannelIndex = idx;
            updateFocusedCard();
            updateSpotlightBanner(ch);
        });

        card.addEventListener('click', () => {
            selectAndPlayChannel(idx, true);
        });

        fragment.appendChild(card);
    });

    grid.appendChild(fragment);
}

// Update the dynamic Spotlight Hero Banner
function updateSpotlightBanner(ch) {
    if (!ch) return;

    const spotlightLogo = document.getElementById('spotlight-logo');
    const spotlightFallback = document.getElementById('spotlight-fallback-logo');
    const spotlightNum = document.getElementById('spotlight-number');
    const spotlightGroup = document.getElementById('spotlight-group');
    const spotlightTitle = document.getElementById('spotlight-name');
    const spotlightDesc = document.getElementById('spotlight-desc');

    if (spotlightNum) spotlightNum.textContent = `#${ch.number}`;
    if (spotlightGroup) spotlightGroup.textContent = ch.group || 'General';
    if (spotlightTitle) spotlightTitle.textContent = ch.name;
    if (spotlightDesc) spotlightDesc.textContent = `Señal en directo: ${ch.name} • Presiona [OK] para pantalla completa.`;

    if (spotlightLogo && spotlightFallback) {
        if (isValidLogoUrl(ch.logo) && !brokenLogos.has(ch.logo)) {
            spotlightLogo.src = ch.logo;
            spotlightLogo.style.display = 'block';
            spotlightFallback.classList.add('hidden');
        } else {
            spotlightLogo.style.display = 'none';
            spotlightFallback.classList.remove('hidden');
            const initials = (ch.name || 'TV')
                .replace(/[^a-zA-Z0-9 ]/g, '')
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map(w => w[0])
                .join('')
                .toUpperCase() || 'TV';
            spotlightFallback.textContent = initials;
            spotlightFallback.style.background = getMonogramGradient(ch.name);
        }
    }
}

function renderDrawerChannels() {
    const drawerList = document.getElementById('drawer-channels-list');
    const drawerCount = document.getElementById('drawer-count');
    if (!drawerList) return;

    if (drawerCount) drawerCount.textContent = filteredChannels.length + " canales";
    drawerList.innerHTML = '';

    const fragment = document.createDocumentFragment();

    filteredChannels.forEach((ch, idx) => {
        const item = document.createElement('div');
        const isActive = (idx === currentChannelIndex);
        item.className = "drawer-item" + (isActive ? " active focused" : "");
        item.dataset.index = idx;

        let logoEl = '';
        if (isValidLogoUrl(ch.logo) && !brokenLogos.has(ch.logo)) {
            logoEl = `<img class="drawer-item-logo" loading="lazy" src="${escapeHtml(ch.logo)}" alt="" onerror="handleLogoError(this, '${escapeHtml(ch.name)}')">`;
        } else {
            const initials = (ch.name || 'TV').substring(0, 2).toUpperCase();
            logoEl = `<div class="drawer-item-initials">${escapeHtml(initials)}</div>`;
        }

        item.innerHTML = `
            <span class="drawer-item-num">#${ch.number}</span>
            ${logoEl}
            <span class="drawer-item-name">${escapeHtml(ch.name)}</span>
        `;

        item.addEventListener('click', () => {
            selectAndPlayChannel(idx, true);
            closeDrawer();
        });

        fragment.appendChild(item);
    });

    drawerList.appendChild(fragment);
}

function updateFocusedCard() {
    const grid = document.getElementById('channels-grid');
    if (!grid) return;

    const oldCard = grid.querySelector('.channel-card.focused');
    if (oldCard) oldCard.classList.remove('focused');

    if (currentNavZone === 'GRID') {
        const newCard = grid.querySelector('.channel-card[data-index="' + currentChannelIndex + '"]');
        if (newCard) {
            newCard.classList.add('focused');
            newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

// Calculate grid column count dynamically based on screen resolution
function getGridColumns() {
    const grid = document.getElementById('channels-grid');
    if (!grid || filteredChannels.length === 0) return 5;
    const cards = grid.children;
    if (cards.length < 2) return 1;
    const firstTop = cards[0].offsetTop;
    let cols = 0;
    for (let i = 0; i < cards.length; i++) {
        if (cards[i].offsetTop === firstTop) {
            cols++;
        } else {
            break;
        }
    }
    return cols || 5;
}

// ==========================================================================
// CHANNEL PLAYBACK & HLS ENGINE (Optimized for Samsung TV)
// ==========================================================================
function selectAndPlayChannel(index, fullScreenMode = true) {
    if (index < 0 || index >= filteredChannels.length) return;

    currentChannelIndex = index;
    const channel = filteredChannels[index];
    activePlayingChannel = channel;
    streamRetryCount = 0;

    localStorage.setItem(STORAGE_KEY_LAST_CHANNEL, index);
    if (channel && channel.url) {
        localStorage.setItem(STORAGE_KEY_LAST_CHANNEL_URL, channel.url);
    }

    updateFocusedCard();
    updateSpotlightBanner(channel);

    // Update Drawer focused state
    const drawerList = document.getElementById('drawer-channels-list');
    if (drawerList) {
        const oldItem = drawerList.querySelector('.drawer-item.active');
        if (oldItem) oldItem.classList.remove('active', 'focused');
        const newItem = drawerList.querySelector('.drawer-item[data-index="' + index + '"]');
        if (newItem) {
            newItem.classList.add('active', 'focused');
            newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    if (fullScreenMode) {
        openFullscreen();
    }
}

function playStream(videoEl, streamUrl) {
    if (!videoEl || !streamUrl) return;

    const loader = document.getElementById('player-buffering');
    const errorOverlay = document.getElementById('player-error');
    const errorMsg = document.getElementById('player-error-msg');

    if (loader) loader.classList.remove('hidden');
    if (errorOverlay) errorOverlay.classList.add('hidden');

    if (hlsMainInstance) {
        hlsMainInstance.destroy();
        hlsMainInstance = null;
    }

    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();

    console.log('[Player] Loading:', streamUrl.substring(0, 80));

    // Samsung Tizen has native HLS engine. Try native first on Tizen, fall back to HLS.js.
    if (window.tizen) {
        tryNativePlayback(videoEl, streamUrl, loader, errorOverlay, errorMsg);
    } else if (window.Hls && Hls.isSupported()) {
        _startHlsJs(videoEl, streamUrl, loader, errorOverlay, errorMsg);
    } else {
        tryNativePlayback(videoEl, streamUrl, loader, errorOverlay, errorMsg);
    }

    videoEl.onwaiting = () => { if (loader) loader.classList.remove('hidden'); };
    videoEl.onplaying = () => {
        if (loader) loader.classList.add('hidden');
        if (errorOverlay) errorOverlay.classList.add('hidden');
        streamRetryCount = 0;
    };
}

function _startHlsJs(videoEl, streamUrl, loader, errorOverlay, errorMsg) {
    const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 20 * 1024 * 1024,
        backBufferLength: 8,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 4,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
        appendErrorMaxRetry: 4
    });

    hls.loadSource(streamUrl);
    hls.attachMedia(videoEl);

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
        videoEl.play().catch(e => console.log('Gesture wait:', e));
        if (loader) loader.classList.add('hidden');
    });

    hls.on(Hls.Events.ERROR, function (event, data) {
        if (data.fatal) {
            console.warn('[HLS.js] Fatal:', data.type, data.details);
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    if (streamRetryCount < MAX_STREAM_RETRIES) {
                        streamRetryCount++;
                        setTimeout(() => hls.startLoad(), 2000);
                    } else {
                        hls.destroy();
                        hlsMainInstance = null;
                        tryNativePlayback(videoEl, streamUrl, loader, errorOverlay, errorMsg);
                    }
                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    if (streamRetryCount < MAX_STREAM_RETRIES) {
                        streamRetryCount++;
                        hls.recoverMediaError();
                    } else {
                        hls.destroy();
                        hlsMainInstance = null;
                        tryNativePlayback(videoEl, streamUrl, loader, errorOverlay, errorMsg);
                    }
                    break;
                default:
                    hls.destroy();
                    hlsMainInstance = null;
                    tryNativePlayback(videoEl, streamUrl, loader, errorOverlay, errorMsg);
                    break;
            }
        }
    });

    hlsMainInstance = hls;
}

function tryNativePlayback(videoEl, streamUrl, loader, errorOverlay, errorMsg) {
    videoEl.src = streamUrl;

    const pp = videoEl.play();
    if (pp !== undefined) {
        pp.then(() => {
            if (loader) loader.classList.add('hidden');
            if (errorOverlay) errorOverlay.classList.add('hidden');
        }).catch(e => {
            if (e.name !== 'NotAllowedError') {
                _showStreamError(loader, errorOverlay, errorMsg, streamUrl, e.message);
            }
        });
    }

    const errHandler = () => {
        videoEl.removeEventListener('error', errHandler);
        const code = videoEl.error ? videoEl.error.code : '?';
        if (window.tizen && window.Hls && Hls.isSupported() && streamRetryCount < 1) {
            streamRetryCount++;
            _startHlsJs(videoEl, streamUrl, loader, errorOverlay, errorMsg);
        } else {
            _showStreamError(loader, errorOverlay, errorMsg, streamUrl, 'Error de video (código: ' + code + ')');
        }
    };
    videoEl.addEventListener('error', errHandler, { once: true });
}

function _showStreamError(loader, errorOverlay, errorMsg, streamUrl, detail) {
    if (loader) loader.classList.add('hidden');
    if (errorOverlay) errorOverlay.classList.remove('hidden');

    const isHttp = streamUrl && streamUrl.startsWith('http://');
    let reason = detail || 'La señal no responde o el enlace M3U8 ha expirado.';

    if (isHttp && typeof window !== 'undefined' && window.location.protocol === 'https:') {
        reason = 'Stream HTTP bloqueado por HTTPS. Funciona directamente en la Smart TV.';
    } else if (detail && detail.includes('403')) {
        reason = 'Acceso bloqueado por el proveedor (Error 403).';
    } else if (detail && detail.includes('404')) {
        reason = 'Stream no encontrado (Error 404). El enlace puede haber caducado.';
    }

    if (errorMsg) errorMsg.textContent = reason;
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
    if (appContainer) appContainer.style.display = 'none';

    playStream(mainVideo, activePlayingChannel.url);
    updateOSD(activePlayingChannel);
    showOSD();
}

function closeFullscreen() {
    isFullscreen = false;
    const overlay = document.getElementById('player-overlay');
    const appContainer = document.getElementById('app-container');
    const mainVideo = document.getElementById('main-video');

    if (overlay) overlay.classList.add('hidden');
    if (appContainer) appContainer.style.display = 'flex';
    if (mainVideo) {
        mainVideo.pause();
        mainVideo.removeAttribute('src');
        mainVideo.load();
        mainVideo.onwaiting = null;
        mainVideo.onplaying = null;
        mainVideo.onerror = null;
    }
    if (hlsMainInstance) {
        hlsMainInstance.destroy();
        hlsMainInstance = null;
    }
    streamRetryCount = 0;
    closeDrawer();
    updateFocusedCard();
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

let channelSwitchDebounceTimer = null;

function switchChannelRelative(offset) {
    if (filteredChannels.length === 0) return;

    let newIndex = currentChannelIndex + offset;
    if (newIndex < 0) newIndex = filteredChannels.length - 1;
    if (newIndex >= filteredChannels.length) newIndex = 0;

    currentChannelIndex = newIndex;
    const ch = filteredChannels[newIndex];
    activePlayingChannel = ch;

    updateOSD(ch);
    showOSD();

    clearTimeout(channelSwitchDebounceTimer);
    channelSwitchDebounceTimer = setTimeout(() => {
        selectAndPlayChannel(currentChannelIndex, true);
    }, 180);
}

// Quick Channel Drawer
function toggleDrawer() {
    isDrawerOpen ? closeDrawer() : openDrawer();
}

function openDrawer() {
    const drawer = document.getElementById('quick-channels-drawer');
    if (!drawer) return;
    drawer.classList.remove('hidden');
    isDrawerOpen = true;
    drawerFocusedIndex = currentChannelIndex;
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
// TV QR CODE PAIRING SCREEN (ONLY QR - NO REMOTE TEXT INPUTS)
// ==========================================================================
function isTvLoginActive() {
    const overlay = document.getElementById('tv-login-overlay');
    return overlay && !overlay.classList.contains('hidden');
}

function showTvLoginScreen() {
    const overlay = document.getElementById('tv-login-overlay');
    if (overlay) overlay.classList.remove('hidden');

    // Close player if open
    if (isFullscreen) closeFullscreen();

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
    const statusEl = document.getElementById('tv-pair-status');

    if (pairCodeEl) pairCodeEl.textContent = "------";
    if (statusEl) statusEl.textContent = "Generando código seguro...";
    if (qrBox) {
        qrBox.innerHTML = '<div class="qr-loading">Generando código seguro...</div>';
    }

    const serverUrl = getServerUrl();

    fetch(serverUrl + '/api/auth/pair/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (!isTvLoginActive()) return;

        if (data && data.success && data.pairCode) {
            const pairCode = data.pairCode;
            if (pairCodeEl) pairCodeEl.textContent = pairCode;
            if (statusEl) statusEl.textContent = "Esperando que confirmes en tu teléfono móvil...";

            // Direct link to GitHub Pages pair.html with code and server fallback
            const mobilePairUrl = `${GITHUB_PAGES_PAIR_URL}?code=${encodeURIComponent(pairCode)}&server=${encodeURIComponent(serverUrl)}`;

            const urlTextEl = document.getElementById('tv-pair-url-text');
            if (urlTextEl) urlTextEl.textContent = `${GITHUB_PAGES_PAIR_URL}?code=${pairCode}`;

            if (qrBox) {
                qrBox.innerHTML = '';
                try {
                    if (typeof QRCode !== 'undefined') {
                        new QRCode(qrBox, {
                            text: mobilePairUrl,
                            width: 190,
                            height: 190,
                            colorDark: "#050811",
                            colorLight: "#ffffff",
                            correctLevel: QRCode.CorrectLevel.M
                        });
                    } else {
                        qrBox.innerHTML = `<div style="font-size:12px;color:#0284c7;padding:10px;text-align:center;">Abre en tu móvil:<br><strong>${mobilePairUrl}</strong></div>`;
                    }
                } catch (e) {
                    console.warn("QR render error:", e);
                    qrBox.innerHTML = `<div style="font-size:12px;color:#0284c7;padding:10px;text-align:center;">Abre en tu móvil:<br><strong>${mobilePairUrl}</strong></div>`;
                }
            }

            // Start polling every 2 seconds
            pairPollInterval = setInterval(() => {
                checkPairStatus(pairCode);
            }, 2000);

        } else {
            if (qrBox) qrBox.innerHTML = '<div style="color:#ef4444;font-size:12px;padding:10px;">Error al conectar con servidor.<br>Revisa tu conexión.</div>';
            if (statusEl) statusEl.textContent = "Fallo de conexión al servicio.";
        }
    })
    .catch(err => {
        console.warn("Pair request error:", err);
        if (qrBox) qrBox.innerHTML = '<div style="color:#ef4444;font-size:12px;padding:10px;">Sin conexión al servidor.<br>Usa canales demo.</div>';
        if (statusEl) statusEl.textContent = "Sin conexión al servidor en la nube.";
    });
}

function checkPairStatus(pairCode) {
    if (!isTvLoginActive()) {
        stopQrPairingWorkflow();
        return;
    }

    const serverUrl = getServerUrl();
    fetch(serverUrl + '/api/auth/pair/status?code=' + encodeURIComponent(pairCode))
    .then(res => res.json())
    .then(data => {
        if (data && data.status === 'approved' && data.token) {
            stopQrPairingWorkflow();
            localStorage.setItem(STORAGE_KEY_TOKEN, data.token);
            localStorage.setItem(STORAGE_KEY_USERNAME, data.username || 'Usuario');
            hideTvLoginScreen();
            updateUserSessionUI();
            showToast(`¡Bienvenido @${data.username || 'Usuario'}! Dispositivo vinculado`);
            fetchChannelsFromBackend(true);
        } else if (data && data.status === 'expired') {
            stopQrPairingWorkflow();
            startQrPairingWorkflow();
        }
    })
    .catch(() => {});
}

function handleTvLogout() {
    stopQrPairingWorkflow();
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_USERNAME);
    closeAdminModal();
    updateUserSessionUI();
    showTvLoginScreen();
    showToast("Sesión cerrada. Escanea para vincular otra cuenta.");
}

// ==========================================================================
// SETTINGS / ADMIN MODAL (PIN PROTECTED)
// ==========================================================================
function openAdminModal() {
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
        showToast("Ingresa un link M3U / M3U8 válido");
        return;
    }

    closeAdminModal();
    loadCustomM3UUrl(newUrl);
}

// Local File Upload Handler
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

    const parsed = parseM3U(pendingFileContent, '', 'Archivo Local');
    if (parsed.length === 0) {
        showToast("El archivo no contiene canales válidos en formato M3U o M3U8");
        return;
    }

    allChannels = parsed;
    localStorage.removeItem(STORAGE_KEY_URL);
    localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(allChannels));
    localStorage.setItem(STORAGE_KEY_LAST_CHANNEL, 0);

    closeAdminModal();
    finishPlaylistLoad("Archivo local subido");
    showToast(`¡Éxito! ${allChannels.length} canales cargados.`);
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
// REMOTE CONTROL & D-PAD NAVIGATION ENGINE (100% BUG-FREE 2D GRID)
// ==========================================================================
function initEventListeners() {
    // Header buttons
    const settingsBtn = document.getElementById('btn-open-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', openAdminModal);

    const accountBtn = document.getElementById('btn-user-account');
    if (accountBtn) accountBtn.addEventListener('click', showTvLoginScreen);

    // Spotlight Play button
    const spotlightPlayBtn = document.getElementById('btn-spotlight-play');
    if (spotlightPlayBtn) {
        spotlightPlayBtn.addEventListener('click', () => {
            selectAndPlayChannel(currentChannelIndex, true);
        });
    }

    // Empty state buttons
    const emptyDemoBtn = document.getElementById('btn-empty-demo');
    if (emptyDemoBtn) emptyDemoBtn.addEventListener('click', useDemoPlaylist);

    const emptyQrBtn = document.getElementById('btn-empty-qr');
    if (emptyQrBtn) emptyQrBtn.addEventListener('click', showTvLoginScreen);

    const emptySettingsBtn = document.getElementById('btn-empty-settings');
    if (emptySettingsBtn) emptySettingsBtn.addEventListener('click', openAdminModal);

    // QR Overlay buttons
    const qrRefreshBtn = document.getElementById('btn-qr-refresh');
    if (qrRefreshBtn) qrRefreshBtn.addEventListener('click', startQrPairingWorkflow);

    const qrSkipBtn = document.getElementById('btn-qr-skip');
    if (qrSkipBtn) {
        qrSkipBtn.addEventListener('click', () => {
            hideTvLoginScreen();
            loadDefaultPlaylist();
            showToast("Modo libre activado");
        });
    }

    const qrSettingsBtn = document.getElementById('btn-qr-settings');
    if (qrSettingsBtn) {
        qrSettingsBtn.addEventListener('click', () => {
            hideTvLoginScreen();
            openAdminModal();
        });
    }

    // Admin modal tabs (URL vs File)
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

    // File input triggers
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

    // Modal buttons
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
            loadDefaultPlaylist();
        });
    }

    const syncCloudBtn = document.getElementById('btn-sync-cloud');
    if (syncCloudBtn) {
        syncCloudBtn.addEventListener('click', () => {
            closeAdminModal();
            fetchChannelsFromBackend(true);
        });
    }

    const openQrFromModalBtn = document.getElementById('btn-open-qr-from-modal');
    if (openQrFromModalBtn) {
        openQrFromModalBtn.addEventListener('click', () => {
            closeAdminModal();
            showTvLoginScreen();
        });
    }

    const logoutBtn = document.getElementById('btn-tv-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', handleTvLogout);

    // Search input
    const searchInput = document.getElementById('channel-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => filterChannels());
    }

    // Player buttons
    const closePlayerBtn = document.getElementById('btn-close-player');
    if (closePlayerBtn) closePlayerBtn.addEventListener('click', closeFullscreen);

    const retryStreamBtn = document.getElementById('btn-retry-stream');
    if (retryStreamBtn) {
        retryStreamBtn.addEventListener('click', () => {
            if (activePlayingChannel) {
                const mainVideo = document.getElementById('main-video');
                playStream(mainVideo, activePlayingChannel.url);
            }
        });
    }

    // Global Keydown & Keyup (Samsung Smart Remote D-Pad & Keys)
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);
}

function handleGlobalKeyDown(e) {
    const keyCode = e.keyCode || e.which;

    // Detect Long Press on OK / Enter (2.5 seconds) to open Admin Menu
    if (keyCode === 13 && !okKeyTimer) {
        isLongPress = false;
        okKeyTimer = setTimeout(() => {
            isLongPress = true;
            openAdminModal();
        }, 2500);
    }

    // If TV QR Login Screen is open:
    if (isTvLoginActive()) {
        switch (keyCode) {
            case 13: // Enter / OK -> Refresh QR code
                startQrPairingWorkflow();
                return;
            case 10009: // Return / Exit -> Skip to free mode
            case 27:
                hideTvLoginScreen();
                loadDefaultPlaylist();
                return;
        }
        return;
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
        } else if (keyCode === 10009 || keyCode === 27) {
            closeAdminModal();
        }
        return;
    }

    // Direct Remote Control Key Mapping for Samsung SolarCell / Smart Remote
    switch (keyCode) {
        // Channel Rocker (CH Up / Down)
        case 427: // ChannelUp
            switchChannelRelative(1);
            return;
        case 428: // ChannelDown
            switchChannelRelative(-1);
            return;

        // Menu Key or Red Button (123 -> Red) -> Open Admin Settings
        case 10133: // Menu Key
        case 18:    // Alt / Menu
        case 403:   // ColorF0Red (Botón Rojo)
            openAdminModal();
            return;

        // Play / Pause (⏯)
        case 10252: // MediaPlayPause
        case 415:   // MediaPlay
        case 19:    // MediaPause
            togglePlayPause();
            return;

        // Arrow UP
        case 38:
            if (isDrawerOpen) {
                navigateDrawer(-1);
            } else if (isFullscreen) {
                switchChannelRelative(-1);
            } else {
                navigate2D(0, -1);
            }
            return;

        // Arrow DOWN
        case 40:
            if (isDrawerOpen) {
                navigateDrawer(1);
            } else if (isFullscreen) {
                switchChannelRelative(1);
            } else {
                navigate2D(0, 1);
            }
            return;

        // Arrow RIGHT
        case 39:
            if (isFullscreen) {
                toggleDrawer();
            } else {
                navigate2D(1, 0);
            }
            return;

        // Arrow LEFT
        case 37:
            if (isFullscreen) {
                toggleDrawer();
            } else {
                navigate2D(-1, 0);
            }
            return;

        // RETURN / BACK Key
        case 10009: // Tizen Return
        case 27:    // Escape
        case 8:     // Backspace
            if (isDrawerOpen) {
                closeDrawer();
            } else if (isFullscreen) {
                closeFullscreen();
            } else if (currentNavZone === 'CATEGORIES') {
                currentNavZone = 'GRID';
                updateFocusedCard();
            } else {
                if (confirm("¿Deseas salir de la aplicación?")) {
                    if (window.tizen && tizen.application) {
                        tizen.application.getCurrentApplication().exit();
                    }
                }
            }
            return;
    }
}

// 2D D-PAD NAVIGATION ENGINE (Seamless Grid & Category Switch)
function navigate2D(dx, dy) {
    const cols = getGridColumns();

    if (currentNavZone === 'GRID') {
        if (filteredChannels.length === 0) {
            if (dy < 0) {
                focusCategoriesBar();
            }
            return;
        }

        if (dy < 0) {
            // Arrow UP
            const targetIndex = currentChannelIndex - cols;
            if (targetIndex < 0) {
                // At row 0 -> move up to Category Bar!
                focusCategoriesBar();
                return;
            } else {
                currentChannelIndex = targetIndex;
            }
        } else if (dy > 0) {
            // Arrow DOWN
            const targetIndex = currentChannelIndex + cols;
            if (targetIndex < filteredChannels.length) {
                currentChannelIndex = targetIndex;
            } else {
                // If last row has fewer columns, clamp to last channel
                currentChannelIndex = filteredChannels.length - 1;
            }
        }

        if (dx < 0) {
            // Arrow LEFT
            if (currentChannelIndex > 0) {
                currentChannelIndex--;
            }
        } else if (dx > 0) {
            // Arrow RIGHT
            if (currentChannelIndex < filteredChannels.length - 1) {
                currentChannelIndex++;
            }
        }

        updateFocusedCard();
        if (filteredChannels[currentChannelIndex]) {
            updateSpotlightBanner(filteredChannels[currentChannelIndex]);
        }

    } else if (currentNavZone === 'CATEGORIES') {
        const catChips = document.querySelectorAll('.category-chip');
        if (catChips.length === 0) return;

        if (dy > 0) {
            // Arrow DOWN -> Enter channel grid!
            currentNavZone = 'GRID';
            catChips.forEach(c => c.classList.remove('focused'));
            currentChannelIndex = 0;
            updateFocusedCard();
            if (filteredChannels[0]) updateSpotlightBanner(filteredChannels[0]);
            return;
        }

        if (dx < 0) {
            // Arrow LEFT in categories
            categoryNavIndex = Math.max(0, categoryNavIndex - 1);
        } else if (dx > 0) {
            // Arrow RIGHT in categories
            categoryNavIndex = Math.min(catChips.length - 1, categoryNavIndex + 1);
        }

        catChips.forEach((c, idx) => {
            c.classList.toggle('focused', idx === categoryNavIndex);
        });

        const activeChip = catChips[categoryNavIndex];
        if (activeChip) {
            activeChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            const cat = activeChip.dataset.category;
            if (cat && cat !== selectedCategory) {
                setCategory(cat);
            }
        }
    }
}

function focusCategoriesBar() {
    currentNavZone = 'CATEGORIES';
    const grid = document.getElementById('channels-grid');
    if (grid) {
        const oldCard = grid.querySelector('.channel-card.focused');
        if (oldCard) oldCard.classList.remove('focused');
    }

    const catChips = document.querySelectorAll('.category-chip');
    categoryNavIndex = categories.indexOf(selectedCategory);
    if (categoryNavIndex < 0) categoryNavIndex = 0;

    catChips.forEach((c, idx) => {
        c.classList.toggle('focused', idx === categoryNavIndex);
    });

    if (catChips[categoryNavIndex]) {
        catChips[categoryNavIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
}

function handleGlobalKeyUp(e) {
    const keyCode = e.keyCode || e.which;

    if (keyCode === 13) {
        clearTimeout(okKeyTimer);
        okKeyTimer = null;

        if (isTvLoginActive()) return;

        if (!isLongPress) {
            const modal = document.getElementById('admin-modal');
            if (modal && !modal.classList.contains('hidden')) return;

            if (isDrawerOpen) {
                selectAndPlayChannel(drawerFocusedIndex, true);
                closeDrawer();
            } else if (isFullscreen) {
                toggleDrawer();
            } else if (currentNavZone === 'CATEGORIES') {
                currentNavZone = 'GRID';
                document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('focused'));
                currentChannelIndex = 0;
                updateFocusedCard();
            } else {
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
