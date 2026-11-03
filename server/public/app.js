/**
 * M3U PLAYER - Web Application Logic
 * Navbar, Profile (My Channels Only), and Live TV Mode (Samsung Smart TV Style)
 */

// API_BASE: 
// - En Vercel: usa rutas relativas /api (mismo servidor, mismo dominio — sin CORS)
// - En GitHub Pages o archivo local: apunta al dominio de Vercel donde están las funciones serverless
const VERCEL_DOMAIN = 'https://m3u-player-one.vercel.app';
const IS_ANDROID_APP = window.location.hostname === 'appassets.androidplatform.net';
const API_BASE = (window.location.hostname.includes('github.io') || window.location.hostname === 'appassets.androidplatform.net' || window.location.protocol === 'file:')
    ? VERCEL_DOMAIN
    : ''; // En Vercel (vercel.app) o localhost: rutas relativas /api

// State
let currentUserToken = localStorage.getItem('m3u_web_token');
let currentUsername = localStorage.getItem('m3u_web_user');
let currentView = 'home'; // 'home', 'profile', 'live'
let authModalMode = 'login'; // 'login' or 'register'

let allUserChannels = [];
let filteredChannels = [];
let activeProfileCategory = 'ALL';
let userPlaylists = [];

// Avoid repeatedly requesting broken logos during view changes.
const failedLogoUrls = new Set();
function usableLogo(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
    const secureUrl = url.replace(/^http:/i, 'https:');
    return failedLogoUrls.has(secureUrl) ? '' : secureUrl;
}
document.addEventListener('error', event => {
    if (event.target?.tagName === 'IMG' && event.target.src) failedLogoUrls.add(event.target.src);
}, true);

// TV Mode State
let tvChannels = [];
let tvAllChannels = [];
let tvFavoritesOnly = false;
let tvPlayingChannel = null;

function channelFavoriteKey(channel) {
    return JSON.stringify([channel.playlistName || '', channel.name || channel.url]);
}

function readTvFavorites() {
    try {
        const saved = JSON.parse(localStorage.getItem('m3u_favorites:' + (currentUsername || 'guest')) || '[]');
        return new Set(Array.isArray(saved) ? saved.filter(key => typeof key === 'string') : []);
    } catch { return new Set(); }
}

function orderedTvChannels(channels, favorites, onlyFavorites) {
    return channels.filter(ch => !onlyFavorites || favorites.has(channelFavoriteKey(ch)))
        .slice().sort((a, b) => Number(favorites.has(channelFavoriteKey(b))) - Number(favorites.has(channelFavoriteKey(a))) ||
            String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true }) ||
            String(a.name || '').localeCompare(String(b.name || ''), 'es'));
}

function refreshTvFavorites() {
    const favorites = readTvFavorites();
    if (!tvAllChannels.some(ch => favorites.has(channelFavoriteKey(ch)))) tvFavoritesOnly = false;
    tvChannels = orderedTvChannels(tvAllChannels, favorites, tvFavoritesOnly);
    currentTvIndex = tvPlayingChannel ? tvChannels.findIndex(ch => ch.url === tvPlayingChannel.url) : 0;
    const filter = document.getElementById('btn-tv-favorites');
    filter.textContent = tvFavoritesOnly ? '★' : '☆';
    filter.setAttribute('aria-label', tvFavoritesOnly ? 'Ver todos los canales' : 'Ver favoritos');
    filter.setAttribute('aria-pressed', String(tvFavoritesOnly));
    renderTvVerticalChannelsBar();
}

function toggleTvFavorite(channel) {
    const favorites = readTvFavorites();
    const key = channelFavoriteKey(channel);
    const removing = favorites.has(key);
    if (removing) favorites.delete(key);
    else favorites.add(key);
    try {
        localStorage.setItem('m3u_favorites:' + (currentUsername || 'guest'), JSON.stringify([...favorites]));
    } catch {
        showToast('No se pudo guardar el favorito. Revisa el almacenamiento del navegador.');
        return;
    }
    refreshTvFavorites();
    showToast(removing ? 'Canal quitado de favoritos' : 'Canal añadido a favoritos');
    showTvOverlayTemporarily();
}
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
window.addEventListener('DOMContentLoaded', async () => {
    initNavbar();
    initAuthModal();
    initProfileView();
    initTvPlayer();
    initClock();

    if (IS_ANDROID_APP) {
        document.body.classList.add('android-app');
        const email = document.getElementById('modal-username');
        email.type = 'email';
        email.placeholder = 'tu@correo.com';
        email.previousElementSibling.textContent = 'Correo electrónico';
        switchView('home');
        openAuthModal('login');
        if (currentUserToken) {
            const submit = document.getElementById('btn-auth-submit');
            submit.disabled = true;
            submit.textContent = 'Cargando canales…';
            try { await startAndroidLive(); }
            catch (error) { showAuthError(error.message); }
            finally { submit.disabled = false; submit.textContent = 'Iniciar sesión'; }
        }
        return;
    }

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
    document.getElementById('nav-btn-profile').addEventListener('click', () => {
        switchView('profile');
        loadUserData();
    });
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
    if (IS_ANDROID_APP) {
        document.body.classList.toggle('android-live', viewName === 'live');
        window.AndroidApp?.setLiveMode(viewName === 'live');
    }

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
        if (tvHls) { tvHls.destroy(); tvHls = null; }
        if (tvVideo && !tvVideo.paused) {
            tvVideo.pause();
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
        const password = document.getElementById('modal-password').value;
        const submitBtn = document.getElementById('btn-auth-submit');
        if (submitBtn.disabled) return;

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
            document.getElementById('modal-password').value = '';

            if (IS_ANDROID_APP) {
                await startAndroidLive();
                return;
            }

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
        ++userDataRevision;
        userPlaylists = [];
        renderUserPlaylists([]);
        reconcileAccountChannels([]);
        setAuthState(false);
        showToast('Sesión cerrada correctamente');
        switchView('home');
        if (IS_ANDROID_APP) openAuthModal('login');
    });
}

function openAuthModal(mode = 'login') {
    setAuthModalMode(mode);
    hideAuthAlerts();
    document.getElementById('modal-auth').classList.remove('hidden');
    document.getElementById('modal-username').focus();
}

function closeAuthModal() {
    if (IS_ANDROID_APP && currentView !== 'live') return;
    document.getElementById('modal-auth').classList.add('hidden');
    hideAuthAlerts();
}

// Validate saved sessions and fetch the enabled list before entering Android live TV.
async function startAndroidLive() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch(`${API_BASE}/api/user/channels`, {
            cache: 'no-store', signal: controller.signal,
            headers: { Authorization: `Bearer ${currentUserToken}` }
        });
        if (response.status === 401 || response.status === 403) {
            currentUserToken = null;
            currentUsername = null;
            localStorage.removeItem('m3u_web_token');
            localStorage.removeItem('m3u_web_user');
            throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
        }
        if (!response.ok) throw new Error('No se pudieron cargar tus canales. Intenta nuevamente.');
        let data = await response.json();
        if (!Array.isArray(data.channels)) throw new Error('La lista de canales no es válida.');
        if (!Array.isArray(data.channels)) throw new Error('La lista de canales no es válida.');
        const enabled = data.channels.filter(channel => channel && channel.enabled !== false && channel.disabled !== true &&
            channel.active !== false && typeof channel.url === 'string' && /^https?:\/\//i.test(channel.url));
        if (!enabled.length) throw new Error('No hay canales habilitados para reproducir. Intenta nuevamente más tarde.');
        allUserChannels = enabled;
        setAuthState(true, currentUsername);
        await launchTvLiveMode(null, enabled);
        closeAuthModal();
    } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) {
            throw new Error('No se pudo conectar. Revisa internet e intenta nuevamente.');
        }
        throw error;
    } finally { clearTimeout(timer); }
}

function setAuthModalMode(mode) {
    authModalMode = mode;
    const tabLogin = document.getElementById('tab-login-btn');
    const tabRegister = document.getElementById('tab-register-btn');
    const label = document.getElementById('auth-btn-label') || document.getElementById('btn-auth-submit');
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
        submitBtn.innerHTML = '<span>Descargando y verificando canales...</span>';

        try {
            const res = await fetch(`${API_BASE}/api/user/playlist/url`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUserToken}`
                },
                body: JSON.stringify({ url, name })
            });

            let data = await readApiResponse(res, 'analizar la lista por URL');
            if (!res.ok || data.error) throw new Error(data.error || 'Error al guardar lista');
            data = await analyzeAndSavePlaylist(data, submitBtn);

            showPlaylistFeedback(`Lista guardada: ${data.channelsCount ?? data.channelCount ?? 0} canales. ${data.verification?.unverified ?? 0} sin verificar; algunos pueden funcionar solo en VLC o en la TV.`, 'success');
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

        btnSubmitFile.disabled = true;
        btnSubmitFile.innerHTML = '<span>Subiendo y verificando canales...</span>';

        try {
            const res = await fetch(`${API_BASE}/api/user/playlist/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentUserToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: await file.text(), name, filename: file.name })
            });

            let data = await readApiResponse(res, 'analizar el archivo M3U');
            if (!res.ok || data.error) throw new Error(data.error || 'Error al procesar archivo');
            data = await analyzeAndSavePlaylist(data, btnSubmitFile);

            showPlaylistFeedback(`Lista guardada: ${data.channelsCount ?? data.channelCount ?? 0} canales. ${data.verification?.unverified ?? 0} sin verificar; algunos pueden funcionar solo en VLC o en la TV.`, 'success');
            formFile.reset();
            fileLabel.textContent = 'Ningún archivo cargado (.m3u, .m3u8)';
            await loadUserData();
        } catch (err) {
            showPlaylistFeedback(err.message, 'error');
        } finally {
            btnSubmitFile.disabled = !fileInput.files.length;
            btnSubmitFile.innerHTML = '<span>📤 Subir Archivo y Procesar</span>';
        }
    });

    document.getElementById('btn-refresh-playlists').addEventListener('click', () => loadUserData());
}

let playlistFeedbackTimer;
let toastTimer;
let userDataRevision = 0;
const pendingPlaylistDeletes = new Set();

// A successful download is not evidence that the browser can decode video.
function checkBrowserPlayback(channel, signal) {
    return new Promise(resolve => {
        const video = document.createElement('video');
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.style.cssText = 'position:fixed;left:-10px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
        video.setAttribute('aria-hidden', 'true');
        document.body.appendChild(video);
        let player, timer, poll, finished = false;
        const directTs = typeof DirectMpegts !== 'undefined' && DirectMpegts.isChannel(channel);
        const localHosts = ['127.0.0.1', 'localhost', '[::1]'];
        let localSource = false;
        try { localSource = localHosts.includes(new URL(channel.url).hostname); } catch {}
        const convertedHls = localSource || (channel.playbackType === 'hls' && !!channel.sourceUrl && channel.url !== channel.sourceUrl);
        let mode = !directTs && !convertedHls && window.location.protocol === 'https:' && /^http:/i.test(channel.url) ? 'proxy' : 'direct';
        let firstTime = null;
        const proxyUrl = url => API_BASE + '/api/proxy/hls?url=' + encodeURIComponent(url);
        const finish = (playable, reason) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            clearInterval(poll);
            signal.removeEventListener('abort', abort);
            if (player) player.destroy();
            video.onerror = null;
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.remove();
            resolve({ candidateId: channel.candidateId, playable, playbackMode: mode, reason });
        };
        const abort = () => finish(false, 'Análisis cancelado');
        function retry(reason) {
            if (finished) return;
            if (mode === 'direct' && !directTs && !convertedHls) {
                mode = 'proxy';
                safeStart();
            } else finish(false, reason);
        }
        function safeStart() {
            try { start(); }
            catch (error) { finish(false, error.message || 'No se pudo iniciar el reproductor'); }
        }
        function start() {
            if (channel.playbackNotice) return finish(false, channel.playbackNotice);
            if (localSource && !localHosts.includes(new URL(window.location.href).hostname)) {
                return finish(false, 'Esta lista usa un conversor local. En este PC abre Abrir-Reproductor.cmd y http://127.0.0.1:3000. Para otros dispositivos necesitas una lista con enlaces públicos.');
            }
            clearTimeout(timer);
            if (player) { player.destroy(); player = null; }
            video.onerror = null;
            video.pause();
            video.removeAttribute('src');
            video.load();
            firstTime = null;
            timer = setTimeout(() => retry('Sin imagen y reproducción sostenida dentro del tiempo de prueba'), convertedHls ? 55000 : 12000);
            if (directTs) {
                player = DirectMpegts.create(video, channel.url, {
                    onError: message => finish(false, message),
                    onAutoplayBlocked: () => finish(false, 'El navegador no permitió iniciar el video')
                });
                player.start();
                return;
            }
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                player = new Hls({ enableWorker: true, lowLatencyMode: false, liveSyncDurationCount: 4,
                    manifestLoadingTimeOut: convertedHls ? 45000 : 10000,
                    maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 10,
                    xhrSetup: (xhr, url) => {
                        if (mode === 'proxy' && new URL(url, window.location.href).pathname !== '/api/proxy/hls') {
                            xhr.open('GET', proxyUrl(url), true);
                        }
                    }
                });
                const attempt = player;
                player.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (player === attempt) video.play().catch(() => finish(false, 'El navegador no permitió iniciar el video'));
                });
                player.on(Hls.Events.ERROR, (_event, data) => {
                    if (player !== attempt || !data.fatal) return;
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) retry('No se pudo acceder a la señal');
                    else finish(false, 'El navegador no pudo decodificar el video');
                });
                player.loadSource(mode === 'proxy' ? proxyUrl(channel.url) : channel.url);
                player.attachMedia(video);
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.onerror = () => retry('Video incompatible o inaccesible');
                video.src = mode === 'proxy' ? proxyUrl(channel.url) : channel.url;
                video.play().catch(() => finish(false, 'El navegador no permitió iniciar el video'));
            } else finish(false, 'Este navegador no admite HLS');
        }
        poll = setInterval(() => {
            if (video.readyState < 2 || video.videoWidth <= 0 || video.paused || video.seeking) return;
            const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
            if (typeof frames === 'number' && frames < 2) return;
            if (firstTime === null) firstTime = video.currentTime;
            if (video.currentTime - firstTime >= 1) finish(true);
        }, 200);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        else safeStart();
    });
}

async function analyzeAndSavePlaylist(preview, button) {
    if (!preview.requiresPlaybackCheck || !Array.isArray(preview.channels)) {
        throw new Error('El servidor debe actualizarse para comprobar la reproducción antes de guardar.');
    }
    const token = currentUserToken;
    const controller = new AbortController();
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-submit-action';
    cancel.textContent = 'Cancelar análisis';
    cancel.onclick = () => controller.abort();
    button.after(cancel);
    const results = [];
    let cursor = 0, completed = 0, playable = 0;
    const progress = () => {
        button.textContent = `Analizando ${completed}/${preview.channels.length} · ${playable} con video`;
    };
    progress();
    try {
        async function worker() {
            while (cursor < preview.channels.length && !controller.signal.aborted) {
                const channel = preview.channels[cursor++];
                const result = await checkBrowserPlayback(channel, controller.signal);
                results.push(result);
                completed++;
                if (result.playable) playable++;
                progress();
            }
        }
        await Promise.all(Array.from({ length: Math.min(2, preview.channels.length) }, worker));
        if (controller.signal.aborted) throw new Error('Análisis cancelado. No se guardó la lista.');
        if (token !== currentUserToken) throw new Error('La sesión cambió. Vuelve a cargar la lista.');
        button.textContent = `Guardando ${preview.channels.length} canales...`;
        cancel.disabled = true;
        const response = await fetch(`${API_BASE}/api/user/playlist/confirm`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ importId: preview.importId, results })
        });
        const data = await readApiResponse(response, 'guardar los canales comprobados');
        if (!response.ok || data.error) throw new Error(data.error || 'No se pudo guardar la lista comprobada');
        return data;
    } finally {
        controller.abort();
        cancel.remove();
    }
}

async function readApiResponse(response, operation) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        const path = response.url ? new URL(response.url).pathname : '/api';
        throw new Error(`No se pudo ${operation}: el servidor respondió HTTP ${response.status} en ${path} sin datos JSON. Recarga la página después del despliegue; si persiste, revisa la configuración de la API en Vercel.`);
    }
}

function showPlaylistFeedback(msg, type) {
    const box = document.getElementById('playlist-action-feedback');
    clearTimeout(playlistFeedbackTimer);
    box.setAttribute('role', type === 'error' ? 'alert' : 'status');
    box.textContent = msg;
    box.className = `action-feedback ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    box.classList.remove('hidden');
    playlistFeedbackTimer = setTimeout(() => box.classList.add('hidden'), 7000);
}

function stopAccountPlayback() {
    if (tvHls) { tvHls.destroy(); tvHls = null; }
    const video = document.getElementById('tv-main-video');
    video.onplaying = null;
    video.onwaiting = null;
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    document.getElementById('tv-player-buffering').classList.add('hidden');
    document.getElementById('tv-watermark-img').classList.add('hidden');
    document.getElementById('tv-player-channel-name').textContent = '';
    document.getElementById('tv-epg-title-next').textContent = '';
    document.getElementById('tv-epg-upcoming-time').textContent = '';
}

function showAccountEmptyState(message = 'No tienes canales habilitados. Añade una lista para ver TV en vivo.') {
    document.getElementById('tv-error-text').textContent = message;
    document.getElementById('tv-player-error').classList.remove('hidden');
}

function reconcileAccountChannels(channels) {
    const previous = tvPlayingChannel;
    allUserChannels = channels.filter(channel => channel && channel.enabled !== false && channel.disabled !== true && channel.active !== false);
    if (activeProfileCategory !== 'ALL' && !allUserChannels.some(channel => channel.group === activeProfileCategory)) activeProfileCategory = 'ALL';
    const validFavorites = new Set(allUserChannels.map(channelFavoriteKey));
    const favorites = readTvFavorites();
    const kept = [...favorites].filter(key => validFavorites.has(key));
    if (currentUserToken && kept.length !== favorites.size) {
        try { localStorage.setItem('m3u_favorites:' + (currentUsername || 'guest'), JSON.stringify(kept)); }
        catch { /* Deleted channels are still removed from the live list. */ }
    }
    tvAllChannels = allUserChannels.slice();
    tvPlayingChannel = previous ? allUserChannels.find(channel => channel.url === previous.url) || null : null;
    refreshTvFavorites();
    if (!tvPlayingChannel) {
        stopAccountPlayback();
        if (currentView === 'live') {
            if (tvChannels.length) playTvChannel(0);
            else showAccountEmptyState();
        }
    }
    document.getElementById('profile-total-channels-badge').textContent = allUserChannels.length;
    document.getElementById('profile-channels-tab-count').textContent = allUserChannels.length;
    renderProfileCategories();
    filterProfileChannels();
}

let liveSyncInFlight = false;
async function refreshLiveAccountChannels() {
    if (!currentUserToken || currentView !== 'live' || document.hidden || liveSyncInFlight || pendingPlaylistDeletes.size) return;
    const token = currentUserToken, revision = userDataRevision;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    liveSyncInFlight = true;
    try {
        const response = await fetch(`${API_BASE}/api/user/channels`, {
            cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${token}` }
        });
        if (token !== currentUserToken || revision !== userDataRevision) return;
        if (response.status === 401 || response.status === 403) {
            document.getElementById('btn-logout').click();
            return;
        }
        if (!response.ok) return;
        const data = await response.json();
        if (token !== currentUserToken || revision !== userDataRevision || !Array.isArray(data.channels)) return;
        const channels = data.channels.filter(channel => channel && channel.enabled !== false && channel.disabled !== true && channel.active !== false);
        if (JSON.stringify(channels) !== JSON.stringify(allUserChannels)) reconcileAccountChannels(channels);
    } catch { /* A temporary network failure does not discard the last confirmed list. */ }
    finally { clearTimeout(timer); liveSyncInFlight = false; }
}

function initAccountChannelSync() {
    setInterval(refreshLiveAccountChannels, 30000);
    window.addEventListener('focus', refreshLiveAccountChannels);
    document.addEventListener('visibilitychange', refreshLiveAccountChannels);
}

function recoverRejectedSession(response, token) {
    if (![401, 403].includes(response.status) || !token || token !== currentUserToken) return false;
    document.getElementById('btn-logout').click();
    openAuthModal('login');
    showAuthError('Tu sesión ya no es válida. Inicia sesión nuevamente.');
    return true;
}

// Load playlists & channels for the authenticated user
async function loadUserData() {
    if (!currentUserToken) return;
    const revision = ++userDataRevision;
    const token = currentUserToken;

    try {
        // 1. Fetch user playlists
        const plRes = await fetch(`${API_BASE}/api/user/playlists`, {
            cache: 'no-store',
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        if (revision !== userDataRevision) return;
        if (recoverRejectedSession(plRes, token)) return;
        if (!plRes.ok) throw new Error('No se pudieron actualizar las listas. Intenta nuevamente.');
        if (plRes.ok) {
            const plData = await plRes.json();
            if (revision !== userDataRevision) return;
            userPlaylists = (plData.playlists || []).filter(pl => !pendingPlaylistDeletes.has(String(pl.id || pl._id)));
            renderUserPlaylists(userPlaylists);
        }

        // 2. Fetch user channels
        const chRes = await fetch(`${API_BASE}/api/user/channels`, {
            cache: 'no-store',
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });

        if (revision !== userDataRevision) return;
        if (recoverRejectedSession(chRes, token)) return;
        if (!chRes.ok) throw new Error('No se pudieron actualizar los canales. Intenta nuevamente.');
        if (chRes.ok) {
            const chData = await chRes.json();
            if (revision !== userDataRevision) return;
            if (token !== currentUserToken) return;
            if (!Array.isArray(chData.channels)) throw new Error('La lista de canales no es válida.');
            reconcileAccountChannels(chData.channels);
        }

        if (revision !== userDataRevision) return;
        // Update counters
        document.getElementById('profile-total-channels-badge').textContent = allUserChannels.length;
        document.getElementById('profile-total-playlists-badge').textContent = userPlaylists.length;
        document.getElementById('profile-channels-tab-count').textContent = allUserChannels.length;

        // Render categories & channels
        renderProfileCategories();
        filterProfileChannels();

    } catch (err) {
        console.error('Error cargando datos de usuario:', err);
        if (revision === userDataRevision) showPlaylistFeedback(err.message, 'error');
    }
}

function renderUserPlaylists(playlists) {
    const container = document.getElementById('profile-playlists-list');
    container.innerHTML = '';
    document.getElementById('profile-total-playlists-badge').textContent = playlists?.length || 0;

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
            const id = String(pl.id || pl._id);
            if (pendingPlaylistDeletes.has(id)) return;
            if (!confirm(`¿Eliminar la lista "${pl.name}"?`)) return;
            const token = currentUserToken;
            pendingPlaylistDeletes.add(id);
            ++userDataRevision;
            const index = userPlaylists.findIndex(entry => String(entry.id || entry._id) === id);
            userPlaylists = userPlaylists.filter(entry => String(entry.id || entry._id) !== id);
            renderUserPlaylists(userPlaylists);
            showPlaylistFeedback('Eliminando lista…', 'success');
            try {
                const res = await fetch(`${API_BASE}/api/user/playlist/${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${currentUserToken}` }
                });
                const data = await res.json().catch(() => ({}));
                if (token !== currentUserToken) return;
                if (res.status !== 404 && (!res.ok || data.error)) throw new Error(data.error || 'No se pudo eliminar la lista. Intenta nuevamente.');
                ++userDataRevision;
                userPlaylists = userPlaylists.filter(entry => String(entry.id || entry._id) !== id);
                // Remove locally before refreshing, even if the subsequent request fails.
                reconcileAccountChannels(allUserChannels.filter(channel => channel.playlistId && String(channel.playlistId) !== id));
                renderProfileCategories();
                filterProfileChannels();
                document.getElementById('profile-total-channels-badge').textContent = allUserChannels.length;
                document.getElementById('profile-channels-tab-count').textContent = allUserChannels.length;
                renderUserPlaylists(userPlaylists);
                showPlaylistFeedback('Lista eliminada correctamente.', 'success');
                showToast('Lista eliminada correctamente');
            } catch (e) {
                if (token !== currentUserToken) return;
                ++userDataRevision;
                if (!userPlaylists.some(entry => String(entry.id || entry._id) === id)) {
                    userPlaylists.splice(Math.max(0, index), 0, pl);
                }
                renderUserPlaylists(userPlaylists);
                showPlaylistFeedback(`${e.message} La lista se ha restaurado en pantalla.`, 'error');
                showToast('No se pudo eliminar la lista');
            } finally {
                pendingPlaylistDeletes.delete(id);
                if (token === currentUserToken && pendingPlaylistDeletes.size === 0) await loadUserData();
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
        if (usableLogo(ch.logo)) {
            logoHtml = `<img src="${escapeHtml(usableLogo(ch.logo))}" alt="" class="card-channel-logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display:none;font-size:24px;">📺</span>`;
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
function initTvVolume(video) {
    const slider = document.getElementById('tv-volume');
    const level = document.getElementById('tv-volume-level');
    const mute = document.getElementById('btn-tv-mute');
    try {
        const saved = JSON.parse(localStorage.getItem('m3u_player_audio') || 'null');
        if (saved && typeof saved.volume === 'number' && Number.isFinite(saved.volume)) {
            video.volume = Math.max(0, Math.min(1, saved.volume));
            video.muted = saved.muted === true;
        }
    } catch { /* Use the browser's current audio settings if storage is unavailable. */ }
    const update = () => {
        const percent = Math.round(video.volume * 100);
        const silent = video.muted || percent === 0;
        slider.value = percent;
        slider.setAttribute('aria-valuetext', `${percent}%${video.muted ? ', silenciado' : ''}`);
        level.textContent = video.muted ? '0%' : `${percent}%`;
        mute.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4L6 8H3v8h3l5 4z"/>' +
            (silent ? '<path d="M16 9l5 6M21 9l-5 6"/>' : '<path d="M15 8a6 6 0 010 8M18 5a10 10 0 010 14"/>') + '</svg>';
        mute.setAttribute('aria-label', silent ? 'Activar sonido' : 'Silenciar');
        mute.setAttribute('aria-pressed', String(silent));
        try {
            localStorage.setItem('m3u_player_audio', JSON.stringify({ volume: video.volume, muted: video.muted }));
        } catch { /* Audio controls remain usable without storage. */ }
    };
    slider.addEventListener('input', () => {
        video.volume = Number(slider.value) / 100;
        video.muted = video.volume === 0;
        update();
    });
    mute.addEventListener('click', () => {
        if (video.muted || video.volume === 0) {
            if (video.volume === 0) video.volume = 0.5;
            video.muted = false;
        } else video.muted = true;
        update();
    });
    video.addEventListener('volumechange', update);
    update();
}

function initTvPlaybackUi(video) {
    const container = document.getElementById('tv-video-container');
    const play = document.getElementById('btn-tv-play');
    const buffer = document.getElementById('tv-player-buffering');
    video.controls = false;
    const update = () => {
        const paused = video.paused;
        play.setAttribute('aria-label', paused ? 'Reproducir' : 'Pausar');
        play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7">' +
            (paused ? '<path d="M8 5l11 7-11 7z"/>' : '<path d="M8 5v14M16 5v14"/>') + '</svg>';
    };
    const ready = () => { container.classList.add('has-video-frame'); update(); };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('playing', ready);
    video.addEventListener('pause', update);
    video.addEventListener('emptied', () => { container.classList.remove('has-video-frame'); update(); });
    play.addEventListener('click', async () => {
        if (!document.getElementById('tv-player-error').classList.contains('hidden')) {
            playTvChannel(currentTvIndex);
            return;
        }
        if (video.paused) {
            try { await video.play(); }
            catch { buffer.classList.add('hidden'); showToast('No se pudo iniciar la señal. Intenta nuevamente.'); }
        } else {
            video.pause();
            buffer.classList.add('hidden');
        }
        update();
    });
    update();
}

function initTvPlayer() {
    const video = document.getElementById('tv-main-video');
    initTvPlaybackUi(video);
    initTvVolume(video);
    initTvChannelScroll();
    initAccountChannelSync();
    const btnExit = document.getElementById('btn-tv-exit-view');
    if (IS_ANDROID_APP) btnExit.setAttribute('aria-label', 'Cerrar sesión');
    const btnToggleMenu = document.getElementById('btn-tv-toggle-menu');
    const btnFullscreen = document.getElementById('btn-tv-fullscreen');
    const wrapper = document.getElementById('tv-screen-wrapper');
    const toolbar = document.getElementById('tv-web-top-controls');
    let toolbarTimer;
    const revealToolbar = () => {
        if (currentView !== 'live') return;
        toolbar.classList.add('controls-visible');
        clearTimeout(toolbarTimer);
        toolbarTimer = setTimeout(() => {
            toolbar.classList.remove('controls-visible');
            if (toolbar.contains(document.activeElement)) document.activeElement.blur();
        }, 3500);
    };
    wrapper.addEventListener('pointermove', revealToolbar);
    wrapper.addEventListener('pointerdown', revealToolbar);
    toolbar.addEventListener('focusin', revealToolbar);
    toolbar.addEventListener('input', revealToolbar);
    window.addEventListener('keydown', event => {
        if (currentView !== 'live') return;
        const wasHidden = !toolbar.classList.contains('controls-visible');
        revealToolbar();
        const buttons = Array.from(toolbar.querySelectorAll('button, input'));
        const index = buttons.indexOf(document.activeElement);
        if (event.key === 'ArrowRight' && index < 0) {
            event.preventDefault(); buttons[0].focus();
        } else if (index >= 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
        } else if (index >= 0 && event.key === 'ArrowLeft' && document.activeElement.tagName !== 'INPUT') {
            event.preventDefault(); document.activeElement.blur();
            showTvOverlayTemporarily();
        } else if (wasHidden && event.key === 'Enter') {
            event.preventDefault(); buttons[0].focus();
        }
    });
    window.playerBack = () => {
        if (currentView !== 'live') return false;
        btnExit.click();
        return true;
    };

    btnExit.addEventListener('click', () => {
        if (IS_ANDROID_APP) {
            document.getElementById('btn-logout').click();
            return;
        }
        if (currentUserToken) {
            switchView('profile');
            loadUserData();
        } else {
            switchView('home');
        }
    });

    btnToggleMenu.addEventListener('click', () => toggleTvOverlay());
    document.getElementById('btn-tv-favorites').addEventListener('click', () => {
        const favorites = readTvFavorites();
        if (!tvAllChannels.some(ch => favorites.has(channelFavoriteKey(ch)))) {
            showToast('Pulsa la estrella de un canal para añadirlo a favoritos');
            return;
        }
        tvFavoritesOnly = !tvFavoritesOnly;
        refreshTvFavorites();
        showTvOverlayTemporarily();
    });

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
        if (e.target.matches?.('input, select, textarea, button')) return;

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

async function launchTvLiveMode(targetChannel = null, availableChannels = null) {
    switchView('live');

    if (currentUserToken && !Array.isArray(availableChannels)) {
        const token = currentUserToken;
        const revision = userDataRevision;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${API_BASE}/api/user/channels`, {
                cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${token}` }
            });
            if (token !== currentUserToken || revision !== userDataRevision) return;
            if ([401, 403].includes(response.status) && recoverRejectedSession(response, token)) return;
            if (!response.ok) throw new Error('No se pudieron actualizar los canales.');
            const data = await response.json();
            if (token !== currentUserToken || revision !== userDataRevision) return;
            if (!Array.isArray(data.channels)) throw new Error('La lista de canales no es válida.');
            availableChannels = data.channels.filter(channel => channel.enabled !== false && channel.disabled !== true && channel.active !== false);
            allUserChannels = availableChannels;
        } catch (error) {
            if (token !== currentUserToken || revision !== userDataRevision) return;
            stopAccountPlayback();
            tvPlayingChannel = null;
            tvAllChannels = [];
            tvChannels = [];
            renderTvVerticalChannelsBar();
            showAccountEmptyState('No se pudieron actualizar los canales. Intenta nuevamente.');
            return;
        } finally { clearTimeout(timer); }
    }

    // Use current user's channels if logged in, otherwise default channels
    if (Array.isArray(availableChannels)) {
        tvChannels = availableChannels;
    } else if (allUserChannels && allUserChannels.length > 0) {
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

    tvAllChannels = tvChannels.slice();
    if (currentUserToken && tvAllChannels.length === 0) {
        reconcileAccountChannels([]);
        return;
    }
    const favorites = readTvFavorites();
    tvFavoritesOnly = !targetChannel && tvAllChannels.some(ch => favorites.has(channelFavoriteKey(ch)));
    tvPlayingChannel = targetChannel;
    refreshTvFavorites();

    // Select channel
    if (targetChannel) {
        const foundIdx = tvChannels.findIndex(c => c.url === targetChannel.url || c.name === targetChannel.name);
        currentTvIndex = foundIdx !== -1 ? foundIdx : 0;
    } else {
        currentTvIndex = 0;
    }

    renderTvVerticalChannelsBar();
    playTvChannel(currentTvIndex);
    showTvOverlayTemporarily();
}

function renderTvVerticalChannelsBar() {
    const list = document.getElementById('tv-channels-scroll-list');
    list.innerHTML = '';
    const favorites = readTvFavorites();

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

        if (usableLogo(ch.logo)) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.src = usableLogo(ch.logo);
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

        const favorite = document.createElement('button');
        const isFavorite = favorites.has(channelFavoriteKey(ch));
        favorite.type = 'button';
        favorite.className = 'channel-favorite' + (isFavorite ? ' selected' : '');
        favorite.textContent = isFavorite ? '★' : '☆';
        favorite.setAttribute('aria-pressed', String(isFavorite));
        favorite.setAttribute('aria-label', `${isFavorite ? 'Quitar de' : 'Añadir a'} favoritos: ${ch.name}`);
        favorite.addEventListener('click', event => {
            event.stopPropagation();
            toggleTvFavorite(ch);
            const replacement = document.getElementById('tv-channels-scroll-list').querySelector(`[data-index="${tvChannels.findIndex(c => c.url === ch.url)}"] .channel-favorite`);
            (replacement || document.getElementById('btn-tv-favorites')).focus();
        });
        item.appendChild(favorite);

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

function initTvChannelScroll() {
    if (!IS_ANDROID_APP) return;
    const bar = document.getElementById('tv-vertical-bar');
    let interacting = false;
    bar.addEventListener('scroll', () => {
        showTvOverlayTemporarily();
        if (interacting) clearTimeout(tvOverlayTimeout);
    }, { passive: true });
    bar.addEventListener('pointerdown', () => {
        interacting = true;
        showTvOverlayTemporarily();
        clearTimeout(tvOverlayTimeout);
    }, { passive: true });
    const finish = () => {
        if (!interacting) return;
        interacting = false;
        showTvOverlayTemporarily();
    };
    window.addEventListener('pointerup', finish, { passive: true });
    window.addEventListener('pointercancel', finish, { passive: true });
    window.addEventListener('resize', () => {
        if (currentView === 'live') updateTvVerticalPosition();
    });
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
        if (IS_ANDROID_APP) {
            const bar = document.getElementById('tv-vertical-bar');
            list.style.transform = 'none';
            bar.scrollTo({
                top: Math.max(0, activeItem.offsetTop + activeItem.offsetHeight / 2 - bar.clientHeight / 2),
                behavior: 'smooth'
            });
            return;
        }
        const center = (window.innerHeight - 72) / 2;
        const itemCenter = activeItem.offsetTop + (activeItem.offsetHeight / 2);
        const offset = center - itemCenter;
        list.style.transform = `translateY(${offset}px)`;
    }
}

function changeTvChannel(delta) {
    if (tvChannels.length === 0) return;
    currentTvIndex = currentTvIndex < 0 ? (delta < 0 ? tvChannels.length - 1 : 0)
        : (currentTvIndex + delta + tvChannels.length) % tvChannels.length;
    playTvChannel(currentTvIndex);
}

function playTvChannel(index) {
    const channel = tvChannels[index];
    if (!channel) return;
    tvPlayingChannel = channel;

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
    const directTs = typeof DirectMpegts !== 'undefined' && DirectMpegts.isChannel(channel);
    const localHosts = ['127.0.0.1', 'localhost', '[::1]'];
    let localSource = false;
    try { localSource = localHosts.includes(new URL(streamUrl).hostname); } catch {}
    const convertedHls = localSource || (channel.playbackType === 'hls' && !!channel.sourceUrl && streamUrl !== channel.sourceUrl);
    let usingProxy = !convertedHls && (channel.playbackMode === 'proxy' || (window.location.protocol === 'https:' && /^http:/i.test(streamUrl)));
    let recoveredMedia = false;
    let networkRetries = 0;
    let retryTimer = null;
    const proxyUrl = url => API_BASE + '/api/proxy/hls?url=' + encodeURIComponent(url);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.onerror = null;

    function fail(message) {
        bufferBadge.classList.add('hidden');
        errorBadge.classList.remove('hidden');
        document.getElementById('tv-error-text').textContent = message;
        showToast(message);
    }

    function autoplayBlocked(error) {
        if (error?.name === 'AbortError' || tvPlayingChannel !== channel) return;
        bufferBadge.classList.add('hidden');
        document.getElementById('tv-web-top-controls').classList.add('controls-visible');
        showToast('Pulsa reproducir en la barra de controles para iniciar la señal');
    }

    function startPlayback() {
        if (tvHls) { tvHls.destroy(); tvHls = null; }
        if (directTs) {
            const player = DirectMpegts.create(video, streamUrl, {
                onBuffering: value => bufferBadge.classList.toggle('hidden', !value),
                onError: fail,
                onAutoplayBlocked: autoplayBlocked
            });
            tvHls = player;
            player.start();
            return;
        }
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const player = new Hls({
                enableWorker: true,
                // A cold conversion needs time to produce its first two HLS segments.
                manifestLoadingTimeOut: 45000,
                // Favor continuity over minimum delay on variable IPTV connections.
                lowLatencyMode: false,
                liveSyncDurationCount: 4,
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                maxBufferSize: 32 * 1024 * 1024,
                capLevelToPlayerSize: true,
                capLevelOnFPSDrop: true,
                abrBandWidthFactor: 0.8,
                abrBandWidthUpFactor: 0.6,
                backBufferLength: 10,
                xhrSetup: (xhr, url) => {
                    if (usingProxy) {
                        const resolved = new URL(url, window.location.href);
                        if (resolved.pathname !== '/api/proxy/hls') xhr.open('GET', proxyUrl(url), true);
                    }
                }
            });
            tvHls = player;
            const destroy = player.destroy.bind(player);
            player.destroy = () => { clearTimeout(retryTimer); retryTimer = null; destroy(); };
            player.on(Hls.Events.FRAG_LOADED, () => {
                if (tvHls === player) networkRetries = 0;
            });
            player.on(Hls.Events.MANIFEST_PARSED, () => {
                if (tvHls !== player) return;
                video.play().catch(autoplayBlocked);
            });
            player.on(Hls.Events.ERROR, (_event, data) => {
                if (tvHls !== player || !data.fatal) return;
                // Do not retry a confirmed bad URL, HTML page or expired authorization.
                if (usingProxy || convertedHls) {
                    try {
                        const raw = data.networkDetails?.responseText || data.response?.data || data.response?.text;
                        const detail = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (/^(SOURCE_POLICY|SOURCE_DNS|SOURCE_NOT_VIDEO|SOURCE_HTTP_(400|401|403|404|410))$/.test(detail?.code)) {
                            player.stopLoad();
                            fail(detail.error);
                            return;
                        }
                    } catch { /* Non-JSON transport failures retain bounded network retries. */ }
                }
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !usingProxy && !convertedHls) {
                    usingProxy = true;
                    showToast('Reintentando la señal mediante el servidor…');
                    startPlayback();
                } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
                    // Keep decoded media while retrying transient origin failures.
                    if (retryTimer !== null) return;
                    const delay = 1000 * Math.pow(2, networkRetries++);
                    bufferBadge.classList.remove('hidden');
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        if (tvHls === player) {
                            // A restarted converter has a new manifest and segment session.
                            // startLoad() alone can keep requesting the vanished old files.
                            if (convertedHls) startPlayback();
                            else player.startLoad();
                        }
                    }, delay);
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
                    recoveredMedia = true;
                    player.recoverMediaError();
                } else {
                    player.stopLoad();
                    fail(data.type === Hls.ErrorTypes.NETWORK_ERROR
                        ? (convertedHls ? 'El conversor no pudo entregar video. Comprueba que esté encendido y que la señal de origen esté disponible.' : 'No se pudo acceder a la señal. El origen puede estar caído, restringido o el enlace haber vencido.')
                        : 'El navegador no pudo decodificar este video. Prueba abrirlo en VLC.');
                }
            });
            player.loadSource(usingProxy ? proxyUrl(streamUrl) : streamUrl);
            player.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.onerror = () => {
                if (!usingProxy && !convertedHls) {
                    usingProxy = true;
                    startPlayback();
                } else fail('No se pudo reproducir esta señal en el navegador. Prueba abrirla en VLC.');
            };
            video.src = usingProxy ? proxyUrl(streamUrl) : streamUrl;
            video.play().catch(autoplayBlocked);
        } else {
            fail('Este navegador no admite la reproducción HLS. Prueba con otro navegador o VLC.');
        }
    }
    if (channel.playbackNotice) { fail(channel.playbackNotice); return; }
    if (localSource && !localHosts.includes(new URL(window.location.href).hostname)) {
        fail('Esta lista usa un conversor local. En este PC abre Abrir-Reproductor.cmd y http://127.0.0.1:3000. Para otros dispositivos necesitas una lista con enlaces públicos.');
        return;
    }
    startPlayback();

    video.onplaying = () => bufferBadge.classList.add('hidden');
    video.onwaiting = () => bufferBadge.classList.remove('hidden');
}

function updateTvWatermarkAndEpg(channel) {
    document.getElementById('tv-player-channel-name').textContent = channel.name || '';
    // Watermark
    const watermark = document.getElementById('tv-watermark-img');
    if (usableLogo(channel.logo)) {
        watermark.referrerPolicy = 'no-referrer';
        watermark.src = usableLogo(channel.logo);
        watermark.classList.remove('hidden');
        watermark.onerror = () => watermark.classList.add('hidden');
    } else {
        watermark.classList.add('hidden');
    }

    // Dynamic realistic EPG Program names
    const now = new Date();
    const currentHour = now.getHours();
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
    clearTimeout(toastTimer);
    toast.setAttribute('role', 'status');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
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
