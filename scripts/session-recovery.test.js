const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');

function setup(replies) {
    const events = [], requests = [];
    const context = vm.createContext({
        currentUserToken: 'old-token', currentUsername: 'user', userDataRevision: 0,
        pendingPlaylistDeletes: new Set(), API_BASE: '',
        document: { getElementById() { return { click() {
            events.push('logout'); context.currentUserToken = null;
            context.userDataRevision++;
        } }; } },
        openAuthModal(mode) { events.push(mode); }, showAuthError(message) { events.push(message); },
        showPlaylistFeedback() { events.push('generic-error'); }, console: { error() {} },
        fetch: async url => { requests.push(url); return replies.shift(); },
        renderUserPlaylists() {}, reconcileAccountChannels() {},
        renderProfileCategories() {}, filterProfileChannels() {}
    });
    const start = source.indexOf('function recoverRejectedSession(');
    vm.runInContext(source.slice(start, source.indexOf('function renderUserPlaylists(', start)), context);
    return { context, events, requests };
}

test('rejected saved session opens login and does not request channels with the rejected token', async () => {
    const state = setup([{ status: 401, ok: false }]);
    await state.context.loadUserData();
    assert.equal(state.context.currentUserToken, null);
    assert.equal(state.requests.length, 1);
    assert.deepEqual(state.events.slice(0, 2), ['logout', 'login']);
    assert.match(state.events[2], /Inicia sesión/);
    assert.ok(!state.events.includes('generic-error'));
});

test('channel authorization rejection after loading playlists also returns to login', async () => {
    const state = setup([{ status: 200, ok: true, json: async () => ({ playlists: [] }) },
        { status: 401, ok: false }]);
    await state.context.loadUserData();
    assert.equal(state.context.currentUserToken, null);
    assert.equal(state.requests.length, 2);
    assert.equal(state.events[0], 'logout');
});

test('late rejection of an old token cannot log out a newly signed-in session', () => {
    const state = setup([]);
    state.context.currentUserToken = 'new-token';
    assert.equal(state.context.recoverRejectedSession({ status: 401 }, 'old-token'), false);
    assert.equal(state.context.currentUserToken, 'new-token');
    assert.equal(state.events.length, 0);
});

test('temporary server failure preserves the saved session', async () => {
    const state = setup([{ status: 503, ok: false }]);
    await state.context.loadUserData();
    assert.equal(state.context.currentUserToken, 'old-token');
    assert.deepEqual(state.events, ['generic-error']);
});
