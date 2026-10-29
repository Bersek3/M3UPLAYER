const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
    const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const storage = new Map();
    const context = vm.createContext({ currentUsername: 'alice', tvChannels: [], currentTvIndex: 0,
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        document: { getElementById: () => ({ setAttribute() {} }) },
        renderTvVerticalChannelsBar() {}, showToast() {}, showTvOverlayTemporarily() {},
        switchView() {}, playTvChannel() {} });
    const start = source.indexOf('let tvAllChannels =');
    vm.runInContext(source.slice(start, source.indexOf('let currentTvIndex', start)), context);
    const launch = source.indexOf('async function launchTvLiveMode(');
    vm.runInContext(source.slice(launch, source.indexOf('function renderTvVerticalChannelsBar', launch)), context);
    return { context, storage, run: code => vm.runInContext(code, context) };
}

test('favorites sort numerically and other channels remain accessible', () => {
    const { context } = setup();
    const channels = [{ name: 'Ten', number: '10' }, { name: 'Two', number: '2' }, { name: 'One', number: '1' }];
    const favorites = new Set(channels.slice(0, 2).map(context.channelFavoriteKey));
    assert.deepEqual(Array.from(context.orderedTvChannels(channels, favorites, true), c => c.number), ['2', '10']);
    assert.deepEqual(Array.from(context.orderedTvChannels(channels, favorites, false), c => c.number), ['2', '10', '1']);
    assert.equal(channels[0].number, '10');
});

test('favorites persist per account and tolerate corrupt storage', () => {
    const { context, storage } = setup();
    const ch = { name: 'Test', url: 'https://example.test/live' };
    context.toggleTvFavorite(ch);
    assert.equal(context.readTvFavorites().has(context.channelFavoriteKey(ch)), true);
    context.currentUsername = 'bob';
    assert.equal(context.readTvFavorites().size, 0);
    context.currentUsername = 'alice';
    assert.equal(context.readTvFavorites().size, 1);
    context.toggleTvFavorite(ch);
    assert.equal(context.readTvFavorites().size, 0);
    storage.set('m3u_favorites:alice', '{invalid');
    assert.equal(context.readTvFavorites().size, 0);
});

test('opening player defaults to favorites, while explicit channel selection still works', async () => {
    const { context, run } = setup();
    context.allUserChannels = [{ name: 'First', url: 'a', number: '1' }, { name: 'Favorite', url: 'b', number: '10' }];
    context.toggleTvFavorite(context.allUserChannels[1]);
    await context.launchTvLiveMode();
    assert.equal(run('tvFavoritesOnly'), true);
    assert.deepEqual(Array.from(context.tvChannels, c => c.name), ['Favorite']);
    await context.launchTvLiveMode(context.allUserChannels[0]);
    assert.equal(run('tvFavoritesOnly'), false);
    assert.equal(context.tvChannels[context.currentTvIndex].name, 'First');
});

test('removing last favorite returns to all channels without restarting playback', () => {
    const { context, run } = setup();
    context.channel = { name: 'Playing', url: 'a', number: '1' };
    run('tvAllChannels = [channel]; tvPlayingChannel = channel;');
    context.toggleTvFavorite(context.channel);
    run('tvFavoritesOnly = true;');
    context.playTvChannel = () => { throw new Error('Playback must not restart'); };
    context.toggleTvFavorite(context.channel);
    assert.equal(run('tvFavoritesOnly'), false);
    assert.equal(context.tvChannels.length, 1);
    assert.equal(context.currentTvIndex, 0);
});
