/**
 * M3U PLAYER - Web Application Logic
 * Navbar, Profile (My Channels Only), and Live TV Mode (Samsung Smart TV Style)
 */

const API_BASE = (window.location.hostname.includes('github.io') || window.location.hostname.includes('vercel.app') || window.location.protocol === 'file:') ? 'https://m3uplayer-yw7z.onrender.com' : '';

// State
let currentUserToken = localStorage.getItem('m3u_web_token');
let currentUsername = localStorage.getItem('m3u_web_user');
let currentView = 'home'; // 'home', 'profile', 'live'
let authModalMode = 'login'; // 'login' or 'register'

let allUserChannels = [];
let filteredChannels = [];
let activeProfileCategory = 'ALL';
let userPlaylists = [];

// TV Mode State
let tvChannels = [];
let currentTvIndex = 0;
let tvHls = null;
let tvOverlayTimeout = null;
let isTvOverlayVisible = true;

// Default Fallback channels (same high quality tested channels from Samsung Smart TV)
const DEFAULT_FALLBACK_CHANNELS = [
    { number: "001", name: "Mega HD", group: "Nacional", logo: "https://cdn.m3u.cl/logo/1083_Mega.png", url: "https://unlimited6-cl.dps.live/mega/mega.smil/playlist.m3u8" },
    { number: "002", name: "Chilevisión", group: "Nacional", logo: "https://cdn.m3u.cl/logo/456_Chilevisi_n.png", url: "https://mdstrm.com/live-stream-playlist/60b54bbd5e21940825785536.m3u8" },
    { number: "003", name: "Canal 13", group: "Nacional", logo: "https://cdn.m3u.cl/logo/457_Canal_13.png", url: "https://redirector.dps.live/hls/13live/playlist.m3u8" },
    { number: "004", name: "TVN", group: "Nacional", logo: "https://cdn.m3u.cl/logo/454_TVN.png", url: "https://mdstrm.com/live-stream-playlist/5346da1619bc3016142169a6.m3u8" },
    { number: "005", name: "24 Horas", group: "Noticias", logo: "https://cdn.m3u.cl/logo/455_24_Horas.png", url: "https://mdstrm.com/live-stream-playlist/579bb8876483501a08696eb6.m3u8" },
    { number: "006", name: "NTV", group: "Nacional", logo: "https://cdn.m3u.cl/logo/45_NTV.png", url: "https://mdstrm.com/live-stream-playlist/5aaabe9e2c56420918184c6d.m3u8" },
    { number: "007", name: "TV+", group: "Nacional", logo: "https://cdn.m3u.cl/logo/458_TV_.png", url: "https://redirector.rudo.video/hls-video/ey6283je82983je9823je8jowowiekldk9838274/tvmas/tvmas.smil/playlist.m3u8" },
    { number: "008", name: "BioBio TV", group: "Noticias", logo: "https://upload.wikimedia.org/wikipedia/commons/a/a8/Biobio_TV_logo.jpg", url: "https://redirector.rudo.video/hls-video/339f69c6122f6d8f4574732c235f09b7683e31a5/bbtv/bbtv.smil/playlist.m3u8" }
];

// ==========================================================================
// INITIALIZATION
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    initNavbar();
    initAuthModal();
    initProfileView();
    initTvPlayer();
    initClock();

    if (currentUserToken && currentUsername) {
        setAuthState(true, currentUsername);
        loadUserData();
    } else {
        setAuthState(false);
    }

    // Default route
    switchView('home');
});

// ==========================================================================
// NAVIGATION & ROUTING
// ==========================================================================
function initNavbar() {
    document.getElementById('nav-brand-link').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('home');
    });

    document.getElementById('nav-btn-home').addEventListener('click', () => switchView('home'));
    document.getElementById('nav-btn-profile').addEventListener('click', () => switchView('profile'));
    document.getElementById('nav-btn-live').addEventListener('click', () => launchTvLiveMode());

    const heroProfileBtn = document.getElementById('btn-hero-profile-cta');
    if (heroProfileBtn) {
        heroProfileBtn.addEventListener('click', () => {
            if (currentUserToken) {
                switchView('profile');
            } else {
                openAuthModal('login');
            }
        });
    }

    const heroRegBtn = document.getElementById('btn-hero-register-cta');
    if (heroRegBtn) {
        heroRegBtn.addEventListener('click', () => openAuthModal('register'));
    }

    document.getElementById('btn-profile-launch-live').addEventListener('click', () => launchTvLiveMode());
}

function switchView(viewName) {
    currentView = viewName;

    // Toggle active panels
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active-view'));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active-view');

    // Update navbar buttons
    document.getElementById('nav-btn-home').classList.toggle('active', viewName === 'home');
    document.getElementById('nav-btn-profile').classList.toggle('active', viewName === 'profile');

    // Pause TV video if switching away from live
    const tvVideo = document.getElementById('tv-main-video');
    if (viewName !== 'live') {
        if (tvVideo && !tvVideo.paused) {
            tvVideo.pause();
        }
    } else {
        if (tvVideo && tvVideo.paused && tvChannels.length > 0) {
            tvVideo.play().catch(() => {});
        }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================================================
// AUTHENTICATION MODAL & LOGOUT
// ==========================================================================
function initAuthModal() {
    const modal = document.getElementById('modal-auth');
    const btnOpenLogin = document.getElementById('btn-open-login');
    const btnOpenRegister = document.getElementById('btn-open-register');
    const btnClose = document.getElementById('btn-close-auth-modal');
    const tabLogin = document.getElementById('tab-login-btn');
    const tabRegister = document.getElementById('tab-register-btn');
    const form = document.getElementById('auth-modal-form');
    const btnLogout = document.getElementById('btn-logout');

    btnOpenLogin.addEventListener('click', () => openAuthModal('login'));
    btnOpenRegister.addEventListener('click', () => openAuthModal('register'));
    btnClose.addEventListener('click', () => closeAuthModal());

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAuthModal();
    });

    tabLogin.addEventListener('click', () => setAuthModalMode('login'));
    tabRegister.addEventListener('click', () => setAuthModalMode('register'));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAuthAlerts();

        const username = document.getElementById('modal-username').value.trim();
        const password = document.getElementById('modal-password').value.trim();
        const submitBtn = document.getElementById('btn-auth-submit');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Verificando en la nube...</span>';

        const endpoint = authModalMode === 'login' ? `${API_BASE}/api/auth/login` : `${API_BASE}/api/auth/register`;

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email: username, password })
            });

            let data = {};
            try {
                data = await res.json();
            } catch (err) {
                data = { error: 'Error del servidor (Estado ' + res.status + ')' };
            }

            if (!res.ok || data.error) {
                throw new Error(data.error || 'Credenciales inválidas');
            }

            // Success
            currentUserToken = data.token;
            currentUsername = data.username;
            localStorage.setItem('m3u_web_token', currentUserToken);
            localStorage.setItem('m3u_web_user', currentUsername);

            showToast(`¡Bienvenido de vuelta, @${currentUsername}!`);
            closeAuthModal();
            setAuthState(true, currentUsername);
            await loadUserData();
            switchView('profile');

        } catch (err) {
            showAuthError(err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>${authModalMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}</span>`;
        }
    });

    btnLogout.addEventListener('click', () => {
        localStorage.removeItem('m3u_web_token');
        localStorage.removeItem('m3u_web_user');
        currentUserToken = null;
        currentUsername = null;
        allUserChannels = [];
        setAuthState(false);
        showToast('Sesión cerrada correctamente');
        switchView('home');
    });
}

function openAuthModal(mode = 'login') {
    setAuthModalMode(mode);
    hideAuthAlerts();
    document.getElementById('modal-auth').classList.remove('hidden');
    document.getElementById('modal-username').focus();
}

function closeAuthModal() {
    document.getElementById('modal-auth').classList.add('hidden');
    hideAuthAlerts();
}

function setAuthModalMode(mode) {
    authModalMode = mode;
    const tabLogin = document.getElementById('tab-login-btn');
    const tabRegister = document.getElementById('tab-register-btn');
    const label = document.getElementById('auth-btn-label');
    const sub = document.getElementById('auth-modal-subtitle');

    if (mode === 'login') {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        label.textContent = 'Iniciar Sesión';
        sub.textContent = 'Ingresa con tus credenciales para ver y gestionar tus canales';
    } else {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        label.textContent = 'Crear Cuenta';
        sub.textContent = 'Crea tu usuario para usar en tu Smart TV y guardar tus listas';
    }
}

function setAuthState(isLoggedIn, username = '') {
    const guestActions = document.getElementById('nav-guest-actions');
    const userPill = document.getElementById('nav-user-pill');
    const navProfileBtn = document.getElementById('nav-btn-profile');
    const navLiveBtn = document.getElementById('nav-btn-live');

    if (isLoggedIn) {
        guestActions.classList.add('hidden');
        userPill.classList.remove('hidden');
        navProfileBtn.classList.remove('hidden');
        if (navLiveBtn) navLiveBtn.classList.remove('hidden');

        document.getElementById('nav-user-name').textContent = username;
        document.getElementById('nav-user-avatar').textContent = (username[0] || 'U').toUpperCase();

        document.getElementById('profile-display-name').textContent = `@${username}`;
        document.getElementById('profile-large-avatar').textContent = (username[0] || 'U').toUpperCase();
        document.getElementById('profile-sync-username').textContent = username;
    } else {
        guestActions.classList.remove('hidden');
        userPill.classList.add('hidden');
        navProfileBtn.classList.add('hidden');
        if (navLiveBtn) navLiveBtn.classList.add('hidden');
    }
}

function showAuthError(msg) {
    const box = document.getElementById('modal-auth-error');
    box.textContent = msg;
    box.classList.remove('hidden');
}

function hideAuthAlerts() {
    document.getElementById('modal-auth-error').classList.add('hidden');
    document.getElementById('modal-auth-success').classList.add('hidden');
}

// ==========================================================================
// PROFILE VIEW (MY ENABLED CHANNELS & PLAYLIST MANAGEMENT)
// ==========================================================================
function initProfileView() {
    // Tabs switcher in profile
    const tabChannels = document.getElementById('tab-my-channels');
    const tabPlaylists = document.getElementById('tab-manage-playlists');
    const paneChannels = document.getElementById('pane-my-channels');
    const panePlaylists = document.getElementById('pane-manage-playlists');

    tabChannels.addEventListener('click', () => {
        tabChannels.classList.add('active');
        tabPlaylists.classList.remove('active');
        paneChannels.classList.add('active');
        panePlaylists.classList.remove('active');
    });

    tabPlaylists.addEventListener('click', () => {
        tabPlaylists.classList.add('active');
        tabChannels.classList.remove('active');
        panePlaylists.classList.add('active');
        paneChannels.classList.remove('active');
    });

    // Search bar for channels in profile
    const searchInput = document.getElementById('profile-search-input');
    searchInput.addEventListener('input', () => filterProfileChannels());

    // Subtabs for Playlist source (URL vs File)
    const btnSubUrl = document.getElementById('btn-subtab-url');
    const btnSubFile = document.getElementById('btn-subtab-file');
    const formUrl = document.getElementById('form-add-url');
    const formFile = document.getElementById('form-add-file');

    btnSubUrl.addEventListener('click', () => {
        btnSubUrl.classList.add('active');
        btnSubFile.classList.remove('active');
        formUrl.classList.remove('hidden');
        formFile.classList.add('hidden');
    });

    btnSubFile.addEventListener('click', () => {
        btnSubFile.classList.add('active');
        btnSubUrl.classList.remove('active');
        formFile.classList.remove('hidden');
        formUrl.classList.add('hidden');
    });

    // Dropzone for files
    const dropzone = document.getElementById('profile-dropzone');
    const fileInput = document.getElementById('input-playlist-file');
    const fileLabel = document.getElementById('profile-file-chosen');
    const btnSubmitFile = document.getElementById('btn-submit-file');

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            fileLabel.textContent = `Archivo: ${fileInput.files[0].name} (${(fileInput.files[0].size / 1024).toFixed(1)} KB)`;
            fileLabel.style.color = '#38bdf8';
            btnSubmitFile.disabled = false;
        } else {
            fileLabel.textContent = 'Ningún archivo cargado (.m3u, .m3u8)';
            btnSubmitFile.disabled = true;
        }
    });

    // Submit URL
    formUrl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('input-playlist-url').value.trim();
        const name = document.getElementById('input-playlist-name-url').value.trim();
        const submitBtn = document.getElementById('btn-submit-url');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Descargando y procesando...</span>';

        try {
            const res = await fetch(`${API_BASE}/api/user/playlist/url`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUserToken}`
                },
                body: JSON.stringify({ url, name })
            });

            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Error al guardar lista');

            showPlaylistFeedback(`¡Éxito! Se añadieron ${data.channelsCount || 0} canales a tu cuenta.`, 'success');
            formUrl.reset();
            await loadUserData();
        } catch (err) {
            showPlaylistFeedback(err.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>🚀 Guardar y Actualizar Canales</span>';
        }
    });

    // Submit File
    formFile.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!fileInput.files.length) return;

        const file = fileInput.files[0];
        const name = document.getElementById('input-playlist-name-file').value.trim();
        const formData = new FormData();
        formData.append('file', file);
        if (name) formData.append('name', name);

        btnSubmitFile.disabled = true;
        btnSubmitFile.innerHTML = '<span>Subiendo a la nube...</span>';

        try {
            const res = await fetch(`${API_BASE}/api/user/playlist/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentUserToken}` },
                body: formData
            });

            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Error al procesar archivo');

            showPlaylistFeedback(`¡Éxito! Lista subida con ${data.channelsCount || 0} canales.`, 'success');
            formFile.reset();
            fileLabel.textContent = 'Ningún archivo cargado (.m3u, .m3u8)';
            await loadUserData();
        } catch (err) {
            showPlaylistFeedback(err.message, 'error');
        } finally {
            btnSubmitFile.disabled = true;
            btnSubmitFile.innerHTML = '<span>📤 Subir Archivo y Procesar</span>';
        }
    });

    document.getElementById('btn-refresh-playlists').addEventListener('click', () => loadUserData());
}

function showPlaylistFeedback(msg, type) {
    const box = document.getElementById('playlist-action-feedback');
    box.textContent = msg;
    box.className = `action-feedback ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 5000);
}

// Load playlists & channels for the authenticated user
async function loadUserData() {
    if (!currentUserToken) return;

    try {
        // 1. Fetch user playlists
        const plRes = await fetch(`${API_BASE}/api/user/playlists`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        if (plRes.ok) {
            const plData = await plRes.json();
            userPlaylists = plData.playlists || [];
            renderUserPlaylists(userPlaylists);
        }

        // 2. Fetch user channels
        const chRes = await fetch(`${API_BASE}/api/user/channels`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });

        if (chRes.ok) {
            const chData = await chRes.json();
            allUserChannels = chData.channels || [];
            
            // If user has 0 channels uploaded yet, load public/default channels so they can see channels immediately
            if (allUserChannels.length === 0) {
                const pubRes = await fetch(`${API_BASE}/api/channels`);
                if (pubRes.ok) {
                    const pubData = await pubRes.json();
                    if (pubData.channels && pubData.channels.length > 0) {
                        allUserChannels = pubData.channels;
                    }
                }
            }
        }

        // Update counters
        document.getElementById('profile-total-channels-badge').textContent = allUserChannels.length;
        document.getElementById('profile-total-playlists-badge').textContent = userPlaylists.length;
        document.getElementById('profile-channels-tab-count').textContent = allUserChannels.length;

        // Render categories & channels
        renderProfileCategories();
        filterProfileChannels();

    } catch (err) {
        console.error('Error cargando datos de usuario:', err);
    }
}

function renderUserPlaylists(playlists) {
    const container = document.getElementById('profile-playlists-list');
    container.innerHTML = '';

    if (!playlists || playlists.length === 0) {
        container.innerHTML = '<p class="dropzone-hint" style="text-align:center; padding: 20px;">No tienes listas guardadas aún.</p>';
        return;
    }

    playlists.forEach(pl => {
        const item = document.createElement('div');
        item.className = 'playlist-entry-card';
        item.innerHTML = `
            <div class="entry-info">
                <h5>${escapeHtml(pl.name || 'Lista M3U')}</h5>
                <span>${pl.channelCount || 0} canales • ${pl.type === 'file' ? '📁 Archivo' : '🌐 URL'}</span>
            </div>
            <button class="btn-delete-pl" data-id="${pl.id || pl._id}">Eliminar</button>
        `;

        item.querySelector('.btn-delete-pl').addEventListener('click', async () => {
            if (!confirm(`¿Eliminar la lista "${pl.name}"?`)) return;
            try {
                const res = await fetch(`${API_BASE}/api/user/playlist/${pl.id || pl._id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${currentUserToken}` }
                });
                if (res.ok) {
                    showToast('Lista eliminada correctamente');
                    loadUserData();
                }
            } catch (e) {
                alert('Error al eliminar');
            }
        });

        container.appendChild(item);
    });
}

function renderProfileCategories() {
    const catBar = document.getElementById('profile-categories-bar');
    catBar.innerHTML = '';

    const categories = new Set();
    allUserChannels.forEach(ch => {
        if (ch.group) categories.add(ch.group);
    });

    // ALL pill
    const allPill = document.createElement('button');
    allPill.className = `cat-pill ${activeProfileCategory === 'ALL' ? 'active' : ''}`;
    allPill.textContent = `Todos (${allUserChannels.length})`;
    allPill.addEventListener('click', () => {
        activeProfileCategory = 'ALL';
        renderProfileCategories();
        filterProfileChannels();
    });
    catBar.appendChild(allPill);

    categories.forEach(cat => {
        const count = allUserChannels.filter(c => c.group === cat).length;
        const pill = document.createElement('button');
        pill.className = `cat-pill ${activeProfileCategory === cat ? 'active' : ''}`;
        pill.textContent = `${cat} (${count})`;
        pill.addEventListener('click', () => {
            activeProfileCategory = cat;
            renderProfileCategories();
            filterProfileChannels();
        });
        catBar.appendChild(pill);
    });
}

function filterProfileChannels() {
    const query = document.getElementById('profile-search-input').value.trim().toLowerCase();

    filteredChannels = allUserChannels.filter(ch => {
        const matchCategory = (activeProfileCategory === 'ALL' || ch.group === activeProfileCategory);
        const matchQuery = (!query || 
            (ch.name && ch.name.toLowerCase().includes(query)) ||
            (ch.number && ch.number.includes(query)) ||
            (ch.group && ch.group.toLowerCase().includes(query))
        );
        return matchCategory && matchQuery;
    });

    renderProfileChannelsGrid();
}

function renderProfileChannelsGrid() {
    const grid = document.getElementById('profile-channels-grid');
    grid.innerHTML = '';

    if (filteredChannels.length === 0) {
        grid.innerHTML = '<p class="dropzone-hint" style="grid-column: 1/-1; text-align:center; padding: 40px;">No se encontraron canales habilitados en este filtro.</p>';
        return;
    }

    filteredChannels.forEach((ch, idx) => {
        const card = document.createElement('div');
        card.className = 'user-channel-card';

        let logoHtml = '';
        if (ch.logo && ch.logo.startsWith('http')) {
            logoHtml = `<img src="${escapeHtml(ch.logo)}" alt="" class="card-channel-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display:none;font-size:24px;">📺</span>`;
        } else {
            logoHtml = `<span style="font-size:24px;">📺</span>`;
        }

        card.innerHTML = `
            <div class="card-top-meta">
                <span class="ch-number-tag">#${ch.number || String(idx + 1).padStart(3, '0')}</span>
                <span class="ch-category-tag">${escapeHtml(ch.group || 'General')}</span>
            </div>
            <div class="card-logo-container">
                ${logoHtml}
            </div>
            <div class="card-channel-name" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</div>
            <div class="card-hover-action">
                <span>▶ Reproducir en Vivo</span>
            </div>
        `;

        card.addEventListener('click', () => {
            // Launch live player focused on this channel
            launchTvLiveMode(ch);
        });

        grid.appendChild(card);
    });
}

// ==========================================================================
// VIEW 3: VER EN VIVO (IDENTICAL SAMSUNG SMART TV DESIGN)
// ==========================================================================
function initTvPlayer() {
    const video = document.getElementById('tv-main-video');
    const btnExit = document.getElementById('btn-tv-exit-view');
    const btnToggleMenu = document.getElementById('btn-tv-toggle-menu');
    const btnFullscreen = document.getElementById('btn-tv-fullscreen');
    const wrapper = document.getElementById('tv-screen-wrapper');

    btnExit.addEventListener('click', () => {
        if (currentUserToken) {
            switchView('profile');
        } else {
            switchView('home');
        }
    });

    btnToggleMenu.addEventListener('click', () => toggleTvOverlay());

    btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            wrapper.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    });

    // Keyboard support like Samsung Remote Control
    window.addEventListener('keydown', (e) => {
        if (currentView !== 'live') return;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                changeTvChannel(-1);
                showTvOverlayTemporarily();
                break;
            case 'ArrowDown':
                e.preventDefault();
                changeTvChannel(1);
                showTvOverlayTemporarily();
                break;
            case 'm':
            case 'M':
                toggleTvOverlay();
                break;
            case 'f':
            case 'F':
                btnFullscreen.click();
                break;
            case 'Escape':
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                } else {
                    btnExit.click();
                }
                break;
        }
    });

    // Toggle menu on video click
    document.getElementById('tv-video-container').addEventListener('click', () => {
        toggleTvOverlay();
    });
}

async function launchTvLiveMode(targetChannel = null) {
    switchView('live');

    // Use current user's channels if logged in, otherwise default channels
    if (allUserChannels && allUserChannels.length > 0) {
        tvChannels = allUserChannels;
    } else {
        // Try fetching channels from backend
        try {
            const res = await fetch(`${API_BASE}/api/channels`);
            const data = await res.json();
            if (data.channels && data.channels.length > 0) {
                tvChannels = data.channels;
            } else {
                tvChannels = DEFAULT_FALLBACK_CHANNELS;
            }
        } catch (e) {
            tvChannels = DEFAULT_FALLBACK_CHANNELS;
        }
    }

    renderTvVerticalChannelsBar();

    // Select channel
    if (targetChannel) {
        const foundIdx = tvChannels.findIndex(c => c.url === targetChannel.url || c.name === targetChannel.name);
        currentTvIndex = foundIdx !== -1 ? foundIdx : 0;
    } else {
        currentTvIndex = 0;
    }

    playTvChannel(currentTvIndex);
    showTvOverlayTemporarily();
}

function renderTvVerticalChannelsBar() {
    const list = document.getElementById('tv-channels-scroll-list');
    list.innerHTML = '';

    tvChannels.forEach((ch, idx) => {
        const item = document.createElement('div');
        item.className = `channel-nav-item ${idx === currentTvIndex ? 'active' : ''}`;
        item.dataset.index = idx;

        const numSpan = document.createElement('span');
        numSpan.className = 'ch-num';
        numSpan.textContent = ch.number || String(idx + 1).padStart(3, '0');
        item.appendChild(numSpan);

        const logoWrap = document.createElement('div');
        logoWrap.className = 'ch-logo-wrap';

        if (ch.logo && ch.logo.startsWith('http')) {
            const img = document.createElement('img');
            img.src = ch.logo;
            img.alt = ch.name;
            img.onerror = () => {
                img.style.display = 'none';
                logoWrap.innerHTML = `<span class="ch-fallback-name">${escapeHtml(ch.name)}</span>`;
            };
            logoWrap.appendChild(img);
        } else {
            logoWrap.innerHTML = `<span class="ch-fallback-name">${escapeHtml(ch.name)}</span>`;
        }

        item.appendChild(logoWrap);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            currentTvIndex = idx;
            playTvChannel(currentTvIndex);
            showTvOverlayTemporarily();
        });

        list.appendChild(item);
    });

    updateTvVerticalPosition();
}

function updateTvVerticalPosition() {
    const list = document.getElementById('tv-channels-scroll-list');
    const items = list.querySelectorAll('.channel-nav-item');
    if (!items.length) return;

    items.forEach((item, idx) => {
        item.classList.toggle('active', idx === currentTvIndex);
    });

    const activeItem = items[currentTvIndex];
    if (activeItem) {
        const center = (window.innerHeight - 72) / 2;
        const itemCenter = activeItem.offsetTop + (activeItem.offsetHeight / 2);
        const offset = center - itemCenter;
        list.style.transform = `translateY(${offset}px)`;
    }
}

function changeTvChannel(delta) {
    if (tvChannels.length === 0) return;
    currentTvIndex = (currentTvIndex + delta + tvChannels.length) % tvChannels.length;
    playTvChannel(currentTvIndex);
}

function playTvChannel(index) {
    const channel = tvChannels[index];
    if (!channel) return;

    updateTvVerticalPosition();
    updateTvWatermarkAndEpg(channel);

    const video = document.getElementById('tv-main-video');
    const bufferBadge = document.getElementById('tv-player-buffering');
    const errorBadge = document.getElementById('tv-player-error');

    bufferBadge.classList.remove('hidden');
    errorBadge.classList.add('hidden');

    if (tvHls) {
        tvHls.destroy();
        tvHls = null;
    }

    const streamUrl = channel.url;

    if (Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.startsWith('http'))) {
        tvHls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30
        });

        tvHls.loadSource(streamUrl);
        tvHls.attachMedia(video);

        tvHls.on(Hls.Events.MANIFEST_PARSED, () => {
            bufferBadge.classList.add('hidden');
            video.play().catch(() => {});
        });

        tvHls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                bufferBadge.classList.add('hidden');
                errorBadge.classList.remove('hidden');
                document.getElementById('tv-error-text').textContent = 'Señal no disponible temporalmente';
            }
        });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.play().then(() => {
            bufferBadge.classList.add('hidden');
        }).catch(() => {
            bufferBadge.classList.add('hidden');
            errorBadge.classList.remove('hidden');
        });
    }

    video.onplaying = () => bufferBadge.classList.add('hidden');
    video.onwaiting = () => bufferBadge.classList.remove('hidden');
}

function updateTvWatermarkAndEpg(channel) {
    // Watermark
    const watermark = document.getElementById('tv-watermark-img');
    if (channel.logo && channel.logo.startsWith('http')) {
        watermark.src = channel.logo;
        watermark.classList.remove('hidden');
        watermark.onerror = () => watermark.classList.add('hidden');
    } else {
        watermark.classList.add('hidden');
    }

    // Dynamic realistic EPG Program names
    const now = new Date();
    const currentHour = now.getHours();
    const currentMins = now.getMinutes();
    const remainingMins = 60 - currentMins;

    document.getElementById('tv-epg-title-current').textContent = getDynamicProgramTitle(channel.name, currentHour);
    document.getElementById('tv-epg-sub-current').textContent = `En vivo por ${channel.name}`;
    document.getElementById('tv-epg-time-left').textContent = `Quedan ${remainingMins} min`;

    const progressFill = document.getElementById('tv-epg-progress-fill');
    if (progressFill) progressFill.style.width = `${Math.round((currentMins / 60) * 100)}%`;

    const nextHour = (currentHour + 1) % 24;
    document.getElementById('tv-epg-title-next').textContent = getDynamicProgramTitle(channel.name, nextHour);
    document.getElementById('tv-epg-upcoming-time').textContent = `Comienza a las ${String(nextHour).padStart(2, '0')}:00`;
}

function getDynamicProgramTitle(name, hour) {
    const ch = (name || '').toLowerCase();
    if (ch.includes('noticias') || ch.includes('24 horas') || ch.includes('t13') || ch.includes('biobio')) {
        if (hour >= 6 && hour < 9) return 'Edición Matinal en Vivo';
        if (hour >= 13 && hour < 15) return 'Noticiero Tarde Central';
        if (hour >= 20 && hour < 22) return 'Edición Central de Noticias';
        return 'Noticias y Actualidad Minuto a Minuto';
    }
    if (ch.includes('mega') || ch.includes('13') || ch.includes('chilevisi') || ch.includes('tvn')) {
        if (hour >= 8 && hour < 13) return 'Matinal en Directo';
        if (hour >= 15 && hour < 18) return 'Telenovela & Reportajes';
        if (hour >= 22) return 'Horario Estelar Prime';
        return 'Transmisión Oficial en Directo';
    }
    return `Programa Especial (${String(hour).padStart(2, '0')}:00)`;
}

function toggleTvOverlay() {
    isTvOverlayVisible = !isTvOverlayVisible;
    const overlay = document.getElementById('tv-main-overlay');
    const vignette = document.getElementById('tv-vignette');

    if (isTvOverlayVisible) {
        overlay.classList.remove('faded-out');
        vignette.style.opacity = '1';
        showTvOverlayTemporarily();
    } else {
        overlay.classList.add('faded-out');
        vignette.style.opacity = '0';
    }
}

function showTvOverlayTemporarily() {
    isTvOverlayVisible = true;
    const overlay = document.getElementById('tv-main-overlay');
    const vignette = document.getElementById('tv-vignette');
    overlay.classList.remove('faded-out');
    vignette.style.opacity = '1';

    if (tvOverlayTimeout) clearTimeout(tvOverlayTimeout);
    tvOverlayTimeout = setTimeout(() => {
        overlay.classList.add('faded-out');
        vignette.style.opacity = '0';
        isTvOverlayVisible = false;
    }, 7000); // Hide after 7 seconds like Smart TV OSC
}

function initClock() {
    const update = () => {
        const now = new Date();
        const hrs = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const clockEl = document.getElementById('tv-realtime-clock');
        if (clockEl) clockEl.textContent = `${hrs}:${mins}`;
    };
    update();
    setInterval(update, 1000);
}

// Utilities
function showToast(msg) {
    const toast = document.getElementById('toast-notify');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
