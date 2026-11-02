const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(responses) {
    const requests = [], launches = [], removed = [];
    const context = vm.createContext({
        API_BASE: 'https://api.example', currentUserToken: 'saved-token', currentUsername: 'alice',
        allUserChannels: [], AbortController, setTimeout, clearTimeout, TypeError,
        localStorage: { removeItem(key) { removed.push(key); } },
        fetch: async (url, options) => {
            requests.push({ url, options });
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return response;
        },
        setAuthState() {},
        launchTvLiveMode: async (_, channels) => launches.push(channels),
        closeAuthModal() { context.closed = true; }
    });
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const start = source.indexOf('async function startAndroidLive()');
    vm.runInContext(source.slice(start, source.indexOf('\nfunction setAuthModalMode', start)), context);
    return { context, requests, launches, removed };
}
const response = (channels, status = 200) => ({ ok: status === 200, status, json: async () => ({ channels }) });

test('saved Android session opens live TV after fetching enabled account channels', async () => {
    const { context, requests, launches } = setup([response([
        { name: 'Live', url: 'https://example/live.m3u8' },
        { name: 'Disabled', url: 'https://example/off', enabled: false },
        { name: 'Inactive', url: 'https://example/inactive', active: false },
        { name: 'Blocked', url: 'https://example/blocked', disabled: true },
        { name: 'Invalid', url: 'file:///tmp/channel' }
    ])]);
    await context.startAndroidLive();
    assert.equal(requests[0].options.headers.Authorization, 'Bearer saved-token');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.deepEqual(Array.from(launches[0], channel => channel.name), ['Live']);
    assert.equal(context.closed, true);
});

test('expired Android session clears saved credentials and stays at login', async () => {
    const { context, launches, removed } = setup([response([], 401)]);
    await assert.rejects(context.startAndroidLive(), /sesión expiró/);
    assert.equal(context.currentUserToken, null);
    assert.deepEqual(removed, ['m3u_web_token', 'm3u_web_user']);
    assert.equal(launches.length, 0);
    assert.equal(context.closed, undefined);
});

test('account without personal channels loads enabled public channels', async () => {
    const { context, requests, launches } = setup([response([]), response([{ name: 'Public', url: 'https://example/public' }])]);
    await context.startAndroidLive();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, 'https://api.example/api/channels');
    assert.equal(launches[0][0].name, 'Public');
});

test('empty enabled list keeps login visible without starting a fallback stream', async () => {
    const { context, launches } = setup([response([]), response([])]);
    await assert.rejects(context.startAndroidLive(), /No hay canales habilitados/);
    assert.equal(launches.length, 0);
    assert.equal(context.closed, undefined);
});

test('network failure or account failure does not enter TV or bypass authentication', async () => {
    for (const failure of [new TypeError('fetch failed'), response([], 500)]) {
        const { context, launches, requests } = setup([failure]);
        await assert.rejects(context.startAndroidLive());
        assert.equal(launches.length, 0);
        assert.equal(requests.length, 1);
        assert.equal(context.closed, undefined);
    }
});

test('Android startup opens email login before resuming a saved session', async () => {
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    for (const token of [null, 'saved-token']) {
        const calls = [], elements = {};
        const context = vm.createContext({
            IS_ANDROID_APP: true, currentUserToken: token,
            window: { addEventListener(_, handler) { context.start = handler; } },
            document: {
                body: { classList: { add() {} } },
                getElementById(id) { return elements[id] ||= { previousElementSibling: {} }; }
            },
            initNavbar() {}, initAuthModal() {}, initProfileView() {}, initTvPlayer() {}, initClock() {},
            switchView(view) { calls.push(view); },
            openAuthModal(mode) { calls.push(mode); },
            startAndroidLive: async () => calls.push('live'),
            showAuthError(message) { throw new Error(message); }
        });
        const start = source.indexOf("window.addEventListener('DOMContentLoaded'");
        vm.runInContext(source.slice(start, source.indexOf('// ==========================================================================', start)), context);
        await context.start();
        assert.equal(elements['modal-username'].type, 'email');
        assert.deepEqual(calls, token ? ['home', 'login', 'live'] : ['home', 'login']);
        if (token) assert.equal(elements['btn-auth-submit'].disabled, false);
    }
});
