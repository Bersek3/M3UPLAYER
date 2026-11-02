const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
    const events = {}, classes = new Set(), hidden = new Set(['hidden']);
    const button = { setAttribute(name, value) { this[name] = value; }, addEventListener(_, handler) { this.click = handler; } };
    const video = { paused: true, controls: true, addEventListener(name, handler) { events[name] = handler; },
        async play() { this.paused = false; }, pause() { this.paused = true; } };
    const errorClasses = new Set(['hidden']);
    const elements = {
        'btn-tv-play': button,
        'tv-video-container': { classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); } } },
        'tv-player-buffering': { classList: { add(value) { hidden.add(value); } } },
        'tv-player-error': { classList: { contains: value => errorClasses.has(value) } }
    };
    let retries = 0, notices = 0;
    const context = vm.createContext({ document: { getElementById: id => elements[id] }, currentTvIndex: 2,
        playTvChannel(index) { assert.equal(index, 2); retries++; }, showToast() { notices++; } });
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const start = source.indexOf('function initTvPlaybackUi(');
    vm.runInContext(source.slice(start, source.indexOf('function initTvPlayer()', start)), context);
    context.initTvPlaybackUi(video);
    return { video, events, button, classes, errorClasses, retries: () => retries, notices: () => notices };
}

test('custom player suppresses native controls and shows video only after frames arrive', () => {
    const { video, events, classes, button } = setup();
    assert.equal(video.controls, false);
    assert.equal(classes.has('has-video-frame'), false);
    events.loadeddata();
    assert.equal(classes.has('has-video-frame'), true);
    events.emptied();
    assert.equal(classes.has('has-video-frame'), false);
    assert.equal(button['aria-label'], 'Reproducir');
});

test('small custom control plays, pauses and retries the selected channel after an error', async () => {
    const { video, button, errorClasses, retries } = setup();
    await button.click();
    assert.equal(video.paused, false);
    assert.equal(button['aria-label'], 'Pausar');
    await button.click();
    assert.equal(video.paused, true);
    assert.equal(button['aria-label'], 'Reproducir');
    errorClasses.delete('hidden');
    await button.click();
    assert.equal(retries(), 1);
});

test('blocked playback keeps the custom control available for another attempt', async () => {
    const { video, button, notices } = setup();
    video.play = async () => { throw new Error('NotAllowedError'); };
    await button.click();
    assert.equal(button['aria-label'], 'Reproducir');
    assert.equal(notices(), 1);
});
