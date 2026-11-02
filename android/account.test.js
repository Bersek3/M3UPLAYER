const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(responses) {
    const elements = {};
    const get = id => elements[id] ||= { value: '', textContent: '', hidden: false, disabled: false,
        addEventListener(type, handler) { this[type] = handler; } };
    const requests = [], rendered = [];
    const context = vm.createContext({ document: { getElementById: get },
        AbortController, setTimeout, clearTimeout, TypeError,
        generation: 0, hls: null, channels: [], strip: { replaceChildren() {} },
        video: { pause() {}, removeAttribute() {}, load() {} }, status: get('status'),
        hideControls() {}, showControls() {}, renderChannels(channels) { rendered.push(channels); },
        fetch: async (url, options) => { requests.push({ url, options }); return responses.shift(); }
    });
    vm.runInContext(fs.readFileSync(__dirname + '/account.js', 'utf8'), context);
    return { get, context, requests, rendered };
}
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });
test('requires login, loads only account channels, clears password and logs out', async () => {
    const state = setup([response({ token: 'test-token' }), response({ channels: [{ name: 'Mi canal', url: 'https://example.test/live.m3u8' }] })]);
    assert.equal(state.get('auth').hidden, false);
    assert.equal(state.requests.length, 0);
    state.get('username').value = 'usuario'; state.get('password').value = 'test-only';
    await state.get('login-form').submit({ preventDefault() {} });
    assert.equal(state.requests[1].options.headers.Authorization, 'Bearer test-token');
    assert.equal(state.rendered[0][0].name, 'Mi canal');
    assert.equal(state.get('auth').hidden, true);
    assert.equal(state.get('password').value, '');
    state.get('logout').onclick();
    assert.equal(state.get('auth').hidden, false);
    assert.equal(vm.runInContext('accountToken', state.context), '');
});
test('expired session returns to login without showing other channels', async () => {
    const state = setup([response({ token: 'test-token' }), response({ error: 'Expirada' }, 401)]);
    await state.get('login-form').submit({ preventDefault() {} });
    assert.equal(state.rendered.length, 0);
    assert.equal(state.get('auth').hidden, false);
    assert.match(state.get('auth-error').textContent, /expiró/);
});
test('empty account stays empty instead of falling back to bundled channels', async () => {
    const state = setup([response({ token: 'test-token' }), response({ channels: [] })]);
    await state.get('login-form').submit({ preventDefault() {} });
    assert.equal(state.rendered[0].length, 0);
    assert.equal(state.get('auth').hidden, true);
});
