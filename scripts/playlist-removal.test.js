const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const channel = (id, url = id) => ({ playlistId: id, playlistName: 'Same name', name: id, url, group: 'TV' });
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

function setup(channels, replies = []) {
    const nodes = {}, handlers = [], requests = [], played = [];
    const stored = new Set(channels.map(c => c.name));
    let destroyed = 0, paused = 0;
    const node = id => nodes[id] ||= {
        textContent: '', innerHTML: '', classList: { add() {}, remove() {} },
        appendChild() {}, pause() { paused++; }, load() {}, removeAttribute() {}
    };
    const context = vm.createContext({
        currentUserToken: 'token', currentUsername: 'user', currentView: 'live',
        userDataRevision: 0, pendingPlaylistDeletes: new Set(), activeProfileCategory: 'TV',
        allUserChannels: channels.slice(), tvAllChannels: channels.slice(), tvChannels: channels.slice(),
        tvPlayingChannel: channels[0] || null, currentTvIndex: 0,
        tvHls: { destroy() { destroyed++; } },
        userPlaylists: channels.map(c => ({ id: c.playlistId, name: 'Same name', type: 'url' })),
        API_BASE: '', AbortController, setTimeout, clearTimeout,
        console: { error() {} }, confirm: () => true, escapeHtml: value => value,
        localStorage: { setItem(_, value) { stored.clear(); JSON.parse(value).forEach(key => stored.add(key)); } },
        readTvFavorites: () => new Set(stored), channelFavoriteKey: c => c.name,
        refreshTvFavorites() { context.tvChannels = context.tvAllChannels.slice(); },
        playTvChannel(index) { played.push(index); context.tvPlayingChannel = context.tvChannels[index]; },
        renderProfileCategories() {}, filterProfileChannels() {}, showPlaylistFeedback() {}, showToast() {},
        document: { hidden: false, getElementById: node, createElement() {
            const button = { addEventListener(_, handler) { handlers.push(handler); } };
            return { querySelector: () => button };
        } },
        fetch: async (url, options) => {
            requests.push({ url, options });
            const reply = replies.shift();
            return typeof reply === 'function' ? reply() : reply;
        }
    });
    const start = source.indexOf('function stopAccountPlayback()');
    vm.runInContext(source.slice(start, source.indexOf('function renderProfileCategories()', start)), context);
    context.renderUserPlaylists(context.userPlaylists);
    return { context, handlers, requests, stored, played, nodes, destroyed: () => destroyed, paused: () => paused };
}

for (const type of ['url', 'file']) test(`deleting last ${type} list clears channels, favorites and live playback even when reload fails`, async () => {
    const state = setup([channel('a')], [response({ success: true }), response({}, 500)]);
    state.context.userPlaylists[0].type = type;
    await state.handlers[0]();
    assert.equal(state.context.allUserChannels.length, 0);
    assert.equal(state.context.tvAllChannels.length, 0);
    assert.equal(state.context.tvChannels.length, 0);
    assert.equal(state.context.tvPlayingChannel, null);
    assert.equal(state.stored.size, 0);
    assert.equal(state.destroyed(), 1);
    assert.ok(state.paused() > 0);
    assert.equal(state.requests[0].options.method, 'DELETE');
    assert.equal(state.requests.some(request => request.url === '/api/channels'), false);
    assert.equal(state.nodes['profile-total-channels-badge'].textContent, 0);
});

test('same-named lists remain distinct and deleting one preserves another valid stream', async () => {
    const a = channel('a', 'shared'), b = channel('b', 'shared');
    const state = setup([a, b], [response({ success: true }), response({}, 500)]);
    await state.handlers[0]();
    assert.deepEqual(Array.from(state.context.allUserChannels, c => c.playlistId), ['b']);
    assert.equal(state.context.tvPlayingChannel.playlistId, 'b');
    assert.equal(state.destroyed(), 0);
    assert.equal(state.played.length, 0);
});

test('failed deletion restores the playlist and keeps its channels', async () => {
    const a = channel('a');
    const state = setup([a], [response({ error: 'failed' }, 500),
        response({ playlists: [{ id: 'a', name: 'Same name' }] }), response({ channels: [a] })]);
    await state.handlers[0]();
    assert.equal(state.context.userPlaylists.length, 1);
    assert.equal(state.context.allUserChannels[0].playlistId, 'a');
    assert.equal(state.destroyed(), 0);
});

test('live synchronization switches away from a deleted stream and clears the last stream', async () => {
    const state = setup([channel('a'), channel('b')], [response({ channels: [channel('b')] }), response({ channels: [] })]);
    await state.context.refreshLiveAccountChannels();
    assert.equal(state.context.tvPlayingChannel.playlistId, 'b');
    assert.deepEqual(state.played, [0]);
    await state.context.refreshLiveAccountChannels();
    assert.equal(state.context.tvChannels.length, 0);
    assert.equal(state.context.tvPlayingChannel, null);
});

test('a stale profile response cannot restore channels after a deletion', async () => {
    let resolve;
    const state = setup([channel('a')], [() => new Promise(done => { resolve = done; })]);
    const loading = state.context.loadUserData();
    state.context.userDataRevision++;
    state.context.reconcileAccountChannels([]);
    resolve(response({ playlists: [{ id: 'a' }] }));
    await loading;
    assert.equal(state.context.allUserChannels.length, 0);
    assert.equal(state.requests.length, 1);
});

test('a live response from a previous session is ignored', async () => {
    let resolve;
    const state = setup([channel('a')], [() => new Promise(done => { resolve = done; })]);
    const loading = state.context.refreshLiveAccountChannels();
    state.context.currentUserToken = 'other-user';
    resolve(response({ channels: [] }));
    await loading;
    assert.equal(state.context.allUserChannels.length, 1);
});

test('authenticated live entry with no channels never fetches public channels', async () => {
    const state = setup([channel('a')], [response({ channels: [] })]);
    state.context.switchView = view => { state.context.currentView = view; };
    state.context.renderTvVerticalChannelsBar = () => {};
    state.context.showTvOverlayTemporarily = () => {};
    const start = source.indexOf('async function launchTvLiveMode(');
    vm.runInContext(source.slice(start, source.indexOf('function renderTvVerticalChannelsBar()', start)), state.context);
    await state.context.launchTvLiveMode();
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].url, '/api/user/channels');
    assert.equal(state.context.tvChannels.length, 0);
    assert.equal(state.context.tvPlayingChannel, null);
});

test('Samsung TV clears cached deleted channels and stops pending playback', async () => {
    const samsung = fs.readFileSync(require.resolve('../M3UPLAYER/main.js'), 'utf8');
    const cache = new Map([['token', 'account'], ['cached', JSON.stringify([channel('a')])]]);
    let stopped = 0, cancelled = 0;
    const context = vm.createContext({
        allChannels: [channel('a')], currentChannelIndex: 0, channelSwitchDebounceTimeout: 7,
        document: { getElementById: () => null },
        STORAGE_KEY_TOKEN: 'token', STORAGE_KEY_CACHED_CHANNELS: 'cached',
        STORAGE_KEY_LAST_CHANNEL: 'last', STORAGE_KEY_LAST_CHANNEL_URL: 'url',
        localStorage: { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) },
        clearTimeout() { cancelled++; }, stopCurrentPlayback() { stopped++; },
        renderVerticalChannelList() {}, updateVerticalCarouselPosition() {}, showBuffering() {}, showError() {},
        showToast() {}, getServerUrl: () => 'https://api.example',
        fetch: async () => response({ channels: [] }),
        selectAndPlayChannel() { throw new Error('Empty account must not play a fallback'); }
    });
    const start = samsung.indexOf('function applyAccountChannelList(');
    vm.runInContext(samsung.slice(start, samsung.indexOf('// ==========================================================================', start)), context);
    await context.reloadChannelsFromServer(true);
    assert.equal(context.allChannels.length, 0);
    assert.equal(cache.get('cached'), '[]');
    assert.equal(stopped, 1);
    assert.equal(cancelled, 1);
});

test('channel API identifies playlist ownership even when names are identical', async () => {
    const handlerSource = fs.readFileSync(require.resolve('../api/user/channels.js'), 'utf8');
    const module = { exports: {} };
    const playlists = [{ _id: 'a', name: 'Same', channels: [channel('a')] }, { _id: 'b', name: 'Same', channels: [channel('b')] }];
    vm.runInNewContext(handlerSource, { module, console, require(name) {
        if (name.endsWith('/db')) return { connectDB: async () => ({ collection: () => ({ find: () => ({ toArray: async () => playlists }) }) }) };
        if (name.endsWith('/auth')) return { authenticate: async () => ({ user: { userId: 'owner' } }) };
        return { playbackSource: channel => channel };
    } });
    const headers = {};
    let body;
    const res = { setHeader(key, value) { headers[key] = value; }, status() { return this; }, json(value) { body = value; } };
    await module.exports({ method: 'GET' }, res);
    assert.deepEqual(Array.from(body.channels, channel => channel.playlistId), ['a', 'b']);
    assert.equal(headers['Cache-Control'], 'no-store');
});
