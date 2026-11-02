'use strict';
const API = 'https://m3u-player-one.vercel.app';
const authScreen = document.getElementById('auth');
const authError = document.getElementById('auth-error');
const loginButton = document.getElementById('login-submit');
let accountToken = '', accountGeneration = 0;
async function accountRequest(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch(API + path, { ...options, signal: controller.signal });
        let data;
        try { data = await response.json(); }
        catch { throw new Error('El servidor no respondió correctamente. Inténtalo de nuevo.'); }
        if (!response.ok || data.error) {
            const error = new Error(data.error || 'No se pudo completar la solicitud.');
            error.status = response.status;
            throw error;
        }
        return data;
    } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) {
            throw new Error('No se pudo conectar con el servidor. Revisa internet e inténtalo de nuevo.');
        }
        throw error;
    } finally { clearTimeout(timer); }
}
function resetAccount(message = '') {
    accountGeneration++;
    accountToken = '';
    generation++;
    if (hls) { hls.destroy(); hls = null; }
    video.pause(); video.removeAttribute('src'); video.load();
    channels = []; strip.replaceChildren();
    document.getElementById('count').textContent = '0';
    document.getElementById('title').textContent = 'Mis canales';
    hideControls();
    authScreen.hidden = false;
    authError.textContent = message;
    document.getElementById('password').value = '';
    status.textContent = '';
}
async function loadAccountChannels() {
    const version = accountGeneration;
    const button = document.getElementById('refresh');
    button.disabled = true;
    try {
        const data = await accountRequest('/api/user/channels', { headers: { Authorization: 'Bearer ' + accountToken } });
        if (version !== accountGeneration) return;
        if (!Array.isArray(data.channels)) throw new Error('La respuesta no contiene una lista de canales válida.');
        authScreen.hidden = true;
        renderChannels(data.channels.filter(channel => typeof channel.url === 'string' && /^https?:\/\//i.test(channel.url)));
    } catch (error) {
        if (version !== accountGeneration) return;
        if (error.status === 401 || error.status === 403) resetAccount('Tu sesión expiró. Vuelve a iniciar sesión.');
        else if (!authScreen.hidden) authError.textContent = error.message;
        else { status.textContent = error.message; showControls(); }
    } finally { button.disabled = false; }
}
document.getElementById('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (loginButton.disabled) return;
    const version = ++accountGeneration;
    loginButton.disabled = true; loginButton.textContent = 'Conectando…'; authError.textContent = '';
    try {
        const data = await accountRequest('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: document.getElementById('username').value.trim(), password: document.getElementById('password').value })
        });
        if (version !== accountGeneration) return;
        if (!data.token) throw new Error('El servidor no devolvió una sesión válida.');
        accountToken = data.token;
        document.getElementById('password').value = '';
        loginButton.textContent = 'Cargando mis canales…';
        await loadAccountChannels();
    } catch (error) { if (version === accountGeneration) authError.textContent = error.message; }
    finally { loginButton.disabled = false; loginButton.textContent = 'Iniciar sesión'; }
});
document.getElementById('refresh').onclick = loadAccountChannels;
document.getElementById('logout').onclick = () => resetAccount();
resetAccount();
