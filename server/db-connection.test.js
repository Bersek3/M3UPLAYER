const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
    const source = fs.readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
    const start = source.indexOf('async function connectDB()');
    const end = source.indexOf('\nconnectDB();', start);
    const attempts = [];
    class MongoClient {
        constructor() { attempts.push(this); }
        connect() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
        db() { return { collection: name => ({ name }) }; }
        async close() { this.closed = true; }
    }
    const context = vm.createContext({ MongoClient, console: { log() {}, error() {} } });
    vm.runInContext(`let db, usersCol, playlistsCol, client, connectionPromise;
        const MONGO_URI = 'test', DB_NAME = 'test';
        ${source.slice(start, end)}`, context);
    return { connect: context.connectDB, attempts };
}

test('concurrent startup requests wait for the same connection and reuse it', async () => {
    const { connect, attempts } = setup();
    const first = connect();
    const second = connect();
    let settled = false;
    second.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(attempts.length, 1);
    attempts[0].resolve();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(await connect(), true);
    assert.equal(attempts.length, 1);
});

test('failed connection is closed and a later request can retry', async () => {
    const { connect, attempts } = setup();
    const first = connect();
    const second = connect();
    attempts[0].reject(new Error('Temporary connection failure'));
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.equal(attempts[0].closed, true);
    const retry = connect();
    assert.equal(attempts.length, 2);
    attempts[1].resolve();
    assert.equal(await retry, true);
});
