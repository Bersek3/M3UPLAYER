const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(android = true) {
    const barEvents = {}, windowEvents = {}, scrolls = [], cleared = [];
    const items = [0, 1, 2].map(index => ({
        offsetTop: 24 + index * 92, offsetHeight: 76,
        classList: { toggle(_, active) { items[index].active = active; } }
    }));
    const list = { style: {}, querySelectorAll: () => items };
    const bar = { clientHeight: 200, scrollTo(options) { scrolls.push(options); },
        addEventListener(name, handler) { barEvents[name] = handler; } };
    let reveals = 0;
    const context = vm.createContext({
        IS_ANDROID_APP: android, currentTvIndex: 2, currentView: 'live', tvOverlayTimeout: 42,
        document: { getElementById: id => id === 'tv-vertical-bar' ? bar : list },
        window: { innerHeight: 600, addEventListener(name, handler) { windowEvents[name] = handler; } },
        clearTimeout(id) { cleared.push(id); },
        showTvOverlayTemporarily() { reveals++; },
        playTvChannel() { throw new Error('Scrolling must not change playback'); }
    });
    const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const start = source.indexOf('function initTvChannelScroll()');
    vm.runInContext(source.slice(start, source.indexOf('function changeTvChannel', start)), context);
    return { context, items, list, barEvents, windowEvents, scrolls, cleared, reveals: () => reveals };
}

test('Android channel selection scrolls only its channel container and keeps the selected card visible', () => {
    const { context, items, list, scrolls } = setup();
    context.updateTvVerticalPosition();
    assert.equal(list.style.transform, 'none');
    assert.equal(scrolls[0].top, 146);
    assert.equal(scrolls[0].behavior, 'smooth');
    assert.deepEqual(items.map(item => item.active), [false, false, true]);
    context.currentTvIndex = 0;
    context.updateTvVerticalPosition();
    assert.equal(scrolls[1].top, 0);
});

test('only gestures in the channel strip hold the menu open; scrolling does not change channels', () => {
    const { context, barEvents, windowEvents, cleared, reveals } = setup();
    context.initTvChannelScroll();
    windowEvents.pointerup();
    assert.equal(reveals(), 0);
    barEvents.pointerdown();
    barEvents.scroll();
    assert.equal(cleared.length, 2);
    assert.equal(context.currentTvIndex, 2);
    windowEvents.pointercancel();
    assert.equal(reveals(), 3);
    barEvents.scroll();
    assert.equal(cleared.length, 2);
    assert.equal(reveals(), 4);
});

test('browser channel carousel retains its existing positioning and gesture behavior', () => {
    const { context, list, barEvents, scrolls } = setup(false);
    context.initTvChannelScroll();
    context.updateTvVerticalPosition();
    assert.equal(list.style.transform, 'translateY(18px)');
    assert.equal(scrolls.length, 0);
    assert.deepEqual(Object.keys(barEvents), []);
});
