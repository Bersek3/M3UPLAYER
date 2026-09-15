/**
 * M3UTV Web Portal - Client Logic
 */

let currentUserToken = localStorage.getItem('m3u_web_token');
let currentUsername = localStorage.getItem('m3u_web_user');
let authMode = 'login'; // 'login' or 'register'
let allUserChannels = [];
let filteredChannels = [];
let activeCategory = 'ALL';
let hlsInstance = null;

window.addEventListener('DOMContentLoaded', () => {
    initAuthTabs();
    initPlaylistForms();
    initDropzone();

    if (currentUserToken && currentUsername) {
        showDashboard();
    } else {
        showAuth();
    }
});

// ==========================================================================
// AUTHENTICATION
// ==========================================================================
function initAuthTabs() {
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const authBtnText = document.getElementById('auth-btn-text');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authForm = document.getElementById('auth-form');
    const btnLogout = document.getElementById('btn-logout');

    tabLogin.addEventListener('click', () => {
        authMode = 'login';
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        authBtnText.textContent = 'Entrar al Panel';
        authSubtitle.textContent = 'Ingresa para administrar tus canales de Samsung TV';
        hideAlerts();
    });

    tabRegister.addEventListener('click', () => {
        authMode = 'register';
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        authBtnText.textContent = 'Crear Cuenta y Entrar';
        authSubtitle.textContent = 'Crea tu usuario para usar en tu Smart TV y subir listas';
        hideAlerts();
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlerts();

        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value.trim();
        const submitBtn = document.getElementById('btn-auth-submit');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Procesando...';

        const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            let data = {};
            try {
                data = await res.json();
            } catch (jsonErr) {
                data = { error: 'Error de respuesta del servidor (Estado ' + res.status + ')' };
            }

            if (!res.ok || data.error) {
                throw new Error(data.error || 'Error en la solicitud');
            }

            currentUserToken = data.token;
            currentUsername = data.username;
            localStorage.setItem('m3u_web_token', currentUserToken);
            localStorage.setItem('m3u_web_user', currentUsername);

            showDashboard();

        } catch (err) {
            showAuthError(err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = authMode === 'login' ? 'Entrar al Panel' : 'Crear Cuenta y Entrar';
        }
    });

    btnLogout.addEventListener('click', () => {
        localStorage.removeItem('m3u_web_token');
        localStorage.removeItem('m3u_web_user');
        currentUserToken = null;
        currentUsername = null;
        showAuth();
    });
}

function showAuth() {
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
    document.getElementById('user-header-info').classList.add('hidden');
}

function showDashboard() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    document.getElementById('user-header-info').classList.remove('hidden');

    document.getElementById('header-username').textContent = `@${currentUsername}`;
    document.getElementById('banner-user-display').textContent = currentUsername;

    loadUserPlaylistsAndChannels();
}

function showAuthError(msg) {
    const errEl = document.getElementById('auth-error');
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
}

function hideAlerts() {
    document.getElementById('auth-error').classList.add('hidden');
    document.getElementById('auth-success').classList.add('hidden');
}

// ==========================================================================
// PLAYLIST MANAGEMENT
// ==========================================================================
function initPlaylistForms() {
    const btnTabUrl = document.getElementById('btn-tab-url');
    const btnTabFile = document.getElementById('btn-tab-file');
    const formUrl = document.getElementById('form-url');
    const formFile = document.getElementById('form-file');

    btnTabUrl.addEventListener('click', () => {
        btnTabUrl.classList.add('active');
        btnTabFile.classList.remove('active');
        formUrl.classList.remove('hidden');
        formFile.classList.add('hidden');
    });

    btnTabFile.addEventListener('click', () => {
        btnTabFile.classList.add('active');
        btnTabUrl.classList.remove('active');
        formFile.classList.remove('hidden');
        formUrl.classList.add('hidden');
    });

    // Form 1: Remote URL
    formUrl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const urlInput = document.getElementById('playlist-url');
        const nameInput = document.getElementById('playlist-name-url');
        const submitBtn = document.getElementById('btn-submit-url');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Descargando y procesando M3U...';

        try {
            const res = await fetch('/api/user/playlist/url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentUserToken}`
                },
                body: JSON.stringify({
                    url: urlInput.value.trim(),
                    name: nameInput.value.trim() || undefined
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Error procesando lista');

            showFeedback(data.message, 'success');
            urlInput.value = '';
            nameInput.value = '';
            loadUserPlaylistsAndChannels();

        } catch (err) {
            showFeedback(err.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>🚀 Descargar y Guardar en la Nube</span>';
        }
    });

    // Form 2: Local File Upload
    formFile.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fileInput = document.getElementById('playlist-file');
        const nameInput = document.getElementById('playlist-name-file');
        const submitBtn = document.getElementById('btn-submit-file');

        if (!fileInput.files || fileInput.files.length === 0) {
            showFeedback('Por favor selecciona un archivo .m3u', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('m3uFile', fileInput.files[0]);
        if (nameInput.value.trim()) {
            formData.append('name', nameInput.value.trim());
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Subiendo a MongoDB...';

        try {
            const res = await fetch('/api/user/playlist/upload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${currentUserToken}`
                },
                body: formData
            });

            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Error subiendo archivo');

            showFeedback(data.message, 'success');
            fileInput.value = '';
            nameInput.value = '';
            document.getElementById('file-chosen-label').textContent = 'Ningún archivo seleccionado';
            submitBtn.disabled = true;

            loadUserPlaylistsAndChannels();

        } catch (err) {
            showFeedback(err.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>📤 Subir y Guardar en la Nube</span>';
        }
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
        loadUserPlaylistsAndChannels();
    });
}

function initDropzone() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('playlist-file');
    const label = document.getElementById('file-chosen-label');
    const submitBtn = document.getElementById('btn-submit-file');

    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            label.textContent = `Archivo: ${file.name} (${Math.round(file.size / 1024)} KB)`;
            submitBtn.disabled = false;
        }
    });
}

function showFeedback(msg, type) {
    const fb = document.getElementById('playlist-feedback');
    fb.textContent = msg;
    fb.className = `feedback-msg ${type === 'error' ? 'alert-error' : 'alert-success'}`;
    fb.classList.remove('hidden');

    setTimeout(() => {
        fb.classList.add('hidden');
    }, 6000);
}

// ==========================================================================
// LOAD DATA FROM MONGODB
// ==========================================================================
async function loadUserPlaylistsAndChannels() {
    try {
        // 1. Fetch playlists summary
        const plRes = await fetch('/api/user/playlists', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const plData = await plRes.json();
        renderPlaylists(plData.playlists || []);

        // 2. Fetch combined channels
        const chRes = await fetch('/api/user/channels', {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const chData = await chRes.json();

        allUserChannels = chData.channels || [];
        document.getElementById('total-channels-count').textContent = allUserChannels.length;

        renderCategories(chData.categories || ['ALL']);
        filterChannels();

    } catch (err) {
        console.error('Error loading data:', err);
    }
}

function renderPlaylists(playlists) {
    const container = document.getElementById('playlists-list');
    container.innerHTML = '';

    if (playlists.length === 0) {
        container.innerHTML = '<p class="subtitle" style="text-align: center; padding: 10px;">Aún no tienes listas guardadas. Agrega un enlace o sube un archivo arriba.</p>';
        return;
    }

    playlists.forEach(pl => {
        const item = document.createElement('div');
        item.className = 'playlist-item';
        item.innerHTML = `
            <div class="playlist-meta">
                <h4>${escapeHtml(pl.name)}</h4>
                <span>Tipo: ${pl.type === 'file' ? '📁 Archivo local' : '🌐 Enlace M3U'} • ${pl.channelCount} canales</span>
            </div>
            <button class="btn-delete-pl" data-id="${pl._id}">🗑️ Eliminar</button>
        `;

        item.querySelector('.btn-delete-pl').addEventListener('click', async () => {
            if (confirm(`¿Deseas eliminar la lista "${pl.name}"?`)) {
                await deletePlaylist(pl._id);
            }
        });

        container.appendChild(item);
    });
}

async function deletePlaylist(id) {
    try {
        const res = await fetch(`/api/user/playlist/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const data = await res.json();
        showFeedback(data.message || 'Lista eliminada', 'success');
        loadUserPlaylistsAndChannels();
    } catch (err) {
        showFeedback('Error al eliminar lista', 'error');
    }
}

// ==========================================================================
// CHANNELS & SEARCH
// ==========================================================================
function renderCategories(cats) {
    const container = document.getElementById('web-categories');
    container.innerHTML = '';

    cats.forEach(cat => {
        const chip = document.createElement('button');
        chip.className = `cat-chip ${cat === activeCategory ? 'active' : ''}`;
        chip.textContent = cat === 'ALL' ? '⭐ Todos' : cat;
        chip.addEventListener('click', () => {
            activeCategory = cat;
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            filterChannels();
        });
        container.appendChild(chip);
    });
}

document.getElementById('web-search').addEventListener('input', () => {
    filterChannels();
});

function filterChannels() {
    const query = document.getElementById('web-search').value.trim().toLowerCase();

    filteredChannels = allUserChannels.filter(ch => {
        const matchesCategory = (activeCategory === 'ALL' || ch.group === activeCategory);
        const matchesQuery = (!query || 
            ch.name.toLowerCase().includes(query) || 
            ch.number.includes(query)
        );
        return matchesCategory && matchesQuery;
    });

    renderChannelsGrid();
}

function renderChannelsGrid() {
    const grid = document.getElementById('web-channels-grid');
    grid.innerHTML = '';

    if (filteredChannels.length === 0) {
        grid.innerHTML = '<p class="subtitle" style="grid-column: 1/-1; text-align:center; padding: 20px;">No hay canales en esta sección.</p>';
        return;
    }

    filteredChannels.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'web-channel-card';

        let logoHtml = '';
        if (ch.logo) {
            logoHtml = `<img src="${escapeHtml(ch.logo)}" alt="" onerror="this.src=''; this.parentElement.innerHTML='📺';">`;
        } else {
            logoHtml = `<span style="font-size: 20px;">📺</span>`;
        }

        card.innerHTML = `
            <div class="web-channel-header">
                <strong>#${ch.number}</strong>
                <span>${escapeHtml(ch.group)}</span>
            </div>
            <div class="web-channel-logo">
                ${logoHtml}
            </div>
            <div class="web-channel-name" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</div>
        `;

        card.addEventListener('click', () => {
            openWebPlayer(ch);
        });

        grid.appendChild(card);
    });
}

// ==========================================================================
// PREVIEW MODAL PLAYER
// ==========================================================================
function openWebPlayer(channel) {
    const modal = document.getElementById('preview-modal');
    const title = document.getElementById('modal-channel-title');
    const video = document.getElementById('web-player');

    title.textContent = `${channel.name} (#${channel.number})`;
    modal.classList.remove('hidden');

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (window.Hls && Hls.isSupported() && channel.url.includes('.m3u8')) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(channel.url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play());
    } else {
        video.src = channel.url;
        video.play().catch(e => console.log(e));
    }
}

document.getElementById('btn-close-preview').addEventListener('click', () => {
    const modal = document.getElementById('preview-modal');
    const video = document.getElementById('web-player');
    modal.classList.add('hidden');
    video.pause();
    video.src = '';
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
});

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
